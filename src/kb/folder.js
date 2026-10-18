import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.js';
import { writeMarkdownTree, scanNotes } from './markdown-folder.js';

export function info() {
  const cfg = settings().folder || {};
  const dir = cfg.dir || '';
  return {
    dir,
    exists: Boolean(dir) && fs.existsSync(dir),
    conceptSubdir: cfg.conceptSubdir === '' ? '' : cfg.conceptSubdir || '概念',
    index: cfg.index !== false,
  };
}

export default {
  key: 'folder',
  label: 'Markdown 目录',
  kind: 'file',
  desc: '任意目录存纯 Markdown，兼容任何基于文件的知识库（Joplin / Trilium / 坚果云 / Git 仓库）',

  status() {
    const i = info();
    return {
      configured: i.exists,
      target: i.dir,
      detail: i.exists ? `${i.dir}（概念笔记：${i.conceptSubdir || '关闭'}）` : '未设置保存目录或目录不存在',
    };
  },

  async test() {
    const i = info();
    if (!i.dir) return { ok: false, message: '请填写保存目录' };
    try {
      fs.mkdirSync(i.dir, { recursive: true });
      fs.accessSync(i.dir, fs.constants.W_OK);
      return { ok: true, message: `可写入：${i.dir}` };
    } catch (e) {
      return { ok: false, message: `无法写入：${e.message}` };
    }
  },

  write(args) {
    const i = info();
    if (!i.dir) throw new Error('未配置 Markdown 保存目录：请到「设置 → 知识库」填写');
    const category = args.category || '';
    const single = args.singleFile !== undefined ? Boolean(args.singleFile) : settings().kb?.singleFile !== false;
    const baseDir = category ? path.join(i.dir, category) : i.dir;
    const r = writeMarkdownTree({
      baseDir,
      conceptSubdir: i.conceptSubdir,
      style: { wiki: settings().kb?.linkStyle !== 'plain', callout: false },
      index: i.index,
      singleFile: single,
      indexTitle: '知识索引',
      ...args,
    });
    return {
      ...r,
      target: this.key,
      targetLabel: this.label,
      category,
      singleFile: single,
      relativeNote: path.join(category, path.basename(r.notePath)),
      relativeToRoot: path.relative(i.dir, r.notePath),
    };
  },

  async list(limit = 40) {
    const i = info();
    if (!i.exists) return { configured: false, notes: [] };
    const index = scanNotes(i.dir);
    const notes = [...index.values()]
      .map((n) => ({ ...n, mtime: fs.statSync(n.path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((n) => ({ name: n.name, path: n.path, mtime: new Date(n.mtime).toISOString() }));
    return { configured: true, target: i.dir, count: index.size, notes };
  },
};
