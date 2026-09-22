import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HermesConnection } from '../lib/hermes-client';
import { getActivity, reconcileChildren, subscribeActivity, type ChildActivity } from '../lib/session-activity';

export default function SubagentActivity({client,sid,activityId,visible}:{client:HermesConnection;sid:string;activityId:string;visible:boolean}) {
  const activity=useSyncExternalStore(subscribeActivity,()=>getActivity(activityId));

  const [selected,setSelected]=useState('');
  const [tail,setTail]=useState<{id:string;text:string;notice:string}>({id:'',text:'',notice:''});
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!sid || !visible)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const baseline=getActivity(activityId);
        const result=await client.rpc<{subagents:unknown}>('subagent.list',{session_id:sid});
        if(!Array.isArray(result?.subagents))throw new Error('Invalid roster');
        const rows:ChildActivity[]=result.subagents.map(value=>{
          if(!value || typeof value!=='object' || typeof value.subagent_id!=='string' || typeof value.status!=='string')throw new Error('Invalid child');
          return {id:value.subagent_id,goal:typeof value.goal==='string'?value.goal:'Subagent',status:value.status,log:typeof value.last_tool==='string'?[`Last tool: ${value.last_tool}`]:[]};
        });
        if(!cancelled){reconcileChildren(activityId,rows,baseline);setError('');}
      } catch {if(!cancelled)setError('Live subagent status unavailable. Showing received activity.');return;}
      if(!cancelled)timer=setTimeout(poll,3000);
    }
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[client,sid,visible,activityId]);
  useEffect(()=>{
    if(!selected || !sid || !visible)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const result=await client.rpc<{subagent_id:string;available:boolean;text:string;truncated:boolean}>('subagent.tail',{session_id:sid,subagent_id:selected});
        if(result?.subagent_id!==selected || typeof result.available!=='boolean' || typeof result.text!=='string')throw new Error('Invalid log');
        if(!cancelled)setTail(previous=>({id:selected,text:result.available?result.text.slice(-16384):previous.id===selected?previous.text:'',notice:result.available?(result.truncated?'Latest log excerpt.':''):'Live log unavailable; received activity remains below.'}));
        if(!result.available)return;
      } catch {if(!cancelled)setTail(previous=>({id:selected,text:previous.id===selected?previous.text:'',notice:'Live log could not load.'}));return;}
      if(!cancelled)timer=setTimeout(poll,3000);
    }
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[client,sid,selected,visible]);
  const children=new Map(activity.children.map(child=>[child.id,child]));
  if(!children.size)return null;
  return <section className="subagent-activity" aria-label="Subagent activity">
    {error&&<p className="hint">{error}</p>}
    {[...children.values()].map(child=><details key={child.id} open={selected===child.id} onToggle={event=>{if(event.currentTarget.open)setSelected(child.id);else setSelected(current=>current===child.id?'':current);}}>
      <summary><span className={`session-signal ${child.status==='running'?'processing':child.status==='completed'?'complete':'failed'}`} aria-hidden="true"/><span>{child.goal || 'Subagent'}</span><small>{child.status}</small></summary>
      {selected===child.id&&<div className="subagent-log">{tail.id===child.id?<><p className="hint">{tail.notice}</p>{tail.text&&<pre>{tail.text}</pre>}</>:<p role="status">Loading log…</p>}{child.log.map((line,index)=><pre key={index}>{line}</pre>)}</div>}
    </details>)}
  </section>;
}
