import { settings } from '../config.js';
import { safeName, conceptList } from './common.js';

const API = process.env.AF_NOTION_API || 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export function info() {
  const cfg = settings().notion || {};
  return {
    token: cfg.token || '',
    databaseId: cfg.databaseId || '',
    parentPageId: cfg.parentPageId || '',
    titleProp: cfg.titleProp || '',
  };
}

async function api(pathname, { method = 'GET', body, timeout = 30000 } = {}) {
  const { token } = info();
  if (!token) throw new Error('未配置 Notion Integration Token');
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion ${res.status}：${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

/* ---------------- Markdown → Notion blocks ---------------- */

const LANG_MAP = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'shell', powershell: 'powershell', ps1: 'powershell',
  python: 'python', py: 'python', js: 'javascript', javascript: 'javascript', ts: 'typescript',
  json: 'json', sql: 'sql', c: 'c', cpp: 'c++', java: 'java', go: 'go', rust: 'rust',
  html: 'html', css: 'css', yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown',
  text: 'plain text', '': 'plain text',
};

function chunk(str, size = 1800) {
  const out = [];
  let s = String(str || '');
  while (s.length > size) {
    let cut = s.lastIndexOf(' ', size);
    if (cut < size * 0.6) cut = size;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s) out.push(s);
  return out;
}

/** 极简行内解析：**粗体** / `代码` / [文字](链接) */
function richText(line) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  const push = (text, ann, href) => {
    for (const piece of chunk(text)) {
      const obj = { type: 'text', text: { content: piece } };
      if (href) obj.text.link = { url: href };
      if (ann) obj.annotations = ann;
      parts.push(obj);
    }
  };
  while ((m = re.exec(line))) {
    if (m.index > last) push(line.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) push(token.slice(2, -2), { bold: true });
    else if (token.startsWith('`')) push(token.slice(1, -1), { code: true });
    else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (mm) push(mm[1], null, mm[2]);
      else push(token);
    }
    last = m.index + token.length;
  }
  if (last < line.length) push(line.slice(last));
  return parts.length ? parts : [{ type: 'text', text: { content: '' } }];
}

function mdToBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let code = null;

  const flushCode = () => {
    if (!code) return;
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        rich_text: chunk(code.lines.join('\n')).map((c) => ({ type: 'text', text: { content: c } })),
        language: LANG_MAP[(code.lang || '').toLowerCase()] || 'plain text',
      },
    });
    code = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const fence = /^```(\w*)/.exec(line.trim());
    if (fence) {
      if (code) flushCode();
      else code = { lang: fence[1], lines: [] };
      continue;
    }
    if (code) {
      code.lines.push(raw);
      continue;
    }
    if (!line.trim()) continue;
    if (/^<details|^<\/details>|^<\/?summary/.test(line.trim())) continue;

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length >= 3 ? 3 : h[1].length;
      blocks.push({
        object: 'block',
        type: `heading_${level}`,
        [`heading_${level}`]: { rich_text: richText(h[2]) },
      });
      continue;
    }
    if (/^([-*])\s+/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(line.trim().replace(/^[-*]\s+/, '')) } });
      continue;
    }
    if (/^\d+\.\s+/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(line.trim().replace(/^\d+\.\s+/, '')) } });
      continue;
    }
    if (/^>\s?/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: richText(line.trim().replace(/^>\s?/, '')) } });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(line.trim()) } });
  }
  flushCode();
  return blocks.slice(0, 400);
}

async function appendChildren(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 90) {
    await api(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: blocks.slice(i, i + 90) },
    });
  }
}

function plainTitle(page) {
  const props = page.properties || {};
  for (const v of Object.values(props)) {
    if (v.type === 'title') {
      const t = (v.title || []).map((x) => x.plain_text).join('');
      if (t) return t;
    }
  }
  return '(未命名)';
}

async function resolveDatabase() {
  const { databaseId } = info();
  if (!databaseId) throw new Error('未配置 Notion 数据库 ID');
  const db = await api(`/databases/${databaseId}`);
  const titleProp =
    info().titleProp ||
    Object.entries(db.properties || {}).find(([, v]) => v.type === 'title')?.[0] ||
    'Name';
  const tagProp = Object.entries(db.properties || {}).find(([, v]) => v.type === 'multi_select')?.[0] || '';
  return { db, titleProp, tagProp };
}

export default {
  key: 'notion',
  label: 'Notion',
  kind: 'api',
  desc: '写入指定数据库，标题/标签进属性，正文转成 Notion 块（标题、列表、代码块）',

  status() {
    const i = info();
    return {
      configured: Boolean(i.token && i.databaseId),
      target: i.databaseId,
      detail: i.token ? (i.databaseId ? `数据库 ${i.databaseId}` : '未填数据库 ID') : '未配置 Integration Token',
    };
  },

  async test() {
    const i = info();
    if (!i.token) return { ok: false, message: '请填写 Integration Token' };
    try {
      const me = await api('/users/me');
      if (!i.databaseId) return { ok: true, message: `已连接（${me.name || 'bot'}），但还没填数据库 ID` };
      const { db, titleProp, tagProp } = await resolveDatabase();
      const title = (db.title || []).map((t) => t.plain_text).join('');
      return {
        ok: true,
        message: `已连接数据库「${title || i.databaseId}」，标题字段 ${titleProp}${tagProp ? `，标签字段 ${tagProp}` : ''}`,
      };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async write({ source, organized, rawText = '', options = {} }) {
    const i = info();
    if (!i.token) throw new Error('未配置 Notion Integration Token');
    const { titleProp, tagProp } = await resolveDatabase();

    const title = safeName(organized.title || source.title) || '未命名笔记';
    const properties = {
      [titleProp]: { title: [{ type: 'text', text: { content: title.slice(0, 1900) } }] },
    };
    if (tagProp && organized.tags?.length) {
      properties[tagProp] = { multi_select: organized.tags.slice(0, 8).map((t) => ({ name: String(t).slice(0, 90) })) };
    }

    const body = [
      organized.summary ? `**摘要**：${organized.summary}` : '',
      source.url ? `来源：${source.url}` : '',
      '',
      organized.markdown || '',
    ]
      .filter((x) => x !== undefined)
      .join('\n');

    const blocks = mdToBlocks(body);
    const page = await api('/pages', {
      method: 'POST',
      body: {
        parent: { database_id: i.databaseId },
        properties,
        children: blocks.slice(0, 90),
      },
    });

    if (blocks.length > 90) {
      await appendChildren(page.id, blocks.slice(90));
    }

    // 概念页：作为主页面下的子页面，保留定义
    const created = [];
    if (options.conceptNotes !== false) {
      for (const [key, c] of [...conceptList(organized)].slice(0, 6)) {
        if (!c.name || c.name === title) continue;
        try {
          const child = await api('/pages', {
            method: 'POST',
            body: {
              parent: { page_id: page.id },
              properties: { title: { title: [{ type: 'text', text: { content: c.name } }] } },
              children: [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: { rich_text: [{ type: 'text', text: { content: c.definition || '（待补充定义）' } }] },
                },
              ],
            },
          });
          created.push({ name: c.name, id: child.id, url: child.url });
        } catch {}
      }
    }

    return {
      target: this.key,
      targetLabel: this.label,
      notePath: title,
      relativeNote: title,
      noteTitle: title,
      docId: page.id,
      url: page.url,
      conceptsCreated: created,
      conceptsLinked: [],
      index: '',
      related: [],
    };
  },

  async list(limit = 40) {
    const i = info();
    if (!i.token || !i.databaseId) return { configured: false, notes: [] };
    const data = await api(`/databases/${i.databaseId}/query`, {
      method: 'POST',
      body: { page_size: Math.min(Number(limit) || 40, 100), sorts: [{ timestamp: 'created_time', direction: 'descending' }] },
    });
    return {
      configured: true,
      target: i.databaseId,
      count: (data.results || []).length,
      notes: (data.results || []).map((p) => ({ name: plainTitle(p), path: p.url, mtime: p.last_edited_time || '' })),
    };
  },
};
