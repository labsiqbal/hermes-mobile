/**
 * group-driver.ts — group chat round-robin engine (Desktop parity).
 *
 * Pure, framework-agnostic port of the Desktop hermes-bots group loop
 * (apps/desktop/src/plugins/hermes-bots/plugin.js):
 *   - buildGroupChatTurnPrompt  (6734-6756) — per-turn prompt format, verbatim
 *   - resolveGroupResponders / parseGroupChatMentions (6560-6656)
 *   - ensureGroupChatSession    (7129-7189) — resume by title `Group: <roomId>`
 *     per member profile; only a genuine RPC 4007 mints a new hidden session
 *   - submitGroupTurnPrompt     (7266-7291)
 *   - poll loop                 (7539-7594) — session.resume every ~2s until a
 *     new assistant message lands && !inflight && !running (180s base timeout,
 *     extended while busy up to a 20min hard cap)
 *   - runGroupChatRounds        (7828-8028) — max 3 rounds, max 10 member
 *     messages, per-member-per-thread watermarks, "(pass)" = silent, a round
 *     with no voices settles the conversation.
 *
 * Cross-gateway members: v1 SKIP. A member is LOCAL when its profile
 * (`member.name`) exists in the connected gateway's `profiles.list` —
 * never matched by `connectionId` (a SavedConnection.id is random per
 * install, so rooms created on another device or by Desktop carry foreign
 * ids and would have no responder here). Members whose profile is absent
 * from this gateway are skipped (v2: second WS connection per gateway /
 * relay daemon fan-out).
 *
 * The driver is given the room object and mutates `room.log` in place (the
 * room log is the single source of truth, same as Desktop's room store),
 * reporting every appended entry through `onEntry`.
 */

import type { HermesConnection } from "./hermes-client";
import {
  appendLogCapped,
  groupRoomKey,
  groupSessionTitle,
  groupsMetaRevision,
  readGroupRegistry,
  upsertRoom,
} from "./group-store";
import type { GroupLogEntry, GroupMember, GroupRoom } from "./group-store";

const GROUP_CHAT_MAX_ROUNDS = 3;
const GROUP_CHAT_MAX_MESSAGES = 10;
const GROUP_CHAT_HISTORY_LIMIT = 24;
const GROUP_TURN_TIMEOUT_MS = 180_000;
const GROUP_TURN_POLL_MS = 2_000;
const GROUP_TURN_HARD_CAP_MS = 20 * 60_000;
/** CAS read-merge-retry budget for the registry mirror (BUG 2 fix). */
const GROUP_MIRROR_MAX_ATTEMPTS = 3;

/** Why a rounds loop settled — surfaced once to the UI at the end of a round
 *  so a total failure is never silent. `error:<short>` = every member turn
 *  failed (or the engine itself aborted). */
export type GroupSettleReason = "replied" | "all_passed" | `error:${string}`;

export interface GroupDriverOptions {
  client: HermesConnection;
  /** @deprecated Drive decisions never read this (profile-name locality,
   *  see the module header). Kept only so existing callers keep compiling. */
  connectionId?: string;
  room: GroupRoom;
  onEntry: (entry: GroupLogEntry) => void;
  /** Handle of the member currently taking a turn, null when idle. */
  onTurnChange?: (memberHandle: string | null) => void;
  /** Fired once per sendUserMessage when its rounds loop settles, with the
   *  reason — the UI shows a one-off hint on all_passed / error. */
  onSettled?: (reason: GroupSettleReason) => void;
  /** Fired once the rounds loop settles (pass / caps / all-failed). */
  onDone: () => void;
}

/** "(pass)" (loosely: pass / (pass) / pass.) or empty = the member stayed silent. */
export function isGroupPassText(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  return /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

/** Stable member key — plugin.js groupMemberKey() for local members. */
function memberKey(member: GroupMember): string {
  return member.name;
}

/** Deterministic @mention parse (plugin.js parseGroupChatMentions, trimmed to
 *  the mobile GroupMember shape: name + handle forms, no titles). Returns the
 *  mentioned member keys and whether @everyone/@all appeared. */
function parseGroupChatMentions(
  text: string,
  members: GroupMember[],
): { everyone: boolean; mentioned: Set<string> } {
  const source = String(text || "");
  const mentioned = new Set<string>();
  let everyone = false;
  const handles = new Map<string, string>();

  for (const member of members) {
    const forms = new Set([
      member.name.toLowerCase(),
      member.name.toLowerCase().replace(/[\s_-]+/g, ""),
      ...(member.handle
        ? [member.handle.toLowerCase(), member.handle.toLowerCase().replace(/[\s_-]+/g, "")]
        : []),
    ]);
    for (const form of forms) {
      if (form) handles.set(form, memberKey(member));
    }
  }

  for (const match of source.matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)) {
    const handle = match[1].toLowerCase();
    if (handle === "everyone" || handle === "all") {
      everyone = true;
      continue;
    }
    if (handle === "user") continue;
    const resolved = handles.get(handle) ?? handles.get(handle.replace(/[._-]+/g, ""));
    if (resolved) mentioned.add(resolved);
  }

  return { everyone, mentioned };
}

/** Members that should take a turn this round: everyone when no member is
 *  @-mentioned since the last user entry (or @everyone appears), otherwise
 *  only the mentioned members (plugin.js resolveGroupResponders). */
function resolveGroupResponders(log: GroupLogEntry[], members: GroupMember[]): GroupMember[] {
  let sinceLastUser: GroupLogEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === "user") {
      sinceLastUser = log.slice(i);
      break;
    }
  }

  const mentioned = new Set<string>();
  let everyone = false;
  for (const entry of sinceLastUser) {
    const parsed = parseGroupChatMentions(entry.text, members);
    if (parsed.everyone) everyone = true;
    for (const name of parsed.mentioned) mentioned.add(name);
  }

  if (everyone || mentioned.size === 0) return members;
  return members.filter((member) => mentioned.has(memberKey(member)));
}

/** Rotate the roster so a different member leads each round. */
function rotateGroupSpeakers(members: GroupMember[], round: number): GroupMember[] {
  if (members.length < 2) return members;
  const shift = round % members.length;
  return [...members.slice(shift), ...members.slice(0, shift)];
}

/** Room-log line as a member sees it: `User (user): …` / `name: …` /
 *  `name (you): …` (plugin.js formatGroupChatLine, mobile labels = handles). */
function formatGroupChatLine(entry: GroupLogEntry, viewer: GroupMember): string {
  if (entry.kind === "user") return `User (user): ${entry.text}`;
  const speaker = entry.name || "?";
  const suffix = speaker === viewer.handle ? " (you)" : "";
  return `${speaker}${suffix}: ${entry.text}`;
}

/** The full per-turn payload for one member — plugin.js
 *  buildGroupChatTurnPrompt, VERBATIM rules (they travel in the turn payload,
 *  not SOUL, so any existing bot can join without a profile migration). */
function buildGroupChatTurnPrompt(options: {
  groupName: string;
  members: GroupMember[];
  viewer: GroupMember;
  deltaLines: string[];
  /** Profile names on the connected gateway — a peer whose profile is absent
   *  is cross-gateway and gets an `[on <label>]` tag. */
  localProfiles: Set<string>;
}): string {
  const { groupName, members, viewer, deltaLines, localProfiles } = options;
  const viewerKey = memberKey(viewer);
  const peers = members.filter((m) => memberKey(m) !== viewerKey);
  const peerNames = peers
    .map((m) => {
      const handle = `@${m.handle || m.name}`;
      const remote = m.name ? !localProfiles.has(m.name) : false;
      return remote ? `${handle} [on ${m.connectionLabel || m.connectionId}]` : handle;
    })
    .join(", ");

  return [
    `[Group chat: "${groupName}"] You are @${viewer.handle || viewer.name}, one participant in a group chat with ${peerNames || "no one else yet"} and the user.`,
    "",
    "New messages in the room since your last turn (oldest first):",
    ...deltaLines.map((line) => `  ${line}`),
    "",
    "Rules for this room:",
    "- Reply with ONE conversational message ONLY if you have something new worth adding: build on what was just said, claim or hand off work, answer a question aimed at you, or report a real result. Keep chatter short (1-3 sentences) — but when you are delivering a result, an answer the user asked for, or substantive work, give it at full quality and length; never thin out real content to fit the room.",
    '- If you have nothing new to add, reply with exactly "(pass)". Passing is good — it lets the conversation settle.',
    "- Mention a teammate as @name to pull them in; mention @user only for a judgment call or a result the user needs. Do not repeat points already made.",
    "- Never reveal content from your private 1:1 chats. Your reply text goes to the room verbatim — no preamble, no meta-commentary.",
  ].join("\n");
}

interface ResumeLike {
  session_id?: string;
  /** Durable registry-row id (plugin.js `res.session_key`) — session.resume
   *  and session.delete target THIS, not the live runtime id. */
  session_key?: string;
  stored_session_id?: string;
  messages?: unknown[];
  inflight?: boolean;
  running?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One-line, length-capped error summary for the `error:<short>` settle reason. */
function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].trim().slice(0, 120) || "unknown";
}

/** Displayable text out of a resumed message (string content or typed blocks). */
function messageText(msg: unknown): string {
  const m = msg as {
    role?: unknown;
    content?: unknown;
    text?: unknown;
  } | null;
  if (!m || typeof m !== "object") return "";
  const raw = m.content ?? m.text;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const block = p as { text?: unknown; content?: unknown };
          if (typeof block.text === "string") return block.text;
          if (typeof block.content === "string") return block.content;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export class GroupDriver {
  private client: HermesConnection;
  private room: GroupRoom;
  private onEntryCb: (entry: GroupLogEntry) => void;
  private onTurnChangeCb?: (memberHandle: string | null) => void;
  private onSettledCb?: (reason: GroupSettleReason) => void;
  private onDoneCb: () => void;
  /** Per-member-per-thread watermark: `<thread>::<memberName>` → log length
   *  the member has seen (plugin.js room.watermarks, 7981-7984). */
  private watermarks = new Map<string, number>();
  /** Profile names on the connected gateway (null = not resolved yet). */
  private localProfiles: Set<string> | null = null;
  /** Serial fire-and-forget chain for the registry mirror — one ui_meta CAS
   *  write at a time, entry order preserved, UX never blocked. */
  private mirrorChain: Promise<void> = Promise.resolve();

  constructor(options: GroupDriverOptions) {
    this.client = options.client;
    this.room = options.room;
    this.onEntryCb = options.onEntry;
    this.onTurnChangeCb = options.onTurnChange;
    this.onSettledCb = options.onSettled;
    this.onDoneCb = options.onDone;
  }

  /** Profile names on the connected gateway = the members this client can
   *  drive (v1). Fetched once, cached; when the roster is unreadable the v1
   *  single-gateway assumption kicks in (every member treated as local)
   *  rather than silencing the room. */
  private async resolveLocalProfiles(): Promise<Set<string>> {
    if (this.localProfiles) return this.localProfiles;
    try {
      const profiles = await this.client.profilesList({ includeSessions: false });
      this.localProfiles = new Set(
        profiles.map((p) => p.name).filter((name): name is string => Boolean(name)),
      );
    } catch (error) {
      console.warn("[group-driver] profiles.list gagal; anggap semua member lokal:", error);
      this.localProfiles = new Set(this.room.members.map((m) => m.name));
    }
    return this.localProfiles;
  }

  /** Members this driver can actually drive: those whose profile exists on
   *  the connected gateway. Cross-gateway members are v1 SKIPPED (v2: second
   *  WS per gateway or the relay daemon) — they stay in the room roster and
   *  in the peer list of every turn prompt, but never get a turn here. */
  private localMembers(profiles: Set<string>): GroupMember[] {
    return this.room.members.filter((m) => profiles.has(m.name));
  }

  private append(entry: GroupLogEntry): void {
    this.room.log.push(entry);
    this.onEntryCb(entry);
    this.enqueueMirror(entry);
  }

  // ── registry mirror (fire-and-forget, serial, console-only on failure) ──

  private enqueueMirror(entry: GroupLogEntry): void {
    this.mirrorChain = this.mirrorChain.then(() => this.mirrorEntry(entry));
  }

  /** Persist one log entry to the shared registry so other devices see the
   *  room: read fresh → appendLogCapped onto the remote room → CAS write,
   *  read-merge-retry up to 3× on a revision conflict. Never throws. */
  private async mirrorEntry(entry: GroupLogEntry): Promise<void> {
    for (let attempt = 1; attempt <= GROUP_MIRROR_MAX_ATTEMPTS; attempt++) {
      try {
        const profiles = await this.client.profilesList({ includeSessions: false });
        const registry = readGroupRegistry(profiles);
        const remote = registry.rooms[groupRoomKey(this.room.roomId)];
        if (!remote) return; // room deleted remotely — nothing to mirror to
        const next = upsertRoom(registry, appendLogCapped(remote, entry));
        await this.client.syncGroupRegistry(next, groupsMetaRevision(profiles));
        return;
      } catch (error) {
        const conflict = (error as { name?: unknown })?.name === "UiMetaConflictError";
        if (conflict && attempt < GROUP_MIRROR_MAX_ATTEMPTS) continue;
        console.warn(
          `[group-driver] registry mirror gagal (${entry.kind}, attempt ${attempt}):`,
          error,
        );
        return;
      }
    }
  }

  /**
   * Append the user's message as a NEW thread and run the rounds loop.
   * Resolves when the conversation settles; member-level errors degrade to a
   * pass (logged), never to a rejection.
   */
  async sendUserMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.onDoneCb();
      return;
    }
    const thread = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.append({ kind: "user", text: trimmed, thread, at: Date.now() });

    let reason: GroupSettleReason = "all_passed";
    try {
      reason = await this.runRounds(thread);
    } catch (error) {
      // Engine-level failure (should not happen — member turns catch their
      // own errors). Log and settle; the room stays usable.
      console.warn("[group-driver] rounds aborted:", error);
      reason = `error:${shortReason(error)}`;
    } finally {
      this.onTurnChangeCb?.(null);
      this.onSettledCb?.(reason);
      this.onDoneCb();
    }
  }

  /** plugin.js runGroupChatRounds: ≤3 rounds, ≤10 member messages, a round
   *  with no voices settles the conversation. Returns the settle reason. */
  private async runRounds(thread: string): Promise<GroupSettleReason> {
    const profiles = await this.resolveLocalProfiles();
    const members = this.localMembers(profiles);
    let posted = 0;
    let lastError: string | null = null;

    for (let round = 0; round < GROUP_CHAT_MAX_ROUNDS; round++) {
      const roomLog = this.room.log.filter((e) => e.thread === thread);
      const responders = rotateGroupSpeakers(resolveGroupResponders(roomLog, members), round);
      let spokeThisRound = 0;

      for (const member of responders) {
        if (posted >= GROUP_CHAT_MAX_MESSAGES) break;

        const markKey = `${thread}::${memberKey(member)}`;
        const seen = this.watermarks.get(markKey) ?? 0;
        // Delta: NEW room entries, narrowed to this thread.
        const delta = this.room.log.slice(seen).filter((e) => e.thread === thread);
        if (!delta.length) continue;

        const prompt = buildGroupChatTurnPrompt({
          groupName: this.room.name,
          members,
          viewer: member,
          deltaLines: delta
            .slice(-GROUP_CHAT_HISTORY_LIMIT)
            .map((e) => formatGroupChatLine(e, member)),
          localProfiles: profiles,
        });

        this.onTurnChangeCb?.(member.handle || member.name);
        let reply: string | null = null;
        try {
          reply = await this.runMemberTurn(member, prompt);
        } catch (error) {
          // A failed turn is a pass, never a room error.
          console.warn(`[group-driver] turn failed for ${member.name}:`, error);
          lastError = shortReason(error);
          reply = null;
        } finally {
          this.onTurnChangeCb?.(null);
        }

        // The member has now seen everything up to the current log length.
        this.watermarks.set(markKey, this.room.log.length);

        if (reply !== null && !isGroupPassText(reply)) {
          this.append({
            kind: "member",
            name: member.handle || member.name,
            text: reply,
            thread,
            at: Date.now(),
          });
          // Its own message counts as seen too.
          this.watermarks.set(markKey, this.room.log.length);
          posted += 1;
          spokeThisRound += 1;
        }
      }

      if (spokeThisRound === 0) break; // everyone passed — settled
    }

    if (posted > 0) return "replied";
    if (lastError) return `error:${lastError}`;
    return "all_passed";
  }

  /** plugin.js ensureGroupChatSession: resume the member's per-room session by
   *  its immutable title `Group: <roomId>`; only a genuine 4007 (not found)
   *  falls through to session.create {title, hidden:true}. Any other error
   *  fails CLOSED (throw) so a transient blip never forks the history.
   *
   *  Returns BOTH ids like the Desktop does (`{runtime, stored}`): the live
   *  runtime id accepts prompt.submit, but session.resume/delete resolve by
   *  the durable stored id (`res.session_key`, else the title lookup) —
   *  resuming by runtime id is a 4007. */
  private async ensureGroupChatSession(
    member: GroupMember,
  ): Promise<{ runtime: string; stored: string | null }> {
    const title = groupSessionTitle(this.room.roomId);
    try {
      const res = await this.client.rpc<ResumeLike>("session.resume", {
        session_id: title,
        profile: member.name,
        omit_messages: true,
      });
      if (res?.session_id) {
        return { runtime: res.session_id, stored: res.session_key ?? title };
      }
    } catch (error) {
      // Structural code check (NOT instanceof RpcError) — mirrors plugin.js
      // `error?.code !== 4007` and stays correct even when the caller's
      // client instance comes from a different bundle/realm.
      if ((error as { code?: unknown })?.code !== 4007) throw error;
      /* genuinely doesn't exist — fall through to create */
    }
    const created = await this.client.rpc<ResumeLike>("session.create", {
      profile: member.name,
      title,
      hidden: true,
    });
    if (!created?.session_id) throw new Error("session.create returned no session_id");
    return {
      runtime: created.session_id,
      stored: created.session_key ?? created.stored_session_id ?? null,
    };
  }

  /** plugin.js submitGroupTurnPrompt: submit on the live runtime; when the
   *  runtime was reaped between minting and submitting (session-gone codes)
   *  resume the stored row for a fresh runtime and resubmit once. */
  private async submitGroupTurnPrompt(
    member: GroupMember,
    runtime: string,
    stored: string | null,
    text: string,
  ): Promise<string> {
    try {
      await this.client.rpc("prompt.submit", { session_id: runtime, text });
      return runtime;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if ((code !== 4001 && code !== 4007) || !stored) throw error;
      const res = await this.client.rpc<ResumeLike>("session.resume", {
        session_id: stored,
        profile: member.name,
        omit_messages: true,
      });
      const fresh = res?.session_id;
      if (!fresh) throw error;
      await this.client.rpc("prompt.submit", { session_id: fresh, text });
      return fresh;
    }
  }

  /** One member turn: ensure session → baseline count → prompt.submit → poll
   *  session.resume every 2s until a NEW assistant message lands and the
   *  session is idle (!inflight && !running). 180s base timeout, extended
   *  while the session is visibly working, capped at 20min (7539-7594).
   *  Returns the trimmed reply text, or null on timeout/no message. */
  private async runMemberTurn(member: GroupMember, prompt: string): Promise<string | null> {
    const { runtime, stored } = await this.ensureGroupChatSession(member);

    // Baseline: how many messages exist before our submit. Resume targets the
    // STORED id (the runtime id is a 4007 on resume — verified live).
    let before = 0;
    try {
      const pre = await this.client.rpc<ResumeLike>("session.resume", {
        session_id: stored || runtime,
        profile: member.name,
      });
      before = Array.isArray(pre?.messages) ? pre.messages.length : 0;
    } catch {
      /* lazy session — zero messages */
    }

    const liveRuntime = await this.submitGroupTurnPrompt(member, runtime, stored, prompt);

    const started = Date.now();
    let deadline = started + GROUP_TURN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(GROUP_TURN_POLL_MS);

      let state: ResumeLike | null = null;
      try {
        state = await this.client.rpc<ResumeLike>("session.resume", {
          session_id: stored || liveRuntime,
          profile: member.name,
        });
      } catch {
        continue;
      }

      const messages = Array.isArray(state?.messages) ? state.messages : [];
      const busy = Boolean(state?.inflight || state?.running);

      if (messages.length > before && !busy) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as { role?: unknown };
          if (msg?.role === "assistant") {
            return messageText(msg).trim() || null;
          }
        }
        return null;
      }

      // Still visibly working — extend the deadline (never past the hard cap).
      if (busy) {
        deadline = Math.min(
          started + GROUP_TURN_HARD_CAP_MS,
          Math.max(deadline, Date.now() + GROUP_TURN_TIMEOUT_MS),
        );
      }
    }

    return null; // timed out — treated as a pass by the caller
  }
}
