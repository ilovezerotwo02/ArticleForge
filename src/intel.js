import { UA, settings } from './config.js';
import { noteOk, noteFail, isDown } from './health.js';
import {
  sleep, clean, isoDate, parseAnyDate, tsOf, queryTokens,
} from './util.js';

/* =========================================================================
 * 情报源层（intel.js）：全部是「无 Cookie 验证、无验证码」的公开接口与 RSS
 * -------------------------------------------------------------------------
 * 参考红队/漏洞监控平台（ARL、Hawkeye、nuclei、changedetection、RSSHub 等）
 * 的做法：监控不打搜索引擎，打官方 API 与社区 RSS —— 永远不会弹验证码。
 *
 * 2026-10 本机网络实测（国内直连）：
 *   ✓ GitHub Search API        api.github.com          （未登录 10 次/分，支持 Token）
 *   ✓ NVD API 2.0              services.nvd.nist.gov   （无 Key 5 次/30 秒，支持 Key）
 *   ✓ CISA KEV                 cisa.gov                （在野利用目录，1.8MB，缓存 1h）
 *   ✓ Exploit-DB               gitlab raw CSV + 官方 RSS（CSV 缓存 6h）
 *   ✓ MITRE CVE API            cveawg.mitre.org        （按 CVE 编号直查）
 *   ✓ 安全客                    api.anquanke.com
 *   ✓ 先知社区                  xz.aliyun.com/feed
 *   ✓ FreeBuf                  freebuf.com/feed
 *   ✓ 知道创宇                  paper.seebug.org/rss/
 *   ✓ 绿盟科技                  blog.nsfocus.net/feed/
 *   ✓ The Hacker News / BleepingComputer
 *   ✓ 公众号 RSS 订阅           wechat2rss.xlab.app（配置后公众号监控不再依赖搜狗）
 *   ✗ Google News / Reddit / HN  国内多数网络不可达 → 自动熔断跳过（有代理则自动启用）
 * ========================================================================= */

const feedCache = new Map(); // url -> { at, data }
const UA_INTEL = UA.includes('Edg/') ? UA.replace(/ Edg\/[\d.]+/, '') : UA;

const HTML_HEADERS = {
  'User-Agent': UA_INTEL,
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

async function fetchText(url, { timeout = 15000, headers = {}, retries = 0 } = {}) {
  // 网络抖动（fetch failed / 连接重置）重试一次；403/404 等业务错误不重试
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...HTML_HEADERS, ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString('utf8');
    } catch (e) {
      const retriable = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket|aborted/i.test(
        `${e?.cause?.code || ''} ${e?.message || ''}`
      );
      if (!retriable || attempt >= retries) throw e;
      await sleep(700 + Math.random() * 800);
    }
  }
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

/** 带 TTL 的抓取缓存：feed 类内容几分钟内重复查同一词不打源 */
async function cached(url, ttl, loader) {
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await loader();
  feedCache.set(url, { at: Date.now(), data });
  return data;
}

/* ---------------- RSS / Atom 解析（轻量正则版，零依赖） ---------------- */

const stripCdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const stripTags = (s) =>
  stripCdata(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function pick(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? m[1].trim() : '';
}

function pickHref(block) {
  const withHref = /<link\s[^>]*href=["']([^"']+)["']/i.exec(block);
  if (withHref) return withHref[1].trim();
  const plain = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(block);
  if (plain) return stripCdata(plain[1]).trim();
  const guid = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(block);
  return guid ? stripCdata(guid[1]).trim() : '';
}

/** 解析 RSS2 / Atom，返回 [{title, link, date, summary}] */
export function parseFeed(xml) {
  const blocks = [
    ...String(xml || '').matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi),
  ].map((m) => m[1]);
  const out = [];
  for (const b of blocks) {
    const title = stripTags(pick(b, 'title'));
    const link = stripCdata(pickHref(b));
    if (!title || !/^https?:\/\//.test(link)) continue;
    const rawDate = pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date');
    const date = normDate(rawDate || stripTags(b));
    const summary = stripTags(pick(b, 'description') || pick(b, 'summary') || pick(b, 'content')).slice(0, 240);
    out.push({ title, link, date, summary });
  }
  return out;
}

function normDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return isoDate(t);
  return parseAnyDate(s);
}

/* ---------------- 关键词匹配 ---------------- */

function matchItems(items, tokens, { limit = 30, needMatch = true } = {}) {
  const scored = [];
  for (const it of items) {
    const hay = `${it.title} \n ${it.summary || ''}`.toLowerCase();
    let hits = 0;
    for (const t of tokens) if (hay.includes(t)) hits++;
    if (needMatch && tokens.length && !hits) continue;
    scored.push({ ...it, _hits: hits });
  }
  scored.sort((a, b) => b._hits - a._hits || tsOf(b.date) - tsOf(a.date));
  return scored.slice(0, limit).map(({ _hits, ...rest }) => rest);
}

/* ============================ GitHub ============================ */

let lastGithubAt = 0;

async function githubFetch(url, token) {
  // 未登录 search API 10 次/分钟：全局串行 + 6.5 秒间隔
  const since = Date.now() - lastGithubAt;
  if (since < 6500) await sleep(6500 - since);
  lastGithubAt = Date.now();
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA_INTEL,
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 403 || res.status === 429) throw new Error('额度限流');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** GitHub 仓库 + Issue 双搜：红队工具/漏洞复现/issue 讨论都能捞到 */
async function searchGithub(query, { max = 30 } = {}) {
  const token = settings().search?.githubToken;
  const q = encodeURIComponent(query);
  // 不带 sort 参数（GitHub 相关度排序）。sort=updated 会把「最近更新的沾边仓库」顶上来，
  // 中文查询时 GitHub 分词把「内存取证」拆成 内存+取证 AND 匹配，会命中一堆各含一词的无关仓库
  const [repos, issues] = await Promise.allSettled([
    githubFetch(`https://api.github.com/search/repositories?q=${q}&per_page=30`, token),
    githubFetch(`https://api.github.com/search/issues?q=${q}&per_page=30`, token),
  ]);
  const out = [];
  if (repos.status === 'fulfilled') {
    for (const r of repos.value.items || []) {
      out.push({
        title: clean(r.full_name),
        url: r.html_url,
        snippet: `★${r.stargazers_count ?? 0} ${r.language || ''} ${clean(r.description).slice(0, 160)}`.trim(),
        source: 'GitHub',
        account: r.owner?.login || '',
        date: isoDate(r.pushed_at || r.updated_at || ''),
        provider: 'github',
        _pushed: tsOf(r.pushed_at || r.updated_at || ''),
      });
    }
  } else if (issues.status === 'rejected') {
    throw repos.reason;
  }
  if (issues.status === 'fulfilled') {
    for (const it of issues.value.items || []) {
      if (it.pull_request) continue;
      const repo = String(it.repository_url || '').split('/repos/')[1] || '';
      out.push({
        title: clean(it.title),
        url: it.html_url,
        snippet: `[issue] ${repo} ${clean(it.body).slice(0, 160)}`.trim(),
        source: 'GitHub',
        account: it.user?.login || repo,
        date: isoDate(it.created_at || ''),
        provider: 'github-issues',
        _pushed: tsOf(it.created_at || ''),
      });
    }
  }

  // 本地相关度门禁：完整短语命中 > 全部词命中 > 不收录。
  // 中文标题/描述通常没有空格，短语按「查询去空格后是否原样出现」判断
  const phrase = String(query).toLowerCase().replace(/\s+/g, '');
  const tokens = queryTokens(query);
  const gate = (item) => {
    const hay = `${item.title} ${item.snippet}`.toLowerCase().replace(/\s+/g, '');
    if (phrase.length > 1 && hay.includes(phrase)) return 3;
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (tokens.length > 1 && hits === tokens.length) return 2;
    return 0;
  };
  const kept = out
    .map((it) => ({ it, v: gate(it) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || b.it._pushed - a.it._pushed)
    .map((x) => {
      delete x.it._pushed;
      return x.it;
    });
  return kept.slice(0, Math.max(max, 30));
}

/* ============================ NVD / KEV / MITRE / Exploit-DB ============================ */

let lastNvdAt = 0;

async function searchNvd(query, { max = 30 } = {}) {
  const key = settings().search?.nvdApiKey;
  if (!key) {
    // 无 Key：5 次 / 30 秒
    const since = Date.now() - lastNvdAt;
    if (since < 6500) await sleep(6500 - since);
    lastNvdAt = Date.now();
  }
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=${Math.min(max, 50)}`;
  const data = await fetchJson(url, {
    timeout: 20000,
    retries: 1,
    headers: { 'User-Agent': UA_INTEL, ...(key ? { apiKey: key } : {}) },
  });
  const out = [];
  for (const v of data.vulnerabilities || []) {
    const cve = v.cve || {};
    const id = cve.id || '';
    if (!id) continue;
    const desc = clean(cve.descriptions?.find((d) => d.lang === 'en')?.value || cve.descriptions?.[0]?.value);
    const metric = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV2?.[0];
    const sev = metric?.cvssData?.baseSeverity || '';
    const score = metric?.cvssData?.baseScore ?? '';
    out.push({
      title: `${id}${sev ? `（${sev} ${score}）` : ''}`,
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
      snippet: desc.slice(0, 220),
      source: 'NVD',
      account: clean(cve.sourceIdentifier),
      date: isoDate(cve.published || ''),
      provider: 'nvd',
      cvss: Number(score) || 0,
    });
  }
  out.sort((a, b) => tsOf(b.date) - tsOf(a.date) || b.cvss - a.cvss);
  return out.slice(0, max);
}

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

/** CISA KEV：已被在野利用的漏洞目录，命中即高危 */
async function searchKev(query, { max = 20 } = {}) {
  const data = await cached('kev', 60 * 60_000, () => fetchJson(KEV_URL, { timeout: 25000, retries: 1 }));
  const tokens = queryTokens(query);
  const out = [];
  for (const v of data.vulnerabilities || []) {
    const hay = `${v.cveID} ${v.vendorProject} ${v.product} ${v.vulnerabilityName} ${v.shortDescription}`.toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (tokens.length && !hits) continue;
    out.push({
      title: `[在野利用] ${v.vendorProject} ${v.product}：${v.vulnerabilityName}`,
      url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      snippet: clean(v.shortDescription).slice(0, 220),
      source: 'CISA KEV',
      account: v.cveID,
      date: isoDate(v.dateAdded || ''),
      provider: 'kev',
      score0: hits,
    });
  }
  out.sort((a, b) => b.score0 - a.score0 || tsOf(b.date) - tsOf(a.date));
  return out.slice(0, max).map(({ score0, ...r }) => r);
}

/** 查询里带 CVE 编号时直查 MITRE 官方记录 */
async function searchMitre(query) {
  const ids = [...new Set(String(query).toUpperCase().match(/CVE-\d{4}-\d{4,}/g) || [])].slice(0, 3);
  const out = [];
  for (const id of ids) {
    try {
      const data = await cached(`mitre:${id}`, 24 * 3600_000, () =>
        fetchJson(`https://cveawg.mitre.org/api/cve/${id}`, { timeout: 15000, retries: 1 }));
      const cna = data.containers?.cna || {};
      const desc = clean(cna.descriptions?.find((d) => d.lang === 'en')?.value || '');
      const title = clean(cna.title) || desc.slice(0, 80);
      out.push({
        title: `${id} ${title}`.trim(),
        url: `https://www.cve.org/CVERecord?id=${id}`,
        snippet: desc.slice(0, 220),
        source: 'MITRE CVE',
        account: '',
        date: isoDate(data.cveMetadata?.datePublished || cna.datePublic || ''),
        provider: 'mitre',
      });
    } catch {}
  }
  return out;
}

const EDB_CSV_URL = 'https://gitlab.com/exploit-database/exploitdb/-/raw/main/files_exploits.csv';
const EDB_RSS_URL = 'https://www.exploit-db.com/rss.xml';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Exploit-DB：全量 CSV（缓存 6 小时）按关键词过滤 + 官方 RSS 最新条目 */
async function searchExploitDb(query, { max = 25 } = {}) {
  const tokens = queryTokens(query);
  const out = [];
  const seen = new Set();
  const push = (it) => {
    const k = it.url;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(it);
  };

  try {
    const csv = await cached('edb-csv', 6 * 3600_000, () => fetchText(EDB_CSV_URL, { timeout: 45000, retries: 1 }));
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    const head = parseCsvLine(lines[0]).map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const cId = col('id'), cDesc = col('description'), cDate = col('date_published'),
      cAuthor = col('author'), cType = col('type'), cPlatform = col('platform'), cCodes = col('codes');
    const matched = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 10) continue;
      const f = parseCsvLine(line);
      if (!f[cId]) continue;
      const hay = `${f[cDesc]} ${f[cCodes]} ${f[cAuthor]} ${f[cType]} ${f[cPlatform]}`.toLowerCase();
      if (!tokens.length || tokens.some((t) => hay.includes(t))) {
        matched.push({
          title: clean(f[cDesc]).slice(0, 120),
          url: `https://www.exploit-db.com/exploits/${f[cId]}`,
          snippet: `${f[cType]}/${f[cPlatform]} · ${f[cAuthor]} ${f[cCodes] ? `· ${f[cCodes]}` : ''}`.trim().slice(0, 200),
          source: 'Exploit-DB',
          account: f[cAuthor],
          date: isoDate(f[cDate]),
          provider: 'edb',
        });
        if (matched.length > 4000) break;
      }
    }
    matched.sort((a, b) => tsOf(b.date) - tsOf(a.date));
    matched.slice(0, max).forEach(push);
  } catch {
    // CSV 拉不动就用 RSS 兜底
  }

  try {
    const rss = await cached(EDB_RSS_URL, 15 * 60_000, () => fetchText(EDB_RSS_URL, { timeout: 15000, retries: 1 }));
    const items = parseFeed(rss).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.summary,
      source: 'Exploit-DB',
      date: r.date,
      provider: 'edb-rss',
    }));
    // 带关键词搜索时 RSS 也必须命中关键词，否则「最新条目」全是无关内容刷屏
    matchItems(items, tokens, { limit: 12, needMatch: Boolean(tokens.length) }).forEach(push);
  } catch {}

  return out.slice(0, max + 12);
}

/* ============================ 中文安全社区 feed 聚合 ============================ */

const SEC_FEEDS = [
  { name: 'anquanke', label: '安全客', url: 'https://api.anquanke.com/data/v1/posts' },
  { name: 'xz', label: '先知社区', url: 'https://xz.aliyun.com/feed' },
  { name: 'freebuf', label: 'FreeBuf', url: 'https://www.freebuf.com/feed' },
  { name: 'seebug', label: '知道创宇', url: 'https://paper.seebug.org/rss/' },
  { name: 'nsfocus', label: '绿盟科技', url: 'http://blog.nsfocus.net/feed/' },
  { name: 'thehackernews', label: 'The Hacker News', url: 'https://thehackernews.com/feeds/posts/default' },
  { name: 'bleepingcomputer', label: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
];

/** 每个社区独立熔断（sec-<name>），单个社区挂了不影响其它 */
async function loadOneFeed(feed) {
  const name = `sec-${feed.name}`;
  if (isDown(name)) return [];
  try {
    const items = await cached(feed.url, 10 * 60_000, async () => {
      if (feed.name === 'anquanke') {
        const data = await fetchJson(feed.url, { timeout: 15000, retries: 1 });
        return (data.data || []).map((p) => ({
          title: clean(p.title),
          link: p.url || `https://www.anquanke.com/post/id/${p.id}`,
          date: isoDate(p.date),
          summary: clean(p.desc).slice(0, 200),
          account: p.author?.nickname || '安全客',
        }));
      }
      return parseFeed(await fetchText(feed.url, { timeout: 15000, retries: 1 }));
    });
    noteOk(name);
    return items;
  } catch (e) {
    noteFail(name, e.message || String(e));
    return [];
  }
}

async function searchSecFeeds(query, { max = 40 } = {}) {
  const tokens = queryTokens(query);
  const lists = await Promise.all(SEC_FEEDS.map((f) => loadOneFeed(f)));
  const merged = [];
  for (let i = 0; i < SEC_FEEDS.length; i++) {
    const feed = SEC_FEEDS[i];
    for (const it of lists[i]) {
      merged.push({
        title: it.title,
        url: it.link,
        snippet: it.summary || '',
        source: feed.label,
        account: it.account || feed.label,
        date: it.date,
        provider: `sec-${feed.name}`,
      });
    }
  }
  return matchItems(merged, tokens, { limit: max, needMatch: Boolean(tokens.length) });
}

/* ---------------- Google News / Reddit / Hacker News（国内不可达时自动熔断） ---------------- */

const RANGE_DAYS = { day: 1, week: 7, month: 30, '3month': 90, year: 365 };

async function searchGoogleNews(query, { max = 25, timeRange = '' } = {}) {
  const days = RANGE_DAYS[timeRange] || 30;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:${days}d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const xml = await cached(url, 10 * 60_000, () => fetchText(url, { timeout: 8000 }));
  const items = parseFeed(xml).map((it) => ({
    title: it.title.replace(/\s+-\s+[^-]+$/, ''),
    url: it.link,
    snippet: it.summary,
    source: 'Google News',
    account: (it.title.match(/\s+-\s+([^-]+)$/) || [])[1] || '',
    date: it.date,
    provider: 'gnews',
  }));
  return matchItems(items, queryTokens(query), { limit: max, needMatch: false }).slice(0, max);
}

async function searchReddit(query, { max = 20 } = {}) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${Math.min(max, 40)}&include_over_18=off`;
  const data = await cached(url, 10 * 60_000, () =>
    fetchJson(url, { timeout: 8000, headers: { 'User-Agent': 'ArticleForge/1.0 (local tool)' } }));
  return (data.data?.children || [])
    .map((c) => c.data)
    .filter((d) => !d.stickied)
    .map((d) => ({
      title: clean(d.title),
      url: `https://www.reddit.com${d.permalink}`,
      snippet: clean(d.selftext).slice(0, 200),
      source: 'Reddit',
      account: `r/${d.subreddit}`,
      date: isoDate((d.created_utc || 0) * 1000),
      provider: 'reddit',
    }))
    .slice(0, max);
}

async function searchHackerNews(query, { max = 20 } = {}) {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${Math.min(max, 40)}`;
  const data = await cached(url, 10 * 60_000, () => fetchJson(url, { timeout: 8000 }));
  return (data.hits || [])
    .filter((h) => h.title)
    .map((h) => ({
      title: clean(h.title),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: '',
      source: 'Hacker News',
      account: h.author,
      date: isoDate(h.created_at || ''),
      provider: 'hn',
      score0: h.points || 0,
    }))
    .sort((a, b) => b.score0 - a.score0)
    .slice(0, max)
    .map(({ score0, ...r }) => r);
}

/* ---------------- 公众号 RSS 订阅（wechat2rss 等，配置后永不弹验证码） ----------------
 * 这是公众号检索里唯一「实时」的一路：搜索引擎收录公众号文章要几天到几个月，
 * RSS feed 里的就是刚推送的内容 —— 所以普通公众号搜索也会并入这一路。
 */

export async function searchWeixinFeeds(query, { max = 40 } = {}) {
  const feeds = (settings().search?.weixinFeeds || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  if (!feeds.length) return [];
  const tokens = queryTokens(query);
  const out = [];
  await Promise.all(
    feeds.map(async (url, i) => {
      const name = `wxrss-${i}`;
      if (isDown(name)) return;
      try {
        const xml = await cached(url, 10 * 60_000, () => fetchText(url, { timeout: 15000, retries: 1 }));
        const doc = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(xml);
        const channel = stripTags(doc?.[1] || '').replace(/^(RSS|Telegram|Feed)[:：\s]*/i, '') || '微信公众号';
        noteOk(name);
        for (const it of parseFeed(xml)) {
          out.push({
            title: it.title,
            url: it.link,
            snippet: it.summary,
            source: '微信公众号',
            account: channel,
            date: it.date,
            provider: 'wxrss',
          });
        }
      } catch (e) {
        noteFail(name, e.message || String(e));
      }
    })
  );
  return matchItems(out, tokens, { limit: max, needMatch: Boolean(tokens.length) });
}

/* ============================ 聚合入口 ============================ */

/**
 * 情报源并行检索：全部免验证码，被墙/限流的源自动熔断跳过。
 * @returns {{ groups: {name:string, items:any[]}[], errors: string[] }}
 */
export async function intelSearch(query, { max = 40, timeRange = '', deep = true } = {}) {
  const cfg = settings().search || {};
  const hasCve = /CVE-\d{4}-\d{4,}/i.test(query);

  const tasks = [
    { name: 'secfeeds', run: () => searchSecFeeds(query, { max }) },
    { name: 'github', run: () => searchGithub(query, { max }) },
    { name: 'kev', run: () => searchKev(query, { max: 20 }) },
    { name: 'edb', run: () => searchExploitDb(query, { max }) },
    { name: 'nvd', run: () => searchNvd(query, { max: Math.min(max, 40) }) },
  ];
  if (hasCve) tasks.push({ name: 'mitre', run: () => searchMitre(query) });
  if (cfg.weixinFeeds?.length) tasks.push({ name: 'wxrss', run: () => searchWeixinFeeds(query, { max }) });
  if (deep) {
    tasks.push({ name: 'gnews', run: () => searchGoogleNews(query, { max, timeRange }) });
    tasks.push({ name: 'reddit', run: () => searchReddit(query, { max }) });
    tasks.push({ name: 'hn', run: () => searchHackerNews(query, { max }) });
  }

  const groups = [];
  const errors = [];
  await Promise.all(
    tasks.map(async (t) => {
      if (isDown(t.name)) {
        errors.push(`${t.name} 冷却中，本轮跳过`);
        return;
      }
      try {
        const items = (await t.run()) || [];
        if (items.length) noteOk(t.name);
        groups.push({ name: t.name, items });
      } catch (e) {
        noteFail(t.name, e.message || String(e));
        errors.push(`${t.name}: ${e.message}`);
      }
    })
  );

  // 组间也轮转：每个源轮流出一条，防单源刷屏
  const lists = groups.map((g) => g.items.slice());
  const merged = [];
  let i = 0;
  while (lists.some((l) => i < l.length)) {
    for (const l of lists) if (l[i]) merged.push(l[i]);
    i++;
  }

  return { groups, items: merged, errors };
}
