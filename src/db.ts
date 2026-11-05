import { get, set, del, keys } from 'idb-keyval';
import type { Board, Settings } from './types';

export interface PersistedState {
  version: 1;
  boards: Board[];
  currentBoardId: string;
  settings: Settings;
  recent: { boardId: string; elId: string }[];
}

const STATE_KEY = 'sn:state';

export async function loadState(): Promise<PersistedState | null> {
  try {
    return ((await get(STATE_KEY)) as PersistedState) ?? null;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistedState | null = null;

export function saveStateDebounced(s: PersistedState) {
  pending = s;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

export async function flushSave() {
  if (!pending) return;
  const s = pending;
  pending = null;
  try {
    await set(STATE_KEY, s);
  } catch (e) {
    console.error('save failed', e);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}

// ---------- картинки (хранятся отдельно, чтобы не гонять их при каждом сохранении) ----------
const imgCache = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

export async function putImage(id: string, dataUrl: string) {
  imgCache.set(id, dataUrl);
  await set('img:' + id, dataUrl);
  listeners.get(id)?.forEach((f) => f());
}

export function getImageCached(id: string): string | undefined {
  return imgCache.get(id);
}

export async function getImage(id: string): Promise<string | undefined> {
  if (imgCache.has(id)) return imgCache.get(id);
  const v = (await get('img:' + id)) as string | undefined;
  if (v) imgCache.set(id, v);
  return v;
}

export function onImage(id: string, f: () => void) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(f);
  return () => listeners.get(id)!.delete(f);
}

export async function allImageIds(): Promise<string[]> {
  const ks = await keys();
  return ks.filter((k) => typeof k === 'string' && k.startsWith('img:')).map((k) => (k as string).slice(4));
}

export async function deleteImage(id: string) {
  imgCache.delete(id);
  await del('img:' + id);
}
