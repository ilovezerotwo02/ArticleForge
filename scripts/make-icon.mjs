import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findBrowser } from '../src/config.js';

fs.mkdirSync('build', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 600, height: 600, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.setContent('<html><body style="margin:0;background:transparent"></body></html>', { waitUntil: 'load' });

/** 在 canvas 上直接绘制图标，避免依赖 PNG 解码 */
async function draw(size) {
  return page.evaluate(async (size) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const r = size * 0.23;

    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, r);
    ctx.clip();

    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#6366f1');
    g.addColorStop(0.55, '#7c3aed');
    g.addColorStop(1, '#4f46e5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const hl = ctx.createRadialGradient(size * 0.3, size * 0.2, 0, size * 0.3, size * 0.2, size * 0.75);
    hl.addColorStop(0, 'rgba(255,255,255,.32)');
    hl.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, size, size);

    // AF 字母
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${size * 0.44}px "Segoe UI", "Arial Black", sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-size * 0.02}px`;
    ctx.fillText('AF', size * 0.5, size * 0.52);

    // 底部装饰条
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.roundRect(size * 0.19, size * 0.775, size * 0.24, size * 0.018, size * 0.009);
    ctx.fill();

    // 青色小点
    ctx.save();
    ctx.shadowColor = 'rgba(165,243,252,.9)';
    ctx.shadowBlur = size * 0.06;
    ctx.fillStyle = '#a5f3fc';
    ctx.beginPath();
    ctx.arc(size * 0.81, size * 0.785, size * 0.026, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const data = ctx.getImageData(0, 0, size, size).data;
    return { pixels: Array.from(data), png: c.toDataURL('image/png') };
  }, size);
}

const large = await draw(512);
fs.writeFileSync('build/icon.png', Buffer.from(large.png.split(',')[1], 'base64'));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes) {
  const r = size === 512 ? large : await draw(size);
  images.push({ size, pixels: r.pixels });
}
await browser.close();

/** 生成标准 BMP(DIB) ICO：NSIS / rcedit / Windows 全部认；PNG 压缩条目会被 NSIS 拒绝 */
function bmpEntry({ size, pixels }) {
  const bgra = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // 自下而上
    for (let x = 0; x < size; x++) {
      const i = srcRow + x * 4;
      const o = (y * size + x) * 4;
      bgra[o] = pixels[i + 2];
      bgra[o + 1] = pixels[i + 1];
      bgra[o + 2] = pixels[i];
      bgra[o + 3] = pixels[i + 3];
    }
  }
  const maskRow = Math.ceil(size / 8 / 4) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  return Buffer.concat([header, bgra, mask]);
}

const entries = images.map((im) => ({ size: im.size, data: bmpEntry(im) }));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);

let offset = header.length;
const chunks = [header];
entries.forEach((e, i) => {
  const p = 6 + i * 16;
  header.writeUInt8(e.size === 256 ? 0 : e.size, p);
  header.writeUInt8(e.size === 256 ? 0 : e.size, p + 1);
  header.writeUInt8(0, p + 2);
  header.writeUInt8(0, p + 3);
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(e.data.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += e.data.length;
  chunks.push(e.data);
});

fs.writeFileSync('build/icon.ico', Buffer.concat(chunks));
console.log('icon.png', fs.statSync('build/icon.png').size, '| icon.ico', fs.statSync('build/icon.ico').size);
