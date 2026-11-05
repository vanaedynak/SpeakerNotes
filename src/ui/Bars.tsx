import { useApp, useView } from '../store';
import { addElementAtCenter, fitAll, zoomBy, animateView, canvasBox, viewCenterWorld } from '../actions';
import type { ElType, Tool } from '../types';

export function TopBar() {
  const board = useApp((s) => s.board());
  const readMode = useApp((s) => s.readMode);
  const canUndo = useApp((s) => (s.past[s.currentBoardId]?.length ?? 0) > 0);
  const canRedo = useApp((s) => (s.future[s.currentBoardId]?.length ?? 0) > 0);
  const st = useApp.getState();
  return (
    <header className="topbar">
      <button className="tb-btn" onClick={() => st.set({ sidebarOpen: !st.sidebarOpen })} title="Доски и содержание">
        ☰
      </button>
      <button className="tb-board" onClick={() => st.set({ sidebarOpen: true })}>
        <span>{board.icon}</span>
        <span className="tb-board-name">{board.name}</span>
      </button>
      <button className="tb-search" onClick={() => st.set({ panel: 'search' })}>
        🔍 <span>Поиск фраз…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="tb-right">
        <button className="tb-btn accent" onClick={() => st.set({ quickMode: true })} title="Быстрый режим — для звонка">
          ⚡<span className="lbl">Быстро</span>
        </button>
        <button className={'tb-btn' + (readMode ? ' on' : '')} onClick={() => st.set({ readMode: !readMode, selection: [], editingId: null })} title="Режим чтения: тап — копировать, ничего не сдвинется">
          {readMode ? '🔒' : '📖'}
          <span className="lbl">{readMode ? 'Чтение' : 'Чтение'}</span>
        </button>
        {!readMode && (
          <>
            <button className="tb-btn" disabled={!canUndo} onClick={st.undo} title="Отменить">
              ↶
            </button>
            <button className="tb-btn" disabled={!canRedo} onClick={st.redo} title="Вернуть">
              ↷
            </button>
            <button className="tb-btn" onClick={() => st.set({ panel: 'import' })} title="Вставить текст / от нейросети">
              📥<span className="lbl">Вставить</span>
            </button>
          </>
        )}
        <button className="tb-btn" onClick={() => st.set({ panel: 'settings' })} title="Настройки">
          ⚙️
        </button>
      </div>
    </header>
  );
}

const ADD: [ElType, string, string][] = [
  ['note', '💬', 'Фраза'],
  ['heading', '🔠', 'Заголовок'],
  ['frame', '▢', 'Раздел'],
  ['callout', '⚠️', 'Важно'],
  ['table', '▦', 'Таблица'],
  ['dialog', '🗨', 'Диалог'],
  ['checklist', '☑', 'Список'],
  ['image', '🖼', 'Картинка'],
];

export function Dock() {
  const readMode = useApp((s) => s.readMode);
  const tool = useApp((s) => s.tool);
  const st = useApp.getState();
  if (readMode) return null;
  const tools: [Tool, string, string][] = [
    ['select', '👆', 'Выбор и перемещение'],
    ['hand', '✋', 'Только двигать доску'],
    ['box', '⬚', 'Выделить рамкой'],
  ];
  return (
    <div className="dock">
      <div className="dock-group">
        {tools.map(([t, icon, title]) => (
          <button key={t} className={'dock-btn' + (tool === t ? ' on' : '')} title={title} onClick={() => st.set({ tool: t })}>
            {icon}
          </button>
        ))}
      </div>
      <div className="dock-group scroll">
        {ADD.map(([t, icon, label]) => (
          <button key={t} className="dock-btn add" onClick={() => addElementAtCenter(t)} title={'Добавить: ' + label}>
            <span className="di">{icon}</span>
            <span className="dl">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ZoomControls() {
  const zoom = useView((s) => s.zoom);
  return (
    <div className="zoomctl">
      <button onClick={() => zoomBy(1 / 1.3)}>−</button>
      <button
        className="zv"
        onClick={() => {
          const c = viewCenterWorld();
          animateView({ zoom: 1, x: canvasBox.w / 2 - c.x, y: canvasBox.h / 2 - c.y }, 250);
        }}
        title="100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => zoomBy(1.3)}>＋</button>
      <button onClick={fitAll} title="Показать всё">
        ⤢
      </button>
    </div>
  );
}
