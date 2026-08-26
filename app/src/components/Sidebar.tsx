import { useEffect, type ComponentType } from "react";
import type { ConnectionState, SavedConnection } from "../lib/hermes-client";
import {
  BotIcon,
  ChatIcon,
  ConnectionsIcon,
  DisconnectIcon,
  RunsIcon,
  SettingsIcon,
  type IconProps,
} from "./icons";

export type NavId = "chats" | "bots" | "groups" | "runs" | "connections" | "settings";

const NAV_ITEMS: { id: NavId; label: string; icon: ComponentType<IconProps>; soon?: boolean }[] = [
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "bots", label: "Bots", icon: BotIcon },
  { id: "groups", label: "Groups", icon: BotIcon },
  { id: "runs", label: "Runs", icon: RunsIcon },
  { id: "connections", label: "Connections", icon: ConnectionsIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

interface Props {
  open: boolean;
  onClose: () => void;
  conn: SavedConnection;
  state: ConnectionState;
  active: NavId;
  onNavigate: (nav: NavId) => void;
  onDisconnect: () => void;
  version: string;
}

export default function Sidebar({
  open,
  onClose,
  conn,
  state,
  active,
  onNavigate,
  onDisconnect,
  version,
}: Props) {
  // Close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const dotClass =
    state === "open" ? "dot-on" : state === "connecting" ? "dot-busy" : "dot-off";

  return (
    <div className={`drawer-root ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Navigation menu">
        <div className="drawer-conn">
          <span className={`dot ${dotClass}`} />
          <div className="rowcard-main">
            <div className="rowcard-title">{conn.label}</div>
            <div className="rowcard-meta">{conn.url}</div>
          </div>
        </div>

        <nav className="drawer-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`drawer-item ${active === item.id ? "active" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="drawer-item-icon">
                <item.icon />
              </span>
              <span className="drawer-item-label">{item.label}</span>
              {item.soon && <span className="chip chip-warm">soon</span>}
            </button>
          ))}
        </nav>

        <div className="drawer-foot">
          <span className="drawer-version">hermes mobile v{version}</span>
          <button className="btn btn-ghost btn-icon" onClick={onDisconnect}>
            <DisconnectIcon size={15} />
            Disconnect — switch device
          </button>
        </div>
      </aside>
    </div>
  );
}
