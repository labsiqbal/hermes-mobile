/**
 * Groups.tsx — daftar + pembuatan group chat Hermes (design/index.html
 * layar 07-08, dialog "New Group Chat" Desktop).
 *
 * Group chat Hermes 100% client-orchestrated: registry room = envelope v3 di
 * ui_meta['hermes-bots-groups'] pada profile `default`, membership per bot di
 * ui_meta['hermes-bots'].groups. Mobile membaca/menulis format yang SAMA
 * dengan Desktop (lib/group-store.ts) lewat profiles.list + profiles.configure
 * CAS (lib/hermes-client.ts), jadi Desktop dan HP melihat group yang sama.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveConnection,
  UiMetaConflictError,
  type HermesConnection,
  type ProfileSummary,
  type SavedConnection,
} from "../lib/hermes-client";
import {
  GROUPS_META_KEY,
  mintGroupRoomId,
  readGroupRegistry,
  removeRoom,
  uniqueGroupName,
  upsertRoom,
  type GroupMember,
  type GroupRegistry,
  type GroupRoom,
} from "../lib/group-store";
import { botHandle, botInitials, botTint, botTitle, isBotManaged } from "./bots-utils";
import { ChevronRightIcon } from "../components/icons";

const ROSTER_POLL_MS = 20_000;
const LONG_PRESS_MS = 500;
/** Gerakan pointer di atas ini (px) membatalkan long-press (user sedang scroll). */
const LONG_PRESS_MOVE_TOLERANCE = 10;
/** Batas member per group (plugin.js GROUP_CHAT_MAX_MEMBERS). */
const MAX_GROUP_MEMBERS = 6;
const MIN_GROUP_MEMBERS = 2;
/** Percobaan read-merge-retry saat tulisan CAS registry berkonflik. */
const CAS_MAX_ATTEMPTS = 3;
/** ui_meta key membership per bot (plugin.js botGroups/groupMembershipPatch). */
const BOTS_META_KEY = "hermes-bots";

/** Revisi CAS envelope registry pada baris profile `default` (0 = belum pernah
 *  ditulis — gateway memperlakukan key yang hilang sebagai revisi 0). */
function registryRevision(profiles: readonly ProfileSummary[]): number {
  const row = profiles.find((p) => p.name === "default");
  return Math.max(0, Number(row?.ui_meta_revisions?.[GROUPS_META_KEY]) || 0);
}

/**
 * Satu siklus read-merge-write CAS dengan retry terbatas: baca registry
 * remote terbaru, terapkan `mutate`, tulis dengan revisi yang baru dibaca.
 * Konflik (Desktop menulis bersamaan) → merge ulang di atas remote terbaru,
 * maks CAS_MAX_ATTEMPTS×. Mengembalikan registry yang berhasil tertulis.
 */
async function writeRegistryWithRetry(
  client: HermesConnection,
  mutate: (remote: GroupRegistry) => GroupRegistry,
): Promise<GroupRegistry> {
  for (let attempt = 1; ; attempt++) {
    const profiles = await client.profilesList({ includeSessions: false });
    const remote = readGroupRegistry(profiles);
    const next = mutate(remote);
    try {
      await client.syncGroupRegistry(next, registryRevision(profiles));
      return next;
    } catch (err) {
      if (err instanceof UiMetaConflictError && attempt < CAS_MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

/** Membership groups seorang bot dari ui_meta['hermes-bots'] — array `groups`
 *  kanonik, skalar `group` warisan sebagai fallback (plugin.js botGroups). */
function botGroups(meta: Record<string, unknown> | null): string[] {
  const values = Array.isArray(meta?.groups) ? meta.groups : [meta?.group];
  const groups: string[] = [];
  for (const value of values) {
    const group = String(value ?? "").trim();
    if (group && !groups.includes(group)) groups.push(group);
  }
  return groups;
}

function botsMeta(profile: ProfileSummary): Record<string, unknown> | null {
  const meta = profile.ui_meta?.[BOTS_META_KEY];
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

/** Label tampilan member untuk nama default group (Desktop: displayName). */
function memberLabel(profile: ProfileSummary): string {
  return botTitle(profile) || botHandle(profile);
}

export function Groups({
  client: clientProp,
  conn,
  onOpenGroup,
}: {
  client?: HermesConnection;
  conn?: SavedConnection;
  onOpenGroup: (roomId: string) => void;
}) {
  const client = clientProp ?? getActiveConnection();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"list" | "create">("list");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GroupRoom | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** true saat long-press baru saja terpicu — menekan click susulan. */
  const longPressFired = useRef(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setProfiles(await client.profilesList({ includeSessions: false }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void load();
    const timer = setInterval(() => {
      if (client.connectionState === "open") void load();
    }, ROSTER_POLL_MS);
    return () => clearInterval(timer);
  }, [client, load]);

  useEffect(() => {
    if (!client) return;
    return client.addStateHandler((s) => {
      if (s === "open") void load();
    });
  }, [client, load]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onRowPointerDown = useCallback(
    (e: React.PointerEvent, room: GroupRoom) => {
      longPressFired.current = false;
      pressStart.current = { x: e.clientX, y: e.clientY };
      cancelPress();
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        longPressFired.current = true;
        navigator.vibrate?.(10);
        setPendingDelete(room);
      }, LONG_PRESS_MS);
    },
    [cancelPress],
  );

  const onRowPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pressTimer.current || !pressStart.current) return;
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOLERANCE ** 2) cancelPress();
    },
    [cancelPress],
  );

  const registry = useMemo(() => readGroupRegistry(profiles ?? []), [profiles]);

  /** Room tampil: abaikan tombstone, terbaru (entry log terakhir) di atas. */
  const rooms = useMemo(
    () =>
      Object.values(registry.rooms).sort(
        (a, b) => (b.log[b.log.length - 1]?.at ?? 0) - (a.log[a.log.length - 1]?.at ?? 0),
      ),
    [registry],
  );

  const bots = useMemo(() => (profiles ?? []).filter(isBotManaged), [profiles]);

  async function confirmDelete() {
    const target = pendingDelete;
    if (!client || !target || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await writeRegistryWithRetry(client, (remote) => removeRoom(remote, target.roomId));
      setPendingDelete(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingDelete(null);
      void load();
    } finally {
      setDeleting(false);
    }
  }

  if (!client) {
    return (
      <div className="screen">
        <div className="body" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
            No active gateway connection — connect a device first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="body">
        {mode === "list" ? (
          <>
            <button className="btn btn-primary" onClick={() => setMode("create")}>
              + New group
            </button>
            {error && <div className="error-line">{error}</div>}

            {profiles !== null && rooms.length > 0 && (
              <>
                <div className="section-label">
                  Groups · {conn?.label ?? client.url}
                </div>
                {rooms.map((room) => (
                  <GroupRow
                    key={room.roomId}
                    room={room}
                    onOpen={() => {
                      // Click susulan setelah long-press jangan membuka room.
                      if (longPressFired.current) {
                        longPressFired.current = false;
                        return;
                      }
                      onOpenGroup(room.roomId);
                    }}
                    onPointerDown={(e) => onRowPointerDown(e, room)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={cancelPress}
                    onPointerCancel={cancelPress}
                    onPointerLeave={cancelPress}
                  />
                ))}
                <div style={{ flex: 1 }} />
                <div className="hint">
                  The registry is read from the <span className="mono">default</span> profile's{" "}
                  <span className="mono">ui_meta</span> — the same groups appear on Desktop.
                  Long-press a group to delete it.
                </div>
              </>
            )}

            {profiles !== null && rooms.length === 0 && !error && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <span className="chip chip-warm">groups</span>
                <div className="appbar-title" style={{ fontSize: 15 }}>
                  Group Chat
                </div>
                <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
                  No groups yet — create your first bot group.
                </div>
              </div>
            )}

            {profiles === null && !error && <div className="hint">Loading groups…</div>}
          </>
        ) : (
          <CreateGroupCard
            client={client}
            conn={conn}
            bots={bots}
            busy={creating}
            setBusy={setCreating}
            onError={setError}
            onCancel={() => {
              setMode("list");
              setError("");
            }}
            onCreated={(roomId) => {
              setMode("list");
              setError("");
              void load();
              onOpenGroup(roomId);
            }}
          />
        )}
      </div>

      {pendingDelete && (
        <>
          <div
            className="sheet-dim"
            onClick={() => {
              if (!deleting) setPendingDelete(null);
            }}
          />
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-grab" />
            <div className="rowcard-title">Delete this group?</div>
            <div className="hint" style={{ margin: "8px 0 14px" }}>
              “{pendingDelete.name}” will be dissolved from the shared registry. Each
              member's sessions stay on the server — only the room is removed.
            </div>
            <div className="sheet-actions">
              <button
                className="btn btn-destructive"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Delete group"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GroupRow({
  room,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}: {
  room: GroupRoom;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}) {
  const iconTint = botTint(room.name || "?");
  return (
    <button
      className="rowcard"
      onClick={onOpen}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      <span
        className="botavatar"
        style={{ background: iconTint.bg, color: iconTint.fg }}
      >
        <GroupIcon size={17} />
      </span>
      <div className="rowcard-main">
        <div className="rowcard-title">{room.name}</div>
        <div className="rowcard-sub" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {room.members.slice(0, 4).map((member) => {
            const tint = botTint(member.handle || member.name);
            return (
              <span
                key={`${member.connectionId}:${member.name}`}
                className="chip"
                style={{
                  background: tint.bg,
                  color: tint.fg,
                  borderColor: "transparent",
                }}
              >
                @{member.handle || member.name}
              </span>
            );
          })}
          {room.members.length > 4 && (
            <span className="chip">+{room.members.length - 4}</span>
          )}
          {room.members.length === 0 && "—"}
        </div>
      </div>
      <div className="rowcard-meta mono" style={{ textAlign: "right" }}>
        {room.log.length} pesan
        <br />
        {room.members.length} bot
      </div>
      <span className="chevron">
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}

function CreateGroupCard({
  client,
  conn,
  bots,
  busy,
  setBusy,
  onError,
  onCancel,
  onCreated,
}: {
  client: HermesConnection;
  conn?: SavedConnection;
  bots: ProfileSummary[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onCancel: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProfileSummary[]>([]);
  const [name, setName] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) =>
      `${botHandle(bot)} ${bot.description ?? ""} ${bot.display_name ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [bots, query]);

  const isSelected = (bot: ProfileSummary) => selected.some((s) => s.name === bot.name);

  const toggle = (bot: ProfileSummary) => {
    if (busy) return;
    setSelected((prev) => {
      if (prev.some((s) => s.name === bot.name)) {
        return prev.filter((s) => s.name !== bot.name);
      }
      if (prev.length >= MAX_GROUP_MEMBERS) return prev;
      return [...prev, bot];
    });
  };

  /** Nama default: gabungan nama member dipisah koma (Desktop: placeholder
   *  join displayName). Basis dipotong 64 char, suffix unik ditambah nanti. */
  const defaultName = selected.map(memberLabel).join(", ").slice(0, 64);
  const canCreate =
    !busy && selected.length >= MIN_GROUP_MEMBERS && Boolean(name.trim() || defaultName);

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    onError("");
    try {
      // Baca roster segar: membership bot dan registry bisa berubah sejak
      // layar dimuat (Desktop menulis slot yang sama).
      const fresh = await client.profilesList({ includeSessions: false });
      const base = (name.trim() || defaultName).slice(0, 64);
      const groupName = uniqueGroupName(base, readGroupRegistry(fresh));
      const roomId = mintGroupRoomId();

      const members: GroupMember[] = selected.map((bot) => ({
        name: bot.name,
        handle: botHandle(bot),
        connectionId: conn?.id ?? "",
        connectionLabel: conn?.label ?? client.url,
      }));

      // 1) Membership per bot: append nama group ke ui_meta['hermes-bots']
      //    (array `groups` kanonik + `group` sebagai proyeksi membership
      //    pertama, persis groupMembershipPatch Desktop). Per-key replace di
      //    server, jadi meta lama di-spread utuh.
      for (const bot of selected) {
        const freshBot = fresh.find((p) => p.name === bot.name);
        const meta = { ...(botsMeta(freshBot ?? bot) ?? {}) };
        const groups = botGroups(meta);
        if (!groups.includes(groupName)) groups.push(groupName);
        await client.profileConfigureUiMeta({
          name: bot.name,
          uiMeta: { [BOTS_META_KEY]: { ...meta, groups, group: groups[0] ?? null } },
        });
      }

      // 2) Room baru di registry bersama (log kosong), CAS + retry terbatas.
      const room: GroupRoom = {
        roomId,
        name: groupName,
        members,
        log: [],
        revision: 0,
      };
      await writeRegistryWithRetry(client, (remote) => upsertRoom(remote, room));

      onCreated(roomId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-label">Group baru · pilih {MIN_GROUP_MEMBERS}–{MAX_GROUP_MEMBERS} bot</div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selected.map((bot) => {
            const handle = botHandle(bot);
            const tint = botTint(handle);
            return (
              <span
                key={bot.name}
                className="chip"
                style={{ background: tint.bg, color: tint.fg, borderColor: "transparent" }}
              >
                @{handle}
                <span
                  role="button"
                  aria-label={`remove ${handle}`}
                  style={{ marginLeft: 2, opacity: 0.65, cursor: "pointer" }}
                  onClick={() => toggle(bot)}
                >
                  ×
                </span>
              </span>
            );
          })}
        </div>
      )}
      <input
        className="field"
        type="search"
        placeholder="Search bots…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {bots.length === 0 && (
        <div className="hint">
          No bot-managed profiles yet — add bots via Desktop first.
        </div>
      )}
      {bots.length > 0 && visible.length === 0 && (
        <div className="hint">No bots match “{query.trim()}”.</div>
      )}
      {visible.map((bot) => {
        const handle = botHandle(bot);
        const tint = botTint(handle);
        const checked = isSelected(bot);
        const atCap = !checked && selected.length >= MAX_GROUP_MEMBERS;
        return (
          <button
            key={bot.name}
            className="rowcard"
            style={atCap ? { opacity: 0.45 } : undefined}
            disabled={busy || atCap}
            onClick={() => toggle(bot)}
          >
            <span className="botavatar" style={{ background: tint.bg, color: tint.fg }}>
              {botInitials(handle)}
            </span>
            <div className="rowcard-main">
              <div className="rowcard-title mono" style={{ color: "var(--cyan)", fontSize: 12 }}>
                @{handle}
              </div>
              <div className="rowcard-sub">{bot.description || bot.display_name || "—"}</div>
            </div>
            <span
              aria-hidden="true"
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                border: checked ? "none" : "1px solid var(--line)",
                background: checked ? tint.bg : "transparent",
                color: checked ? tint.fg : "var(--fg-faint)",
              }}
            >
              {checked ? "✓" : ""}
            </span>
          </button>
        );
      })}
      <input
        className="field"
        placeholder={defaultName || "Group name"}
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!canCreate}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : `Create Group (${selected.length})`}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="hint">
        Empty name → the members' names are combined. If a name is taken,
        a “ 2”, “ 3”, … suffix is added automatically.
      </div>
    </>
  );
}

/** Ikon grup (dua figur) — dipakai sebagai avatar room di daftar. */
function GroupIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
