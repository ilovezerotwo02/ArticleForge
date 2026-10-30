import fs from 'node:fs';
import crypto from 'node:crypto';
import { LIBRARY_FILE, WATCH_FILE, CHAT_FILE, TODO_FILE } from './config.js';

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function hashId(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);
}

/* ---------------- 文章资料库 ---------------- */

let library = read(LIBRARY_FILE, []);

export function listArticles() {
  return library.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    source: a.source,
    account: a.account,
    author: a.author,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    cover: a.cover,
    words: a.words,
    imageCount: a.assets?.length || 0,
    tags: a.tags || [],
    userTags: a.userTags || [],
  }));
}

export function getArticle(id) {
  return library.find((a) => a.id === id) || null;
}

export function getArticleByUrl(url) {
  const norm = normalizeUrl(url);
  return library.find((a) => normalizeUrl(a.url) === norm) || null;
}

export function saveArticle(article) {
  const idx = library.findIndex((a) => a.id === article.id);
  if (idx >= 0) library[idx] = { ...library[idx], ...article, updatedAt: new Date().toISOString() };
  else library.unshift(article);
  write(LIBRARY_FILE, library);
  return article;
}

export function deleteArticle(id) {
  const idx = library.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  library.splice(idx, 1);
  write(LIBRARY_FILE, library);
  return true;
}

/* ---------------- 监控任务 ---------------- */

let watches = read(WATCH_FILE, []);
export const watchStore = {
  list: () => watches,
  save(list) {
    watches = list;
    write(WATCH_FILE, watches);
    return watches;
  },
  add(task) {
    watches.push(task);
    write(WATCH_FILE, watches);
    return task;
  },
  remove(id) {
    watches = watches.filter((w) => w.id !== id);
    write(WATCH_FILE, watches);
    return watches;
  },
  update(id, patch) {
    const w = watches.find((x) => x.id === id);
    if (!w) return null;
    Object.assign(w, patch);
    write(WATCH_FILE, watches);
    return w;
  },
};

/* ---------------- 待办便签（用户自己记没完成的事） ---------------- */

let todos = read(TODO_FILE, []);
export const todoStore = {
  list: () => todos,
  add(item) {
    todos.unshift(item);
    write(TODO_FILE, todos);
    return item;
  },
  update(id, patch) {
    const t = todos.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    write(TODO_FILE, todos);
    return t;
  },
  remove(id) {
    const before = todos.length;
    todos = todos.filter((x) => x.id !== id);
    write(TODO_FILE, todos);
    return todos.length < before;
  },
};

/* ---------------- 对话历史 ---------------- */

let chats = read(CHAT_FILE, {});
export const chatStore = {
  get(key) {
    return chats[key] || [];
  },
  set(key, messages) {
    chats[key] = messages.slice(-60);
    write(CHAT_FILE, chats);
    return chats[key];
  },
  clear(key) {
    delete chats[key];
    write(CHAT_FILE, chats);
  },
};

/* ---------------- URL 规范化（监控去重） ---------------- */

const TRACKING = /^(utm_|from|isappinstalled|scene|srcid|sharer_|share_|clicktime|enterid|chksm|mpshare|exportkey|pass_ticket|wx_header|sessionid|ascene|devicetype|version|nettype|lang|fontScale|subscene|token|uigs|spm|vd_source|s_from)/i;

// 公众号链接里这些参数每次访问都变（src/timestamp/ver/signature），只对 mp 生效
const WX_VOLATILE = /^(src|timestamp|ver|signature|new|exportkey|chksm|scene|subscene|ascene|clicktime|enterid|pass_ticket|wx_header|sessionid|key|uin|devicetype|version|nettype|lang|fontScale|from|isappinstalled|mpshare|sharer_|srcid|utm_)/i;

const isMpWeixin = (u) => u.hostname === 'mp.weixin.qq.com' && /^\/s(\/|$)/.test(u.pathname);
const isSogouLink = (u) => /(^|\.)sogou\.com$/.test(u.hostname) && u.pathname === '/link';

/** 清洗成稳定可点开的真实 URL */
export function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    const wx = isMpWeixin(u);
    if (isSogouLink(u)) {
      // 只留加密 url 参数，token/query 每轮都变
      const key = u.searchParams.get('url');
      if (key) return `https://weixin.sogou.com/link?url=${key}`;
    }
    for (const key of [...u.searchParams.keys()]) {
      if (wx ? WX_VOLATILE.test(key) : TRACKING.test(key)) u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return String(raw).trim();
  }
}

/**
 * 去重/监控指纹：比 normalizeUrl 更狠
 * - 公众号文章 → wx:__biz:mid:idx（同一篇的转载、不同入口参数都归一）
 * - 搜狗跳转   → sogou:加密url 参数
 */
export function urlKey(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (isMpWeixin(u)) {
      const biz = u.searchParams.get('__biz');
      const mid = u.searchParams.get('mid') || u.searchParams.get('appmsgid');
      const idx = u.searchParams.get('idx') || u.searchParams.get('itemidx');
      if (biz && mid) return `wx:${biz}:${mid}:${idx || '1'}`;
      const sn = u.searchParams.get('sn');
      if (sn) return `wx:sn:${sn}`;
      const h = /^\/s\/([A-Za-z0-9_-]{6,})$/.exec(u.pathname);
      if (h) return `wx:h:${h[1]}`;
    }
    if (isSogouLink(u)) {
      const key = u.searchParams.get('url');
      return key ? `sogou:${key}` : 'sogou:link';
    }
    return normalizeUrl(raw);
  } catch {
    return String(raw).trim();
  }
}

/* ---------------- SSE 事件总线 ---------------- */

const clients = new Set();

export function addSseClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function emit(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}
