import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Modal, Seg } from './common';
import { getImage, putImage } from '../db';
import { loadImage, uid } from '../utils/misc';
import type { El, ImageEl } from '../types';

type Shape = 'rect' | 'round' | 'circle' | 'lasso';
type R = { x: number; y: number; w: number; h: number };

export function CropDialog() {
  const id = useApp((s) => s.cropId);
  const el = useApp((s) => (id ? s.board().elements[id] : null)) as ImageEl | null;
  if (!el || el.type !== 'image') return null;
  return <CropInner key={el.id + el.asset} el={el} />;
}

function CropInner({ el }: { el: ImageEl }) {
  const st = useApp.getState();
  const [src, setSrc] = useState<string>();
  const [nat, setNat] = useState({ w: 1, h: 1 });
  const [shape, setShape] = useState<Shape>('rect');
  const [sticker, setSticker] = useState(true);
  const [outline, setOutline] = useState(10);
  const [rect, setRect] = useState<R>({ x: 0, y: 0, w: 0, h: 0 });
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const drag = useRef<null | { mode: 'move' | 'new' | 'nw' | 'ne' | 'sw' | 'se' | 'lasso'; sx: number; sy: number; r0: R }>(null);
  const stage = useRef<HTMLDivElement>(null);

  const maxW = Math.min(window.innerWidth - 80, 920);
  const maxH = Math.max(240, window.innerHeight - 330);
  const k = Math.min(maxW / nat.w, maxH / nat.h, 1.5);
  const dw = nat.w * k;
  const dh = nat.h * k;

  useEffect(() => {
    void getImage(el.asset).then(async (s) => {
      if (!s) return;
      setSrc(s);
      const img = await loadImage(s);
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
    });
  }, [el.asset]);

  useEffect(() => {
    setRect({ x: dw * 0.1, y: dh * 0.1, w: dw * 0.8, h: dh * 0.8 });
  }, [dw, dh]);

  const local = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(dw, e.clientX - r.left)), y: Math.max(0, Math.min(dh, e.clientY - r.top)) };
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    if (shape === 'lasso') {
      drag.current = { mode: 'lasso', sx: p.x, sy: p.y, r0: rect };
      setPath([p]);
      return;
    }
    const hnd = (e.target as HTMLElement).dataset.h as 'nw' | 'ne' | 'sw' | 'se' | undefined;
    const inside = p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h;
    drag.current = { mode: hnd ?? (inside ? 'move' : 'new'), sx: p.x, sy: p.y, r0: { ...rect } };
    if (!hnd && !inside) setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    const r0 = d.r0;
    if (d.mode === 'lasso') {
      setPath((pp) => {
        const last = pp[pp.length - 1];
        return Math.hypot(last.x - p.x, last.y - p.y) > 3 ? [...pp, p] : pp;
      });
      return;
    }
    let r: R;
    if (d.mode === 'move') r = { ...r0, x: Math.max(0, Math.min(dw - r0.w, r0.x + dx)), y: Math.max(0, Math.min(dh - r0.h, r0.y + dy)) };
    else if (d.mode === 'new') r = { x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    else {
      let { x, y, w, h } = r0;
      if (d.mode.includes('w')) {
        x = Math.min(r0.x + r0.w - 20, r0.x + dx);
        w = r0.x + r0.w - x;
      }
      if (d.mode.includes('e')) w = Math.max(20, r0.w + dx);
      if (d.mode.includes('n')) {
        y = Math.min(r0.y + r0.h - 20, r0.y + dy);
        h = r0.y + r0.h - y;
      }
      if (d.mode.includes('s')) h = Math.max(20, r0.h + dy);
      r = { x, y, w: Math.min(w, dw - x), h: Math.min(h, dh - y) };
    }
    if (shape === 'circle') {
      const s = Math.min(r.w, r.h);
      r = { ...r, w: s, h: s };
    }
    setRect(r);
  };
  const up = () => (drag.current = null);

  const apply = async (asNew: boolean) => {
    if (!src) return;
    const img = await loadImage(src);
    const inv = 1 / k;
    let bx: R;
    let clip: (c: CanvasRenderingContext2D, ox: number, oy: number) => void;
    if (shape === 'lasso') {
      if (path.length < 3) {
        st.showToast('Обведите нужную область пальцем');
        return;
      }
      const xs = path.map((p) => p.x * inv);
      const ys = path.map((p) => p.y * inv);
      bx = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      clip = (c, ox, oy) => {
        c.beginPath();
        path.forEach((p, i) => (i ? c.lineTo(p.x * inv - bx.x + ox, p.y * inv - bx.y + oy) : c.moveTo(p.x * inv - bx.x + ox, p.y * inv - bx.y + oy)));
        c.closePath();
      };
    } else {
      bx = { x: rect.x * inv, y: rect.y * inv, w: rect.w * inv, h: rect.h * inv };
      if (bx.w < 4 || bx.h < 4) return;
      clip = (c, ox, oy) => {
        c.beginPath();
        if (shape === 'circle') c.ellipse(ox + bx.w / 2, oy + bx.h / 2, bx.w / 2, bx.h / 2, 0, 0, Math.PI * 2);
        else if (shape === 'round') {
          const r = Math.min(bx.w, bx.h) * 0.08;
          c.roundRect(ox, oy, bx.w, bx.h, r);
        } else c.rect(ox, oy, bx.w, bx.h);
      };
    }
    const scaleOut = Math.max(nat.w, nat.h) / 1600 > 1 ? 1 : 1;
    const o = sticker ? Math.round(outline * Math.max(1, Math.max(bx.w, bx.h) / 600)) : 0;
    const W = Math.round(bx.w + o * 2);
    const H = Math.round(bx.h + o * 2);
    // вырезанная картинка
    const cut = document.createElement('canvas');
    cut.width = W;
    cut.height = H;
    const cc = cut.getContext('2d')!;
    cc.save();
    clip(cc, o, o);
    cc.clip();
    cc.drawImage(img, bx.x - o, bx.y - o, W, H, 0, 0, W, H);
    cc.restore();
    void scaleOut;
    let out = cut;
    if (sticker && o > 0) {
      // белая обводка: «раздуваем» силуэт
      const res = document.createElement('canvas');
      res.width = W;
      res.height = H;
      const rc = res.getContext('2d')!;
      const mask = document.createElement('canvas');
      mask.width = W;
      mask.height = H;
      const mc = mask.getContext('2d')!;
      mc.drawImage(cut, 0, 0);
      mc.globalCompositeOperation = 'source-in';
      mc.fillStyle = '#fff';
      mc.fillRect(0, 0, W, H);
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        rc.drawImage(mask, Math.cos(a) * o * 0.92, Math.sin(a) * o * 0.92);
      }
      rc.drawImage(mask, 0, 0);
      rc.drawImage(cut, 0, 0);
      out = res;
    }
    const dataUrl = out.toDataURL('image/png');
    const asset = uid();
    await putImage(asset, dataUrl);
    const w = Math.min(520, Math.max(160, W > H ? 420 : 300));
    const h = Math.round((w * H) / W);
    if (asNew) {
      const ne = { ...structuredClone(el), id: uid(), asset, w, h, x: el.x + el.w + 40, sticker, z: st.maxZ() + 1, caption: undefined } as El;
      st.addElements([ne]);
    } else st.patchEl(el.id, { asset, w, h, sticker } as Partial<El>);
    st.set({ cropId: null });
    st.showToast(sticker ? '✨ Стикер готов' : 'Готово');
  };

  const close = () => st.set({ cropId: null });
  const ellipse = shape === 'circle';

  return (
    <Modal
      title="✂️ Обрезать / сделать стикер"
      onClose={close}
      wide="full"
      footer={
        <>
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn" onClick={() => void apply(true)}>
            ＋ Новым элементом
          </button>
          <button className="btn primary" onClick={() => void apply(false)}>
            Применить
          </button>
        </>
      }
    >
      <div className="row wrap space">
        <Seg value={shape} onChange={(s) => (setShape(s), setPath([]))} options={[['rect', '▭ Прямоуг.'], ['round', '▢ Скруглённый'], ['circle', '◯ Круг'], ['lasso', '✍️ Обвести']]} />
        <label className="row">
          <input type="checkbox" checked={sticker} onChange={(e) => setSticker(e.target.checked)} /> Стикер (белая обводка)
        </label>
        {sticker && (
          <label className="row">
            Толщина <input type="range" min={3} max={30} value={outline} onChange={(e) => setOutline(+e.target.value)} />
          </label>
        )}
      </div>
      <div className="muted" style={{ margin: '6px 0' }}>
        {shape === 'lasso' ? 'Обведите пальцем или стилусом нужную часть картинки.' : 'Потяните рамку или её углы. Нарисуйте новую рамку, начав за её пределами.'}
      </div>
      <div className="crop-wrap">
        <div ref={stage} className="crop-stage" style={{ width: dw, height: dh }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {src && <img src={src} style={{ width: dw, height: dh }} draggable={false} alt="" />}
          <svg width={dw} height={dh} className="crop-svg">
            <defs>
              <mask id="cropmask">
                <rect width={dw} height={dh} fill="#fff" />
                {shape === 'lasso' ? (
                  path.length > 2 && <polygon points={path.map((p) => `${p.x},${p.y}`).join(' ')} fill="#000" />
                ) : ellipse ? (
                  <ellipse cx={rect.x + rect.w / 2} cy={rect.y + rect.h / 2} rx={rect.w / 2} ry={rect.h / 2} fill="#000" />
                ) : (
                  <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={shape === 'round' ? Math.min(rect.w, rect.h) * 0.08 : 0} fill="#000" />
                )}
              </mask>
            </defs>
            <rect width={dw} height={dh} fill="rgba(0,0,0,0.6)" mask="url(#cropmask)" />
            {shape === 'lasso' ? (
              path.length > 1 && <polyline points={path.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="6 4" />
            ) : (
              <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke="#fff" strokeWidth={2} />
            )}
          </svg>
          {shape !== 'lasso' &&
            (['nw', 'ne', 'sw', 'se'] as const).map((h) => (
              <div
                key={h}
                data-h={h}
                className="crop-h"
                style={{ left: rect.x + (h.includes('e') ? rect.w : 0), top: rect.y + (h.includes('s') ? rect.h : 0) }}
              />
            ))}
        </div>
      </div>
    </Modal>
  );
}
