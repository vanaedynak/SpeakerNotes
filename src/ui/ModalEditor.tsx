import { useState } from 'react';
import { useApp } from '../store';
import { Modal } from './common';
import type { ChecklistEl, DialogEl, El, TableEl } from '../types';

export function ModalEditor() {
  const id = useApp((s) => s.modalEditId);
  const el = useApp((s) => (id ? s.board().elements[id] : null));
  if (!el) return null;
  return <EditorInner key={el.id} el={el} />;
}

function EditorInner({ el }: { el: El }) {
  const [draft, setDraft] = useState<El>(() => structuredClone(el));
  const st = useApp.getState();
  const close = () => st.set({ modalEditId: null });
  const save = () => {
    st.patchEl(el.id, draft);
    close();
  };
  const title = el.type === 'table' ? '▦ Таблица' : el.type === 'dialog' ? '🗨 Диалог' : '☑ Список';
  return (
    <Modal
      title={title}
      onClose={close}
      wide
      footer={
        <>
          <span className="muted grow">Можно использовать **жирный**, ==выделение==, [поле]</span>
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      {draft.type === 'table' && <TableEditor t={draft} onChange={setDraft} />}
      {draft.type === 'dialog' && <DialogEditor d={draft} onChange={setDraft} />}
      {draft.type === 'checklist' && <ChecklistEditor c={draft} onChange={setDraft} />}
    </Modal>
  );
}

function TableEditor({ t, onChange }: { t: TableEl; onChange: (t: TableEl) => void }) {
  const rows = t.rows;
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const setCell = (i: number, j: number, v: string) => onChange({ ...t, rows: rows.map((r, ri) => (ri === i ? r.map((c, cj) => (cj === j ? v : c)) : r)) });
  const addRow = (at: number) => onChange({ ...t, rows: [...rows.slice(0, at), Array(cols).fill(''), ...rows.slice(at)] });
  const delRow = (i: number) => rows.length > 1 && onChange({ ...t, rows: rows.filter((_, ri) => ri !== i) });
  const addCol = () => onChange({ ...t, rows: rows.map((r) => [...r, '']), w: Math.min(1200, t.w + 160) });
  const delCol = (j: number) => cols > 1 && onChange({ ...t, rows: rows.map((r) => r.filter((_, cj) => cj !== j)) });
  return (
    <div className="tbl-edit">
      <label className="row">
        <input type="checkbox" checked={t.header} onChange={(e) => onChange({ ...t, header: e.target.checked })} /> Первая строка — заголовок
      </label>
      <div className="tbl-scroll no-wheel">
        <table>
          <thead>
            <tr>
              <th />
              {Array.from({ length: cols }, (_, j) => (
                <th key={j}>
                  <button className="icon-btn sm" onClick={() => delCol(j)} title="Удалить колонку">
                    ✕
                  </button>
                </th>
              ))}
              <th>
                <button className="btn sm" onClick={addCol}>
                  ＋ колонка
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={t.header && i === 0 ? 'th' : ''}>
                <td>
                  <button className="icon-btn sm" onClick={() => delRow(i)} title="Удалить строку">
                    ✕
                  </button>
                </td>
                {r.map((c, j) => (
                  <td key={j}>
                    <textarea className="input cell" rows={1} value={c} onChange={(e) => setCell(i, j, e.target.value)} />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" onClick={() => addRow(rows.length)}>
        ＋ строка
      </button>
    </div>
  );
}

function DialogEditor({ d, onChange }: { d: DialogEl; onChange: (d: DialogEl) => void }) {
  const lines = d.lines;
  const set = (i: number, p: Partial<DialogEl['lines'][0]>) => onChange({ ...d, lines: lines.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= lines.length) return;
    const n = [...lines];
    [n[i], n[j]] = [n[j], n[i]];
    onChange({ ...d, lines: n });
  };
  return (
    <div className="dlg-edit">
      {lines.map((l, i) => (
        <div key={i} className={'dlg-row ' + l.who}>
          <button className={'btn sm who-btn ' + l.who} onClick={() => set(i, { who: l.who === 'me' ? 'client' : 'me' })}>
            {l.who === 'me' ? 'Я' : 'Клиент'}
          </button>
          <textarea className="input" rows={2} value={l.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Реплика…" />
          <div className="col">
            <button className="icon-btn sm" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="icon-btn sm" onClick={() => move(i, 1)}>
              ↓
            </button>
          </div>
          <button className="icon-btn sm" onClick={() => onChange({ ...d, lines: lines.filter((_, k) => k !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => onChange({ ...d, lines: [...lines, { who: 'client', text: '' }] })}>
          ＋ Клиент
        </button>
        <button className="btn" onClick={() => onChange({ ...d, lines: [...lines, { who: 'me', text: '' }] })}>
          ＋ Я
        </button>
      </div>
    </div>
  );
}

function ChecklistEditor({ c, onChange }: { c: ChecklistEl; onChange: (c: ChecklistEl) => void }) {
  const items = c.items;
  const set = (i: number, p: Partial<ChecklistEl['items'][0]>) => onChange({ ...c, items: items.map((it, k) => (k === i ? { ...it, ...p } : it)) });
  return (
    <div className="cl-edit">
      <input className="input" value={c.title ?? ''} placeholder="Название списка" onChange={(e) => onChange({ ...c, title: e.target.value })} />
      {items.map((it, i) => (
        <div key={i} className="row">
          <input type="checkbox" checked={it.done} onChange={(e) => set(i, { done: e.target.checked })} />
          <input
            className="input grow"
            value={it.text}
            placeholder="Пункт…"
            onChange={(e) => set(i, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onChange({ ...c, items: [...items.slice(0, i + 1), { text: '', done: false }, ...items.slice(i + 1)] });
                setTimeout(() => {
                  const inputs = document.querySelectorAll<HTMLInputElement>('.cl-edit input.grow');
                  inputs[i + 1]?.focus();
                }, 20);
              }
            }}
          />
          <button className="icon-btn sm" onClick={() => onChange({ ...c, items: items.filter((_, k) => k !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange({ ...c, items: [...items, { text: '', done: false }] })}>
        ＋ пункт
      </button>
    </div>
  );
}
