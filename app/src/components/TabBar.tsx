import type { ComponentType } from "react";
import {
  BoardIcon,
  BotIcon,
  ChatIcon,
  RunsIcon,
  SettingsIcon,
  type IconProps,
} from "./icons";

export type NavId = "home" | "chats" | "bots" | "activity" | "manage";

const TABS: { id: NavId; label: string; icon: ComponentType<IconProps> }[] = [
  { id: "home", label: "Home", icon: BoardIcon },
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "bots", label: "Bots", icon: BotIcon },
  { id: "activity", label: "Activity", icon: RunsIcon },
  { id: "manage", label: "Manage", icon: SettingsIcon },
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
