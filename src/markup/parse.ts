import type { CalloutKind, ColorKey, DialogLine, El, FrameEl, Link, LinkStyle, CheckItem } from '../types';
import { COLOR_KEYS } from '../types';
import { uid } from '../utils/misc';
import { DEFAULT_W, estimateHeight, layoutColumns, gridFrames, FRAME_PAD, FRAME_TITLE } from '../layout';
import { normTitle } from '../utils/text';

/**
 * SpeakerNotes Markup (SNM) — простой текстовый формат, который понимают нейросети.
 * Полное описание — в prompt.ts (его же копирует кнопка «Промпт для нейросети»).
 */

export interface ParseResult {
  boardName?: string;
  elements: El[];
  links: Link[];
  /** id рамок в порядке появления — нужно для перераскладки после отрисовки */
  frameIds: string[];
  /** группы: рамка + её дети по порядку */
  groups: { frameId: string | null; itemIds: string[] }[];
  warnings: string[];
}

const COLOR_ALIASES: Record<string, ColorKey> = {
  красный: 'red', оранжевый: 'orange', желтый: 'yellow', жёлтый: 'yellow', зеленый: 'green', зелёный: 'green',
  бирюзовый: 'teal', синий: 'blue', голубой: 'blue', фиолетовый: 'purple', розовый: 'pink', серый: 'gray',
};

function toColor(v?: string): ColorKey {
  if (!v) return 'none';
  const s = v.trim().toLowerCase();
  if ((COLOR_KEYS as string[]).includes(s)) return s as ColorKey;
  return COLOR_ALIASES[s] ?? 'none';
}

const CALLOUT_KINDS: Record<string, CalloutKind> = {
  info: 'info', инфо: 'info', note: 'info',
  tip: 'tip', совет: 'tip', hint: 'tip', подсказка: 'tip',
  warn: 'warn', warning: 'warn', важно: 'warn', внимание: 'warn',
  danger: 'danger', error: 'danger', нельзя: 'danger', запрет: 'danger', stop: 'danger',
  success: 'success', ok: 'success', good: 'success', можно: 'success',
};

interface Props { key?: string; color?: ColorKey; fav?: boolean; tags?: string[]; w?: number }

/** Достаёт свойства из хвоста строки: «Текст {key: calm, color: green, fav}» */
function splitProps(line: string): { text: string; props: Props } {
  const m = line.match(/\s*\{\s*((?:key|id|color|цвет|fav|★|w|width|tags)\b[^{}]*)\}\s*$/i);
  if (!m) return { text: line, props: {} };
  const props: Props = {};
  for (const part of m[1].split(',')) {
    const [k, ...rest] = part.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'key' || key === 'id') props.key = val;
    else if (key === 'color' || key === 'цвет') props.color = toColor(val);
    else if (key === 'fav' || key === '★') props.fav = true;
    else if (key === 'w' || key === 'width') props.w = Number(val) || undefined;
    else if (key === 'tags') props.tags = val.split(/[;/]/).map((t) => t.trim()).filter(Boolean);
  }
  return { text: line.slice(0, m.index).trimEnd(), props };
}

/** «Название | color: red | tags: a, b | key: k» */
function splitPipeProps(rest: string): { title: string; props: Props } {
  const parts = rest.split('|');
  const props: Props = {};
  for (const p of parts.slice(1)) {
    const [k, ...r] = p.split(':');
    const key = k.trim().toLowerCase();
    const val = r.join(':').trim();
    if (key === 'color' || key === 'цвет') props.color = toColor(val);
    else if (key === 'tags' || key === 'теги') props.tags = val.split(',').map((t) => t.trim()).filter(Boolean);
    else if (key === 'key' || key === 'id') props.key = val;
    else if (key === 'fav') props.fav = true;
    else if (key === 'w' || key === 'width') props.w = Number(val) || undefined;
  }
  const t = splitProps(parts[0].trim());
  return { title: t.text, props: { ...t.props, ...props } };
}

const ME_RE = /^(я|me|оператор|operator|агент|agent|менеджер|ответ|o|о)\s*[:\-—]\s*/i;
const CLIENT_RE = /^(клиент|client|абонент|customer|к|c|k)\s*[:\-—]\s*/i;

export function parseMarkup(src: string, textScale = 1.15): ParseResult {
  const now = Date.now();
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const groups: { frame: FrameEl | null; items: El[] }[] = [{ frame: null, items: [] }];
  const linkSpecs: { a: string; b: string; label?: string; style: LinkStyle; color: ColorKey }[] = [];
  const warnings: string[] = [];
  let boardName: string | undefined;
  let z = 1;

  const cur = () => groups[groups.length - 1];

  const base = (type: El['type'], props: Props = {}) => ({
    id: uid(),
    type,
    x: 0,
    y: 0,
    w: props.w ?? DEFAULT_W[type],
    z: z++,
    color: props.color ?? 'none',
    tags: props.tags,
    fav: props.fav,
    key: props.key,
    createdAt: now,
    updatedAt: now,
  });

  const push = (el: El) => cur().items.push(el);

  // --- накопители ---
  let para: string[] = [];
  let paraProps: Props = {};
  let paraKind: 'note' | CalloutKind = 'note';
  let paraExplicit = false;

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n').trim();
    if (text) {
      if (paraKind === 'note') push({ ...base('note', paraProps), text } as El);
      else push({ ...base('callout', paraProps), kind: paraKind, text } as El);
    }
    para = [];
    paraProps = {};
    paraKind = 'note';
    paraExplicit = false;
  };

  let block: null | { kind: 'table' | 'dialog' | 'checklist'; lines: string[]; props: Props; title?: string; implicit?: boolean } = null;

  const flushBlock = () => {
    if (!block) return;
    const b = block;
    block = null;
    if (b.kind === 'table') {
      const rows = b.lines
        .filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l))
        .map((l) => {
          let s = l.trim();
          if (s.includes('\t') && !s.includes('|')) return s.split('\t').map((c) => c.trim());
          if (s.startsWith('|')) s = s.slice(1);
          if (s.endsWith('|')) s = s.slice(0, -1);
          return s.split('|').map((c) => c.trim());
        });
      if (!rows.length) return;
      const cols = Math.max(...rows.map((r) => r.length));
      rows.forEach((r) => {
        while (r.length < cols) r.push('');
      });
      const hasSep = b.lines.some((l) => /^\s*\|?\s*:?-{2,}/.test(l));
      const w = b.props.w ?? Math.min(900, Math.max(320, cols * 170));
      push({ ...base('table', b.props), w, rows, header: hasSep || b.lines.length > 1 } as El);
    } else if (b.kind === 'dialog') {
      const dl: DialogLine[] = [];
      for (const raw of b.lines) {
        const l = raw.trim();
        if (!l) continue;
        if (ME_RE.test(l)) dl.push({ who: 'me', text: l.replace(ME_RE, '') });
        else if (CLIENT_RE.test(l)) dl.push({ who: 'client', text: l.replace(CLIENT_RE, '') });
        else if (dl.length) dl[dl.length - 1].text += '\n' + l;
        else dl.push({ who: 'client', text: l });
      }
      if (dl.length) push({ ...base('dialog', b.props), lines: dl } as El);
    } else {
      const items: CheckItem[] = [];
      for (const raw of b.lines) {
        const l = raw.trim();
        if (!l) continue;
        const m = l.match(/^(?:[-*•]\s*)?\[( |x|х|v|✓)?\]\s*(.*)$/i);
        if (m) items.push({ done: !!m[1] && m[1] !== ' ', text: m[2] });
        else items.push({ done: false, text: l.replace(/^[-*•]\s+|^\d+[.)]\s+/, '') });
      }
      if (items.length) push({ ...base('checklist', b.props), title: b.title, items } as El);
    }
  };

  const closeFrame = () => {
    flushPara();
    flushBlock();
    if (cur().frame) groups.push({ frame: null, items: [] });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // ----- внутри блока -----
    if (block) {
      if (/^@end\b/i.test(line) || /^@(конец|end)\s*$/i.test(line)) {
        flushBlock();
        continue;
      }
      if (block.implicit && block.kind === 'table' && !line.startsWith('|')) {
        flushBlock();
        // строку обрабатываем дальше как обычную
      } else if (block.implicit && block.kind === 'dialog' && !(ME_RE.test(line) || CLIENT_RE.test(line))) {
        flushBlock();
      } else if (!block.implicit && /^@(frame|раздел|board|доска|endframe)\b/i.test(line)) {
        flushBlock();
      } else {
        block.lines.push(raw);
        continue;
      }
    }

    if (!line) {
      flushPara();
      continue;
    }
    if (/^(-{3,}|_{3,}|\*{3,}|={3,}|—{2,})$/.test(line)) {
      flushPara();
      continue;
    }

    const dm = line.match(/^@([a-zа-яё]+)\b\s*:?\s*(.*)$/i);
    if (dm) {
      const cmd = dm[1].toLowerCase();
      const rest = dm[2];
      const known = true;
      switch (cmd) {
        case 'board':
        case 'доска':
          boardName = rest.trim();
          continue;
        case 'frame':
        case 'раздел':
        case 'group':
        case 'section': {
          closeFrame();
          const { title, props } = splitPipeProps(rest);
          const f: FrameEl = { ...base('frame', props), type: 'frame', title: title || 'Раздел', h: 400 };
          const g = cur();
          if (g.items.length === 0 && !g.frame) g.frame = f;
          else groups.push({ frame: f, items: [] });
          continue;
        }
        case 'endframe':
        case 'конецраздела':
          closeFrame();
          continue;
        case 'heading':
        case 'h1':
        case 'h2':
        case 'h3':
        case 'заголовок': {
          flushPara();
          const { text, props } = splitProps(rest);
          const level = cmd === 'h1' ? 1 : cmd === 'h3' ? 3 : 2;
          push({ ...base('heading', props), text, level } as El);
          continue;
        }
        case 'note':
        case 'фраза':
        case 'phrase': {
          flushPara();
          const { text, props } = splitProps(rest);
          para = text ? [text] : [];
          paraProps = props;
          paraKind = 'note';
          paraExplicit = true;
          continue;
        }
        case 'callout':
        case 'info':
        case 'tip':
        case 'warn':
        case 'warning':
        case 'danger':
        case 'success':
        case 'важно':
        case 'совет':
        case 'нельзя': {
          flushPara();
          let kind: CalloutKind = CALLOUT_KINDS[cmd] ?? 'info';
          let body = rest;
          if (cmd === 'callout') {
            const km = rest.match(/^([a-zа-яё]+)\s*:\s*(.*)$/i);
            if (km && CALLOUT_KINDS[km[1].toLowerCase()]) {
              kind = CALLOUT_KINDS[km[1].toLowerCase()];
              body = km[2];
            }
          }
          const { text, props } = splitProps(body);
          para = text ? [text] : [];
          paraProps = props;
          paraKind = kind;
          paraExplicit = true;
          continue;
        }
        case 'table':
        case 'таблица': {
          flushPara();
          block = { kind: 'table', lines: [], props: splitProps(rest).props };
          continue;
        }
        case 'dialog':
        case 'диалог':
        case 'script':
        case 'скрипт': {
          flushPara();
          block = { kind: 'dialog', lines: [], props: splitProps(rest).props };
          continue;
        }
        case 'checklist':
        case 'список':
        case 'steps':
        case 'шаги': {
          flushPara();
          const { text, props } = splitProps(rest);
          block = { kind: 'checklist', lines: [], props, title: text || undefined };
          continue;
        }
        case 'image':
        case 'картинка':
        case 'img': {
          flushPara();
          const { text, props } = splitProps(rest);
          push({ ...base('image', props), asset: '', h: 220, caption: text || undefined } as El);
          continue;
        }
        case 'link':
        case 'связь':
        case 'arrow': {
          flushPara();
          const lm = rest.match(/^(.+?)\s*(->|<->|--|=>|→|—)\s*(.+?)(?:\s+"([^"]*)")?\s*(\|.*)?$/);
          if (!lm) {
            warnings.push(`Не понял связь: ${line}`);
            continue;
          }
          let style: LinkStyle = lm[2] === '<->' ? 'both' : lm[2] === '--' || lm[2] === '—' ? 'line' : 'arrow';
          let color: ColorKey = 'none';
          if (lm[5]) {
            for (const p of lm[5].split('|')) {
              const [k, v] = p.split(':').map((s) => s?.trim().toLowerCase());
              if (k === 'style' && v) style = (['arrow', 'line', 'dashed', 'both'].includes(v) ? v : style) as LinkStyle;
              if (k === 'color') color = toColor(v);
            }
          }
          linkSpecs.push({ a: lm[1].replace(/^"|"$/g, ''), b: lm[3].replace(/^"|"$/g, ''), label: lm[4], style, color });
          continue;
        }
        case 'end':
          continue;
        default:
          void known;
        // неизвестная команда — считаем обычным текстом
      }
    }

    // ----- markdown-подобные сокращения -----
    const hm = line.match(/^(#{1,3})\s+(.*)$/);
    if (hm) {
      flushPara();
      const { text, props } = splitProps(hm[2]);
      push({ ...base('heading', props), text, level: hm[1].length as 1 | 2 | 3 } as El);
      continue;
    }
    if (line.startsWith('|')) {
      flushPara();
      block = { kind: 'table', lines: [raw], props: {}, implicit: true };
      continue;
    }
    if (/^!!\s+/.test(line) || /^!\s+/.test(line)) {
      flushPara();
      const { text, props } = splitProps(line.replace(/^!!?\s+/, ''));
      para = [text];
      paraProps = props;
      paraKind = line.startsWith('!!') ? 'danger' : 'warn';
      paraExplicit = true;
      continue;
    }
    const listInPara = paraExplicit && (paraKind === 'note' || /:\s*$/.test(para[para.length - 1] ?? ''));
    if (/^[-•–]\s+/.test(line) && !listInPara) {
      // каждый пункт списка вне @note — отдельная фраза
      flushPara();
      const { text, props } = splitProps(line.replace(/^[-•–]\s+/, ''));
      para = [text];
      paraProps = props;
      continue;
    }
    const { text, props } = splitProps(line);
    const hasProps = Object.keys(props).length > 0;
    if (!para.length) {
      para = [text];
      paraProps = props;
    } else {
      para.push(text);
      if (hasProps) paraProps = { ...paraProps, ...props };
    }
    // {свойства} в конце строки завершают карточку
    if (hasProps) flushPara();
  }
  flushPara();
  flushBlock();

  // ----- раскладка -----
  const sizeOf = (e: El) => ({ w: e.w, h: estimateHeight(e, textScale) });
  const allEls: El[] = [];
  const frameBoxes: { id: string; w: number; h: number }[] = [];
  const looseGroups: { items: El[]; w: number; h: number; id: string }[] = [];
  const outGroups: ParseResult['groups'] = [];

  for (const g of groups) {
    if (!g.frame && !g.items.length) continue;
    if (g.frame) {
      const f = g.frame;
      const { pos, w, h } = layoutColumns(g.items, FRAME_PAD, FRAME_TITLE, sizeOf);
      g.items.forEach((e) => Object.assign(e, pos[e.id]));
      f.w = Math.max(g.items.length ? w + FRAME_PAD * 2 : 400, 360);
      f.h = (g.items.length ? h : 120) + FRAME_TITLE + FRAME_PAD;
      f.z = 0; // рамки — снизу
      frameBoxes.push({ id: f.id, w: f.w, h: f.h });
      allEls.push(f, ...g.items);
      outGroups.push({ frameId: f.id, itemIds: g.items.map((e) => e.id) });
    } else {
      const { pos, w, h } = layoutColumns(g.items, 0, 0, sizeOf);
      g.items.forEach((e) => Object.assign(e, pos[e.id]));
      const id = 'loose-' + uid();
      looseGroups.push({ items: g.items, w, h, id });
      frameBoxes.push({ id, w, h });
      allEls.push(...g.items);
      outGroups.push({ frameId: null, itemIds: g.items.map((e) => e.id) });
    }
  }

  const gpos = gridFrames(frameBoxes, 0, 0);
  for (const g of groups) {
    if (g.frame) {
      const p = gpos[g.frame.id];
      g.frame.x = p.x;
      g.frame.y = p.y;
      g.items.forEach((e) => {
        e.x += p.x;
        e.y += p.y;
      });
    }
  }
  for (const lg of looseGroups) {
    const p = gpos[lg.id];
    lg.items.forEach((e) => {
      e.x += p.x;
      e.y += p.y;
    });
  }

  // ----- связи -----
  const links: Link[] = [];
  const find = (ref: string): El | undefined => {
    const r = ref.trim();
    const byKey = allEls.find((e) => e.key === r);
    if (byKey) return byKey;
    const n = normTitle(r);
    const titleOf = (e: El) => normTitle(e.type === 'frame' ? e.title : 'text' in e ? e.text : '');
    return allEls.find((e) => titleOf(e) === n) ?? allEls.find((e) => n.length >= 4 && titleOf(e).startsWith(n));
  };
  for (const s of linkSpecs) {
    const a = find(s.a);
    const b = find(s.b);
    if (!a || !b) {
      warnings.push(`Связь «${s.a} → ${s.b}»: не нашёл ${!a ? s.a : s.b}`);
      continue;
    }
    links.push({ id: uid(), from: a.id, to: b.id, label: s.label, style: s.style, color: s.color });
  }

  return {
    boardName,
    elements: allEls,
    links,
    frameIds: groups.filter((g) => g.frame).map((g) => g.frame!.id),
    groups: outGroups,
    warnings,
  };
}

/** Похоже ли на разметку SNM (а не на обычный текст)? */
export function looksLikeMarkup(s: string): boolean {
  return /^\s*@(frame|board|note|heading|table|dialog|checklist|callout|link|раздел|доска|фраза)\b/im.test(s);
}

/** Сдвигает результат так, чтобы его левый верхний угол оказался в (x, y) */
export function offsetResult(r: ParseResult, x: number, y: number) {
  for (const e of r.elements) {
    e.x += x;
    e.y += y;
  }
}
