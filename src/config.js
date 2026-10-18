import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 打包成桌面应用时数据放在用户目录（asar 只读），浏览器模式仍用项目内 data/
export const DATA = process.env.AF_DATA_DIR ? path.resolve(process.env.AF_DATA_DIR) : path.join(ROOT, 'data');
export const MEDIA = path.join(DATA, 'media');
export const EXPORTS = path.join(DATA, 'exports');
export const CACHE = path.join(DATA, 'cache');
export const PUBLIC = path.join(ROOT, 'public');
export const SETTINGS_FILE = path.join(DATA, 'settings.json');
export const LIBRARY_FILE = path.join(DATA, 'library.json');
export const WATCH_FILE = path.join(DATA, 'watches.json');
export const CHAT_FILE = path.join(DATA, 'chats.json');

for (const dir of [DATA, MEDIA, EXPORTS, CACHE]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

const DEFAULTS = {
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.4,
    enabled: false,
  },
  obsidian: {
    vaultPath: '',
    folder: 'ArticleForge',
    createConceptNotes: true,
    includeSourceQuote: true,
  },
  // 知识库写入目标（可切换，Obsidian 只是其中一种）
  kb: {
    destination: 'obsidian',
    linkStyle: 'wiki',
    includeRaw: true,
    conceptNotes: true,
    singleFile: true,
  },
  logseq: {
    graphPath: '',
    conceptPages: true,
  },
  folder: {
    dir: '',
    conceptSubdir: '概念',
    index: true,
  },
  siyuan: {
    apiUrl: 'http://127.0.0.1:6806',
    token: '',
    notebook: '',
    notebookName: '',
  },
  notion: {
    token: '',
    databaseId: '',
    titleProp: 'Name',
  },
  export: {
    pdfPageSize: 'A4',
    pdfMargin: '16mm',
    addPageNumber: true,
    docxCodeFrame: true,
  },
  search: {
    provider: 'duckduckgo',
    tavilyKey: '',
    maxResults: 12,
  },
  watch: {
    intervalMin: 30,
    enabled: true,
  },
  browser: {
    executablePath: '',
    headless: true,
  },
};

/** 深度合并，数组直接覆盖 */
function merge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = k in base ? merge(base[k], v) : v;
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

export function readSettings() {
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(patch) {
  const next = merge(readSettings(), patch || {});
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function settings() {
  return readSettings();
}

/** 自动寻找本机 Chromium 内核浏览器（不下载 Chromium，省 150MB+） */
export function findBrowser() {
  const configured = readSettings().browser?.executablePath;
  if (configured && fs.existsSync(configured)) return configured;

  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export const PATHS = { ROOT, DATA, MEDIA, EXPORTS, CACHE, PUBLIC };
