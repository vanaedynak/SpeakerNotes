import type { Board } from './types';
import { parseMarkup, offsetResult } from './markup/parse';
import { uid } from './utils/misc';
import { splitIcon } from './utils/text';

export const WELCOME = `@frame 👋 Как пользоваться | color: blue
# Добро пожаловать в SpeakerNotes
Это бесконечная доска для ваших фраз. Двигайте её пальцем, масштабируйте щипком (или колёсиком с Ctrl).
@tip **Быстрый режим** (кнопка ⚡ сверху) — список тем и фраз крупным текстом. Тап по фразе — она скопирована. Это для звонков.
@tip **Поиск** (🔍 или Ctrl+K) ищет по всем доскам, даже если набрали в другой раскладке: «ghbdtn» найдёт «привет».
- Двойной тап по карточке — редактировать
- Двойной тап по пустому месту — новая фраза; нижняя панель — другие элементы
- Раздел перетаскивается за заголовок, вместе со всем содержимым
- Кнопка 📖 «Чтение» блокирует случайные перемещения: тап по фразе = копирование
@checklist Что можно добавлять
[ ] Фразы с **жирным**, *курсивом*, ==выделением== и {red: цветом}
[ ] Заголовки и разделы (рамки)
[ ] Таблицы
[ ] Диалоги «клиент — я»
[ ] Важные плашки
[ ] Картинки и стикеры из скриншотов
[ ] Стрелки-связи и ссылки вида [[Примеры фраз]]
@end
@endframe

@frame 💬 Примеры фраз | color: green
## Приветствие
Добрый день! Меня зовут [имя], компания Киевстар. Чем могу помочь? {key: hello}
Спасибо, что обратились! Сейчас всё проверю. {key: check}
## Если клиент недоволен
Я понимаю ваше недовольство. Давайте вместе разберёмся, что произошло. {key: calm}
!! Никогда не перебивайте клиента и не спорьте с ним.
@dialog
Клиент: Почему у меня списали деньги?!
Я: Понимаю, давайте проверим. Подскажите, пожалуйста, номер телефона.
Клиент: 067...
Я: Спасибо! Вижу списание за услугу «...». Сейчас объясню.
@end
@endframe

@frame 📊 Таблица для примера | color: purple
@table
| Тариф | Цена | Интернет |
| --- | --- | --- |
| Тариф A | 200 грн | 20 ГБ |
| Тариф B | 300 грн | Безлимит |
@end
@image Сюда можно вставить скриншот — двойной тап
@endframe

@link hello -> check "клиент назвал вопрос"
@link check -> calm "если злится" | style: dashed | color: red
`;

export function boardFromMarkup(text: string, name: string, icon = '📋'): Board {
  const r = parseMarkup(text);
  offsetResult(r, 80, 80);
  const elements: Board['elements'] = {};
  for (const e of r.elements) elements[e.id] = e;
  let nm = name;
  let ic = icon;
  if (r.boardName) {
    const sp = splitIcon(r.boardName);
    nm = sp.name;
    ic = sp.icon ?? icon;
  }
  return {
    id: uid(),
    name: nm,
    icon: ic,
    elements,
    links: r.links,
    viewport: { x: 40, y: 40, zoom: 0.8 },
    createdAt: Date.now(),
    pendingLayout: { groups: r.groups, ox: 80, oy: 80 },
  };
}

export const makeWelcomeBoard = () => boardFromMarkup(WELCOME, 'Справка', '❓');
