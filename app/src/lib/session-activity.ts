import type { GatewayEvent } from './hermes-client';

export type ChildActivity = { id:string; goal:string; status:string; log:string[] };
export type Activity = { running:boolean; unread:boolean; failed:boolean; children:ChildActivity[] };
const empty:Activity={running:false,unread:false,failed:false,children:[]};
const storageKey='hermes-mobile.activity.v1';
const snapshots=new Map<string,Activity>();
const aliases=new Map<string,string>();
const listeners=new Set<()=>void>();
let revision=0;
export const activityRevision=()=>revision;
// Persist only indicators/identity, never transcript or child output.
try {
  const saved=JSON.parse(localStorage.getItem(storageKey) || '{}');
  if(Array.isArray(saved.states))for(const row of saved.states.slice(-500)){
    if(Array.isArray(row) && typeof row[0]==='string' && row[1] && typeof row[1].unread==='boolean' && typeof row[1].failed==='boolean')snapshots.set(row[0],{...empty,unread:row[1].unread,failed:row[1].failed});
  }
  if(Array.isArray(saved.aliases))for(const row of saved.aliases.slice(-1000))if(Array.isArray(row) && row.length===2 && row.every((v:unknown)=>typeof v==='string'))aliases.set(row[0],row[1]);
} catch { /* Storage denial/corruption must not prevent chat. */ }
function canonical(key:string){const seen=new Set<string>();while(aliases.has(key)&&!seen.has(key)){seen.add(key);key=aliases.get(key)!;}return key;}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify({states:[...snapshots].slice(-500).map(([key,value])=>[key,{unread:value.unread,failed:value.failed}]),aliases:[...aliases].slice(-1000)}));}catch{/* In-memory status still works. */}}
export const activityKey=(gateway:string,url:string,sid:string)=>JSON.stringify([gateway,url,sid]);
export const subscribeActivity=(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify);};};
export const getActivity=(key:string)=>snapshots.get(canonical(key)) || empty;
const publish=(key:string,value:Activity)=>{snapshots.set(canonical(key),value);persist();listeners.forEach(notify=>notify());};
export function linkActivity(target:string,...keys:string[]){
  target=canonical(target);
  for(const key of keys){const from=canonical(key);if(from===target)continue;const old=getActivity(from);if(!snapshots.has(target) && old!==empty)snapshots.set(target,old);aliases.set(from,target);aliases.set(key,target);snapshots.delete(from);}
  persist();listeners.forEach(notify=>notify());
}
export const readActivity=(key:string)=>{const value=getActivity(key);if(value.unread)publish(key,{...value,unread:false});};
export function reconcileRunning(key:string,running:boolean){const old=getActivity(key);if(old.running!==running)publish(key,{...old,running});}
export function reconcileChildren(key:string,rows:ChildActivity[],baseline:Activity){
  const old=getActivity(key);
  // Events received while the read was pending outrank that snapshot.
  const children=old.children.map(child=>{
    if(baseline.children.find(row=>row.id===child.id)!==child)return child;
    const row=rows.find(row=>row.id===child.id);
    return row?{...row,log:child.log}:child.status==='running'?{...child,status:'unknown'}:child;
  });
  for(const row of rows)if(!children.some(child=>child.id===row.id))children.push(row);
  if(JSON.stringify(children)!==JSON.stringify(old.children))publish(key,{...old,children});
}
export function invalidateActivity(gateway:string,url:string){
  for(const [key,value] of snapshots){const identity=JSON.parse(key);if(identity[0]===gateway && identity[1]===url)publish(key,{...value,running:false,children:value.children.map(child=>child.status==='running'?{...child,status:'unknown'}:child)});}
}
export function reduceActivity(previous:Activity,event:GatewayEvent):Activity {
  const p=event.payload && typeof event.payload==='object'?event.payload as Record<string,unknown>:{};
  if(event.type==='message.start')return {...previous,running:true,unread:false,failed:false};
  if(event.type==='message.complete' || event.type==='error')return {...previous,running:false,unread:event.type!=='error' && p.status!=='error',failed:event.type==='error' || p.status==='error'};
  if(!['subagent.start','subagent.tool','subagent.progress','subagent.thinking','subagent.complete'].includes(event.type) || typeof p.subagent_id!=='string' || !p.subagent_id)return previous;
  const old=previous.children.find(child=>child.id===p.subagent_id);
  const text=[p.tool_name,p.text,p.summary].filter((value):value is string=>typeof value==='string' && !!value).join('\n').slice(0,16384);
  const child:ChildActivity={id:p.subagent_id,goal:typeof p.goal==='string'?p.goal:old?.goal || 'Subagent',status:event.type==='subagent.complete'?(typeof p.status==='string'?p.status:'unknown'):'running',log:text?[...(old?.log || []),text].slice(-100):old?.log || []};
  const failed=event.type==='subagent.complete' && ['failed','error','interrupted','timed_out'].includes(child.status);
  return {...previous,failed:previous.failed || failed,unread:previous.unread || event.type==='subagent.complete' && child.status==='completed',children:[...previous.children.filter(row=>row.id!==child.id),child]};
}
export function recordActivity(key:string,event:GatewayEvent){const old=getActivity(key);const next=reduceActivity(old,event);if(old!==next){revision++;publish(key,next);}}
