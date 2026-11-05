import { useMemo, useState } from 'react';
import { useApp } from '../store';
import type { Board, El } from '../types';
import { buildIndex, search, topicsOf } from '../searchIndex';
import { copyElement, flyToElement } from '../actions';
import { RichText, renderInline } from '../markup/inline';
import { CALLOUT_ICON } from '../canvas/elements';
import { copyText } from '../utils/misc';
import { stripMarkup } from '../utils/text';
import { getImageCached, getImage } from '../db';
import { useEffect } from 'react';

type TopicKey = 'fav' | 'recent' | 'loose' | string;

export function QuickItem({ el, big }: { el: El; big?: boolean }) {
  const st = useApp.getState();
  const copyStr = (t: string) => void copyText(stripMarkup(t)).then((ok) => st.showToast(ok ? '✓ Скопировано' : 'Не удалось'));
  switch (el.type) {
    case 'heading':
      return <div className={'q-heading h' + el.level}>{renderInline(el.text)}</div>;
    case 'note':
    case 'callout':
      return (
        <button className={`q-card c-${el.color}${el.type === 'callout' ? ' k-' + el.kind : ''}${big ? ' big' : ''}`} onClick={() => void copyElement(el)}>
          {el.type === 'callout' && <span className="q-ico">{CALLOUT_ICON[el.kind]}</span>}
          <span className="rich">
            <RichText text={el.text} />
          </span>
          {el.fav && <span className="q-fav">★</span>}
        </button>
      );
    case 'table':
      return (
        <div className={`q-table c-${el.color}`}>
          <table className="tbl">
            <tbody>
              {el.rows.map((r, i) => (
                <tr key={i} className={el.header && i === 0 ? 'th' : ''}>
                  {r.map((c, j) => (
                    <td key={j} onClick={() => c.trim() && copyStr(c)}>
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'dialog':
      return (
        <div className="q-dialog dialog">
          {el.lines.map((l, i) => (
            <button key={i} className={'bubble ' + l.who} onClick={() => copyStr(l.text)}>
              <div className="who">{l.who === 'me' ? 'Я' : 'Клиент'}</div>
              <div className="rich">
                <RichText text={l.text} />
              </div>
            </button>
          ))}
        </div>
      );
    case 'checklist':
      return (
        <div className="q-check checklist">
          {el.title && <div className="cl-title">{renderInline(el.title)}</div>}
          {el.items.map((it, i) => (
            <button key={i} className={'cl-item' + (it.done ? ' done' : '')} onClick={() => copyStr(it.text)}>
              <span className="cl-box">{it.done ? '✓' : ''}</span>
              <span className="rich">{renderInline(it.text)}</span>
            </button>
          ))}
        </div>
      );
    case 'image':
      return <QuickImage el={el} />;
    default:
      return null;
  }
}

function QuickImage({ el }: { el: Extract<El, { type: 'image' }> }) {
  const [src, setSrc] = useState(el.asset ? getImageCached(el.asset) : undefined);
  useEffect(() => {
    if (el.asset) void getImage(el.asset).then(setSrc);
  }, [el.asset]);
  if (!src) return null;
  return (
    <div className={'q-image' + (el.sticker ? ' sticker' : '')}>
      <img src={src} alt="" />
      {el.caption && <div className="img-caption">{el.caption}</div>}
    </div>
  );
}

export function QuickMode() {
  const boards = useApp((s) => s.boards);
  const currentBoardId = useApp((s) => s.currentBoardId);
  const recent = useApp((s) => s.recent);
  const board = boards.find((b) => b.id === currentBoardId) ?? boards[0];
  const [topic, setTopic] = useState<TopicKey>(() => sessionStorage.getItem('qm-topic') ?? 'fav');
  const [q, setQ] = useState('');
  const { topics, loose } = useMemo(() => topicsOf(board), [board]);
  const index = useMemo(() => buildIndex(boards), [boards]);
  const hits = useMemo(() => search(index, q, currentBoardId, 80), [index, q, currentBoardId]);
  const st = useApp.getState();

  const favs = useMemo(() => boards.flatMap((b) => Object.values(b.elements).filter((e) => e.fav && e.type !== 'frame')), [boards]);
  const recents = useMemo(() => {
    const out: El[] = [];
    for (const r of recent) {
      const b = boards.find((x) => x.id === r.boardId);
      const e = b?.elements[r.elId];
      if (e) out.push(e);
    }
    return out;
  }, [recent, boards]);

  const pick = (k: TopicKey) => {
    setTopic(k);
    sessionStorage.setItem('qm-topic', k);
    setQ('');
    document.querySelector('.qm-content')?.scrollTo({ top: 0 });
  };

  let items: El[] = [];
  let title = '';
  if (topic === 'fav') {
    items = favs;
    title = '★ Избранное';
  } else if (topic === 'recent') {
    items = recents;
    title = '🕘 Недавно копировали';
  } else if (topic === 'loose') {
    items = loose;
    title = 'Без раздела';
  } else {
    const t = topics.find((t) => t.frame.id === topic);
    if (t) {
      items = t.items;
      title = t.frame.title;
    } else {
      items = favs;
      title = '★ Избранное';
    }
  }

  const close = () => st.set({ quickMode: false });
  const showOnBoard = (b: Board, id: string) => {
    close();
    if (b.id !== st.currentBoardId) st.switchBoard(b.id);
    setTimeout(() => flyToElement(id), 50);
  };

  return (
    <div className="quick">
      <div className="qm-top">
        <button className="btn" onClick={close}>
          ← Доска
        </button>
        <div className="qm-search">
          <span>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Быстрый поиск по всем фразам…" />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')}>
              ✕
            </button>
          )}
        </div>
        <select className="input qm-board" value={currentBoardId} onChange={(e) => st.switchBoard(e.target.value)}>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.icon} {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="qm-main">
        <div className="qm-topics">
          <button className={'qm-topic' + (topic === 'fav' && !q ? ' on' : '')} onClick={() => pick('fav')}>
            ★ Избранное <span className="cnt">{favs.length}</span>
          </button>
          <button className={'qm-topic' + (topic === 'recent' && !q ? ' on' : '')} onClick={() => pick('recent')}>
            🕘 Недавние <span className="cnt">{recents.length}</span>
          </button>
          <div className="qm-sep" />
          {topics.map((t) => (
            <button key={t.frame.id} className={`qm-topic dot-${t.frame.color}` + (topic === t.frame.id && !q ? ' on' : '')} onClick={() => pick(t.frame.id)}>
              <span className="qm-dot" />
              <span className="qm-ttl">{t.frame.title}</span>
              <span className="cnt">{t.items.filter((i) => i.type !== 'heading').length}</span>
            </button>
          ))}
          {loose.length > 0 && (
            <button className={'qm-topic' + (topic === 'loose' && !q ? ' on' : '')} onClick={() => pick('loose')}>
              ⋯ Без раздела <span className="cnt">{loose.length}</span>
            </button>
          )}
        </div>
        <div className="qm-content">
          {q ? (
            <>
              <div className="qm-title">Найдено: {hits.length}</div>
              {hits
                .filter((h) => h.el.type !== 'frame')
                .map((h) => (
                  <div key={h.el.id} className="qm-hit">
                    <div className="qm-path">
                      {h.board.icon} {h.board.name}
                      {h.frame ? ' › ' + h.frame.title : ''}
                      <button className="link-btn" onClick={() => showOnBoard(h.board, h.el.id)}>
                        показать →
                      </button>
                    </div>
                    <QuickItem el={h.el} />
                  </div>
                ))}
            </>
          ) : (
            <>
              <div className="qm-title">{title}</div>
              {!items.length && (
                <div className="empty-hint">
                  {topic === 'fav'
                    ? 'Пока пусто. Выделите фразу на доске → ⋯ → «В избранное».'
                    : topic === 'recent'
                      ? 'Здесь появятся фразы, которые вы копировали.'
                      : 'В этом разделе пока ничего нет.'}
                </div>
              )}
              {items.map((el) => (
                <QuickItem key={el.id} el={el} />
              ))}
            </>
          )}
          <div className="qm-hint">Тап по фразе — скопировать в буфер обмена</div>
        </div>
      </div>
    </div>
  );
}

export function Reader() {
  const id = useApp((s) => s.readerId);
  const board = useApp((s) => s.board());
  const [scale, setScale] = useState(1.8);
  const el = id ? board.elements[id] : null;
  if (!el) return null;
  const close = () => useApp.getState().set({ readerId: null });
  return (
    <div className="reader" onClick={close}>
      <div className="reader-tools" onClick={(e) => e.stopPropagation()}>
        <button className="btn" onClick={() => setScale((s) => Math.max(1, s - 0.25))}>
          A−
        </button>
        <button className="btn" onClick={() => setScale((s) => Math.min(4, s + 0.25))}>
          A+
        </button>
        <button className="btn primary" onClick={() => void copyElement(el)}>
          ⧉ Копировать
        </button>
        <button className="btn" onClick={close}>
          ✕
        </button>
      </div>
      <div className="reader-body" style={{ fontSize: `${scale}em` }} onClick={(e) => e.stopPropagation()}>
        <QuickItem el={el} big />
      </div>
    </div>
  );
}
