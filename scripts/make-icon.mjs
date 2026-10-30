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
 * 设计：深靛紫渐变底 + 微倾斜的文章页（折角 + 文字行）+ 琥珀色「锻造火花」
 */
async function draw(size) {
  return page.evaluate(async (size) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const S = size;
    const r = S * 0.225;

    // 底板：靛蓝 → 紫 → 品红对角渐变
    ctx.beginPath();
    ctx.roundRect(0, 0, S, S, r);
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#4338ca');
    g.addColorStop(0.5, '#6d28d9');
    g.addColorStop(1, '#a21caf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // 左上柔光 + 右下暗角，让底色有层次
    const hl = ctx.createRadialGradient(S * 0.28, S * 0.22, 0, S * 0.28, S * 0.22, S * 0.85);
    hl.addColorStop(0, 'rgba(255,255,255,.30)');
    hl.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, S, S);
    const vg = ctx.createRadialGradient(S * 0.74, S * 0.84, S * 0.1, S * 0.74, S * 0.84, S * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,.20)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, S, S);

    // 文章页：白色圆角矩形，微倾斜 -6°，右上折角
    ctx.save();
    ctx.translate(S * 0.48, S * 0.52);
    ctx.rotate(-0.105);
    const pw = S * 0.52;
    const ph = S * 0.63;
    const x0 = -pw / 2;
    const y0 = -ph / 2;
    const fold = S * 0.10;
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = S * 0.06;
    ctx.shadowOffsetY = S * 0.02;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + pw - fold, y0);
    ctx.lineTo(x0 + pw, y0 + fold);
    ctx.lineTo(x0 + pw, y0 + ph);
    ctx.lineTo(x0, y0 + ph);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // 折角
    ctx.fillStyle = '#d7ddf1';
    ctx.beginPath();
    ctx.moveTo(x0 + pw - fold, y0);
    ctx.lineTo(x0 + pw, y0 + fold);
    ctx.lineTo(x0 + pw - fold, y0 + fold);
    ctx.closePath();
    ctx.fill();
    // 文字行：标题粗条 + 两行正文 + 一行高亮代码
    ctx.fillStyle = '#7c86ad';
    ctx.beginPath();
    ctx.roundRect(x0 + pw * 0.16, y0 + ph * 0.20, pw * 0.52, S * 0.036, S * 0.018);
    ctx.fill();
    ctx.fillStyle = '#c9d0e6';
    ctx.beginPath();
    ctx.roundRect(x0 + pw * 0.16, y0 + ph * 0.38, pw * 0.68, S * 0.024, S * 0.012);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x0 + pw * 0.16, y0 + ph * 0.52, pw * 0.58, S * 0.024, S * 0.012);
    ctx.fill();
    ctx.fillStyle = '#818cf8';
    ctx.beginPath();
    ctx.roundRect(x0 + pw * 0.16, y0 + ph * 0.70, pw * 0.40, S * 0.024, S * 0.012);
    ctx.fill();
    ctx.restore();

    // 锻造火花：四角星（琥珀渐变 + 辉光）+ 一粒小火星
    ctx.save();
    ctx.translate(S * 0.775, S * 0.735);
    ctx.rotate(0.18);
    const R1 = S * 0.125;
    const R2 = S * 0.042;
    const spark = ctx.createLinearGradient(-R1, -R1, R1, R1);
    spark.addColorStop(0, '#fef3c7');
    spark.addColorStop(0.55, '#fbbf24');
    spark.addColorStop(1, '#f59e0b');
    ctx.shadowColor = 'rgba(251,191,36,.95)';
    ctx.shadowBlur = S * 0.07;
    ctx.fillStyle = spark;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? R1 : R2;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-S * 0.062, -S * 0.088, S * 0.018, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 内描边：小尺寸下轮廓更清晰
    const lw = Math.max(1, S * 0.012);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.roundRect(lw / 2, lw / 2, S - lw, S - lw, r - lw / 2);
    ctx.stroke();

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
