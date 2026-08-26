/**
 * Bots.tsx — Bot Mode roster screen (design/index.html layar 04).
 *
 * Reads the gateway's profile roster via `profiles.list` (the same RPC the
 * relay daemon uses), filters to bot-managed profiles (ui_meta['hermes-bots']),
 * and paints one row per bot: @handle, description, online/busy/offline dot.
 * Tapping a bot opens its canonical "Bot Chat" — the existing registry row
 * when one exists (fail-closed lookup), otherwise a freshly created one.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getActiveConnection,
  type HermesConnection,
  type ProfileSummary,
  type SavedConnection,
} from "../lib/hermes-client";
import {
  botHandle,
  botInitials,
  botStatus,
  botTint,
  isBotManaged,
  sortRoster,
  type BotStatus,
} from "./bots-utils";
import { ChevronRightIcon } from "../components/icons";

const ROSTER_POLL_MS = 20_000;

const DOT_CLASS: Record<BotStatus, string> = {
  online: "dot-on",
  busy: "dot-busy",
  offline: "dot-off",
};

export function BotsScreen({
  client: clientProp,
  conn,
  onOpenChat,
}: {
  /** Optional: App's integration contract mounts this screen with only
   *  `onOpenChat`, so the client falls back to the module-level active
   *  connection (hermes-client.getActiveConnection). */
  client?: HermesConnection;
  conn?: SavedConnection;
  onOpenChat: (sessionId: string) => void;
}) {
  const client = clientProp ?? getActiveConnection();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [error, setError] = useState("");
  const /** profile name whose Bot Chat is being resolved/opened */
    [opening, setOpening] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setProfiles(await client.profilesList({ includeSessions: true }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (client.connectionState === "open") void load();
    }, ROSTER_POLL_MS);
    return () => clearInterval(timer);
  }, [client, load]);

  useEffect(() => {
    if (!client) return;
    return client.addStateHandler((s) => {
      if (s === "open") void load();
    });
  }, [client, load]);

  async function openBot(profile: ProfileSummary) {
    if (!client || opening) return;
    setOpening(profile.name);
    setError("");
    try {
      // Prefer the server-resolved canonical row from the roster payload;
      // fall back to the exact-title registry lookup for older gateways
      // without canonical_session. The lookup FAILS CLOSED (throws), so a
      // transient blip can never mint a duplicate forever-chat.
      let sessionId =
        profile.canonical_session?.resolved_id || profile.canonical_session?.id || "";
      if (!sessionId) {
        const existing = await client.sessionFindBotChat(profile.name);
        sessionId = existing?.resolved_id || existing?.id || "";
      }
      if (!sessionId) {
        const created = await client.sessionCreateBotChat(profile.name);
        sessionId = created.session_id;
      }
      onOpenChat(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(null);
    }
  }

  const bots = sortRoster((profiles ?? []).filter(isBotManaged), now);

  if (!client) {
    return (
      <div className="screen">
        <div className="body" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
            Tidak ada koneksi gateway aktif — sambungkan device dulu.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="body">
        {error && <div className="error-line">{error}</div>}

        {profiles !== null && bots.length > 0 && (
          <>
            <div className="section-label">Device ini · {conn?.label ?? client.url}</div>

            {bots.map((bot) => (
              <BotRow
                key={bot.name}
                bot={bot}
                now={now}
                opening={opening === bot.name}
                disabled={opening !== null}
                onOpen={() => void openBot(bot)}
              />
            ))}
            <div style={{ flex: 1 }} />
            <div className="hint">
              Roster dibaca dari <span className="mono">profiles.list</span> gateway ini. Bot
              offline = fail-fast, tugas tidak diantrekan.
            </div>
          </>
        )}

        {profiles !== null && bots.length === 0 && !error && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <span className="chip chip-warm">bots</span>
            <div className="appbar-title" style={{ fontSize: 15 }}>
              Bot Mode
            </div>
            <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
              Belum ada bot — tambah profile bot-managed di Desktop.
            </div>
          </div>
        )}

        {profiles === null && !error && <div className="hint">Memuat roster…</div>}
      </div>
    </div>
  );
}

function BotRow({
  bot,
  now,
  opening,
  disabled,
  onOpen,
}: {
  bot: ProfileSummary;
  now: number;
  opening: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const handle = botHandle(bot);
  const status = botStatus(bot, now);
  const offline = status === "offline";
  const tint = botTint(handle);
  return (
    <button
      className="rowcard"
      style={offline ? { opacity: 0.5 } : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      <span
        className="botavatar"
        style={
          offline
            ? { background: "var(--elevated)", color: "var(--fg-faint)" }
            : { background: tint.bg, color: tint.fg }
        }
      >
        {botInitials(handle)}
        <span className={`dot ${DOT_CLASS[status]}`} />
      </span>
      <div className="rowcard-main">
        <div className="rowcard-title mono" style={{ color: "var(--cyan)", fontSize: 12 }}>
          @{handle}
        </div>
        <div className="rowcard-sub">
          {opening
            ? "membuka Bot Chat…"
            : bot.description || bot.display_name || "—"}
        </div>
      </div>
      <span className="chevron">
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}
