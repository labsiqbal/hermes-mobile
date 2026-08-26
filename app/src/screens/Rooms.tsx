/**
 * Rooms.tsx — Bot Rooms v1: grup multi-bot ala Telegram group, murni
 * app-side. Satu room = satu sesi gateway berjudul PERSIS "Bot Chat"
 * (visible; syarat protokol Bot Mode server). Metadata room (nama, member
 * @handle, sessionId) hidup di localStorage lewat RoomStore
 * (lib/rooms-store.ts) — beberapa room boleh sama-sama berjudul "Bot Chat",
 * pembedanya hanya mapping sessionId lokal.
 *
 * Export contract dipakai shell App: di-mount tanpa .appbar, client fallback
 * ke getActiveConnection() bila prop tidak diberikan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveConnection,
  type HermesConnection,
  type SavedConnection,
} from "../lib/hermes-client";
import { RoomStore, type Room } from "../lib/rooms-store";
import { botHandle, botTint, isBotManaged } from "./bots-utils";
import type { ProfileSummary } from "../lib/hermes-client";

const LONG_PRESS_MS = 500;
/** Gerakan pointer di atas ini (px) membatalkan long-press (user scroll). */
const LONG_PRESS_MOVE_TOLERANCE = 10;

function formatRoomTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Icon grup sederhana (tiga orang), stroke mengikuti currentColor. */
function GroupIcon({ size = 18 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.6c2.4.2 4 1.6 4.5 4" />
    </svg>
  );
}

type SheetState = { room: Room; mode: "menu" | "rename" | "confirm-delete" };

export function Rooms({
  client: clientProp,
  conn,
  onOpenRoom,
}: {
  client?: HermesConnection;
  conn?: SavedConnection;
  onOpenRoom: (sessionId: string) => void;
}) {
  const client = clientProp ?? getActiveConnection();
  const store = useMemo(() => new RoomStore(), []);

  const [rooms, setRooms] = useState<Room[]>(() => store.list());
  const [error, setError] = useState("");

  // ── Form room baru ──────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [bots, setBots] = useState<ProfileSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  // ── Action sheet (long-press) ───────────────────────────────────────────
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** true saat long-press baru terpicu — menekan click susulan. */
  const longPressFired = useRef(false);

  const reloadRooms = useCallback(() => setRooms(store.list()), [store]);

  const loadBots = useCallback(async () => {
    if (!client) return;
    try {
      const profiles = await client.profilesList({ includeSessions: false });
      setBots(profiles.filter(isBotManaged));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    if (!formOpen) return;
    void loadBots();
  }, [formOpen, loadBots]);

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
    (e: React.PointerEvent, room: Room) => {
      longPressFired.current = false;
      pressStart.current = { x: e.clientX, y: e.clientY };
      cancelPress();
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        longPressFired.current = true;
        navigator.vibrate?.(10);
        setRenameDraft(room.name);
        setSheet({ room, mode: "menu" });
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

  function toggleMember(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  async function createRoom() {
    if (!client || creating) return;
    const name = roomName.trim();
    if (!name) {
      setError("Nama room belum diisi.");
      return;
    }
    if (selected.size === 0) {
      setError("Pilih minimal satu bot sebagai member.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      // Sesi dulu, mapping lokal kemudian — store tak pernah menunjuk ke
      // sesi yang gagal dibuat. Judul sesi di server PERSIS "Bot Chat".
      const created = await client.sessionCreateRoom();
      store.create({ name, members: [...selected], sessionId: created.session_id });
      reloadRooms();
      setFormOpen(false);
      setRoomName("");
      setSelected(new Set());
      onOpenRoom(created.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function commitRename() {
    if (!sheet) return;
    const name = renameDraft.trim();
    if (name) {
      store.rename(sheet.room.id, name);
      reloadRooms();
    }
    setSheet(null);
  }

  function commitRemove() {
    if (!sheet) return;
    store.remove(sheet.room.id);
    reloadRooms();
    setSheet(null);
  }

  if (!client) {
    return (
      <div className="screen">
        <div className="body" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
            Tidak ada koneksi gateway aktif — sambungkan device dulu.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="body">
        <button
          className="btn btn-primary"
          onClick={() => {
            setFormOpen((v) => !v);
            setError("");
          }}
        >
          + Room baru
        </button>

        {error && <div className="error-line">{error}</div>}

        {formOpen && (
          <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="rowcard-title">Room baru</div>
            <input
              className="field"
              type="text"
              placeholder="Nama room…"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
            <div className="section-label">Member bot</div>
            {bots === null && <div className="hint">Memuat daftar bot…</div>}
            {bots !== null && bots.length === 0 && (
              <div className="hint">Belum ada bot-managed profile di gateway ini.</div>
            )}
            {bots?.map((bot) => {
              const handle = botHandle(bot);
              const checked = selected.has(handle);
              const tint = botTint(handle);
              return (
                <button
                  key={bot.name}
                  className="rowcard"
                  style={{ padding: "10px 14px" }}
                  onClick={() => toggleMember(handle)}
                  aria-pressed={checked}
                >
                  <span
                    className="sess-avatar"
                    style={{
                      width: 30,
                      height: 30,
                      fontSize: 11,
                      background: tint.bg,
                      color: tint.fg,
                    }}
                  >
                    <GroupIcon size={15} />
                  </span>
                  <div className="rowcard-main">
                    <div className="rowcard-title mono" style={{ fontSize: 12 }}>
                      @{handle}
                    </div>
                  </div>
                  <span
                    className="chip"
                    style={
                      checked
                        ? { background: tint.bg, borderColor: tint.fg, color: tint.fg }
                        : undefined
                    }
                  >
                    {checked ? "✓ dipilih" : "pilih"}
                  </span>
                </button>
              );
            })}
            <div className="sheet-actions">
              <button
                className="btn btn-primary"
                disabled={creating}
                onClick={() => void createRoom()}
              >
                {creating ? "Membuat…" : "Buat"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={creating}
                onClick={() => {
                  setFormOpen(false);
                  setError("");
                }}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {rooms.length === 0 && !formOpen && (
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
            <span className="chip chip-warm">rooms</span>
            <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>
              Belum ada room — bikin grup bot pertamamu.
            </div>
          </div>
        )}

        {rooms.length > 0 && (
          <div className="section-label">{conn?.label ?? client.url}</div>
        )}
        {rooms.map((room) => (
          <button
            key={room.id}
            className="rowcard"
            onClick={() => {
              // Click susulan setelah long-press jangan membuka room.
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              onOpenRoom(room.sessionId);
            }}
            onPointerDown={(e) => onRowPointerDown(e, room)}
            onPointerMove={onRowPointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
          >
            <span className="sess-avatar" style={{ background: "var(--elevated)" }}>
              <GroupIcon size={18} />
            </span>
            <div className="rowcard-main">
              <div className="rowcard-title">{room.name}</div>
              <div
                className="rowcard-sub"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  whiteSpace: "normal",
                  marginTop: 6,
                }}
              >
                {room.members.map((handle) => {
                  const tint = botTint(handle);
                  return (
                    <span
                      key={handle}
                      className="chip"
                      style={{
                        background: tint.bg,
                        borderColor: "transparent",
                        color: tint.fg,
                      }}
                    >
                      @{handle}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="rowcard-meta">{formatRoomTime(room.createdAt)}</div>
          </button>
        ))}
      </div>

      {sheet && (
        <>
          <div className="sheet-dim" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-grab" />
            {sheet.mode === "menu" && (
              <>
                <div className="rowcard-title">{sheet.room.name}</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  {sheet.room.members.length} member · sesi “Bot Chat” di server
                </div>
                <div className="sheet-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setSheet({ ...sheet, mode: "rename" })}
                  >
                    Ubah nama
                  </button>
                  <button
                    className="btn btn-destructive"
                    onClick={() => setSheet({ ...sheet, mode: "confirm-delete" })}
                  >
                    Hapus room
                  </button>
                  <button className="btn btn-ghost" onClick={() => setSheet(null)}>
                    Batal
                  </button>
                </div>
              </>
            )}
            {sheet.mode === "rename" && (
              <>
                <div className="rowcard-title">Ubah nama room</div>
                <input
                  className="field"
                  type="text"
                  style={{ margin: "10px 0 14px" }}
                  placeholder="Nama room…"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                  }}
                />
                <div className="sheet-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!renameDraft.trim()}
                    onClick={commitRename}
                  >
                    Simpan
                  </button>
                  <button className="btn btn-ghost" onClick={() => setSheet(null)}>
                    Batal
                  </button>
                </div>
              </>
            )}
            {sheet.mode === "confirm-delete" && (
              <>
                <div className="rowcard-title">Hapus room ini?</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  Hanya mapping lokal “{sheet.room.name}” yang dihapus. Sesi
                  chat-nya tetap ada di server (judul “Bot Chat”) dan bisa
                  dihapus dari daftar chat bila perlu.
                </div>
                <div className="sheet-actions">
                  <button className="btn btn-destructive" onClick={commitRemove}>
                    Hapus
                  </button>
                  <button className="btn btn-ghost" onClick={() => setSheet(null)}>
                    Batal
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
