// Пишет AI_PROMPT.md из src/markup/prompt.ts (node scripts/gen-prompt.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('src/markup/prompt.ts', 'utf-8');
const body = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`')).replace(/\`/g, '`');
writeFileSync(
  'AI_PROMPT.md',
  '# Промпт для нейросети\n\nСкопируйте всё, что ниже линии, в ChatGPT / Claude / Gemini, допишите свой текст — и вставьте ответ в SpeakerNotes (кнопка 📥 «Вставить»).\nТот же промпт копируется кнопкой «Скопировать промпт» прямо в приложении.\n\n---\n\n````text\n' + body + '\n````\n',
);
console.log('AI_PROMPT.md written');
