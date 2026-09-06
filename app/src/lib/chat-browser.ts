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
export function readIds(key: string): Set<string> {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []); }
  catch { return new Set(); }
}
