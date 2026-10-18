import { settings } from '../config.js';
import { safeName, buildMainMarkdown, conceptList } from './common.js';

export function info() {
  const cfg = settings().siyuan || {};
  return {
    apiUrl: (cfg.apiUrl || 'http://127.0.0.1:6806').replace(/\/+$/, ''),
    token: cfg.token || '',
    notebook: cfg.notebook || '',
    notebookName: cfg.notebookName || '',
  };
}

async function call(api, payload, { timeout = 20000 } = {}) {
  const i = info();
  if (!i.token) throw new Error('未配置思源 API Token：思源 → 设置 → 关于 → API token');
  const res = await fetch(`${i.apiUrl}/api/${api}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${i.token}` },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`思源接口 ${api} 返回 HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`思源接口 ${api} 出错：${data.msg || data.code}`);
  return data.data;
}

function esc(s) {
  return String(s || '').replace(/'/g, "''");
}

export default {
  key: 'siyuan',
  label: '思源笔记',
  kind: 'api',
  desc: '通过思源本地 API 直接建文档，自动建概念文档并用块引用互链',

  status() {
    const i = info();
    return {
      configured: Boolean(i.token),
      target: i.apiUrl,
      detail: i.token
        ? `${i.apiUrl}${i.notebook ? ` · 笔记本 ${i.notebookName || i.notebook}` : ' · 未选择笔记本'}`
        : '未配置 API Token',
    };
  },

  async test() {
    const i = info();
    if (!i.token) return { ok: false, message: '请填写 API Token' };
    try {
      const data = await call('notebook/lsNotebooks', {});
      const books = (data?.notebooks || []).filter((b) => !b.closed);
      if (!books.length) return { ok: false, message: '没有可用的笔记本，请先在思源里新建一个' };
      return {
        ok: true,
        message: `连接成功，共 ${books.length} 个笔记本`,
        notebooks: books.map((b) => ({ id: b.id, name: b.name })),
      };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async write({ source, organized, rawText = '', options = {} }) {
    const i = info();
    if (!i.token) throw new Error('未配置思源 API Token');

    const books = (await call('notebook/lsNotebooks', {}))?.notebooks?.filter((b) => !b.closed) || [];
    if (!books.length) throw new Error('思源里没有可用笔记本');
    const notebook = books.find((b) => b.id === i.notebook) || books[0];

    const title = safeName(organized.title || source.title) || '未命名笔记';
    const created = [];
    const refIds = new Map();

    // 1) 概念文档（同时记录 id，供块引用）
    if (options.conceptNotes !== false) {
      for (const [key, c] of conceptList(organized)) {
        if (!c.name || key === title.toLowerCase().replace(/\s/g, '')) continue;
        const path = `/概念/${c.name}`;
        const md = `# ${c.name}\n\n${c.definition || '（待补充定义）'}\n\n## 出处\n\n- [[${title}]]\n`;
        try {
          const data = await call('filetree/createDocWithMd', { notebook: notebook.id, path, markdown: md });
          const id = typeof data === 'string' ? data : data?.id;
          if (id) refIds.set(key, id);
          created.push({ name: c.name, id, path });
        } catch {
          // 同名文档已存在时思源会报错，忽略并尝试查 id
          try {
            const rows = await call('query/sql', { stmt: `select id from blocks where type = 'd' and content = '${esc(c.name)}' limit 1` });
            if (rows?.[0]?.id) refIds.set(key, rows[0].id);
          } catch {}
        }
      }
    }

    // 2) 主文档：把 [[概念]] 换成 ((块 id))，找不到就保留文字
    const { markdown } = buildMainMarkdown({
      source,
      organized,
      rawText,
      options,
      style: { yaml: false, callout: false, wiki: true, excerpt: true },
    });

    let finalMd = markdown;
    const links = [...finalMd.matchAll(/\[\[([^\]]+)\]\]/g)];
    for (const [full, name] of links) {
      const key = name.trim().toLowerCase().replace(/\s/g, '');
      let id = refIds.get(key);
      if (!id) {
        try {
          const rows = await call('query/sql', {
            stmt: `select id from blocks where type = 'd' and content = '${esc(name.trim())}' limit 1`,
          });
          id = rows?.[0]?.id;
        } catch {}
      }
      if (id) finalMd = finalMd.split(full).join(`((${id} '${name.trim()}'))`);
    }

    const data = await call('filetree/createDocWithMd', { notebook: notebook.id, path: `/${title}`, markdown: finalMd });
    const docId = typeof data === 'string' ? data : data?.id;

    return {
      target: this.key,
      targetLabel: this.label,
      notePath: `${notebook.name}/${title}`,
      relativeNote: `${notebook.name}/${title}`,
      noteTitle: title,
      docId,
      url: docId ? `siyuan://blocks/${docId}` : i.apiUrl,
      conceptsCreated: created,
      conceptsLinked: [],
      index: '',
      related: [],
    };
  },

  async list(limit = 40) {
    const i = info();
    if (!i.token) return { configured: false, notes: [] };
    const rows = await call('query/sql', {
      stmt: `select id, content, updated from blocks where type = 'd' order by updated desc limit ${Number(limit) || 40}`,
    });
    return {
      configured: true,
      target: i.apiUrl,
      count: rows?.length || 0,
      notes: (rows || []).map((r) => ({
        name: r.content,
        path: `siyuan://blocks/${r.id}`,
        mtime: r.updated || '',
      })),
    };
  },
};
