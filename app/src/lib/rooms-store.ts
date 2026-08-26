/**
 * rooms-store.ts — app-side metadata for Bot Rooms (multi-bot group chats).
 *
 * A room is ONLY a local mapping: one gateway session (titled exactly
 * "Bot Chat", the Bot Mode protocol trigger server-side) plus a display
 * name and member @handles chosen by the user. Several rooms may back
 * sessions that share the "Bot Chat" title — the sessionId mapping here
 * is the only thing that tells them apart.
 *
 * Pure and framework-agnostic (same pattern as ConnectionStore in
 * hermes-client.ts): storage is an injectable StorageLike, so the store
 * works in the browser (localStorage) and in Node tests (injected map).
 */

import type { StorageLike } from "./hermes-client";

export interface Room {
  id: string;
  /** Display name shown in the Rooms list (NOT the session title). */
  name: string;
  /** Bot @handles the user picked as members (without the @ prefix). */
  members: string[];
  /** Backing gateway session (a visible session titled "Bot Chat"). */
  sessionId: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

const STORE_KEY = "hermes-mobile.rooms.v1";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) return ls;
  } catch {
    /* access can throw in sandboxed frames */
  }
  return new MemoryStorage();
}

export function newRoomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Structural sanity check so a corrupt/foreign payload degrades to empty. */
function isRoom(value: unknown): value is Room {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    Array.isArray(r.members) &&
    r.members.every((m) => typeof m === "string") &&
    typeof r.sessionId === "string" &&
    typeof r.createdAt === "number"
  );
}

export class RoomStore {
  private storage: StorageLike;

  constructor(storage: StorageLike = defaultStorage()) {
    this.storage = storage;
  }

  list(): Room[] {
    try {
      const raw = this.storage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRoom);
    } catch {
      return [];
    }
  }

  /**
   * Persist a new room. `sessionId` comes from the freshly created backing
   * session (HermesConnection.sessionCreateRoom) — create the session FIRST,
   * then the mapping, so a store write can never point at nothing.
   */
  create(input: { name: string; members: string[]; sessionId: string }): Room {
    const room: Room = {
      id: newRoomId(),
      name: input.name.trim(),
      members: [...input.members],
      sessionId: input.sessionId,
      createdAt: Date.now(),
    };
    this.storage.setItem(STORE_KEY, JSON.stringify([...this.list(), room]));
    return room;
  }

  getBySessionId(sessionId: string): Room | undefined {
    return this.list().find((r) => r.sessionId === sessionId);
  }

  rename(id: string, name: string): void {
    const next = this.list().map((r) => (r.id === id ? { ...r, name: name.trim() } : r));
    this.storage.setItem(STORE_KEY, JSON.stringify(next));
  }

  /** Removes ONLY the local mapping — the backing chat session on the
   *  gateway is deliberately left alone (Bot Rooms v1). */
  remove(id: string): void {
    this.storage.setItem(
      STORE_KEY,
      JSON.stringify(this.list().filter((r) => r.id !== id)),
    );
  }
}
