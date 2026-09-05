import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileText, Folder, GitBranch, ExternalLink, ArrowLeft, RefreshCw, Terminal, ChevronRight } from 'lucide-react';
import type { HermesConnection, SavedConnection, SessionSummary } from '../lib/hermes-client';
import { WorkspaceClient, WorkspaceError, safePreviewUrl, type WorkspaceListing, type WorkspaceGitStatus, type WorkspaceText } from '../lib/workspace-client';
import './workspace.css';

type WorkspaceProps = { conn: SavedConnection; client: HermesConnection; session: SessionSummary | null; onBack: () => void };
type Tool = 'files' | 'git' | 'preview' | 'terminal';
type ReadState = { key: string; loading: boolean; error?: string; listing?: WorkspaceListing; git?: WorkspaceGitStatus | null; text?: WorkspaceText };
const toolLabels: Record<Tool, string> = { files: 'Files', git: 'Git', preview: 'Preview', terminal: 'Terminal' };

/** Contextual detail only. The production parent owns the header, navigation and conversation drafts. */
export default function Workspace({ conn, client, session, onBack }: WorkspaceProps) {
  const result = useMemo(() => {
    try { return { api: new WorkspaceClient(conn, client, session), error: '' }; }
    catch (error) { return { api: null, error: error instanceof WorkspaceError ? error.message : 'Workspace context is unavailable.' }; }
  }, [conn, client, session]);
  if (!result.api) return <section className="workspace-detail" aria-label="Workspace"><div className="workspace-notice"><h2>Workspace unavailable</h2><p>{result.error}</p></div><button className="workspace-button" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />Back to conversation</button></section>;
  return <WorkspaceDetail key={result.api.context.key} api={result.api} client={client} onBack={onBack} />;
}

function WorkspaceDetail({ api, client, onBack }: { api: WorkspaceClient; client: HermesConnection; onBack: () => void }) {
  const { context } = api;
  const [tool, setTool] = useState<Tool>('files');
  const [directory, setDirectory] = useState(context.cwd);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const connection = useSyncExternalStore(callback => client.addStateHandler(callback), () => client.connectionState, () => client.connectionState);
  const [read, setRead] = useState<ReadState>({ key: '', loading: true });

  const [cancelledKey, setCancelledKey] = useState('');
  const abort = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify([context.key, tool, directory, selected, revision, connection]);
  const state = read.key === requestKey ? read : { key: requestKey, loading: true };
  const cancelled = cancelledKey === requestKey;
  const online = connection === 'open';


  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    if (!online || tool === 'preview' || tool === 'terminal') return () => controller.abort();
    async function load() {
      try {
        const next: ReadState = { key: requestKey, loading: false };
        if (selected) next.text = tool === 'git' ? await api.diff(selected, controller.signal) : await api.readText(selected, controller.signal);
        else if (tool === 'git') next.git = await api.gitStatus(controller.signal);
        else next.listing = await api.list(directory, controller.signal);
        if (!controller.signal.aborted) setRead(next);
      } catch (error) {
        if (!controller.signal.aborted) setRead({ key: requestKey, loading: false, error: error instanceof WorkspaceError ? error.message : 'Workspace read failed.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [api, directory, online, requestKey, selected, tool]);

  function chooseTool(next: Tool) { setTool(next); setSelected(null); setRevision(value => value + 1); }
  function refresh() { setRevision(value => value + 1); }
  const canRead = tool === 'files' || tool === 'git';
  const relative = (path: string) => path.slice(context.cwd.length + 1) || path.split('/').pop();

  return <section className="workspace-detail" aria-label="Workspace tools">
    <div className="workspace-context">
      <span className="workspace-eyebrow">Conversation workspace · read-only</span>
      <strong>{context.profile} <span aria-hidden="true">/</span> {context.sessionId}</strong>
      <span>{new URL(context.gatewayUrl).host}</span>
      <code>{context.cwd}</code>
    </div>
    <nav className="workspace-tabs" aria-label="Workspace tool">
      {(Object.keys(toolLabels) as Tool[]).map(item => <button key={item} aria-pressed={tool === item} onClick={() => chooseTool(item)}>{toolLabels[item]}</button>)}
    </nav>

    {canRead && <>
      <div className="workspace-actions">
        {selected ? <button className="workspace-button" onClick={() => setSelected(null)}><ArrowLeft size={18} aria-hidden="true" />{tool === 'git' ? 'Changed files' : 'File list'}</button>
          : tool === 'files' && directory !== context.cwd ? <button className="workspace-button" onClick={() => setDirectory(directory.slice(0, directory.lastIndexOf('/')))}><ArrowLeft size={18} aria-hidden="true" />Parent folder</button> : <span className="workspace-eyebrow">{tool === 'git' ? 'Working tree vs HEAD' : 'Browse this directory'}</span>}
        <button className="workspace-button" onClick={refresh} disabled={!online || (state.loading && !cancelled)} aria-label="Refresh workspace"><RefreshCw size={18} aria-hidden="true" />Refresh</button>
      </div>
      <h2 className="workspace-path">{selected ? relative(selected) : tool === 'files' ? relative(directory) : 'Git review'}</h2>
      {!online ? <div className="workspace-notice" role="status"><strong>Gateway offline</strong><p>Reconnect from the device screen. Cached files and diffs are not shown as current.</p></div>
        : cancelled ? <div className="workspace-notice" role="status"><p>Read cancelled.</p><button className="workspace-button" onClick={refresh}>Try again</button></div>
        : state.loading ? <div className="workspace-notice" role="status"><p>Reading from the selected gateway…</p><button className="workspace-button" onClick={() => { abort.current?.abort(); setCancelledKey(requestKey); }}>Cancel read</button></div>
        : state.error ? <div className="workspace-notice workspace-error" role="alert"><strong>Could not read workspace</strong><p>{state.error}</p><button className="workspace-button" onClick={refresh}>Try again</button></div>
        : selected && state.text ? <>
          {state.text.truncated && <p className="workspace-notice" role="status">Display limited to 1,200 lines, 128 KiB of characters and 2,000 characters per line. This is not the full file or diff.</p>}
          {state.text.text ? <pre className="workspace-code" tabIndex={0} aria-label={tool === 'git' ? 'Read-only diff' : 'Read-only file text'}>{state.text.text}</pre> : <p className="workspace-notice">{tool === 'git' ? 'No diff returned. The gateway also returns empty text for some Git failures; this is not proof of a clean file.' : 'This file is empty.'}</p>}
          <p className="workspace-muted">Text only. HTML, SVG and Markdown are never executed or embedded.</p>
        </> : tool === 'files' && state.listing ? <>
          {state.listing.entries.length === 0 && <p className="workspace-notice">No visible files in this directory.</p>}
          <div className="workspace-list">{state.listing.entries.map(entry => <button className="workspace-row" key={entry.path} onClick={() => entry.directory ? setDirectory(entry.path) : setSelected(entry.path)}>
            {entry.directory ? <Folder size={22} aria-hidden="true" /> : <FileText size={22} aria-hidden="true" />}
            <span><strong>{entry.name}</strong><small>{entry.directory ? 'Folder' : `${entry.size} bytes · inspect text`}</small></span><ChevronRight size={18} aria-hidden="true" />
          </button>)}</div>
          {state.listing.omitted && <p className="workspace-muted">Some entries are hidden or beyond the 200-entry limit. Protected files, aliases and build folders are not browsable.</p>}
        </> : tool === 'git' && state.git !== undefined ? <>
          {state.git === null ? <p className="workspace-notice">Git status unavailable. The gateway returned no repository status; the path may not be a repository, or Git may have failed.</p> : <>
            <p className="workspace-branch"><GitBranch size={18} aria-hidden="true" />{state.git.detached ? 'Detached HEAD' : state.git.branch || 'Branch unavailable'}</p>
            {state.git.files.length === 0 && <p className="workspace-notice">No visible changed files returned.</p>}
            <div className="workspace-list">{state.git.files.map(file => <button className="workspace-row" key={file.path} onClick={() => setSelected(file.path)}><FileText size={22} aria-hidden="true" /><span><strong>{relative(file.path)}</strong><small>{[file.conflicted && 'Conflict', file.staged && 'Staged', file.unstaged && 'Unstaged', file.untracked && 'Untracked'].filter(Boolean).join(' · ') || 'Changed'}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</div>
            {state.git.omitted && <p className="workspace-muted">This is a filtered, bounded list, not the complete repository status.</p>}
          </>}
        </> : null}
      {tool === 'git' && <p className="workspace-muted">Inspect only. Stage, commit, push, revert and worktree mutations are unavailable. Deleted, large, binary and protected files cannot be diffed here.</p>}
    </>}

    {tool === 'preview' && <PreviewNavigation key={JSON.stringify([context.key, client.url, connection])} api={api} client={client} />}
    {tool === 'terminal' && <div className="workspace-notice"><Terminal size={28} aria-hidden="true" /><h2>Terminal unavailable on mobile</h2><p>Desktop persistent shells use native PTY / SSH IPC. The gateway’s Hermes TUI socket is not a general-purpose shell transport.</p><p>No shell starts, no command is accepted, and no native fallback is attempted. OS reveal, rename and trash are also unavailable.</p></div>}
    <p className="workspace-muted">Protected names and key material are excluded. Workspace paths refer to the selected gateway, never this phone.</p>
    <button className="workspace-button workspace-return" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />Back to conversation</button>
  </section>;
}

/** Trust is one-shot, local to this exact URL and gateway context; never persisted. */
function PreviewNavigation({ api, client }: { api: WorkspaceClient; client: HermesConnection }) {
  const { context } = api;
  const [input, setInput] = useState('');
  const [reviewed, setReviewed] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const appOrigin = location.origin;
  const liveGateway = client.url;
  const preview = safePreviewUrl(input, context.gatewayUrl);
  const key = JSON.stringify([context.key, liveGateway, appOrigin, input, preview]);
  function contextMatches() {
    try { return client.connectionState === 'open' && client.url === liveGateway && new URL(client.url).href.replace(/\/+$/, '') === context.gatewayUrl && location.origin === appOrigin; }
    catch { return false; }
  }
  const available = contextMatches();
  function clear() { pending.current = null; setReviewed(null); }
  useEffect(() => { if (reviewed) dialog.current?.focus(); }, [reviewed]);
  useEffect(() => () => { pending.current = null; }, []);
  function openTrustedPreview() {
    const trusted = preview && reviewed === key && pending.current === key && contextMatches() && safePreviewUrl(input, context.gatewayUrl) === preview;
    clear(); // Consume before navigation, including repeated clicks or a changed live client.
    if (trusted) window.open(preview, '_blank', 'noopener,noreferrer');
  }
  return <div className="workspace-preview">
    <h2>Review an external preview</h2><p>Read artifacts as text in Files, or review an existing HTTPS preview link. No generated artifact catalogue or provenance is inferred.</p>
    <label htmlFor="workspace-preview-url">Existing preview URL</label>
    <input id="workspace-preview-url" type="url" value={input} maxLength={2048} onChange={event => { clear(); setInput(event.target.value); }} placeholder="https://preview.example/project/" autoComplete="off" spellCheck={false} />
    {!available && <p className="workspace-muted" role="status">Preview unavailable. Reconnect to the same gateway and reopen this workspace.</p>}
    {input && !preview && <p className="workspace-muted" role="status">Use a separate HTTPS origin without credentials, query, fragment, protected path or phone-local address. The app and gateway origins are refused; unknown origin or scope is not trusted.</p>}
    {preview && available && <button className="workspace-button" onClick={() => { if (contextMatches()) { pending.current = key; setReviewed(key); } }}>Review preview link</button>}
    {preview && available && reviewed === key && <div className="workspace-notice" role="alertdialog" aria-labelledby="workspace-preview-trust-title" aria-describedby="workspace-preview-trust-warning" tabIndex={-1} ref={dialog} onKeyDown={event => { if (event.key === 'Escape') clear(); }}>
      <strong id="workspace-preview-trust-title">Trust this exact preview destination?</strong>
      <p>Destination: <code>{preview}</code></p><p>Gateway: <code>{context.gatewayUrl}</code></p>
      <p id="workspace-preview-trust-warning">Browser host cookies may accompany navigation, including app or gateway authentication cookies when the hostname is shared, even on a different port. Only continue if you trust this destination and its operator. New-tab opener and referrer protections do not suppress cookies.</p>
      <div className="workspace-preview-actions"><button className="workspace-button" onClick={clear}>Cancel preview</button><button className="workspace-button" onClick={openTrustedPreview}><ExternalLink size={18} aria-hidden="true" />Trust and open preview</button></div>
    </div>}
    <div className="workspace-notice"><strong>Browser annotation is unavailable</strong><p>This is external navigation only, after explicit trust. No iframe, annotation capture, automatic preview request or explicit app credential forwarding. Browser-managed cookies may still be sent. Desktop element inspection, screenshots, region pins and redaction are not available here.</p></div>
  </div>;
}
