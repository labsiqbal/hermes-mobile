/**
 * Bots.tsx — Bot Mode roster screen.
 *
 * Membaca seluruh roster profil melalui `profiles.list`, sama seperti Desktop,
 * lalu merender nama, @handle, preview terbaru, dan status tiap bot.
 * Tapping a bot opens a normal private session owned by that profile.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getActiveConnection,
  type HermesConnection,
  type ProfileSummary,
  type SavedConnection,
  type SessionSummary,
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
import { Plus, MessageCircle, RefreshCw } from 'lucide-react';
import { ManagementClient, SessionReadError } from '../lib/management-client';
import { chatKey, canonicalChats, isBotThread, readBotThreads, rememberBotThread, uniqueChats } from '../lib/chat-browser';
import { formatSessionTime } from './chat-list-utils';
import AddBotDialog from '../components/AddBotDialog';

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
  selectedProfile,
  onSelectProfile,
  onOpenSession,
}: {
  /** Optional: App's integration contract mounts this screen with only
   *  `onOpenChat`, so the client falls back to the module-level active
   *  connection (hermes-client.getActiveConnection). */
  client?: HermesConnection;
  conn?: SavedConnection;
  onOpenChat: (sessionId: string, profile: string, unpersisted?: boolean) => void;
  selectedProfile?: string;
  onSelectProfile?: (profile: string) => void;
  onOpenSession?: (session: SessionSummary) => void;
}) {
  const client = clientProp ?? getActiveConnection();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const /** profile name whose private session is being opened */
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
    // oxlint-disable-next-line react/set-state-in-effect -- Initial synchronization with the gateway roster.
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
      // No title: "Bot Chat" activates the server-side Bot Mode protocol.
      // No cwd: gateway keeps its normal profile/default cwd contract.
      const created = await client.createSession({ profile: profile.name });
      const sessionId = created.stored_session_id || created.session_key || created.session_id;
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("Private chat creation returned no session ID.");
      }
      if (created.info?.profile_name && created.info.profile_name !== profile.name) {
        throw new Error("Private chat creation returned a different profile.");
      }
      if (conn) {
        rememberBotThread(conn,{id:sessionId,profile:profile.name});
      }
      onOpenChat(
        sessionId,
        profile.name,
        true,
      );
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

  if(selectedProfile) {
    const bot=profiles?.find(profile=>profile.name===selectedProfile);
    return <div className="screen"><div className="body bot-threads">
      {error && <p role="alert" className="error-line">{error}</p>}
      {!profiles ? <p role="status">Loading bot...</p> : !bot ? <p role="alert">This bot is no longer available.</p> : <>
        <div className="bot-thread-heading"><div><h2>{botTitle(bot)}</h2><p>@{botHandle(bot)}</p></div><button className="iconbtn" title="New bot thread" aria-label="New bot thread" disabled={opening!==null || client.connectionState!=='open'} onClick={()=>void openBot(bot)}><Plus size={22} /></button></div>
        <BotThreads client={client} conn={conn} bot={bot} onOpen={row=>onOpenSession ? onOpenSession(row) : onOpenChat(row.id,selectedProfile)} />
      </>}
    </div></div>;
  }

  return (
    <div className="screen">
      <div className="body flat-list">
        <div className="chat-section-bar"><h2 className="chat-section-heading">Bots</h2><button className="iconbtn" title="Refresh bots" aria-label="Refresh bots" onClick={() => void load()}><RefreshCw size={18} /></button><button className="iconbtn" title="Add bot" aria-label="Add bot" disabled={profiles === null || client.connectionState !== 'open'} onClick={() => { setNotice(''); setAdding(true); }}><Plus size={20} /></button></div>
        {notice && <p className="hint" role="status">{notice}</p>}
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
                onOpen={() => onSelectProfile ? onSelectProfile(bot.name) : void openBot(bot)}
              />
            ))}
            <div style={{ flex: 1 }} />
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
              gap: "var(--space-10)",
            }}
          >
            <span className="chip chip-warm">bots</span>
            <div className="appbar-title" style={{ fontSize: "var(--text-15)" }}>
              Bot Mode
            </div>
            <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
              No profiles found on this gateway.
            </div>
          </div>
        )}

        {profiles === null && !error && <div className="hint">Loading roster…</div>}
        {adding && profiles && <AddBotDialog client={client} profiles={profiles} device={conn?.label || 'Connected device'} onClose={() => setAdding(false)} onCreated={message => { setAdding(false); setNotice(message); void load(); }} />}
      </div>
    </div>
  );
}

function BotThreads({client,conn,bot,onOpen}:{client:HermesConnection;conn?:SavedConnection;bot:ProfileSummary;onOpen:(row:SessionSummary)=>void}) {
  const [rows,setRows]=useState<SessionSummary[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const canonicalId=bot.canonical_session?.id;
  const canonicalTip=bot.canonical_session?.resolved_id;
  useEffect(()=>{
    let cancelled=false;
    const manager=new ManagementClient(client);
    queueMicrotask(()=>{if(!cancelled){setLoading(true);setError('');}});
    const accept=(sessions:SessionSummary[])=>{
      const local=conn ? readBotThreads(conn) : new Set<string>();
      return uniqueChats([...canonicalChats([bot]),...sessions]).filter(row=>isBotThread(row,[bot],local)).sort((a,b)=>b.started_at-a.started_at);
    };
    manager.sessions(bot.name).then(sessions=>{if(!cancelled)setRows(accept(sessions));},reason=>{
      if(cancelled)return;
      setRows(accept(reason instanceof SessionReadError ? reason.sessions : []));
      setError('Thread history is incomplete. Retry to load the remaining conversations.');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
    // Roster polling must not refetch the full history unless canonical identity changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  },[client,conn,bot.name,canonicalId,canonicalTip,revision]);
  return <section aria-label="Bot threads"><div className="chat-section-bar"><h3 className="chat-section-heading">Threads</h3><button className="iconbtn" title="Refresh threads" aria-label="Refresh threads" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={18} /></button></div>
    {error && <p className="error-line" role="alert">{error}</p>}
    {loading ? <p role="status" className="hint">Loading threads...</p> : rows.length ? rows.map(row=><button className="rowcard bot-thread-row" key={chatKey(row)} onClick={()=>onOpen(row)}><MessageCircle size={20} /><span className="rowcard-main"><span className="chat-row-heading"><strong>{row.title || 'Untitled'}</strong><time>{formatSessionTime(row,'')}</time></span><span className="rowcard-sub">{row.preview || 'Open conversation'}</span></span></button>) : <p className="hint">No threads yet.</p>}
  </section>;
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
          {opening ? "Opening private chat…" : `@${handle}${preview ? ` · ${preview}` : ""}`}
        </div>
      </div>
      <span className="chevron">
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}
