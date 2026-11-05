import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { writeMarkdownTree, scanNotes } from './markdown-folder.js';
import { buildMainMarkdown } from './common.js';

export function info() {
  const cfg = settings().obsidian || {};
  const vault = cfg.vaultPath || '';
  return {
    path: vault,
    exists: Boolean(vault) && fs.existsSync(vault),
    folder: cfg.folder || 'ArticleForge',
    createConceptNotes: cfg.createConceptNotes !== false,
  };
}

export default {
  key: 'obsidian',
  label: 'Obsidian',
  kind: 'file',
  desc: '写入 vault 目录，包含 YAML frontmatter、双链、概念笔记与索引',

  status() {
    const i = info();
    return {
      configured: i.exists,
      target: i.path,
      detail: i.exists ? `${i.path}${path.sep}${i.folder}` : '未设置 vault 路径或路径不存在',
      createConceptNotes: i.createConceptNotes,
    };
  },

  async test() {
    const i = info();
    if (!i.path) return { ok: false, message: '请填写 vault 路径' };
    if (!i.exists) return { ok: false, message: '路径不存在，请确认是不是 vault 根目录' };
    const dir = path.join(i.path, i.folder);
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, message: `可写入：${dir}` };
  },

  write(args) {
    const i = info();
    if (!i.exists) throw new Error('未配置 Obsidian 库路径：请到「设置 → 知识库」选择 vault 目录');
    const single = args.singleFile !== undefined ? Boolean(args.singleFile) : settings().kb?.singleFile !== false;
    const category = args.category && args.category !== i.folder ? args.category : '';
    const baseDir = category ? path.join(i.path, category) : path.join(i.path, i.folder);
    // 合并模式：补充到目录里已有的笔记末尾
    const mergeInto = String(args.mergeInto || '').trim().replace(/[\\/]/g, '');
    if (mergeInto) {
      const targetFile = path.join(baseDir, `${mergeInto}.md`);
      if (!fs.existsSync(targetFile)) {
        throw new Error(`要补充的笔记不存在：${targetFile}`);
      }
      const src = args.source || {};
      const org = args.organized || {};
      const { markdown } = buildMainMarkdown({
        source: src,
        organized: org,
        rawText: args.rawText ?? '',
        options: args.options || {},
        style: { wiki: true, callout: true, yaml: false, single: true },
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const section = `\n\n---\n\n## ${org.title || src.title}（${stamp} 补充）\n\n${src.url ? `> 来源：${src.url}\n\n` : ''}${markdown}\n`;
      const before = fs.readFileSync(targetFile, 'utf8');
      fs.appendFileSync(targetFile, section, 'utf8');
      return {
        mode: 'merged',
        notePath: targetFile,
        relativeNote: path.relative(i.path, targetFile),
        target: this.key,
        targetLabel: this.label,
        vault: i.path,
        category,
        singleFile: true,
        conceptsCreated: [],
        relatedNotes: [],
      };
    }
    const r = writeMarkdownTree({
      baseDir,
      conceptSubdir: i.createConceptNotes ? '概念' : '',
      style: { wiki: true, callout: true },
      index: true,
      singleFile: single,
      indexTitle: 'ArticleForge 索引',
      ...args,
    });
    return {
      ...r,
      target: this.key,
      targetLabel: this.label,
      vault: i.path,
      category,
      singleFile: single,
      relativeNote: path.relative(i.path, r.notePath),
    };
  },

  async list(limit = 40) {
    const i = info();
    if (!i.exists) return { configured: false, notes: [] };
    const index = scanNotes(i.path);
    const notes = [...index.values()]
      .map((n) => ({ ...n, mtime: fs.statSync(n.path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((n) => ({ name: n.name, path: n.path, mtime: new Date(n.mtime).toISOString() }));
    return { configured: true, target: i.path, count: index.size, notes };
  },
};
