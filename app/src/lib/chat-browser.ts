import type { ProfileSummary, SavedConnection, SessionSummary } from './hermes-client';

/** Local presentation metadata; never sent as a session/project mutation. */
export type BrowserChat = SessionSummary & { bot?: boolean };
export function chatKey(chat: Pick<SessionSummary, 'id' | 'profile'>) {
  return JSON.stringify([chat.profile, chat.id]);
}
export function canonicalChats(profiles: ProfileSummary[]): BrowserChat[] {
  return profiles.flatMap(profile => {
    const row = profile.canonical_session;
    return row?.id ? [{id:row.id, resolved_id:row.resolved_id, title:row.title || 'Bot Chat', preview:row.preview || '', started_at:row.started_at || 0, message_count:row.message_count || 0, source:'bots', profile:profile.name, bot:true}] : [];
  });
}
/** Canonical rows go first so root/tip aliases resolve to one owner-scoped row. */
export function uniqueChats(rows: BrowserChat[]): BrowserChat[] {
  const seen = new Set<string>();
  return [...rows].sort((a,b) => Number(!!b.bot)-Number(!!a.bot)).filter(row => {
    const keys = [chatKey(row), ...(row.resolved_id ? [chatKey({...row,id:row.resolved_id})] : [])];
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key)); return true;
  });
}
export function orderedProjects<T extends {id:string}>(projects: T[], pins: Set<string>): T[] {
  return [...projects].sort((a,b) => Number(pins.has(b.id))-Number(pins.has(a.id)));
}
export const preferenceKey = (conn: Pick<SavedConnection,'id'|'url'>) => `hermes-mobile.chat-project-pins:${JSON.stringify([conn.id,conn.url])}`;
export const sessionPinsKey = (conn: Pick<SavedConnection,'id'|'url'>) => `hermes-mobile.session-pins:${JSON.stringify([conn.id,conn.url])}`;
export const botThreadsKey = (conn: Pick<SavedConnection,'id'|'url'>) => `hermes-mobile.bot-threads:${JSON.stringify([conn.id,conn.url])}`;
const volatileBotThreads = new Map<string,Set<string>>();
export function readBotThreads(conn: Pick<SavedConnection,'id'|'url'>): Set<string> {
  const key=botThreadsKey(conn);
  return new Set([...readIds(key),...(volatileBotThreads.get(key) || [])]);
}
export function rememberBotThread(conn: Pick<SavedConnection,'id'|'url'>, row: Pick<SessionSummary,'id'|'profile'|'resolved_id'>): void {
  const key=botThreadsKey(conn), ids=readBotThreads(conn);
  for(const id of [row.id,row.resolved_id]) if(id) ids.add(chatKey({...row,id}));
  volatileBotThreads.set(key,ids);
  try {localStorage.setItem(key,JSON.stringify([...ids]));} catch { /* Keep successful creates usable when browser storage is unavailable. */ }
}
/** A title is never evidence of ownership. Local IDs record an explicit Bots action. */
export function isBotThread(row: BrowserChat, profiles: ProfileSummary[], local = new Set<string>()): boolean {
  const owner = profiles.find(profile => profile.name === row.profile);
  const ids = [row.id, row.resolved_id].filter(Boolean);
  // Previous Mobile releases created ordinary new sessions only in default;
  // mobile sessions in another profile were created by the Bots screen.
  return !!row.bot || row.source === 'bots'
    || row.source==='mobile' && !!owner && !owner.is_default && owner.name!=='default'
    || ids.some(id => local.has(chatKey({...row, id: id!})))
    || !!owner?.canonical_session && ids.some(id => [owner.canonical_session!.id, owner.canonical_session!.resolved_id].includes(id));
}
export function readIds(key: string): Set<string> {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []); }
  catch { return new Set(); }
}
