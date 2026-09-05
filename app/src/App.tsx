import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { BOT_CHAT_TITLE, ConnectionStore, HermesConnection, type SavedConnection, type SessionSummary } from './lib/hermes-client';
import { ConversationViews, ManageViews, ShellNavigation, conversationKey, type ShellRoute, type ShellScreen } from './lib/shell-state';
import { markActive, markInactive, recordSessionEvent } from './lib/active-sessions';
import Home from './screens/Home';
import Connections from './screens/Connections';
import ChatList from './screens/ChatList';
import ChatView from './screens/ChatView';
import { Runs } from './screens/Runs';
import { Groups } from './screens/Groups';
import { Settings } from './screens/Settings';
import Header from './components/Header';
import TabBar, { type NavId } from './components/TabBar';
import CommandPalette from './components/CommandPalette';
import { PlusIcon, SearchIcon, UsersIcon } from './components/icons';

const BotsScreen = lazy(() => import('./screens/Bots').then(module => ({ default: module.BotsScreen })));
const Manage = lazy(() => import('./screens/Manage'));
const Workspace = lazy(() => import('./screens/Workspace'));

const TITLES: Record<ShellScreen, string> = { home:'Hermes', chats:'Chats', bots:'Bots', activity:'Activity', manage:'Manage', groups:'Groups', settings:'Settings', workspace:'Workspace', chat:'Chat' };
const ROOTS: ShellScreen[] = ['home', 'chats', 'bots', 'activity', 'manage'];

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
  const [retry, setRetry] = useState(0);
  const [palette, setPalette] = useState(false);
  const screen = route.screen;
  const gatewayId = route.gateway?.id;
  const gatewayUrl = route.gateway?.url;
  const matched = !!activeConn && !!client && activeConn.id === route.gateway?.id && activeConn.url === route.gateway?.url;

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
      if (!cancelled) setRestoreError(target ? '' : 'This saved gateway was removed or changed. Choose a device to continue.');
    });
    if (!target) return () => { cancelled = true; };
    const fresh = new HermesConnection({url:target.url, username:target.username, password:target.password});
    fresh.connect().then(() => {
      if (cancelled) { fresh.disconnect(); return; }
      adopted = true;
      client?.disconnect();
      setActiveConn(target); setClient(fresh);
    }).catch(error => {
      fresh.disconnect();
      if (!cancelled) setRestoreError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; if (!adopted) fresh.disconnect(); };
  }, [gatewayId, gatewayUrl, matched, store, client, retry]);

  useEffect(() => {
    if (!client || !activeConn) return;
    return client.addEventHandler(event => {
      const sid = event.session_id;
      if (!sid) return;
      if (event.type === 'message.start') markActive(activeConn.id, sid);
      recordSessionEvent(client, event, client.replayGeneration);
      if (event.type === 'message.complete' || event.type === 'error') markInactive(activeConn.id, sid);
    });
  }, [client, activeConn]);

  function adopt(conn: SavedConnection, connected: HermesConnection) {
    if (client !== connected) client?.disconnect();
    setActiveConn(conn); setClient(connected); setRestoreError('');
  }
  function handleConnect(conn: SavedConnection, connected: HermesConnection) {
    adopt(conn, connected);
    go({ screen:'home', gateway:{id:conn.id, url:conn.url}, profile:'default' });
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
  function openSessionFromHome(conn: SavedConnection, connected: HermesConnection, session: SessionSummary) {
    adopt(conn, connected);
    go({screen:'chat', gateway:{id:conn.id, url:conn.url}, profile:session.profile || 'default', conversation:{id:session.id, session}, returnTo:'home'});
  }
  function openChatById(sessionId: string, profile: string, unpersisted = false) {
    openChat({id:sessionId, title:BOT_CHAT_TITLE, preview:'', started_at:0, message_count:0, source:'bots', profile, unpersisted}, 'bots');
  }

  const isRoot = ROOTS.includes(screen);
  // Root collections span profiles; Manage owns its explicit profile selection.
  // Only a conversation supplies authoritative profile context to the shell.
  const context = matched ? `${activeConn!.label}${screen === 'workspace' && route.conversation ? ` / ${route.profile}` : ''}` : 'Choose a gateway';
  const search = <button className="iconbtn" onClick={() => setPalette(true)} aria-label="Open command palette" title="Search destinations (Ctrl+K)"><SearchIcon size={20} /></button>;
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
  } else if (!matched) {
    content = <div className="screen"><Header title={TITLES[screen]} subtitle="Restoring gateway context" state={restoreError ? 'error' : 'connecting'} onBack={back} /><main className="body restore-body"><p role={restoreError ? 'alert' : 'status'}>{restoreError || 'Connecting to the saved gateway before opening this view…'}</p>{restoreError && <button className="btn btn-primary" onClick={() => setRetry(value => value + 1)}>Retry connection</button>}<button className="btn btn-ghost" onClick={disconnect}>Choose another device</button></main></div>;
  } else if (screen === 'chat' || (screen === 'workspace' && route.conversation)) {
    const identity = conversationKey(route);
    content = <div className="conversation-stack">
      <div className="conversation-pane" hidden={screen !== 'chat'}>
        <ConversationSurface key={identity} conn={activeConn!} client={client!} session={route.conversation!.session}
          group={route.conversation!.groupId ? {roomId:route.conversation!.groupId} : undefined} state={connState}
          onBack={back} onNewChat={() => openChat(null)} viewKey={identity} views={views} visible={screen === 'chat'}
          onSessionReady={session => {
            const current = navigation.current;
            if (conversationKey(current) !== identity || !current.conversation) return;
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
      <Header title={TITLES[screen]} subtitle={context} state={connState} onBack={isRoot ? undefined : back}
        right={<>{screen === 'chats' && <button className="iconbtn" onClick={() => openChat(null)} aria-label="New chat" disabled={connState !== 'open'}><PlusIcon size={20} /></button>}{search}</>} />
      <div className={`shell-body${isRoot ? '' : ' shell-detail'}`}>
        {connState !== 'open' && <div className="connection-notice" role="status">{connState === 'connecting' ? 'Reconnecting…' : 'Gateway unavailable.'} Lists may be out of date. Unsent drafts stay in this tab.</div>}
        <ScreenBoundary key={JSON.stringify([screen, gatewayId, gatewayUrl])} title={TITLES[screen]}>
          {screen === 'home' && <Home key={activeConn!.id} store={store} conn={activeConn!} client={client!} state={connState} onConnect={handleConnect} onOpenSession={openSessionFromHome} onManageDevices={() => destination('settings')} />}
          {screen === 'chats' && <><button className="collection-link" onClick={() => destination('groups')}><UsersIcon size={20} /><span>Groups <small>Shared bot conversations</small></span><span aria-hidden="true">→</span></button><ChatList key={activeConn!.id} conn={activeConn!} client={client!} onOpenChat={session => openChat(session)} onDisconnect={disconnect} /></>}
          {screen === 'bots' && <BotsScreen onOpenChat={openChatById} client={client!} conn={activeConn!} />}
          {screen === 'groups' && <Groups client={client!} conn={activeConn!} onOpenGroup={openGroup} />}
          {screen === 'activity' && <Runs client={client!} conn={activeConn!} />}
          {screen === 'manage' && <Manage conn={activeConn!} client={client!} navigationViews={manageViews} onSettings={() => destination('settings')} onBots={() => destination('bots')} onWorkspace={() => destination('workspace')} />}
          {screen === 'settings' && <Settings conn={activeConn!} store={store} state={connState} onConnect={handleConnect} onDisconnect={disconnect} />}
        </ScreenBoundary>
      </div>
      {isRoot && <TabBar active={screen as NavId} onNavigate={destination} />}
    </div>;
  }
  return <>{content}{palette && <CommandPalette onClose={() => setPalette(false)} onNavigate={destination} connected={matched} />}</>;
}
