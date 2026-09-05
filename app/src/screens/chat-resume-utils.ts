import type { GatewayEvent } from "../lib/hermes-client";

/** History already owns settled turns; only replay events after latest terminal
 * event represent current live state when reopening a session. */
export function liveTurnEvents(events: GatewayEvent[]): GatewayEvent[] {
  let terminal = -1;
  events.forEach((event, index) => {
    if (event.type === "message.complete" || event.type === "error") terminal = index;
  });
  return terminal >= 0 ? events.slice(terminal + 1) : events;
}

/** Cache hanya melengkapi state turn yang menurut gateway masih berjalan. */
export function resumeTurnEvents(events: GatewayEvent[], running: boolean): GatewayEvent[] {
  return running ? liveTurnEvents(events) : [];
}

/** Gabungkan state awal dengan event baru yang tiba selama fetch history.
 * Event baseline lama hanya dipercaya ketika gateway menyatakan turn berjalan;
 * object baru dari cache selalu dipulihkan karena lahir setelah snapshot resume. */
export function resumeCatchupEvents(
  baseline: GatewayEvent[],
  latest: GatewayEvent[],
  running: boolean,
): GatewayEvent[] {
  const known = new Set(baseline);
  return [
    ...resumeTurnEvents(baseline, running),
    ...latest.filter((event) => !known.has(event)),
  ];
}

/** Event saat initial resume masih masuk cache; belum boleh dianimasikan sebagai live. */
export function acceptLiveEvent(resumeCatchup: boolean): boolean {
  return !resumeCatchup;
}

/** Initial resume selalu snap; smooth-scroll hanya untuk pertumbuhan live berikutnya. */
export function allowSmoothAutoScroll(
  initializing: boolean,
  initialSnapPending: boolean,
  grew: boolean,
  reducedMotion: boolean,
): boolean {
  return !initializing && !initialSnapPending && grew && !reducedMotion;
}

/** Pertahankan baris yang terlihat saat halaman lama ditambahkan di atas. */
export function shouldFetchSessionHistory(hasSession: boolean, storedSessionId: string, unpersisted = false): boolean {
  return hasSession && Boolean(storedSessionId) && !unpersisted;
}

export function preservedScrollTop(
  previousScrollHeight: number,
  previousScrollTop: number,
  nextScrollHeight: number,
): number {
  return previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight);
}

/** Durable row identity for latest-offset overlap dedup. */
export function historyMessageKey(message: Record<string, unknown>): string | null {
  const value = message.id ?? message.row_id ?? message.rowId ?? message.message_id;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/** Latest-order offsets can overlap when new rows persist after hydration. */
export function freshHistoryMessages<T extends Record<string, unknown>>(
  messages: T[],
  loadedKeys: Set<string>,
): T[] {
  return messages.filter((message) => {
    const key = historyMessageKey(message);
    if (!key) return true;
    if (loadedKeys.has(key)) return false;
    loadedKeys.add(key);
    return true;
  });
}
