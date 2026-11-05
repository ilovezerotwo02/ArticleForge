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

/** 在 canvas 上直接绘制图标，避免依赖 PNG 解码
 * 设计：墨黑底板 + 一页暖白纸（标题与正文行）+ 一道朱红书签 —— 「排好版、归了档」
 * 全部纯色，不用渐变、辉光；小尺寸自动简化线条，16px 也认得出
 */
async function draw(size) {
  return page.evaluate(async (size) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const S = size;
    const u = S / 100; // 统一按 100 网格设计，和应用内 SVG 标完全一致
    const small = S <= 32;

    const INK = '#1c1b19';
    const PAPER = '#f4f1ea';
    const RULE = '#cfc9bd';
    const SEAL = '#b42318';

    // 底板
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(0, 0, S, S, 22 * u);
    ctx.fill();

    // 纸页
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.roundRect(25 * u, 19 * u, 50 * u, 62 * u, 3 * u);
    ctx.fill();

    const bar = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x * u, y * u, w * u, h * u, Math.min(h * u / 2, 1.5 * u));
      ctx.fill();
    };

    if (small) {
      // 小图标：一条标题 + 两行正文，线更粗
      bar(32, 31, 20, 7, INK);
      bar(32, 48, 36, 6, RULE);
      bar(32, 62, 28, 6, RULE);
    } else {
      bar(32, 30, 20, 4.5, INK);
      bar(32, 42, 25, 3, RULE);
      bar(32, 51, 36, 3, RULE);
      bar(32, 60, 30, 3, RULE);
      bar(32, 69, 22, 3, RULE);
    }

    // 朱红书签：从纸页上沿垂下，底部燕尾
    ctx.fillStyle = SEAL;
    ctx.beginPath();
    const bx = small ? 57 : 59;
    const bw = small ? 11 : 8.5;
    const bh = small ? 26 : 22;
    ctx.moveTo(bx * u, 19 * u);
    ctx.lineTo((bx + bw) * u, 19 * u);
    ctx.lineTo((bx + bw) * u, (19 + bh) * u);
    ctx.lineTo((bx + bw / 2) * u, (19 + bh - bw * 0.5) * u);
    ctx.lineTo(bx * u, (19 + bh) * u);
    ctx.closePath();
    ctx.fill();

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
