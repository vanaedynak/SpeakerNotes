import { create } from 'zustand';
import type { Board, El, Link, Settings, Tool, Viewport } from './types';
import { DEFAULT_SETTINGS } from './types';
import { loadState, saveStateDebounced, type PersistedState } from './db';
import { uid } from './utils/misc';
import { makeWelcomeBoard } from './welcome';

type Snap = { elements: Record<string, El>; links: Link[] };

export type Panel = null | 'search' | 'settings' | 'import' | 'help' | 'boards';

interface AppState {
  ready: boolean;
  boards: Board[];
  currentBoardId: string;
  settings: Settings;
  recent: { boardId: string; elId: string }[];

  selection: string[];
  editingId: string | null;
  modalEditId: string | null;
  cropId: string | null;
  tool: Tool;
  readMode: boolean;
  linkFrom: string | null;
  panel: Panel;
  quickMode: boolean;
  sidebarOpen: boolean;
  toast: { text: string; id: number } | null;
  flashId: string | null;
  selectedLink: string | null;
  readerId: string | null;
  boxRect: { x: number; y: number; w: number; h: number } | null;

  past: Record<string, Snap[]>;
  future: Record<string, Snap[]>;

  init: () => Promise<void>;
  board: () => Board;
  set: (p: Partial<AppState>) => void;
  showToast: (text: string) => void;

  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  addElements: (els: El[], links?: Link[], select?: boolean) => void;
  patchEl: (id: string, patch: Partial<El>, history?: boolean) => void;
  patchMany: (patches: Record<string, Partial<El>>, history?: boolean) => void;
  deleteEls: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  addLink: (from: string, to: string) => void;
  patchLink: (id: string, patch: Partial<Link>) => void;
  deleteLink: (id: string) => void;

  addBoard: (name: string, icon?: string) => string;
  renameBoard: (id: string, name: string, icon?: string) => void;
  deleteBoard: (id: string) => void;
  switchBoard: (id: string) => void;
  replaceAll: (boards: Board[]) => void;

  setSettings: (p: Partial<Settings>) => void;
  pushRecent: (boardId: string, elId: string) => void;
  maxZ: () => number;
}

const replaceBoard = (boards: Board[], b: Board) => boards.map((x) => (x.id === b.id ? b : x));

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  boards: [],
  currentBoardId: '',
  settings: DEFAULT_SETTINGS,
  recent: [],

  selection: [],
  editingId: null,
  modalEditId: null,
  cropId: null,
  tool: 'select',
  readMode: false,
  linkFrom: null,
  panel: null,
  quickMode: false,
  sidebarOpen: false,
  toast: null,
  flashId: null,
  selectedLink: null,
  readerId: null,
  boxRect: null,

  past: {},
  future: {},

  init: async () => {
    const s = await loadState();
    if (s && s.boards?.length) {
      const boards = s.boards;
      const cur = s.boards.some((b) => b.id === s.currentBoardId) ? s.currentBoardId : s.boards[0].id;
      set({
        boards,
        currentBoardId: cur,
        settings: { ...DEFAULT_SETTINGS, ...s.settings },
        recent: s.recent ?? [],
        ready: true,
      });
    } else {
      const b = makeWelcomeBoard();
      set({ boards: [b], currentBoardId: b.id, ready: true });
    }
    useView.getState().setView(get().board().viewport);
  },

  board: () => {
    const { boards, currentBoardId } = get();
    return boards.find((b) => b.id === currentBoardId) ?? boards[0];
  },

  set: (p) => set(p),

  showToast: (text) => set({ toast: { text, id: Date.now() } }),

  snapshot: () => {
    const b = get().board();
    const past = { ...get().past };
    const arr = [...(past[b.id] ?? []), { elements: b.elements, links: b.links }];
    if (arr.length > 150) arr.shift();
    past[b.id] = arr;
    set({ past, future: { ...get().future, [b.id]: [] } });
  },

  undo: () => {
    const b = get().board();
    const arr = get().past[b.id] ?? [];
    if (!arr.length) return;
    const prev = arr[arr.length - 1];
    set({
      past: { ...get().past, [b.id]: arr.slice(0, -1) },
      future: { ...get().future, [b.id]: [...(get().future[b.id] ?? []), { elements: b.elements, links: b.links }] },
      boards: replaceBoard(get().boards, { ...b, ...prev }),
      selection: [],
      editingId: null,
    });
  },

  redo: () => {
    const b = get().board();
    const arr = get().future[b.id] ?? [];
    if (!arr.length) return;
    const next = arr[arr.length - 1];
    set({
      future: { ...get().future, [b.id]: arr.slice(0, -1) },
      past: { ...get().past, [b.id]: [...(get().past[b.id] ?? []), { elements: b.elements, links: b.links }] },
      boards: replaceBoard(get().boards, { ...b, ...next }),
      selection: [],
    });
  },

  addElements: (els, links = [], select = true) => {
    get().snapshot();
    const b = get().board();
    const elements = { ...b.elements };
    for (const e of els) elements[e.id] = e;
    set({
      boards: replaceBoard(get().boards, { ...b, elements, links: [...b.links, ...links] }),
      selection: select ? els.filter((e) => e.type !== 'frame' || els.length === 1).map((e) => e.id) : get().selection,
    });
  },

  patchEl: (id, patch, history = true) => {
    const b = get().board();
    const el = b.elements[id];
    if (!el) return;
    if (history) get().snapshot();
    const elements = { ...b.elements, [id]: { ...el, ...patch, updatedAt: Date.now() } as El };
    set({ boards: replaceBoard(get().boards, { ...b, elements }) });
  },

  patchMany: (patches, history = true) => {
    const b = get().board();
    if (history) get().snapshot();
    const elements = { ...b.elements };
    for (const [id, p] of Object.entries(patches)) {
      if (elements[id]) elements[id] = { ...elements[id], ...p } as El;
    }
    set({ boards: replaceBoard(get().boards, { ...get().board(), elements }) });
  },

  deleteEls: (ids) => {
    if (!ids.length) return;
    get().snapshot();
    const b = get().board();
    const elements = { ...b.elements };
    const del = new Set(ids);
    for (const id of ids) delete elements[id];
    const links = b.links.filter((l) => !del.has(l.from) && !del.has(l.to));
    set({ boards: replaceBoard(get().boards, { ...b, elements, links }), selection: [], editingId: null });
  },

  maxZ: () => {
    let m = 0;
    for (const e of Object.values(get().board().elements)) m = Math.max(m, e.z);
    return m;
  },

  bringToFront: (ids) => {
    let z = get().maxZ();
    const p: Record<string, Partial<El>> = {};
    for (const id of ids) p[id] = { z: ++z };
    get().patchMany(p);
  },

  sendToBack: (ids) => {
    let m = Infinity;
    for (const e of Object.values(get().board().elements)) m = Math.min(m, e.z);
    const p: Record<string, Partial<El>> = {};
    ids.forEach((id, i) => (p[id] = { z: m - ids.length + i }));
    get().patchMany(p);
  },

  addLink: (from, to) => {
    if (from === to) return;
    const b = get().board();
    if (b.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return;
    get().snapshot();
    const link: Link = { id: uid(), from, to, style: 'arrow', color: 'none' };
    set({ boards: replaceBoard(get().boards, { ...b, links: [...b.links, link] }) });
  },

  patchLink: (id, patch) => {
    get().snapshot();
    const b = get().board();
    set({ boards: replaceBoard(get().boards, { ...b, links: b.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }) });
  },

  deleteLink: (id) => {
    get().snapshot();
    const b = get().board();
    set({ boards: replaceBoard(get().boards, { ...b, links: b.links.filter((l) => l.id !== id) }) });
  },

  addBoard: (name, icon = '📋') => {
    const b: Board = { id: uid(), name, icon, elements: {}, links: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: Date.now() };
    saveViewport();
    set({ boards: [...get().boards, b], currentBoardId: b.id, selection: [] });
    useView.getState().setView(b.viewport);
    return b.id;
  },

  renameBoard: (id, name, icon) => {
    set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name, icon: icon ?? b.icon } : b)) });
  },

  deleteBoard: (id) => {
    const boards = get().boards.filter((b) => b.id !== id);
    if (!boards.length) boards.push(makeWelcomeBoard());
    const cur = get().currentBoardId === id ? boards[0].id : get().currentBoardId;
    set({ boards, currentBoardId: cur, selection: [] });
    useView.getState().setView(get().board().viewport);
  },

  switchBoard: (id) => {
    if (id === get().currentBoardId) return;
    saveViewport();
    set({ currentBoardId: id, selection: [], editingId: null, linkFrom: null });
    useView.getState().setView(get().board().viewport);
  },

  replaceAll: (boards) => {
    set({ boards, currentBoardId: boards[0].id, selection: [], past: {}, future: {} });
    useView.getState().setView(boards[0].viewport);
  },

  setSettings: (p) => set({ settings: { ...get().settings, ...p } }),

  pushRecent: (boardId, elId) => {
    const r = [{ boardId, elId }, ...get().recent.filter((x) => x.elId !== elId)].slice(0, 30);
    set({ recent: r });
  },
}));

// ---------------- вид (камера) — отдельный стор, чтобы не перерисовывать всё приложение ----------------
interface ViewState extends Viewport {
  setView: (v: Viewport) => void;
  animating: boolean;
}

export const useView = create<ViewState>((set) => ({
  x: 0,
  y: 0,
  zoom: 1,
  animating: false,
  setView: (v) => set({ x: v.x, y: v.y, zoom: v.zoom }),
}));

function saveViewport() {
  const { x, y, zoom } = useView.getState();
  const st = useApp.getState();
  const b = st.board();
  if (!b) return;
  useApp.setState({ boards: replaceBoard(st.boards, { ...b, viewport: { x, y, zoom } }) });
}

// ---------------- измеренные размеры элементов ----------------
interface SizeState {
  sizes: Record<string, { w: number; h: number }>;
  setSize: (id: string, w: number, h: number) => void;
}
export const useSizes = create<SizeState>((set, get) => ({
  sizes: {},
  setSize: (id, w, h) => {
    const s = get().sizes[id];
    if (s && Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5) return;
    set({ sizes: { ...get().sizes, [id]: { w, h } } });
  },
}));

export function elRect(el: El) {
  const s = useSizes.getState().sizes[el.id];
  return { x: el.x, y: el.y, w: el.w, h: el.h ?? s?.h ?? 60 };
}

// ---------------- автосохранение ----------------
let lastBoards: Board[] | null = null;
let lastSettings: Settings | null = null;
let lastRecent: unknown = null;
useApp.subscribe((s) => {
  if (!s.ready) return;
  if (s.boards === lastBoards && s.settings === lastSettings && s.recent === lastRecent) return;
  lastBoards = s.boards;
  lastSettings = s.settings;
  lastRecent = s.recent;
  persist();
});

let viewTimer: ReturnType<typeof setTimeout> | null = null;
useView.subscribe(() => {
  if (viewTimer) clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    saveViewport();
  }, 800);
});

function persist() {
  const s = useApp.getState();
  const data: PersistedState = {
    version: 1,
    boards: s.boards,
    currentBoardId: s.currentBoardId,
    settings: s.settings,
    recent: s.recent,
  };
  saveStateDebounced(data);
}
