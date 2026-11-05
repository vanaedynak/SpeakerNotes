import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { buildIndex, search, type Hit } from '../searchIndex';
import { copyElement, flyToElement } from '../actions';
import { Highlight } from './common';
import { stripMarkup } from '../utils/text';
import type { El } from '../types';

export const TYPE_ICON: Record<El['type'], string> = {
  note: '💬', heading: '🔠', frame: '▢', table: '▦', image: '🖼', callout: '⚠️', dialog: '🗨', checklist: '☑',
};

export function SearchPalette() {
  const boards = useApp((s) => s.boards);
  const currentBoardId = useApp((s) => s.currentBoardId);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const index = useMemo(() => buildIndex(boards), [boards]);
  const hits = useMemo(() => search(index, q, currentBoardId), [index, q, currentBoardId]);
  const close = () => useApp.getState().set({ panel: null });

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 30);
  }, []);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.hit.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const show = (h: Hit) => {
    const st = useApp.getState();
    close();
    if (h.board.id !== st.currentBoardId) st.switchBoard(h.board.id);
    setTimeout(() => flyToElement(h.el.id), 40);
  };
  const act = (h: Hit, alt = false) => {
    if (alt || h.el.type === 'frame' || h.el.type === 'heading' || h.el.type === 'image') show(h);
    else void copyElement(h.el);
  };

  return (
    <div className="modal-back top" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette-box">
        <div className="palette-input">
          <span>🔍</span>
          <input
            ref={input}
            value={q}
            placeholder="Найти фразу, раздел, тег…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(hits.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter' && hits[sel]) {
                e.preventDefault();
                act(hits[sel], e.shiftKey);
              }
            }}
          />
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="palette-list" ref={list}>
          {q && !hits.length && <div className="empty-hint">Ничего не нашлось. Попробуйте другое слово или его начало.</div>}
          {!q && (
            <div className="empty-hint">
              Начните печатать. <b>Enter</b> — скопировать фразу, <b>Shift+Enter</b> или <b>→</b> — показать на доске.
              <br />
              Можно печатать в любой раскладке и с одной опечаткой.
            </div>
          )}
          {hits.map((h, i) => (
            <div key={h.el.id} className={'hit' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)}>
              <button className="hit-main" onClick={() => act(h)}>
                <span className="hit-icon">{TYPE_ICON[h.el.type]}</span>
                <span className="hit-body">
                  <span className="hit-text">
                    <Highlight text={stripMarkup(h.text).slice(0, 220)} query={h.viaLayout ? '' : q} />
                  </span>
                  <span className="hit-path">
                    {h.board.icon} {h.board.name}
                    {h.frame ? ' › ' + h.frame.title : ''}
                    {h.el.fav ? ' · ★' : ''}
                  </span>
                </span>
              </button>
              <button className="hit-go" title="Показать на доске" onClick={() => show(h)}>
                →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
