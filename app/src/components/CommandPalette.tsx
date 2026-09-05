import { useEffect, useRef, useState } from 'react';
import { ROOT_DESTINATIONS, type ShellScreen } from '../lib/shell-state';
import { SearchIcon, XIcon } from './icons';

export default function CommandPalette({ onClose, onNavigate, connected }: {
  onClose: () => void; onNavigate: (screen: ShellScreen) => void; connected: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const el = dialog.current;
    el?.showModal();
    return () => {
      el?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll:true});
    };
  }, []);
  const destinations = [...ROOT_DESTINATIONS,
    {id:'groups' as const, label:'Groups', description:'Shared bot conversations'},
    {id:'settings' as const, label:'Settings', description:'Devices and local preferences'},
  ].filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <dialog ref={dialog} className="command-palette" aria-labelledby="palette-title" onCancel={onClose} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }}>
    <div className="palette-heading"><h2 id="palette-title">Go anywhere</h2><button className="iconbtn" onClick={onClose} aria-label="Close command palette"><XIcon /></button></div>
    <label className="palette-search"><SearchIcon size={20} /><input autoFocus type="search" aria-label="Find a destination" placeholder="Search destinations…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {!connected && <p className="hint">Connect a gateway first to open these destinations.</p>}
    <div className="palette-results">
      {destinations.map(item => <button key={item.id} className="collection-link" disabled={!connected} onClick={() => onNavigate(item.id)}><span>{item.label}<small>{item.description}</small></span><span aria-hidden="true">→</span></button>)}
      {!destinations.length && <p role="status" className="hint">No matching destinations. Try “Bots” or “Manage”.</p>}
    </div>
    <p className="hint">Workspace tools are available inside a conversation or Manage.</p>
  </dialog>;
}
