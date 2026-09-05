/**
 * group-store.ts — Desktop-compatible group chat registry types.
 *
 * Desktop (apps/desktop/src/plugins/hermes-bots/plugin.js) keeps group rooms
 * in the `default` profile's `ui_meta['hermes-bots-groups']` envelope (v3) and
 * per-bot membership in `ui_meta['hermes-bots'].groups`. Mobile mirrors the
 * SAME format so Desktop and phone see the same groups.
 *
 * Owned additively by the group feature agents — extend, don't reshape.
 */

/** Immutable room id: "r<base36-ts>-<rand5>" (plugin.js mintGroupRoomId). */
export function mintGroupRoomId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `r${ts}-${rand}`;
}

/** Source-qualified member descriptor (plugin.js durableGroupChatMembers). */
export interface GroupMember {
  /** Profile name on its own gateway (e.g. "default", "orca"). */
  name: string;
  /** Bot handle without @ (e.g. "hermes"). */
  handle: string;
  /** Connection id of the member's gateway; same-gateway = local conn id. */
  connectionId: string;
  /** Display label of the member's gateway (e.g. "nuc"). */
  connectionLabel: string;
}

export interface GroupLogEntry {
  kind: "user" | "member" | "system";
  /** Member handle for kind=member. */
  name?: string;
  text: string;
  /** Thread id — every composer send starts a new thread (plugin.js:8067). */
  thread: string;
  at: number;
}

export interface GroupRoom {
  roomId: string;
  name: string;
  members: GroupMember[];
  /** Rolling mirror, capped at 16 entries × 1200 chars server-side. */
  log: GroupLogEntry[];
  revision: number;
  image?: string;
}

/** Envelope v3 stored at default profile ui_meta['hermes-bots-groups']. */
export interface GroupRegistry {
  version: 3;
  updatedAt: number;
  rooms: Record<string, GroupRoom>; // keyed `id:<roomId>`
  deleted: Record<string, { roomId: string; name?: string; deletedAt: number }>;
}

export function emptyGroupRegistry(): GroupRegistry {
  return { version: 3, updatedAt: Date.now(), rooms: {}, deleted: {} };
}

export function groupRoomKey(roomId: string): string {
  return `id:${roomId}`;
}

/** Member session title per member profile (plugin.js:7129-7134). */
export function groupSessionTitle(roomId: string): string {
  return `Group: ${roomId}`;
}

// ---------------------------------------------------------------------------
// Registry read/write helpers (additive — pure functions, no I/O)
// ---------------------------------------------------------------------------

/** ui_meta key on the `default` profile that carries the envelope
 *  (plugin.js GROUP_CHAT_SYNC_META_KEY). */
export const GROUPS_META_KEY = "hermes-bots-groups";

/** Server-side mirror caps (plugin.js GROUP_CHAT_SYNC_MESSAGES /
 *  GROUP_CHAT_SYNC_TEXT_CHARS) — clients append with the same bounds. */
export const GROUP_LOG_MAX_ENTRIES = 16;
export const GROUP_LOG_MAX_TEXT_CHARS = 1200;

/** Minimal structural shape of one `profiles.list` row — group-store stays
 *  decoupled from hermes-client; anything with name + ui_meta qualifies. */
export interface ProfileMetaRow {
  name?: string;
  ui_meta?: Record<string, unknown> | null;
  /** Per-key CAS revision counters (present on gateways with the CAS
   *  contract) — the expectedRevision source for syncGroupRegistry. */
  ui_meta_revisions?: Record<string, unknown> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLogEntry(raw: unknown): GroupLogEntry | null {
  if (!isPlainObject(raw)) return null;
  // Desktop's compact snapshot nests sender under `from`; the local mirror
  // uses flat kind/name. Accept both.
  const from = isPlainObject(raw.from) ? raw.from : {};
  const kindRaw = raw.kind ?? from.kind;
  const kind: GroupLogEntry["kind"] =
    kindRaw === "member" ? "member" : kindRaw === "system" ? "system" : "user";
  const nameRaw = raw.name ?? from.name;
  return {
    kind,
    ...(nameRaw !== undefined ? { name: String(nameRaw ?? "") } : {}),
    text: String(raw.text ?? ""),
    thread: String(raw.thread ?? ""),
    at: Number(raw.at) || 0,
  };
}

function normalizeMember(raw: unknown): GroupMember | null {
  if (!isPlainObject(raw)) return null;
  return {
    name: String(raw.name ?? ""),
    handle: String(raw.handle ?? ""),
    connectionId: String(raw.connectionId ?? ""),
    connectionLabel: String(raw.connectionLabel ?? ""),
  };
}

function normalizeRoom(key: string, raw: unknown): GroupRoom | null {
  if (!isPlainObject(raw)) return null;
  const roomId =
    String(raw.roomId ?? "") || (key.startsWith("id:") ? key.slice(3) : key);
  const name =
    String(raw.name ?? "") || (key.startsWith("name:") ? key.slice(5) : roomId);
  const members = Array.isArray(raw.members)
    ? raw.members.map(normalizeMember).filter((m): m is GroupMember => m !== null)
    : [];
  const log = Array.isArray(raw.log)
    ? raw.log.map(normalizeLogEntry).filter((e): e is GroupLogEntry => e !== null)
    : [];
  return {
    roomId,
    name,
    members,
    log,
    revision: Math.max(0, Number(raw.revision) || 0),
    ...(typeof raw.image === "string" && raw.image ? { image: raw.image } : {}),
  };
}

/**
 * Extract the group registry from a `profiles.list` result: the `default`
 * profile's `ui_meta['hermes-bots-groups']` envelope (v3). Tolerant by
 * design — a missing/legacy/malformed envelope yields emptyGroupRegistry()
 * (mirrors plugin.js normalizeGroupChatSyncSnapshot, which also lifts v1/v2
 * projections and never throws on bad shapes).
 */
export function readGroupRegistry(profiles: readonly ProfileMetaRow[]): GroupRegistry {
  const profile = (profiles ?? []).find((row) => row?.name === "default");
  const envelope = profile?.ui_meta?.[GROUPS_META_KEY];
  if (!isPlainObject(envelope)) return emptyGroupRegistry();

  const registry = emptyGroupRegistry();
  registry.updatedAt = Number(envelope.updatedAt) || 0;

  const rooms = envelope.rooms;
  if (isPlainObject(rooms)) {
    for (const [key, raw] of Object.entries(rooms)) {
      const room = normalizeRoom(key, raw);
      if (room) registry.rooms[key] = room;
    }
  }

  const deleted = envelope.deleted;
  if (isPlainObject(deleted)) {
    for (const [key, raw] of Object.entries(deleted)) {
      const roomId = key.startsWith("id:") ? key.slice(3) : key;
      if (isPlainObject(raw)) {
        registry.deleted[key] = {
          roomId: String(raw.roomId ?? roomId),
          ...(raw.name !== undefined ? { name: String(raw.name ?? "") } : {}),
          deletedAt: Number(raw.deletedAt) || 0,
        };
      } else {
        // Desktop v3 tombstones are bare gateway revisions (numbers); the
        // exact deletedAt is unrecoverable but the tombstone must survive.
        registry.deleted[key] = { roomId, deletedAt: 0 };
      }
    }
  }

  return registry;
}

/** Current CAS revision of the groups envelope on the `default` profile —
 *  pass this as `expectedRevision` to syncGroupRegistry. Returns 0 when the
 *  gateway reports no counter for the key (envelope not written yet). */
export function groupsMetaRevision(profiles: readonly ProfileMetaRow[]): number {
  const profile = (profiles ?? []).find((row) => row?.name === "default");
  const revisions = profile?.ui_meta_revisions;
  if (!isPlainObject(revisions)) return 0;
  return Number(revisions[GROUPS_META_KEY]) || 0;
}

/** Insert/replace a room (keyed `id:<roomId>`). Returns a NEW registry —
 *  the input is never mutated, so callers can keep the pre-write snapshot
 *  for CAS read-merge-retry. */
export function upsertRoom(reg: GroupRegistry, room: GroupRoom): GroupRegistry {
  return {
    ...reg,
    updatedAt: Date.now(),
    rooms: { ...reg.rooms, [groupRoomKey(room.roomId)]: room },
  };
}

/** Move a room to the deleted tombstone map. Tombstones for `id:`-keyed
 *  rooms are final on Desktop (the roomId is minted once and never reused),
 *  so the value shape beyond the key matters only for display. No-op when
 *  the roomId is unknown. */
export function removeRoom(reg: GroupRegistry, roomId: string): GroupRegistry {
  const key =
    groupRoomKey(roomId) in reg.rooms
      ? groupRoomKey(roomId)
      : Object.keys(reg.rooms).find((k) => reg.rooms[k]?.roomId === roomId);
  if (!key) return reg;
  const room = reg.rooms[key];
  const rooms = { ...reg.rooms };
  delete rooms[key];
  return {
    ...reg,
    updatedAt: Date.now(),
    rooms,
    deleted: {
      ...reg.deleted,
      [key]: { roomId, name: room?.name, deletedAt: Date.now() },
    },
  };
}

/** Unique display name for a NEW group: collisions against live room names
 *  get a " 2", " 3", … suffix (plugin.js uniqueGroupChatName). The BASE is
 *  truncated, never the joined string, so a 64-char base keeps its suffix.
 *  Tombstoned names are reusable immediately (desktop liveGroupChatNames). */
export function uniqueGroupName(base: string, reg: GroupRegistry): string {
  const taken = new Set(Object.values(reg.rooms).map((room) => room.name));
  const trimmed = base.trim().slice(0, 64);
  if (!taken.has(trimmed)) return trimmed;
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const candidate = trimmed.slice(0, 64 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("No free name available for the group.");
}

/** Append one entry to a room's log with the server-side mirror caps
 *  (16 entries × 1200 chars). Returns a NEW room; the input is untouched. */
export function appendLogCapped(room: GroupRoom, entry: GroupLogEntry): GroupRoom {
  const capped: GroupLogEntry = {
    ...entry,
    text: entry.text.slice(0, GROUP_LOG_MAX_TEXT_CHARS),
  };
  return {
    ...room,
    log: [...room.log, capped].slice(-GROUP_LOG_MAX_ENTRIES),
  };
}
