import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Brain, CalendarClock, ChevronLeft, ChevronRight, Columns3, FolderOpen, Link, LockKeyhole, MessageCircle, Monitor, RefreshCw, Settings2, Sparkles, Users, type LucideIcon } from 'lucide-react';
import type { HermesConnection, SavedConnection } from '../lib/hermes-client';
import { ManagementClient, ManagementError, type Capability, type DescriptionReview, type ManagedProfile, type ProfileDetails } from '../lib/management-client';
import type { ManageViews, ManagePage as Page } from '../lib/shell-state';
import './manage.css';

type Props = { navigationViews?: ManageViews; conn: SavedConnection; client: HermesConnection; onSettings: () => void; onBots: () => void; onWorkspace: () => void };
const titles: Record<Page, string> = { hub: 'Manage', profiles: 'Profiles', capabilities: 'Capabilities', memory: 'Memory', schedules: 'Schedules & cron', messaging: 'Messaging', webhooks: 'Webhooks', settings: 'Appearance & preferences', native: 'Native capabilities', kanban: 'Kanban' };
const message = (error: unknown) => error instanceof ManagementError ? error.message : 'This management request could not be completed. No state changed.';
const display = (value: string) => value || 'Not reported';
const yesNo = (value: boolean | null) => value === null ? 'Not reported' : value ? 'Yes' : 'No';

function Notice({ children }: { children: ReactNode }) { return <div className="manage-notice">{children}</div>; }
function ErrorNotice({ error }: { error: unknown }) { return <div className="manage-error" role="alert">{message(error)}</div>; }
function Row({ icon: Icon, title, detail, onClick }: { icon: LucideIcon; title: string; detail: string; onClick: () => void }) {
  return <button className="manage-row" onClick={onClick}><span className="manage-glyph"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span><span className="manage-copy"><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={18} aria-hidden="true" /></button>;
}
function Values({ values }: { values: [string, string][] }) { return <dl className="manage-values">{values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>; }

/** Keyed by loader identity: a previous gateway/profile result is never painted
 * while the effect for the next scope is waiting to run. */
function Resource<T>({ load, children, label }: { load: (signal: AbortSignal) => Promise<T>; children: (data: T) => ReactNode; label: string }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; revision: number; data?: T; error?: unknown; done: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(data => { if (!controller.signal.aborted) setResult({ load, revision, data, done: true }); }, error => { if (!controller.signal.aborted) setResult({ load, revision, error, done: true }); });
    return () => controller.abort();
  }, [load, revision]);
  const ready = result?.load === load && result.revision === revision && result.done;
  return <section className="manage-resource" aria-label={label}>
    <div className="manage-section-heading"><h3>{label}</h3><button className="manage-text-button" aria-label={`Refresh ${label}`} disabled={!ready} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} aria-hidden="true" /> Refresh</button></div>
    {!ready ? <p role="status">Loading {label.toLowerCase()}…</p> : result.error ? <ErrorNotice error={result.error} /> : children(result.data as T)}
  </section>;
}

export default function Manage(props: Props) {
  const adapter = useMemo(() => {
    try {
      if (props.conn.url.replace(/\/+$/, '') !== props.client.url.replace(/\/+$/, '')) throw new ManagementError('scope', 'The saved device does not match the active gateway. Reconnect before managing it.');
      return { manager: new ManagementClient(props.client), error: null };
    } catch (error) { return { manager: null, error }; }
  }, [props.client, props.conn.url]);
  if (!adapter.manager) return <div className="manage"><ErrorNotice error={adapter.error} /><button className="manage-button" onClick={props.onSettings}>Open connection settings</button></div>;
  return <ManagementHub key={`${props.conn.id}:${props.conn.url}`} {...props} manager={adapter.manager} />;
}

function ManagementHub({ conn, manager, onSettings, onBots, onWorkspace, navigationViews }: Props & { manager: ManagementClient }) {
  const [page, setPage] = useState<Page>(() => navigationViews?.read(conn).page ?? 'hub');
  const [selection, setSelection] = useState<{ manager: ManagementClient; name: string }>(() => ({manager, name:navigationViews?.read(conn).profile ?? ''}));
  const profile = selection?.manager === manager ? selection.name : '';
  const roster = useCallback((signal: AbortSignal) => manager.profiles(signal), [manager]);
  const [profiles, setProfiles] = useState<{ manager: ManagementClient; rows: ManagedProfile[] }>();
  const [rosterError, setRosterError] = useState<{ manager: ManagementClient; error: unknown }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    roster(controller.signal).then(rows => { if (!controller.signal.aborted) { setProfiles({ manager, rows }); setRosterError(undefined); } }, error => { if (!controller.signal.aborted) { setProfiles(undefined); setRosterError({ manager, error }); } });
    return () => controller.abort();
  }, [manager, roster, refresh]);
  const rows = profiles?.manager === manager ? profiles.rows : undefined;
  const selected = rows?.some(row => row.name === profile) ? profile : '';
  const error = rosterError?.manager === manager ? rosterError.error : null;
  const go = (next: Page) => {
    setPage(next); navigationViews?.update(conn, {page:next, profile});
  };
  const chooseProfile = (name: string) => {
    setSelection({manager, name}); navigationViews?.update(conn, {page, profile:name});
  };
  const needsProfile = ['capabilities', 'memory', 'schedules', 'messaging'].includes(page);
  return <div className="manage">
    {page === 'hub' ? <div className="manage-hero"><div className="manage-eyebrow">Configure, deliberately</div><h2>Your setup.<br />Clear boundaries.</h2><p>Inspect your gateway. Review a change before it is sent.</p></div> : <><button className="manage-text-button" onClick={() => go('hub')}><ChevronLeft size={18} aria-hidden="true" /> Back to Manage</button><h2 className="manage-page-title">{titles[page]}</h2></>}
    <div className="manage-scope"><span>Device <strong>{conn.label}</strong></span><label><span>Management profile</span><select aria-label="Management profile" value={selected} onChange={event => chooseProfile(event.target.value)}><option value="">Choose a profile</option>{rows?.map(row => <option key={row.name} value={row.name}>{row.displayName ? `${row.displayName} · ${row.name}` : row.name}</option>)}</select></label><small>This selection only scopes Manage. It does not switch a chat, the gateway, or the CLI default.</small></div>
    {!rows && !error && <p role="status">Loading profiles…</p>}
    {!!error && <><ErrorNotice error={error} /><button className="manage-text-button" onClick={() => setRefresh(v => v + 1)}>Retry profile list</button></>}
    {page === 'hub' && <>
      <h3 className="manage-section-label">Connections & identity</h3>
      <Row icon={Monitor} title="Devices & gateways" detail="Saved connections and authentication" onClick={onSettings} />
      <Row icon={Users} title="Profiles" detail={rows ? `${rows.length} profiles reported by this gateway` : 'Inspect identity and profile descriptions'} onClick={() => go('profiles')} />
      <Row icon={Brain} title="Memory" detail="Read profile notes from MEMORY.md and USER.md" onClick={() => go('memory')} />
      <h3 className="manage-section-label">Intelligence</h3>
      <Row icon={Sparkles} title="Capabilities" detail="Installed skills, toolsets and MCP configuration" onClick={() => go('capabilities')} />
      <Row icon={Settings2} title="Appearance & preferences" detail="Mobile settings and Desktop-only boundaries" onClick={() => go('settings')} />
      <h3 className="manage-section-label">Coordination</h3>
      <Row icon={CalendarClock} title="Schedules & cron" detail="Profile-owned jobs, cadence and next run" onClick={() => go('schedules')} />
      <Row icon={MessageCircle} title="Messaging" detail="Channel configuration and reported state" onClick={() => go('messaging')} />
      <Row icon={Link} title="Webhooks" detail="Profile transport unavailable · inspect the boundary" onClick={() => go('webhooks')} />
      <Row icon={Columns3} title="Kanban" detail="Official bundled plugin · gateway-wide boards" onClick={() => go('kanban')} />
      <Row icon={Users} title="Bots & routines" detail="Open the existing bot workspace" onClick={onBots} />
      <h3 className="manage-section-label">Workspace & platform</h3>
      <Row icon={FolderOpen} title="Workspace tools" detail="Files and review in their conversation context" onClick={onWorkspace} />
      <Row icon={LockKeyhole} title="Native capabilities" detail="SSH, HUD, OS integration and lifecycle limits" onClick={() => go('native')} />
      <p className="manage-footnote">Source-backed reads, not a simulated dashboard. Desktop action parity remains incomplete.</p>
    </>}
    {needsProfile && !selected && <Notice>Choose a management profile above. No profile data is requested until you choose; there is no default-profile fallback.</Notice>}
    {page === 'profiles' && <>
      <div className="manage-section-heading"><h3>Profiles on this gateway</h3><button className="manage-text-button" onClick={() => setRefresh(v => v + 1)}>Refresh</button></div>
      {rows?.length === 0 && <p>No profiles were returned by the gateway.</p>}
      {rows?.map(row => <button key={row.name} className="manage-row" aria-pressed={selected === row.name} onClick={() => chooseProfile(row.name)}><span className="manage-glyph"><Users size={22} aria-hidden="true" /></span><span className="manage-copy"><strong>{row.displayName || row.name}</strong><small>{row.name} · {row.description || 'No description'}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}
      {selected && <ProfilePanel key={selected} manager={manager} profile={selected} device={conn.label} mode="profile" />}
      <Notice>Creating, renaming, deleting, importing and exporting profiles are not implemented here. No files or credentials are exported.</Notice>
    </>}
    {page === 'capabilities' && selected && <ProfilePanel key={selected} manager={manager} profile={selected} device={conn.label} mode="capabilities" />}
    {page === 'memory' && selected && <MemoryPanel key={selected} manager={manager} profile={selected} />}
    {page === 'schedules' && selected && <SchedulesPanel key={selected} manager={manager} profile={selected} />}
    {page === 'messaging' && selected && <MessagingPanel key={selected} manager={manager} profile={selected} />}
    {page === 'kanban' && <KanbanPanel manager={manager} device={conn.label} />}
    {page === 'webhooks' && <><Notice><strong>Unavailable for profile-scoped management.</strong><p>The pinned upstream webhook endpoint does not accept a profile. This client will not silently read or modify the gateway process’s default subscriptions.</p><p>No webhook request was sent. No state changed.</p></Notice><p>Enablement may restart the gateway upstream. Creating, testing, toggling, deleting and revealing subscription secrets remain unavailable here.</p></>}
    {page === 'settings' && <><Row icon={Monitor} title="Connection settings" detail="Open this app’s existing saved-device settings" onClick={onSettings} /><Notice>Appearance is currently supplied by the shared mobile theme. Theme, accent, font, language and pet controls are not implemented in Manage.</Notice><h3 className="manage-section-label">Conversation settings</h3><p>Model and reasoning controls stay in the chat they affect. Manage does not rewrite profile model defaults.</p><Notice>Provider keys, billing, safety policies, tool credentials and raw configuration editing are unavailable here. No broad configuration or environment dump is fetched.</Notice><Row icon={LockKeyhole} title="Native & OS features" detail="Notifications, secure storage and Desktop lifecycle" onClick={() => go('native')} /></>}
    {page === 'native' && <><Notice>These are explicit implementation boundaries, not a claim that Hermes lacks the features. This web client has no Electron bridge.</Notice>{[
      ['SSH & cloud lifecycle', 'No tunnel, key management, cloud discovery or remote-process launch is implemented.'],
      ['HUD, Quick Entry & desktop pets', 'Always-on-top windows, global hotkeys and screen-context capture require Desktop OS integration.'],
      ['Keychain & notifications', 'Manage does not provide encrypted OS credential storage or notification permissions. Existing connection storage behavior is unchanged.'],
      ['Voice, terminal & browser host', 'No microphone, PTY, embedded browser capture or annotation is added by Manage.'],
      ['Updates, restart & uninstall', 'No installer or gateway lifecycle action can be triggered here.'],
    ].map(([title, detail]) => <section className="manage-boundary" key={title}><h3>{title}</h3><p>{detail}</p></section>)}</>}
  </div>;
}

function ProfilePanel({ manager, profile, device, mode }: { manager: ManagementClient; profile: string; device: string; mode: 'profile' | 'capabilities' }) {
  const load = useCallback((signal: AbortSignal) => manager.describe(profile, signal), [manager, profile]);
  return <Resource load={load} label={mode === 'profile' ? 'Profile details' : 'Configured capabilities'}>{data => mode === 'profile' ? <>
    <Values values={[["Profile", data.name], ['Default model', display(data.model)], ['Provider', display(data.provider)]]} />
    <DescriptionEditor key={`${profile}:${data.description}`} manager={manager} data={data} device={device} />
    <details className="manage-detail"><summary>SOUL instructions · read only</summary><pre>{data.soul || 'No SOUL instructions returned.'}</pre></details>
  </> : <Capabilities data={data} />}</Resource>;
}
function Capabilities({ data }: { data: ProfileDetails }) {
  const [query, setQuery] = useState('');
  const sections: [string, Capability[]][] = [['Skills', data.skills], ['Toolsets', data.toolsets], ['MCP servers', data.mcp]];
  return <><label className="manage-field"><span>Find a capability</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Skills, tools or MCP" /></label>{sections.map(([title, rows]) => {
    const filtered = rows.filter(row => `${row.name} ${row.label} ${row.description}`.toLowerCase().includes(query.toLowerCase()));
    return <section key={title}><h3 className="manage-section-label">{title} · {rows.length} reported</h3>{filtered.length === 0 ? <p>{query ? 'No matching capabilities.' : 'None reported for this profile.'}</p> : filtered.map((row, index) => <details className="manage-detail" key={`${row.name}:${index}`}><summary><span>{row.label || row.name}</span><small>{row.enabled ? 'Enabled' : 'Disabled'}</small></summary><Values values={[["Name", row.name], ['Configuration', row.enabled ? 'Enabled' : 'Disabled'], ...(row.transport ? [['Transport', row.transport] as [string, string]] : []), ...(row.toolCount !== null ? [['Tools', String(row.toolCount)] as [string, string]] : [])]} />{row.description && <p>{row.description}</p>}{title === 'Skills' && <p>Installed skill identity and enablement only. Full skill editing is not implemented.</p>}</details>)}</section>;
  })}<Notice>Configuration is not a live health check or a per-session tool inventory. MCP handshakes, OAuth, installation, enablement changes and toolset edits are not performed here.</Notice></>;
}

function DescriptionEditor({ manager, data, device }: { manager: ManagementClient; data: ProfileDetails; device: string }) {
  const [draft, setDraft] = useState(data.description);
  const [review, setReview] = useState<DescriptionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>();
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => () => { request.current?.abort(); }, [manager, data.name]);
  async function run(confirm: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined); setStatus('');
    const controller = new AbortController(); request.current = controller;
    try {
      if (confirm && review) {
        const saved = await manager.confirmDescription(review, data.name, true, controller.signal);
        if (!controller.signal.aborted) { setDraft(saved.description); setReview(null); setStatus('Description saved and verified on the selected profile.'); }
      } else {
        const next = await manager.reviewDescription(data.name, draft, controller.signal);
        if (!controller.signal.aborted) setReview(next);
      }
    } catch (error) { if (!controller.signal.aborted) { setError(error); setReview(null); } }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  return <><label className="manage-field"><span>Profile description</span><textarea aria-label="Profile description" value={draft} disabled={busy || !!review} maxLength={1000} onChange={e => setDraft(e.target.value)} rows={3} /></label><button className="manage-button" disabled={busy || !!review} onClick={() => void run(false)}>{busy ? 'Waiting for gateway…' : 'Review description change'}</button>{status && <p role="status">{status}</p>}{!!error && <ErrorNotice error={error} />}{review && <Confirmation review={review} device={device} busy={busy} onCancel={() => setReview(null)} onConfirm={() => void run(true)} />}</>;
}
function Confirmation({ review, device, busy, onCancel, onConfirm }: { review: DescriptionReview; device: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="manage-confirm" aria-labelledby="manage-confirm-title" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}><h2 id="manage-confirm-title">Confirm description change</h2><p><strong>{device} / {review.profile}</strong></p><Values values={[["Before", review.before || '(empty)'], ['After', review.after || '(empty)']]} /><Notice>This replaces only the profile description, not SOUL, model, skills or memory. Upstream has no atomic version guard for this field; a concurrent edit can still race the final write.</Notice><p>Closing or timing out after confirmation cannot recall a request already sent.</p><div className="manage-actions"><button className="manage-button" disabled={busy} onClick={onCancel}>Cancel</button><button className="manage-button manage-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Saving…' : 'Confirm & save description'}</button></div></dialog>;
}

function MemoryPanel({ manager, profile }: { manager: ManagementClient; profile: string }) {
  const load = useCallback((signal: AbortSignal) => manager.memories(profile, signal), [manager, profile]);
  return <><Notice>Read-only saved notes, not provider configuration. Notes are private profile content; they are not persisted in this app.</Notice><Resource load={load} label="Saved memory">{notes => notes.length ? notes.map(note => <MemoryDetail key={note.id} manager={manager} profile={profile} id={note.id} label={note.label} source={note.source} />) : <p>No memory notes returned for this profile.</p>}</Resource><Notice>Memory edits and deletions are unavailable: upstream IDs are positional and are not safe concurrency tokens. External memory-provider setup and graph editing are not implemented.</Notice></>;
}
function MemoryDetail({ manager, profile, id, label, source }: { manager: ManagementClient; profile: string; id: string; label: string; source: string }) {
  const [open, setOpen] = useState(false);
  const load = useCallback((signal: AbortSignal) => manager.memoryDetail(profile, id, signal), [manager, profile, id]);
  return <details className="manage-detail" onToggle={e => setOpen(e.currentTarget.open)}><summary><span>{label || id}</span><small>{source === 'profile' ? 'USER.md' : source === 'memory' ? 'MEMORY.md' : source}</small></summary>{open && <Resource load={load} label="Memory content">{content => <pre>{content}</pre>}</Resource>}</details>;
}
function SchedulesPanel({ manager, profile }: { manager: ManagementClient; profile: string }) {
  const load = useCallback((signal: AbortSignal) => manager.schedules(profile, signal), [manager, profile]);
  return <><Resource load={load} label="Scheduled jobs">{jobs => jobs.length ? jobs.map(job => <details className="manage-detail" key={job.id}><summary><span>{job.name || job.id}</span><small>{display(job.state)}</small></summary><Values values={[["Job ID", job.id], ['Profile', job.profile], ['Schedule', display(job.schedule)], ['Enabled', yesNo(job.enabled)], ['Next run · server value', display(job.nextRun)], ['Last run · server value', display(job.lastRun)]]} /></details>) : <p>No scheduled jobs returned for this profile.</p>}</Resource><Notice>Times are shown exactly as reported by the gateway, not converted to the phone’s timezone. Create, edit, pause, resume, trigger, delete and delivery changes are unavailable in this release. No job is run by opening this view.</Notice></>;
}
function MessagingPanel({ manager, profile }: { manager: ManagementClient; profile: string }) {
  const load = useCallback((signal: AbortSignal) => manager.messaging(profile, signal), [manager, profile]);
  return <><Resource load={load} label="Messaging platforms">{platforms => platforms.length ? platforms.map(platform => <details className="manage-detail" key={platform.id}><summary><span>{platform.name || platform.id}</span><small>{display(platform.state).replaceAll('_', ' ')}</small></summary><p>{platform.description}</p><Values values={[["Platform", platform.id], ['Enabled', yesNo(platform.enabled)], ['Configured', yesNo(platform.configured)], ['Gateway running · reported', yesNo(platform.gatewayRunning)]]} /></details>) : <p>No messaging platforms returned.</p>}</Resource><Notice>Read-only reported state; no test message or connection probe is sent. Channel secrets, recipients and server diagnostics are not displayed. Setup, pairing, enablement and gateway restart are unavailable here.</Notice></>;
}
function KanbanPanel({ manager, device }: { manager: ManagementClient; device: string }) {
  const load = useCallback((signal: AbortSignal) => manager.boards(signal), [manager]);
  const [selection, setSelection] = useState<{ manager: ManagementClient; slug: string }>();
  const slug = selection?.manager === manager ? selection.slug : '';
  return <><Notice><strong>{device} · gateway-wide boards</strong><p>Kanban is shared across profiles. The management profile selector does not filter this board. Pick a board explicitly; this view never follows the gateway’s mutable current-board setting.</p></Notice><Resource load={load} label="Kanban boards">{boards => <>{boards.length ? boards.map(board => <button key={board.slug} className="manage-row" aria-pressed={slug === board.slug} onClick={() => setSelection({ manager, slug: board.slug })}><Columns3 size={22} aria-hidden="true" /><span className="manage-copy"><strong>{board.name || board.slug}</strong><small>{board.slug}</small></span><ChevronRight size={18} aria-hidden="true" /></button>) : <p>No boards returned. The plugin may not be configured.</p>}{slug && boards.some(board => board.slug === slug) && <KanbanCards manager={manager} slug={slug} />}</>}</Resource><Notice>The official bundled Kanban plugin must be enabled on the gateway. A 404 is unavailable, not an empty board. Task creation, moves, assignment, approval, dispatch, logs, attachments and board lifecycle are not implemented.</Notice></>;
}
function KanbanCards({ manager, slug }: { manager: ManagementClient; slug: string }) {
  const load = useCallback((signal: AbortSignal) => manager.board(slug, signal), [manager, slug]);
  return <Resource load={load} label={`Board · ${slug}`}>{columns => columns.map(column => <section className="manage-kanban-column" key={column.name}><h3>{column.name.replaceAll('_', ' ')} <small>{column.tasks.length}</small></h3>{column.tasks.length ? column.tasks.map(task => <details className="manage-detail" key={task.id}><summary><span>{task.title || task.id}</span></summary><Values values={[["Task", task.id], ['State', display(task.status)], ['Assignee', task.assignee || 'Unassigned']]} /><pre>{task.body || 'No task description returned.'}</pre></details>) : <p>No tasks in this column.</p>}</section>)}</Resource>;
}
