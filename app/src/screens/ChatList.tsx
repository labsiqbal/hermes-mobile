import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pin, Trash2, RefreshCw, SlidersHorizontal, Search, MoreHorizontal, X } from 'lucide-react';
import type { HermesConnection, ProjectTreeItem, SavedConnection, SessionSummary } from '../lib/hermes-client';
import { ChatSource, chatReadFailure, type ChatReadFailure } from '../lib/chat-source';
import { chatKey, uniqueChats, orderedProjects, preferenceKey, readIds, sessionPinsKey, readBotThreads, isBotThread, type BrowserChat } from '../lib/chat-browser';
import { formatSessionTime } from './chat-list-utils';
import { isActive } from '../lib/active-sessions';
import { ChevronDownIcon, ChevronRightIcon } from '../components/icons';
import './chat-list.css';

interface Props {
  conn: SavedConnection; client: HermesConnection;
  onOpenChat: (session: SessionSummary | null) => void;
  onDisconnect: () => void;
}
type Snapshot = Awaited<ReturnType<ChatSource['load']>>;
const projectSessions = (project: ProjectTreeItem) => project.repos?.flatMap(repo=>repo.groups?.flatMap(group=>group.sessions || []) || []) || project.previewSessions || [];

export default function ChatList({conn,client,onOpenChat}: Props) {
  const source = useMemo(()=>new ChatSource(client),[client]);
  const [data,setData] = useState<Snapshot>();
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [loadError,setLoadError] = useState<ChatReadFailure | null>(null);
  const [status,setStatus] = useState('');
  const [hydrated,setHydrated] = useState<Record<string,ProjectTreeItem>>({});
  const [projectErrors,setProjectErrors] = useState<Record<string,string>>({});
  const requests = useRef(new Set<string>());
  const generation = useRef(0);
  const pinsKey = preferenceKey(conn);
  const expandedKey = `${pinsKey}:expanded`;
  const [pins,setPins] = useState(()=>readIds(pinsKey));
  const [expanded,setExpanded] = useState(()=>readIds(expandedKey));
  const [query,setQuery] = useState('');
  const [sessionPins,setSessionPins] = useState(()=>readIds(sessionPinsKey(conn)));
  const [actions,setActions] = useState<BrowserChat | null>(null);
  const localBots = readBotThreads(conn);
  const [projectFilter,setProjectFilter] = useState('');
  const [profileFilter,setProfileFilter] = useState('');
  const [filtersOpen,setFiltersOpen] = useState(false);
  const dismissFilters = useCallback(()=>setFiltersOpen(false),[]);
  const [pendingDelete,setPendingDelete] = useState<BrowserChat | null>(null);

  const load = useCallback(async () => {
    const version = ++generation.current;
    requests.current.clear(); setPendingDelete(null); setLoading(true); setProjectErrors({}); setError(''); setLoadError(null);
    try {
      const next = await source.load();
      if (version===generation.current) {
        setHydrated({});setData(next);
        setProjectFilter(selected=>!selected || selected==='recent' || next.projects.some(project=>!project.isNoProject && project.id===selected) ? selected : '');
        setProfileFilter(selected=>!selected || next.profiles.some(profile=>profile.name===selected) ? selected : '');
      }
    }
    catch (err) { if (version===generation.current) setLoadError(chatReadFailure(err,'Gateway','RPC profiles.list')); }
    finally { if (version===generation.current) setLoading(false); }
  },[source]);
  useEffect(()=>{
    // oxlint-disable-next-line react/set-state-in-effect -- Fetch gateway state on mount.
    void load();
    const unsubscribe=client.addStateHandler(state=>{setPendingDelete(null);if(state==='open') void load();});
    return ()=>{
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Generation counter, not a DOM ref.
      generation.current++; unsubscribe();
    };
  },[client,load]);
  // Activity indicators are read from the existing event cache, never title inference.
  const [,tick]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>tick(value=>value+1),2000);return ()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if (!data || loading || loadError) return;
    for (const project of data.projects) {
      if (project.isNoProject || !project.sessionCount || !expanded.has(project.id) || hydrated[project.id] || projectErrors[project.id] || requests.current.has(project.id)) continue;
      requests.current.add(project.id);
      const version=generation.current;
      source.project(project.sourceId,project.profile).then(full=>{
        if(version===generation.current) setHydrated(previous=>({...previous,[project.id]:full}));
      },err=>{if(version===generation.current) setProjectErrors(previous=>({...previous,[project.id]:err instanceof Error ? err.message : 'Could not load project sessions.'}));})
        .finally(()=>{if(version===generation.current) requests.current.delete(project.id);});
    }
  },[data,loading,loadError,expanded,hydrated,projectErrors,source]);

  function persist(key:string,next:Set<string>) { try { localStorage.setItem(key,JSON.stringify([...next])); } catch { setError('This browser could not save project display preferences.'); } }
  function togglePin(id:string) { const next=new Set(pins); if(next.has(id)) next.delete(id); else next.add(id); setPins(next); persist(pinsKey,next); }
  function toggleProject(id:string) { const next=new Set(expanded); if(next.has(id)) next.delete(id); else next.add(id); setExpanded(next); persist(expandedKey,next); }
  const identify = (rows: SessionSummary[]) => uniqueChats(rows.map(row=>{
    const bot=data?.bots.find(bot=>bot.profile===row.profile && [bot.id,bot.resolved_id].some(id=>id && [row.id,row.resolved_id].includes(id)));
    return bot ? {...row,...bot} : row;
  }));
  const matches = (row:BrowserChat) => !isBotThread(row,data?.profiles || [],localBots)
    && (!profileFilter || row.profile===profileFilter)
    && `${row.title} ${row.preview} ${row.cwd || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const realProjects=data?.projects.filter(project=>!project.isNoProject && project.sessionCount>0) || [];
  const projects=orderedProjects(realProjects,pins).filter(project=>projectFilter===project.id && (!profileFilter || profileFilter===project.profile));
  const recent = identify([...(data?.bots || []),...(data?.sessions || []),...realProjects.flatMap(project=>project.previewSessions || []),...Object.values(hydrated).flatMap(projectSessions)])
    .filter(matches).sort((a,b)=>b.started_at-a.started_at);
  const pinned = recent.filter(row=>sessionPins.has(chatKey(row)));
  function toggleSessionPin(row:BrowserChat) {
    const next=new Set(sessionPins), key=chatKey(row);
    if(next.has(key)) next.delete(key); else next.add(key);
    setSessionPins(next); persist(sessionPinsKey(conn),next); setActions(null);
  }
  const available = (row:BrowserChat) => !loading && !loadError && !data?.failedProfiles.includes(row.profile || '') && !row.bot && row.profile===data?.profile && client.connectionState==='open' && !isActive(conn.id,row.id,row.resolved_id);
  function renderRow(row:BrowserChat) {
    return <div className="chat-session-row" key={chatKey(row)} data-session-id={row.id} data-profile={row.profile}>
      <button className="rowcard" onClick={()=>onOpenChat(row)}>
        <span className="rowcard-main">
          <span className="chat-row-heading"><span className="rowcard-title">{row.title || 'Untitled'}</span><time>{formatSessionTime(row,'')}</time></span>
          {row.preview && <span className="rowcard-sub">{row.preview}</span>}
          <span className="rowcard-meta">{row.cwd && <span>{row.cwd.split('/').filter(Boolean).pop() || row.cwd}</span>}{row.profile!==data?.profile && <span>{row.profile}</span>}{isActive(conn.id,row.id,row.resolved_id) && <span className="chip chip-amber chip-live">active</span>}</span>
        </span>
      </button>
      <button className="iconbtn chat-row-menu" aria-label={`Actions for ${row.title || 'Untitled'}`} title="Conversation actions" onClick={()=>setActions(row)}><MoreHorizontal size={18} aria-hidden="true" /></button>
    </div>;
  }
  const activeFilters = Number(Boolean(projectFilter)) + Number(Boolean(profileFilter));
  const clearFilters = () => { setProjectFilter(''); setProfileFilter(''); setPendingDelete(null); };
  const closeFilters = () => history.back();
  return <div className="screen"><div className="body chatlist">
    <div className="chat-filter-toolbar">
      <label className="chat-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={event=>setQuery(event.target.value)} /></label>
      <button className="iconbtn chat-filter-button" aria-label="Filter chats" title="Filter projects and profiles" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={()=>{history.pushState(history.state,'');setFiltersOpen(true);}}><SlidersHorizontal size={20} aria-hidden="true" />{activeFilters>0 && <span className="filter-count">{activeFilters}</span>}</button>
    </div>
    {activeFilters > 0 && <div className="chat-filter-summary"><span>{[projectFilter && `Project: ${projectFilter==='recent'?'Recent':realProjects.find(p=>p.id===projectFilter)?.label || projectFilter}`,profileFilter && `Profile: ${profileFilter}`].filter(Boolean).join(' · ')}</span><button className="btn btn-ghost" onClick={clearFilters} aria-label="Clear filters">Clear</button></div>}
    {filtersOpen && <FilterSheet onBack={dismissFilters} onClose={closeFilters}><div className="chat-filters">
      <label>Project<select aria-label="Project filter" value={projectFilter} onChange={e=>{const id=e.target.value;setProjectFilter(id);setExpanded(previous=>new Set([...previous,id]));setPendingDelete(null);}}><option value="">All projects</option><option value="recent">Recent</option>{realProjects.map(project=><option key={project.id} value={project.id}>{project.label} · {project.profile}</option>)}</select></label>
      <label>Profile<select aria-label="Profile filter" value={profileFilter} onChange={e=>{setProfileFilter(e.target.value);setPendingDelete(null);}}><option value="">All profiles</option>{data?.profiles.map(profile=><option key={profile.name} value={profile.name}>{profile.name}</option>)}</select></label>
    </div><div className="sheet-actions"><button className="btn btn-ghost" onClick={clearFilters} disabled={!activeFilters}>Clear filters</button><button className="btn btn-primary" onClick={closeFilters}>Done</button></div></FilterSheet>}
    {error && <div className="error-line" role="alert">{error}</div>}
    {(loadError || !!data?.readFailures.length) && <ReadStatus failures={loadError ? [loadError] : data!.readFailures} empty={!data?.sessions.length && !data?.projects.length} identityOnly={!loadError && data?.failedProfiles.length===0} loading={loading} onRetry={()=>void load()} />}
    {status && <div className="hint" role="status">{status}</div>}
    {loading ? <div className="hint" role="status">Loading chats…</div> : <>
      {(!projectFilter || projectFilter==='recent') && <>
        {pinned.length>0 && <section aria-label="Pinned conversations"><h2 className="chat-section-heading"><Pin size={14} aria-hidden="true" />Pinned</h2>{pinned.map(renderRow)}</section>}
        <section aria-label="Recent conversations"><div className="chat-section-bar"><h2 className="chat-section-heading">Recent</h2><button className="iconbtn" disabled={loading} onClick={()=>void load()} aria-label="Refresh Chats" title="Refresh Chats"><RefreshCw size={16} aria-hidden="true" /></button></div>{recent.filter(row=>!sessionPins.has(chatKey(row))).map(renderRow)}</section>
      </>}
      {projects.map(project=>{
        const open=expanded.has(project.id), full=hydrated[project.id];
        const rows=identify(full ? projectSessions(full) : project.previewSessions || []).filter(matches);
        const panelId=`project-${encodeURIComponent(project.id)}`;
        return <section className="project-group" key={project.id} data-project-id={project.id}>
          <div className="project-heading"><button className="project-group-head" aria-expanded={open} aria-controls={panelId} onClick={()=>toggleProject(project.id)}>{open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}<span className="project-group-name">{project.label}<small>{project.profile}</small></span><span className="project-group-count">{project.sessionCount}</span></button><button className="iconbtn project-pin" aria-label={`${pins.has(project.id) ? 'Unpin' : 'Pin'} project ${project.label}`} aria-pressed={pins.has(project.id)} onClick={()=>togglePin(project.id)}><Pin size={17} aria-hidden="true" /></button></div>
          {open && <div className="project-group-rows" id={panelId}>{projectErrors[project.id] ? <><p role="alert" className="error-line">{projectErrors[project.id]} Showing the verified preview only. Refresh Chats to retry.</p>{rows.map(renderRow)}</> : !full ? <p className="hint" role="status">Loading sessions…</p> : rows.length ? rows.map(renderRow) : <p className="hint">No chats match these filters in this project.</p>}</div>}
        </section>;
      })}
      {!error && !loadError && !data?.readFailures.length && projects.length===0 && (projectFilter && projectFilter!=='recent' || recent.length===0) && <p className="hint">No chats match these filters.</p>}
    </>}
  </div>{actions && <ConversationActions row={actions} pinned={sessionPins.has(chatKey(actions))} canDelete={available(actions)} onClose={()=>setActions(null)} onPin={()=>toggleSessionPin(actions)} onDelete={()=>{setPendingDelete(actions);setActions(null);}} />}{pendingDelete && <DeleteDialog target={pendingDelete} device={conn.label} available={()=>available(pendingDelete)} source={source} onClose={()=>setPendingDelete(null)} onFinished={message=>{setPendingDelete(null);setStatus(message);void load();}} />}</div>;
}

function ConversationActions({row,pinned,canDelete,onClose,onPin,onDelete}:{row:BrowserChat;pinned:boolean;canDelete:boolean;onClose:()=>void;onPin:()=>void;onDelete:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return ()=>{if(previous instanceof HTMLElement && previous.isConnected) previous.focus();};},[]);
  return <dialog ref={dialog} className="chat-delete-dialog conversation-actions" aria-label="Conversation actions" onCancel={onClose}>
    <div className="chat-filter-heading"><h2>{row.title || 'Untitled'}</h2><button className="iconbtn" autoFocus aria-label="Close actions" onClick={onClose}><X size={20} /></button></div>
    <button className="collection-link" onClick={onPin}><Pin size={18} />{pinned ? 'Unpin conversation' : 'Pin conversation'}</button>
    <button className="collection-link chat-delete" disabled={!canDelete} onClick={onDelete}><Trash2 size={18} />Delete session</button>
    {!canDelete && <p className="hint">Only inactive sessions in the connected running profile can be deleted.</p>}
  </dialog>;
}

function FilterSheet({children,onBack,onClose}:{children:ReactNode;onBack:()=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    const trigger=document.querySelector<HTMLElement>('[aria-label="Filter chats"]');
    node?.showModal();
    window.addEventListener('popstate',onBack);
    return ()=>{window.removeEventListener('popstate',onBack);node?.close();trigger?.focus();};
  },[onBack]);
  return <dialog ref={dialog} className="chat-filter-sheet" aria-labelledby="chat-filter-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><div className="chat-filter-heading"><h2 id="chat-filter-title">Filter chats</h2><button className="iconbtn" aria-label="Close filters" onClick={onClose} autoFocus><X size={20} aria-hidden="true" /></button></div>{children}</dialog>;
}

function ReadStatus({failures,empty,identityOnly,loading,onRetry}:{failures:ChatReadFailure[];empty:boolean;identityOnly:boolean;loading:boolean;onRetry:()=>void}) {
  const groups=new Map<string,{failure:ChatReadFailure;profiles:string[]}>();
  for(const failure of failures) {
    const key=JSON.stringify([failure.operation,failure.code,failure.status,failure.message]);
    const group=groups.get(key);
    if(group) group.profiles.push(failure.profile); else groups.set(key,{failure,profiles:[failure.profile]});
  }
  return <section className="chat-read-status" role="status" aria-label="Chat history read status">
    <div className="chat-read-summary"><span>{identityOnly ? 'History loaded; deletion unavailable.' : empty ? 'History could not be loaded.' : 'History is incomplete. Showing available and last verified chats.'}</span><button className="btn btn-ghost" disabled={loading} onClick={onRetry}>Retry</button></div>
    <details><summary>Read details</summary>{[...groups].map(([key,{failure,profiles}])=><p key={key}><strong>{profiles.join(', ')}</strong><br /><span className="mono">{failure.operation} · {failure.code}{failure.status !== undefined ? ` · HTTP ${failure.status}` : ' · no HTTP status'}</span><br />{failure.message}</p>)}</details>
  </section>;
}

export function DeleteDialog({target,device,source,available,onClose,onFinished}:{target:BrowserChat;device:string;source:ChatSource;available:()=>boolean;onClose:()=>void;onFinished:(message:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null), lock=useRef(false);
  const request=useRef<AbortController | null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return ()=>{if(previous instanceof HTMLElement && previous.isConnected) previous.focus();};},[]);
  async function confirm() {
    if(lock.current || !available()) return;
    lock.current=true;setBusy(true);
    const controller=new AbortController();request.current=controller;
    try {await source.delete(target,true,controller.signal);if(!controller.signal.aborted) onFinished('Deletion acknowledged; exact session no longer returned. Refreshing Chats.');}
    catch(err) {if(!controller.signal.aborted) onFinished(err instanceof Error ? err.message : 'Deletion could not be verified. Refresh Chats.');}
  }
  return <dialog ref={dialog} className="chat-delete-dialog" aria-labelledby="delete-title" onCancel={event=>{event.preventDefault();if(!busy) onClose();}}><h2 id="delete-title">Delete this session?</h2><p>The stored session “{target.title || 'Untitled'}” and its messages will be deleted. Branch and compression continuations may remain. This cannot be undone.</p><p className="mono">{device} / {target.profile}<br />{target.id}</p><div className="sheet-actions"><button className="btn btn-ghost" autoFocus disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-destructive" disabled={busy || !available()} onClick={()=>void confirm()}>{busy ? 'Deleting…' : 'Delete'}</button></div></dialog>;
}
