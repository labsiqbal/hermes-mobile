import type { ConnectionState } from "../lib/hermes-client";
import { MenuIcon } from "./icons";

interface Props {
  title: string;
  /** Mono context line — typically `label · url` of the active connection. */
  subtitle?: string;
  /** Live socket state, drives the status dot on the right. */
  state: ConnectionState;
  onMenu: () => void;
}

export default function Header({ title, subtitle, state, onMenu }: Props) {
  const dotClass =
    state === "open" ? "dot-on" : state === "connecting" ? "dot-busy" : "dot-off";
  return (
    <header className="shell-header">
      <button className="iconbtn" onClick={onMenu} aria-label="Open menu" title="Menu">
        <MenuIcon />
      </button>
      <div className="shell-header-main">
        <div className="appbar-title">{title}</div>
        {subtitle && <div className="appbar-sub">{subtitle}</div>}
      </div>
      <span className={`dot ${dotClass}`} title={`gateway: ${state}`} />
    </header>
  );
}
