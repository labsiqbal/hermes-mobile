import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from "react";
import "./chat-view.css";
import Header from "../components/Header";
import { MessageContent } from "../components/MessageContent";
import { PlusIcon } from "../components/icons";
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

type TimelineItem =
  | { kind: "user"; id: string; text: string; entering?: boolean }
  | { kind: "bot"; id: string; text: string; streaming: boolean; entering?: boolean }
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
  const raw = m.text ?? m.content ?? m.parts;
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
}: {
  text: string;
  streaming: boolean;
  label: string;
  entering?: boolean;
}) {
  const shown = useSmoothReveal(text, streaming);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const sidRef = useRef("");
  const handledEventsRef = useRef(new WeakSet<GatewayEvent>());
  const bodyRef = useRef<HTMLDivElement>(null);
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
          setFatal("Group room tidak ditemukan di registry gateway ini.");
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
                ? "Tidak ada member yang merespon."
                : `Ronde group gagal: ${reason.slice("error:".length)}`;
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
  useEffect(() => {
    if (isGroup) return; // group mode is driven by GroupDriver, no session
    let cancelled = false;
    (async () => {
      try {
        let opened = session
          ? await client.resumeSession(session.resolved_id || session.id)
          : await client.createSession({});
        if (cancelled) return;
        const cached = getSessionEvents(
          client,
          opened.session_id,
          client.replayGeneration,
        );
        if (cached.some((event) => event.type === "message.complete" || event.type === "error")) {
          if (session) {
            opened = await client.resumeSession(session.resolved_id || session.id);
            if (cancelled) return;
          }
          clearSessionEvents(client, opened.session_id, client.replayGeneration);
        }
        linkSessionAliases(
          conn.id,
          session?.id,
          session?.resolved_id,
          opened.stored_session_id,
          opened.session_id,
        );
        sidRef.current = opened.session_id;
        setLiveSid(opened.session_id);
        setInfo(opened.info);
        const seeded: TimelineItem[] = (opened.messages ?? []).flatMap((m) =>
          historyItems(m as Record<string, unknown>),
        );
        setItems(seeded);
        // Catch up on an approval that fired while we were away.
        const pending = await client.pendingApprovals(opened.session_id);
        if (!cancelled && pending.length > 0) setApproval(pending[0]);
      } catch (err) {
        if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session?.id]);

  // ── mid-turn catch-up: replay events cached while this view was away ─────
  useEffect(() => {
    if (isGroup || !liveSid) return;
    const events = getSessionEvents(
      client,
      liveSid,
      client.replayGeneration,
    ) as GatewayEvent[];
    for (const event of events) {
      if (handledEventsRef.current.has(event)) continue;
      handleGatewayEvent(event);
      handledEventsRef.current.add(event);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSid, isGroup]);

  // ── gateway event stream ────────────────────────────────────────────────
  const handleGatewayEvent = useCallback((event: GatewayEvent) => {
    const sid = sidRef.current;
    if (!sid || (event.session_id && event.session_id !== sid)) return;
    const p = event.payload as Record<string, unknown> | undefined;

    switch (event.type) {
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
              entering: true,
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
              entering: true,
            } as TimelineItem);
          }
          return next;
        });
        break;
      }
      case "tool.start":
        setItems((prev) => [
          ...prev,
          {
            kind: "tool",
            id: String(p?.tool_id ?? nextItemId()),
            name: String(p?.name ?? "tool"),
            context: String(p?.context ?? ""),
            status: "running",
            entering: true,
          },
        ]);
        break;
      case "tool.complete":
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
              entering: true,
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
      if (!sid || event.session_id !== sid || handledEventsRef.current.has(event)) return;
      handleGatewayEvent(event);
      handledEventsRef.current.add(event);
    });
  }, [client, isGroup, handleGatewayEvent]);

  // autoscroll — sticky: follow the stream only while the user is near the
  // bottom (±80px). New items ease in with a smooth scroll; streaming deltas
  // jump instantly so rapid updates don't lag. Reduced motion → always auto.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const grew = items.length !== lastCountRef.current;
    lastCountRef.current = items.length;
    if (!stickRef.current) return;
    const smooth = grew && !reduceMotionRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [items, approval]);

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
    };
  }, []);

  function trackMention(el: HTMLInputElement) {
    setMention(mentionEnabled ? mentionTokenAt(el.value, el.selectionStart ?? el.value.length) : null);
  }

  function handleComposerChange(e: ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    trackMention(e.target);
  }

  function handleComposerSelect(e: SyntheticEvent<HTMLInputElement>) {
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

  async function send() {
    const text = input.trim();
    if (!text) return;
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
            <span className="mono toolcard-name">{t.name}</span>
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

      <div className="body" ref={bodyRef} onScroll={handleBodyScroll}>
        {fatal && <div className="error-line">{fatal}</div>}
        {timeline}
        {awaiting && (
          <div className="typing-bubble msg-enter" aria-label="Agent is thinking">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
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
                ? "Mulai percakapan — kosongkan mention untuk semua member."
                : "Memuat room…"
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
        <div className="composer-pill">
          <input
            ref={inputRef}
            className="composer-input"
            placeholder={
              isGroup
                ? groupRoom
                  ? "Ketik ke grup…"
                  : "Memuat room…"
                : liveSid
                  ? room
                    ? "Ketik ke room…"
                    : "Message…"
                  : "Opening session…"
            }
            value={input}
            disabled={isGroup ? !groupRoom : !liveSid}
            onChange={handleComposerChange}
            onSelect={handleComposerSelect}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          {streaming && !isGroup ? (
            <button
              className="composer-action composer-stop"
              title="Stop"
              onClick={() => void client.interruptSession(sidRef.current).catch(() => undefined)}
            >
              ■
            </button>
          ) : (
            <button
              className="composer-action composer-send"
              disabled={
                isGroup ? !groupRoom || groupBusy || !input.trim() : !liveSid || !input.trim()
              }
              onClick={() => void send()}
            >
              ↑
            </button>
          )}
        </div>
      </div>

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
