import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from "react";
import "./chat-view.css";
import { acceptLiveEvent, allowSmoothAutoScroll, freshHistoryMessages, historyMessageKey, preservedScrollTop, resumeCatchupEvents, shouldFetchSessionHistory } from "./chat-resume-utils";
import Header from "../components/Header";
import { MessageContent } from "../components/MessageContent";
import { ArrowUpIcon, ChevronDownIcon, FileIcon, ImageIcon, PlusIcon, SearchIcon, StopIcon, XIcon } from "../components/icons";
import {
  clearSessionEvents,
  getSessionEvents,
  linkSessionAliases,
} from "../lib/active-sessions";
import { BOT_CHAT_TITLE } from "../lib/hermes-client";
import type {
  ApprovalRequest,
  ConnectionState,
  GatewayEvent,
  HermesConnection,
  ModelOptions,
  ProfileSummary,
  SavedConnection,
  SessionInfo,
  SessionSummary,
} from "../lib/hermes-client";
import { botHandle, botInitials, botTint, isBotManaged } from "./bots-utils";
import { GroupDriver } from "../lib/group-driver";
import type { GroupLogEntry, GroupRoom } from "../lib/group-store";

// ── group room loading (Desktop-compatible registry) ───────────────────────
// The registry envelope lives at the default profile's
// ui_meta['hermes-bots-groups'] (group-store.ts). Prefer the store's
// readGroupRegistry util when the sibling agent has landed it; otherwise fall
// back to reading ui_meta inline — same pattern as the rooms-store glob above.
const groupStoreModules = import.meta.glob<Record<string, unknown>>("../lib/group-store.ts", {
  eager: true,
});

async function loadGroupRoom(client: HermesConnection, roomId: string): Promise<GroupRoom | null> {
  const key = `id:${roomId}`;
  // Preferred path: shared util (signature: (client) => Promise<GroupRegistry-like>).
  const reader = groupStoreModules["../lib/group-store.ts"]?.readGroupRegistry;
  if (typeof reader === "function") {
    try {
      const registry = (await (reader as (c: HermesConnection) => Promise<{ rooms?: Record<string, GroupRoom> }>)(client)) ?? {};
      const room = registry.rooms?.[key];
      if (room) return room;
    } catch {
      /* fall through to the inline read */
    }
  }
  // Inline fallback: default profile ui_meta['hermes-bots-groups'].
  const profiles = await client.profilesList({ includeSessions: false });
  const primary = profiles.find((p) => p.is_default) ?? profiles.find((p) => p.name === "default");
  const envelope = primary?.ui_meta?.["hermes-bots-groups"];
  if (!envelope || typeof envelope !== "object") return null;
  const rooms = (envelope as { rooms?: Record<string, GroupRoom> }).rooms;
  return rooms?.[key] ?? null;
}

/** Timeline items for one group room log entry. */
function groupEntryItems(entry: GroupLogEntry, entering = false): TimelineItem[] {
  if (entry.kind === "user") {
    return [{ kind: "user", id: nextItemId(), text: entry.text, entering }];
  }
  if (entry.kind === "member") {
    return [
      { kind: "member", id: nextItemId(), handle: entry.name || "bot", text: entry.text, entering },
    ];
  }
  return []; // system entries are not rendered in v1
}

// ── room awareness (Bot Rooms) ──────────────────────────────────────────────
// Defensive integration: src/lib/rooms-store.ts is owned by another agent and
// may not exist yet. A glob (not a literal import) plus a local structural
// Room type keeps `tsc`/vite green either way — same pattern as the Bots
// screen wiring in App.tsx. The store itself degrades corrupt/foreign
// payloads to empty, so a missing room mapping always reads as a plain chat.
/** Structural mirror of Room in ../lib/rooms-store.ts (kept in sync). */
interface Room {
  id: string;
  name: string;
  members: string[];
  sessionId: string;
  createdAt: number;
}
interface RoomStoreLike {
  getBySessionId(sessionId: string): Room | undefined;
}
const roomStoreModules = import.meta.glob<{ RoomStore?: new () => RoomStoreLike }>(
  "../lib/rooms-store.ts",
  { eager: true },
);
const roomStore: RoomStoreLike | null = (() => {
  try {
    const mod = roomStoreModules["../lib/rooms-store.ts"];
    return mod?.RoomStore ? new mod.RoomStore() : null;
  } catch {
    return null;
  }
})();

/** The room backing this session, or null for a plain (non-room) chat. */
function roomForSession(sessionId: string): Room | null {
  if (!sessionId || !roomStore) return null;
  try {
    return roomStore.getBySessionId(sessionId) ?? null;
  } catch {
    return null;
  }
}

type ToolStatus = "running" | "done" | "error";

/** A file staged on the gateway, consumed by the next prompt.submit. */
type Attachment = { kind: "image" | "file"; name: string; path: string };

type TimelineItem =
  | { kind: "user"; id: string; text: string; entering?: boolean }
  | { kind: "bot"; id: string; text: string; streaming: boolean; entering?: boolean; instant?: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      context: string;
      status: ToolStatus;
      summary?: string;
      duration?: number;
      entering?: boolean;
    }
  | { kind: "reply"; id: string; handle: string; text: string; entering?: boolean }
  | { kind: "member"; id: string; handle: string; text: string; entering?: boolean }
  | { kind: "notice"; id: string; text: string; entering?: boolean }
  | { kind: "error"; id: string; text: string; entering?: boolean };

interface Props {
  conn: SavedConnection;
  client: HermesConnection;
  /** null → create a fresh session */
  session: SessionSummary | null;
  /** Group room mode: when set, the view is driven by a GroupDriver for this
   *  room (no session resume; composer sends via driver.sendUserMessage). */
  group?: { roomId: string };
  /** Live socket state — shown by the shared Header's status dot. */
  state: ConnectionState;
  onBack: () => void;
  onNewChat: () => void;
}

let itemSeq = 0;
const nextItemId = () => `i${++itemSeq}`;

function eventText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

/**
 * Extract displayable text from a history/resume message. The gateway has
 * shipped several shapes: `text` (current session.resume), `content` as a
 * plain string (older), `content`/`parts` as an array of typed blocks
 * (Anthropic/OpenAI style). Returns "" when nothing displayable exists —
 * callers must skip the message instead of rendering an empty bubble.
 */
function historyText(m: Record<string, unknown>): string {
  if (m.display_kind === "hidden") return "";
  const raw = m.display_content ?? m.text ?? m.content ?? m.parts;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") return b.text;
          if (typeof b.content === "string") return b.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Inbound bot DM marker applied server-side by the message_agent tool
 *  ("Message from 🤖 <handle> (@<handle>): …"). */
const BOT_DM_RE = /^Message from 🤖 [^\n]*?\(@([A-Za-z0-9_.-]{1,64})\):\s*/;

// ── @-mention autocomplete (Bot Chat) ───────────────────────────────────────

const HANDLE_CHAR_RE = /[A-Za-z0-9_.-]/;

interface MentionToken {
  /** index of the '@' in the text */
  start: number;
  /** caret position (one past the last handle char typed) */
  end: number;
  /** partial handle typed so far ('' right after '@') */
  query: string;
}

/** The active @-mention token ending at `caret`, or null. '@' only opens a
 *  token at the start of a word (text start or after whitespace), and the
 *  token lives only while the caret sits on handle chars right after it. */
function mentionTokenAt(text: string, caret: number): MentionToken | null {
  let i = Math.min(caret, text.length);
  while (i > 0 && HANDLE_CHAR_RE.test(text[i - 1])) i--;
  if (i === 0 || text[i - 1] !== "@") return null;
  const at = i - 1;
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  return { start: at, end: caret, query: text.slice(i, caret) };
}

/** Convert one resumed history message into timeline items (or null to skip). */
function historyItems(m: Record<string, unknown>): TimelineItem[] {
  const role = typeof m.role === "string" ? m.role : "";
  if (role === "user" || role === "assistant") {
    const text = historyText(m).trim();
    if (!text) return [];
    if (role === "user") {
      const dm = BOT_DM_RE.exec(text);
      if (dm) {
        const body = text.slice(dm[0].length).trim();
        return [
          { kind: "reply", id: nextItemId(), handle: dm[1], text: body || text },
        ];
      }
      return [{ kind: "user", id: nextItemId(), text }];
    }
    return [{ kind: "bot", id: nextItemId(), text, streaming: false }];
  }
  if (role === "tool") {
    // Tool-call records in history render as completed tool cards.
    const name = typeof m.name === "string" ? m.name : "";
    if (!name) return [];
    return [
      {
        kind: "tool",
        id: nextItemId(),
        name,
        context: typeof m.context === "string" ? m.context : "",
        status: "done",
      },
    ];
  }
  return [];
}

/**
 * Gateway deltas arrive in bursts. Reveal their accumulated text at a steady
 * cadence so a live answer reads as one stream, not a series of jumps. This
 * mirrors Proxima's chat behavior but isolates animation updates to this one
 * bubble; the timeline does not re-render every frame.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useSmoothReveal(target: string, active: boolean): string {
  const [shown, setShown] = useState(0);
  const [displayed, setDisplayed] = useState(target);
  const targetRef = useRef(target);
  const heldRef = useRef(target);
  const shownRef = useRef(0);
  const activeRef = useRef(active);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    targetRef.current = target;
    if (target) heldRef.current = target;
  }, [target]);

  useEffect(() => {
    if (active && !activeRef.current) {
      shownRef.current = 0;
      setShown(0);
    }
    activeRef.current = active;
    if (reducedMotion) return;

    let frame = 0;
    const tick = () => {
      const goal = active ? targetRef.current : heldRef.current;
      const previous = shownRef.current;
      if (previous < goal.length) {
        const remaining = goal.length - previous;
        const next = previous + Math.min(remaining, Math.max(2, Math.min(6, Math.ceil(remaining / 12))));
        shownRef.current = next;
        setDisplayed(goal);
        setShown(next);
      } else if (!active) {
        shownRef.current = 0;
        setShown(0);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, reducedMotion, target]);

  if (reducedMotion) return target;
  return active ? displayed.slice(0, shown) : shown > 0 ? displayed.slice(0, shown) : target;
}

const StreamingBotBubble = memo(function StreamingBotBubble({
  text,
  streaming,
  label,
  entering,
  instant,
}: {
  text: string;
  streaming: boolean;
  label: string;
  entering?: boolean;
  instant?: boolean;
}) {
  const revealed = useSmoothReveal(text, streaming && !instant);
  const shown = instant ? text : revealed;
  if (!shown && streaming) return null;
  return (
    <div className="botmsg">
      <div className="bubble-who">{label}</div>
      <div className={`bubble-bot${entering ? " msg-enter" : ""}`}>
        <MessageContent content={shown} />
        {streaming && <span className="stream-cursor">▍</span>}
      </div>
    </div>
  );
});

export default function ChatView({ conn, client, session, group, state, onBack, onNewChat }: Props) {
  // Apply saved font size on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hermes-mobile.font-size");
      if (saved) {
        document.documentElement.style.setProperty("--chat-font-size", `${saved}px`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const isGroup = Boolean(group?.roomId);
  const [liveSid, setLiveSid] = useState("");
  const [info, setInfo] = useState<SessionInfo | undefined>();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // History resume disembunyikan sampai cache live terlipat dan snap awal selesai.
  const [initializing, setInitializing] = useState(Boolean(session));
  const [transcriptReady, setTranscriptReady] = useState(!session);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [composerStatus, setComposerStatus] = useState("");
  const [runActionBusy, setRunActionBusy] = useState(false);
  // true between prompt submit / message.start and the first message.delta —
  // drives the iMessage-style typing indicator bubble.
  const [awaiting, setAwaiting] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [fatal, setFatal] = useState("");
  // @-mention autocomplete (Bot Chat only): roster fetched once per session,
  // `mention` is the active token ending at the composer caret.
  const [botRoster, setBotRoster] = useState<ProfileSummary[] | null>(null);
  const [mention, setMention] = useState<MentionToken | null>(null);
  // Attachments staged on the gateway (consumed on the next prompt.submit).
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Model picker (desktop parity: model.options catalog + config.set --session).
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [catalog, setCatalog] = useState<ModelOptions | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidRef = useRef("");
  const handledEventsRef = useRef(new WeakSet<GatewayEvent>());
  const resumeReplayRef = useRef<GatewayEvent[]>([]);
  const resumeHasInflightRef = useRef(false);
  const resumeRunningRef = useRef(false);
  const resumeCatchupRef = useRef(Boolean(session));
  const storedSidRef = useRef("");
  const loadedMessageCountRef = useRef(0);
  const loadedMessageKeysRef = useRef(new Set<string>());
  const profileRef = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  // Existing sessions paint once at their latest point. No smooth trip through
  // old history; only events arriving after open get live animation.
  const initialSnapPendingRef = useRef(Boolean(session));
  const bottomPinUntilRef = useRef(0);
  // Sticky-scroll: only follow the stream while the user sits near the bottom.
  const stickRef = useRef(true);
  const lastCountRef = useRef(0);
  const lastApprovalRef = useRef<ApprovalRequest | null>(null);
  const sheetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotionRef = useRef(
    typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const isBotChat = session?.title === BOT_CHAT_TITLE;
  // Room backing this session (null → plain "Bot Chat" / regular session).
  const [room, setRoom] = useState<Room | null>(() => roomForSession(session?.id ?? ""));
  useEffect(() => {
    setRoom(roomForSession(session?.id ?? ""));
  }, [session?.id]);
  // ── group room mode (prop group) ─────────────────────────────────────────
  const [groupRoom, setGroupRoom] = useState<GroupRoom | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  /** Handle of the member whose turn the driver is processing, null = idle. */
  const [groupTurn, setGroupTurn] = useState<string | null>(null);
  const groupDriverRef = useRef<GroupDriver | null>(null);
  // Room sessions keep the "Bot Chat" title, so mentions work automatically;
  // the explicit room check keeps them on even if that ever changes.
  const mentionEnabled = isBotChat || room !== null || isGroup;

  // Load the group room and start its driver. The driver's onEntry appends
  // every new log entry (user + member) to the timeline.
  useEffect(() => {
    if (!group?.roomId) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadGroupRoom(client, group.roomId);
        if (cancelled) return;
        if (!loaded) {
          setFatal("Group room not found in this gateway's registry.");
          return;
        }
        setGroupRoom(loaded);
        setItems(loaded.log.flatMap((entry) => groupEntryItems(entry)));
        groupDriverRef.current = new GroupDriver({
          client,
          room: loaded,
          onEntry: (entry) =>
            setItems((prev) => [...prev, ...groupEntryItems(entry, true)]),
          onTurnChange: (handle) => setGroupTurn(handle),
          onSettled: (reason) => {
            // One small hint at the end of the round when nobody spoke (or
            // every turn failed) — never a permanent error line.
            if (reason === "replied") return;
            const text =
              reason === "all_passed"
                ? "No member responded."
                : `Group round failed: ${reason.slice("error:".length)}`;
            setItems((prev) => [
              ...prev,
              { kind: "notice", id: nextItemId(), text, entering: true },
            ]);
          },
          onDone: () => setGroupBusy(false),
        });
      } catch (err) {
        if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      groupDriverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, group?.roomId]);

  // ── bot roster for @-mention autocomplete (fetch once, fail silent) ──────
  useEffect(() => {
    if (!mentionEnabled || isGroup) return;
    let cancelled = false;
    client
      .profilesList({ includeSessions: false })
      .then((profiles) => {
        if (!cancelled) setBotRoster(profiles.filter(isBotManaged));
      })
      .catch(() => {
        // Suggestions stay hidden; the composer works as usual.
      });
    return () => {
      cancelled = true;
    };
  }, [client, mentionEnabled, isGroup]);

  // ── open (create or resume) the session ─────────────────────────────────
  useLayoutEffect(() => {
    if (isGroup) return; // group mode is driven by GroupDriver, no session
    let cancelled = false;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    bottomPinUntilRef.current = 0;
    resumeCatchupRef.current = true;
    resumeRunningRef.current = false;
    resumeReplayRef.current = [];
    resumeHasInflightRef.current = false;
    handledEventsRef.current = new WeakSet<GatewayEvent>();
    initialSnapPendingRef.current = Boolean(session);
    sidRef.current = "";
    storedSidRef.current = "";
    loadedMessageCountRef.current = 0;
    loadedMessageKeysRef.current = new Set<string>();
    profileRef.current = "";
    setLiveSid("");
    setItems([]);
    setStreaming(false);
    setAwaiting(false);
    setApproval(null);
    setFatal("");
    setInitializing(Boolean(session));
    setTranscriptReady(!session);
    setHasOlder(false);
    setLoadingOlder(false);
    setComposerStatus("");
    (async () => {
      try {
        const opened = session
          ? await client.resumeSession(session.resolved_id || session.id, {
              omitMessages: true,
              profile: session.profile,
            })
          : await client.createSession({});
        if (cancelled) return;
        const cached = getSessionEvents(
          client,
          opened.session_id,
          client.replayGeneration,
        ) as GatewayEvent[];
        const storedSid = opened.session_key || opened.stored_session_id || session?.resolved_id || session?.id || "";
        const profile = opened.info?.profile_name || session?.profile || "";
        let rawMessages = opened.messages ?? [];
        if (shouldFetchSessionHistory(Boolean(session), storedSid, session?.unpersisted)) {
          const page = await client.sessionMessages(storedSid, { profile });
          if (cancelled) return;
          rawMessages = page.messages;
          loadedMessageCountRef.current = page.pagination.returned;
          loadedMessageKeysRef.current = new Set(
            page.messages
              .map((message) => historyMessageKey(message as Record<string, unknown>))
              .filter((key): key is string => key !== null),
          );
          setHasOlder(page.pagination.returned === page.pagination.limit);
        } else {
          loadedMessageCountRef.current = rawMessages.length;
          setHasOlder(false);
        }
        storedSidRef.current = storedSid;
        profileRef.current = profile;
        linkSessionAliases(
          conn.id,
          session?.id,
          session?.resolved_id,
          opened.stored_session_id,
          opened.session_id,
        );
        sidRef.current = opened.session_id;
        if (session) {
          initialSnapPendingRef.current = true;
          setTranscriptReady(false);
          setInitializing(true);
        }
        setLiveSid(opened.session_id);
        setInfo(opened.info);
        const seeded: TimelineItem[] = rawMessages.flatMap((m) =>
          historyItems(m as Record<string, unknown>),
        );
        const running = opened.running === true || opened.status === "streaming";
        resumeRunningRef.current = running;
        resumeReplayRef.current = cached;
        const inflightText = opened.inflight?.assistant?.trim() ?? "";
        resumeHasInflightRef.current = Boolean(inflightText);
        setItems(
          running && inflightText
            ? [
                ...seeded,
                {
                  kind: "bot",
                  id: nextItemId(),
                  text: inflightText,
                  streaming: true,
                  instant: true,
                },
              ]
            : seeded,
        );
        setStreaming(running);
        setAwaiting(running && !inflightText);
        // Catch up on an approval that fired while we were away.
        const pending = await client.pendingApprovals(opened.session_id);
        if (!cancelled && pending.length > 0) setApproval(pending[0]);
      } catch (err) {
        if (!cancelled) {
          setFatal(err instanceof Error ? err.message : String(err));
          setInitializing(false);
          initialSnapPendingRef.current = false;
          setTranscriptReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session?.id]);

  // ── mid-turn catch-up: fold cached events before first paint ─────────────
  useLayoutEffect(() => {
    if (isGroup || !liveSid) return;
    // Re-read after liveSid lands to close the capture→subscribe race. Same
    // event objects dedupe through handledEventsRef.
    const latest = getSessionEvents(
      client,
      liveSid,
      client.replayGeneration,
    ) as GatewayEvent[];
    const baseline = resumeReplayRef.current;
    const baselineSet = new Set(baseline);
    const events = resumeCatchupEvents(
      baseline,
      latest,
      resumeRunningRef.current,
    ).filter(
      (event) =>
        !resumeHasInflightRef.current ||
        !baselineSet.has(event) ||
        (event.type !== "message.start" && event.type !== "message.delta"),
    );
    resumeReplayRef.current = [];
    for (const event of events) {
      if (handledEventsRef.current.has(event)) continue;
      handleGatewayEvent(event, true);
      handledEventsRef.current.add(event);
    }
    clearSessionEvents(client, liveSid, client.replayGeneration);
    resumeCatchupRef.current = false;
    setInitializing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSid, isGroup]);

  // ── gateway event stream ────────────────────────────────────────────────
  const handleGatewayEvent = useCallback((event: GatewayEvent, replay = false) => {
    const sid = sidRef.current;
    if (!sid || (event.session_id && event.session_id !== sid)) return;
    const p = event.payload as Record<string, unknown> | undefined;

    switch (event.type) {
      case "session.info": {
        // A landed model/reasoning switch (or deferred mid-turn switch)
        // publishes fresh session info — keep the pill honest.
        if (p && typeof p === "object") setInfo((prev) => ({ ...prev, ...(p as SessionInfo) }));
        break;
      }
      case "message.start":
        setStreaming(true);
        setAwaiting(true);
        break;
      case "message.delta":
        setAwaiting(false);
        setItems((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind === "bot" && item.streaming) {
              next[i] = { ...item, text: item.text + eventText(event.payload) };
              return next;
            }
          }
          return [
            ...next,
            {
              kind: "bot",
              id: nextItemId(),
              text: eventText(event.payload),
              streaming: true,
              entering: !replay,
              instant: replay,
            },
          ];
        });
        break;
      case "message.complete": {
        setStreaming(false);
        setAwaiting(false);
        const text = eventText(event.payload);
        const status = typeof p?.status === "string" ? p.status : "";
        setItems((prev) => {
          const next = [...prev];
          let completed = false;
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind === "bot" && item.streaming) {
              next[i] = {
                ...item,
                text: text || item.text,
                streaming: false,
              };
              completed = true;
              break;
            }
          }
          if (!completed && text) {
            next.push({
              kind: status === "error" ? "error" : "bot",
              id: nextItemId(),
              text,
              streaming: false,
              entering: !replay,
              instant: replay,
            } as TimelineItem);
          }
          return next;
        });
        break;
      }
      case "tool.start":
        setAwaiting(false);
        setStreaming(true);
        setItems((prev) => [
          ...prev,
          {
            kind: "tool",
            id: String(p?.tool_id ?? nextItemId()),
            name: String(p?.name ?? "tool"),
            context: String(p?.context ?? ""),
            status: "running",
            entering: !replay,
          },
        ]);
        break;
      case "tool.complete":
        // Tool finished but turn is still open: agent returns to reasoning until
        // another tool or response delta says otherwise.
        setAwaiting(true);
        setItems((prev) => {
          const id = String(p?.tool_id ?? "");
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind === "tool" && item.id === id) {
              next[i] = {
                ...item,
                status: "done",
                summary: typeof p?.summary === "string" ? p.summary : undefined,
                duration: typeof p?.duration_s === "number" ? p.duration_s : undefined,
              };
              return next;
            }
          }
          return [
            ...next,
            {
              kind: "tool",
              id: id || nextItemId(),
              name: String(p?.name ?? "tool"),
              context: String(p?.summary ?? ""),
              status: "done",
              entering: !replay,
            },
          ];
        });
        break;
      case "bot.reply":
      case "bot_reply":
      case "relay.reply": {
        const handle = String(
          p?.handle ?? p?.from_handle ?? p?.from ?? p?.sender ?? "",
        ).replace(/^@/, "");
        const text = String(p?.text ?? p?.reply ?? p?.message ?? p?.body ?? "");
        if (!text) break;
        setItems((prev) => [
          ...prev,
          {
            kind: "reply",
            id: nextItemId(),
            handle: handle || "bot",
            text,
            entering: true,
          },
        ]);
        break;
      }
      case "approval.request":
        if (sheetTimerRef.current) {
          clearTimeout(sheetTimerRef.current);
          sheetTimerRef.current = null;
        }
        setSheetClosing(false);
        setApproval((p as ApprovalRequest) ?? {});
        break;
      case "error":
        setStreaming(false);
        setAwaiting(false);
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            id: nextItemId(),
            text: String(p?.message ?? "unknown error"),
            entering: true,
          } as TimelineItem,
        ]);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (isGroup) return;
    return client.addEventHandler((event) => {
      const sid = sidRef.current;
      if (
        !sid ||
        event.session_id !== sid ||
        handledEventsRef.current.has(event) ||
        !acceptLiveEvent(resumeCatchupRef.current)
      ) return;
      handleGatewayEvent(event);
      handledEventsRef.current.add(event);
    });
  }, [client, isGroup, handleGatewayEvent]);

  // Resumed sessions start at latest state before paint. useLayoutEffect avoids
  // showing the top of history and then visibly travelling through it.
  useLayoutEffect(() => {
    if (initializing || !initialSnapPendingRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    lastCountRef.current = items.length;
    setStuck(false);
    initialSnapPendingRef.current = false;
    bottomPinUntilRef.current = performance.now() + 350;
    setTranscriptReady(true);
    const pin = () => {
      const body = bodyRef.current;
      if (!body || performance.now() >= bottomPinUntilRef.current) return;
      body.scrollTop = body.scrollHeight;
      settleTimerRef.current = setTimeout(pin, 50);
    };
    settleTimerRef.current = setTimeout(pin, 50);
  }, [initializing, items.length]);

  // Pulihkan viewport tepat setelah baris lama ditambahkan di atas.
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = bodyRef.current;
    if (!anchor || !el) return;
    el.scrollTop = preservedScrollTop(anchor.height, anchor.top, el.scrollHeight);
    prependAnchorRef.current = null;
  }, [items]);

  // autoscroll — sticky: follow LIVE updates only while the user is near the
  // bottom (±80px). Initial resume is handled synchronously above.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const grew = items.length !== lastCountRef.current;
    lastCountRef.current = items.length;
    if (!stickRef.current || initializing || initialSnapPendingRef.current) return;
    const smooth =
      performance.now() >= bottomPinUntilRef.current &&
      allowSmoothAutoScroll(
        initializing,
        initialSnapPendingRef.current,
        grew,
        reduceMotionRef.current,
      );
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [items, approval, initializing]);

  function handleBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    setStuck(!near);
  }

  function jumpToBottom() {
    const el = bodyRef.current;
    if (!el) return;
    stickRef.current = true;
    setStuck(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotionRef.current ? "auto" : "smooth" });
  }

  useEffect(() => {
    return () => {
      if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  function trackMention(el: HTMLTextAreaElement) {
    setMention(mentionEnabled ? mentionTokenAt(el.value, el.selectionStart ?? el.value.length) : null);
  }

  // Auto-grow: textarea follows content up to 5 lines, then scrolls internally.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  function handleComposerChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    trackMention(e.target);
  }

  function handleComposerSelect(e: SyntheticEvent<HTMLTextAreaElement>) {
    trackMention(e.currentTarget);
  }

  /** Insert `@handle ` over the active partial token and keep typing. */
  function pickMention(handle: string) {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const token = mentionTokenAt(input, caret) ?? mention;
    if (!token) return;
    const next = `${input.slice(0, token.start)}@${handle} ${input.slice(token.end)}`;
    const nextCaret = token.start + handle.length + 2;
    setInput(next);
    setMention(null);
    // Re-focus after the controlled value lands so the caret isn't lost.
    requestAnimationFrame(() => {
      const field = inputRef.current;
      if (field) {
        field.focus();
        field.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  // ── composer attachments (gateway staging, consumed on next submit) ──────

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function handlePickedImage(file: File) {
    const sid = sidRef.current;
    if (!sid) return;
    setAttachBusy(true);
    setAttachError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const b64 = dataUrl.split(",")[1] ?? "";
      const result = await client.attachImageBytes({
        session_id: sid,
        content_base64: b64,
        filename: file.name,
      });
      if (result.attached && result.path) {
        setAttachments((prev) => [
          ...(prev ?? []),
          { kind: "image", name: result.path!.split("/").pop() ?? file.name, path: result.path! },
        ]);
      } else {
        setAttachError("Attachment was rejected by the gateway.");
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachBusy(false);
    }
  }

  async function handlePickedFile(file: File) {
    const sid = sidRef.current;
    if (!sid) return;
    setAttachBusy(true);
    setAttachError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await client.attachFile({ session_id: sid, data_url: dataUrl, name: file.name });
      if (result.attached) {
        setAttachments((prev) => [
          ...(prev ?? []),
          { kind: "file", name: result.name ?? file.name, path: result.ref_text ?? file.name },
        ]);
        // Append the @file: ref so the agent's prompt carries the pointer.
        if (result.ref_text) {
          setInput((prev) => (prev ? `${prev} ${result.ref_text}` : result.ref_text!));
        }
      } else {
        setAttachError("Attachment was rejected by the gateway.");
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachBusy(false);
    }
  }

  async function removeAttachment(item: Attachment) {
    if (item.kind === "image") {
      try {
        await client.detachImage(sidRef.current, item.path);
      } catch {
        /* best-effort unstage; the chip leaves the composer regardless */
      }
    }
    setAttachments((prev) => (prev ?? []).filter((a) => a.path !== item.path));
  }

  // ── model picker (desktop parity: RPC model.options + config.set) ────────

  /** Models shown per provider: search hits everything; the unfiltered sheet
   *  stays short (top N per provider) so a 542-model catalog doesn't scroll
   *  for minutes. */
  const MODEL_LIST_LIMIT = 6;

  const modelRows = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return (catalog?.providers ?? [])
      .map((provider) => {
        const models = provider.models ?? [];
        const shown = q
          ? models.filter((m) => m.toLowerCase().includes(q))
          : models.slice(0, MODEL_LIST_LIMIT);
        return { provider, models: shown, hidden: models.length - shown.length };
      })
      .filter((row) => row.models.length > 0 || (q && row.hidden === 0));
  }, [catalog, modelQuery]);

  async function openModelSheet() {
    setModelSheetOpen(true);
    setModelQuery("");
    setModelError("");
    if (catalog) return; // one fetch per chat
    setCatalogBusy(true);
    try {
      setCatalog(await client.modelOptions(sidRef.current));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogBusy(false);
    }
  }

  /** Session-scoped model switch — same wire format as the desktop composer. */
  async function pickModel(provider: string, model: string) {
    setModelBusy(true);
    setModelError("");
    try {
      const result = await client.configSet(
        sidRef.current,
        "model",
        `${model} --provider ${provider} --session`,
      );
      if (result.confirm_required) {
        setModelError(result.confirm_message || "The gateway needs confirmation for this model.");
        return;
      }
      if (!result.deferred) {
        // Optimistic: paint the pick now; session.info re-syncs when it lands.
        setInfo((prev) => ({ ...prev, model, provider }));
      }
      setModelSheetOpen(false);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelBusy(false);
    }
  }

  /** Session-scoped reasoning effort (`none` disables thinking). */
  async function pickReasoning(effort: string) {
    setModelBusy(true);
    setModelError("");
    try {
      await client.configSet(sidRef.current, "reasoning", effort);
      setInfo((prev) => ({ ...prev, reasoning_effort: effort }));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelBusy(false);
    }
  }

  async function loadEarlier() {
    const el = bodyRef.current;
    const storedSid = storedSidRef.current;
    const offset = loadedMessageCountRef.current;
    if (!el || !storedSid || loadingOlder || !hasOlder) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    bottomPinUntilRef.current = 0;
    setLoadingOlder(true);
    try {
      const page = await client.sessionMessages(storedSid, {
        offset,
        profile: profileRef.current,
      });
      if (storedSidRef.current !== storedSid || loadedMessageCountRef.current !== offset) return;
      const fresh = freshHistoryMessages(
        page.messages as Record<string, unknown>[],
        loadedMessageKeysRef.current,
      );
      const older = fresh.flatMap((message) => historyItems(message));
      loadedMessageCountRef.current += page.pagination.returned;
      setHasOlder(page.pagination.returned === page.pagination.limit);
      if (older.length === 0) return;
      prependAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
      stickRef.current = false;
      setItems((prev) => [...older, ...prev]);
    } catch (err) {
      setComposerStatus(err instanceof Error ? err.message : String(err));
    } finally {
      if (storedSidRef.current === storedSid) setLoadingOlder(false);
    }
  }

  async function steer() {
    const text = input.trim();
    const sid = sidRef.current;
    if (!text || !sid || runActionBusy) return;
    setRunActionBusy(true);
    setComposerStatus("");
    setInput("");
    try {
      const result = await client.steerSession(sid, text);
      if (result.status === "rejected") throw new Error("Steer was rejected by the agent.");
      setComposerStatus("Steer queued.");
    } catch (err) {
      setInput((current) => (current ? `${text}\n${current}` : text));
      setComposerStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRunActionBusy(false);
    }
  }

  async function stop() {
    if (!sidRef.current) return;
    setComposerStatus("");
    try {
      await client.interruptSession(sidRef.current);
    } catch (err) {
      setComposerStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (streaming && !isGroup) {
      await steer();
      return;
    }
    // Group mode: the driver appends the user entry (new thread) and every
    // member reply lands through its onEntry callback.
    if (isGroup) {
      const driver = groupDriverRef.current;
      if (!driver || groupBusy) return;
      setInput("");
      setMention(null);
      stickRef.current = true;
      setGroupBusy(true);
      void driver.sendUserMessage(text);
      return;
    }
    const sid = sidRef.current;
    if (!sid) return;
    setInput("");
    setMention(null);
    // Attachments staged on the gateway are consumed by this submit.
    setAttachments(null);
    stickRef.current = true; // the sender wants to see their own message
    setItems((prev) => [...prev, { kind: "user", id: nextItemId(), text, entering: true }]);
    setStreaming(true);
    setAwaiting(true);
    try {
      await client.submitPrompt(sid, text);
    } catch (err) {
      setStreaming(false);
      setAwaiting(false);
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          id: nextItemId(),
          text: err instanceof Error ? err.message : String(err),
          entering: true,
        },
      ]);
    }
  }

  async function answerApproval(choice: string) {
    const current = approval;
    setApproval(null);
    if (current) {
      // Keep the sheet mounted for a symmetric exit animation.
      setSheetClosing(true);
      if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
      sheetTimerRef.current = setTimeout(() => {
        sheetTimerRef.current = null;
        setSheetClosing(false);
        lastApprovalRef.current = null;
      }, 340);
    }
    try {
      await client.respondApproval(sidRef.current, choice, current?.request_id);
    } catch (err) {
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          id: nextItemId(),
          text: err instanceof Error ? err.message : String(err),
          entering: true,
        },
      ]);
    }
  }

  // Unified-header subtitle: model chip folded into the context line —
  // `model · profile · device`, same shape on every chat.
  const chatSubtitle = [
    info?.model?.split("/").pop(),
    info?.profile_name,
    conn.label,
  ]
    .filter(Boolean)
    .join(" · ");

  // Small mono sender label above bot bubbles (mockup 03/06: "hermes · default").
  const botLabel = `hermes · ${info?.profile_name || "default"}`;

  // Suggestions for the active @-mention token; prefix match on the handle.
  // Group mode suggests room members, Bot Chat the gateway roster.
  const mentionSuggestions: { key: string; handle: string; desc: string }[] = mention
    ? isGroup
      ? (groupRoom?.members ?? [])
          .map((m) => ({
            key: m.name,
            handle: (m.handle || m.name).replace(/^@/, ""),
            desc: m.connectionLabel || "",
          }))
          .filter((s) => s.handle.toLowerCase().startsWith(mention.query.toLowerCase()))
      : (botRoster ?? [])
          .filter((p) => botHandle(p).toLowerCase().startsWith(mention.query.toLowerCase()))
          .map((p) => ({
            key: p.name,
            handle: botHandle(p),
            desc: p.description || p.display_name || "",
          }))
    : [];

  // During the close animation the sheet keeps rendering the last request.
  if (approval) lastApprovalRef.current = approval;
  const shownApproval = approval ?? (sheetClosing ? lastApprovalRef.current : null);

  // Group presentation: an explicit group room (prop) uses its registry
  // member list; an explicit Bot Room uses its stored member list; the
  // canonical per-profile "Bot Chat" (Desktop parity — one group chat per
  // profile) treats every bot-managed profile as a member.
  const groupMembers: string[] | null = isGroup
    ? (groupRoom?.members.map((m) => m.handle || m.name) ?? null)
    : room
      ? room.members
      : isBotChat && botRoster && botRoster.length > 0
        ? botRoster.map((p) => botHandle(p))
        : null;

  // ── timeline render: consecutive tool rows group into one tight stack so
  // the 12px body gap doesn't spread them (Claude-style activity log). ─────
  const timeline: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "tool") {
      const rows: ReactNode[] = [];
      let anyEntering = false;
      let firstId = "";
      for (; i < items.length && items[i].kind === "tool"; i++) {
        const t = items[i] as Extract<TimelineItem, { kind: "tool" }>;
        if (!firstId) firstId = t.id;
        anyEntering ||= Boolean(t.entering);
        rows.push(
          <div key={t.id} className="toolcard">
            <span className={`toolcard-dot ${t.status}`} />
            <span className="mono toolcard-name">
              {t.status === "running" ? `Working · ${t.name}` : t.name}
            </span>
            {t.duration !== undefined && (
              <span className="rowcard-meta">{t.duration.toFixed(1)}s</span>
            )}
          </div>,
        );
      }
      i--; // the loop increment moves past the last tool row
      if (rows.length > 0) {
        timeline.push(
          <div key={`ts-${firstId}`} className={`toolstack${anyEntering ? " msg-enter" : ""}`}>
            {rows}
          </div>,
        );
      }
      continue;
    }
    switch (item.kind) {
      case "user":
        timeline.push(
          <div key={item.id} className={`bubble-user${item.entering ? " msg-enter" : ""}`}>
            {item.text}
          </div>,
        );
        break;
      case "bot":
        timeline.push(
          <StreamingBotBubble
            key={item.id}
            text={item.text}
            streaming={item.streaming}
            label={botLabel}
            entering={item.entering}
            instant={item.instant}
          />,
        );
        break;
      case "member": {
        // Group room message: Telegram-style left message, sender label in a
        // deterministic botTint per handle.
        const tint = botTint(item.handle);
        timeline.push(
          <div key={item.id} className="botmsg">
            <div className="bubble-who" style={{ color: tint.fg }}>
              @{item.handle}
            </div>
            <div className={`bubble-bot${item.entering ? " msg-enter" : ""}`}>
              <MessageContent content={item.text} />
            </div>
          </div>,
        );
        break;
      }
      case "reply": {
        // Group-chat style: sender handle tinted per bot.
        const tint = botTint(item.handle);
        timeline.push(
          <div key={item.id} className={`replycard${item.entering ? " msg-enter" : ""}`}>
            <div className="replycard-head">
              <span>↩</span>
              <span>
                Reply dari{" "}
                <span className="replycard-handle" style={{ color: tint.fg }}>
                  @{item.handle}
                </span>
              </span>
            </div>
            <div className="replycard-body">
              <MessageContent content={item.text} />
            </div>
          </div>,
        );
        break;
      }
      case "notice":
        timeline.push(
          <div key={item.id} className={`hint${item.entering ? " msg-enter" : ""}`}>
            {item.text}
          </div>,
        );
        break;
      case "error":
        timeline.push(
          <div key={item.id} className={`errorcard${item.entering ? " msg-enter" : ""}`}>
            <span className="error-line">{item.text}</span>
          </div>,
        );
        break;
    }
  }

  return (
    <div className="screen chat-view">
      <Header
        title={isGroup ? groupRoom?.name || "Group" : room ? room.name : session?.title || "New chat"}
        subtitle={chatSubtitle}
        state={state}
        onBack={onBack}
        right={
          <button className="iconbtn" onClick={onNewChat} aria-label="New chat" title="New chat">
            <PlusIcon size={16} />
          </button>
        }
      />

      {groupMembers && (
        <div className="memberstrip" aria-label="Room members">
          {groupMembers.map((member) => {
            const handle = member.replace(/^@/, "");
            const tint = botTint(handle);
            return (
              <span key={handle} className="memberchip">
                <span className="memberchip-dot" style={{ background: tint.fg }} />
                <span className="memberchip-handle" style={{ color: tint.fg }}>
                  @{handle}
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div
        className={`body${transcriptReady ? "" : " transcript-hidden"}`}
        ref={bodyRef}
        onScroll={handleBodyScroll}
      >
        {hasOlder && (
          <button type="button" className="load-earlier" disabled={loadingOlder} onClick={() => void loadEarlier()}>
            {loadingOlder ? "Loading…" : "Load earlier"}
          </button>
        )}
        {fatal && <div className="error-line">{fatal}</div>}
        {timeline}
        {awaiting && (
          <div className={`typing-bubble${initializing ? "" : " msg-enter"}`} aria-label="Agent is thinking">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-label">Thinking…</span>
          </div>
        )}
        {isGroup && groupTurn && (
          <div className="botmsg">
            <div className="bubble-who" style={{ color: botTint(groupTurn).fg }}>
              @{groupTurn} sedang mengetik…
            </div>
            <div className="typing-bubble msg-enter" aria-label={`@${groupTurn} is typing`}>
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        {!fatal && items.length === 0 && !awaiting && !groupTurn && (
          <div className="hint">
            {isGroup
              ? groupRoom
                ? "Start the conversation — leave out the mention to address all members."
                : "Loading room…"
              : liveSid
                ? "Say something — the agent runs on " + conn.label + "."
                : "Opening session…"}
          </div>
        )}
      </div>

      {stuck && !approval && (
        <button type="button" className="jump-btn" aria-label="Scroll to bottom" onClick={jumpToBottom}>
          ↓
        </button>
      )}

      {mentionSuggestions.length > 0 && (
        <div className="mentionbar" role="listbox" aria-label="Mention a bot">
          {mentionSuggestions.map((suggestion) => {
            const tint = botTint(suggestion.handle);
            return (
              <button
                key={suggestion.key}
                type="button"
                role="option"
                aria-selected="false"
                className="mentionchip"
                // pointerdown (not click) + preventDefault keeps composer
                // focus so the soft keyboard never dismisses.
                onPointerDown={(e) => {
                  e.preventDefault();
                  pickMention(suggestion.handle);
                }}
              >
                <span
                  className="mentionchip-avatar"
                  style={{ background: tint.bg, color: tint.fg }}
                >
                  {botInitials(suggestion.handle)}
                </span>
                <span className="mentionchip-handle">@{suggestion.handle}</span>
                {suggestion.desc && <span className="mentionchip-desc">{suggestion.desc}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="composer-wrap">
        {composerStatus && (
          <div className="composer-status" role="status">{composerStatus}</div>
        )}
        {attachError && (
          <div className="error-line" style={{ marginBottom: 6 }}>{attachError}</div>
        )}
        {attachments && attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((item) => (
              <span key={item.path} className="attach-chip">
                {item.kind === "image" ? <ImageIcon size={12} /> : <FileIcon size={12} />}
                <span className="attach-chip-name">{item.name}</span>
                <button
                  type="button"
                  className="attach-chip-x"
                  onClick={() => void removeAttachment(item)}
                  aria-label={`Remove ${item.name}`}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachMenuOpen && !isGroup && (
          <div className="attach-menu" role="menu">
            <button
              type="button"
              className="attach-menu-item"
              disabled={attachBusy}
              onClick={() => {
                setAttachMenuOpen(false);
                imageInputRef.current?.click();
              }}
            >
              <ImageIcon size={16} /> Image…
            </button>
            <button
              type="button"
              className="attach-menu-item"
              disabled={attachBusy}
              onClick={() => {
                setAttachMenuOpen(false);
                fileInputRef.current?.click();
              }}
            >
              <FileIcon size={16} /> File…
            </button>
          </div>
        )}
        <div className="composer-pill">
          {!isGroup && (
            <button
              type="button"
              className="composer-plus"
              disabled={!liveSid || attachBusy}
              onClick={() => setAttachMenuOpen((v) => !v)}
              aria-label="Attach"
              title="Attach"
            >
              {attachBusy ? "…" : <PlusIcon size={18} />}
            </button>
          )}
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder={
              isGroup
                ? groupRoom
                  ? "Message the group…"
                  : "Loading room…"
                : streaming
                  ? "Steer this run…"
                  : liveSid
                    ? room
                      ? "Message the room…"
                      : "Message…"
                    : "Opening session…"
            }
            value={input}
            disabled={isGroup ? !groupRoom : !liveSid}
            onChange={handleComposerChange}
            onSelect={handleComposerSelect}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            onFocus={() => setAttachMenuOpen(false)}
          />
          {streaming && !isGroup && input.trim() && (
            <button
              className="composer-action composer-send"
              disabled={runActionBusy}
              title="Steer"
              aria-label="Steer active run"
              onClick={() => void steer()}
            >
              <ArrowUpIcon size={18} />
            </button>
          )}
          {streaming && !isGroup ? (
            <button
              className="composer-action composer-stop"
              disabled={runActionBusy}
              title="Stop"
              aria-label="Stop active run"
              onClick={() => void stop()}
            >
              <StopIcon size={16} />
            </button>
          ) : (
            <button
              className="composer-action composer-send"
              disabled={
                isGroup ? !groupRoom || groupBusy || !input.trim() : !liveSid || !input.trim()
              }
              onClick={() => void send()}
            >
              <ArrowUpIcon size={18} />
            </button>
          )}
        </div>
        {!isGroup && liveSid && (
          <div className="model-row model-row-below">
            <button type="button" className="model-pill" onClick={() => void openModelSheet()}>
              <span className="model-pill-name">
                {(info?.model || catalog?.model || "model").split("/").pop()}
                {info?.reasoning_effort && info.reasoning_effort !== "none"
                  ? ` · ${info.reasoning_effort.slice(0, 1).toUpperCase()}${info.reasoning_effort.slice(1, 3)}`
                  : ""}
              </span>
              <ChevronDownIcon size={13} />
            </button>
          </div>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handlePickedImage(file);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handlePickedFile(file);
          }}
        />
      </div>

      {modelSheetOpen && (
        <>
          <div className="sheet-dim" onClick={() => setModelSheetOpen(false)} />
          <div className="sheet model-sheet" role="dialog" aria-modal="true" aria-label="Model">
            <div className="sheet-grab" />
            <div className="rowcard-title">Model</div>
            {modelError && <div className="error-line" style={{ margin: "6px 0" }}>{modelError}</div>}
            {catalogBusy && <div className="hint">Loading models…</div>}
            {!catalogBusy && catalog && (
              <div className="model-sheet-body">
                <div className="search-wrap model-sheet-search">
                  <span className="search-icon">
                    <SearchIcon size={15} />
                  </span>
                  <input
                    className="field"
                    type="search"
                    placeholder="Search models…"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                  />
                </div>
                {modelRows.map(({ provider, models, hidden }) => (
                  <div key={provider.slug}>
                    <div className="section-label">{provider.name}</div>
                    {models.map((model) => {
                      const current =
                        (info?.model ?? catalog.model ?? "") === model &&
                        (info?.provider ?? catalog.provider ?? "") === provider.slug;
                      return (
                        <button
                          key={model}
                          type="button"
                          className={`model-row-btn${current ? " current" : ""}`}
                          disabled={modelBusy}
                          onClick={() => void pickModel(provider.slug, model)}
                        >
                          <span className="model-row-name">{model}</span>
                          {current && <span className="model-row-check">✓</span>}
                        </button>
                      );
                    })}
                    {hidden > 0 && !modelQuery.trim() && (
                      <div className="hint" style={{ padding: "4px 10px" }}>
                        +{hidden} more — search to find them
                      </div>
                    )}
                  </div>
                ))}
                {modelRows.length === 0 && (
                  <div className="hint" style={{ textAlign: "center" }}>
                    No models match “{modelQuery.trim()}”.
                  </div>
                )}
                <div className="section-label">Reasoning</div>
                <div className="reasoning-row">
                  {["none", "minimal", "low", "medium", "high", "max"].map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      className={`reasoning-chip${
                        (info?.reasoning_effort ?? "medium") === effort ? " current" : ""
                      }`}
                      disabled={modelBusy}
                      onClick={() => void pickReasoning(effort)}
                    >
                      {effort === "none" ? "Off" : effort}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!catalogBusy && !catalog && !modelError && (
              <div className="hint">No models available.</div>
            )}
            <button
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => setModelSheetOpen(false)}
            >
              Close
            </button>
          </div>
        </>
      )}

      {shownApproval && (
        <>
          <div
            className={`sheet-dim sheet-anim${sheetClosing ? " sheet-out" : ""}`}
            onClick={() => void answerApproval("deny")}
          />
          <div className={`sheet sheet-anim${sheetClosing ? " sheet-out" : ""}`}>
            <div className="sheet-grab" />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--amber)", fontWeight: 700 }}>!</span>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Approval needed</div>
            </div>
            <div className="rowcard-sub" style={{ marginTop: 4 }}>
              on <strong>{conn.label}</strong>
              {shownApproval.description ? ` — ${shownApproval.description}` : ""}
            </div>
            {shownApproval.command && <div className="sheet-cmd">{shownApproval.command}</div>}
            <div className="sheet-actions">
              <button className="btn btn-destructive" onClick={() => void answerApproval("deny")}>
                Deny
              </button>
              <button className="btn btn-primary" onClick={() => void answerApproval("once")}>
                Approve
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
