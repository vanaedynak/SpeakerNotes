export type ColorKey = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray';

export const COLOR_KEYS: ColorKey[] = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

export type ElType = 'note' | 'heading' | 'frame' | 'table' | 'image' | 'callout' | 'dialog' | 'checklist';

export type CalloutKind = 'info' | 'tip' | 'warn' | 'danger' | 'success';

interface Base {
  id: string;
  type: ElType;
  x: number;
  y: number;
  w: number;
  /** высота: для frame/image задаётся явно, для остальных — по содержимому */
  h?: number;
  z: number;
  color: ColorKey;
  tags?: string[];
  fav?: boolean;
  /** короткий ключ для ссылок из разметки (@link a -> b) */
  key?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NoteEl extends Base { type: 'note'; text: string }
export interface HeadingEl extends Base { type: 'heading'; text: string; level: 1 | 2 | 3 }
export interface FrameEl extends Base { type: 'frame'; title: string; h: number; collapsed?: boolean }
export interface TableEl extends Base { type: 'table'; rows: string[][]; header: boolean }
export interface ImageEl extends Base { type: 'image'; asset: string; h: number; sticker?: boolean; caption?: string }
export interface CalloutEl extends Base { type: 'callout'; kind: CalloutKind; text: string }
export interface DialogLine { who: 'client' | 'me'; text: string }
export interface DialogEl extends Base { type: 'dialog'; lines: DialogLine[] }
export interface CheckItem { text: string; done: boolean }
export interface ChecklistEl extends Base { type: 'checklist'; title?: string; items: CheckItem[] }

export type El = NoteEl | HeadingEl | FrameEl | TableEl | ImageEl | CalloutEl | DialogEl | ChecklistEl;

export type LinkStyle = 'arrow' | 'line' | 'dashed' | 'both';

export interface Link {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: LinkStyle;
  color: ColorKey;
}

export interface Viewport { x: number; y: number; zoom: number }

export interface Board {
  id: string;
  name: string;
  icon: string;
  elements: Record<string, El>;
  links: Link[];
  viewport: Viewport;
  createdAt: number;
}

export type ThemeKey = 'amoled' | 'dark' | 'contrast' | 'light' | 'sepia';

export interface Settings {
  theme: ThemeKey;
  /** множитель размера текста на карточках */
  textScale: number;
  /** множитель размера интерфейса */
  uiScale: number;
  font: 'system' | 'hyperlegible' | 'serif' | 'mono';
  boldText: boolean;
  lineHeight: number;
  letterSpacing: number;
  showGrid: boolean;
  snap: boolean;
  reduceMotion: boolean;
  /** показывать крупные названия разделов при отдалении */
  bigLabels: boolean;
  /** что делать по тапу на фразу в режиме чтения */
  tapAction: 'copy' | 'open';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'amoled',
  textScale: 1.15,
  uiScale: 1,
  font: 'hyperlegible',
  boldText: false,
  lineHeight: 1.45,
  letterSpacing: 0,
  showGrid: true,
  snap: false,
  reduceMotion: false,
  bigLabels: true,
  tapAction: 'copy',
};

export type Tool = 'select' | 'hand' | 'box' | 'link';
