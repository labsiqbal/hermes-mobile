import type { GatewayEvent } from './hermes-client';

export type ChildActivity = { id:string; goal:string; status:string; log:string[] };
export type Activity = { running:boolean; unread:boolean; failed:boolean; children:ChildActivity[] };
const empty:Activity={running:false,unread:false,failed:false,children:[]};
const snapshots=new Map<string,Activity>();
const aliases=new Map<string,string>();
const listeners=new Set<()=>void>();
export const activityKey=(gateway:string,url:string,sid:string)=>JSON.stringify([gateway,url,sid]);
export const subscribeActivity=(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify);};};
export const getActivity=(key:string)=>snapshots.get(aliases.get(key) || key) || empty;
const publish=(key:string,value:Activity)=>{snapshots.set(aliases.get(key) || key,value);listeners.forEach(notify=>notify());};
export function linkActivity(target:string,...keys:string[]){
  for(const key of keys){if(key===target)continue;const old=getActivity(key);if(!snapshots.has(target) && old!==empty)snapshots.set(target,old);aliases.set(key,target);}
  listeners.forEach(notify=>notify());
}
export const readActivity=(key:string)=>{const value=getActivity(key);if(value.unread)publish(key,{...value,unread:false});};

export function reduceActivity(previous:Activity,event:GatewayEvent):Activity {
  const p=event.payload && typeof event.payload==='object'?event.payload as Record<string,unknown>:{};
  if(event.type==='message.start')return {...previous,running:true,unread:false,failed:false};
  if(event.type==='message.complete' || event.type==='error')return {...previous,running:false,unread:event.type!=='error' && p.status!=='error',failed:event.type==='error' || p.status==='error'};
  if(!['subagent.start','subagent.tool','subagent.progress','subagent.thinking','subagent.complete'].includes(event.type) || typeof p.subagent_id!=='string' || !p.subagent_id)return previous;
  const old=previous.children.find(child=>child.id===p.subagent_id);
  const text=[p.tool_name,p.text,p.summary].filter((value):value is string=>typeof value==='string' && !!value).join('\n').slice(0,16384);
  const child:ChildActivity={id:p.subagent_id,goal:typeof p.goal==='string'?p.goal:old?.goal || 'Subagent',status:event.type==='subagent.complete'?(typeof p.status==='string'?p.status:'unknown'):'running',log:text?[...(old?.log || []),text].slice(-100):old?.log || []};
  return {...previous,children:[...previous.children.filter(row=>row.id!==child.id),child]};
}
export function recordActivity(key:string,event:GatewayEvent){const old=getActivity(key);const next=reduceActivity(old,event);if(old!==next)publish(key,next);}
