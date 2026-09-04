import type { ReactNode } from "react";
import type { ConnectionState } from "../lib/hermes-client";

interface Props {
  title: string;
  /** Mono context line — e.g. `profile · device` of the active connection. */
  subtitle?: string;
  /** Live socket state, drives the status dot on the right. */
  state: ConnectionState;
  /** Detail pages (chat) pass a back handler; root tab screens don't. */
  onBack?: () => void;
  /** Extra actions rendered just left of the status dot. */
  right?: ReactNode;
}

/** The ONE app header — identical structure on every screen. */
export default function Header({ title, subtitle, state, onBack, right }: Props) {
  const dotClass =
    state === "open" ? "dot-on" : state === "connecting" ? "dot-busy" : "dot-off";
  return (
    <header className="shell-header">
      {onBack && (
        <button className="iconbtn" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
      )}
      <div className="shell-header-main">
        <div className="appbar-title">{title}</div>
        {subtitle && <div className="appbar-sub">{subtitle}</div>}
      </div>
      {right}
      <span className={`dot ${dotClass}`} title={`gateway: ${state}`} />
    </header>
  );
}
