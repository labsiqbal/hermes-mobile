import type { HermesConnection, ProjectTreeItem, SessionSummary } from './hermes-client';
import { ManagementClient, ManagementError, SessionReadError } from './management-client';
import { canonicalChats, chatKey, uniqueChats, type BrowserChat } from './chat-browser';

export type OwnedProject = ProjectTreeItem & { sourceId: string; profile: string };
export interface ChatReadFailure { profile: string; operation: string; code: string; message: string; status?: number }
export function chatReadFailure(error: unknown, profile: string, operation: string): ChatReadFailure {
  return error instanceof ManagementError
    ? {profile,operation:error.operation || operation,code:error.code,status:error.status,message:error.message.replace(/ No state changed\.$/, '')}
    : {profile,operation,code:'unavailable',message:'This history read could not be completed.'};
}
const rowsOf = (project:ProjectTreeItem) => project.repos?.flatMap(repo=>repo.groups?.flatMap(group=>group.sessions || []) || []) || project.previewSessions || [];

/** Owner-echo reads; no inferred title/default ownership and no mutation fallback. */
export class ChatSource {
  private readonly client: HermesConnection;
  // In-memory, per connection/source instance; retained only as explicitly stale read evidence.
  private readonly verified = new Map<string, SessionSummary[]>();
  private loadVersion = 0;
  private readonly manager: Pick<ManagementClient,'runningProfile'|'sessions'|'sessionIdentity'>;
  constructor(client: HermesConnection, manager: Pick<ManagementClient,'runningProfile'|'sessions'|'sessionIdentity'> = new ManagementClient(client)) { this.client=client; this.manager=manager; }
  private async guard(profile: string) {
    if (!profile || await this.manager.runningProfile() !== profile) throw new Error('Deletion is available only for the verified running profile. No write was sent.');
  }
  private owned(project: ProjectTreeItem, profile: string): OwnedProject {
    const rows=[...(project.previewSessions || []),...rowsOf(project)];
    if (rows.some(row=>row.profile!==profile) || (project.sessionCount>0 && !rows.length)) throw new Error('Project session ownership was not reported for the requested profile. Results were not displayed.');
    return {...project,id:JSON.stringify([profile,project.id]),sourceId:project.id,profile};
  }
  async load() {
    const version = ++this.loadVersion;
    const profiles = await this.client.profilesList({includeSessions:true});
    if(version===this.loadVersion) for(const name of this.verified.keys()) if(!profiles.some(owner=>owner.name===name)) this.verified.delete(name);
    const readFailures: ChatReadFailure[] = [];
    const profile = await this.manager.runningProfile().catch(error=>{readFailures.push(chatReadFailure(error,'Gateway','GET /api/profiles/active'));return '';});
    const results = await Promise.all(profiles.map(async owner=>{
      let sessions: SessionSummary[] = [];
      let operation = 'GET /api/sessions';
      try {
        sessions=await this.manager.sessions(owner.name);
        // Only query the tree after the concrete REST profile has been validated.
        // An empty tree is not evidence of exhaustive project coverage.
        operation = 'RPC projects.tree';
        const tree=await this.client.projectTree(3,owner.name);
        const projects=tree.projects.filter(project=>project.sessionCount>0).map(project=>this.owned(project,owner.name));
        operation = 'RPC projects.project_sessions';
        const homes=await Promise.all(projects.filter(project=>project.isNoProject).map(project=>this.project(project.sourceId,owner.name)));
        const homeRows=homes.flatMap(rowsOf);
        const homeIds=new Set(homeRows.flatMap(row=>[row.id,row.resolved_id].filter(Boolean)));
        sessions=uniqueChats([...sessions,...homeRows]);
        if(version===this.loadVersion) this.verified.set(owner.name,sessions);
        return {sessions,projects,scoped:(tree.scoped_session_ids || []).filter(id=>!homeIds.has(id)).map(id=>chatKey({id,profile:owner.name})),error:''};
      } catch(error) {
        if(error instanceof SessionReadError) sessions=error.sessions;
        const failure=chatReadFailure(error,owner.name,operation);
        readFailures.push(failure);
        // New verified rows take precedence; keep previous verified history accessible
        // in Recent when a list/tree fails. Never present stale membership as current.
        sessions=uniqueChats([...sessions,...(this.verified.get(owner.name) || [])]);
        if(version===this.loadVersion) this.verified.set(owner.name,sessions);
        return {sessions,projects:[] as OwnedProject[],scoped:[] as string[],error:owner.name};
      }
    }));
    return {profile,profiles,sessions:results.flatMap(result=>result.sessions),bots:canonicalChats(profiles),projects:results.flatMap(result=>result.projects),scopedIds:new Set(results.flatMap(result=>result.scoped)),failedProfiles:results.map(result=>result.error).filter(Boolean),readFailures,warnings:readFailures.map(f=>`${f.profile}: ${f.message}`)};
  }
  async project(id: string, profile: string): Promise<OwnedProject> {
    const version=this.loadVersion;
    const roster=await this.client.profilesList({includeSessions:false});
    if(!roster.some(owner=>owner.name===profile)) throw new Error('The project profile is no longer in the gateway roster. Refresh Chats.');
    const project=await this.client.projectSessions(id,profile);
    if (!project || project.id!==id) throw new Error('This project is no longer available. Refresh Chats.');
    const owned=this.owned(project,profile);
    if(version===this.loadVersion) this.verified.set(profile,uniqueChats([...(this.verified.get(profile) || []),...rowsOf(owned)]));
    return owned;
  }
  async delete(target: BrowserChat, confirmed: boolean, signal?: AbortSignal) {
    const valid = () => { if(signal?.aborted || this.client.connectionState!=='open') throw new Error('The connection or confirmation changed. No write was sent.'); };
    if (!confirmed) throw new Error('Explicit confirmation is required.');
    if (target.bot) throw new Error('The canonical bot conversation cannot be deleted here.');
    valid();
    const profile=target.profile || '';
    await this.guard(profile);
    // Establish exact-target route compatibility and owner before sending anything.
    await this.manager.sessionIdentity(profile,target.id,signal);
    const roster=await this.client.profilesList({includeSessions:true});
    if(!roster.some(owner=>owner.name===profile)) throw new Error('The session profile is no longer available. No write was sent.');
    const owner=roster.find(owner=>owner.name===profile)!;
    // A roster null may mean its lookup failed. The exact registry query throws
    // on failure and returns null only after a successful empty lookup.
    if(!owner.canonical_session) {
      const canonical=await this.client.sessionFindBotChat(profile);
      if(canonical && [canonical.id,canonical.resolved_id].includes(target.id)) throw new Error('The canonical bot conversation cannot be deleted here.');
    }
    if(canonicalChats(roster).some(row=>row.profile===profile && [row.id,row.resolved_id].includes(target.id))) throw new Error('The canonical bot conversation cannot be deleted here.');
    await this.guard(profile);
    valid();
    try {
      const result=await this.client.sessionDelete(target.id,profile);
      if (!result || result.deleted!==target.id) throw new Error('Unexpected deletion acknowledgment.');
      await this.guard(profile);
      try { await this.manager.sessionIdentity(profile,target.id); }
      catch(error) {
        if(error instanceof ManagementError && error.status===404) {
          this.loadVersion++; // Late pre-deletion reads cannot repopulate the cache.
          this.verified.set(profile,(this.verified.get(profile) || []).filter(row=>row.id!==target.id));
          return;
        }
        throw error;
      }
      throw new Error('The exact session is still present.');
    } catch(error) {
      throw new Error('The deletion outcome is unknown. Refresh Chats before trying again.',{cause:error});
    }
  }
}
