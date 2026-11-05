import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, useView, useSizes } from '../store';
import type { CalloutEl, ColorKey, El, LinkStyle } from '../types';
import { COLOR_KEYS } from '../types';
import { canvasBox, copyElement, duplicateSelection, sizeOf, tidy, wrapInFrame, pickImageFor } from '../actions';
import { startEdit } from './Canvas';
import { activeTextarea, CALLOUT_ICON, CALLOUT_LABEL } from './elements';
import { linkGeometry } from './Links';
import { askText } from '../ui/common';

export const COLOR_NAMES: Record<ColorKey, string> = {
  none: 'Без цвета', red: 'Красный', orange: 'Оранжевый', yellow: 'Жёлтый', green: 'Зелёный', teal: 'Бирюзовый',
  blue: 'Синий', purple: 'Фиолетовый', pink: 'Розовый', gray: 'Серый',
};

function Palette({ value, onPick }: { value?: ColorKey; onPick: (c: ColorKey) => void }) {
  return (
    <div className="palette">
      {COLOR_KEYS.map((c) => (
        <button key={c} className={`swatch sw-${c}${value === c ? ' on' : ''}`} title={COLOR_NAMES[c]} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

/** Вставка разметки вокруг выделения в активном поле ввода */
function wrapSel(before: string, after = before) {
  const t = activeTextarea;
  if (!t) return;
  const { selectionStart: a, selectionEnd: b, value } = t;
  const sel = value.slice(a, b) || 'текст';
  const nv = value.slice(0, a) + before + sel + after + value.slice(b);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(t, nv);
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.focus();
  t.setSelectionRange(a + before.length, a + before.length + sel.length);
}

function linePrefix(prefix: string) {
  const t = activeTextarea;
  if (!t) return;
  const { selectionStart: a, value } = t;
  const ls = value.lastIndexOf('\n', a - 1) + 1;
  const nv = value.slice(0, ls) + prefix + value.slice(ls);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(t, nv);
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.focus();
  t.setSelectionRange(a + prefix.length, a + prefix.length);
}

export function SelectionToolbar() {
  const selection = useApp((s) => s.selection);
  const editingId = useApp((s) => s.editingId);
  const selectedLink = useApp((s) => s.selectedLink);
  const board = useApp((s) => s.board());
  const readMode = useApp((s) => s.readMode);
  useView((s) => s.x + s.y * 1e-3 + s.zoom * 1e-7); // перерисовка при движении камеры
  useSizes((s) => s.sizes);
  const [pop, setPop] = useState<null | 'color' | 'more' | 'cols' | 'type' | 'fmtcolor'>(null);
  const st = useApp.getState();
  const v = useView.getState();
  const ref = useRef<HTMLDivElement>(null);
  // не даём панели вылезти за края экрана
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.marginLeft = '0px';
    const r = el.getBoundingClientRect();
    const parent = el.parentElement!.getBoundingClientRect();
    let shift = 0;
    if (r.right > parent.right - 8) shift = parent.right - 8 - r.right;
    if (r.left + shift < parent.left + 8) shift = parent.left + 8 - r.left;
    el.style.marginLeft = shift + 'px';
  });

  // ---------- выбранная связь ----------
  if (selectedLink && !readMode) {
    const l = board.links.find((x) => x.id === selectedLink);
    if (!l) return null;
    const a = board.elements[l.from];
    const b = board.elements[l.to];
    if (!a || !b) return null;
    const ra = { x: a.x, y: a.y, ...sizeOf(a) };
    const rb = { x: b.x, y: b.y, ...sizeOf(b) };
    const { mid } = linkGeometry(ra, rb);
    const sx = mid.x * v.zoom + v.x;
    const sy = mid.y * v.zoom + v.y;
    const styles: [LinkStyle, string][] = [['arrow', '→'], ['dashed', '⇢'], ['both', '↔'], ['line', '—']];
    return (
      <div ref={ref} className="seltb" style={pos(sx, sy - 70)}>
        {styles.map(([s, icon]) => (
          <button key={s} className={l.style === s ? 'on' : ''} onClick={() => st.patchLink(l.id, { style: s })}>
            {icon}
          </button>
        ))}
        <button
          onClick={async () => {
            const label = await askText('Подпись к стрелке', l.label ?? '');
            if (label !== null) st.patchLink(l.id, { label: label.trim() || undefined });
          }}
        >
          🏷 Подпись
        </button>
        <button onClick={() => setPop(pop === 'color' ? null : 'color')}>🎨</button>
        <button
          onClick={() => {
            st.patchLink(l.id, { from: l.to, to: l.from });
          }}
          title="Развернуть"
        >
          ⇄
        </button>
        <button className="danger" onClick={() => (st.deleteLink(l.id), st.set({ selectedLink: null }))}>
          🗑
        </button>
        {pop === 'color' && (
          <div className="popover">
            <Palette value={l.color} onPick={(c) => (st.patchLink(l.id, { color: c }), setPop(null))} />
          </div>
        )}
      </div>
    );
  }

  const els = selection.map((id) => board.elements[id]).filter(Boolean) as El[];
  if (!els.length) return null;

  // рамка выделения в экранных координатах
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity;
  for (const e of els) {
    const s = sizeOf(e);
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + s.w);
  }
  const sx = ((x0 + x1) / 2) * v.zoom + v.x;
  const sy = y0 * v.zoom + v.y;

  // ---------- форматирование при редактировании ----------
  if (editingId) {
    const el = board.elements[editingId];
    if (!el || el.type === 'frame') return null;
    return (
      <div ref={ref} className="seltb fmt" style={pos(sx, sy - 66)} onPointerDown={(e) => e.preventDefault()}>
        <button onClick={() => wrapSel('**')}><b>Ж</b></button>
        <button onClick={() => wrapSel('*')}><i>К</i></button>
        <button onClick={() => wrapSel('__')}><u>Ч</u></button>
        <button onClick={() => wrapSel('~~')}><s>З</s></button>
        <button onClick={() => wrapSel('==')}><mark>В</mark></button>
        <button onClick={() => setPop(pop === 'fmtcolor' ? null : 'fmtcolor')}>🎨</button>
        <button onClick={() => wrapSel('[', ']')} title="Поле для подстановки, например [имя]">[ ]</button>
        <button onClick={() => wrapSel('[[', ']]')} title="Ссылка на раздел">↗</button>
        <button onClick={() => linePrefix('- ')}>•</button>
        <button onClick={() => linePrefix('1. ')}>1.</button>
        <button className="primary" onClick={() => activeTextarea?.blur()}>Готово</button>
        {pop === 'fmtcolor' && (
          <div className="popover">
            <div className="palette">
              {COLOR_KEYS.filter((c) => c !== 'none').map((c) => (
                <button key={c} className={`swatch sw-${c}`} title={COLOR_NAMES[c]} onClick={() => (wrapSel(`{${c}: `, '}'), setPop(null))} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const single = els.length === 1 ? els[0] : null;
  const close = () => setPop(null);

  if (readMode) {
    if (!single || single.type === 'frame' || single.type === 'image') return null;
    return (
      <div ref={ref} className="seltb" style={pos(sx, sy - 66)}>
        <button onClick={() => void copyElement(single)}>⧉ Копировать</button>
        <button onClick={() => st.set({ readerId: single.id })}>🔎 Крупно</button>
      </div>
    );
  }

  return (
    <div ref={ref} className="seltb" style={pos(sx, sy - 66)}>
      {single && single.type !== 'frame' && single.type !== 'image' && (
        <button onClick={() => void copyElement(single)} title="Копировать текст">⧉</button>
      )}
      {single && (
        <button onClick={() => startEdit(single.id)} title="Изменить">
          ✏️
        </button>
      )}
      <button onClick={() => setPop(pop === 'color' ? null : 'color')} title="Цвет">
        🎨
      </button>
      {single?.type === 'frame' && (
        <button onClick={() => setPop(pop === 'cols' ? null : 'cols')} title="Упорядочить содержимое">
          ▦ Упорядочить
        </button>
      )}
      {single && (single.type === 'note' || single.type === 'callout' || single.type === 'heading') && (
        <button onClick={() => setPop(pop === 'type' ? null : 'type')} title="Тип">
          {single.type === 'callout' ? CALLOUT_ICON[(single as CalloutEl).kind] : single.type === 'heading' ? 'H' + single.level : 'Аа'}
        </button>
      )}
      {single?.type === 'image' && single.asset && (
        <button onClick={() => st.set({ cropId: single.id })} title="Обрезать / стикер">
          ✂️
        </button>
      )}
      {single?.type === 'image' && (
        <button onClick={() => void pickImageFor(single.id)} title="Заменить картинку">
          🖼
        </button>
      )}
      {single && (
        <button onClick={() => (st.set({ linkFrom: single.id, selection: [] }), st.showToast('Теперь нажмите на второй элемент'))} title="Связать стрелкой">
          ↗ Связать
        </button>
      )}
      {!single && (
        <button onClick={wrapInFrame} title="Объединить в раздел">
          ▢ В раздел
        </button>
      )}
      <button onClick={() => setPop(pop === 'more' ? null : 'more')}>⋯</button>
      <button className="danger" onClick={() => st.deleteEls(selection)} title="Удалить">
        🗑
      </button>

      {pop === 'color' && (
        <div className="popover">
          <Palette
            value={single?.color}
            onPick={(c) => {
              const p: Record<string, Partial<El>> = {};
              for (const e of els) p[e.id] = { color: c };
              st.patchMany(p);
              close();
            }}
          />
        </div>
      )}
      {pop === 'cols' && single && (
        <div className="popover row">
          <span className="muted">Колонок:</span>
          {[1, 2, 3, 4].map((n) => (
            <button key={n} onClick={() => (tidy(single.id, n), close())}>
              {n}
            </button>
          ))}
          <button onClick={() => (tidy(single.id), close())}>Авто</button>
        </div>
      )}
      {pop === 'type' && single && (
        <div className="popover col">
          <button onClick={() => (convert(single, 'note'), close())}>Аа Обычная фраза</button>
          <button onClick={() => (convert(single, 'heading', 1), close())}>H1 Большой заголовок</button>
          <button onClick={() => (convert(single, 'heading', 2), close())}>H2 Заголовок</button>
          <button onClick={() => (convert(single, 'heading', 3), close())}>H3 Подзаголовок</button>
          {(Object.keys(CALLOUT_ICON) as CalloutEl['kind'][]).map((k) => (
            <button key={k} onClick={() => (convert(single, 'callout', k), close())}>
              {CALLOUT_ICON[k]} {CALLOUT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {pop === 'more' && (
        <div className="popover col">
          {single && (
            <button onClick={() => (st.patchEl(single.id, { fav: !single.fav }), close())}>{single.fav ? '☆ Убрать из избранного' : '★ В избранное'}</button>
          )}
          {single && single.type !== 'frame' && single.type !== 'image' && (
            <button onClick={() => (st.set({ readerId: single.id }), close())}>🔎 Показать крупно</button>
          )}
          <button onClick={() => (duplicateSelection(), close())}>⧉ Дублировать</button>
          <button onClick={() => (st.bringToFront(selection), close())}>⬆ На передний план</button>
          <button onClick={() => (st.sendToBack(selection), close())}>⬇ На задний план</button>
          {single?.type === 'image' && (
            <button
              onClick={async () => {
                close();
                const c = await askText('Подпись к картинке', single.caption ?? '');
                if (c !== null) st.patchEl(single.id, { caption: c.trim() || undefined } as Partial<El>);
                close();
              }}
            >
              🏷 Подпись
            </button>
          )}
          {single?.type === 'image' && single.asset && (
            <button onClick={() => (st.patchEl(single.id, { sticker: !single.sticker } as Partial<El>), close())}>
              {single.sticker ? '▭ Обычная картинка' : '✨ Сделать стикером'}
            </button>
          )}
          {single?.type === 'frame' && (
            <button
              onClick={async () => {
                close();
                const t = await askText('Теги раздела через запятую', (single.tags ?? []).join(', '));
                if (t !== null) st.patchEl(single.id, { tags: t.split(',').map((x) => x.trim()).filter(Boolean) });
                close();
              }}
            >
              # Теги
            </button>
          )}
          {!single && (
            <button
              onClick={() => {
                // выстроить столбиком по порядку
                const sorted = [...els].sort((a, b) => a.y - b.y || a.x - b.x);
                let y = sorted[0].y;
                const x = Math.min(...sorted.map((e) => e.x));
                const p: Record<string, Partial<El>> = {};
                for (const e of sorted) {
                  p[e.id] = { x, y };
                  y += sizeOf(e).h + 16;
                }
                st.patchMany(p);
                close();
              }}
            >
              ☰ Выстроить столбиком
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function convert(el: El, type: 'note' | 'heading' | 'callout', arg?: number | CalloutEl['kind']) {
  const text = 'text' in el ? el.text : '';
  const base = { ...el } as Record<string, unknown>;
  delete base.level;
  delete base.kind;
  const next = { ...base, type, text } as Record<string, unknown>;
  if (type === 'heading') next.level = arg ?? 2;
  if (type === 'callout') next.kind = arg ?? 'warn';
  const st = useApp.getState();
  st.snapshot();
  const b = st.board();
  useApp.setState({
    boards: st.boards.map((x) => (x.id === b.id ? { ...b, elements: { ...b.elements, [el.id]: next as unknown as El } } : x)),
  });
}

function pos(sx: number, sy: number): React.CSSProperties {
  const x = Math.max(8, Math.min(canvasBox.w - 8, sx));
  // панель стоит над выделением (translateY(-100%) в CSS); у верхнего края — прижимаем
  const y = Math.max(70, Math.min(canvasBox.h - 20, sy + 54));
  return { left: x, top: y };
}
