import type { SavedConnection } from './hermes-client';

export interface ProjectFolder { id: string; name: string; path: string; profile: string }
export const folderKey = (conn: Pick<SavedConnection,'id'|'url'>) => `hermes-mobile.project-folders:${JSON.stringify([conn.id,conn.url])}`;
export function readFolders(key: string): ProjectFolder[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((p): p is ProjectFolder => !!p && typeof p.id==='string' && typeof p.name==='string' && typeof p.path==='string' && p.path.startsWith('/') && typeof p.profile==='string') : [];
  } catch { return []; }
}
export function moveProject(ids: string[], from: string, to: string): string[] {
  if(from===to || !ids.includes(from) || !ids.includes(to)) return ids;
  const result=ids.filter(id=>id!==from);
  result.splice(ids.indexOf(to),0,from);
  return result;
}
export function folderContains(folder: string, cwd?: string | null): boolean {
  const root=folder==='/' ? '/' : folder.replace(/\/+$/,'');
  return !!cwd && (cwd===root || cwd.startsWith(root==='/' ? root : root+'/'));
}
