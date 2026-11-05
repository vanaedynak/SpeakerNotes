import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalloutEl, ChecklistEl, DialogEl, El, FrameEl, HeadingEl, ImageEl, NoteEl, TableEl } from '../types';
import { useApp, useSizes } from '../store';
import { RichText, renderInline } from '../markup/inline';
import { copyElement, jumpToTitle } from '../actions';
import { getImage, getImageCached, onImage } from '../db';
import { copyText } from '../utils/misc';
import { stripMarkup } from '../utils/text';

// ---------- общий ResizeObserver ----------
const roMap = new WeakMap<Element, string>();
const ro = new ResizeObserver((entries) => {
  const set = useSizes.getState().setSize;
  for (const e of entries) {
    const id = roMap.get(e.target);
    const t = e.target as HTMLElement;
    if (id) set(id, t.offsetWidth, t.offsetHeight);
  }
});

export let activeTextarea: HTMLTextAreaElement | null = null;

export const CALLOUT_ICON: Record<CalloutEl['kind'], string> = { info: 'ℹ️', tip: '💡', warn: '⚠️', danger: '⛔', success: '✅' };
export const CALLOUT_LABEL: Record<CalloutEl['kind'], string> = { info: 'Инфо', tip: 'Подсказка', warn: 'Важно', danger: 'Нельзя', success: 'Можно' };

interface Props {
  el: El;
  selected: boolean;
  editing: boolean;
  flash: boolean;
  linkSource: boolean;
}

export const ElementView = memo(function ElementView({ el, selected, editing, flash, linkSource }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    roMap.set(node, el.id);
    ro.observe(node);
    useSizes.getState().setSize(el.id, node.offsetWidth, node.offsetHeight);
    return () => ro.unobserve(node);
  }, [el.id]);

  const style: React.CSSProperties = {
    transform: `translate(${el.x}px, ${el.y}px)`,
    width: el.w,
    height: el.type === 'frame' || el.type === 'image' ? el.h : undefined,
    zIndex: el.z,
  };
  const cls = [
    'el',
    `el-${el.type}`,
    `c-${el.color}`,
    selected && 'selected',
    editing && 'editing',
    flash && 'flash',
    linkSource && 'link-source',
    el.type === 'image' && el.sticker && 'sticker',
    el.type === 'callout' && `k-${el.kind}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={cls} style={style} data-el={el.id}>
      {el.fav && <span className="fav-badge">★</span>}
      <Body el={el} editing={editing} />
      {selected && !editing && <div className="handle" data-handle="se" />}
    </div>
  );
});

function Body({ el, editing }: { el: El; editing: boolean }) {
  switch (el.type) {
    case 'note':
      return <NoteBody el={el} editing={editing} />;
    case 'heading':
      return <HeadingBody el={el} editing={editing} />;
    case 'callout':
      return <CalloutBody el={el} editing={editing} />;
    case 'frame':
      return <FrameBody el={el} editing={editing} />;
    case 'table':
      return <TableBody el={el} />;
    case 'image':
      return <ImageBody el={el} />;
    case 'dialog':
      return <DialogBody el={el} />;
    case 'checklist':
      return <ChecklistBody el={el} />;
  }
}

function CopyBtn({ el }: { el: El }) {
  return (
    <button
      className="copy-btn"
      title="Копировать"
      data-nodrag
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void copyElement(el);
      }}
    >
      ⧉
    </button>
  );
}

// ---------- редактор текста прямо на карточке ----------
function InlineEditor({ value, onDone, className, placeholder }: { value: string; onDone: (v: string) => void; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  const ta = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const autosize = () => {
    const t = ta.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  };
  useLayoutEffect(() => {
    const t = ta.current!;
    activeTextarea = t;
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
    autosize();
    return () => {
      if (activeTextarea === t) activeTextarea = null;
    };
  }, []);
  useEffect(autosize, [v]);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(ta.current?.value ?? v);
  };
  return (
    <textarea
      ref={ta}
      className={'inline-edit ' + (className ?? '')}
      value={v}
      placeholder={placeholder ?? 'Введите текст…'}
      onChange={(e) => setV(e.target.value)}
      onInput={autosize}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}

function useCommit(id: string) {
  return (patch: Partial<El>, isEmpty: boolean) => {
    const st = useApp.getState();
    const cur = st.board().elements[id];
    st.set({ editingId: null });
    if (!cur) return;
    if (isEmpty) {
      st.deleteEls([id]);
      return;
    }
    const changed = Object.entries(patch).some(([k, v]) => (cur as unknown as Record<string, unknown>)[k] !== v);
    if (changed) st.patchEl(id, patch);
  };
}

function NoteBody({ el, editing }: { el: NoteEl; editing: boolean }) {
  const commit = useCommit(el.id);
  if (editing) return <InlineEditor value={el.text} onDone={(text) => commit({ text }, !text.trim())} />;
  return (
    <>
      <div className="rich">{el.text ? <RichText text={el.text} onJump={jumpToTitle} /> : <span className="muted">Пустая фраза</span>}</div>
      <CopyBtn el={el} />
    </>
  );
}

function HeadingBody({ el, editing }: { el: HeadingEl; editing: boolean }) {
  const commit = useCommit(el.id);
  const Tag = (`h${el.level}` as 'h1');
  if (editing) return <InlineEditor className={'h' + el.level} value={el.text} placeholder="Заголовок" onDone={(text) => commit({ text }, !text.trim())} />;
  return <Tag className="rich">{renderInline(el.text, jumpToTitle) as React.ReactNode}</Tag>;
}

function CalloutBody({ el, editing }: { el: CalloutEl; editing: boolean }) {
  const commit = useCommit(el.id);
  return (
    <>
      <div className="callout-icon">{CALLOUT_ICON[el.kind]}</div>
      <div className="callout-text">
        {editing ? (
          <InlineEditor value={el.text} onDone={(text) => commit({ text }, !text.trim())} />
        ) : (
          <div className="rich">
            <RichText text={el.text} onJump={jumpToTitle} />
          </div>
        )}
      </div>
      {!editing && <CopyBtn el={el} />}
    </>
  );
}

function FrameBody({ el, editing }: { el: FrameEl; editing: boolean }) {
  const st = useApp.getState;
  const [v, setV] = useState(el.title);
  useEffect(() => setV(el.title), [el.title, editing]);
  const commit = () => {
    st().set({ editingId: null });
    if (v.trim() && v !== el.title) st().patchEl(el.id, { title: v.trim() } as Partial<El>);
  };
  return (
    <>
      <div className="frame-title" data-frame-title>
        {editing ? (
          <input
            autoFocus
            className="frame-title-input"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span>{el.title}</span>
        )}
        {el.tags?.length ? <span className="frame-tags">{el.tags.map((t) => '#' + t).join(' ')}</span> : null}
      </div>
    </>
  );
}

function TableBody({ el }: { el: TableEl }) {
  return (
    <table className="tbl">
      <tbody>
        {el.rows.map((r, i) => (
          <tr key={i} className={el.header && i === 0 ? 'th' : ''}>
            {r.map((c, j) => (
              <td
                key={j}
                onClick={(e) => {
                  if (!useApp.getState().readMode || !c.trim()) return;
                  e.stopPropagation();
                  void copyText(stripMarkup(c)).then(() => useApp.getState().showToast('✓ Скопировано: ' + stripMarkup(c).slice(0, 40)));
                }}
              >
                {renderInline(c, jumpToTitle, `t${i}-${j}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImageBody({ el }: { el: ImageEl }) {
  const [src, setSrc] = useState<string | undefined>(() => (el.asset ? getImageCached(el.asset) : undefined));
  useEffect(() => {
    if (!el.asset) {
      setSrc(undefined);
      return;
    }
    let alive = true;
    void getImage(el.asset).then((v) => alive && setSrc(v));
    const off = onImage(el.asset, () => void getImage(el.asset).then((v) => alive && setSrc(v)));
    return () => {
      alive = false;
      off();
    };
  }, [el.asset]);
  return (
    <>
      {el.asset && src ? (
        <img src={src} draggable={false} alt={el.caption ?? ''} />
      ) : (
        <div className="img-ph">
          <div style={{ fontSize: '2.2em' }}>🖼</div>
          <div>{el.caption ?? 'Картинка'}</div>
          <div className="muted">Двойной тап — выбрать файл</div>
        </div>
      )}
      {el.asset && el.caption && <div className="img-caption">{el.caption}</div>}
    </>
  );
}

function DialogBody({ el }: { el: DialogEl }) {
  return (
    <div className="dialog">
      {el.lines.map((l, i) => (
        <div key={i} className={'bubble ' + l.who}>
          <div className="who">{l.who === 'me' ? 'Я' : 'Клиент'}</div>
          <div className="rich">
            <RichText text={l.text || '…'} onJump={jumpToTitle} />
          </div>
          {l.who === 'me' && l.text && (
            <button
              className="copy-btn small"
              data-nodrag
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void copyText(stripMarkup(l.text)).then(() => useApp.getState().showToast('✓ Скопировано'));
              }}
            >
              ⧉
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ChecklistBody({ el }: { el: ChecklistEl }) {
  const toggle = (i: number) => {
    const items = el.items.map((it, j) => (j === i ? { ...it, done: !it.done } : it));
    useApp.getState().patchEl(el.id, { items } as Partial<El>);
  };
  return (
    <div className="checklist">
      {el.title && <div className="cl-title">{renderInline(el.title)}</div>}
      {el.items.map((it, i) => (
        <div key={i} className={'cl-item' + (it.done ? ' done' : '')}>
          <button
            className="cl-box"
            data-nodrag
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggle(i);
            }}
          >
            {it.done ? '✓' : ''}
          </button>
          <div className="rich">{renderInline(it.text || '…', jumpToTitle, 'c' + i)}</div>
        </div>
      ))}
    </div>
  );
}
