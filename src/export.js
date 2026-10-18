import fs from 'node:fs';
import path from 'node:path';
import { EXPORTS, MEDIA, ensureDir } from './config.js';
import { renderReadingHtml } from './render.js';
import { htmlToMarkdown } from './exporters/markdown.js';
import { exportDocx } from './exporters/docx.js';
import { printPdf } from './fetchPage.js';
import { zipDirectory } from './zip.js';

export function safeName(title) {
  return (
    String(title || 'article')
      .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'article'
  );
}

/** 逐文件复制（不用 fs.cpSync，某些环境 + 中文路径会崩） */
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function copyMedia(article, dir) {
  const src = path.join(MEDIA, article.id);
  if (!fs.existsSync(src)) return;
  copyDir(src, path.join(dir, 'media', article.id));
}

export async function exportArticle(article, formats = ['md', 'docx', 'pdf'], { baseUrl = 'http://127.0.0.1:5178' } = {}) {
  const name = safeName(article.title);
  const dir = ensureDir(path.join(EXPORTS, `${name}-${article.id.slice(0, 6)}`));
  const results = [];

  if (formats.includes('md')) {
    const md = htmlToMarkdown(article.html, {
      title: article.title,
      url: article.finalUrl || article.url,
      author: article.author || article.account,
      publishedAt: article.publishedAt,
      summary: article.summary,
      tags: article.tags,
      imagePrefix: 'media/',
    });
    const file = path.join(dir, `${name}.md`);
    fs.writeFileSync(file, md, 'utf8');
    copyMedia(article, dir);
    results.push({ format: 'md', file, size: fs.statSync(file).size });
  }

  if (formats.includes('docx')) {
    const file = path.join(dir, `${name}.docx`);
    await exportDocx(article, file);
    results.push({ format: 'docx', file, size: fs.statSync(file).size });
  }

  if (formats.includes('pdf')) {
    const file = path.join(dir, `${name}.pdf`);
    const html = renderReadingHtml(article, { mode: 'pdf' });
    await printPdf(html, file, { baseUrl, footer: true });
    results.push({ format: 'pdf', file, size: fs.statSync(file).size });
  }

  return { dir, files: results };
}

export function zipDir(dir, zipPath) {
  return Promise.resolve(zipDirectory(dir, zipPath));
}
