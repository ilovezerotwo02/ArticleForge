import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { safeName, normalizeName, ensureDir, relatedList, conceptList, mdToLogseqOutline, pickFilePath, writeFile } from './common.js';
import { scanNotes } from './markdown-folder.js';

export function info() {
  const cfg = settings().logseq || {};
  const graph = cfg.graphPath || '';
  return {
    graph,
    pages: graph ? path.join(graph, 'pages') : '',
    exists: Boolean(graph) && fs.existsSync(graph),
    conceptPages: cfg.conceptPages !== false,
  };
}

function propLine(key, value) {
  return `- ${key}:: ${String(value).replace(/\r?\n/g, ' ').trim()}`;
}

export default {
  key: 'logseq',
  label: 'Logseq',
  kind: 'file',
  desc: '写入 graph/pages，大纲块 + 页面属性 + [[双链]]，概念各建一页',

  status() {
    const i = info();
    return {
      configured: i.exists,
      target: i.graph,
      detail: i.exists ? i.pages : '未设置 graph 路径或路径不存在',
    };
  },

  async test() {
    const i = info();
    if (!i.graph) return { ok: false, message: '请填写 Logseq graph 目录' };
    if (!i.exists) return { ok: false, message: 'graph 目录不存在' };
    fs.mkdirSync(i.pages, { recursive: true });
    return { ok: true, message: `可写入：${i.pages}` };
  },

  write({ source, organized, rawText = '', options = {}, singleFile }) {
    const i = info();
    const single = singleFile !== undefined ? Boolean(singleFile) : settings().kb?.singleFile !== false;
    if (!i.exists) throw new Error('未配置 Logseq graph：请到「设置 → 知识库」填写 graph 目录');
    ensureDir(i.pages);

    const title = safeName(organized.title || source.title) || '未命名笔记';
    const existing = scanNotes(i.graph);
    const related = relatedList(organized);
    const conceptDir = i.pages;
    const conceptNames = i.conceptPages && options.conceptNotes !== false && !single ? conceptList(organized) : new Map();

    const created = [];
    const linked = [];

    // 概念页
    for (const [key, c] of conceptNames) {
      if (!c.name || normalizeName(c.name) === normalizeName(title)) continue;
      if (existing.has(key)) {
        linked.push({ name: existing.get(key).name, path: existing.get(key).path, existed: true });
        continue;
      }
      const file = path.join(conceptDir, `${c.name}.md`);
      if (fs.existsSync(file)) {
        linked.push({ name: c.name, path: file, existed: true });
        continue;
      }
      writeFile(
        file,
        [propLine('类型', 'concept'), propLine('定义', c.definition || '待补充'), propLine('出处', `[[${title}]]`), ''].join('\n')
      );
      created.push({ name: c.name, path: file });
    }

    // 主页面
    const head = [
      propLine('tags', (organized.tags || []).join(', ')),
      source.url ? propLine('source', source.url) : '',
      propLine('类型', source.type === 'upload' ? '文档' : '文章'),
      organized.summary ? propLine('摘要', organized.summary) : '',
      related.length ? propLine('关联', related.map((r) => `[[${r.target}]]`).join(', ')) : '',
    ]
      .filter(Boolean)
      .join('\n');

    const body = mdToLogseqOutline(organized.markdown || '');
    const notePath = pickFilePath(conceptDir, title);
    writeFile(notePath, `${head}\n${body}\n`);

    return {
      target: this.key,
      targetLabel: this.label,
      singleFile: single,
      notePath,
      relativeNote: path.relative(i.graph, notePath),
      noteTitle: title,
      conceptsCreated: created,
      conceptsLinked: linked,
      index: '',
      related,
    };
  },

  async list(limit = 40) {
    const i = info();
    if (!i.exists) return { configured: false, notes: [] };
    const index = scanNotes(i.graph);
    const notes = [...index.values()]
      .map((n) => ({ ...n, mtime: fs.statSync(n.path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((n) => ({ name: n.name, path: n.path, mtime: new Date(n.mtime).toISOString() }));
    return { configured: true, target: i.graph, count: index.size, notes };
  },
};
