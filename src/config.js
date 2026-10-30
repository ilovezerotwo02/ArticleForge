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
export const TODO_FILE = path.join(DATA, 'todos.json');

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
    // baidu 在国内网络最稳；duckduckgo 多数网络不可达，留着但会被熔断跳过
    provider: 'baidu',
    tavilyKey: '',
    // 情报源（全部免 Cookie 验证，见 src/intel.js）
    // GitHub Token 可选：不填用匿名额度（搜索 10 次/分），填了 30 次/秒
    githubToken: '',
    // NVD API Key 可选：不填 5 次/30 秒，填了 50 次/30 秒
    nvdApiKey: '',
    // 公众号 RSS 订阅（wechat2rss.xlab.app 等产出的 feed 地址，一行一个）：
    // 配置后公众号检索/监控多一路免验证码的源
    weixinFeeds: [],
    // 「全部来源」遇到安全类关键词自动并入情报源；false 则只在显式选「安全情报」时启用
    intelInAll: true,
    // 情报源是否包含 Google News / Reddit / Hacker News（国内直连不可达会自动熔断跳过）
    intelDeep: true,
    maxResults: 40,
    // 公众号（搜狗微信）翻页数：每页 10 条，最多 10 页
    wechatPages: 5,
    // 网页源（百度/360）翻页数
    webPages: 3,
    // 每次检索即时解析成真实 mp 地址的条数（太多会被搜狗反爬）
    resolveLinks: 8,
  },
  watch: {
    intervalMin: 20,
    enabled: true,
    // 监控只看最近：day / week / month / 空=不限
    timeRange: 'week',
    // 搜狗微信的排序参数现已失效，只能靠多翻页 + 本地按发布日期排序，
    // 所以监控默认翻到 8 页，尽量把最近发布的内容捞进来
    pages: 8,
    // 监控来源：all（全网，安全类关键词自动并入情报源）/ wechat / web / intel
    sources: 'all',
    // 命中推送：钉钉/飞书/企业微信/Telegram 的 Webhook 地址，或任意自定义 JSON 接口
    webhookUrl: '',
    // 钉钉加签密钥（可选）
    webhookSecret: '',
    // Telegram Chat ID（用 Telegram 推送时必填）
    telegramChatId: '',
    // 监控日报 Markdown 目录：留空则自动用知识库里的「监控」目录（Obsidian/Folder 模式）
    markdownDir: '',
  },
  browser: {
    executablePath: '',
    headless: true,
  },
  // 个性化：自定义背景图（上传到本机 media 目录）与各项画面参数
  ui: {
    background: '',
    dim: 0.45,   // 遮暗 0~0.85
    blur: 0,     // 背景模糊 0~30px，默认不糊
    panel: 0.66, // 面板浓度：半透明面板的白色不透明度 0.2~1
    saturate: 1, // 背景饱和度 0~2
    fit: 'cover', // 图片填充：cover / contain / fill / center
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
