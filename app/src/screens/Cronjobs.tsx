import { useEffect, useMemo, useState } from 'react';
import type { HermesConnection, SavedConnection } from '../lib/hermes-client';
import { ManagementClient, type ManagedProfile } from '../lib/management-client';
import { SchedulesPanel } from './Manage';
import { Runs } from './Runs';
import './cronjobs.css';

/** Cron schedule reads are independent of the retained execution/run journal. */
export default function Cronjobs({client,conn}:{client:HermesConnection;conn:SavedConnection}) {
  const manager=useMemo(()=>new ManagementClient(client),[client]);
  const [roster,setRoster]=useState<ManagedProfile[]>();
  const [profile,setProfile]=useState('');
  const [error,setError]=useState('');
  const [runs,setRuns]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([manager.profiles(controller.signal),manager.runningProfile(controller.signal).catch(()=>'')]).then(([rows,current])=>{
      if(controller.signal.aborted) return;
      setRoster(rows);setProfile(previous=>rows.some(row=>row.name===previous) ? previous : rows.some(row=>row.name===current) ? current : '');setError('');
    },err=>{if(!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Cronjobs are unavailable.');});
    return ()=>controller.abort();
  },[manager,revision]);
  if(runs) return <div className="screen"><button className="collection-link" onClick={()=>setRuns(false)}>← Back to Cronjobs</button><Runs client={client} conn={conn} /></div>;
  return <div className="body manage cronjobs">
    <div className="manage-section-heading"><h2>Scheduled jobs</h2><button className="manage-button" onClick={()=>setRuns(true)}>Runs</button></div>
    <p>Read-only schedules on {conn.label}. Runs opens the separate execution journal.</p>
    <label className="manage-field"><span>Cronjobs profile</span><select aria-label="Cronjobs profile" value={profile} onChange={event=>setProfile(event.target.value)}><option value="">Choose a profile</option>{roster?.map(row=><option key={row.name} value={row.name}>{row.name}</option>)}</select></label>
    {error && <p role="alert" className="manage-error">{error}</p>}
    {!roster && !error && <p role="status">Loading profiles…</p>}
    {error && <button className="manage-button" onClick={()=>setRevision(value=>value+1)}>Retry profiles</button>}
    {profile && roster?.some(row=>row.name===profile) ? <SchedulesPanel key={`${profile}:${revision}`} manager={manager} profile={profile} /> : roster && <p>No profile selected. Choose one to read its schedules; no all-profile fallback is used.</p>}
  </div>;
}
