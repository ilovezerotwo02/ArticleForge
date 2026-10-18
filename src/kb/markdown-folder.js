/** 文件型知识库通用写入（Obsidian / Logseq 之外的纯 Markdown 目录也走这里） */
import fs from 'node:fs';
import path from 'node:path';
import {
  safeName, normalizeName, ensureDir, buildMainMarkdown, conceptList, pickFilePath, writeFile,
} from './common.js';

/** 建立「规范化文件名 → 真实文件」索引，避免重复建概念笔记、双链断裂 */
export function scanNotes(baseDir) {
  const index = new Map();
  if (!baseDir || !fs.existsSync(baseDir)) return index;
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const base = e.name.slice(0, -3);
        const key = normalizeName(base);
        if (!index.has(key)) index.set(key, { name: base, path: full });
      }
    }
  };
  walk(baseDir);
  return index;
}

/**
 * @param {object} p
 * @param {string} p.baseDir        笔记根目录
 * @param {string} [p.conceptSubdir] 概念笔记子目录（空 = 不建概念笔记）
 * @param {object} [p.style]        buildMainMarkdown 的样式
 * @param {boolean} [p.index]       是否维护 _索引.md
 * @param {string} [p.indexTitle]
 */
export function writeMarkdownTree({
  baseDir, conceptSubdir = '概念', style = {}, index = false, indexTitle = '知识索引', singleFile = false,
  source, organized, rawText = '', options = {},
}) {
  if (!baseDir) throw new Error('未配置文件保存目录');
  ensureDir(baseDir);

  const wantConcepts = Boolean(conceptSubdir) && options.conceptNotes !== false && !singleFile;
  const conceptDir = wantConcepts ? ensureDir(path.join(baseDir, conceptSubdir)) : '';

  const existing = scanNotes(baseDir);
  const concepts = conceptList(organized);
  const mainTitle = safeName(organized.title || source.title) || '未命名笔记';
  const mainKey = normalizeName(mainTitle);

  const created = [];
  const linked = [];

  // 1) 概念笔记先建，保证链接有效
  if (wantConcepts) {
    for (const [key, c] of concepts) {
      if (!c.name || c.name === mainTitle || key === mainKey) continue;
      if (existing.has(key)) {
        linked.push({ name: existing.get(key).name, path: existing.get(key).path, existed: true });
        continue;
      }
      const file = path.join(conceptDir, `${c.name}.md`);
      if (fs.existsSync(file)) {
        linked.push({ name: c.name, path: file, existed: true });
        continue;
      }
      const body = [
        '---',
        `title: ${c.name}`,
        'type: concept',
        `created: ${new Date().toISOString().slice(0, 10)}`,
        'tags: [concept]',
        '---',
        '',
        `# ${c.name}`,
        '',
        c.definition || '（待补充定义）',
        '',
        '## 出处',
        `- ${style.wiki === false ? mainTitle : `[[${mainTitle}]]`}`,
        '',
      ].join('\n');
      writeFile(file, body);
      created.push({ name: c.name, path: file });
    }
  }

  // 2) 主笔记
  const { markdown, related } = buildMainMarkdown({
    source,
    organized,
    rawText,
    options,
    style: { ...style, single: singleFile },
  });
  const notePath = pickFilePath(baseDir, mainTitle);
  writeFile(notePath, markdown);

  // 3) 索引（单文件模式不建）
  let indexPath = '';
  if (index && !singleFile) {
    indexPath = path.join(baseDir, '_索引.md');
    if (!fs.existsSync(indexPath)) {
      writeFile(
        indexPath,
        ['---', `title: ${indexTitle}`, 'type: moc', '---', '', `# ${indexTitle}`, '', '> 由 ArticleForge 自动维护，按整理时间倒序。', ''].join('\n')
      );
    }
    const linkText = style.wiki === false ? mainTitle : `[[${mainTitle}]]`;
    const line = `- ${new Date().toISOString().slice(0, 10)} · ${linkText}${organized.tags?.length ? ` · ${organized.tags.join(' / ')}` : ''}`;
    fs.appendFileSync(indexPath, line + '\n', 'utf8');
  }

  return {
    notePath,
    relativeNote: path.relative(baseDir, notePath),
    noteTitle: mainTitle,
    conceptsCreated: created,
    conceptsLinked: linked,
    index: indexPath,
    related,
  };
}
