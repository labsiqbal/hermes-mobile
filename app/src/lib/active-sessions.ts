const STORE_KEY = "hermes-mobile.active-sessions.v2";
const ALIASES_KEY = "hermes-mobile.session-aliases.v1";

interface ActiveSession {
  scope: string;
  sessionId: string;
  startedAt: number;
}

interface AliasGroup {
  scope: string;
  ids: string[];
}

interface CachedEvent {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: unknown;
}

interface SessionEventCache {
  generation: number;
  events: CachedEvent[];
}

const eventCaches = new WeakMap<object, Map<string, SessionEventCache>>();

function loadActive(): ActiveSession[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ActiveSession =>
        entry &&
        typeof entry.scope === "string" &&
        typeof entry.sessionId === "string" &&
        typeof entry.startedAt === "number",
    );
  } catch {
    return [];
  }
}

function saveActive(entries: ActiveSession[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

function loadAliases(): AliasGroup[] {
  try {
    const raw = localStorage.getItem(ALIASES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AliasGroup =>
        entry &&
        typeof entry.scope === "string" &&
        Array.isArray(entry.ids) &&
        entry.ids.every((id: unknown) => typeof id === "string"),
    );
  } catch {
    return [];
  }
}

function saveAliases(groups: AliasGroup[]): void {
  try {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(groups));
  } catch {
    /* ignore */
  }
}

function aliasesFor(scope: string, sessionIds: string[]): Set<string> {
  const aliases = new Set(sessionIds.filter(Boolean));
  const groups = loadAliases().filter((group) => group.scope === scope);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (!group.ids.some((id) => aliases.has(id))) continue;
      for (const id of group.ids) {
        if (!aliases.has(id)) {
          aliases.add(id);
          changed = true;
        }
      }
    }
  }
  return aliases;
}

export function linkSessionAliases(scope: string, ...sessionIds: (string | undefined)[]): void {
  const ids = sessionIds.filter((id): id is string => Boolean(id));
  if (ids.length < 2) return;
  const merged = aliasesFor(scope, ids);
  const groups = loadAliases().filter(
    (group) => group.scope !== scope || !group.ids.some((id) => merged.has(id)),
  );
  groups.push({ scope, ids: [...merged] });
  saveAliases(groups);
}

export function markActive(scope: string, sessionId: string): void {
  const aliases = aliasesFor(scope, [sessionId]);
  const entries = loadActive().filter(
    (entry) => entry.scope !== scope || !aliases.has(entry.sessionId),
  );
  entries.push({ scope, sessionId, startedAt: Date.now() });
  saveActive(entries);
}

export function markInactive(scope: string, sessionId: string): void {
  const aliases = aliasesFor(scope, [sessionId]);
  saveActive(
    loadActive().filter(
      (entry) => entry.scope !== scope || !aliases.has(entry.sessionId),
    ),
  );
}

export function isActive(scope: string, ...sessionIds: (string | undefined)[]): boolean {
  const aliases = aliasesFor(
    scope,
    sessionIds.filter((id): id is string => Boolean(id)),
  );
  return loadActive().some(
    (entry) => entry.scope === scope && aliases.has(entry.sessionId),
  );
}

export function getActiveSessions(): ActiveSession[] {
  return loadActive();
}

export function recordSessionEvent(
  owner: object,
  event: CachedEvent,
  generation: number,
): void {
  const sid = event.session_id;
  if (!sid) return;
  let cache = eventCaches.get(owner);
  if (!cache) {
    cache = new Map();
    eventCaches.set(owner, cache);
  }
  if (event.type === "message.start") {
    cache.set(sid, { generation, events: [event] });
    return;
  }
  const active = cache.get(sid);
  if (!active || active.generation !== generation) return;
  const previous = active.events.at(-1);
  const previousText = eventText(previous?.payload);
  const nextText = eventText(event.payload);
  if (previous?.type === "message.delta" && event.type === "message.delta" && nextText) {
    active.events[active.events.length - 1] = {
      ...event,
      payload: { ...eventObject(event.payload), text: previousText + nextText },
    };
  } else {
    active.events.push(event);
  }
}

export function getSessionEvents(
  owner: object,
  sessionId: string,
  generation: number,
): CachedEvent[] {
  const cached = eventCaches.get(owner)?.get(sessionId);
  return cached?.generation === generation ? [...cached.events] : [];
}

export function clearSessionEvents(
  owner: object,
  sessionId: string,
  generation: number,
): void {
  const cache = eventCaches.get(owner);
  const cached = cache?.get(sessionId);
  if (cached?.generation === generation) cache?.delete(sessionId);
}

function eventObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function eventText(payload: unknown): string {
  const text = eventObject(payload).text;
  return typeof text === "string" ? text : "";
}
