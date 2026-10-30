import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { watchStore, emit, hashId, normalizeUrl, urlKey } from './store.js';
import { searchWeb, titleSimilarity } from './search.js';
import { settings } from './config.js';
import { clean, tsOf, queryTokens } from './util.js';

let timer = null;
let running = false;

const MAX_SEEN = 2000;
const MAX_HITS = 120;
const BACKFILL_SLACK_DAYS = 7;
const TIME_WINDOW_DAYS = { day: 1, week: 7, month: 30, '3month': 90, year: 365 };
const SOURCES = ['all', 'wechat', 'web', 'intel'];
const FUZZY_TTL_DAYS = 3; // 近似重复判定允许的日期差

/**
 * 指纹：
 * - 公众号文章 → __biz+mid+idx（同一篇的不同入口参数都归一）
 * - 搜狗跳转链接的 token 每轮都变 → 用「标题+公众号名+发布日期」当身份
 * - 其它站点 → 规范化 URL
 */
function fingerprint(r) {
  const key = urlKey(r.url);
  if (key && !key.startsWith('sogou:') && !key.startsWith('t:')) return key;
  const t = String(r.title || '').toLowerCase().replace(/\s+/g, '');
  if (t) return `t:${t}|${r.account || ''}|${r.date || ''}`;
  return key || '';
}

export const fingerprintOf = fingerprint;

/**
 * 命中打分：监控结果按这个排序，最有价值的排最前。
 * - 标题命中关键词 +3 / 摘要命中 +1
 * - 官方权威源（KEV/NVD/EDB/MITRE）+3；公众号 +1
 * - 48 小时内发布 +2；CVSS ≥9 +2、≥7 +1
 */
function hitScore(r, tokens) {
  const t = String(r.title || '').toLowerCase();
  const s = String(r.snippet || '').toLowerCase();
  let v = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) v += 3;
    else if (s.includes(tok)) v += 1;
  }
  const p = String(r.provider || '');
  if (/kev|nvd|mitre|edb|advisory/.test(p)) v += 3;
  if (p === 'wxrss' || r.source === '微信公众号') v += 1;
  if (r.date) {
    const age = Date.now() - tsOf(r.date);
    if (age >= 0 && age < 2 * 86400_000) v += 2;
  }
  if (r.cvss >= 9) v += 2;
  else if (r.cvss >= 7) v += 1;
  return v;
}

/** 近期命中缓存：跨源、跨轮次的「同一篇报道」用标题相似度兜底去重 */
function fuzzyDup(r, recent) {
  const t = String(r.title || '');
  if (!t) return false;
  const rt = tsOf(r.date);
  for (const h of recent) {
    if (!h._title) continue;
    if (titleSimilarity(t, h._title) < 0.92) continue;
    const diff = Math.abs(rt - tsOf(h._date));
    if (!rt || !tsOf(h._date) || diff <= FUZZY_TTL_DAYS * 86400_000) return true;
  }
  return false;
}

export function startWatcher() {
  if (timer) return;
  const every = Math.max(1, Number(settings().watch?.intervalMin || 20));
  timer = setInterval(() => tick().catch((e) => console.error('[watch]', e.message)), 60_000);
  setTimeout(() => tick().catch(() => {}), 20_000);
  console.log(`[watch] 监控已启动（默认每 ${every} 分钟，逐任务按自身间隔执行）`);
}

/**
 * 检查单个监控任务
 * - 检索时**不做时间过滤**（时间过滤会漏掉"对我们新、对全网旧"的文章），
 *   而是把时间窗当成「报警窗口」：窗内新文章才推提醒，更早的记为「旧文补录」
 * - 首次运行建立基线（不报警，只入库）
 * - 结果按打分 + 发布时间排序，附带 publishDate / score
 * - 来源可选：all（全网，安全类关键词自动并入情报源）/ wechat / web / intel（免验证情报源）
 */
export async function checkWatch(id, { silent = false } = {}) {
  const w = watchStore.list().find((x) => x.id === id);
  if (!w) throw new Error('监控任务不存在');

  const cfg = settings().search || {};
  // 老任务迁移：早期版本没有 timeRange/pages，这里补默认值，避免「监控不看最近」
  if (w.timeRange === undefined || w.pages === undefined) {
    watchStore.update(id, {
      timeRange: w.timeRange ?? settings().watch?.timeRange ?? 'week',
      pages: w.pages ?? (Number(settings().watch?.pages) || 8),
    });
  }
  const pages = Math.max(1, Math.min(10, Number(w.pages) || Number(cfg.wechatPages) || 8));
  const max = Math.max(10, Math.min(200, Number(w.max) || pages * 10));
  const src = SOURCES.includes(w.sources) ? w.sources : (w.wechatOnly !== false ? 'wechat' : 'all');
  const res = await searchWeb(w.query, {
    provider: w.provider,
    max,
    pages,
    sources: src,
    wechatOnly: src === 'wechat',
    sortBy: 'time',
    fresh: true,
  });

  const known = new Set((w.seenKeys?.length ? w.seenKeys : (w.seen || []).map(normalizeUrl)).filter(Boolean));
  const recent = (w.hits || []).slice(0, 80).map((h) => ({ _title: String(h.title || ''), _date: h.date || '' }));
  const firstRun = !w.lastRun;
  const baselineAt = Number(w.baselineAt) || (firstRun ? Date.now() : Date.parse(w.createdAt || '') || Date.now());
  const windowDays = TIME_WINDOW_DAYS[w.timeRange] || 0;
  const windowStart = windowDays ? Date.now() - windowDays * 86400_000 : 0;

  const tokens = queryTokens(w.query);
  const freshItems = [];
  const backfill = [];
  for (const r of res.results) {
    const fp = fingerprint(r);
    if (known.has(fp)) continue;
    known.add(fp);
    if (fuzzyDup(r, recent)) continue; // 不同源、不同链接的同一篇报道
    const t = tsOf(r.date);
    const tooOld = t > 0 && ((baselineAt && t < baselineAt - BACKFILL_SLACK_DAYS * 86400_000) || (windowStart && t < windowStart));
    (tooOld ? backfill : freshItems).push(r);
  }
  freshItems.sort((a, b) => hitScore(b, tokens) - hitScore(a, tokens) || tsOf(b.date) - tsOf(a.date));

  const stamp = new Date().toISOString();
  const baselineItems = firstRun ? freshItems.map((h) => ({ ...h, foundAt: stamp, baseline: true, isNew: false })) : [];
  const newHits = freshItems.map((h) => ({ ...h, foundAt: stamp, publishDate: h.date || '', isNew: !firstRun, score: hitScore(h, tokens) }));
  const backfillHits = backfill.slice(0, 20).map((h) => ({ ...h, foundAt: stamp, isNew: false, backfill: true }));

  const merged = [...newHits, ...baselineItems, ...backfillHits, ...(w.hits || [])];
  // 命中列表也按指纹去重，防止历史里堆重复
  const hitSeen = new Set();
  const hits = [];
  for (const h of merged) {
    const k = fingerprint(h);
    if (!k || hitSeen.has(k)) continue;
    hitSeen.add(k);
    hits.push(h);
    if (hits.length >= MAX_HITS) break;
  }

  const notes = [...(res.errors || []), ...(res.notes || [])].slice(0, 6);
  watchStore.update(id, {
    lastRun: stamp,
    lastRunAt: stamp,
    baselineAt,
    seen: [...new Set([...(w.seen || []), ...res.results.map((r) => normalizeUrl(r.url))])].slice(-MAX_SEEN),
    seenKeys: [...known].slice(-MAX_SEEN),
    lastCount: res.count,
    lastFresh: firstRun ? 0 : newHits.length,
    lastBackfill: backfillHits.length,
    lastStats: res.stats || {},
    lastNotes: notes,
    lastError: res.errors?.length ? res.errors.join(' | ') : '',
    hits,
  });

  if (!silent && !firstRun && newHits.length) {
    emit('watch:hit', {
      watchId: id,
      query: w.query,
      count: newHits.length,
      items: newHits.slice(0, 5),
    });
    // Webhook 推送（钉钉/飞书/企业微信/Telegram/自定义）；失败只记日志，不影响任务
    pushWebhook({ ...w, hits }, newHits).catch((e) => console.error('[watch] webhook:', e.message));
  }
  // 监控结果落成 Markdown（Obsidian / Typora 直接可看可编辑）
  writeWatchDigest({ ...w, hits, lastRun: stamp });

  return {
    fresh: firstRun ? 0 : newHits.length,
    baseline: baselineItems.length,
    backfill: backfillHits.length,
    firstRun,
    total: res.count,
    pages,
    sources: src,
    timeRange: w.timeRange || '',
    results: [...newHits, ...baselineItems].slice(0, 40),
    errors: res.errors,
    notes: res.notes,
    stats: res.stats,
  };
}

/* ---------------- Webhook 推送 ---------------- */

async function pushWebhook(w, hits) {
  let url = String(settings().watch?.webhookUrl || '').trim();
  if (!url || !/^https?:\/\//.test(url)) return;

  const lines = hits.slice(0, 8).map(
    (h, i) =>
      `**${i + 1}. ${clean(h.title).slice(0, 80)}**\n> ${h.source || ''}${h.account ? ` · ${h.account}` : ''}${h.date ? ` · ${h.date}` : ''}\n> ${h.url}`
  );
  const text = `【ArticleForge 监控】「${w.label || w.query}」新增 ${hits.length} 条\n\n${lines.join('\n\n')}`;

  let body;
  if (/oapi\.dingtalk\.com/.test(url)) {
    body = { msgtype: 'markdown', markdown: { title: `监控命中：${(w.label || w.query).slice(0, 20)}`, text } };
    const secret = String(settings().watch?.webhookSecret || '').trim();
    if (secret && url.includes('access_token=')) {
      const ts = Date.now();
      const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
      url += `&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
    }
  } else if (/open\.feishu\.cn|larksuite/.test(url)) {
    body = { msg_type: 'text', content: { text: text.replace(/\*\*/g, '').replace(/^> /gm, '') } };
  } else if (/qyapi\.weixin\.qq\.com/.test(url)) {
    body = { msgtype: 'text', text: { content: text.replace(/\*\*/g, '').replace(/^> /gm, '').slice(0, 2000) } };
  } else if (/api\.telegram\.org/.test(url)) {
    const chatId = String(settings().watch?.telegramChatId || '').trim();
    if (!chatId) throw new Error('Telegram 推送需要在设置里填 Chat ID');
    body = { chat_id: chatId, text, disable_web_page_preview: false };
  } else {
    // 自定义 Webhook：POST JSON（title/text/count/items）
    body = {
      title: `监控命中：${w.label || w.query}`,
      query: w.query,
      count: hits.length,
      text,
      items: hits.slice(0, 8).map((h) => ({ title: h.title, url: h.url, source: h.source, date: h.date, score: h.score })),
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Webhook 返回 ${res.status}`);
}

/* ---------------- 监控 Markdown 日报 ----------------
 * 每个任务一份 md，写入 Obsidian vault（或任意 Markdown 目录 / 自定义目录），
 * frontmatter + 分轮次小节，管理软件里直接能看能编辑，不用切换软件。
 */

function watchDigestDir() {
  const s = settings();
  const dir = String(s.watch?.markdownDir || '').trim();
  if (dir) return dir;
  if (s.kb?.destination === 'obsidian' && s.obsidian?.vaultPath) {
    return path.join(s.obsidian.vaultPath, s.obsidian.folder || 'ArticleForge', '监控');
  }
  if (s.kb?.destination === 'folder' && s.folder?.dir) {
    return path.join(s.folder.dir, 'ArticleForge-监控');
  }
  return '';
}

const safeFileName = (v) => String(v || '').replace(/[\\/:*?"<>|#^\[\]]/g, '_').trim().slice(0, 60) || '未命名';

export function buildWatchMarkdown(w) {
  const hits = Array.isArray(w.hits) ? w.hits : [];
  const yq = (v) => String(v ?? '').replace(/"/g, "'");
  const windowLabel = TIME_WINDOW_DAYS[w.timeRange]
    ? { day: '24 小时', week: '一周', month: '一个月', '3month': '三个月', year: '一年' }[w.timeRange]
    : '不限时间';

  const head = [
    '---',
    `title: "监控 · ${yq(w.label || w.query)}"`,
    'tags:',
    '  - 监控',
    '  - ArticleForge',
    `created: ${w.createdAt || new Date().toISOString()}`,
    `updated: ${new Date().toISOString()}`,
    `query: "${yq(w.query)}"`,
    `sources: ${w.sources || (w.wechatOnly !== false ? 'wechat' : 'all')}`,
    `interval: 每 ${w.intervalMin || 20} 分钟`,
    `window: ${windowLabel}`,
    `lastRun: ${w.lastRun || ''}`,
    '---',
    '',
    `> [!info] 关键词 **${w.query}** 的监控命中`,
    `> 报警窗口 **${windowLabel}**，上次检查 ${w.lastRun ? w.lastRun.replace('T', ' ').slice(0, 16) : '尚未运行'}。`,
    '> 本文件由 ArticleForge 生成，可直接编辑；监控命中点击标题即可抓取入库。',
    '',
  ];

  if (!hits.length) {
    head.push('暂无命中。首轮运行只建立基线，之后才会推送窗口内的新文章。', '');
    return head.join('\n');
  }

  // 按 foundAt（轮次）分组，新轮次在前；最多保留 30 轮
  const runs = new Map();
  for (const h of hits) {
    const at = h.foundAt || w.lastRun || '';
    if (!runs.has(at)) runs.set(at, []);
    runs.get(at).push(h);
  }
  let runNo = 0;
  for (const [at, list] of runs) {
    runNo++;
    if (runNo > 30) break;
    const when = at ? at.replace('T', ' ').slice(0, 16) : '未知时间';
    const fresh = list.filter((h) => h.isNew && !h.baseline && !h.backfill);
    const tagline = fresh.length
      ? `新增 ${fresh.length} 条`
      : list.some((h) => h.baseline)
        ? '首轮基线'
        : '旧文补录';
    head.push(`## ${when}（${tagline}）`, '');
    for (const h of list.slice(0, 20)) {
      const bits = [
        h.source || '',
        h.account || '',
        h.date ? `发布 ${h.date}` : '',
        h.baseline ? '基线' : '',
        h.backfill ? '旧文补录' : '',
        typeof h.score === 'number' ? `评分 ${h.score}` : '',
      ].filter(Boolean);
      head.push(`- [${clean(h.title).slice(0, 90)}](${h.url})`);
      if (bits.length) head.push(`  - ${bits.join(' · ')}`);
    }
    head.push('');
  }
  return head.join('\n');
}

function writeWatchDigest(w) {
  try {
    const dir = watchDigestDir();
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `监控-${safeFileName(w.label || w.query)}.md`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, buildWatchMarkdown(w), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[watch] 写监控日报失败:', e.message);
  }
}

/* ---------------- 任务管理 ---------------- */

export function addWatch({
  query,
  provider,
  intervalMin,
  wechatOnly = true,
  max,
  label,
  pages,
  timeRange,
  sources,
}) {
  const cfg = settings();
  const src = SOURCES.includes(sources) ? sources : '';
  const task = {
    id: hashId(query + Date.now()),
    query: query.trim(),
    label: (label || query).slice(0, 40),
    provider: provider || cfg.search?.provider || 'baidu',
    intervalMin: Math.max(5, Number(intervalMin) || Number(cfg.watch?.intervalMin) || 20),
    wechatOnly: Boolean(wechatOnly),
    sources: src || cfg.watch?.sources || 'all',
    pages: Math.max(1, Math.min(10, Number(pages) || Number(cfg.watch?.pages) || Number(cfg.search?.wechatPages) || 8)),
    timeRange: timeRange ?? cfg.watch?.timeRange ?? 'week',
    max: Math.max(10, Math.min(200, Number(max) || (Number(cfg.watch?.pages) || 8) * 10)),
    enabled: true,
    createdAt: new Date().toISOString(),
    baselineAt: Date.now(),
    lastRun: '',
    seen: [],
    seenKeys: [],
    hits: [],
  };
  watchStore.add(task);
  return task;
}

export async function updateWatch(id, patch) {
  const w = watchStore.update(id, patch);
  if (!w) throw new Error('监控任务不存在');
  return w;
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const w of watchStore.list()) {
      if (!w.enabled) continue;
      // ±15% 抖动：多任务不会整点齐发，避免同一 IP 瞬时连击
      const interval = Math.max(1, Number(w.intervalMin) || 20) * (0.85 + Math.random() * 0.3);
      const due = !w.lastRun || now - new Date(w.lastRun).getTime() >= interval * 60_000;
      if (!due) continue;
      try {
        await checkWatch(w.id, { silent: false });
      } catch (e) {
        watchStore.update(w.id, { lastError: e.message, lastRun: new Date().toISOString() });
      }
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    }
  } finally {
    running = false;
  }
}
