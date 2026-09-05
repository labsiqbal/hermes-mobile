/**
 * Bots.tsx — Bot Mode roster screen (design/index.html layar 04).
 *
 * Membaca seluruh roster profil melalui `profiles.list`, sama seperti Desktop,
 * lalu merender nama, @handle, preview terbaru, dan status tiap bot.
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
  botPreview,
  botStatus,
  botTint,
  botTitle,
  sortRoster,
  type BotStatus,
} from "./bots-utils";
import { ChevronRightIcon } from "../components/icons";

const ROSTER_POLL_MS = 5_000;

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
  onOpenChat: (sessionId: string, profile: string, unpersisted?: boolean) => void;
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
      let unpersisted = false;
      if (!sessionId) {
        const existing = await client.sessionFindBotChat(profile.name);
        sessionId = existing?.resolved_id || existing?.id || "";
      }
      if (!sessionId) {
        const created = await client.sessionCreateBotChat(profile.name);
        sessionId = created.stored_session_id || created.session_key || created.session_id;
        unpersisted = true;
      }
      onOpenChat(sessionId, profile.name, unpersisted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(null);
    }
  }

  // Desktop menganggap setiap profil sebagai agent roster; metadata bot hanya
  // mengubah identitas/tampilan, bukan menentukan keanggotaan.
  const bots = sortRoster(profiles ?? [], now);

  if (!client) {
    return (
      <div className="screen">
        <div className="body" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
            No active gateway connection — connect a device first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="body flat-list">
        {error && <div className="error-line">{error}</div>}

        {profiles !== null && bots.length > 0 && (
          <>
            <div className="section-label">This device · {conn?.label ?? client.url}</div>

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
              The roster is read from this gateway's <span className="mono">profiles.list</span>. An
              offline bot = fail-fast; tasks are not queued.
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
              No profiles found on this gateway.
            </div>
          </div>
        )}

        {profiles === null && !error && <div className="hint">Loading roster…</div>}
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
  const title = botTitle(bot);
  const preview = botPreview(bot);
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
        <div className="rowcard-title">{title}</div>
        <div className="rowcard-sub">
          {opening ? "Opening Bot Chat…" : `@${handle}${preview ? ` · ${preview}` : ""}`}
        </div>
      </div>
      <span className="chevron">
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}
