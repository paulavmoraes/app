// Renders the app icons into public/icons from one SVG. Run: node scripts/icons.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

// A checkmark in a rounded square. `pad` shrinks the mark for maskable icons (safe zone).
const svg = (size, { rounded, scale, mono }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${mono ? "" : `<rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="#0f766e"/>`}
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
    <path d="M27 52 L43 68 L74 34" fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const icons = [
  ["icon-192.png", 192, { rounded: true, scale: 1 }],
  ["icon-512.png", 512, { rounded: true, scale: 1 }],
  ["maskable-512.png", 512, { rounded: false, scale: 0.7 }],
  ["apple-touch-icon.png", 180, { rounded: false, scale: 0.85 }],
  ["badge-96.png", 96, { mono: true, scale: 1.1 }],
];
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
for (const [name, size, opts] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, opts)}</body>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log("icons written");
