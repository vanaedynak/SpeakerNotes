import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Modal, Seg } from './common';
import { looksLikeMarkup, parseMarkup } from '../markup/parse';
import { AI_PROMPT } from '../markup/prompt';
import { copyText, pickFile, readClipboardText } from '../utils/misc';
import { importBackup, importMarkup, plainTextToMarkup } from '../actions';

export function ImportDialog() {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<'here' | 'new'>('here');
  const [showPrompt, setShowPrompt] = useState(false);
  const st = useApp.getState();
  const close = () => st.set({ panel: null });

  const cleaned = useMemo(() => {
    // нейросети часто оборачивают ответ в ```text … ```
    let t = text.replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n```\s*$/i, '');
    if (!looksLikeMarkup(t)) t = plainTextToMarkup(t);
    return t;
  }, [text]);
  const isMarkup = looksLikeMarkup(cleaned);
  const preview = useMemo(() => (cleaned.trim() ? parseMarkup(cleaned) : null), [cleaned]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of preview?.elements ?? []) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [preview]);

  const paste = async () => {
    const t = await readClipboardText();
    if (t) setText(t);
    else st.showToast('Нажмите в поле и выберите «Вставить»');
  };

  const openFile = async () => {
    const f = await pickFile('.txt,.md,.json,text/plain,application/json');
    if (!f) return;
    const t = await f.text();
    if (f.name.endsWith('.json')) {
      try {
        await importBackup(t, 'merge');
        st.showToast('Резервная копия добавлена');
        close();
      } catch (e) {
        st.showToast(String((e as Error).message));
      }
      return;
    }
    setText(t);
  };

  const run = () => {
    const r = importMarkup(cleaned, { target });
    if (!r.elements.length) {
      st.showToast('Нечего вставлять');
      return;
    }
    st.showToast(`Добавлено элементов: ${r.elements.length}`);
    close();
  };

  const names: Record<string, string> = {
    frame: 'разделов', note: 'фраз', heading: 'заголовков', callout: 'плашек', table: 'таблиц', dialog: 'диалогов', checklist: 'списков', image: 'картинок',
  };

  return (
    <Modal
      title="📥 Вставить текст"
      onClose={close}
      wide
      footer={
        <>
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" disabled={!preview?.elements.length} onClick={run}>
            Добавить на доску
          </button>
        </>
      }
    >
      <div className="import-ai">
        <div>
          <b>🤖 Оформить через нейросеть</b>
          <div className="muted">
            Скопируйте промпт, вставьте в ChatGPT / Claude / Gemini и допишите ваш текст (или прикрепите файл). Ответ нейросети вставьте сюда — всё
            разложится по разделам, с заголовками, таблицами и стрелками.
          </div>
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              const ok = await copyText(AI_PROMPT);
              st.showToast(ok ? '✓ Промпт скопирован' : 'Не удалось скопировать');
            }}
          >
            ⧉ Скопировать промпт
          </button>
          <button className="btn" onClick={() => setShowPrompt(!showPrompt)}>
            {showPrompt ? 'Скрыть' : 'Посмотреть'}
          </button>
        </div>
      </div>
      {showPrompt && <pre className="prompt-view">{AI_PROMPT}</pre>}

      <div className="row space">
        <Seg value={target} onChange={setTarget} options={[['here', 'На эту доску'], ['new', 'Новая доска']]} />
        <div className="row">
          <button className="btn" onClick={paste}>
            📋 Вставить из буфера
          </button>
          <button className="btn" onClick={openFile}>
            📂 Файл
          </button>
        </div>
      </div>
      <textarea
        className="input import-text"
        placeholder={'Вставьте сюда ответ нейросети или свои заметки.\n\nОбычный текст тоже подойдёт: каждый абзац (через пустую строку) станет отдельной карточкой, строки с # — заголовками, строки с табуляцией или | — таблицами.'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {preview && (
        <div className="import-preview">
          <span className={'badge ' + (isMarkup ? 'ok' : '')}>{isMarkup ? '✓ Разметка SpeakerNotes' : 'Обычный текст'}</span>
          {preview.boardName && target === 'new' && <span>Доска: «{preview.boardName}»</span>}
          {Object.entries(counts).map(([k, n]) => (
            <span key={k}>
              {n} {names[k] ?? k}
            </span>
          ))}
          {preview.links.length > 0 && <span>{preview.links.length} связей</span>}
          {preview.warnings.map((w, i) => (
            <div key={i} className="warn-line">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
