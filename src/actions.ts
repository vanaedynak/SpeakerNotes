import type { Board, El, ElType, FrameEl } from './types';
import { useApp, useSizes, useView } from './store';
import { uid, clamp, copyText, normalizeImage, saveFile, pickFile, fileToDataURL } from './utils/misc';
import { plainForCopy, normTitle as norm, splitIcon } from './utils/text';
import { DEFAULT_W, estimateHeight, frameMinW, frameChildren, gridFrames, layoutColumns, tidyFrame, FRAME_PAD, FRAME_TITLE } from './layout';
import { parseMarkup, offsetResult, type ParseResult } from './markup/parse';
import { putImage, getImage } from './db';

export const canvasBox = { w: window.innerWidth, h: window.innerHeight, left: 0, top: 0 };

export function sizeOf(e: El) {
  const s = useSizes.getState().sizes[e.id];
  const ts = useApp.getState().settings.textScale;
  return { w: e.w, h: e.h ?? s?.h ?? estimateHeight(e, ts) };
}

export function screenToWorld(sx: number, sy: number) {
  const v = useView.getState();
  return { x: (sx - canvasBox.left - v.x) / v.zoom, y: (sy - canvasBox.top - v.y) / v.zoom };
}

export function viewCenterWorld() {
  const v = useView.getState();
  return { x: (canvasBox.w / 2 - v.x) / v.zoom, y: (canvasBox.h / 2 - v.y) / v.zoom };
}

// ---------------- камера ----------------
/** requestAnimationFrame с запасным таймером (если вкладка «заморожена», rAF может не прийти) */
export function nextFrame(f: (t: number) => void) {
  let done = false;
  const id = requestAnimationFrame((t) => {
    if (done) return;
    done = true;
    f(t);
  });
  setTimeout(() => {
    if (done) return;
    done = true;
    cancelAnimationFrame(id);
    f(performance.now());
  }, 60);
}

let animToken = 0;
export const stopAnim = () => void ++animToken;
export function animateView(to: { x: number; y: number; zoom: number }, ms = 380) {
  const token = ++animToken;
  const from = { ...useView.getState() };
  if (useApp.getState().settings.reduceMotion) ms = 0;
  if (ms <= 0) {
    useView.getState().setView(to);
    return;
  }
  const t0 = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  // зум в логарифмическом пространстве — выглядит естественнее
  const lz0 = Math.log(from.zoom);
  const lz1 = Math.log(to.zoom);
  const step = (now: number) => {
    if (token !== animToken) return;
    const t = clamp((now - t0) / ms, 0, 1);
    const k = ease(t);
    const zoom = Math.exp(lz0 + (lz1 - lz0) * k);
    // интерполируем мировую точку в центре экрана, чтобы не «болтало»
    const c0x = (canvasBox.w / 2 - from.x) / from.zoom;
    const c0y = (canvasBox.h / 2 - from.y) / from.zoom;
    const c1x = (canvasBox.w / 2 - to.x) / to.zoom;
    const c1y = (canvasBox.h / 2 - to.y) / to.zoom;
    const cx = c0x + (c1x - c0x) * k;
    const cy = c0y + (c1y - c0y) * k;
    useView.getState().setView({ zoom, x: canvasBox.w / 2 - cx * zoom, y: canvasBox.h / 2 - cy * zoom });
    if (t < 1) nextFrame(step);
  };
  nextFrame(step);
}

export function flyToRect(r: { x: number; y: number; w: number; h: number }, opts: { maxZoom?: number; minZoom?: number; pad?: number } = {}) {
  const pad = opts.pad ?? 60;
  const zx = (canvasBox.w - pad * 2) / Math.max(r.w, 1);
  const zy = (canvasBox.h - pad * 2) / Math.max(r.h, 1);
  const zoom = clamp(Math.min(zx, zy), opts.minZoom ?? 0.08, opts.maxZoom ?? 1.2);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  animateView({ zoom, x: canvasBox.w / 2 - cx * zoom, y: canvasBox.h / 2 - cy * zoom });
}

export function flyToElement(id: string, select = true) {
  const b = useApp.getState().board();
  const el = b.elements[id];
  if (!el) return;
  const s = sizeOf(el);
  if (el.type === 'frame') flyToRect({ x: el.x, y: el.y, w: s.w, h: s.h }, { maxZoom: 1.1 });
  else {
    // показываем элемент крупно, но с контекстом
    flyToRect({ x: el.x - 40, y: el.y - 40, w: s.w + 80, h: s.h + 80 }, { maxZoom: 1.4, minZoom: 0.6, pad: 120 });
  }
  if (select) {
    useApp.setState({ selection: [id], flashId: id });
    setTimeout(() => useApp.setState({ flashId: null }), 1600);
  }
}

export function fitAll() {
  const els = Object.values(useApp.getState().board().elements);
  if (!els.length) {
    animateView({ x: canvasBox.w / 2, y: canvasBox.h / 2, zoom: 1 });
    return;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    const s = sizeOf(e);
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + s.w);
    y1 = Math.max(y1, e.y + s.h);
  }
  flyToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { maxZoom: 1 });
}

export function zoomBy(k: number) {
  const v = useView.getState();
  const zoom = clamp(v.zoom * k, 0.05, 4);
  const cx = canvasBox.w / 2;
  const cy = canvasBox.h / 2;
  animateView({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom }, 200);
}

/** Переход по ссылке [[Название]]: ищем рамку/заголовок/ключ по всем доскам */
export function jumpToTitle(title: string) {
  const st = useApp.getState();
  const n = norm(title);
  const score = (e: El) => {
    const t = norm(e.type === 'frame' ? e.title : 'text' in e ? e.text : '');
    if (e.key && norm(e.key) === n) return 5;
    if (t === n) return e.type === 'frame' ? 4 : e.type === 'heading' ? 3 : 2;
    if (n.length >= 3 && t.startsWith(n)) return 1;
    return 0;
  };
  let best: { b: Board; e: El; s: number } | null = null;
  const boards = [st.board(), ...st.boards.filter((b) => b.id !== st.currentBoardId)];
  for (const b of boards) {
    for (const e of Object.values(b.elements)) {
      const s = score(e);
      if (s && (!best || s > best.s)) best = { b, e, s };
    }
  }
  if (!best) {
    st.showToast(`Не нашёл «${title}»`);
    return;
  }
  if (best.b.id !== st.currentBoardId) st.switchBoard(best.b.id);
  const target = best.e;
  setTimeout(() => flyToElement(target.id), 30);
}

// ---------------- создание ----------------
export function makeElement(type: ElType, x: number, y: number): El {
  const now = Date.now();
  const base = { id: uid(), x, y, w: DEFAULT_W[type], z: useApp.getState().maxZ() + 1, color: 'none' as const, createdAt: now, updatedAt: now };
  switch (type) {
    case 'note':
      return { ...base, type, text: '' };
    case 'heading':
      return { ...base, type, text: '', level: 2 };
    case 'frame':
      return { ...base, type, title: 'Новый раздел', w: 800, h: 520, z: minZ() - 1, color: 'blue' };
    case 'table':
      return { ...base, type, rows: [['Колонка 1', 'Колонка 2', 'Колонка 3'], ['', '', ''], ['', '', '']], header: true };
    case 'image':
      return { ...base, type, asset: '', h: 220 };
    case 'callout':
      return { ...base, type, kind: 'warn', text: '' };
    case 'dialog':
      return { ...base, type, lines: [{ who: 'client', text: '' }, { who: 'me', text: '' }] };
    case 'checklist':
      return { ...base, type, title: 'Список', items: [{ text: '', done: false }] };
  }
}

function minZ() {
  let m = 0;
  for (const e of Object.values(useApp.getState().board().elements)) m = Math.min(m, e.z);
  return m;
}

export function addElementAtCenter(type: ElType) {
  const c = viewCenterWorld();
  const el = makeElement(type, Math.round(c.x - DEFAULT_W[type] / 2), Math.round(c.y - 40));
  const st = useApp.getState();
  if (st.settings.snap) {
    el.x = Math.round(el.x / 16) * 16;
    el.y = Math.round(el.y / 16) * 16;
  }
  st.addElements([el]);
  if (type === 'table' || type === 'dialog' || type === 'checklist') st.set({ modalEditId: el.id });
  else if (type === 'image') void pickImageFor(el.id);
  else st.set({ editingId: el.id });
}

export async function pickImageFor(id: string) {
  const f = await pickFile('image/*');
  if (!f) return;
  const raw = await fileToDataURL(f);
  await setImage(id, raw);
}

export async function setImage(id: string, dataUrl: string, openCrop = false) {
  const n = await normalizeImage(dataUrl);
  const asset = uid();
  await putImage(asset, n.src);
  const st = useApp.getState();
  const el = st.board().elements[id];
  if (!el || el.type !== 'image') return;
  const w = Math.min(Math.max(el.w, 200), 520);
  st.patchEl(id, { asset, w, h: Math.round((w * n.h) / n.w) } as Partial<El>);
  if (openCrop) st.set({ cropId: id });
}

export async function addImageFromDataUrl(dataUrl: string, at?: { x: number; y: number }) {
  const n = await normalizeImage(dataUrl);
  const asset = uid();
  await putImage(asset, n.src);
  const c = at ?? viewCenterWorld();
  const w = Math.min(n.w, 480);
  const h = Math.round((w * n.h) / n.w);
  const el = { ...makeElement('image', Math.round(c.x - w / 2), Math.round(c.y - h / 2)), asset, w, h } as El;
  useApp.getState().addElements([el]);
  return el.id;
}

// ---------------- копирование ----------------
export async function copyElement(el: El) {
  const st = useApp.getState();
  const text = plainForCopy(el);
  if (!text.trim()) return;
  const ok = await copyText(text);
  st.showToast(ok ? '✓ Скопировано' : 'Не удалось скопировать');
  if (ok) st.pushRecent(st.currentBoardId, el.id);
}

export function duplicateSelection() {
  const st = useApp.getState();
  const b = st.board();
  const ids = st.selection;
  if (!ids.length) return;
  const map: Record<string, string> = {};
  let z = st.maxZ();
  const clones: El[] = ids
    .map((id) => b.elements[id])
    .filter(Boolean)
    .map((e) => {
      const id = uid();
      map[e.id] = id;
      return { ...structuredClone(e), id, x: e.x + 30, y: e.y + 30, z: ++z, key: undefined };
    });
  const links = b.links.filter((l) => map[l.from] && map[l.to]).map((l) => ({ ...l, id: uid(), from: map[l.from], to: map[l.to] }));
  st.addElements(clones, links);
}

// ---------------- рамки ----------------
export function tidy(frameId: string, cols?: number) {
  const st = useApp.getState();
  const b = st.board();
  const f = b.elements[frameId];
  if (!f || f.type !== 'frame') return;
  st.patchMany(tidyFrame(f as FrameEl, Object.values(b.elements), sizeOf, cols));
}

/** Обернуть выделенные элементы в новую рамку */
export function wrapInFrame() {
  const st = useApp.getState();
  const b = st.board();
  const els = st.selection.map((id) => b.elements[id]).filter(Boolean);
  if (!els.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    const s = sizeOf(e);
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + s.w);
    y1 = Math.max(y1, e.y + s.h);
  }
  const f = makeElement('frame', x0 - FRAME_PAD, y0 - FRAME_TITLE) as FrameEl;
  f.w = x1 - x0 + FRAME_PAD * 2;
  f.h = y1 - y0 + FRAME_TITLE + FRAME_PAD;
  f.z = Math.min(...els.map((e) => e.z)) - 1;
  st.addElements([f]);
  st.set({ selection: [f.id], editingId: f.id });
}

// ---------------- импорт разметки ----------------
export interface ImportOpts {
  /** 'here' — на текущую доску в центр экрана, 'new' — новая доска */
  target: 'here' | 'new';
}

export function importMarkup(text: string, opts: ImportOpts): ParseResult {
  const st = useApp.getState();
  const r = parseMarkup(text, st.settings.textScale);
  if (!r.elements.length) return r;
  if (opts.target === 'new') {
    const { icon, name } = splitIcon(r.boardName || 'Импорт ' + new Date().toLocaleDateString('ru'));
    st.addBoard(name, icon);
  }
  const b = useApp.getState().board();
  // ставим правее существующего содержимого (или в центр пустой доски)
  let ox = 0, oy = 0;
  const existing = Object.values(b.elements);
  if (existing.length) {
    const c = viewCenterWorld();
    let x1 = -Infinity, y0 = Infinity;
    for (const e of existing) {
      x1 = Math.max(x1, e.x + sizeOf(e).w);
      y0 = Math.min(y0, e.y);
    }
    ox = Math.round(x1 + 160);
    oy = Math.round(y0);
    void c;
  }
  // разные z, чтобы новые были сверху (рамки — снизу всех)
  const z0 = useApp.getState().maxZ();
  const zmin = minZ();
  for (const e of r.elements) e.z = e.type === 'frame' ? zmin - 1 - r.frameIds.indexOf(e.id) : z0 + e.z;
  offsetResult(r, ox, oy);
  useApp.getState().addElements(r.elements, r.links, false);
  scheduleRelayout(r.groups, ox, oy, true);
  return r;
}

/** После того как элементы отрисованы и измерены — раскладываем точно */
export function scheduleRelayout(groups: ParseResult['groups'], ox: number, oy: number, fly: boolean | 'first') {
  const run = () => {
    relayoutGroups(groups, ox, oy);
    if (fly === 'first' && groups[0]?.frameId) {
      flyToElement(groups[0].frameId, false);
    } else if (fly) {
      const b = useApp.getState().board();
      const ids = groups.flatMap((g) => (g.frameId ? [g.frameId, ...g.itemIds] : g.itemIds));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids) {
        const e = b.elements[id];
        if (!e) continue;
        const s = sizeOf(e);
        x0 = Math.min(x0, e.x);
        y0 = Math.min(y0, e.y);
        x1 = Math.max(x1, e.x + s.w);
        y1 = Math.max(y1, e.y + s.h);
      }
      if (isFinite(x0)) flyToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { maxZoom: 1 });
    }
  };
  // ждём шрифты и два кадра: React отрисует, ResizeObserver сообщит размеры
  const go = () => setTimeout(() => nextFrame(() => nextFrame(run)), 30);
  if (document.fonts?.ready) void document.fonts.ready.then(go);
  else go();
}

export function relayoutGroups(groups: ParseResult['groups'], ox: number, oy: number) {
  const st = useApp.getState();
  const b = st.board();
  const patches: Record<string, Partial<El>> = {};
  const boxes: { id: string; w: number; h: number }[] = [];
  const rel: Record<string, { items: Record<string, { x: number; y: number }> }> = {};
  groups.forEach((g, gi) => {
    const items = g.itemIds.map((id) => b.elements[id]).filter(Boolean);
    const gid = g.frameId ?? 'g' + gi;
    if (g.frameId) {
      const f = b.elements[g.frameId];
      if (!f) return;
      const { pos, w, h } = layoutColumns(items, FRAME_PAD, FRAME_TITLE, sizeOf);
      rel[gid] = { items: pos };
      const fw = Math.max(items.length ? w + FRAME_PAD * 2 : 400, 360, frameMinW((f as FrameEl).title, st.settings.textScale));
      const fh = (items.length ? h : 120) + FRAME_TITLE + FRAME_PAD;
      patches[g.frameId] = { w: fw, h: fh };
      boxes.push({ id: gid, w: fw, h: fh });
    } else {
      const { pos, w, h } = layoutColumns(items, 0, 0, sizeOf);
      rel[gid] = { items: pos };
      boxes.push({ id: gid, w, h });
    }
  });
  const gp = gridFrames(boxes, ox, oy);
  groups.forEach((g, gi) => {
    const gid = g.frameId ?? 'g' + gi;
    const p = gp[gid];
    if (!p) return;
    if (g.frameId) patches[g.frameId] = { ...patches[g.frameId], x: p.x, y: p.y };
    for (const [id, q] of Object.entries(rel[gid].items)) patches[id] = { x: p.x + q.x, y: p.y + q.y };
  });
  st.patchMany(patches, false);
}

// ---------------- простой текст → фразы ----------------
export function plainTextToMarkup(text: string): string {
  // таб-разделённые строки — таблица, пустые строки и линии — разделители карточек
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines
    .map((l) => {
      if (l.includes('\t') && l.split('\t').filter((c) => c.trim()).length > 1) return '| ' + l.split('\t').join(' | ') + ' |';
      return l;
    })
    .join('\n');
}

// ---------------- резервная копия ----------------
export async function exportBackup() {
  const st = useApp.getState();
  const assets = new Set<string>();
  for (const b of st.boards) for (const e of Object.values(b.elements)) if (e.type === 'image' && e.asset) assets.add(e.asset);
  const images: Record<string, string> = {};
  for (const a of assets) {
    const v = await getImage(a);
    if (v) images[a] = v;
  }
  const data = { app: 'SpeakerNotes', version: 1, exportedAt: new Date().toISOString(), boards: st.boards, settings: st.settings, images };
  const d = new Date();
  const name = `SpeakerNotes-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  await saveFile(name, JSON.stringify(data));
}

export async function importBackup(json: string, mode: 'replace' | 'merge') {
  const data = JSON.parse(json);
  if (data.app !== 'SpeakerNotes' || !Array.isArray(data.boards)) throw new Error('Это не файл SpeakerNotes');
  for (const [k, v] of Object.entries(data.images ?? {})) await putImage(k, v as string);
  const st = useApp.getState();
  if (mode === 'replace') st.replaceAll(data.boards);
  else {
    const ids = new Set(st.boards.map((b) => b.id));
    const add = (data.boards as Board[]).map((b) => (ids.has(b.id) ? { ...b, id: uid(), name: b.name + ' (копия)' } : b));
    useApp.setState({ boards: [...st.boards, ...add] });
  }
}

export function boardBounds(els: El[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    const s = sizeOf(e);
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + s.w);
    y1 = Math.max(y1, e.y + s.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export { frameChildren };
