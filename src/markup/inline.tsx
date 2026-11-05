import React from 'react';

const RE =
  /(\*\*(.+?)\*\*)|(__(.+?)__)|(~~(.+?)~~)|(==(.+?)==)|(`([^`]+?)`)|(\{(red|orange|yellow|green|teal|blue|purple|pink|gray):\s?(.+?)\})|(\[\[(.+?)\]\])|(\[([^\[\]\n]{1,40})\](?!\())|((?:^|(?<=[\s(«"]))\*(?!\s)(.+?)\*(?![*\w]))|(https?:\/\/[^\s)]+)/g;

export type JumpFn = (title: string) => void;

export function renderInline(text: string, onJump?: JumpFn, key = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  // отдельный экземпляр на каждый вызов: функция рекурсивная, общий lastIndex сломал бы цикл
  const re = new RegExp(RE.source, 'g');
  let m: RegExpExecArray | null;
  const src = text;
  while ((m = re.exec(src))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<b key={k}>{renderInline(m[2], onJump, k)}</b>);
    else if (m[3]) out.push(<u key={k}>{renderInline(m[4], onJump, k)}</u>);
    else if (m[5]) out.push(<s key={k}>{renderInline(m[6], onJump, k)}</s>);
    else if (m[7]) out.push(<mark key={k}>{renderInline(m[8], onJump, k)}</mark>);
    else if (m[9]) out.push(<code key={k}>{m[10]}</code>);
    else if (m[11]) out.push(<span key={k} className={`tc-${m[12]}`}>{renderInline(m[13], onJump, k)}</span>);
    else if (m[14]) {
      const t = m[15];
      out.push(
        <button
          key={k}
          className="jump"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onJump?.(t);
          }}
        >
          ↗ {t}
        </button>,
      );
    } else if (m[16]) out.push(<span key={k} className="ph">{m[17]}</span>);
    else if (m[18]) out.push(<i key={k}>{renderInline(m[19], onJump, k)}</i>);
    else if (m[20]) out.push(<span key={k} className="url">{m[20]}</span>);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

/** Блочный рендер: абзацы, маркированные и нумерованные списки */
export function RichText({ text, onJump }: { text: string; onJump?: JumpFn }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list;
    list = null;
    const items = L.items.map((t, i) => <li key={i}>{renderInline(t, onJump, 'l' + blocks.length + '-' + i)}</li>);
    blocks.push(L.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-•–]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    blocks.push(
      <p key={blocks.length} className={line.trim() ? '' : 'empty'}>
        {line.trim() ? renderInline(line, onJump, 'p' + blocks.length) : ' '}
      </p>,
    );
  }
  flush();
  return <>{blocks}</>;
}
