import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp, useView } from '../store';
import type { El, FrameEl, Viewport } from '../types';
import { ElementView } from './elements';
import { LinksLayer } from './Links';
import { canvasBox, stopAnim, flyToElement, copyElement, frameChildren, makeElement, pickImageFor, sizeOf } from '../actions';
import { clamp, copyText } from '../utils/misc';
import { stripMarkup } from '../utils/text';

type Mode = 'none' | 'pan-or-tap' | 'pan' | 'press-el' | 'tap-el' | 'drag' | 'resize' | 'box' | 'pinch';

interface G {
  pointers: Map<number, { x: number; y: number }>;
  mode: Mode;
  sx: number;
  sy: number;
  sv: Viewport;
  targetId: string | null;
  downTarget: HTMLElement | null;
  dragIds: string[];
  startPos: Record<string, { x: number; y: number }>;
  pinch: { dist: number; mx: number; my: number; sv: Viewport } | null;
  resize: { id: string; w: number; h: number; aspect: number; type: El['type'] } | null;
  lastTap: { id: string | null; t: number; x: number; y: number };
  shift: boolean;
  flyId: string | null;
}

export function startEdit(id: string) {
  const st = useApp.getState();
  const el = st.board().elements[id];
  if (!el) return;
  if (el.type === 'table' || el.type === 'dialog' || el.type === 'checklist') st.set({ modalEditId: id, selection: [id] });
  else if (el.type === 'image') {
    if (!el.asset) void pickImageFor(id);
    else st.set({ cropId: id });
  } else st.set({ editingId: id, selection: [id] });
}

export function Canvas() {
  const board = useApp((s) => s.board());
  const selection = useApp((s) => s.selection);
  const editingId = useApp((s) => s.editingId);
  const flashId = useApp((s) => s.flashId);
  const linkFrom = useApp((s) => s.linkFrom);
  const readMode = useApp((s) => s.readMode);
  const tool = useApp((s) => s.tool);
  const selectedLink = useApp((s) => s.selectedLink);
  const boxRect = useApp((s) => s.boxRect);
  const showGrid = useApp((s) => s.settings.showGrid);

  const cont = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const g = useRef<G>({
    pointers: new Map(),
    mode: 'none',
    sx: 0,
    sy: 0,
    sv: { x: 0, y: 0, zoom: 1 },
    targetId: null,
    downTarget: null,
    dragIds: [],
    startPos: {},
    pinch: null,
    resize: null,
    lastTap: { id: null, t: 0, x: 0, y: 0 },
    shift: false,
    flyId: null,
  });

  const sorted = useMemo(() => Object.values(board.elements).sort((a, b) => a.z - b.z), [board.elements]);
  const selSet = useMemo(() => new Set(selection), [selection]);

  // ---------- применяем камеру напрямую к DOM (без перерисовки React) ----------
  useLayoutEffect(() => {
    const apply = (v: Viewport) => {
      const w = world.current;
      const c = cont.current;
      if (!w || !c) return;
      w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
      w.style.setProperty('--inv', String(1 / v.zoom));
      const step = 32 * v.zoom;
      const big = step < 12 ? step * 4 : step;
      c.style.backgroundSize = `${big}px ${big}px`;
      c.style.backgroundPosition = `${v.x}px ${v.y}px`;
      c.classList.toggle('zoomed-out', v.zoom < 0.3);
      c.classList.toggle('zoomed-far', v.zoom < 0.2);
    };
    apply(useView.getState());
    return useView.subscribe(apply);
  }, []);

  // ---------- размер области ----------
  useLayoutEffect(() => {
    const c = cont.current!;
    const upd = () => {
      const r = c.getBoundingClientRect();
      canvasBox.w = r.width;
      canvasBox.h = r.height;
      canvasBox.left = r.left;
      canvasBox.top = r.top;
    };
    upd();
    const r = new ResizeObserver(upd);
    r.observe(c);
    window.addEventListener('resize', upd);
    return () => {
      r.disconnect();
      window.removeEventListener('resize', upd);
    };
  }, []);

  // ---------- колесо / тачпад ----------
  useEffect(() => {
    const c = cont.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea, .modal, .no-wheel')) return;
      e.preventDefault();
      stopAnim();
      const v = useView.getState();
      const k = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * k * 0.0075), 0.05, 4);
        const px = e.clientX - canvasBox.left;
        const py = e.clientY - canvasBox.top;
        v.setView({ zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        v.setView({ zoom: v.zoom, x: v.x - dx * k, y: v.y - dy * k });
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    // Safari: не даём странице масштабироваться жестом
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('gesturechange', prevent);
    return () => {
      c.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('gesturechange', prevent);
    };
  }, []);

  // ---------- указатели ----------
  const toWorld = (sx: number, sy: number) => {
    const v = useView.getState();
    return { x: (sx - canvasBox.left - v.x) / v.zoom, y: (sy - canvasBox.top - v.y) / v.zoom };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, button, [data-nodrag], .el.editing .inline-edit')) return;
    if (e.button === 2) return;
    const s = g.current;
    const st = useApp.getState();
    stopAnim();
    cont.current!.setPointerCapture(e.pointerId);
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.shift = e.shiftKey;

    if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      s.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, sv: { ...useView.getState() } };
      s.mode = 'pinch';
      st.set({ boxRect: null });
      return;
    }
    if (s.pointers.size > 2) return;

    s.sx = e.clientX;
    s.sy = e.clientY;
    s.sv = { ...useView.getState() };
    s.downTarget = t;
    s.targetId = null;

    const fly = t.closest('[data-fly]') as HTMLElement | null;
    s.flyId = fly ? fly.dataset.fly! : null;
    if (fly) {
      s.mode = 'pan-or-tap';
      return;
    }

    const linkNode = t.closest('[data-link]') as HTMLElement | null;
    if (linkNode && !st.readMode) {
      st.set({ selectedLink: linkNode.dataset.link!, selection: [], editingId: null });
      s.mode = 'none';
      return;
    }

    const handle = t.closest('[data-handle]');
    let elNode = t.closest('[data-el]') as HTMLElement | null;
    // раздел берётся только за заголовок (или за уголок), пустое место внутри — это доска
    if (elNode?.classList.contains('el-frame') && !handle && !t.closest('[data-frame-title]')) elNode = null;
    if (handle && elNode && !st.readMode) {
      const id = elNode.dataset.el!;
      const el = st.board().elements[id];
      const sz = sizeOf(el);
      st.snapshot();
      s.resize = { id, w: el.w, h: sz.h, aspect: sz.h / el.w, type: el.type };
      s.mode = 'resize';
      return;
    }
    if (elNode) {
      const id = elNode.dataset.el!;
      if (st.editingId === id && st.board().elements[id]?.type !== 'frame') return;
      s.targetId = id;
      s.mode = st.readMode || st.tool === 'hand' ? 'tap-el' : 'press-el';
      return;
    }
    if (!st.readMode && (st.tool === 'box' || (e.shiftKey && e.pointerType === 'mouse'))) {
      s.mode = 'box';
      const p = toWorld(e.clientX, e.clientY);
      st.set({ boxRect: { x: p.x, y: p.y, w: 0, h: 0 } });
      return;
    }
    s.mode = 'pan-or-tap';
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = useApp.getState();
    const view = useView.getState();
    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;
    const moved = Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 8 : 4);

    switch (s.mode) {
      case 'pinch': {
        if (s.pointers.size < 2 || !s.pinch) return;
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const p = s.pinch;
        const zoom = clamp(p.sv.zoom * (dist / p.dist), 0.05, 4);
        const wx = (p.mx - canvasBox.left - p.sv.x) / p.sv.zoom;
        const wy = (p.my - canvasBox.top - p.sv.y) / p.sv.zoom;
        view.setView({ zoom, x: mx - canvasBox.left - wx * zoom, y: my - canvasBox.top - wy * zoom });
        return;
      }
      case 'pan-or-tap':
      case 'tap-el':
        if (moved) {
          s.mode = 'pan';
          s.sx = e.clientX;
          s.sy = e.clientY;
          s.sv = { ...view };
        }
        return;
      case 'pan':
        view.setView({ zoom: view.zoom, x: s.sv.x + dx, y: s.sv.y + dy });
        return;
      case 'press-el': {
        if (!moved || !s.targetId) return;
        const b = st.board();
        let ids = st.selection.includes(s.targetId) ? st.selection : [s.targetId];
        if (!st.selection.includes(s.targetId)) st.set({ selection: ids, selectedLink: null });
        // рамка тянет за собой содержимое
        const all = Object.values(b.elements);
        const set = new Set(ids);
        for (const id of ids) {
          const el = b.elements[id];
          if (el?.type === 'frame') for (const c of frameChildren(el as FrameEl, all, sizeOf)) set.add(c.id);
        }
        // вложенные рамки тоже тянут своё содержимое
        for (const id of [...set]) {
          const el = b.elements[id];
          if (el?.type === 'frame' && !ids.includes(id)) for (const c of frameChildren(el as FrameEl, all, sizeOf)) set.add(c.id);
        }
        ids = [...set];
        s.dragIds = ids;
        s.startPos = {};
        for (const id of ids) {
          const el = b.elements[id];
          if (el) s.startPos[id] = { x: el.x, y: el.y };
        }
        st.snapshot();
        if (st.editingId) st.set({ editingId: null });
        s.mode = 'drag';
        // fallthrough к перетаскиванию
      }
      // eslint-disable-next-line no-fallthrough
      case 'drag': {
        let ddx = dx / view.zoom;
        let ddy = dy / view.zoom;
        if (st.settings.snap && s.targetId && s.startPos[s.targetId]) {
          const p0 = s.startPos[s.targetId];
          ddx = Math.round((p0.x + ddx) / 16) * 16 - p0.x;
          ddy = Math.round((p0.y + ddy) / 16) * 16 - p0.y;
        }
        const patches: Record<string, Partial<El>> = {};
        for (const id of s.dragIds) {
          const p0 = s.startPos[id];
          if (p0) patches[id] = { x: Math.round(p0.x + ddx), y: Math.round(p0.y + ddy) };
        }
        st.patchMany(patches, false);
        return;
      }
      case 'resize': {
        const r = s.resize!;
        let w = Math.max(r.type === 'image' ? 60 : 140, r.w + dx / view.zoom);
        if (st.settings.snap) w = Math.round(w / 16) * 16;
        const patch: Partial<El> = { w: Math.round(w) };
        if (r.type === 'image') patch.h = Math.round(w * r.aspect);
        if (r.type === 'frame') patch.h = Math.round(Math.max(140, r.h + dy / view.zoom));
        st.patchEl(r.id, patch, false);
        return;
      }
      case 'box': {
        const p0 = toWorld(s.sx, s.sy);
        const p1 = toWorld(e.clientX, e.clientY);
        st.set({ boxRect: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) } });
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.delete(e.pointerId);
    const st = useApp.getState();

    if (s.mode === 'pinch') {
      if (s.pointers.size === 1) {
        const [p] = [...s.pointers.values()];
        s.mode = 'pan';
        s.sx = p.x;
        s.sy = p.y;
        s.sv = { ...useView.getState() };
      } else if (s.pointers.size === 0) s.mode = 'none';
      return;
    }
    if (s.pointers.size > 0) return;

    const now = performance.now();
    const isDouble = (id: string | null) =>
      s.lastTap.id === id && now - s.lastTap.t < 380 && Math.hypot(e.clientX - s.lastTap.x, e.clientY - s.lastTap.y) < 30;

    switch (s.mode) {
      case 'tap-el': {
        const id = s.targetId!;
        const el = st.board().elements[id];
        if (!el) break;
        if (st.tool === 'hand' && !st.readMode) {
          st.set({ selection: [id] });
          break;
        }
        // режим чтения: тап копирует
        const td = s.downTarget?.closest('td');
        const bubble = s.downTarget?.closest('.bubble');
        if (td && td.textContent?.trim()) {
          const txt = stripMarkup(td.textContent.trim());
          void copyText(txt).then(() => st.showToast('✓ Скопировано: ' + txt.slice(0, 40)));
        } else if (bubble) {
          const txt = (bubble.querySelector('.rich') as HTMLElement)?.innerText ?? '';
          void copyText(txt).then(() => st.showToast('✓ Скопировано'));
        } else if (el.type === 'image' || el.type === 'frame') {
          // ничего
        } else if (st.settings.tapAction === 'open') {
          st.set({ readerId: id });
        } else void copyElement(el);
        st.set({ flashId: id });
        setTimeout(() => useApp.getState().flashId === id && useApp.setState({ flashId: null }), 500);
        break;
      }
      case 'press-el': {
        const id = s.targetId!;
        if (st.linkFrom) {
          st.addLink(st.linkFrom, id);
          st.set({ linkFrom: null, selection: [id] });
          st.showToast('Связь создана');
          break;
        }
        if (isDouble(id)) {
          startEdit(id);
          s.lastTap = { id: null, t: 0, x: 0, y: 0 };
          return;
        }
        if (s.shift || e.metaKey || e.ctrlKey) {
          const sel = st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id];
          st.set({ selection: sel, selectedLink: null });
        } else st.set({ selection: [id], selectedLink: null, editingId: st.editingId === id ? id : null });
        s.lastTap = { id, t: now, x: e.clientX, y: e.clientY };
        break;
      }
      case 'pan-or-tap': {
        if (s.flyId) {
          flyToElement(s.flyId, false);
          break;
        }
        if (st.linkFrom) {
          st.set({ linkFrom: null });
          break;
        }
        if (isDouble('__empty') && !st.readMode) {
          const p = toWorld(e.clientX, e.clientY);
          const el = makeElement('note', Math.round(p.x - 180), Math.round(p.y - 24));
          st.addElements([el]);
          st.set({ editingId: el.id });
          s.lastTap = { id: null, t: 0, x: 0, y: 0 };
          return;
        }
        st.set({ selection: [], editingId: null, selectedLink: null });
        s.lastTap = { id: '__empty', t: now, x: e.clientX, y: e.clientY };
        break;
      }
      case 'box': {
        const r = st.boxRect;
        if (r && (r.w > 4 || r.h > 4)) {
          const ids = Object.values(st.board().elements)
            .filter((el) => {
              const sz = sizeOf(el);
              return el.x >= r.x && el.y >= r.y && el.x + sz.w <= r.x + r.w && el.y + sz.h <= r.y + r.h;
            })
            .map((el) => el.id);
          st.set({ selection: ids, boxRect: null });
        } else st.set({ boxRect: null, selection: [] });
        if (st.tool === 'box') st.set({ tool: 'select' });
        break;
      }
    }
    s.mode = 'none';
    s.resize = null;
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    const s = g.current;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 0) {
      s.mode = 'none';
      useApp.getState().set({ boxRect: null });
    }
  };

  return (
    <div
      ref={cont}
      className={`canvas tool-${tool}${readMode ? ' read' : ''}${showGrid ? ' grid' : ''}${linkFrom ? ' linking' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={world} className="world">
        <LinksLayer board={board} selectedLink={selectedLink} />
        {sorted.map((el) => (
          <ElementView
            key={el.id}
            el={el}
            selected={selSet.has(el.id)}
            editing={editingId === el.id}
            flash={flashId === el.id}
            linkSource={linkFrom === el.id}
          />
        ))}
        {sorted
          .filter((e): e is FrameEl => e.type === 'frame')
          .map((f) => (
            <div
              key={'bl' + f.id}
              className={'frame-biglabel c-' + f.color}
              data-fly={f.id}
              style={{
                left: f.x + f.w / 2,
                top: f.y + f.h / 2,
                width: f.w * 0.94,
                // шрифт не крупнее, чем помещается самое длинное слово
                fontSize: `min(calc(22px * var(--inv)), ${Math.round((f.w * 0.8) / (0.62 * Math.max(4, ...f.title.split(/\s+/).map((w) => w.length))))}px)`,
              }}
            >
              {f.title}
            </div>
          ))}
        {boxRect && <div className="box-select" style={{ transform: `translate(${boxRect.x}px, ${boxRect.y}px)`, width: boxRect.w, height: boxRect.h }} />}
      </div>
      {linkFrom && <div className="canvas-hint">Нажмите на элемент, с которым связать · тап по пустому месту — отмена</div>}
      {!sorted.length && (
        <div className="canvas-empty">
          <div style={{ fontSize: 48 }}>🌊</div>
          <div>Доска пустая</div>
          <div className="muted">Двойной тап — новая фраза · ＋ — другие элементы · 📥 — вставить текст от нейросети</div>
        </div>
      )}
    </div>
  );
}
