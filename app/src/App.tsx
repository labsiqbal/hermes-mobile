import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { AuthError, ConnectionStore, HermesConnection, type SavedConnection, type SessionSummary } from './lib/hermes-client';
import { ConversationViews, ManageViews, ShellNavigation, conversationKey, type ShellRoute, type ShellScreen } from './lib/shell-state';
import { markActive, markInactive, recordSessionEvent } from './lib/active-sessions';
import { activityKey, activityRevision, invalidateActivity, linkActivity, reconcileRunning, recordActivity } from './lib/session-activity';
import './components/session-activity.css';
import { rememberBotThread } from './lib/chat-browser';
import Connections from './screens/Connections';
import ProjectBrowser from './screens/ProjectBrowser';
import type { ProjectFolder } from './lib/project-folders';
import ChatView from './screens/ChatView';

import { Groups } from './screens/Groups';
import { Settings } from './screens/Settings';
import { Appearance } from './screens/Appearance';
import Header from './components/Header';
import TabBar, { type NavId } from './components/TabBar';
import CommandPalette from './components/CommandPalette';
import { SquarePen, MoreHorizontal } from 'lucide-react';

const BotsScreen = lazy(() => import('./screens/Bots').then(module => ({ default: module.BotsScreen })));
const Manage = lazy(() => import('./screens/Manage'));
const Cronjobs = lazy(() => import('./screens/Cronjobs'));
const Workspace = lazy(() => import('./screens/Workspace'));

const TITLES: Record<ShellScreen, string> = { home:'Hermes', chats:'Chats', bots:'Bots', activity:'Cronjobs', manage:'Manage', groups:'Groups', settings:'Settings', appearance:'Appearance', workspace:'Workspace', chat:'Chat' };
const ROOTS: ShellScreen[] = ['chats', 'bots', 'activity', 'manage'];

/** Contain chunk/render failures in the body, never the shared navigation or chat.
 * A new destination/context remounts this boundary; failed imports are not retried. */
class ScreenBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  render() {
    if (this.state.error) return <section className="body restore-body" role="alert">
      <h2>{this.props.title} unavailable</h2>
      <p>This screen could not load or render. Use the navigation to leave this view. Reloading the app may lose unsent drafts.</p>
      <p style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</p>
    </section>;
    return <Suspense fallback={<div className="body restore-body" role="status">Loading {this.props.title}…</div>}>
      {this.props.children}
    </Suspense>;
  }
}

/** Freeze the resume seed for a mounted conversation. Updating its history entry
 * with the server identity must not trigger a second session.new/resume. */
function ConversationSurface(props: ComponentProps<typeof ChatView>) {
  const [seed] = useState(props.session);
  return <ChatView {...props} session={seed} />;
}

export default function App() {
  const store = useMemo(() => new ConnectionStore(), []);
  const [navigation] = useState(() => new ShellNavigation(window.history));
  const [route, setRoute] = useState(navigation.current);
  const [views] = useState(() => new ConversationViews());
  const [manageViews] = useState(() => new ManageViews());
  const [activeConn, setActiveConn] = useState<SavedConnection | null>(null);
  const [client, setClient] = useState<HermesConnection | null>(null);
  const subscribeState = useCallback((notify: () => void) => client?.addStateHandler(notify) ?? (() => {}), [client]);
  const connState = useSyncExternalStore(subscribeState, () => client?.connectionState ?? 'idle');
  const [restoreError, setRestoreError] = useState('');
  const [restoreSignIn, setRestoreSignIn] = useState<SavedConnection | null>(null);
  const [retry, setRetry] = useState(0);
  const [palette, setPalette] = useState(false);
  const [openedSessions,setOpenedSessions]=useState<{gateway:string;session:SessionSummary}[]>([]);
  const [desktop,setDesktop]=useState(()=>window.matchMedia('(min-width: 1000px)').matches);
  useEffect(()=>{const media=window.matchMedia('(min-width: 1000px)');const change=()=>setDesktop(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const screen = route.screen;
  const gatewayId = route.gateway?.id;
  const gatewayUrl = route.gateway?.url;
  const matched = !!activeConn && !!client && activeConn.id === route.gateway?.id && activeConn.url === route.gateway?.url;

  const signInTarget = matched
    ? connState === 'auth-required' ? activeConn : null
    : restoreSignIn?.id === gatewayId && restoreSignIn?.url === gatewayUrl ? restoreSignIn : null;
  const needsSignIn = !!signInTarget;

  function go(next: ShellRoute, replace = false) {
    setPalette(false);
    setRoute(navigation.go(next, replace));
  }
  function destination(next: ShellScreen) {
    go({screen: next, gateway:route.gateway, profile:'default'});
  }
  function back() { setPalette(false); setRoute(navigation.back()); }

  useEffect(() => {
    const restore = () => { setPalette(false); setRestoreError(''); setRoute(navigation.restore()); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [navigation]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPalette(value => !value);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => document.documentElement.style.setProperty('--viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
  }, []);

  // History stores only connection identity, never credentials or a client.
  // Restore the exact saved gateway before mounting a session from that entry.
  useEffect(() => {
    if (!gatewayId || !gatewayUrl || matched) return;
    const target = store.list().find(c => c.id === gatewayId && c.url === gatewayUrl);
    let cancelled = false;
    let adopted = false;
    // This is an asynchronous gateway restoration result, including a removed registry entry.
    queueMicrotask(() => {
      if (!cancelled) {
        setRestoreSignIn(null);
        setRestoreError(target ? '' : 'This saved gateway was removed or changed. Choose a device to continue.');
      }
    });
    if (!target) return () => { cancelled = true; };
    const fresh = new HermesConnection({url:target.url, username:target.username});
    fresh.connect().then(() => {
      if (cancelled) { fresh.disconnect(); return; }
      adopted = true;
      client?.disconnect();
      setActiveConn(target); setClient(fresh);
    }).catch(error => {
      fresh.disconnect();
      if (cancelled) return;
      if (error instanceof AuthError && (error.status === 401 || error.status === 403)) {
        setRestoreSignIn(target);
      } else {
        setRestoreError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; if (!adopted) fresh.disconnect(); };
  }, [gatewayId, gatewayUrl, matched, store, client, retry]);

  useEffect(() => {
    if (!client || !activeConn) return;
    return client.addEventHandler(event => {
      const sid = event.session_id;
      if (!sid) return;
      recordActivity(activityKey(activeConn.id,activeConn.url,sid),event);
      if (event.type === 'message.start') markActive(activeConn.id, sid);
      recordSessionEvent(client, event, client.replayGeneration);
      if (event.type === 'message.complete' || event.type === 'error') markInactive(activeConn.id, sid);
    });
  }, [client, activeConn]);

  useEffect(()=>{
    if(!client || !activeConn)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;let generation=0;
    async function poll(){
      const version=generation;
      const revision=activityRevision();
      try {
        const result=await client!.rpc<{sessions:unknown}>('session.active_list',{});
        if(!Array.isArray(result?.sessions))throw new Error('Invalid live sessions');
        const rows=result.sessions.map(row=>{
          if(!row || typeof row.id!=='string' || typeof row.session_key!=='string' || !['idle','starting','waiting','working','streaming','resuming'].includes(row.status))throw new Error('Invalid live session');
          return row;
        });
        if(cancelled || version!==generation)return;
        if(revision!==activityRevision()){timer=setTimeout(poll,5000);return;}
        for(const row of rows){
          const key=activityKey(activeConn!.id,activeConn!.url,row.id);
          linkActivity(key,activityKey(activeConn!.id,activeConn!.url,row.session_key));
          reconcileRunning(key,row.status!=='idle');
        }
      } catch { /* A failed read is not evidence of completion. */ }
      if(!cancelled && version===generation)timer=setTimeout(poll,5000);
    }
    const stop=client.addStateHandler(state=>{generation++;clearTimeout(timer);invalidateActivity(activeConn.id,activeConn.url);if(state==='open')void poll();});
    if(client.connectionState==='open')void poll();
    return()=>{cancelled=true;generation++;clearTimeout(timer);stop();};
  },[client,activeConn]);

  function adopt(conn: SavedConnection, connected: HermesConnection) {
    if (client !== connected) client?.disconnect();
    setActiveConn(conn); setClient(connected); setRestoreError(''); setRestoreSignIn(null);
  }
  function handleConnect(conn: SavedConnection, connected: HermesConnection) {
    adopt(conn, connected);
    go({ screen:'chats', gateway:{id:conn.id, url:conn.url}, profile:'default' });
  }
  function disconnect() {
    client?.disconnect(); setClient(null); setActiveConn(null);
    go({screen:'home', profile:'default'}, true);
  }
  function openChat(session: SessionSummary | null, returnTo = ROOTS.includes(screen) ? screen as NavId : 'chats' as NavId) {
    go({screen:'chat', gateway:route.gateway, profile:session?.profile || 'default',
      conversation:{id:session?.id ?? `draft:${crypto.randomUUID()}`, session}, returnTo});
  }
  function openGroup(roomId: string) {
    go({screen:'chat', gateway:route.gateway, profile:'default', conversation:{id:roomId, session:null, groupId:roomId}, returnTo:'groups'});
  }
  function openChatById(sessionId: string, profile: string, unpersisted = false) {
    openChat({id:sessionId, title:'', preview:'', started_at:0, message_count:0, source:'mobile', profile, unpersisted}, 'bots');
  }
  function newFolderChat(folder:ProjectFolder) {
    go({screen:'chat',gateway:route.gateway,profile:'default',conversation:{id:`draft:${crypto.randomUUID()}`,session:null},initialFolder:folder.path,returnTo:'chats'});
  }
  const projectGateway=JSON.stringify([activeConn?.id,activeConn?.url]);
  const projectBrowser=matched && !needsSignIn && <ProjectBrowser key={projectGateway} conn={activeConn!} client={client!} onOpenChat={session=>openChat(session,'chats')} onNewFolderChat={newFolderChat} selectedId={route.conversation?.session?.id} openedSessions={openedSessions.filter(row=>row.gateway===projectGateway).map(row=>row.session)} />;

  const isRoot = ROOTS.includes(screen) && !(screen==='bots' && route.botProfile) || screen==='home' || screen==='groups';
  // Root collections span profiles; Manage owns its explicit profile selection.
  // Only a conversation supplies authoritative profile context to the shell.
  const context = matched ? `${activeConn!.label}${screen === 'workspace' && route.conversation ? ` / ${route.profile}` : ''}` : 'Choose a gateway';
  const search = <button className="iconbtn" onClick={() => setPalette(true)} aria-label="Open command palette" title="Navigation (Ctrl+K)"><MoreHorizontal size={20} /></button>;
  const workspace = matched && <div className="screen workspace-screen">
    <Header title="Workspace" subtitle={context} state={connState} onBack={back} right={search} />
    <main className="shell-body shell-detail workspace-shell">
      <ScreenBoundary key={conversationKey(route)} title="Workspace">
        <Workspace conn={activeConn!} client={client!} session={route.conversation?.session ?? null} onBack={back} />
      </ScreenBoundary>
    </main>
  </div>;
  let content;
  if (!route.gateway) {
    content = <div className="screen"><Header title="Hermes" subtitle="Your personal relay" state="idle" right={search} /><div className="shell-body shell-detail"><Connections store={store} onConnect={handleConnect} /></div></div>;
  } else if (needsSignIn) {
    content = <div className="screen"><Header title="Sign in" subtitle={signInTarget!.label} state="auth-required" /><main className="body connections-body"><p role="alert">Your session expired. Sign in to continue.</p><Connections key={JSON.stringify([signInTarget!.id, signInTarget!.url])} store={store} embedded initialUnlockId={signInTarget!.id} onConnect={(conn, connected) => {
      if (conn.id === gatewayId && conn.url === gatewayUrl) adopt(conn, connected);
      else handleConnect(conn, connected);
    }} /></main></div>;
  } else if (!matched) {
    content = <div className="screen"><Header title={TITLES[screen]} subtitle="Restoring gateway context" state={restoreError ? 'error' : 'connecting'} onBack={back} /><main className="body restore-body"><p role={restoreError ? 'alert' : 'status'}>{restoreError || 'Connecting to the saved gateway before opening this view…'}</p>{restoreError && <button className="btn btn-primary" onClick={() => setRetry(value => value + 1)}>Retry connection</button>}<button className="btn btn-ghost" onClick={disconnect}>Choose another device</button></main></div>;
  } else if (screen === 'chat' || (screen === 'workspace' && route.conversation)) {
    const identity = conversationKey(route);
    content = <div className="conversation-stack">
      <div className="conversation-pane" hidden={screen !== 'chat'}>
        <ConversationSurface key={identity} conn={activeConn!} client={client!} session={route.conversation!.session}
          initialFolder={route.initialFolder}
          group={route.conversation!.groupId ? {roomId:route.conversation!.groupId} : undefined} state={connState}
          onBack={back} onNewChat={() => route.returnTo==='bots' ? go({screen:'bots',gateway:route.gateway,profile:'default',botProfile:route.profile}) : route.conversation?.groupId ? destination('groups') : openChat(null)} viewKey={identity} views={views} visible={screen === 'chat'}
          onSessionReady={session => {
            const current = navigation.current;
            if (conversationKey(current) !== identity || !current.conversation) return;
            if(current.returnTo==='bots') rememberBotThread(activeConn!,session);
            if(current.returnTo==='chats') setOpenedSessions(previous=>[...previous.filter(row=>!(row.gateway===projectGateway&&row.session.id===session.id&&row.session.profile===session.profile)),{gateway:projectGateway,session}]);
            const next = {...current, profile:session.profile || current.profile, conversation:{...current.conversation, session}};
            const nextIdentity = conversationKey(next);
            if (nextIdentity !== identity) views.link(identity, nextIdentity);
            // Keep the mounted route/creation seed stable, but share view state
            // with canonical list entries and verified continuation identities.
            for (const id of [session.id, session.resolved_id]) {
              if (id) views.link(nextIdentity, conversationKey({...next, conversation:{...next.conversation, id}}));
            }
            go(next, true);
          }}
          onWorkspace={route.conversation!.groupId ? undefined : () => go({...navigation.current, screen:'workspace'})}
          onPalette={() => setPalette(true)} />
      </div>
      {screen === 'workspace' && workspace}
    </div>;
  } else if (screen === 'workspace') {
    content = workspace;
  } else {
    content = <div className="screen">
      <Header title={screen==='groups' ? 'Bots' : screen==='home' ? 'Chats' : screen==='bots' && route.botProfile ? route.botProfile : TITLES[screen]} subtitle={context} state={connState} onSettings={()=>destination('settings')} onBack={isRoot ? undefined : back}
        right={<>{search}{(screen === 'chats' || screen==='home') && <button className="iconbtn" onClick={() => openChat(null)} aria-label="New chat" title="New chat" disabled={connState !== 'open'}><SquarePen size={20} /></button>}</>} />
      <div className={`shell-body${isRoot ? '' : ' shell-detail'}`}>
        {connState !== 'open' && <div className="connection-notice" role="status">{connState === 'connecting' ? 'Reconnecting…' : 'Gateway unavailable.'} Lists may be out of date. Unsent drafts stay in this tab.</div>}
        <ScreenBoundary key={JSON.stringify([screen, gatewayId, gatewayUrl])} title={TITLES[screen]}>
          {(screen==='chats' || screen==='home') && (desktop ? <div className="desktop-empty"><button className="btn btn-ghost" onClick={()=>openChat(null)}><SquarePen size={18}/>New chat</button></div> : projectBrowser)}
          {(screen==='bots' && !route.botProfile || screen==='groups') && <div className="bots-switch" aria-label="Bot collections"><button aria-pressed={screen==='bots'} onClick={()=>destination('bots')}>Bots</button><button aria-pressed={screen==='groups'} onClick={()=>destination('groups')}>Groups</button></div>}
          {screen === 'bots' && <BotsScreen key={route.botProfile || 'roster'} onOpenChat={openChatById} onOpenSession={session=>openChat(session,'bots')} selectedProfile={route.botProfile} onSelectProfile={name=>go({screen:'bots',gateway:route.gateway,profile:'default',botProfile:name})} client={client!} conn={activeConn!} />}
          {screen === 'groups' && <Groups client={client!} conn={activeConn!} onOpenGroup={openGroup} />}
          {screen === 'activity' && <Cronjobs client={client!} conn={activeConn!} />}
          {screen === 'manage' && <><button className="collection-link" onClick={()=>destination('activity')}>Cronjobs</button><Manage conn={activeConn!} client={client!} navigationViews={manageViews} onSettings={() => destination('settings')} onBots={() => destination('bots')} onWorkspace={() => destination('workspace')} /></>}
          {screen === 'settings' && <Settings conn={activeConn!} store={store} state={connState} onConnect={handleConnect} onDisconnect={disconnect} />}
          {screen === 'appearance' && <Appearance />}
        </ScreenBoundary>
      </div>
      {isRoot && <TabBar active={screen==='groups' ? 'bots' : screen==='home' ? 'chats' : screen as NavId} onNavigate={destination} />}
    </div>;
  }
  return <><div className={desktop&&matched&&!needsSignIn?'desktop-layout':'app-layout'}>{desktop&&matched&&!needsSignIn&&<aside className="desktop-sidebar"><div className="sidebar-brand">Hermes<button className="iconbtn" title="New chat" aria-label="New chat" onClick={()=>openChat(null)}><SquarePen size={18}/></button></div>{projectBrowser}</aside>}<div className="desktop-main">{content}</div></div>{palette && <CommandPalette onClose={() => setPalette(false)} onNavigate={destination} connected={matched} />}</>;
}
