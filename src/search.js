import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import { UA, settings, findBrowser } from './config.js';
import { normalizeUrl, urlKey } from './store.js';
import { getBrowser } from './fetchPage.js';
import { intelSearch, searchWeixinFeeds, parseFeed } from './intel.js';
import { noteOk, noteFail, isDown, searchHealth, healthDetail } from './health.js';
import {
  sleep, jitter, clean, clampNum, normalizeName, isoDate,
  parseCnDate, parseAnyDate, tsOf, bigrams, titleSimilarity,
} from './util.js';

/* 兼容旧引用（scripts/test-fingerprint.mjs、server.js） */
export { parseCnDate, parseAnyDate, titleSimilarity, searchHealth };

/* =========================================================================
 * 检索层：多源并行 + 多页翻页 + 发布日期解析 + 时间窗过滤 + 指纹去重
 * -------------------------------------------------------------------------
 * 免费源的实测能力（2026-10 探针结论）：
 *   搜狗微信  10 条/页，最多 10 页（第 11 页空），sort=1 已被官方忽略；
 *             收录延迟以「天」计
 *   百度      10 条/页，pn=0/10/20/30 约 40 条；`site:mp.weixin.qq.com` 有效，
 *             结果容器的 mu 属性就是真实 mp 地址（无需解析跳转）；
 *             支持 gpc=stf 收录时间窗，按时间排序时默认带 90 天窗，收录延迟以「月」计
 *   Bing      site:mp.weixin.qq.com 也有效，收录普遍比百度新鲜，作为公众号第三路
 *   360       7 条/页，pn 可翻 8 页以上，结果无发布日期
 *   DDG       国内多网络不可达，做熔断跳过，不再拖慢整次搜索
 *
 * 公众号检索 = 搜狗 + 百度 site: + Bing site: + 公众号 RSS（wechat2rss，实时）。
 * RSS 是唯一不受搜索引擎收录延迟影响的一路，配置后「最新文章」从这条路出。
 *
 * 情报源层（intel.js，src='intel' 或安全类关键词自动并入）：
 *   GitHub / NVD / CISA KEV / Exploit-DB / MITRE CVE / 安全客 / 先知 /
 *   FreeBuf / 知道创宇 / 绿盟 / The Hacker News / BleepingComputer /
 *   公众号 RSS 订阅（wechat2rss）—— 全部无 Cookie 验证，不会弹验证码
 * ========================================================================= */

const MAX_CAP = 200;
const SOGOU_MAX_PAGES = 10;
const BAIDU_MAX_PAGES = 4;
const S360_MAX_PAGES = 8;

/** 时间范围 → 天数（时间窗过滤用） */
const RANGE_DAYS = { day: 1, week: 7, month: 30, '3month': 90, year: 365 };
/** 时间范围 → 百度 gpc=stf 时间窗（秒）。百度支持按收录时间过滤，专治「搜出来的都是几个月前的旧文」 */
const BAIDU_WINDOW = { day: 86400, week: 604800, month: 2592000, '3month': 7776000, year: 31536000 };

/** 安全类查询识别：命中就把情报源并进「全部来源」，无需用户手动切换 */
const SECURITY_RE =
  /(cve[-\s]?\d{4}|0[-\s]?day|nday|漏洞|exploit|\bexp\b|\bpoc\b|payload|红队|蓝队|攻防|渗透|提权|内网|木马|后门|病毒|蠕虫|勒索|钓鱼|\bapt\b|malware|ransomware|phishing|hacker|security|安全|加固|应急响应|内存马|webshell|ssrf|sql\s*注入|xss|反序列化|沙箱|供应链|蜜罐|靶场|\bctf\b)/i;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

const DDG_HEADERS = {
  'User-Agent': FIREFOX_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

// 搜狗的指纹校验会拦带 Edg/ 的 UA，这里单独用 Chrome UA
const SOGOU_HEADERS = {
  'User-Agent': CHROME_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

const BAIDU_HEADERS = {
  'User-Agent': CHROME_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
  Referer: 'https://www.baidu.com/',
};

/* 百度的会话 Cookie：没有 BAIDUID 时会话容易被塞进「安全验证」页 */
const baiduJar = { cookies: new Map(), at: 0 };

function baiduCookieHeader() {
  return [...baiduJar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function ensureBaiduSession(force = false) {
  if (!force && baiduJar.cookies.size && Date.now() - baiduJar.at < 10 * 60_000) return;
  if (force) baiduJar.cookies.clear();
  try {
    const res = await fetch('https://www.baidu.com/', {
      headers: { ...BAIDU_HEADERS, Referer: '' },
      signal: AbortSignal.timeout(10000),
    });
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) baiduJar.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    baiduJar.at = Date.now();
    await res.text().catch(() => '');
  } catch {}
}

const isBaiduBlocked = (html) =>
  /<title>[^<]*百度安全验证/.test(html) || (html.length < 5000 && /安全验证|请输入验证码/.test(html));

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

/** 并发映射（限流，避免把免费源打到反爬） */
async function mapLimit(list, limit, fn) {
  const arr = [...list];
  const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (arr.length) {
      const item = arr.shift();
      try {
        await fn(item);
      } catch {}
    }
  });
  await Promise.all(workers);
}

/** 同名源的请求串行化：搜索与监控同时跑时，避免共用会话被打乱 */
const chains = new Map();
function exclusive(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next.then(() => {}, () => {}));
  return next;
}

/* ---------------- 浏览器兜底 ----------------
 * 纯 fetch 被反爬拦死时，用本机 Edge/Chrome 真跑一遍页面：
 * JS 会生成 SNUID 之类会话 Cookie，结果页也能正常渲染。
 */

async function renderPage(url, { waitFor = null, waitMs = 500, timeout = 35000, onPage = null } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(CHROME_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
    if (waitMs) await sleep(waitMs);
    const extra = onPage ? await onPage(page) : null;
    return { html: await page.content(), url: page.url(), extra };
  } finally {
    await page.close().catch(() => {});
  }
}

/** 用浏览器打开搜狗跳转页，等它自己跳到真实 mp 地址 */
async function resolveSogouLinkViaBrowser(link) {
  try {
    const out = await renderPage(link, { waitMs: 1200, timeout: 25000 });
    return /^https?:\/\/mp\.weixin\.qq\.com\//.test(out.url) ? out.url : '';
  } catch {
    return '';
  }
}

const SOGOU_CAPTCHA_HINT = '搜狗要求人工过验证码（按图点击）。可在界面点「打开浏览器过验证」，一次通过后本机 Cookie 会复用一段时间。';

/**
 * 弹出真实浏览器窗口，让人工过一次搜狗验证码；
 * 通过后把该会话 Cookie 灌进搜狗请求池，后续 fetch 就能正常取结果。
 */
export async function openSogouVerify({ timeoutMs = 180000, query = '微信' } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('未找到 Chrome / Edge，请在设置里指定浏览器路径');
  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    defaultViewport: null,
  });
  let ok = false;
  let liCount = 0;
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    await page.goto(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8`, {
      waitUntil: 'domcontentloaded',
      timeout: 40000,
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await page
        .evaluate(() => ({
          li: document.querySelectorAll('.news-list li').length,
          captcha: /antispider/.test(location.href),
        }))
        .catch(() => null);
      if (info?.li) {
        ok = true;
        liCount = info.li;
        break;
      }
      await sleep(1200);
    }
    const cookies = await page.cookies('https://weixin.sogou.com').catch(() => []);
    // 只有真的过了验证才吸收会话，否则不污染现有请求池
    if (ok) {
      for (const c of cookies) sogouJar.cookies.set(c.name, c.value);
      sogouJar.at = Date.now();
      noteOk('sogou');
      sogouBudget.tokens = 15;
    }
    return { ok, links: liCount, cookies: cookies.length, names: cookies.map((c) => c.name).slice(0, 8) };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- 来源标注 ---------------- */

function sourceOf(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes('mp.weixin.qq.com')) return '微信公众号';
    if (h.includes('zhihu')) return '知乎';
    if (h.includes('juejin')) return '掘金';
    if (h.includes('csdn')) return 'CSDN';
    if (h.includes('cnblogs')) return '博客园';
    if (h.includes('github')) return 'GitHub';
    if (h.includes('bilibili')) return 'B站';
    if (h.includes('sohu')) return '搜狐';
    if (h.includes('163.com')) return '网易';
    if (h.includes('qq.com')) return '腾讯';
    if (h.includes('anquanke')) return '安全客';
    if (h.includes('freebuf')) return 'FreeBuf';
    if (h.includes('xz.aliyun')) return '先知社区';
    if (h.includes('seebug')) return '知道创宇';
    if (h.includes('nsfocus')) return '绿盟科技';
    if (h.includes('nvd.nist.gov')) return 'NVD';
    if (h.includes('exploit-db')) return 'Exploit-DB';
    if (h.includes('cisa.gov')) return 'CISA KEV';
    if (h.includes('cve.org') || h.includes('mitre')) return 'MITRE CVE';
    if (h.includes('bleepingcomputer')) return 'BleepingComputer';
    if (h.includes('thehackernews')) return 'The Hacker News';
    if (h.includes('reddit')) return 'Reddit';
    if (h.includes('news.ycombinator')) return 'Hacker News';
    if (h.includes('wechat2rss')) return '微信公众号';
    return h.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const isWeixin = (url) => /^https?:\/\/mp\.weixin\.qq\.com\//.test(String(url || ''));

/* ============================ 搜狗微信 ============================ */

const sogouJar = { cookies: new Map(), at: 0 };
let lastSogouAt = 0;

/* 搜狗请求预算：令牌桶，防止批量翻页把自己的 IP 打进反爬名单
 * 最多 15 个令牌，每 30 秒回 3 个（≈6 次/分钟） */
const sogouBudget = { tokens: 15, at: Date.now() };

function takeSogouToken() {
  const now = Date.now();
  const refill = Math.floor((now - sogouBudget.at) / 30_000) * 3;
  if (refill > 0) {
    sogouBudget.tokens = Math.min(15, sogouBudget.tokens + refill);
    sogouBudget.at = now;
  }
  if (sogouBudget.tokens <= 0) return false;
  sogouBudget.tokens -= 1;
  return true;
}

function cookieHeader() {
  return [...sogouJar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) sogouJar.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  sogouJar.at = Date.now();
}

async function sogouFetch(url, referer, { follow = false } = {}) {
  const res = await fetch(url, {
    headers: {
      ...SOGOU_HEADERS,
      Referer: referer || 'https://weixin.sogou.com/',
      ...(sogouJar.cookies.size ? { Cookie: cookieHeader() } : {}),
    },
    redirect: follow ? 'follow' : 'manual',
    signal: AbortSignal.timeout(15000),
  });
  absorbCookies(res);
  return res;
}

async function ensureSogouSession(force = false) {
  if (!force && sogouJar.cookies.size && Date.now() - sogouJar.at < 8 * 60_000) return;
  await sogouFetch('https://weixin.sogou.com/').catch(() => {});
}

/** 解析 /link?url=... 跳转页里用 JS 拼接的真实地址 */
export async function resolveSogouLink(link) {
  return exclusive('sogouLink', () => resolveSogouLinkInner(link));
}

async function resolveSogouLinkInner(link) {
  if (!/sogou\.com\/link/.test(link)) return link;
  try {
    if (!sogouJar.cookies.size || Date.now() - sogouJar.at > 10 * 60_000) {
      await sogouFetch('https://weixin.sogou.com/');
    }
    let res = await sogouFetch(link);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      if (loc.includes('antispider')) {
        await sogouFetch('https://weixin.sogou.com/weixin?type=2&query=%E5%BE%AE%E4%BF%A1');
        res = await sogouFetch(link);
      }
    }
    const html = await res.text();
    if (/antispider/.test(html) || !/url \+= /.test(html)) return '';
    const parts = [...html.matchAll(/url\s*\+=\s*'([^']*)'/g)].map((m) => m[1]);
    const real = parts.join('').replace(/\\/g, '');
    return /^https?:\/\/mp\.weixin\.qq\.com/.test(real) ? real : '';
  } catch {
    return '';
  }
}

/** 单页解析：.news-list li —— 标题/摘要/公众号名/发布时间 */
function parseSogouList(html) {
  const doc = new JSDOM(html).window.document;
  const out = [];
  for (const li of doc.querySelectorAll('.news-list li')) {
    const a = li.querySelector('.txt-box h3 a') || li.querySelector('h3 a');
    if (!a) continue;
    const href = a.getAttribute('href') || '';
    const url = href.startsWith('http') ? href : `https://weixin.sogou.com${href}`;
    const title = clean(a.textContent);
    if (!title) continue;
    const s2 = li.querySelector('.s2')?.innerHTML || '';
    const epoch = /timeConvert\('(\d{9,13})'\)/.exec(s2)?.[1];
    const d = epoch ? new Date(Number(epoch) * (epoch.length <= 10 ? 1000 : 1)) : null;
    out.push({
      title,
      url,
      originalUrl: url,
      snippet: clean(li.querySelector('.txt-info')?.textContent).slice(0, 220),
      source: '微信公众号',
      account: clean(li.querySelector('.all-time-y2, .account')?.textContent),
      date: d ? isoDate(d) : '',
      provider: 'sogou',
      needsResolve: /sogou\.com\/link/.test(url),
    });
  }
  return out;
}

/**
 * 搜狗微信检索：最多翻到第 10 页（≈100 条/关键词）
 * 注意：搜狗的 sort=1 / tsn / ft / et 参数已被服务端忽略（实测结果与默认完全一致），
 * 所以「按时间」只能靠多翻页 + 本地解析发布日期后排序/过滤。
 * 反爬处理：命中 antispider 时重建会话并重试当前页一次，仍失败则停在那页。
 */
async function searchSogouWeixin(query, max, opts = {}) {
  return exclusive('sogou', () => searchSogouWeixinInner(query, max, opts));
}

async function searchSogouWeixinInner(query, max, { sortBy = 'relevance', pages = 5, resolveOpt = 8, render = false } = {}) {
  const wanted = clampNum(pages, 1, SOGOU_MAX_PAGES, 5);
  // 两次搜狗检索之间至少隔 2.5s，避免同一个 IP 被连击反爬
  if (!render) {
    const since = Date.now() - lastSogouAt;
    if (since < 2500) await sleep(2500 - since);
    lastSogouAt = Date.now();
    await ensureSogouSession();
  }
  const sort = sortBy === 'time' ? '&sort=1' : '';
  const items = [];
  const seen = new Set();
  let blockedPage = 0;

  for (let p = 1; p <= wanted && items.length < max; p++) {
    if (!render && !takeSogouToken()) {
      if (p === 1) throw new Error('搜狗请求额度已用完（每 5 分钟最多 15 次），稍后自动恢复；可先用其它源');
      break;
    }
    const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8${sort}${p > 1 ? `&page=${p}` : ''}`;
    let html = '';
    let blocked = false;

    if (render) {
      // 浏览器模式：让页面自己过反爬校验
      try {
        const out = await renderPage(url, { waitFor: '.news-list li', waitMs: 300 });
        html = out.html;
      } catch (e) {
        if (p === 1 && !items.length) throw new Error(`搜狗浏览器渲染失败（${e.message}）`);
        break;
      }
      if (!/news-list/.test(html)) {
        blockedPage = p;
        if (!items.length) throw new Error(`搜狗微信触发反爬验证（浏览器模式仍被拦）。${SOGOU_CAPTCHA_HINT}`);
        break;
      }
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        let res;
        try {
          res = await sogouFetch(url, 'https://weixin.sogou.com/weixin', { follow: true });
        } catch (e) {
          if (p === 1 && !items.length) throw new Error(`搜狗微信连接失败（${e?.cause?.code || e.message}）`);
          return items;
        }
        html = await res.text();
        blocked = /antispider/.test(String(res.url || '')) || /antispider|请输入验证码|访问过于频繁/.test(html);
        if (!blocked) break;
        sogouJar.cookies.clear();
        await ensureSogouSession(true);
        await jitter(800, 900);
      }

      if (blocked) {
        blockedPage = p;
        if (!items.length) throw new Error(`搜狗微信触发反爬验证。${SOGOU_CAPTCHA_HINT}`);
        break;
      }
    }

    const pageItems = parseSogouList(html);
    if (!pageItems.length) break;

    let added = 0;
    for (const it of pageItems) {
      const k = urlKey(it.url);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
      added++;
      if (items.length >= max) break;
    }
    if (!added) break;
    // 翻页抖动，避免固定节奏被判成爬虫
    await jitter(render ? 600 : 400, render ? 700 : 500);
  }

  // 把前若干条跳转链接换成真实 mp 地址；剩下的转换阶段再解析（省请求，防频控）
  const resolveLimit = Math.min(items.length, clampNum(resolveOpt, 0, 30, 8));
  if (resolveLimit > 0) {
    await mapLimit(items.slice(0, resolveLimit), render ? 1 : 3, async (it) => {
      let real = await resolveSogouLink(it.url);
      // 浏览器模式下，直连解析大概率也被拦，直接用浏览器打开跳转页拿真实地址
      if (!real && render && /sogou\.com\/link/.test(it.url)) {
        real = await resolveSogouLinkViaBrowser(it.url);
      }
      if (real) {
        it.url = real;
        it.needsResolve = false;
      }
      await jitter(100, 160);
    });
  }

  // 解析完成后按真实地址再查一次重（同一篇可能同时命中 sogou 与 mp 直链）
  const uniq = new Set();
  const final = items.filter((it) => {
    const k = urlKey(it.url);
    if (uniq.has(k)) return false;
    uniq.add(k);
    return true;
  });
  return final.slice(0, max);
}

/* ============================ 搜狗网页 ============================ */

async function searchSogouWeb(query, max, { pages = 1 } = {}) {
  const out = [];
  const seen = new Set();
  const wanted = clampNum(pages, 1, 3, 1);
  for (let p = 1; p <= wanted && out.length < max; p++) {
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}${p > 1 ? `&page=${p}` : ''}`;
    const res = await fetch(url, { headers: { ...SOGOU_HEADERS, Referer: 'https://www.sogou.com/' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`搜狗返回 ${res.status}`);
    const html = await res.text();
    if (/请输入验证码|antispider/.test(html)) throw new Error('搜狗触发反爬验证');
    const doc = new JSDOM(html).window.document;
    for (const li of doc.querySelectorAll('.vrwrap, .rb')) {
      const a = li.querySelector('h3 a');
      if (!a) continue;
      let href = a.getAttribute('href') || '';
      if (href.startsWith('/')) href = 'https://www.sogou.com' + href;
      if (!/^https?:/.test(href)) continue;
      const k = urlKey(href);
      if (seen.has(k)) continue;
      seen.add(k);
      const text = clean(li.textContent);
      out.push({
        title: clean(a.textContent),
        url: href,
        snippet: clean(li.querySelector('.text-layout, .str-text-info, .space-txt')?.textContent).slice(0, 220),
        source: sourceOf(href),
        date: parseAnyDate(text),
        provider: 'sogou-web',
        needsResolve: href.includes('sogou.com/link'),
      });
      if (out.length >= max) break;
    }
    await jitter(400, 400);
  }
  return out;
}

/* ============================ 百度 ============================ */

/** 从百度结果容器里取真实地址：优先 mu 属性（无需解跳转） */
function baiduRealUrl(container, a) {
  const mu = container?.getAttribute('mu') || a?.getAttribute('mu') || '';
  if (/^https?:/.test(mu)) return mu;
  const href = a?.getAttribute('href') || '';
  return /^https?:/.test(href) ? href : '';
}

async function searchBaidu(query, max, opts = {}) {
  return exclusive('baidu', () => searchBaiduInner(query, max, opts));
}

async function searchBaiduInner(query, max, { pages = 3, onlyWeixin = false, render = false, timeWindow = 0 } = {}) {
  const wanted = clampNum(pages, 1, BAIDU_MAX_PAGES, 3);
  const out = [];
  const seen = new Set();
  if (!render) await ensureBaiduSession();

  // gpc=stf 时间窗：限定百度只交出窗内收录的结果。
  // 窗内一条都没有时自动去掉时间窗再跑一遍 —— 用户要「最新」，但也不能把存量结果弄丢。
  let stf = '';
  if (timeWindow > 0) {
    const to = Math.floor(Date.now() / 1000);
    stf = `&gpc=${encodeURIComponent(`stf=${to - timeWindow},${to}|stftype=${timeWindow}`)}`;
  }

  for (let p = 0; p < wanted && out.length < max; p++) {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8${stf}&pn=${p * 10}`;
    let html = '';
    let blocked = false;

    if (render) {
      try {
        const out2 = await renderPage(url, { waitFor: '#content_left', waitMs: 400 });
        html = out2.html;
      } catch (e) {
        if (p === 0) throw new Error(`百度浏览器渲染失败（${e.message}）`);
        break;
      }
      blocked = isBaiduBlocked(html);
      if (blocked) {
        if (!out.length) throw new Error('百度安全验证未通过（浏览器模式）');
        break;
      }
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(url, {
          headers: { ...BAIDU_HEADERS, ...(baiduJar.cookies.size ? { Cookie: baiduCookieHeader() } : {}) },
          signal: AbortSignal.timeout(15000),
        }).catch((e) => {
          if (p === 0) throw new Error(`百度连接失败（${e?.cause?.code || e.message}）`);
          return null;
        });
        if (!res) return out;
        if (!res.ok) throw new Error(`百度返回 ${res.status}`);
        for (const line of res.headers.getSetCookie?.() || []) {
          const [pair] = line.split(';');
          const i = pair.indexOf('=');
          if (i > 0) baiduJar.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
        html = await res.text();
        blocked = isBaiduBlocked(html);
        if (!blocked) break;
        // 换会话再来一次（Cookie 过期或被塞验证页时有效）
        await ensureBaiduSession(true);
        await jitter(1200, 800);
      }

      if (blocked) {
        if (!out.length) throw new Error('百度触发安全验证，稍后自动恢复（已熔断 2 分钟）');
        break;
      }
    }

    const doc = new JSDOM(html).window.document;
    const containers = [
      ...doc.querySelectorAll('#content_left div.result, #content_left div.c-container, div.result.c-container, div.result'),
    ];
    if (!containers.length) break;

    for (const c of containers) {
      const h3 = c.querySelector('h3');
      const a = h3?.querySelector('a') || c.querySelector('h3 a') || c.querySelector('a[href]');
      if (!h3 || !a) continue;
      const real = baiduRealUrl(c, a);
      if (!real) continue;
      // 百度会把图片/视频站混进网页结果，过滤掉
      if (/image\.baidu\.com|v\.baidu\.com/i.test(real)) continue;
      const title = clean(h3.textContent);
      if (!title) continue;
      if (onlyWeixin && !isWeixin(real)) continue;
      const k = urlKey(real);
      if (seen.has(k)) continue;
      seen.add(k);

      const snippetRaw =
        c.querySelector('.c-abstract')?.textContent ||
        c.querySelector('[class*="content-right"]')?.textContent ||
        c.querySelector('.c-span-last')?.textContent ||
        '';
      const text = clean(c.textContent);
      out.push({
        title,
        url: real,
        snippet: clean(snippetRaw).slice(0, 220) || text.slice(0, 120),
        source: isWeixin(real) ? '微信公众号' : sourceOf(real),
        account: onlyWeixin ? clean(c.querySelector('[class*="source"], .c-showurl')?.textContent).slice(0, 40) : '',
        date: parseAnyDate(text),
        provider: onlyWeixin ? 'baidu-wx' : 'baidu',
        needsResolve: /baidu\.com\/link/.test(real),
      });
      if (out.length >= max) break;
    }
    await jitter(450, 450);
  }
  if (!out.length && timeWindow > 0) {
    return searchBaiduInner(query, max, { pages, onlyWeixin, render });
  }
  return out;
}

/* ============================ 360 搜索 ============================ */

async function search360(query, max, { pages = 3 } = {}) {
  const wanted = clampNum(pages, 1, S360_MAX_PAGES, 3);
  const out = [];
  const seen = new Set();

  for (let p = 1; p <= wanted && out.length < max; p++) {
    const url = `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=${p}`;
    const res = await fetch(url, { headers: SOGOU_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`360 搜索返回 ${res.status}`);
    const html = await res.text();
    const doc = new JSDOM(html).window.document;
    const lists = [...doc.querySelectorAll('.res-list')];
    if (!lists.length) break;

    for (const li of lists) {
      const a = li.querySelector('h3 a');
      const real = a?.getAttribute('data-mdurl') || '';
      if (!/^https?:/.test(real)) continue;
      const title = clean(a.textContent);
      if (!title) continue;
      const k = urlKey(real);
      if (seen.has(k)) continue;
      seen.add(k);
      const snippet = clean(li.querySelector('.res-desc, .res-rich')?.textContent);
      const text = clean(li.textContent);
      out.push({
        title,
        url: real,
        snippet: snippet.slice(0, 220),
        source: sourceOf(real),
        date: parseCnDate(`${snippet} ${text}`),
        provider: 'so360',
      });
      if (out.length >= max) break;
    }
    await jitter(300, 350);
  }
  return out;
}

/* ============================ Bing ============================ */

/** Bing 时间过滤（qft=interval）：6=24小时 7=一周 8=一个月 9=一年；不支持会被忽略 */
const BING_QFT = { day: '6', week: '7', month: '8', '3month': '8', year: '9' };

async function searchBing(query, max, { timeRange = '', requireHost = '' } = {}) {
  const qft = BING_QFT[timeRange] ? `&qft=${encodeURIComponent(`interval="${BING_QFT[timeRange]}"`)}` : '';
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(max, 10)}&setlang=zh-CN&ensearch=0${qft}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Bing 返回 ${res.status}`);
  const html = await res.text();
  const doc = new JSDOM(html).window.document;
  return [...doc.querySelectorAll('li.b_algo')]
    .slice(0, max)
    .map((li) => {
      const a = li.querySelector('h2 a');
      if (!a) return null;
      const href = a.getAttribute('href') || '';
      if (!/^https?:/.test(href)) return null;
      const snippet = clean(li.querySelector('.b_caption p, .b_lineclamp2, .b_algoSlug')?.textContent);
      return {
        title: clean(a.textContent),
        url: normalizeUrl(href),
        snippet,
        source: sourceOf(href),
        date: parseCnDate(clean(li.textContent)) || parseCnDate(snippet),
        provider: 'bing',
      };
    })
    .filter(Boolean)
    // Bing 在 site: 命中太少时会自动「放宽查询」混入无关站点，这里按调用方要求收紧
    .filter((r) => !requireHost || r.url.includes(requireHost));
}

/* ============================ Bing 资讯 RSS（免验证码的实时源） ============================
 * cn.bing.com/news/search 的 RSS 输出：不用翻页、不弹验证码、自带 pubDate，
 * 是网页侧除 Tavily 外时效最好的一路 —— 抓「刚刚发生/这几天」的内容优先看它。
 */

async function searchBingNews(query, { timeRange = '' } = {}) {
  const qft = BING_QFT[timeRange] ? `&qft=${encodeURIComponent(`interval="${BING_QFT[timeRange]}"`)}` : '';
  const url = `https://cn.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS${qft}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Bing 资讯返回 ${res.status}`);
  const xml = await res.text();
  if (!/<item[\s>]/i.test(xml)) return [];
  return parseFeed(xml)
    .map((it) => ({
      title: it.title,
      url: it.link,
      snippet: it.summary,
      source: sourceOf(it.link) || 'Bing 资讯',
      account: 'Bing 资讯',
      date: it.date,
      provider: 'bing-news',
    }))
    .slice(0, 30);
}

/* ============================ DuckDuckGo ============================ */

export async function searchDuckDuckGo(query, max, { timeRange = '', pages = 1 } = {}) {
  const DF_MAP = { day: 'd', week: 'w', month: 'm', year: 'y' };
  const df = DF_MAP[timeRange] ? `&df=${DF_MAP[timeRange]}` : '';
  const out = [];
  const seen = new Set();
  const wanted = clampNum(pages, 1, 3, 1);

  for (let p = 0; p < wanted && out.length < max; p++) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh${df}${p ? `&s=${p * 30}` : ''}`;
    const res = await fetch(url, { headers: DDG_HEADERS, signal: AbortSignal.timeout(6000) }).catch((e) => {
      throw new Error(`DuckDuckGo 连接失败（${e?.cause?.code || e.message}）`);
    });
    if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`);
    const html = await res.text();
    if (/anomaly-modal|challenge-form|unusual traffic/i.test(html)) {
      throw new Error('DuckDuckGo 触发限流');
    }
    const doc = new JSDOM(html).window.document;
    const rows = [...doc.querySelectorAll('.result, .web-result')];
    if (!rows.length) break;
    for (const li of rows) {
      const a = li.querySelector('a.result__a');
      if (!a) continue;
      let href = a.getAttribute('href') || '';
      try {
        if (href.startsWith('//')) href = 'https:' + href;
        const u = new URL(href);
        const target = u.searchParams.get('uddg');
        if (target) href = decodeURIComponent(target);
      } catch {}
      if (!/^https?:/.test(href)) continue;
      const k = urlKey(href);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        title: clean(a.textContent),
        url: k,
        snippet: clean(li.querySelector('.result__snippet')?.textContent),
        source: sourceOf(href),
        date: parseCnDate(clean(li.textContent)),
        provider: 'duckduckgo',
      });
      if (out.length >= max) break;
    }
    await jitter(600, 600);
  }
  return out;
}

/* ============================ Tavily ============================ */

async function searchTavily(query, max, { timeRange = '' } = {}) {
  const key = settings().search?.tavilyKey;
  if (!key) throw new Error('未配置 Tavily API Key');
  // 限了短时间窗（24 小时 / 一周）时切 news 话题并带 days，Tavily 会按发布时间拉新内容
  const days = { day: 1, week: 7 }[timeRange];
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: Math.min(max, 20),
      search_depth: 'basic',
      include_answer: false,
      ...(days ? { topic: 'news', days } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Tavily 返回 ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: normalizeUrl(r.url),
    snippet: (r.content || '').slice(0, 220),
    source: sourceOf(r.url),
    date: r.published_date?.slice(0, 10) || '',
    provider: 'tavily',
  }));
}

/* ============================ 聚合 ============================ */

const CACHE = new Map();
const CACHE_TTL = 3 * 60_000;

/* ---------------- 关键词匹配（中文友好） ----------------
 * 旧逻辑只按空格切词：「内存取证教程」会被当成一整串去标题里找，
 * 标题写成「内存取证入门教程」就判成无关被过滤。这里改成：
 *   英文/数字按词，中文连续串按整串 + 二元组（bigram）部分匹配，停用词不计分。
 */
const STOP_CN = /^(的|了|和|与|及|或|在|是|吗|呢|啊|怎么|如何|什么|哪些|为什么|一个|一些|关于)$/;
const STOP_CN_EDGE = /^(的|了|和|与|及|或|在|是|怎么|如何|什么)+|(的|了|吗|呢|啊)+$/g;

export function queryTerms(query) {
  const out = [];
  const seen = new Set();
  const raw = String(query || '').toLowerCase().replace(/site:\S+/g, ' ');
  const pieces = [];
  for (const m of raw.matchAll(/[a-z0-9][a-z0-9._+#-]*|[㐀-鿿]+/g)) {
    // 中文串在「的/和/与/及/或」处再断开：「逆向的方法」→「逆向」「方法」
    if (/^[㐀-鿿]/.test(m[0])) pieces.push(...m[0].split(/[的和与及或]/).filter(Boolean));
    else pieces.push(m[0]);
  }
  for (const piece of pieces) {
    let t = piece;
    if (/^[㐀-鿿]/.test(t)) t = t.replace(STOP_CN_EDGE, '');
    if (!t || STOP_CN.test(t)) continue;
    if (/^[a-z0-9]/.test(t) && t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    const cjk = /^[㐀-鿿]+$/.test(t);
    const grams = [];
    if (cjk && t.length > 2) for (let i = 0; i < t.length - 1; i++) grams.push(t.slice(i, i + 2));
    out.push({ text: t, cjk, grams });
  }
  return out;
}

/** 单个词在文本里的命中度：整串命中 1；中文长串按二元组覆盖率给部分分 */
function termHit(hay, term) {
  if (hay.includes(term.text)) return 1;
  if (!term.grams.length) return 0;
  let n = 0;
  for (const g of term.grams) if (hay.includes(g)) n++;
  const frac = n / term.grams.length;
  return frac >= 0.5 ? frac * 0.9 : 0;
}

/** 结果与查询的匹配度 0~1：标题权重高，标题+摘要+公众号名兜底 */
export function matchScore(r, terms) {
  if (!terms.length) return { title: 1, all: 1 };
  const title = String(r.title || '').toLowerCase().replace(/\s+/g, '');
  const all = `${title} ${String(r.snippet || '').toLowerCase()} ${String(r.account || '').toLowerCase()}`;
  let t = 0;
  let a = 0;
  for (const term of terms) {
    t += termHit(title, term);
    a += termHit(all, term);
  }
  return { title: t / terms.length, all: a / terms.length };
}

/** 轮转合并：每个源轮流出一条，避免单源刷屏 */
function interleave(groups) {
  const lists = groups.filter((g) => g.items?.length).map((g) => g.items.slice());
  const out = [];
  let i = 0;
  while (lists.some((l) => i < l.length)) {
    for (const l of lists) if (l[i]) out.push(l[i]);
    i++;
  }
  return out;
}

/**
 * 去重：URL → 完全同名 → 长标题高相似
 * 短标题（<20 字）不做相似度合并，避免「内存取证（一）/（二）」被吃掉
 */
function dedupe(results) {
  const urls = new Set();
  const titles = new Map(); // 规范化标题 -> 日期
  const kept = [];
  const keptBg = [];
  for (const r of results) {
    const u = urlKey(r.url);
    if (!u || urls.has(u)) continue;
    const tName = normalizeName(r.title);
    // 同名但日期不同 → 可能是不同账号的同名栏目，保留
    if (tName && titles.has(tName)) {
      const prevDate = titles.get(tName);
      if (!prevDate || !r.date || prevDate === r.date) continue;
    }
    const t = String(r.title || '');
    if (t.length >= 20) {
      const bg = bigrams(t);
      if (bg.size) {
        let dup = false;
        for (const prev of keptBg) {
          let inter = 0;
          for (const x of bg) if (prev.bg.has(x)) inter++;
          if (inter / Math.min(bg.size, prev.bg.size) >= 0.92 && (!prev.date || !r.date || prev.date === r.date)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        keptBg.push({ bg, date: r.date || '' });
      }
    }
    urls.add(u);
    if (tName) titles.set(tName, r.date || '');
    kept.push(r);
  }
  return kept;
}

/**
 * @param {string} query
 * @param {{provider?:string,max?:number,wechatOnly?:boolean,sources?:'all'|'wechat'|'web'|'intel',
 *          timeRange?:string,sortBy?:string,pages?:number,fresh?:boolean}} opts
 */
export async function searchWeb(query, opts = {}) {
  const { provider, max, wechatOnly, sources, timeRange = '', sortBy = 'relevance', pages, fresh = false } = opts;
  const cfg = settings().search || {};
  const n = Math.min(Math.max(Number(max || cfg.maxResults || 30), 1), MAX_CAP);
  const webProvider = provider || cfg.provider || 'baidu';
  const src = sources || (wechatOnly ? 'wechat' : 'all');
  const pickedPages = Number(pages) > 0 ? Number(pages) : 0;
  const wxPages = pickedPages || clampNum(cfg.wechatPages, 1, SOGOU_MAX_PAGES, 5);
  const webPages = pickedPages || clampNum(cfg.webPages, 1, BAIDU_MAX_PAGES, 3);

  // 百度时间窗：显式选了时间范围就按它过滤；只选了「按时间」排序而没选范围时，
  // 用 90 天窗口逼搜索引擎交出较新的收录（公众号文章的收录延迟经常以月计），
  // 窗内没结果会自动回退全量检索，不会空屏
  const baiduWindow = RANGE_DAYS[timeRange] ? BAIDU_WINDOW[timeRange] : sortBy === 'time' ? 90 * 86400 : 0;

  // 缓存只按「查询+源+时间+排序」记，条数从缓存里切；
  // 已缓存的页数 ≥ 本次请求就直接复用，避免用户反复点搜索把搜狗打到反爬
  const cacheBase = [query, src, timeRange, sortBy, webProvider].join('|');
  const hit = CACHE.get(cacheBase);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL && (hit.data.pages?.wechat || 0) >= wxPages) {
    const cached = hit.data;
    return { ...cached, count: cached.results.length, results: cached.results.slice(0, n), cached: true };
  }

  const errors = [];
  const notes = [];
  const tasks = [];

  if (src === 'wechat' || src === 'all') {
    tasks.push({
      name: 'sogou',
      // 直连被反爬 → 自动换内置浏览器会话再跑一遍（速度慢一点，但能拿到结果）
      run: async () => {
        const resolveOpt = settings().search?.resolveLinks ?? 8;
        try {
          return await searchSogouWeixin(query, n, { pages: wxPages, sortBy, resolveOpt });
        } catch (e) {
          if (!/反爬|验证|额度/.test(e.message)) throw e;
          const items = await searchSogouWeixin(query, Math.min(n, 60), {
            pages: Math.min(wxPages, 5),
            sortBy,
            resolveOpt: Math.min(resolveOpt, 5),
            render: true,
          });
          if (!items.length) throw e;
          notes.push('搜狗直连被反爬拦截，已用内置浏览器会话取回结果（可稍后重试以获得更多页）');
          return items;
        }
      },
    });
    // 百度 site: 能补到搜狗翻不到的公众号文章，且直接给真实 mp 地址；
    // 带时间窗检索，避免百度索引里几个月前的旧文霸屏
    tasks.push({
      name: 'baidu-wx',
      run: async () => {
        try {
          return await searchBaidu(`site:mp.weixin.qq.com ${query}`, n, { pages: Math.min(webPages, 4), onlyWeixin: true, timeWindow: baiduWindow });
        } catch (e) {
          if (!/验证/.test(e.message)) throw e;
          const items = await searchBaidu(`site:mp.weixin.qq.com ${query}`, Math.min(n, 40), {
            pages: Math.min(webPages, 2),
            onlyWeixin: true,
            render: true,
            timeWindow: baiduWindow,
          });
          if (!items.length) throw e;
          notes.push('百度触发安全验证，已用内置浏览器会话取回公众号结果');
          return items;
        }
      },
    });
    // Bing 对 mp.weixin.qq.com 的收录普遍比百度新鲜，作为公众号第三路补充。
    // requireHost 必须带上：Bing 在 site: 命中太少时会自动放宽查询混入无关站点
    tasks.push({ name: 'bing-wx', run: () => searchBing(`site:mp.weixin.qq.com ${query}`, n, { timeRange, requireHost: 'mp.weixin.qq.com' }) });
    // 公众号 RSS 订阅（wechat2rss 等）：唯一「实时」的一路 —— feed 里就是刚推送的文章。
    // 搜索引擎收录要几天到几个月，配置了 RSS 后最新内容从这里出。
    if ((cfg.weixinFeeds || []).length) {
      tasks.push({
        name: 'wxrss',
        run: async () => {
          const items = await searchWeixinFeeds(query, { max: n });
          if (items.length) notes.push(`已并入公众号 RSS 实时源：${items.length} 条（feed 是刚推送的内容，不受搜索引擎收录延迟影响）`);
          return items;
        },
      });
    }
  }

  if (src === 'web' || src === 'all') {
    tasks.push({ name: 'baidu', run: () => searchBaidu(query, n, { pages: Math.min(webPages, 4), timeWindow: baiduWindow }) });
    tasks.push({ name: 'so360', run: () => search360(query, n, { pages: Math.min(webPages, S360_MAX_PAGES) }) });
    // Bing 资讯 RSS：免验证码、自带发布日期、时效最好的一路，「找最新」优先看它
    tasks.push({ name: 'bing-news', run: () => searchBingNews(query, { timeRange }) });
    if (webProvider === 'bing') tasks.push({ name: 'bing', run: () => searchBing(query, n, { timeRange }) });
    if (webProvider === 'duckduckgo') tasks.push({ name: 'duckduckgo', run: () => searchDuckDuckGo(query, n, { timeRange }) });
    if (webProvider === 'tavily') tasks.push({ name: 'tavily', run: () => searchTavily(query, n, { timeRange }) });
    if (webProvider === 'sogou-web' || webProvider === 'sogou') tasks.push({ name: 'sogou-web', run: () => searchSogouWeb(query, n, { pages: 1 }) });
  }
  // 没选时间范围时，再并一路「近期收录」快查：搜索引擎默认按相关度排序，新文常被老文压在后几页。
  // 只用 Bing（免验证码、无频控）；百度多打一次就容易触发安全验证，所以不加。
  if (!RANGE_DAYS[timeRange] && src !== 'intel' && opts.recent !== false) {
    if (src === 'wechat' || src === 'all') {
      tasks.push({ name: 'bing-wx-recent', run: () => searchBing(`site:mp.weixin.qq.com ${query}`, Math.min(n, 30), { timeRange: 'month', requireHost: 'mp.weixin.qq.com' }) });
    }
    if (src === 'web' || src === 'all') {
      tasks.push({ name: 'bing-recent', run: () => searchBing(query, Math.min(n, 30), { timeRange: 'month' }) });
    }
  }

  if (src === 'wechat' && webProvider === 'tavily' && settings().search?.tavilyKey) {
    tasks.push({ name: 'tavily', run: () => searchTavily(`site:mp.weixin.qq.com ${query}`, n, { timeRange }) });
  }

  // 情报源：显式选「安全情报」，或「全部来源」遇到安全类关键词自动并入。
  // 全部来自官方 API 与社区 RSS，不走搜索引擎 —— 永远不弹 Cookie 验证。
  let intelGroups = [];
  if (src === 'intel' || (src === 'all' && cfg.intelInAll !== false && SECURITY_RE.test(query))) {
    tasks.push({
      name: 'intel',
      run: async () => {
        const out = await intelSearch(query, { max: n, timeRange, deep: cfg.intelDeep !== false });
        intelGroups = out.groups || [];
        for (const e of out.errors || []) errors.push(`情报源 ${e}`);
        const hit = intelGroups.filter((g) => g.items.length);
        if (hit.length) notes.push(`已并入情报源：${hit.map((g) => `${g.name}×${g.items.length}`).join('、')}`);
        return out.items || [];
      },
    });
  }

  // 熔断：冷却中的源直接跳过，不拖慢整次搜索
  const runnable = [];
  for (const t of tasks) {
    if (isDown(t.name)) {
      const h = healthDetail(t.name);
      const wait = h ? Math.round((h.skipUntil - Date.now()) / 1000) : 0;
      errors.push(`${t.name} 冷却中（${wait}s），本轮跳过`);
      continue;
    }
    if (runnable.some((x) => x.name === t.name)) continue;
    runnable.push(t);
  }

  const groups = await Promise.all(
    runnable.map(async (t) => {
      try {
        const items = (await t.run()) || [];
        if (items.length) noteOk(t.name);
        return { name: t.name, items };
      } catch (e) {
        noteFail(t.name, e.message);
        errors.push(`${t.name}: ${e.message}`);
        return { name: t.name, items: [] };
      }
    })
  );

  // 主源全挂 → 网页侧自动降级一次
  if (!groups.some((g) => g.items.length) && src !== 'wechat') {
    for (const [alt, fn] of [
      ['baidu', () => searchBaidu(query, n, { pages: 2 })],
      ['so360', () => search360(query, n, { pages: 2 })],
      ['bing', () => searchBing(query, n, { timeRange })],
    ]) {
      if (groups.some((g) => g.name === alt)) continue;
      try {
        const items = await fn();
        if (items.length) {
          groups.push({ name: alt, items });
          errors.push(`已自动切换到 ${alt}`);
          break;
        }
      } catch (e) {
        errors.push(`${alt}: ${e.message}`);
      }
    }
  }

  // 搜狗条数太少时，用「去重分词」再补一轮（公众号搜索常因短语太严而漏结果）
  const sogouGroup = groups.find((g) => g.name === 'sogou');
  const tokens = String(query).split(/\s+/).filter(Boolean);
  const qTerms0 = queryTerms(query);
  if (sogouGroup && sogouGroup.items.length < 8 && (tokens.length > 1 || qTerms0.length > 1)) {
    // 有空格就去重；没空格的中英混排（如「volatility使用教程」）按中英边界拆开再搜
    const loose = tokens.length > 1 ? [...new Set(tokens)].join(' ') : qTerms0.map((t) => t.text).join(' ');
    if (loose !== query) {
      try {
        const extra = await searchSogouWeixin(loose, Math.min(20, n), { pages: 2, sortBy });
        if (extra.length) {
          sogouGroup.items.push(...extra);
          notes.push(`「${query}」结果偏少，已用简化词「${loose}」补搜 ${extra.length} 条`);
        }
      } catch {}
    }
  }

  let results = dedupe(interleave(groups));

  // 时间窗过滤：按解析出的发布日期；无日期的结果排到尾部保留（不静默丢弃）
  let timeDropped = 0;
  let timeFallback = false;
  let newestDate = '';
  if (timeRange && RANGE_DAYS[timeRange]) {
    const cutoff = Date.now() - RANGE_DAYS[timeRange] * 86400_000;
    const freshKnown = [];
    const unknown = [];
    const oldKnown = [];
    for (const r of results) {
      const t = tsOf(r.date);
      if (!t) {
        r.dateUnknown = true;
        unknown.push(r);
      } else if (t >= cutoff) freshKnown.push(r);
      else oldKnown.push(r);
    }
    timeDropped = oldKnown.length;
    if (freshKnown.length) {
      // 无日期的结果可能是新文，放尾部但限量，避免 360 之类无声明的结果刷屏
      results = freshKnown.concat(unknown.slice(0, Math.max(12, Math.round(n * 0.4))));
      if (timeDropped) notes.push(`已按发布时间过滤掉 ${timeDropped} 条时间范围外的旧文`);
    } else {
      // 范围内确实没有新文：把最新的若干条兜出来并标记超范围，而不是空屏
      const dated = oldKnown.slice().sort((a, b) => tsOf(b.date) - tsOf(a.date));
      newestDate = dated[0]?.date || '';
      results = dated.slice(0, Math.min(n, 30)).map((r) => ({ ...r, outOfRange: true }));
      if (dated.length) {
        timeFallback = true;
        notes.push(
          `所选时间范围内没有新内容，以下是最新的 ${results.length} 条（最近一条 ${newestDate}）；可放宽时间窗或看监控累积结果`
        );
      }
    }
  }

  // 排序
  const qTerms = queryTerms(query);
  // 完整短语（去空格）用于命中中文标题——标题里通常不带空格
  const qPhrase = String(query).toLowerCase().replace(/\s+/g, '');
  if (sortBy === 'time') {
    // 按发布时间从新到旧；解析不出日期的结果固定垫底，不冒充新文
    results.sort((a, b) => tsOf(b.date) - tsOf(a.date));
    const dated = results.filter((r) => r.date).length;
    if (results.length && dated < Math.ceil(results.length / 2)) {
      notes.push(`${results.length} 条里只有 ${dated} 条解析到了发布日期，时间排序对这些准确，其余垫底展示`);
    }
  } else {
    const score = (r) => {
      const t = String(r.title || '').toLowerCase();
      const m = matchScore(r, qTerms);
      // 匹配度为主：标题覆盖 0~6 分，标题+摘要+公众号 0~3 分
      let v = m.title * 6 + m.all * 3;
      // 整个查询短语直接出现在标题里 → 强相关
      if (qPhrase.length > 1 && t.replace(/\s+/g, '').includes(qPhrase)) v += 3;
      // 新鲜度加权：匹配度相近时新文明显靠前，一年以上的老文降一档
      if (r.date) {
        const age = Date.now() - tsOf(r.date);
        if (age >= 0 && age < 3 * 86400_000) v += 2.5;
        else if (age >= 0 && age < 7 * 86400_000) v += 2;
        else if (age >= 0 && age < 30 * 86400_000) v += 1.2;
        else if (age >= 0 && age < 90 * 86400_000) v += 0.5;
        else if (age > 365 * 86400_000) v -= 1;
      } else {
        v -= 0.3;
      }
      return v;
    };
    results = results
      .map((r, i) => ({ r, i, v: score(r) }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map((x) => x.r);
  }

  // 关键词相关度门禁：搜索引擎（尤其搜狗微信）在窗内没内容时会回一堆「只沾边」的结果
  //（标题里带个「内存」就算命中），混在按时间排序的列表里最干扰。
  // 相关结果够多 → 直接过滤掉无关的；有相关的 → 无关的沉底；全都不相关 → 明说，不装作有结果。
  if (qTerms.length && results.length > 4) {
    // 覆盖一半以上查询词（中文长词按二元组算部分覆盖）才算相关
    const rel = (r) => (matchScore(r, qTerms).all >= 0.5 ? 1 : 0);
    const relevant = results.filter((r) => rel(r) > 0);
    if (relevant.length >= 5 && relevant.length < results.length) {
      notes.push(`已过滤 ${results.length - relevant.length} 条与「${query}」无关的结果`);
      results = relevant;
    } else if (relevant.length && relevant.length < results.length) {
      results = relevant.concat(results.filter((r) => rel(r) === 0));
      notes.push('没对上关键词的结果已沉底展示');
    } else if (!relevant.length) {
      notes.push(`这个时间范围内没有与「${query}」直接相关的结果，以下是搜索引擎给出的近似内容`);
    }
  }

  const stats = {};
  for (const g of groups) stats[g.name] = g.items.length;
  for (const g of intelGroups) if (g.items?.length) stats[g.name] = g.items.length;

  const payload = {
    query,
    provider: groups.map((g) => g.name).join('+') || webProvider,
    sources: src,
    timeRange,
    sortBy,
    pages: { wechat: wxPages, web: webPages },
    count: results.length,
    results: results.slice(0, n),
    stats,
    timeDropped,
    timeFallback,
    newestDate,
    errors,
    notes,
  };
  // 缓存存满（最多 MAX_CAP），这样用户换「结果条数」时不用重新打源
  if (results.length) {
    CACHE.set(cacheBase, { at: Date.now(), data: { ...payload, results: results.slice(0, MAX_CAP) } });
  }
  return payload;
}

/** 从文章标题/标签生成相关检索词 */
export function buildRelatedQueries(article) {
  const t = (article.title || '').replace(/[《》【】\[\]()（）|]/g, ' ').trim();
  const base = t.split(/\s+/).filter(Boolean).slice(0, 1).join(' ');
  const tags = (article.tags || []).slice(0, 2).join(' ');
  const qs = new Set();
  if (base) qs.add(base);
  if (tags) qs.add(tags);
  const firstHeading = article.outline?.[0]?.text;
  if (firstHeading && firstHeading.length > 3) qs.add(firstHeading);
  return [...qs].slice(0, 3);
}

/* ---------------- 微信文章反查（搜狗链接被反爬时用标题兜底） ---------------- */

/** 用标题反查 mp.weixin.qq.com 原文：百度 site: 优先（直出真链），DDG/Bing 兜底 */
export async function resolveWeixinByTitle(title, { maxCandidates = 4 } = {}) {
  const cleanTitle = String(title || '')
    .replace(/[【】\[\]《》()（）|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanTitle.length < 3) return null;

  let candidates = [];
  for (const fn of [
    () => searchBaidu(`site:mp.weixin.qq.com ${cleanTitle}`, 12, { pages: 1, onlyWeixin: true }),
    () => searchDuckDuckGo(`site:mp.weixin.qq.com ${cleanTitle}`, 10),
    () => searchBing(`site:mp.weixin.qq.com ${cleanTitle}`, 10),
  ]) {
    try {
      const got = (await fn()).filter((r) => /mp\.weixin\.qq\.com\/s/.test(r.url));
      if (got.length) {
        candidates = got;
        break;
      }
    } catch {}
  }
  if (!candidates.length) return null;

  let best = null;
  for (const c of candidates.slice(0, maxCandidates)) {
    try {
      const res = await fetch(c.url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      const html = await res.text();
      const realTitle = /id="activity-name"[^>]*>([\s\S]{0,400}?)<\//
        .exec(html)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const score = realTitle ? titleSimilarity(realTitle, cleanTitle) : 0;
      if (!best || score > best.score) best = { url: c.url, title: realTitle || '', score };
      if (score >= 0.85) break;
    } catch {}
  }
  return best && best.score >= 0.5 ? best : null;
}
