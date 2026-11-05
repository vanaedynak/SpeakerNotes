import type { El, FrameEl } from './types';

export const FRAME_PAD = 24;
export const FRAME_TITLE = 66;
export const GAP = 16;
export const COL_GAP = 28;

export const DEFAULT_W: Record<El['type'], number> = {
  note: 360,
  heading: 360,
  frame: 800,
  table: 520,
  image: 360,
  callout: 360,
  dialog: 400,
  checklist: 360,
};

/** Примерная высота элемента до того, как он отрисован */
export function estimateHeight(el: El, textScale = 1.15): number {
  const lineH = 16 * textScale * 1.45;
  const cpl = Math.max(10, (el.w - 36) / (8.6 * textScale));
  const lines = (t: string) => t.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / cpl)), 0);
  switch (el.type) {
    case 'note':
      return lines(el.text) * lineH + 30;
    case 'callout':
      return lines(el.text) * lineH + 34;
    case 'heading':
      return lines(el.text) * lineH * (el.level === 1 ? 1.9 : el.level === 2 ? 1.5 : 1.2) + 14;
    case 'table':
      return el.rows.length * (lineH + 18) + 6;
    case 'dialog':
      return el.lines.reduce((s, l) => s + Math.max(1, Math.ceil(l.text.length / (cpl * 0.8))) * lineH + 26, 10);
    case 'checklist':
      return (el.title ? lineH * 1.3 + 10 : 0) + el.items.reduce((s, i) => s + Math.max(1, Math.ceil(i.text.length / (cpl - 4))) * lineH + 12, 20);
    case 'image':
    case 'frame':
      return el.h;
  }
}

export type SizeOf = (el: El) => { w: number; h: number };

/**
 * Раскладывает элементы колонками внутри рамки (по порядку).
 * Возвращает новые координаты детей и размер рамки.
 */
export function layoutColumns(
  items: El[],
  originX: number,
  originY: number,
  sizeOf: SizeOf,
  opts: { maxColH?: number; cols?: number } = {},
) {
  const heights = items.map((e) => sizeOf(e).h);
  const total = heights.reduce((s, h) => s + h + GAP, 0);
  const cols = opts.cols ?? Math.max(1, Math.min(4, Math.ceil(total / (opts.maxColH ?? 1150))));
  const target = total / cols;

  // делим по порядку на колонки, предпочитая разрыв перед заголовком
  const columns: El[][] = [[]];
  let acc = 0;
  items.forEach((e, i) => {
    const h = heights[i] + GAP;
    const cur = columns[columns.length - 1];
    const isBreakable = e.type === 'heading';
    const over = acc + h > target * 1.08;
    const nearEnd = acc > target * 0.7 && isBreakable;
    if (cur.length && columns.length < cols && (over || nearEnd)) {
      columns.push([e]);
      acc = h;
    } else {
      cur.push(e);
      acc += h;
    }
  });

  const pos: Record<string, { x: number; y: number }> = {};
  let x = originX;
  let maxH = 0;
  for (const col of columns) {
    const colW = Math.max(...col.map((e) => sizeOf(e).w), 200);
    let y = originY;
    for (const e of col) {
      pos[e.id] = { x, y };
      y += sizeOf(e).h + GAP;
    }
    maxH = Math.max(maxH, y - originY - GAP);
    x += colW + COL_GAP;
  }
  return { pos, w: x - originX - COL_GAP, h: maxH };
}

/** Элементы, лежащие внутри рамки (по центру) */
export function frameChildren(frame: FrameEl, all: El[], sizeOf: SizeOf): El[] {
  return all.filter((e) => {
    if (e.id === frame.id) return false;
    const s = sizeOf(e);
    if (e.type === 'frame') {
      return e.x >= frame.x && e.y >= frame.y && e.x + s.w <= frame.x + frame.w && e.y + s.h <= frame.y + frame.h && e.z > frame.z;
    }
    const cx = e.x + s.w / 2;
    const cy = e.y + Math.min(s.h / 2, 30);
    return cx > frame.x && cx < frame.x + frame.w && cy > frame.y && cy < frame.y + frame.h;
  });
}

/** Порядок детей для «Упорядочить»: по колонкам слева направо, сверху вниз */
export function readingOrder(items: El[]): El[] {
  return [...items].sort((a, b) => {
    if (Math.abs(a.x - b.x) > 60) return a.x - b.x;
    return a.y - b.y;
  });
}

/** Раскладывает рамку целиком; возвращает патчи */
export function tidyFrame(frame: FrameEl, all: El[], sizeOf: SizeOf, cols?: number): Record<string, Partial<El>> {
  const kids = readingOrder(frameChildren(frame, all, sizeOf).filter((e) => e.type !== 'frame'));
  const res: Record<string, Partial<El>> = {};
  if (!kids.length) return res;
  const { pos, w, h } = layoutColumns(kids, frame.x + FRAME_PAD, frame.y + FRAME_TITLE, sizeOf, { cols });
  for (const [id, p] of Object.entries(pos)) res[id] = p;
  res[frame.id] = { w: Math.max(w + FRAME_PAD * 2, 320), h: h + FRAME_TITLE + FRAME_PAD };
  return res;
}

/** Раскладывает несколько рамок сеткой */
export function gridFrames(frames: { id: string; w: number; h: number }[], originX: number, originY: number, maxRowW = 3200) {
  const pos: Record<string, { x: number; y: number }> = {};
  let x = originX;
  let y = originY;
  let rowH = 0;
  for (const f of frames) {
    if (x > originX && x + f.w > originX + maxRowW) {
      x = originX;
      y += rowH + 80;
      rowH = 0;
    }
    pos[f.id] = { x, y };
    x += f.w + 80;
    rowH = Math.max(rowH, f.h);
  }
  return pos;
}
