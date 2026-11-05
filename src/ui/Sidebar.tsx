import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { topicsOf } from '../searchIndex';
import { fitAll, flyToElement } from '../actions';
import { askText, confirmBox } from './common';
import { norm, stripMarkup } from '../utils/text';
import type { FrameEl } from '../types';

const ICONS = ['📋', '📞', '💬', '😡', '💰', '📶', '📱', '🛠', '📦', '🎁', '❓', '⭐', '🔥', '📚', '🧾', '🌐'];

export function Sidebar() {
  const open = useApp((s) => s.sidebarOpen);
  const boards = useApp((s) => s.boards);
  const board = useApp((s) => s.board());
  const [filter, setFilter] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const st = useApp.getState();
  const { topics, loose } = useMemo(() => topicsOf(board), [board]);
  const tags = useMemo(() => [...new Set(topics.flatMap((t) => t.frame.tags ?? []))].sort(), [topics]);
  const favs = useMemo(() => Object.values(board.elements).filter((e) => e.fav), [board]);

  const narrow = () => window.innerWidth < 900;
  const go = (id: string) => {
    flyToElement(id);
    if (narrow()) st.set({ sidebarOpen: false });
  };

  const nf = norm(filter);
  const shown = topics.filter((t) => {
    if (tag && !(t.frame.tags ?? []).includes(tag)) return false;
    if (!nf) return true;
    return norm(t.frame.title).includes(nf) || t.items.some((i) => i.type === 'heading' && norm(i.text).includes(nf));
  });

  const newBoard = async () => {
    const name = await askText('Название новой доски', 'Новая доска');
    if (name?.trim()) st.addBoard(name.trim());
  };

  const editBoard = async (id: string) => {
    const b = boards.find((x) => x.id === id)!;
    const name = await askText('Переименовать доску', b.name);
    if (name?.trim()) st.renameBoard(id, name.trim());
  };

  const cycleIcon = (id: string) => {
    const b = boards.find((x) => x.id === id)!;
    const i = ICONS.indexOf(b.icon);
    st.renameBoard(id, b.name, ICONS[(i + 1) % ICONS.length]);
  };

  return (
    <>
      {open && <div className="sidebar-back" onClick={() => st.set({ sidebarOpen: false })} />}
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="sb-section">
          <div className="sb-head">
            <span>Доски</span>
            <button className="icon-btn" onClick={newBoard} title="Новая доска">
              ＋
            </button>
          </div>
          {boards.map((b) => (
            <div key={b.id} className={'sb-board' + (b.id === board.id ? ' on' : '')}>
              <button className="sb-icon" onClick={() => cycleIcon(b.id)} title="Сменить значок">
                {b.icon}
              </button>
              <button className="sb-name" onClick={() => st.switchBoard(b.id)}>
                {b.name}
                <span className="cnt">{Object.keys(b.elements).length}</span>
              </button>
              {b.id === board.id && (
                <>
                  <button className="icon-btn sm" onClick={() => editBoard(b.id)} title="Переименовать">
                    ✏️
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Удалить доску"
                    onClick={async () => {
                      if (await confirmBox(`Удалить доску «${b.name}» со всем содержимым?`, true)) st.deleteBoard(b.id);
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="sb-section grow">
          <div className="sb-head">
            <span>Содержание</span>
            <button className="icon-btn sm" onClick={fitAll} title="Показать всю доску">
              ⤢
            </button>
          </div>
          <input className="input sm" placeholder="Фильтр разделов…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {tags.length > 0 && (
            <div className="sb-tags">
              {tags.map((t) => (
                <button key={t} className={'chip' + (tag === t ? ' on' : '')} onClick={() => setTag(tag === t ? null : t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
          <div className="sb-outline">
            {favs.length > 0 && !nf && !tag && (
              <div className="sb-group">
                <button className="sb-frame" onClick={() => setCollapsed((c) => ({ ...c, __fav: !c.__fav }))}>
                  <span className="caret">{collapsed.__fav ? '▸' : '▾'}</span> ★ Избранное <span className="cnt">{favs.length}</span>
                </button>
                {!collapsed.__fav &&
                  favs.map((e) => (
                    <button key={e.id} className="sb-item" onClick={() => go(e.id)}>
                      {stripMarkup('text' in e ? e.text : e.type === 'frame' ? (e as FrameEl).title : e.type).slice(0, 60)}
                    </button>
                  ))}
              </div>
            )}
            {shown.map((t) => {
              const heads = t.items.filter((i) => i.type === 'heading');
              const isCol = collapsed[t.frame.id];
              return (
                <div key={t.frame.id} className={`sb-group dot-${t.frame.color}`}>
                  <div className="sb-frame-row">
                    {heads.length > 0 && (
                      <button className="caret-btn" onClick={() => setCollapsed((c) => ({ ...c, [t.frame.id]: !c[t.frame.id] }))}>
                        {isCol ? '▸' : '▾'}
                      </button>
                    )}
                    <button className="sb-frame" onClick={() => go(t.frame.id)}>
                      <span className="qm-dot" />
                      <span className="sb-ttl">{t.frame.title}</span>
                      <span className="cnt">{t.items.length}</span>
                    </button>
                  </div>
                  {!isCol &&
                    heads.map((h) => (
                      <button key={h.id} className={'sb-item lvl' + ('level' in h ? h.level : 2)} onClick={() => go(h.id)}>
                        {'text' in h ? stripMarkup(h.text) : ''}
                      </button>
                    ))}
                </div>
              );
            })}
            {loose.length > 0 && !nf && !tag && <div className="sb-note">+ {loose.length} элементов вне разделов</div>}
            {!topics.length && (
              <div className="sb-note">
                Здесь появятся разделы доски. Создайте раздел (＋ → ▢ Раздел) и кладите в него фразы — так их будет легко находить.
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
