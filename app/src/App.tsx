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
import TabBar, { type NavId } from "./components/TabBar";
import BotsStub, { type BotsScreenProps } from "./components/BotsStub";
import { Runs } from "./screens/Runs";
import { Groups } from "./screens/Groups";
import { Settings } from "./screens/Settings";
import { PlusIcon } from "./components/icons";

import { markActive, markInactive, recordSessionEvent } from "./lib/active-sessions";

// Defensive integration: src/screens/Bots.tsx may not exist yet. A glob (not a
// literal dynamic import) keeps `tsc`/vite green either way; when the module
// or the named export is missing we render the INTEGRATION-STUB instead.
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

type Screen = NavId | "chat";

const TITLES: Record<NavId, string> = {
  board: "Hermes",
  chats: "Chats",
  groups: "Groups",
  bots: "Bots",
  runs: "Runs",
  settings: "Settings",
};

const SUBTITLES: Record<NavId, string | undefined> = {
  board: undefined, // Board subtitle = connection line (filled from state below).
  chats: "all sessions",
  groups: "bot group rooms",
  bots: "profiles on this machine",
  runs: "cron & scheduled runs",
  settings: "connection & preferences",
};

export default function App() {
  const store = useMemo(() => new ConnectionStore(), []);
  // Entry point = Board (devices + recent sessions); tap a session to chat.
  const [screen, setScreen] = useState<Screen>("board");
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

  // Track the live socket state for the header status dot. Initial state is set
  // in handleConnect; here we only subscribe to transitions.
  useEffect(() => {
    if (!client) return;
    return client.addStateHandler(setConnState);
  }, [client]);

  function handleConnect(conn: SavedConnection, connected: HermesConnection) {
    setActiveConn(conn);
    setClient(connected);
    setConnState(connected.connectionState);
    // Land back on the Board: sessions are picked from the board.
    setScreen("board");
  }

  function handleDisconnect() {
    client?.disconnect();
    setClient(null);
    setActiveConn(null);
    setActiveSession(null);
    setConnState("idle");
    setScreen("board");
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
    setChatReturnTo("board");
    setScreen("chat");
  }

  // Integration contract for BotsScreen: it only knows a session id, so wrap
  // it in a minimal summary — ChatView resumes the full session by id.
  function openChatById(sessionId: string, profile: string, unpersisted = false) {
    openChat({
      id: sessionId,
      title: "",
      preview: "",
      started_at: 0,
      message_count: 0,
      source: "bots",
      profile,
      unpersisted,
    });
  }

  function handleNavigate(nav: NavId) {
    setScreen(nav);
  }

  // ── Board without a connection: full-screen device picker (no tab bar —
  //    there's nothing to navigate until a device is connected). ──────────
  if (screen === "board" && (!activeConn || !client)) {
    return <Connections store={store} onConnect={handleConnect} />;
  }

  // ── chat detail page: full screen, ChatView renders the same unified
  // Header (back + title + model chip) — no tab bar. ─────────────────────
  if (screen === "chat") {
    return (
      <ChatView
        key={chatInstance}
        conn={activeConn!}
        client={client!}
        session={activeSession}
        group={activeGroup ? { roomId: activeGroup } : undefined}
        state={connState}
        onBack={() => setScreen(chatReturnTo)}
        onNewChat={() => openChat(null)}
      />
    );
  }

  // Everything below this line has an active connection.
  const conn = activeConn!;
  const liveClient = client!;

  // Board subtitle mirrors the mockup: the connection line once connected.
  const subtitle =
    screen === "board"
      ? `${conn.label} · ${conn.url.replace(/^https?:\/\//, "")}`
      : SUBTITLES[screen];

  // ── unified shell: ONE header on every root screen + bottom tab bar ─────
  return (
    <div className="screen">
      <Header
        title={TITLES[screen]}
        subtitle={subtitle}
        state={connState}
        right={
          screen === "chats" ? (
            <button
              className="iconbtn"
              onClick={() => openChat(null)}
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon size={16} />
            </button>
          ) : undefined
        }
      />
      <div className="shell-body">
        {screen === "board" && (
          <Home
            store={store}
            conn={conn}
            client={liveClient}
            onConnect={handleConnect}
            onOpenSession={openSessionFromHome}
            onManageDevices={() => setScreen("settings")}
          />
        )}
        {screen === "chats" && (
          <ChatList
            conn={conn}
            client={liveClient}
            onOpenChat={openChat}
            onDisconnect={handleDisconnect}
          />
        )}
        {screen === "bots" && (
          <Suspense fallback={null}>
            <BotsScreen onOpenChat={openChatById} client={liveClient} conn={conn} />
          </Suspense>
        )}
        {screen === "groups" && (
          <Groups client={liveClient} conn={conn} onOpenGroup={openGroup} />
        )}
        {screen === "runs" && <Runs client={liveClient} conn={conn} />}
        {screen === "settings" && (
          <Settings
            conn={conn}
            store={store}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        )}
      </div>
      <TabBar active={screen} onNavigate={handleNavigate} />
    </div>
  );
}
