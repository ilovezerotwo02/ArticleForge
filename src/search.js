import { JSDOM } from 'jsdom';
import { UA, settings } from './config.js';
import { normalizeUrl } from './store.js';

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[\s\-_·、,，。.:：!！?？'"“”‘’()（）\[\]【】#]/g, '')
    .trim();
}

const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

// 搜狗的指纹校验会拦带 Edg/ 的 UA，这里单独用 Chrome UA
const SOGOU_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

function sourceOf(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes('mp.weixin.qq.com')) return 'wechat';
    if (h.includes('zhihu')) return '知乎';
    if (h.includes('juejin')) return '掘金';
    if (h.includes('csdn')) return 'CSDN';
    if (h.includes('cnblogs')) return '博客园';
    if (h.includes('github')) return 'GitHub';
    if (h.includes('bilibili')) return 'B站';
    return h.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const DF_MAP = { day: 'd', week: 'w', month: 'm', year: 'y' };
const TSN_MAP = { day: '1', week: '2', month: '3', year: '4' };

export async function searchDuckDuckGo(query, max, { timeRange = '' } = {}) {
  const df = DF_MAP[timeRange] ? `&df=${DF_MAP[timeRange]}` : '';
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh${df}`;
  // DDG 偶发连接超时，重试只会让搜索更慢，失败交给降级链
  const res = await fetch(url, { headers: DDG_HEADERS, signal: AbortSignal.timeout(6000) }).catch((e) => {
    throw new Error(`DuckDuckGo 连接失败（${e?.cause?.code || e.message}），已用其它源兜底`);
  });
  if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`);
  const html = await res.text();
  if (/anomaly-modal|challenge-form|unusual traffic/i.test(html)) {
    throw new Error('DuckDuckGo 触发限流，请稍后再试或换 Tavily');
  }
  const doc = new JSDOM(html).window.document;
  const decode = (href) => {
    if (!href) return '';
    try {
      if (href.startsWith('//')) href = 'https:' + href;
      const u = new URL(href);
      const target = u.searchParams.get('uddg');
      return target ? decodeURIComponent(target) : href;
    } catch {
      return href;
    }
  };
  return [...doc.querySelectorAll('.result, .web-result')]
    .map((li) => {
      const a = li.querySelector('a.result__a');
      if (!a) return null;
      const href = decode(a.getAttribute('href') || '');
      if (!/^https?:/.test(href)) return null;
      return {
        title: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        url: normalizeUrl(href),
        snippet: (li.querySelector('.result__snippet')?.textContent || '').replace(/\s+/g, ' ').trim(),
        source: sourceOf(href),
        provider: 'duckduckgo',
      };
    })
    .filter(Boolean)
    .slice(0, max);
}

async function searchSogouWeb(query, max) {
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { ...HEADERS, Referer: 'https://www.sogou.com/' } });
  if (!res.ok) throw new Error(`搜狗返回 ${res.status}`);
  const html = await res.text();
  if (/请输入验证码|antispider/.test(html)) throw new Error('搜狗触发反爬验证');
  const doc = new JSDOM(html).window.document;
  return [...doc.querySelectorAll('.vrwrap, .rb')]
    .map((li) => {
      const a = li.querySelector('h3 a');
      if (!a) return null;
      let href = a.getAttribute('href') || '';
      if (href.startsWith('/')) href = 'https://www.sogou.com' + href;
      return {
        title: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        url: href,
        snippet: (li.querySelector('.text-layout, .str-text-info, .space-txt')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
        source: sourceOf(href),
        provider: 'sogou-web',
        needsResolve: href.includes('sogou.com/link'),
      };
    })
    .filter(Boolean)
    .slice(0, max);
}

async function searchBing(query, max, { timeRange = '' } = {}) {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(max, 10)}&setlang=zh-CN&ensearch=0`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Bing 返回 ${res.status}`);
  const html = await res.text();
  const doc = new JSDOM(html).window.document;
  const items = [...doc.querySelectorAll('li.b_algo')].slice(0, max);
  return items
    .map((li) => {
      const a = li.querySelector('h2 a');
      if (!a) return null;
      const href = a.getAttribute('href') || '';
      if (!/^https?:/.test(href)) return null;
      const snippet = (li.querySelector('.b_caption p, .b_lineclamp2, .b_algoSlug')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        title: (a.textContent || '').trim(),
        url: normalizeUrl(href),
        snippet,
        source: sourceOf(href),
        provider: 'bing',
      };
    })
    .filter(Boolean);
}

/* --- 搜狗会话 Cookie（拿到结果页 Cookie 后，跳转链接才不会被反爬拦截） --- */

const sogouJar = { cookies: new Map(), at: 0 };

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
    headers: { ...SOGOU_HEADERS, Referer: referer || 'https://weixin.sogou.com/', ...(sogouJar.cookies.size ? { Cookie: cookieHeader() } : {}) },
    redirect: follow ? 'follow' : 'manual',
    signal: AbortSignal.timeout(15000),
  });
  absorbCookies(res);
  return res;
}

/** 解析 /link?url=... 跳转页里用 JS 拼接的真实地址 */
export async function resolveSogouLink(link) {
  if (!/sogou\.com\/link/.test(link)) return link;
  try {
    // 会话过期就先去首页/搜索页建立 Cookie
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

/** 360 搜索：结果里带 data-mdurl（真实地址），中文日期直接可读 */
async function search360(query, max) {
  const url = `https://www.so.com/s?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: SOGOU_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`360 搜索返回 ${res.status}`);
  const html = await res.text();
  const doc = new JSDOM(html).window.document;
  const out = [];
  for (const li of doc.querySelectorAll('.res-list')) {
    const a = li.querySelector('h3 a');
    const real = a?.getAttribute('data-mdurl') || '';
    if (!/^https?:/.test(real)) continue;
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const snippet = (li.querySelector('.res-desc, .res-rich')?.textContent || '').replace(/\s+/g, ' ').trim();
    out.push({
      title,
      url: real,
      snippet: snippet.slice(0, 220),
      source: sourceOf(real),
      provider: 'so360',
      date: parseCnDate(`${snippet} ${li.textContent || ''}`),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 从「2026年5月20日」「发贴时间：2025年10月10日」里解析日期 */
export function parseCnDate(text) {
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(String(text || ''));
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

async function searchSogouWeixin(query, max, { timeRange = '', sortBy = '', pagesOpt = 3, resolveOpt = 6 } = {}) {
  if (!sogouJar.cookies.size || Date.now() - sogouJar.at > 8 * 60_000) {
    await sogouFetch('https://weixin.sogou.com/').catch(() => {});
  }
  const sort = sortBy === 'time' ? '&sort=1' : '';
  const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8${sort}`;
  let res = await sogouFetch(url, 'https://weixin.sogou.com/', { follow: true });
  let html = await res.text();

  // 反爬：清空会话、重新预热后再试一次
  if (!res.ok || /antispider/.test(res.url) || /antispider|请输入验证码/.test(html)) {
    sogouJar.cookies.clear();
    await sogouFetch('https://weixin.sogou.com/').catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    res = await sogouFetch(url, 'https://weixin.sogou.com/', { follow: true });
    html = await res.text();
    if (!res.ok || /antispider/.test(res.url) || /antispider|请输入验证码/.test(html)) {
      throw new Error('搜狗微信触发反爬验证，请稍后重试（或改用 Tavily）');
    }
  }
  if (/请输入验证码|antispider|访问过于频繁/.test(html)) {
    throw new Error('搜狗微信触发反爬验证，请稍后再试或改用 Bing / Tavily');
  }
  const doc = new JSDOM(html).window.document;
  const items = [...doc.querySelectorAll('.news-list li')]
    .slice(0, max)
    .map((li) => {
      const a = li.querySelector('h3 a');
      if (!a) return null;
      const href = 'https://weixin.sogou.com' + (a.getAttribute('href') || '');
      const s2 = li.querySelector('.s2')?.textContent || '';
      const epoch = /timeConvert\('(\d{9,11})'\)/.exec(s2)?.[1];
      const account = (li.querySelector('.all-time-y2')?.textContent || '').trim();
      return {
        title: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        url: href,
        originalUrl: href,
        snippet: (li.querySelector('.txt-info')?.textContent || '').replace(/\s+/g, ' ').trim(),
        source: '微信公众号',
        account,
        date: epoch ? new Date(Number(epoch) * 1000).toISOString().slice(0, 10) : '',
        provider: 'sogou',
        needsResolve: true,
      };
    })
    .filter(Boolean);

  // 多翻几页，凑够更多结果（每页 10 条）
  const pages = Number(pagesOpt) || 1;
  const seen = new Set(items.map((i) => i.url));
  for (let p = 2; p <= pages; p++) {
    try {
      const more = await sogouFetch(
        `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8&page=${p}`,
        'https://weixin.sogou.com/weixin',
        { follow: true }
      );
      const mh = await more.text();
      if (/antispider/.test(more.url) || /antispider|请输入验证码/.test(mh)) break;
      const mdoc = new JSDOM(mh).window.document;
      const added = [...mdoc.querySelectorAll('.news-list li')]
        .map((li) => {
          const a = li.querySelector('h3 a');
          if (!a) return null;
          const href = 'https://weixin.sogou.com' + (a.getAttribute('href') || '');
          const s2 = li.querySelector('.s2')?.textContent || '';
          const epoch = /timeConvert\('(\d{9,11})'\)/.exec(s2)?.[1];
          return {
            title: (a.textContent || '').replace(/\s+/g, ' ').trim(),
            url: href,
            originalUrl: href,
            snippet: (li.querySelector('.txt-info')?.textContent || '').replace(/\s+/g, ' ').trim(),
            source: '微信公众号',
            account: (li.querySelector('.all-time-y2')?.textContent || '').trim(),
            date: epoch ? new Date(Number(epoch) * 1000).toISOString().slice(0, 10) : '',
            provider: 'sogou',
            needsResolve: true,
          };
        })
        .filter((x) => x && x.title && !seen.has(x.url));
      if (!added.length) break;
      added.forEach((x) => seen.add(x.url));
      items.push(...added);
      await new Promise((r) => setTimeout(r, 350));
    } catch {
      break;
    }
  }

  // 顺手把前若干条跳转链接换成真实微信地址（避免频控，其余转换时再解析）
  const resolveCount = Math.min(items.length, resolveOpt || 12);
  await Promise.all(
    items.slice(0, resolveCount).map(async (it) => {
      const real = await resolveSogouLink(it.url);
      if (real) {
        it.url = real;
        it.needsResolve = false;
      }
    })
  );
  return items;
}

async function searchTavily(query, max) {
  const key = settings().search?.tavilyKey;
  if (!key) throw new Error('未配置 Tavily API Key');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: max, search_depth: 'basic', include_answer: false }),
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

/**
 * @param {string} query
 * @param {{provider?:string,max?:number,wechatOnly?:boolean}} opts
 */
const CACHE = new Map();
const CACHE_TTL = 3 * 60_000;

export async function searchWeb(query, { provider, max, wechatOnly, sources, timeRange = '', sortBy = 'relevance' } = {}) {
  const cfg = settings().search || {};
  const n = Math.min(Number(max || cfg.maxResults || 12), 30);
  const webProvider = provider || cfg.provider || 'duckduckgo';
  const src = sources || (wechatOnly ? 'wechat' : 'all');
  const errors = [];

  const cacheKey = [query, src0(sources, wechatOnly), timeRange, sortBy, n].join('|');
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  // 决定要查哪些源
  const tasks = [];
  if (src === 'wechat' || src === 'all') tasks.push('sogou');
  if (src === 'web' || src === 'all') {
    tasks.push('so360');
    tasks.push(webProvider === 'sogou' ? 'duckduckgo' : webProvider);
    if (webProvider !== 'bing') tasks.push('bing');
  }

  const run = async (name) => {
    if (name === 'so360') return search360(query, n);
    if (name === 'duckduckgo') return searchDuckDuckGo(query, n, { timeRange });
    if (name === 'bing') return searchBing(query, n, { timeRange });
    if (name === 'sogou') return searchSogouWeixin(query, n, { timeRange, sortBy });
    if (name === 'sogou-web') return searchSogouWeb(query, n);
    if (name === 'tavily') return searchTavily(query, n);
    throw new Error(`未知搜索源：${name}`);
  };

  const groups = await Promise.all(
    [...new Set(tasks)].map(async (name) => {
      try {
        return { name, items: (await run(name)) || [] };
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
        return { name, items: [] };
      }
    })
  );

  // 主源挂了就自动降级一次
  if (!groups.some((g) => g.items.length) && src === 'web') {
    for (const alt of ['so360', 'duckduckgo', 'bing'].filter((x) => x !== webProvider)) {
      try {
        const items = await run(alt);
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

  let results = groups.flatMap((g) => g.items.map((r) => ({ ...r, provider: r.provider || g.name })));

  // 去重：URL 相同，或标题+发布日期相同（同一篇的转载）
  const seen = new Set();
  results = results.filter((r) => {
    if (!r.url) return false;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return false;
    const titleKey = `${normalizeName(r.title)}|${r.date || ''}`;
    if (r.title && r.date && seen.has(`t:${titleKey}`)) return false;
    seen.add(key);
    seen.add(`t:${titleKey}`);
    return true;
  });

  // 时间范围过滤（按解析出的发布日期，未知日期的一律剔除）
  const DAYS = { day: 1, week: 7, month: 30, year: 365 };
  if (timeRange && DAYS[timeRange]) {
    const cutoff = Date.now() - DAYS[timeRange] * 86400_000;
    const parse = (d) => {
      if (!d) return 0;
      const t = Date.parse(d.length <= 10 ? `${d}T00:00:00` : d);
      return Number.isNaN(t) ? 0 : t;
    };
    const fresh = results.filter((r) => parse(r.date) >= cutoff);
    if (fresh.length) results = fresh;
    else errors.push('该时间范围内没有结果，已展示全部（可切「按时间」看最新）');
  }

  // 时间排序：有日期的在前，按时间倒序
  if (sortBy === 'time') {
    const ts = (d) => {
      if (!d) return 0;
      const t = Date.parse(d.length <= 10 ? `${d}T00:00:00` : d);
      return Number.isNaN(t) ? 0 : t;
    };
    results.sort((a, b) => ts(b.date) - ts(a.date));
  }

  const payload = {
    query,
    provider: groups.map((g) => g.name).join('+') || webProvider,
    sources: src,
    timeRange,
    sortBy,
    count: results.length,
    results: results.slice(0, n),
    errors,
  };
  if (results.length) CACHE.set(cacheKey, { at: Date.now(), data: payload });
  return payload;
}

function src0(sources, wechatOnly) {
  return sources || (wechatOnly ? 'wechat' : 'all');
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

function bigrams(s) {
  const t = String(s || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

export function titleSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** 用标题在 DDG 上找 mp.weixin.qq.com 原文，并校验标题相似度 */
export async function resolveWeixinByTitle(title, { maxCandidates = 4 } = {}) {
  const clean = String(title || '')
    .replace(/[【】\[\]《》()（）|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length < 3) return null;

  let results = [];
  try {
    results = await searchDuckDuckGo(`site:mp.weixin.qq.com ${clean}`, 10);
  } catch {
    return null;
  }
  const cands = results.filter((r) => /mp\.weixin\.qq\.com\/s/.test(r.url)).slice(0, maxCandidates);

  let best = null;
  for (const c of cands) {
    try {
      const res = await fetch(c.url, { headers: HEADERS, redirect: 'follow' });
      const html = await res.text();
      const realTitle = /id="activity-name"[^>]*>([\s\S]{0,400}?)<\//.exec(html)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const score = realTitle ? titleSimilarity(realTitle, clean) : 0;
      if (!best || score > best.score) best = { url: c.url, title: realTitle || '', score };
      if (score >= 0.85) break;
    } catch {}
  }
  return best && best.score >= 0.5 ? best : null;
}
