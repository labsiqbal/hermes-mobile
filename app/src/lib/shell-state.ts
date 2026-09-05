import type { ConnectionState, SavedConnection, SessionSummary } from './hermes-client';

export const ROOT_DESTINATIONS = [
  { id: 'home', label: 'Home', description: 'Devices and recent conversations' },
  { id: 'chats', label: 'Chats', description: 'Projects, conversations and groups' },
  { id: 'bots', label: 'Bots', description: 'Profiles and canonical bot conversations' },
  { id: 'activity', label: 'Activity', description: 'Runs, schedules and routines' },
  { id: 'manage', label: 'Manage', description: 'Capabilities, identity and workspace tools' },
] as const;
export type RootScreen = typeof ROOT_DESTINATIONS[number]['id'];
export type ShellScreen = RootScreen | 'chat' | 'workspace' | 'groups' | 'settings';
export type GatewayIdentity = Pick<SavedConnection, 'id' | 'url'>;
export interface ConversationIdentity {
  /** Stable durable session ID, or a unique local draft ID until created. */
  id: string;
  session: SessionSummary | null;
  groupId?: string;
}
export interface ShellRoute {
  screen: ShellScreen;
  gateway?: GatewayIdentity;
  profile: string;
  conversation?: ConversationIdentity;
  returnTo?: RootScreen | 'groups';
}
interface Entry { shell: 1; depth: number; route: ShellRoute }
interface HistoryAdapter {
  state: unknown;
  pushState(data: unknown, unused: string, url?: string): void;
  replaceState(data: unknown, unused: string, url?: string): void;
  back(): void;
}
const screens: readonly string[] = [...ROOT_DESTINATIONS.map(d => d.id), 'chat', 'workspace', 'groups', 'settings'];
const home = (): ShellRoute => ({ screen: 'home', profile: 'default' });
function cleanRoute(route: ShellRoute): ShellRoute {
  const session = route.conversation?.session;
  return {
    screen:route.screen, profile:route.profile, returnTo:route.returnTo,
    gateway:route.gateway ? {id:route.gateway.id, url:route.gateway.url} : undefined,
    conversation:route.conversation ? {
      id:route.conversation.id, groupId:route.conversation.groupId,
      session:session ? {
        id:session.id, resolved_id:session.resolved_id, profile:session.profile,
        title:session.title, preview:'', started_at:session.started_at,
        message_count:session.message_count, source:session.source, unpersisted:session.unpersisted,
        cwd:session.cwd, git_repo_root:session.git_repo_root, git_branch:session.git_branch,
      } : null,
    } : undefined,
  };
}
function entry(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Entry;
  const r = e.route;
  if (e.shell !== 1 || !Number.isSafeInteger(e.depth) || e.depth < 0 || !r || !screens.includes(r.screen) || typeof r.profile !== 'string') return null;
  if (r.gateway && (typeof r.gateway.id !== 'string' || typeof r.gateway.url !== 'string')) return null;
  if (r.conversation && (typeof r.conversation.id !== 'string' || !r.gateway)) return null;
  if (r.screen === 'chat' && !r.conversation) return null;
  if (r.conversation?.session && (typeof r.conversation.session.id !== 'string' || (r.conversation.session.profile && r.conversation.session.profile !== r.profile))) return null;
  if (r.returnTo && ![...ROOT_DESTINATIONS.map(d => d.id), 'groups'].includes(r.returnTo)) return null;
  return {...e, route:cleanRoute(r)};
}
/** Browser history owns Back/Forward. Never push a synthetic parent on Back. */
export class ShellNavigation {
  private value: Entry;
  private history: HistoryAdapter;
  constructor(history: HistoryAdapter) {
    this.history = history;
    this.value = entry(history.state) ?? { shell: 1, depth: 0, route: home() };
    this.write(true);
  }
  get current(): ShellRoute { return this.value.route; }
  private write(replace: boolean) {
    this.history[replace ? 'replaceState' : 'pushState'](this.value, '', `#${this.current.screen}`);
  }
  go(route: ShellRoute, replace = false): ShellRoute {
    route = cleanRoute(route);
    if (JSON.stringify(route) === JSON.stringify(this.current)) return this.current;
    this.value = { shell: 1, depth: this.value.depth + (replace ? 0 : 1), route };
    this.write(replace);
    return this.current;
  }
  restore(): ShellRoute {
    this.value = entry(this.history.state) ?? { shell: 1, depth: 0, route: home() };
    return this.current;
  }
  back(): ShellRoute {
    if (this.value.depth > 0) { this.history.back(); return this.current; }
    const r = this.current;
    const screen = r.screen === 'workspace' ? (r.conversation ? 'chat' : 'manage')
      : r.screen === 'chat' ? r.returnTo ?? (r.conversation?.groupId ? 'groups' : 'chats')
      : r.screen === 'settings' ? 'manage' : r.screen === 'groups' ? 'chats' : 'home';
    return this.go({ ...r, screen, profile:screen === 'chat' ? r.profile : 'default', conversation: screen === 'chat' ? r.conversation : undefined }, true);
  }
}

export type ManagePage = 'hub' | 'profiles' | 'capabilities' | 'memory' | 'schedules' | 'messaging' | 'webhooks' | 'settings' | 'native' | 'kanban';
export interface ManageContext { page: ManagePage; profile: string }
/** Tab-local navigation only. Never retain fetched data, approvals or review tokens. */
export class ManageViews {
  private contexts = new Map<string, ManageContext>();
  read(gateway: GatewayIdentity): ManageContext {
    return { ...(this.contexts.get(JSON.stringify([gateway.id, gateway.url])) ?? {page:'hub', profile:''}) };
  }
  update(gateway: GatewayIdentity, context: ManageContext): void {
    this.contexts.set(JSON.stringify([gateway.id, gateway.url]), {page:context.page, profile:context.profile});
  }
}

export interface ConversationView {
  draft: string;
  scroll?: { top: number; atBottom: boolean };
  attachments?: { kind: 'image' | 'file'; name: string; path: string }[];
}
/** In-memory only: drafts never leak into browser history or durable credential storage. */
export class ConversationViews {
  private views = new Map<string, ConversationView>();
  private aliases = new Map<string, string>();
  private resolve(key: string): string {
    while (this.aliases.has(key)) key = this.aliases.get(key)!;
    return key;
  }
  /** Call only with identities verified by this conversation's resume/create.
   * Keys include gateway ID+endpoint and profile; never alias bare session IDs. */
  link(from: string, to: string): void {
    const source = this.resolve(from), target = this.resolve(to);
    if (source === target) return;
    if (this.views.has(source)) this.views.set(target, this.views.get(source)!);
    this.views.delete(source);
    this.aliases.set(source, target);
  }
  read(key: string): ConversationView { return this.views.get(this.resolve(key)) ?? { draft: '' }; }
  update(key: string, patch: Partial<ConversationView>): void {
    this.views.set(this.resolve(key), { ...this.read(key), ...patch });
  }
}
/** Erase only this app's documented namespaces, never the origin's whole storage. */
export function connectionLabel(state: ConnectionState): string {
  return state === 'open' ? 'Connected' : state === 'connecting' ? 'Connecting…' : state === 'error' ? 'Connection error' : state === 'closed' ? 'Disconnected' : 'Not connected';
}

export function isAppStorageKey(key: string): boolean {
  return key.startsWith('hermes-mobile.') || key.startsWith('hermes-projects-expanded:');
}

/** JSON tuples cannot collide when identifiers contain separators. */
export function conversationKey(route: ShellRoute): string {
  return JSON.stringify([route.gateway?.id, route.gateway?.url, route.profile, route.conversation?.groupId ? 'group' : 'session', route.conversation?.id]);
}
