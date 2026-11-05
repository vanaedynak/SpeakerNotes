import type { El } from '../types';

/** Нормализация для поиска: регистр, ё→е, укр. буквы, лишние символы */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/ї/g, 'і')
    .replace(/ґ/g, 'г')
    .replace(/[*_~=`{}\[\]|#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';

/** «ghbdtn» → «привет» (если набрали не в той раскладке) */
export function switchLayout(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const i = EN.indexOf(ch);
    if (i >= 0) {
      out += RU[i];
      continue;
    }
    const j = RU.indexOf(ch);
    out += j >= 0 ? EN[j] : ch;
  }
  return out;
}

/** Плоский текст элемента — для поиска, копирования и т.п. */
export function elText(el: El): string {
  switch (el.type) {
    case 'note':
    case 'heading':
    case 'callout':
      return el.text;
    case 'frame':
      return el.title;
    case 'table':
      return el.rows.map((r) => r.join(' | ')).join('\n');
    case 'image':
      return el.caption ?? '';
    case 'dialog':
      return el.lines.map((l) => (l.who === 'me' ? 'Я: ' : 'Клиент: ') + l.text).join('\n');
    case 'checklist':
      return [el.title ?? '', ...el.items.map((i) => i.text)].filter(Boolean).join('\n');
  }
}

/** Текст для копирования в буфер: без символов разметки */
export function plainForCopy(el: El): string {
  const t = el.type === 'dialog' ? el.lines.filter((l) => l.who === 'me').map((l) => l.text).join('\n') || elText(el) : elText(el);
  return stripMarkup(t);
}

export function stripMarkup(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/\{(red|orange|yellow|green|teal|blue|purple|pink|gray):\s?(.+?)\}/g, '$2')
    .replace(/\[\[(.+?)\]\]/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

export interface Match {
  score: number;
  ranges: [number, number][];
}

/** Поиск: все слова запроса должны встретиться (как начало слова или подстрока) */
export function matchQuery(text: string, query: string): Match | null {
  const t = norm(text);
  const q = norm(query);
  if (!q) return null;
  const words = q.split(' ').filter(Boolean);
  let score = 0;
  for (const w of words) {
    const idx = t.indexOf(w);
    if (idx < 0) {
      // допускаем одну опечатку для длинных слов: ищем по префиксу без последней буквы
      if (w.length >= 5 && t.includes(w.slice(0, -1))) {
        score += 1;
        continue;
      }
      return null;
    }
    const wordStart = idx === 0 || t[idx - 1] === ' ';
    score += wordStart ? 3 : 1;
    if (idx < 30) score += 1;
  }
  if (t.includes(q)) score += 5;
  return { score, ranges: [] };
}

/** Для сравнения названий: без эмодзи и знаков */
export function normTitle(s: string): string {
  return norm(s).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

/** «📞 Звонки» → { icon: '📞', name: 'Звонки' } */
export function splitIcon(title: string): { icon?: string; name: string } {
  const m = title.trim().match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
  return m && m[2] ? { icon: m[1], name: m[2] } : { name: title.trim() };
}
