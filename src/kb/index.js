/** 知识库目标适配器注册表 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA, settings } from '../config.js';
import obsidian from './obsidian.js';
import folder from './folder.js';
import logseq from './logseq.js';
import siyuan from './siyuan.js';
import notion from './notion.js';

const ADAPTERS = { obsidian, folder, logseq, siyuan, notion };
const HISTORY_FILE = path.join(DATA, 'kb-history.json');

export function destinations() {
  return Object.values(ADAPTERS).map((a) => ({ key: a.key, label: a.label, kind: a.kind, desc: a.desc }));
}

export function currentKey() {
  const k = settings().kb?.destination;
  return ADAPTERS[k] ? k : 'obsidian';
}

export function getAdapter(key) {
  const a = ADAPTERS[key || currentKey()];
  if (!a) throw new Error(`未知的知识库目标：${key}`);
  return a;
}

export function kbStatus() {
  const a = getAdapter();
  const st = a.status();
  return { key: a.key, label: a.label, kind: a.kind, ...st };
}

export async function kbTest(key) {
  const a = getAdapter(key);
  const r = await a.test();
  return { key: a.key, label: a.label, ...r };
}

export function recordHistory(entry) {
  try {
    const list = listHistory();
    list.unshift({ at: new Date().toISOString(), ...entry });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, 60), null, 2), 'utf8');
  } catch {}
}

export function listHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export async function kbWrite(args) {
  const a = getAdapter();
  const result = await a.write(args);
  recordHistory({
    target: a.key,
    title: result.noteTitle,
    path: result.relativeNote || result.notePath,
    url: result.url || '',
    concepts: result.conceptsCreated?.length || 0,
  });
  return result;
}

export async function kbList(limit = 30) {
  const a = getAdapter();
  try {
    const r = await a.list(limit);
    return { key: a.key, label: a.label, ...r };
  } catch (e) {
    return { key: a.key, label: a.label, configured: false, notes: [], error: e.message };
  }
}

/** 全量目录树（不限层数，按需设深度/数量上限） */
export function kbTree({ maxDepth = 6, maxDirs = 600 } = {}) {
  const cfg = settings();
  const key = currentKey();
  const root =
    key === 'obsidian'
      ? cfg.obsidian?.vaultPath || ''
      : key === 'folder'
        ? cfg.folder?.dir || ''
        : key === 'logseq'
          ? cfg.logseq?.graphPath || ''
          : '';
  if (!root || !fs.existsSync(root)) return { key, root: '', routable: false, nodes: [], paths: [] };

  const EXCLUDE = new Set(['.obsidian', '.trash', '概念', 'ArticleForge', 'node_modules', '.git', '.sync']);
  const paths = [];
  let count = 0;

  const walk = (dir, depth) => {
    if (depth > maxDepth || count >= maxDirs) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const n = ent.name;
      if (n.startsWith('.') || n.startsWith('_') || EXCLUDE.has(n)) continue;
      count++;
      const full = path.join(dir, n);
      const rel = path.relative(root, full).split(path.sep).join('/');
      // 收集目录里的 md 笔记名（给 AI 归类依据 + 树里展示）
      let files = [];
      try {
        files = fs.readdirSync(full)
          .filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'index.md')
          .slice(0, 12)
          .map((f) => f.slice(0, -3));
      } catch {}
      paths.push(rel);
      out.push({ name: n, path: rel, files, children: walk(full, depth + 1) });
      if (count >= maxDirs) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  };

  const nodes = walk(root, 1);
  return { key, root, routable: nodes.length > 0, nodes, paths, count };
}

/** 目录树的文本形态，给 AI 选目录用（带示例文件名，让它知道每个目录放什么） */
export function treeText(nodes, depth = 0) {
  const lines = [];
  for (const n of nodes) {
    const hint = n.files?.length ? `（里面放的是：${n.files.slice(0, 8).join('、')}${n.files.length > 8 ? ' 等' : ''}）` : '';
    lines.push(`${'  '.repeat(depth)}- ${n.name}${hint}`);
    if (n.children?.length) lines.push(treeText(n.children, depth + 1));
  }
  return lines.join('\n');
}

/** 按相对路径找树节点 */
export function nodeByPath(nodes, p) {
  const target = String(p || '').replace(/\\/g, '/');
  for (const n of nodes) {
    if (n.path === target) return n;
    const hit = nodeByPath(n.children || [], target);
    if (hit) return hit;
  }
  return null;
}

/** 展平 {path, files} 元数据，供本地兜底匹配 */
export function dirMeta(nodes, out = []) {
  for (const n of nodes) {
    out.push({ path: n.path, files: n.files || [] });
    if (n.children?.length) dirMeta(n.children, out);
  }
  return out;
}

/** 兼容旧接口：扁平目录列表 */
export function listCategories() {
  const t = kbTree();
  const cfg = settings();
  const defaultDir =
    t.key === 'obsidian' ? cfg.obsidian?.folder || 'ArticleForge' : t.key === 'folder' ? '根目录' : '';
  return {
    key: t.key,
    root: t.root,
    defaultDir,
    routable: t.routable,
    categories: t.paths,
    tree: t.nodes,
  };
}

/** 写入前的目标路径预览（不落盘） */
export function previewTarget({ category = '', title = '未命名笔记' } = {}) {
  const cfg = settings();
  const key = currentKey();
  const safe = String(title).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名笔记';
  const join = (...p) => p.filter(Boolean).join('/').replace(/\\/g, '/');

  if (key === 'obsidian') {
    const root = cfg.obsidian?.vaultPath || '';
    const dir = category || cfg.obsidian?.folder || 'ArticleForge';
    return { kind: 'file', root, dir, file: `${safe}.md`, display: `${join(root, dir, safe)}.md` };
  }
  if (key === 'folder') {
    const root = cfg.folder?.dir || '';
    const dir = category || '';
    return { kind: 'file', root, dir, file: `${safe}.md`, display: `${join(root, dir, safe)}.md` };
  }
  if (key === 'logseq') {
    const root = cfg.logseq?.graphPath || '';
    return { kind: 'file', root, dir: 'pages', file: `${safe}.md`, display: `${join(root, 'pages', safe)}.md` };
  }
  if (key === 'siyuan') {
    return { kind: 'api', root: cfg.siyuan?.apiUrl || '', dir: cfg.siyuan?.notebookName || '（自动选第一个笔记本）', file: safe, display: `思源 / ${cfg.siyuan?.notebookName || '第一个笔记本'} / ${safe}` };
  }
  return { kind: 'api', root: 'Notion', dir: cfg.notion?.databaseId || '', file: safe, display: `Notion 数据库 ${cfg.notion?.databaseId || ''} / ${safe}` };
}
