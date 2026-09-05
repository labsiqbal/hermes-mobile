import type { ComponentType } from "react";
import {
  BoardIcon,
  BotIcon,
  ChatIcon,
  RunsIcon,
  SettingsIcon,
  UsersIcon,
  type IconProps,
} from "./icons";

export type NavId = "board" | "chats" | "groups" | "bots" | "runs" | "settings";

const TABS: { id: NavId; label: string; icon: ComponentType<IconProps> }[] = [
  { id: "board", label: "Board", icon: BoardIcon },
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "groups", label: "Groups", icon: UsersIcon },
  { id: "bots", label: "Bots", icon: BotIcon },
  { id: "runs", label: "Runs", icon: RunsIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

/** Standard mobile bottom tab bar — the single navigation surface for root
 *  screens (detail pages like chat use the header back button instead). */
export default function TabBar({
  active,
  onNavigate,
}: {
  active: NavId;
  onNavigate: (nav: NavId) => void;
}) {
  return (
    <nav className="shell-tabbar" aria-label="Primary">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`shell-tab ${active === tab.id ? "active" : ""}`}
          aria-current={active === tab.id ? "page" : undefined}
          onClick={() => onNavigate(tab.id)}
        >
          <tab.icon size={23} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
