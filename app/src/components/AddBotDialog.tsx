import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { RpcError, type HermesConnection, type ProfileSummary } from '../lib/hermes-client';

export default function AddBotDialog({ client, profiles, device, onClose, onCreated }: {
  client: HermesConnection;
  profiles: ProfileSummary[];
  device: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [soul, setSoul] = useState('');
  const [cloneFrom, setCloneFrom] = useState(profiles.some(p => p.name === 'default') ? 'default' : '');
  const [useCredentials, setUseCredentials] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [connected, setConnected] = useState(client.connectionState === 'open');
  const [error, setError] = useState('');
  const slug = name.trim();
  const valid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) && slug !== 'default';
  const duplicate = profiles.some(p => p.name === slug);

  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const stop = client.addStateHandler(state => setConnected(state === 'open'));
    return () => { mounted.current = false; stop(); trigger?.focus(); };
  }, [client]);

  async function submit() {
    if (inFlight.current || uncertain || !valid || duplicate || client.connectionState !== 'open') return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      // Recheck the roster before the single creation write, including remote changes.
      const current = await client.profilesList();
      if (!mounted.current || client.connectionState !== 'open') return;
      if (current.some(p => p.name === slug)) { setError('A bot with this name already exists.'); return; }
      if (cloneFrom && !current.some(p => p.name === cloneFrom)) { setError('The source profile is no longer available.'); return; }
      setUncertain(true);
      const result = await client.createBot({ name: slug, description: description.trim(), soul: soul.trim(), cloneFrom, useCredentials });
      if (!mounted.current) return;
      onCreated(soul.trim() && !result.soulWritten
        ? `Bot ${result.name} was created, but its instructions were not saved. Review them in Desktop.`
        : `Bot ${result.name} created.`);
    } catch (reason) {
      if (reason instanceof RpcError && [-32601, 4061, 4062].includes(reason.code)) {
        setUncertain(false);
        setError(reason.code === -32601 ? 'This gateway does not support adding bots.' : 'This bot name or source profile is unavailable. Choose another.');
      } else {
        setError('Could not confirm creation. Close this form and refresh the roster before trying again.');
      }
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="project-dialog add-bot-dialog" aria-labelledby="add-bot-title" onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="project-section-title"><h2 id="add-bot-title">Add bot</h2><button type="button" className="iconbtn" aria-label="Close add bot" title="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="hint">Device: {device}</p>
      <fieldset disabled={busy || uncertain}>
        <label>Bot name<input autoFocus className="field" aria-label="Bot name" value={name} onChange={e => setName(e.target.value)} maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="research-assistant" required /></label>
        {name && (!valid || duplicate) && <p className="error-line" role="status">{duplicate ? 'A bot with this name already exists.' : 'Use lowercase letters, numbers, hyphens or underscores. The name default is reserved.'}</p>}
        <label>Description<input className="field" aria-label="Bot description" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} /></label>
        <label>Source profile<select className="field" aria-label="Source profile" disabled={!useCredentials} value={cloneFrom} onChange={e => setCloneFrom(e.target.value)}><option value="">Fresh profile</option>{profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</select></label>
        <label>Instructions<textarea className="field" aria-label="Bot instructions" rows={4} value={soul} onChange={e => setSoul(e.target.value)} maxLength={16000} /></label>
        <label className="bot-credentials"><input type="checkbox" checked={useCredentials} onChange={e => { setUseCredentials(e.target.checked); if (!e.target.checked) setCloneFrom(''); }} />Reuse provider credentials on this device</label>
      </fieldset>
      {!connected && <p className="error-line" role="status">Reconnect to add a bot.</p>}
      {error && <p className="error-line" role="alert">{error}</p>}
      <div className="sheet-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || uncertain || !connected || !valid || duplicate}>{busy ? 'Creating...' : 'Create bot'}</button></div>
    </form>
  </dialog>;
}
