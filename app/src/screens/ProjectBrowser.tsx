import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, MoreHorizontal, Pin, Palette, Plus, RefreshCw, Search, SquarePen, Trash2, X } from 'lucide-react';
import { DeleteDialog } from './ChatList';
import { isActive } from '../lib/active-sessions';
import type { HermesConnection, SavedConnection, SessionSummary } from '../lib/hermes-client';
import { ChatSource } from '../lib/chat-source';
import { chatKey, isBotThread, readBotThreads, readIds, uniqueChats } from '../lib/chat-browser';
import { folderContains, folderKey, moveProject, readFolders, type ProjectFolder } from '../lib/project-folders';
import { absolutePathCompletions, pathCompletionContext, safeServerFolder } from './ChatView';

interface Props { conn: SavedConnection; client: HermesConnection; onOpenChat: (row:SessionSummary|null)=>void; onNewFolderChat:(folder:ProjectFolder)=>void; selectedId?:string; openedSessions?:SessionSummary[] }
type Snapshot=Awaited<ReturnType<ChatSource['load']>>;
type TreeFolder=ProjectFolder & { rows:SessionSummary[]; remoteId?:string };

export default function ProjectBrowser({conn,client,onOpenChat,onNewFolderChat,selectedId,openedSessions=[]}:Props) {
  const source=useMemo(()=>new ChatSource(client),[client]);
  const key=folderKey(conn);
  const [folders,setFolders]=useState(()=>readFolders(key));
  const [order,setOrder]=useState(()=>[...readIds(key+':order')]);
  const [collapsed,setCollapsed]=useState(()=>readIds(key+':collapsed'));
  const [data,setData]=useState<Snapshot>();
  const [hydrated,setHydrated]=useState<Record<string,SessionSummary[]>>({});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [pendingDelete,setPendingDelete]=useState<SessionSummary|null>(null);
  const [deleted,setDeleted]=useState(()=>new Set<string>());
  const [query,setQuery]=useState('');
  const [adding,setAdding]=useState(false);
  const [menu,setMenu]=useState<TreeFolder|null>(null);
  const menuAnchor=useRef<HTMLElement|null>(null);
  const [editing,setEditing]=useState<TreeFolder|null>(null);
  const [pinned,setPinned]=useState(()=>readIds(key+':pinned'));
  const [hidden,setHidden]=useState(()=>readIds(key+':hidden'));
  const [color,setColor]=useState(()=>{try{return localStorage.getItem(key+':color') || '';}catch{return '';}});
  const touchDrag=useRef<{id:string;pointer:number;timer:ReturnType<typeof setTimeout>;active:boolean;y:number;scrolling:boolean}|null>(null);
  const suppressClick=useRef(false);
  const [dropTarget,setDropTarget]=useState<string|null>(null);
  useEffect(()=>()=>{if(touchDrag.current)clearTimeout(touchDrag.current.timer);},[]);
  const [dragging,setDragging]=useState<string|null>(null);
  const generation=useRef(0);
  const requested=useRef(new Set<string>());
  const load=useCallback(async()=>{
    const version=++generation.current;
    setLoading(true);setError('');requested.current.clear();
    try {const next=await source.load();if(version===generation.current){setData(next);setHydrated({});}}
    catch {if(version===generation.current)setError('Could not load projects. Try refreshing.');}
    finally {if(version===generation.current)setLoading(false);}
  },[source]);
  useEffect(()=>{
    // oxlint-disable-next-line react/set-state-in-effect -- Read the gateway's project registry.
    void load();
    const stop=client.addStateHandler(state=>{if(state==='open')void load();});
    return ()=>{
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Generation counter, not a DOM ref.
      generation.current++;stop();
    };
  },[client,load]);
  useEffect(()=>{
    if(!data || loading)return;
    for(const p of data.projects) {
      if(p.isNoProject || collapsed.has(p.id) || requested.current.has(p.id))continue;
      requested.current.add(p.id);const version=generation.current;
      source.project(p.sourceId,p.profile).then(full=>{
        if(version===generation.current)setHydrated(previous=>({...previous,[p.id]:full.repos?.flatMap(r=>r.groups?.flatMap(g=>g.sessions || []) || []) || full.previewSessions || []}));
      }).catch(()=>{if(version===generation.current)setError('Some project history could not load. Refresh to retry.');});
    }
  },[data,loading,collapsed,source]);
  function save(suffix:string,value:unknown) {
    try {localStorage.setItem(key+suffix,JSON.stringify(value));}catch {setError('Changes are available in this tab, but this browser could not save them.');}
  }
  const ordinary=(rows:SessionSummary[])=>uniqueChats(rows).filter(row=>!deleted.has(chatKey(row))&&!isBotThread(row,data?.profiles || [],readBotThreads(conn)));
  const stored=[...(data?.sessions || []),...(data?.projects.flatMap(p=>p.previewSessions || []) || []),...Object.values(hydrated).flat()];
  const opened=openedSessions.map(row=>{const saved=stored.find(item=>chatKey(item)===chatKey(row));return {...row,title:row.title || saved?.title || '',preview:row.preview || saved?.preview || ''};});
  const all=ordinary([...opened,...stored]);
  const tree:TreeFolder[]=folders.map(folder=>({...folder,rows:all.filter(row=>row.profile===folder.profile && folderContains(folder.path,row.cwd))}));
  for(const project of data?.projects || []) {
    if(project.isNoProject)continue;
    const rows=ordinary(hydrated[project.id] || project.previewSessions || []);
    if(!rows.length)continue;
    const path=rows.find(row=>row.git_repo_root)?.git_repo_root || rows.find(row=>row.cwd)?.cwd || '';
    if(tree.some(folder=>folder.id===project.id || folder.profile===project.profile && folder.path===path))continue;
    tree.push({id:project.id,name:project.label,path,profile:project.profile,rows:ordinary([...opened.filter(row=>row.profile===project.profile && folderContains(path,row.cwd)),...rows]),remoteId:project.sourceId});
  }
  for(let i=tree.length-1;i>=0;i--)if(hidden.has(tree[i].id))tree.splice(i,1);
  tree.sort((a,b)=>{const pin=Number(pinned.has(b.id))-Number(pinned.has(a.id));const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return pin || (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);});
  const assigned=new Set(tree.flatMap(p=>p.rows.map(chatKey)));
  const recent=all.filter(row=>!assigned.has(chatKey(row)));
  const match=(row:SessionSummary)=>`${row.title} ${row.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  function reorder(from:string,to:string) {const next=moveProject(tree.map(p=>p.id),from,to);setOrder(next);save(':order',next);}
  function toggle(id:string){const next=new Set(collapsed);if(next.has(id))next.delete(id);else next.add(id);setCollapsed(next);save(':collapsed',[...next]);}
  const canDelete=(row:SessionSummary)=>!loading && !!data && !data.failedProfiles.includes(row.profile || '') && row.profile===data.profile && client.connectionState==='open' && ![row.id,row.resolved_id].filter(Boolean).includes(selectedId) && !isActive(conn.id,row.id,row.resolved_id);
  function renderRow(row:SessionSummary) {return <div key={chatKey(row)} className="project-session-wrap"><button className="project-session" aria-current={selectedId===row.id?'page':undefined} title={row.title || 'Untitled'} data-session-id={row.id} onClick={()=>onOpenChat(row)}><span>{row.title || 'Untitled'}</span></button><button className="iconbtn session-trash" title={canDelete(row)?'Delete session':'Only inactive sessions in the running profile can be deleted'} aria-label={`Delete session ${row.title || 'Untitled'}`} disabled={!canDelete(row)} onClick={()=>setPendingDelete(row)}><Trash2 size={15}/></button></div>;}
  return <div className="project-browser">
    <label className="project-search"><Search size={16}/><input aria-label="Search conversations" placeholder="Search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="project-section-title"><h2>Projects</h2><button className="iconbtn" title="Refresh projects" aria-label="Refresh projects" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/></button><button className="iconbtn" title="Add project" aria-label="Add project" onClick={()=>setAdding(true)}><Plus size={17}/></button></div>
    {error && <p className="error-line" role="alert">{error}</p>}
    {!!data?.readFailures.length && <p className="hint" role="status">Some history is unavailable. Refresh to retry.</p>}
    {loading && !data && <p className="hint" role="status">Loading projects...</p>}
    <div className="project-tree">{tree.map(folder=>{
      const rows=folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? folder.rows : folder.rows.filter(match);
      if(query && !rows.length && !folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))return null;
      const open=!collapsed.has(folder.id) || !!query;
      return <section key={folder.id} data-folder-id={folder.id} className={`tree-project${dragging===folder.id?' dragging':''}${dropTarget===folder.id?' drop-target':''}`} onDragOver={e=>{if(dragging){e.preventDefault();setDropTarget(folder.id);e.dataTransfer.dropEffect='move';}}} onDrop={e=>{e.preventDefault();if(dragging)reorder(dragging,folder.id);setDragging(null);setDropTarget(null);}}>
        <div className="tree-project-heading" draggable onDragStart={e=>{setDragging(folder.id);e.dataTransfer.setData('text/plain',folder.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setDragging(null);setDropTarget(null);}}
          onPointerDown={e=>{if(e.pointerType!=='touch' || !(e.target as HTMLElement).closest('.tree-project-toggle'))return;const element=e.currentTarget;const pointer=e.pointerId;suppressClick.current=false;const state={id:folder.id,pointer,active:false,y:e.clientY,scrolling:false,timer:setTimeout(()=>{if(state.scrolling)return;state.active=true;setDragging(folder.id);element.setPointerCapture(pointer);},350)};touchDrag.current=state;}}
          onPointerMove={e=>{const state=touchDrag.current;if(!state)return;const scroller=e.currentTarget.closest<HTMLElement>('.project-browser');if(!state.active){const delta=state.y-e.clientY;if(state.scrolling||Math.abs(delta)>6){clearTimeout(state.timer);state.scrolling=true;if(scroller)scroller.scrollTop+=delta;state.y=e.clientY;}return;}e.preventDefault();if(scroller){const bounds=scroller.getBoundingClientRect();if(e.clientY<bounds.top+40)scroller.scrollTop-=12;else if(e.clientY>bounds.bottom-40)scroller.scrollTop+=12;}const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-folder-id]');setDropTarget(target?.dataset.folderId || null);}}
          onPointerUp={e=>{const state=touchDrag.current;if(!state)return;clearTimeout(state.timer);if(state.active){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;if(target)reorder(state.id,target);}suppressClick.current=state.active||state.scrolling;touchDrag.current=null;setDragging(null);setDropTarget(null);}}
          onPointerCancel={()=>{if(touchDrag.current)clearTimeout(touchDrag.current.timer);touchDrag.current=null;setDragging(null);setDropTarget(null);}}>
          <button className="tree-project-toggle" aria-expanded={open} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title={folder.path || folder.name} onKeyDown={e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();const target=tree[tree.findIndex(p=>p.id===folder.id)+(e.key==='ArrowUp'?-1:1)];if(target)reorder(folder.id,target.id);}}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}toggle(folder.id);}}>{open?<FolderOpen size={17} style={{color:color||undefined}}/>:<Folder size={17} style={{color:color||undefined}}/>}<span>{folder.name}</span>{pinned.has(folder.id)&&<Pin size={12}/>}</button>
          <button className="iconbtn tree-action" aria-label={`Project actions for ${folder.name}`} aria-haspopup="menu" title="Project actions" onClick={e=>{menuAnchor.current=e.currentTarget;setMenu(folder);}}><MoreHorizontal size={16}/></button>
          <button className="iconbtn tree-action" aria-label={`New session in ${folder.name}`} title="New session" disabled={!safeServerFolder(folder.path) || folder.profile!=='default' || client.connectionState!=='open'} onClick={()=>onNewFolderChat(folder)}><SquarePen size={16}/></button>
        </div>
        {open && <div className="tree-project-sessions">{rows.sort((a,b)=>b.started_at-a.started_at).map(renderRow)}{!rows.length && <span className="tree-empty">No sessions</span>}</div>}
      </section>;
    })}</div>
    {recent.filter(match).length>0 && <section className="tree-recent"><div className="project-section-title"><h2>Chats</h2><button className="iconbtn" title="New chat" aria-label="New chat" onClick={()=>onOpenChat(null)}><SquarePen size={17}/></button></div>{recent.filter(match).map(renderRow)}</section>}
    {adding && <FolderDialog client={client} onClose={()=>setAdding(false)} onSave={folder=>{const existing=folders.find(p=>p.path===folder.path&&p.profile===folder.profile);if(existing){if(hidden.has(existing.id)){const next=new Set(hidden);next.delete(existing.id);setHidden(next);save(':hidden',[...next]);setAdding(false);}else setError('That folder is already in Projects.');return;}const next=[...folders,folder];setFolders(next);save('',next);setAdding(false);}}/>}
    {editing && <FolderDialog client={client} initial={editing} onClose={()=>setEditing(null)} onSave={folder=>{const next=[...folders.filter(p=>p.id!==folder.id),folder];setFolders(next);save('',next);setEditing(null);}}/>}
    {pendingDelete&&<DeleteDialog target={pendingDelete} device={conn.label} source={source} available={()=>canDelete(pendingDelete)} onClose={()=>setPendingDelete(null)} onFinished={message=>{const success=message.startsWith('Deletion acknowledged');if(success)setDeleted(previous=>new Set([...previous,chatKey(pendingDelete)]));setPendingDelete(null);void load().then(()=>{if(!success)setError(message);});}}/>}
    {menu && <ProjectMenu anchor={menuAnchor.current!} pinned={pinned.has(menu.id)} onClose={()=>setMenu(null)} onPin={()=>{const next=new Set(pinned);if(next.has(menu.id))next.delete(menu.id);else next.add(menu.id);setPinned(next);save(':pinned',[...next]);setMenu(null);}} onEdit={()=>{setEditing(menu);setMenu(null);}} onColor={value=>{setColor(value);try{localStorage.setItem(key+':color',value);}catch{setError('Could not save color.');}setMenu(null);}} onRemove={()=>{const next=new Set(hidden);next.add(menu.id);setHidden(next);save(':hidden',[...next]);setMenu(null);}}/>}
  </div>;
}

function FolderDialog({client,onClose,onSave,initial}:{client:HermesConnection;onClose:()=>void;onSave:(p:ProjectFolder)=>void;initial?:ProjectFolder}) {
  const dialog=useRef<HTMLDialogElement>(null),edited=useRef(false);
  const [path,setPath]=useState(initial?.path || ''),[name,setName]=useState(initial?.name || ''),[suggestions,setSuggestions]=useState<string[]>([]),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();const controller=new AbortController();if(!initial)void client.defaultWorkingFolder(controller.signal).then(p=>{if(!edited.current&&!controller.signal.aborted)setPath(p);}).catch(()=>{});return()=>controller.abort();},[client,initial]);
  useEffect(()=>{const context=pathCompletionContext(path);if(!context)return;let cancelled=false;const timer=setTimeout(()=>{void client.completePath(context.word,context.cwd).then(items=>{if(!cancelled)setSuggestions(absolutePathCompletions(path,items));}).catch(()=>{if(!cancelled)setSuggestions([]);});},200);return()=>{cancelled=true;clearTimeout(timer);};},[path,client]);
  return <dialog ref={dialog} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={onClose}><form onSubmit={e=>{e.preventDefault();const normalized=path.trim().replace(/\/+$/,'') || '/';if(!safeServerFolder(normalized)){setError('Choose an absolute server folder path.');return;}onSave({id:initial?.id || crypto.randomUUID(),name:name.trim() || normalized.split('/').filter(Boolean).pop() || '/',path:normalized,profile:initial?.profile || 'default'});}}>
    <div className="project-section-title"><h2 id="project-dialog-title">{initial?'Edit project':'Add project'}</h2><button type="button" className="iconbtn" aria-label="Close project dialog" onClick={onClose}><X size={18}/></button></div>
    <label>Folder on server<input className="field" autoFocus value={path} aria-label="Project folder" onChange={e=>{edited.current=true;setPath(e.target.value);setSuggestions([]);}}/></label>
    {suggestions.length>0 && <div className="project-folder-options">{suggestions.map(value=><button type="button" key={value} onClick={()=>{edited.current=true;setPath(value);setSuggestions([]);}}><Folder size={16}/><span>{value}</span></button>)}</div>}
    <label>Name<input className="field" value={name} aria-label="Project name" placeholder={path.split('/').filter(Boolean).pop() || 'Project'} onChange={e=>setName(e.target.value)}/></label>
    {error&&<p role="alert" className="error-line">{error}</p>}<div className="sheet-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={!safeServerFolder(path.trim())}>{initial?'Save changes':'Add project'}</button></div>
  </form></dialog>;
}
function ProjectMenu({anchor,pinned,onClose,onPin,onEdit,onColor,onRemove}:{anchor:HTMLElement;pinned:boolean;onClose:()=>void;onPin:()=>void;onEdit:()=>void;onColor:(value:string)=>void;onRemove:()=>void}) {
  const ref=useRef<HTMLDivElement>(null);const [colors,setColors]=useState(false);
  useEffect(()=>{const node=ref.current!;const rect=anchor.getBoundingClientRect();node.style.left=`${Math.max(12,Math.min(innerWidth-244,rect.right-232))}px`;node.style.top=`${Math.max(12,Math.min(innerHeight-280,rect.bottom+6))}px`;node.showPopover();node.querySelector<HTMLButtonElement>('button')?.focus();return()=>{if(anchor.isConnected)anchor.focus();};},[anchor]);
  return <div ref={ref} popover="auto" role="menu" aria-label="Project actions" className="project-popover" onToggle={e=>{if(e.newState==='closed')onClose();}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}}}>
    <button role="menuitem" onClick={onPin}><Pin size={16}/>{pinned?'Unpin':'Pin'}</button><button role="menuitem" onClick={onEdit}><SquarePen size={16}/>Edit</button><div className="menu-divider"/>
    <button role="menuitem" onClick={()=>setColors(value=>!value)}><Palette size={16}/>Connection color...</button>{colors&&<div className="project-color-options">{[['Default',''],['Blue','#99baff'],['Green','#a5d6b8'],['Gold','#edc487'],['Rose','#f1a1a6']].map(([name,value])=><button key={name} aria-label={name} title={name} style={{background:value||'var(--fg-dim)'}} onClick={()=>onColor(value)}/>)}</div>}
    <div className="menu-divider"/><button role="menuitem" title="Hide this project from this browser; files and sessions are kept" onClick={onRemove}><X size={16}/>Remove project</button>
  </div>;
}
