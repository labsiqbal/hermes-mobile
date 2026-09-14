import type { ReactNode } from 'react';
import type { ConnectionState } from '../lib/hermes-client';
import { ChevronLeft } from 'lucide-react';
import { connectionLabel } from '../lib/shell-state';

interface Props {
  title: string;
  subtitle?: string;
  state: ConnectionState;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
  onSettings?: () => void;
}
/** One title row + an explicit, live gateway/profile context row. */
export default function Header({ title, subtitle, state, onBack, right, large, onSettings }: Props) {
  const dotClass = state === 'open' ? 'dot-on' : state === 'connecting' ? 'dot-busy' : 'dot-off';
  if (large) return <header className="shell-header shell-header-large">
    <div className="shell-toolbar"><button className="gateway-capsule" onClick={onSettings} aria-label="Connection settings" title="Connection settings"><span>{subtitle || 'Gateway'}</span><span className={`dot ${dotClass}`} aria-hidden="true" /><span className="sr-only">{connectionLabel(state)}</span></button><div className="shell-header-actions">{right}</div></div>
    <h1>{title}</h1>
  </header>;
  return <header className="shell-header">
    <div className="shell-title-row">
      {onBack && <button className="iconbtn" onClick={onBack} aria-label="Back"><ChevronLeft size={22} aria-hidden="true" /></button>}
      <h1 className="appbar-title">{title}</h1>
      {right}
    </div>
    <div className="shell-context"><span className={`dot ${dotClass}`} aria-hidden="true" /><span className="appbar-sub">{subtitle || 'Gateway'}</span><span className="shell-status" role="status">{connectionLabel(state)}</span></div>
  </header>;
}
