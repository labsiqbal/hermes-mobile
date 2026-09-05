import type { SessionSummary } from "../lib/hermes-client";

/** Sesi relay Bot Mode — judulnya selalu persis ini di gateway. */
export const RELAY_TITLE = "Bot Chat";

export interface SessionGroup {
  label: string;
  sessions: SessionSummary[];
}

export function isRelaySession(s: SessionSummary): boolean {
  return s.title === RELAY_TITLE;
}

/** `session.list` mengembalikan `started_at` sebagai epoch detik (float). */
export function sessionTime(s: SessionSummary): number {
  return (s.started_at ?? 0) * 1000;
}

const DAY_MS = 86_400_000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Kelompokkan sesi per waktu: Today / Yesterday / This week / Older.
 * Di dalam tiap grup, sesi relay ("Bot Chat") di-pin di atas, sisanya terbaru dulu.
 */
export function groupSessionsByTime(
  sessions: SessionSummary[],
  now: number = Date.now(),
): SessionGroup[] {
  const d = new Date(now);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startOfYesterday = startOfToday - DAY_MS;
  const startOfWeek = startOfToday - 6 * DAY_MS; // 7 hari terakhir termasuk hari ini

  const buckets: SessionSummary[][] = [[], [], [], []];
  for (const s of sessions) {
    const t = sessionTime(s);
    if (t >= startOfToday) buckets[0].push(s);
    else if (t >= startOfYesterday) buckets[1].push(s);
    else if (t >= startOfWeek) buckets[2].push(s);
    else buckets[3].push(s);
  }

  const labels = ["Today", "Yesterday", "This week", "Older"];
  return buckets
    .map((list, i) => ({
      label: labels[i],
      sessions: list.sort((a, b) => {
        const relay = Number(isRelaySession(b)) - Number(isRelaySession(a));
        return relay !== 0 ? relay : sessionTime(b) - sessionTime(a);
      }),
    }))
    .filter((g) => g.sessions.length > 0);
}

/** Timestamp singkat per grup — selalu data, jadi dirender mono. */
export function formatSessionTime(
  s: SessionSummary,
  groupLabel: string,
  now: number = Date.now(),
): string {
  const d = new Date(sessionTime(s));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (groupLabel === "Today") return `${hh}:${mm}`;
  if (groupLabel === "Yesterday") return `Yest ${hh}:${mm}`;
  if (groupLabel === "This week") return DAY_NAMES[d.getDay()];
  const date = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? date
    : `${date} ${d.getFullYear()}`;
}
