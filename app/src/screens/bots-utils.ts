/**
 * bots-utils.ts — pure helpers for the Bots roster screen. Mirrors the
 * Desktop hermes-bots plugin (apps/desktop/src/plugins/hermes-bots/plugin.js)
 * and relay-daemon (relay_daemon.py) semantics so every client agrees on
 * handles, the bot-managed marker, and liveness windows.
 */

import type { ProfileSummary } from "../lib/hermes-client";

export type BotStatus = "online" | "busy" | "offline";

/** A bot whose last message landed within this window reads "active now". */
export const ACTIVE_WINDOW_S = 90;
/** Kanban/tool workers heartbeat last_activity_at every ≤60s while running;
 *  a wider window bridges one missed heartbeat. */
export const WORKER_ACTIVE_WINDOW_S = 150;

/** ui_meta key the Desktop Bots pane writes for bot-managed profiles. */
export const BOTS_META_KEY = "hermes-bots";

/** Bot-managed profiles carry ui_meta['hermes-bots'] (set by the Desktop
 *  Bots pane). Other profiles exist on the gateway but aren't roster bots. */
export function isBotManaged(profile: ProfileSummary): boolean {
  const meta = profile.ui_meta;
  return Boolean(meta && typeof meta === "object" && meta[BOTS_META_KEY]);
}

/** The @handle users tag a bot with. Mirrors plugin.js botHandle() /
 *  relay_daemon._bot_handle(): an explicit distinct handle wins, else the
 *  primary profile answers to 'hermes' (the word 'default' never surfaces). */
export function botHandle(profile: ProfileSummary): string {
  const name = String(profile.name ?? "");
  const handle = String(profile.handle ?? "");
  if (handle && handle !== name) return handle;
  return name.trim().toLowerCase() === "default" ? "hermes" : name;
}

/** Bot Mode title (server-synced via ui_meta) falling back to the core
 *  profile display_name. Empty string when neither exists. */
export function botTitle(profile: ProfileSummary): string {
  const meta = profile.ui_meta?.[BOTS_META_KEY];
  const title =
    meta && typeof meta === "object"
      ? String((meta as Record<string, unknown>).title ?? "")
      : "";
  return title || String(profile.display_name ?? "");
}

/** Freshest activity timestamp (unix seconds) across the sessions that
 *  represent this bot — the canonical Bot Chat and the newest visible
 *  conversation (whichever is fresher), mirroring botActivitySession(). */
export function botActivityTs(profile: ProfileSummary): number {
  const canonical = profile.canonical_session?.last_active ?? 0;
  const last = profile.last_session?.last_active ?? 0;
  return Math.max(canonical, last);
}

/** True while the bot's freshest kanban/tool worker looks alive. */
export function workerActive(profile: ProfileSummary, nowMs = Date.now()): boolean {
  const ts = profile.worker_session?.last_active ?? 0;
  return Boolean(ts && nowMs / 1000 - ts < WORKER_ACTIVE_WINDOW_S);
}

/**
 * Roster status for one bot:
 *  - "busy"    — a message landed within ACTIVE_WINDOW_S, or a worker is live
 *  - "online"  — reachable profile with at least one session on record
 *  - "offline" — no session activity at all (never ran / retired)
 */
export function botStatus(profile: ProfileSummary, nowMs = Date.now()): BotStatus {
  const activity = botActivityTs(profile);
  if (workerActive(profile, nowMs)) return "busy";
  if (activity && nowMs / 1000 - activity < ACTIVE_WINDOW_S) return "busy";
  if (activity || profile.last_session || profile.canonical_session) return "online";
  return "offline";
}

/** Two-letter avatar initials derived from the handle. */
export function botInitials(handle: string): string {
  const clean = handle.replace(/^@/, "").trim();
  return (clean.slice(0, 2) || "?").toLowerCase();
}

/** Avatar tint per bot (design/index.html layar 04 uses a different signal
 *  tint per bot). Deterministic by handle so every client paints the same
 *  bot the same color. Only the four Signal-Tint-Rule trios — no new colors. */
export function botTint(handle: string): { bg: string; fg: string } {
  const TINTS = [
    { bg: "rgba(207,128,109,.14)", fg: "var(--warm)" },
    { bg: "rgba(79,140,255,.13)", fg: "var(--blue)" },
    { bg: "rgba(85,165,131,.13)", fg: "var(--green)" },
    { bg: "rgba(111,155,166,.13)", fg: "var(--cyan)" },
  ];
  const clean = handle.replace(/^@/, "");
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** Roster sort: busy first, then online, then offline; handle ties break
 *  alphabetically. Returns a new array. */
export function sortRoster(bots: ProfileSummary[], nowMs = Date.now()): ProfileSummary[] {
  const rank: Record<BotStatus, number> = { busy: 0, online: 1, offline: 2 };
  return [...bots].sort((a, b) => {
    const diff = rank[botStatus(a, nowMs)] - rank[botStatus(b, nowMs)];
    return diff !== 0 ? diff : botHandle(a).localeCompare(botHandle(b));
  });
}
