import { watchStore, emit, hashId, normalizeUrl } from './store.js';
import { searchWeb } from './search.js';
import { settings } from './config.js';

let timer = null;
let running = false;

export function startWatcher() {
  if (timer) return;
  const every = Math.max(1, Number(settings().watch?.intervalMin || 30));
  timer = setInterval(() => tick().catch((e) => console.error('[watch]', e.message)), 60_000);
  // 启动 20 秒后先跑一轮，避开服务启动高峰
  setTimeout(() => tick().catch(() => {}), 20_000);
  console.log(`[watch] 监控已启动（每 ${every} 分钟检查一次任务）`);
}

export async function checkWatch(id, { silent = false } = {}) {
  const w = watchStore.list().find((x) => x.id === id);
  if (!w) throw new Error('监控任务不存在');

  const res = await searchWeb(w.query, { provider: w.provider, max: w.max || 10, wechatOnly: w.wechatOnly });
  const seen = new Set((w.seen || []).map(normalizeUrl));
  const fresh = res.results.filter((r) => !seen.has(normalizeUrl(r.url)));
  const firstRun = !w.lastRun;

  const hits = firstRun ? res.results.slice(0, 8) : fresh;

  watchStore.update(id, {
    lastRun: new Date().toISOString(),
    seen: [...new Set([...(w.seen || []), ...res.results.map((r) => normalizeUrl(r.url))])].slice(-600),
    lastCount: res.count,
    lastError: res.errors?.length ? res.errors.join(' | ') : '',
    hits: [
      ...(firstRun ? hits.map((h) => ({ ...h, at: new Date().toISOString(), baseline: true })) : hits.map((h) => ({ ...h, at: new Date().toISOString() }))),
      ...(w.hits || []),
    ].slice(0, 60),
  });

  if (!silent && fresh.length && !firstRun) {
    emit('watch:hit', {
      watchId: id,
      query: w.query,
      count: fresh.length,
      items: fresh.slice(0, 5),
    });
  }

  return { fresh: hits.length, results: hits, firstRun, errors: res.errors };
}

export function addWatch({ query, provider, intervalMin = 30, wechatOnly = true, max = 10, label }) {
  const task = {
    id: hashId(query + Date.now()),
    query: query.trim(),
    label: (label || query).slice(0, 40),
    provider: provider || settings().search?.provider || 'bing',
    intervalMin: Math.max(5, Number(intervalMin) || 30),
    wechatOnly,
    max,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRun: '',
    seen: [],
    hits: [],
  };
  watchStore.add(task);
  return task;
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const w of watchStore.list()) {
      if (!w.enabled) continue;
      const due = !w.lastRun || now - new Date(w.lastRun).getTime() >= (w.intervalMin || 30) * 60_000;
      if (!due) continue;
      try {
        await checkWatch(w.id, { silent: false });
      } catch (e) {
        watchStore.update(w.id, { lastError: e.message, lastRun: new Date().toISOString() });
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    running = false;
  }
}
