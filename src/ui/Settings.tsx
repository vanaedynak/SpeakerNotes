import { useApp } from '../store';
import { Modal, Seg, confirmBox } from './common';
import type { Settings as S, ThemeKey } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { exportBackup, importBackup } from '../actions';
import { pickFile } from '../utils/misc';
import { makeWelcomeBoard } from '../welcome';

const THEMES: [ThemeKey, string, string, string][] = [
  ['amoled', 'Чёрная', '#000', '#fff'],
  ['dark', 'Тёмная', '#17181c', '#ececec'],
  ['contrast', 'Контраст', '#000', '#ffe600'],
  ['light', 'Светлая', '#fff', '#000'],
  ['sepia', 'Сепия', '#f4ecd8', '#3b2f1e'],
];

export function SettingsDialog() {
  const s = useApp((x) => x.settings);
  const st = useApp.getState();
  const set = (p: Partial<S>) => st.setSettings(p);
  const close = () => st.set({ panel: null });

  return (
    <Modal title="⚙️ Настройки" onClose={close} wide>
      <h3>Тема</h3>
      <div className="themes">
        {THEMES.map(([k, name, bg, fg]) => (
          <button key={k} className={'theme-card' + (s.theme === k ? ' on' : '')} style={{ background: bg, color: fg }} onClick={() => set({ theme: k })}>
            <span style={{ fontSize: '1.6em', fontWeight: 700 }}>Аа</span>
            <span>{name}</span>
          </button>
        ))}
      </div>

      <h3>Читаемость</h3>
      <label className="set-row">
        <span>
          Размер текста на доске <b>{Math.round(s.textScale * 100)}%</b>
        </span>
        <input type="range" min={0.8} max={2.4} step={0.05} value={s.textScale} onChange={(e) => set({ textScale: +e.target.value })} />
      </label>
      <label className="set-row">
        <span>
          Размер интерфейса <b>{Math.round(s.uiScale * 100)}%</b>
        </span>
        <input type="range" min={0.85} max={1.6} step={0.05} value={s.uiScale} onChange={(e) => set({ uiScale: +e.target.value })} />
      </label>
      <label className="set-row">
        <span>
          Межстрочный интервал <b>{s.lineHeight.toFixed(2)}</b>
        </span>
        <input type="range" min={1.2} max={2} step={0.05} value={s.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value })} />
      </label>
      <label className="set-row">
        <span>
          Расстояние между буквами <b>{s.letterSpacing.toFixed(2)}</b>
        </span>
        <input type="range" min={0} max={0.12} step={0.01} value={s.letterSpacing} onChange={(e) => set({ letterSpacing: +e.target.value })} />
      </label>
      <div className="set-row">
        <span>Шрифт</span>
        <Seg
          value={s.font}
          onChange={(font) => set({ font })}
          options={[
            ['hyperlegible', 'Для слабого зрения'],
            ['system', 'Системный'],
            ['serif', 'С засечками'],
            ['mono', 'Моноширинный'],
          ]}
        />
      </div>
      <Toggle label="Жирный текст везде" value={s.boldText} onChange={(boldText) => set({ boldText })} />
      <Toggle label="Крупные названия разделов при отдалении" value={s.bigLabels} onChange={(bigLabels) => set({ bigLabels })} />
      <Toggle label="Без анимаций" value={s.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />

      <h3>Доска</h3>
      <Toggle label="Сетка на фоне" value={s.showGrid} onChange={(showGrid) => set({ showGrid })} />
      <Toggle label="Прилипание к сетке" value={s.snap} onChange={(snap) => set({ snap })} />
      <div className="set-row">
        <span>Тап по фразе в режиме чтения</span>
        <Seg value={s.tapAction} onChange={(tapAction) => set({ tapAction })} options={[['copy', 'Копировать'], ['open', 'Показать крупно']]} />
      </div>

      <h3>Данные</h3>
      <div className="muted" style={{ marginBottom: 8 }}>
        Всё хранится только на этом устройстве. Чтобы перенести доски на другое устройство — сохраните копию и откройте её там.
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => void exportBackup()}>
          💾 Сохранить копию (.json)
        </button>
        <button
          className="btn"
          onClick={async () => {
            const f = await pickFile('.json,application/json');
            if (!f) return;
            const replace = await confirmBox('Заменить все текущие доски содержимым файла? (Нет — добавить к существующим)');
            try {
              await importBackup(await f.text(), replace ? 'replace' : 'merge');
              st.showToast('Готово');
            } catch (e) {
              st.showToast((e as Error).message);
            }
          }}
        >
          📂 Открыть копию
        </button>
        <button className="btn" onClick={() => (st.set({ boards: [...useApp.getState().boards, { ...makeWelcomeBoard(), name: 'Справка' }] }), st.showToast('Добавлена доска «Справка»'))}>
          ❓ Добавить доску-справку
        </button>
        <button className="btn" onClick={() => set(DEFAULT_SETTINGS)}>
          ↺ Сбросить настройки
        </button>
      </div>

      <h3>О приложении</h3>
      <div className="muted">
        SpeakerNotes {__APP_VERSION__} · <a href="https://github.com/vanaedynak/SpeakerNotes" target="_blank" rel="noreferrer">github.com/vanaedynak/SpeakerNotes</a>
        <br />
        Горячие клавиши: Ctrl+K — поиск, Ctrl+Z / Ctrl+Shift+Z — отменить / вернуть, Delete — удалить, Ctrl+D — дублировать, Enter — изменить, Q — быстрый режим,
        R — режим чтения, Ctrl+0 — показать всё.
      </div>
    </Modal>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row toggle">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
    </label>
  );
}
