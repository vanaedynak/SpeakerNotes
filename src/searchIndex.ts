import type { Board, El, FrameEl } from './types';
import { sizeOf } from './actions';
import { elText, matchQuery, switchLayout } from './utils/text';
import { readingOrder } from './layout';

export interface Entry {
  board: Board;
  el: El;
  frame: FrameEl | null;
  text: string;
}

/** Самая маленькая рамка, внутри которой лежит элемент */
export function containerFrame(board: Board, el: El): FrameEl | null {
  if (el.type === 'frame') return null;
  const s = sizeOf(el);
  const cx = el.x + s.w / 2;
  const cy = el.y + Math.min(s.h / 2, 30);
  let best: FrameEl | null = null;
  for (const f of Object.values(board.elements)) {
    if (f.type !== 'frame') continue;
    if (cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h) {
      if (!best || f.w * f.h < best.w * best.h) best = f;
    }
  }
  return best;
}

export function buildIndex(boards: Board[]): Entry[] {
  const out: Entry[] = [];
  for (const b of boards) {
    for (const el of Object.values(b.elements)) {
      const text = elText(el);
      if (!text.trim() && el.type !== 'image') continue;
      out.push({ board: b, el, frame: containerFrame(b, el), text });
    }
  }
  return out;
}

export interface Hit extends Entry {
  score: number;
  viaLayout: boolean;
}

export function search(index: Entry[], q: string, currentBoardId: string, limit = 60): Hit[] {
  const query = q.trim();
  if (!query) return [];
  const alt = switchLayout(query);
  const hits: Hit[] = [];
  for (const e of index) {
    const hay = e.text + ' ' + (e.frame?.title ?? '') + ' ' + (e.el.tags ?? []).join(' ') + ' ' + (e.frame?.tags ?? []).join(' ');
    let m = matchQuery(hay, query);
    let via = false;
    if (!m) {
      m = matchQuery(hay, alt);
      via = !!m;
    }
    if (!m) continue;
    let score = m.score;
    // совпадение в самом тексте важнее, чем в названии раздела
    if (matchQuery(e.text, via ? alt : query)) score += 4;
    if (e.el.type === 'frame') score += 3;
    if (e.el.type === 'heading') score += 2;
    if (e.el.fav) score += 2;
    if (e.board.id === currentBoardId) score += 1;
    hits.push({ ...e, score, viaLayout: via });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Темы (рамки) доски и их содержимое по порядку чтения */
export function topicsOf(board: Board) {
  const els = Object.values(board.elements);
  const frames = els.filter((e) => e.type === 'frame') as FrameEl[];
  frames.sort((a, b) => (Math.abs(a.y - b.y) > 200 ? a.y - b.y : a.x - b.x));
  const byFrame = new Map<string, El[]>();
  const loose: El[] = [];
  for (const e of els) {
    if (e.type === 'frame') continue;
    const f = containerFrame(board, e);
    if (f) {
      if (!byFrame.has(f.id)) byFrame.set(f.id, []);
      byFrame.get(f.id)!.push(e);
    } else loose.push(e);
  }
  return {
    topics: frames.map((f) => ({ frame: f, items: readingOrder(byFrame.get(f.id) ?? []) })),
    loose: readingOrder(loose),
  };
}
