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
}
/** One title row + an explicit, live gateway/profile context row. */
export default function Header({ title, subtitle, state, onBack, right }: Props) {
  const dotClass = state === 'open' ? 'dot-on' : state === 'connecting' ? 'dot-busy' : 'dot-off';
  return <header className="shell-header">
    <div className="shell-title-row">
      {onBack && <button className="iconbtn" onClick={onBack} aria-label="Back"><ChevronLeft size={22} aria-hidden="true" /></button>}
      <h1 className="appbar-title">{title}</h1>
      {right}
    </div>
    <div className="shell-context"><span className={`dot ${dotClass}`} aria-hidden="true" /><span className="appbar-sub">{subtitle || 'Gateway'}</span><span className="shell-status" role="status">{connectionLabel(state)}</span></div>
  </header>;
}
