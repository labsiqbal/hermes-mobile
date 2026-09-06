/** Device-local density only. Never writes gateway/profile configuration. */
export const APPEARANCE_KEY = 'hermes-mobile.ui-scale';
export type UIScale = 75 | 100 | 125;
type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function normalizeScale(value: unknown): UIScale {
  if (value === 75 || value === '75') return 75;
  if (value === 125 || value === '125') return 125;
  return 100;
}
function deviceStorage(): AppearanceStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
export function readScale(storage = deviceStorage()): UIScale {
  try { return normalizeScale(storage?.getItem(APPEARANCE_KEY)); } catch { return 100; }
}
export function persistScale(scale: UIScale, storage = deviceStorage()): boolean {
  try { if (!storage) return false; storage.setItem(APPEARANCE_KEY, String(normalizeScale(scale))); return true; } catch { return false; }
}
export function currentScale(): UIScale { return normalizeScale(document.documentElement.dataset.uiScale); }
export function applyScale(value: unknown): UIScale {
  const scale = normalizeScale(value);
  // The mounted transcript may be hidden behind Settings. Capture semantic text
  // anchors before reflow as well as bottom-pinning; do not change view identity.
  document.dispatchEvent(new Event('hermes-appearance-before'));
  document.documentElement.dataset.uiScale = String(scale);
  document.documentElement.style.setProperty('--ui-scale', String(scale / 100));
  document.dispatchEvent(new Event('hermes-appearance-change'));
  return scale;
}
export function setScale(value: unknown): boolean {
  const scale = applyScale(value);
  return persistScale(scale);
}
export function initializeAppearance(): void { applyScale(readScale()); }
