import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ConnectionStore,
  HermesConnection,
  type ConnectionState,
  type SavedConnection,
  type SessionSummary,
} from "./lib/hermes-client";
import Home from "./screens/Home";
import Connections from "./screens/Connections";
import ChatList from "./screens/ChatList";
import ChatView from "./screens/ChatView";
import Header from "./components/Header";
import Sidebar, { type NavId } from "./components/Sidebar";
import BotsStub, { type BotsScreenProps } from "./components/BotsStub";
import { Runs } from "./screens/Runs";
import { Groups } from "./screens/Groups";
import { Settings } from "./screens/Settings";

import { markActive, markInactive, recordSessionEvent } from "./lib/active-sessions";

// Keep in sync with package.json (no resolveJsonModule in tsconfig).
const APP_VERSION = "0.1.0";

// Defensive integration: src/screens/Bots.tsx is owned by another agent and may
// not exist yet. A glob (not a literal dynamic import) keeps `tsc`/vite green
// either way; when the module or the named export is missing we render the
// INTEGRATION-STUB instead.
const botsModules = import.meta.glob<{ BotsScreen?: ComponentType<BotsScreenProps> }>(
  "./screens/Bots.tsx",
);
const loadBots = botsModules["./screens/Bots.tsx"];
const BotsScreen: ComponentType<BotsScreenProps> = loadBots
  ? lazy(async () => {
      const mod = await loadBots();
      return mod.BotsScreen ? { default: mod.BotsScreen } : { default: BotsStub };
    })
  : BotsStub;

type Screen = NavId | "chat" | "home";

const TITLES: Record<NavId, string> = {
  chats: "Chats",
  bots: "Bots",
  groups: "Groups",
  runs: "Runs",
  connections: "Connections",
  settings: "Settings",
};

export default function App() {
  const store = useMemo(() => new ConnectionStore(), []);
  const [screen, setScreen] = useState<Screen>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeConn, setActiveConn] = useState<SavedConnection | null>(null);
  const [client, setClient] = useState<HermesConnection | null>(null);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("idle");
  const [chatInstance, setChatInstance] = useState(0);
  /** Where ChatView's back button returns to. */
  const [chatReturnTo, setChatReturnTo] = useState<Screen>("chats");

  // Track active (mid-turn) sessions globally so the badge survives screen switches.
  useEffect(() => {
    if (!client || !activeConn) return;
    const handler = (event: { type: string; session_id?: string }) => {
      const sid = event.session_id;
      if (!sid) return;
      if (event.type === "message.start") markActive(activeConn.id, sid);
      recordSessionEvent(client, event, client.replayGeneration);
      if (event.type === "message.complete" || event.type === "error") {
        markInactive(activeConn.id, sid);
      }
    };
    return client.addEventHandler(handler);
  }, [client, activeConn]);

  // Track the live socket state for the header/sidebar status dot. Initial
  // state is set in handleConnect; here we only subscribe to transitions.
  useEffect(() => {
    if (!client) return;
    return client.addStateHandler(setConnState);
  }, [client]);

  function handleConnect(conn: SavedConnection, connected: HermesConnection) {
    setActiveConn(conn);
    setClient(connected);
    setConnState(connected.connectionState);
    setScreen("chats");
    setDrawerOpen(false);
  }

  function handleDisconnect() {
    client?.disconnect();
    setClient(null);
    setActiveConn(null);
    setActiveSession(null);
    setConnState("idle");
    setScreen("home");
    setDrawerOpen(false);
  }

  function openChat(session: SessionSummary | null) {
    setChatInstance((value) => value + 1);
    setActiveSession(session);
    setActiveGroup(null);
    setChatReturnTo("chats");
    setScreen("chat");
  }

  function openGroup(roomId: string) {
    setChatInstance((value) => value + 1);
    setActiveSession(null);
    setActiveGroup(roomId);
    setChatReturnTo("groups");
    setScreen("chat");
  }

  function openSessionFromHome(conn: SavedConnection, connected: HermesConnection, session: SessionSummary) {
    setChatInstance((value) => value + 1);
    setActiveConn(conn);
    setClient(connected);
    setConnState(connected.connectionState);
    setActiveSession(session);
    setActiveGroup(null);
    setChatReturnTo("home");
    setScreen("chat");
    setDrawerOpen(false);
  }

  // Integration contract for BotsScreen: it only knows a session id, so wrap
  // it in a minimal summary — ChatView resumes the full session by id.
  function openChatById(sessionId: string) {
    openChat({
      id: sessionId,
      title: "",
      preview: "",
      started_at: 0,
      message_count: 0,
      source: "bots",
    });
  }

  function handleNavigate(nav: NavId) {
    setScreen(nav);
    setDrawerOpen(false);
  }

  // ── home: device picker with recent sessions ─────────────────────────────
  if (screen === "home") {
    return (
      <Home
        store={store}
        onConnect={handleConnect}
        onOpenSession={openSessionFromHome}
        onManageDevices={() => setScreen("connections")}
      />
    );
  }

  // ── not connected: device picker only ────────────────────────────────────
  if (!activeConn || !client) {
    return <Connections store={store} onConnect={handleConnect} />;
  }

  // ── inside a chat / group: ChatView owns its own appbar + back button ────
  if (screen === "chat") {
    return (
      <ChatView
        key={chatInstance}
        conn={activeConn}
        client={client}
        session={activeSession}
        group={activeGroup ? { roomId: activeGroup } : undefined}
        onBack={() => setScreen(chatReturnTo)}
        onNewChat={() => openChat(null)}
      />
    );
  }

  // ── connected: header + sidebar drawer shell ─────────────────────────────
  return (
    <div className="screen">
      <Header
        title={TITLES[screen as NavId]}
        subtitle={`${activeConn.label} · ${activeConn.url}`}
        state={connState}
        onMenu={() => setDrawerOpen(true)}
      />
      <div className="shell-body">
        {screen === "chats" && (
          <ChatList
            conn={activeConn}
            client={client}
            onOpenChat={openChat}
            onDisconnect={handleDisconnect}
          />
        )}
        {screen === "bots" && (
          <Suspense fallback={null}>
            <BotsScreen onOpenChat={openChatById} client={client} conn={activeConn} />
          </Suspense>
        )}
        {screen === "groups" && (
          <Groups client={client} conn={activeConn} onOpenGroup={openGroup} />
        )}
        {screen === "runs" && <Runs client={client} conn={activeConn} />}
        {screen === "connections" && (
          <Connections store={store} onConnect={handleConnect} embedded />
        )}
        {screen === "settings" && (
          <Settings conn={activeConn} onDisconnect={handleDisconnect} />
        )}
      </div>
      <Sidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conn={activeConn}
        state={connState}
        active={screen as NavId}
        onNavigate={handleNavigate}
        onDisconnect={handleDisconnect}
        version={APP_VERSION}
      />
    </div>
  );
}
