// Генерирует иконки приложения из SVG (node scripts/make-icons.mjs)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const svg = (bg = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${bg ? '<rect width="1024" height="1024" fill="#000"/>' : ''}
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fb0ff"/><stop offset="1" stop-color="#2a6fe0"/></linearGradient></defs>
  <rect x="150" y="190" width="560" height="400" rx="70" fill="url(#g)"/>
  <path d="M260 580 L230 720 L380 590 Z" fill="#2a6fe0"/>
  <rect x="220" y="285" width="330" height="44" rx="22" fill="#fff"/>
  <rect x="220" y="370" width="420" height="44" rx="22" fill="#fff" opacity=".85"/>
  <rect x="220" y="455" width="250" height="44" rx="22" fill="#fff" opacity=".7"/>
  <rect x="520" y="470" width="360" height="300" rx="60" fill="#ffd83a"/>
  <path d="M800 760 L840 860 L720 768 Z" fill="#ffd83a"/>
  <rect x="580" y="550" width="230" height="38" rx="19" fill="#000"/>
  <rect x="580" y="625" width="160" height="38" rx="19" fill="#000" opacity=".75"/>
</svg>`;

mkdirSync('resources', { recursive: true });
const icon = Buffer.from(svg());
await sharp(icon).resize(1024).png().toFile('resources/icon.png');
await sharp(icon).resize(1024).png().toFile('resources/icon-only.png');
await sharp(Buffer.from(svg(false))).resize(1024).png().toFile('resources/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#000000' } }).png().toFile('resources/icon-background.png');
await sharp(icon).resize(512).png().toFile('public/icon-512.png');
await sharp(icon).resize(192).png().toFile('public/icon-192.png');
await sharp(icon).resize(180).png().toFile('public/apple-touch-icon.png');
const small = await sharp(icon).resize(600).png().toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#000000' } })
    .composite([{ input: small, gravity: 'center' }])
    .png()
    .toFile('resources/' + name);
}
console.log('icons done');
