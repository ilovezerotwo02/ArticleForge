/**
 * 本地文档摄入：DOCX / Markdown / PDF / TXT → 统一的 Article 模型
 * 之后即可走同一套"预览 / 导出 / AI 整理 / 写入知识库"流程
 */
import { JSDOM } from 'jsdom';
import mammoth from 'mammoth';
import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA, ensureDir } from './config.js';
import { sanitizeDocument } from './sanitize.js';
import { htmlToMarkdown } from './exporters/markdown.js';
import { hashId } from './store.js';

const MIME_EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg', bmp: 'bmp' };

function decodeDataUri(uri) {
  const m = /^data:image\/([\w+.-]+);base64,(.*)$/i.exec(uri);
  if (!m) return null;
  return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buffer: Buffer.from(m[2], 'base64') };
}

/** PDF 文本抽取：按 y 坐标还原行，按字号推断标题，按行距切段 */
async function pdfToBlocks(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const rawLines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5] * 2) / 2;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: item.transform[4], str: item.str, size: item.height || 0 });
    }
    const ys = [...lines.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const parts = lines.get(y).sort((a, b) => a.x - b.x);
      const text = parts.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const size = Math.max(...parts.map((i) => i.size || 0));
      rawLines.push({ text, size, y, page: p });
    }
  }
  await doc.destroy?.();

  if (!rawLines.length) return [];

  // 正文字号 = 出现次数最多的字号
  const freq = new Map();
  for (const l of rawLines) {
    const k = Math.round(l.size);
    if (k > 0) freq.set(k, (freq.get(k) || 0) + l.text.length);
  }
  let body = 0;
  let maxWeight = 0;
  for (const [k, w] of freq) if (w > maxWeight) ((maxWeight = w), (body = k));

  const blocks = [];
  let buf = null;
  const flush = () => {
    if (buf) blocks.push(buf);
    buf = null;
  };

  for (const l of rawLines) {
    const size = Math.round(l.size) || body;
    let type = 'p';
    if (body && size >= body * 1.45 && l.text.length <= 40) type = 'h2';
    else if (body && size >= body * 1.2 && l.text.length <= 60) type = 'h3';
    else if (/^(\$|#|PS[ >]|[a-z]:\\|vol\.py|python3?|pip|git |nmap|curl|wget|sudo |apt )/i.test(l.text)) type = 'code';

    if (buf && buf.type === type && type !== 'p') buf.text += (type === 'code' ? '\n' : ' ') + l.text;
    else if (buf && buf.type === 'p' && type === 'p') buf.text += (/[。！？；：.!?:]$/.test(buf.text) || buf.text.length > 60 ? ' ' : '') + l.text;
    else {
      flush();
      buf = { type, text: l.text };
    }
  }
  flush();
  return blocks;
}

async function pdfToHtml(buffer) {
  const blocks = await pdfToBlocks(buffer);
  return blocks
    .map((b) => {
      const t = b.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      if (b.type === 'h2') return `<h2>${t}</h2>`;
      if (b.type === 'h3') return `<h3>${t}</h3>`;
      if (b.type === 'code') return `<pre><code>${t}</code></pre>`;
      return `<p>${t}</p>`;
    })
    .join('\n');
}

function textToHtml(text) {
  const paras = text.split(/\n{2,}|\r\n{2,}/).map((t) => t.trim()).filter(Boolean);
  return paras.map((t) => `<p>${t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function detectKind(filename, mimetype = '') {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.md' || ext === '.markdown' || ext === '.mdown') return 'md';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.txt' || ext === '.log') return 'txt';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (/pdf/.test(mimetype)) return 'pdf';
  if (/wordprocessingml/.test(mimetype)) return 'docx';
  if (/markdown/.test(mimetype)) return 'md';
  return 'txt';
}

export async function ingestFile({ buffer, filename, mimetype }) {
  if (!buffer?.length) throw new Error('文件为空');
  if (buffer.length > 40 * 1024 * 1024) throw new Error('文件超过 40MB，请拆分后再上传');

  const kind = detectKind(filename, mimetype);
  const baseName = path.basename(filename, path.extname(filename)).trim() || '导入文档';
  let html = '';
  let title = baseName;
  let text = '';
  let warnings = [];
  const meta = { source: '', author: '' };

  if (kind === 'docx') {
    const result = await mammoth.convertToHtml({ buffer }, { includeDefaultStyleMap: true });
    html = result.value;
    warnings = (result.messages || []).filter((m) => m.type === 'warning').slice(0, 5).map((m) => m.message);
    if (!html.trim()) throw new Error('未能从 DOCX 中提取内容（可能是扫描件或纯图片文档）');
  } else if (kind === 'md') {
    let md = buffer.toString('utf8');
    // 去掉 YAML frontmatter（ArticleForge / Obsidian 导出的 md 都带），但复用其中的元信息
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (fmMatch) {
      const fm = fmMatch[1];
      title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1]?.trim() || title;
      meta.source = /^source:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1]?.trim() || '';
      meta.author = /^author:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1]?.trim() || '';
      md = md.slice(fmMatch[0].length);
    }
    if (!title || title === baseName) {
      title = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() || baseName;
    }
    html = marked.parse(md, { gfm: true, breaks: false });
  } else if (kind === 'pdf') {
    html = await pdfToHtml(buffer);
    if (!html.trim()) throw new Error('该 PDF 没有可提取的文本层（可能是扫描件），请先用 OCR 处理');
  } else if (kind === 'html') {
    const dom = new JSDOM(buffer.toString('utf8'));
    title = dom.window.document.title || baseName;
    html = dom.window.document.body.innerHTML;
  } else {
    text = buffer.toString('utf8');
    html = textToHtml(text);
  }

  const dom = new JSDOM(`<body><div id="af-root">${html}</div></body>`);
  const doc = dom.window.document;
  const container = doc.getElementById('af-root');
  if (!title || title === baseName) {
    const firstH1 = container.querySelector('h1');
    if (firstH1) {
      title = firstH1.textContent.trim() || title;
      firstH1.remove();
    }
  }
  // 文档首段与标题重复时去掉，避免出现「标题成了 H3」的重复层级
  const firstBlock = container.querySelector('h1, h2, h3, p');
  if (firstBlock) {
    const t = (firstBlock.textContent || '').replace(/\s+/g, '').trim();
    const name = title.replace(/\s+/g, '').trim();
    if (t && (t === name || (name.length > 6 && t.includes(name) && t.length < name.length + 12))) firstBlock.remove();
  }

  const normalized = sanitizeDocument(doc, container, { baseUrl: '' });
  const id = hashId(`${filename}|${crypto.createHash('sha1').update(buffer).digest('hex')}`);

  // 内嵌图片（DOCX/MD 里的 base64）落地为文件
  const assets = [];
  if (normalized.embedded?.length) {
    const dir = ensureDir(path.join(MEDIA, id));
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = normalized.html;
    const imgs = [...wrapper.querySelectorAll('img[data-embed]')];
    for (const [i, img] of imgs.entries()) {
      const dataUrl = img.getAttribute('src');
      const decoded = decodeDataUri(dataUrl);
      if (!decoded) continue;
      const name = `embed-${String(i + 1).padStart(2, '0')}.${MIME_EXT[decoded.ext] || 'png'}`;
      fs.writeFileSync(path.join(dir, name), decoded.buffer);
      img.setAttribute('src', `/media/${id}/${name}`);
      img.removeAttribute('data-embed');
      assets.push({ url: `embedded:${i}`, file: name, local: `/media/${id}/${name}`, bytes: decoded.buffer.length });
    }
    normalized.html = wrapper.innerHTML;
  }

  const articleText = normalized.text || '';
  const markdown = htmlToMarkdown(normalized.html, {
    title,
    url: '',
    author: '',
    publishedAt: '',
    tags: ['导入'],
  });

  return {
    id,
    url: meta.source || '',
    finalUrl: meta.source || '',
    source: 'upload',
    sourceKind: kind,
    filename,
    title: title.slice(0, 120),
    author: meta.author || '',
    account: '',
    publishedAt: '',
    cover: assets[0]?.local || '',
    html: normalized.html,
    markdown,
    text: articleText,
    outline: normalized.outline,
    assets,
    headingCount: normalized.headingCount,
    words: (articleText.match(/[\u4e00-\u9fa5]/g) || []).length + (articleText.match(/[A-Za-z]+/g) || []).length,
    createdAt: new Date().toISOString(),
    tags: ['导入', kind],
    summary: articleText.slice(0, 220).replace(/\n/g, ' '),
    checksum: crypto.createHash('sha1').update(articleText).digest('hex').slice(0, 10),
    warnings,
  };
}
