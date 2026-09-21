import type { SessionSummary } from './hermes-client';

export type InboxView = { grouping:'project'|'profile'|'date'; ordering:'updated'|'created'|'tokens'; cards:boolean };
export const defaultInboxView:InboxView={grouping:'project',ordering:'updated',cards:true};
export function readInboxView(key:string):InboxView {
  try {
    const value=JSON.parse(localStorage.getItem(key) || 'null');
    return {grouping:['project','profile','date'].includes(value?.grouping)?value.grouping:defaultInboxView.grouping,ordering:['updated','created','tokens'].includes(value?.ordering)?value.ordering:defaultInboxView.ordering,cards:typeof value?.cards==='boolean'?value.cards:defaultInboxView.cards};
  } catch {return {...defaultInboxView};}
}
export const updatedTime=(row:SessionSummary)=>row.last_active || row.started_at;
export function orderInbox(rows:SessionSummary[],ordering:InboxView['ordering']):SessionSummary[] {
  const rank=(row:SessionSummary)=>ordering==='created'?row.started_at:ordering==='tokens'?(row.input_tokens || 0)+(row.output_tokens || 0):updatedTime(row);
  return [...rows].sort((a,b)=>rank(b)-rank(a));
}
export function inboxDate(row:SessionSummary,now=new Date()):string {
  const date=new Date(updatedTime(row)*1000),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  return date>=today?'Today':date>=yesterday?'Yesterday':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
