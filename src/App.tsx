import { useEffect } from 'react';
import { useApp } from './store';
import { Canvas, startEdit } from './canvas/Canvas';
import { SelectionToolbar } from './canvas/SelectionToolbar';
import { TopBar, Dock, ZoomControls } from './ui/Bars';
import { Sidebar } from './ui/Sidebar';
import { SearchPalette } from './ui/SearchPalette';
import { QuickMode, Reader } from './ui/QuickMode';
import { SettingsDialog } from './ui/Settings';
import { ImportDialog } from './ui/ImportDialog';
import { ModalEditor } from './ui/ModalEditor';
import { CropDialog } from './ui/CropDialog';
import { AskDialog, Toast } from './ui/common';
import { addImageFromDataUrl, copyElement, duplicateSelection, fitAll, importMarkup, makeElement, plainTextToMarkup, scheduleRelayout, viewCenterWorld } from './actions';
import { fileToDataURL } from './utils/misc';
import { looksLikeMarkup } from './markup/parse';
import { welcomeGroups } from './welcome';
import type { El } from './types';

const FONTS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  hyperlegible: '"Atkinson Hyperlegible", -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export default function App() {
  const ready = useApp((s) => s.ready);
  const settings = useApp((s) => s.settings);
  const panel = useApp((s) => s.panel);
  const quickMode = useApp((s) => s.quickMode);

  useEffect(() => {
    void useApp
      .getState()
      .init()
      .then(() => {
        // приветственная доска: уточняем раскладку после измерения карточек
        if (welcomeGroups) scheduleRelayout(welcomeGroups, 80, 80, 'first');
      });
  }, []);

  // ---------- применяем настройки к документу ----------
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.style.setProperty('--text-scale', String(settings.textScale));
    r.style.setProperty('--ui-scale', String(settings.uiScale));
    r.style.setProperty('--lh', String(settings.lineHeight));
    r.style.setProperty('--ls', settings.letterSpacing + 'em');
    r.style.setProperty('--font', FONTS[settings.font]);
    r.classList.toggle('bold-text', settings.boldText);
    r.classList.toggle('no-big-labels', !settings.bigLabels);
    r.classList.toggle('reduce-motion', settings.reduceMotion);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', getComputedStyle(r).getPropertyValue('--bg').trim() || '#000');
  }, [settings]);

  // ---------- клавиатура ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const t = e.target as HTMLElement;
      const typing = t.matches('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        st.set({ panel: st.panel === 'search' ? null : 'search' });
        return;
      }
      if (typing || st.panel || st.modalEditId || st.cropId) return;
      if (st.quickMode) {
        if (e.key === 'Escape') st.set({ quickMode: false });
        return;
      }
      if (st.readerId) {
        if (e.key === 'Escape') st.set({ readerId: null });
        return;
      }
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === '0') {
        e.preventDefault();
        fitAll();
      } else if (mod && k === 'a') {
        e.preventDefault();
        st.set({ selection: Object.keys(st.board().elements) });
      } else if (mod && k === 'c' && st.selection.length === 1 && !window.getSelection()?.toString()) {
        const el = st.board().elements[st.selection[0]];
        if (el) {
          e.preventDefault();
          void copyElement(el);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection.length && !st.readMode) {
        e.preventDefault();
        st.deleteEls(st.selection);
      } else if (e.key === 'Delete' && st.selectedLink) {
        st.deleteLink(st.selectedLink);
        st.set({ selectedLink: null });
      } else if (e.key === 'Enter' && st.selection.length === 1 && !st.readMode) {
        e.preventDefault();
        startEdit(st.selection[0]);
      } else if (e.key === 'Escape') {
        st.set({ selection: [], linkFrom: null, selectedLink: null, sidebarOpen: false, tool: 'select' });
      } else if (!mod && k === 'q') st.set({ quickMode: true });
      else if (!mod && k === 'r') st.set({ readMode: !st.readMode, selection: [] });
      else if (!mod && k === 'n' && !st.readMode) {
        const c = viewCenterWorld();
        const el = makeElement('note', Math.round(c.x - 180), Math.round(c.y - 30));
        st.addElements([el]);
        st.set({ editingId: el.id });
      } else if (!mod && k === '/') {
        e.preventDefault();
        st.set({ panel: 'search' });
      } else if (!mod && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && st.selection.length && !st.readMode) {
        e.preventDefault();
        const d = e.shiftKey ? 32 : 4;
        const p: Record<string, Partial<El>> = {};
        for (const id of st.selection) {
          const el = st.board().elements[id];
          if (!el) continue;
          p[id] = { x: el.x + (k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0), y: el.y + (k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0) };
        }
        st.patchMany(p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- вставка (Ctrl+V / «Вставить» на iPad) ----------
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches?.('input, textarea')) return;
      const st = useApp.getState();
      if (st.panel || st.modalEditId || st.cropId || st.quickMode || st.readMode) return;
      const items = e.clipboardData?.items;
      if (items) {
        for (const it of items) {
          if (it.type.startsWith('image/')) {
            e.preventDefault();
            const f = it.getAsFile();
            if (f) await addImageFromDataUrl(await fileToDataURL(f));
            return;
          }
        }
      }
      const text = e.clipboardData?.getData('text/plain');
      if (!text?.trim()) return;
      e.preventDefault();
      if (looksLikeMarkup(text) || text.trim().split(/\n\s*\n/).length > 1) {
        const r = importMarkup(looksLikeMarkup(text) ? text : plainTextToMarkup(text), { target: 'here' });
        st.showToast(`Вставлено элементов: ${r.elements.length}`);
      } else {
        const c = viewCenterWorld();
        const el = { ...makeElement('note', Math.round(c.x - 180), Math.round(c.y - 30)), text: text.trim() } as El;
        st.addElements([el]);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // ---------- перетаскивание файлов-картинок на доску ----------
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      for (const f of files) await addImageFromDataUrl(await fileToDataURL(f));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!ready) return <div className="loading">SpeakerNotes…</div>;

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Sidebar />
        <div className="stage">
          <Canvas />
          <SelectionToolbar />
          <ZoomControls />
          <Dock />
        </div>
      </div>
      {quickMode && <QuickMode />}
      {panel === 'search' && <SearchPalette />}
      {panel === 'settings' && <SettingsDialog />}
      {panel === 'import' && <ImportDialog />}
      <ModalEditor />
      <CropDialog />
      <Reader />
      <AskDialog />
      <Toast />
    </div>
  );
}
