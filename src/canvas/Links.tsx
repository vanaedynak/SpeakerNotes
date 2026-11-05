import { memo } from 'react';
import type { Board, El, Link } from '../types';
import { COLOR_KEYS } from '../types';
import { useApp, useSizes } from '../store';
import { estimateHeight } from '../layout';

type R = { x: number; y: number; w: number; h: number };

function anchors(a: R, b: R) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  // горизонтальный зазор между прямоугольниками
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX > gapY) {
    const s = dx > 0 ? 1 : -1;
    return {
      p1: { x: s > 0 ? a.x + a.w : a.x, y: acy },
      p2: { x: s > 0 ? b.x : b.x + b.w, y: bcy },
      n1: { x: s, y: 0 },
      n2: { x: -s, y: 0 },
    };
  }
  const s = dy > 0 ? 1 : -1;
  return {
    p1: { x: acx, y: s > 0 ? a.y + a.h : a.y },
    p2: { x: bcx, y: s > 0 ? b.y : b.y + b.h },
    n1: { x: 0, y: s },
    n2: { x: 0, y: -s },
  };
}

export function linkGeometry(a: R, b: R) {
  const { p1, p2, n1, n2 } = anchors(a, b);
  const d = Math.max(40, Math.min(220, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4));
  const c1 = { x: p1.x + n1.x * d, y: p1.y + n1.y * d };
  const c2 = { x: p2.x + n2.x * d, y: p2.y + n2.y * d };
  const path = `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  // середина кривой Безье (t=0.5)
  const mid = {
    x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };
  return { path, mid };
}

export const LinksLayer = memo(function LinksLayer({ board, selectedLink }: { board: Board; selectedLink: string | null }) {
  const sizes = useSizes((s) => s.sizes);
  const ts = useApp((s) => s.settings.textScale);
  const rect = (e: El): R => ({ x: e.x, y: e.y, w: e.w, h: e.h ?? sizes[e.id]?.h ?? estimateHeight(e, ts) });
  const items = board.links
    .map((l) => {
      const a = board.elements[l.from];
      const b = board.elements[l.to];
      if (!a || !b) return null;
      return { l, ...linkGeometry(rect(a), rect(b)) };
    })
    .filter(Boolean) as { l: Link; path: string; mid: { x: number; y: number } }[];

  return (
    <>
      <svg className="links" width="1" height="1" style={{ zIndex: 0 }}>
        <defs>
          {COLOR_KEYS.map((c) => (
            <marker key={c} id={'arr-' + c} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: `var(--line-${c})` }} />
            </marker>
          ))}
        </defs>
        {items.map(({ l, path }) => (
          <g key={l.id} className={'link' + (selectedLink === l.id ? ' sel' : '')}>
            <path d={path} className="link-hit" data-link={l.id} />
            <path
              d={path}
              className="link-line"
              style={{ stroke: `var(--line-${l.color})` }}
              strokeDasharray={l.style === 'dashed' ? '10 8' : undefined}
              markerEnd={l.style === 'arrow' || l.style === 'dashed' || l.style === 'both' ? `url(#arr-${l.color})` : undefined}
              markerStart={l.style === 'both' ? `url(#arr-${l.color})` : undefined}
            />
          </g>
        ))}
      </svg>
      {items
        .filter((i) => i.l.label)
        .map(({ l, mid }) => (
          <div
            key={'lbl' + l.id}
            className={'link-label' + (selectedLink === l.id ? ' sel' : '')}
            data-link={l.id}
            style={{ transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`, borderColor: `var(--line-${l.color})` }}
          >
            {l.label}
          </div>
        ))}
    </>
  );
});
