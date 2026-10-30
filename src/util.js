/* 检索/监控共用的纯工具：日期解析、标题相似度、小函数。无任何 IO。 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (base, spread) => sleep(base + Math.random() * spread);
export const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
export const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

export function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[\s\-_·、,，。.:：!！?？'"“”‘’()（）\[\]【】#]/g, '')
    .trim();
}

/* ---------------- 日期解析 ---------------- */

export const TZ = 'Asia/Shanghai';
export const pad2 = (v) => String(v).padStart(2, '0');

/** 按本机时区格式化 YYYY-MM-DD */
export function isoDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-CA', { timeZone: TZ });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** 「2026年5月20日」「2026-05-20」「2026/5/20」 */
export function parseCnDate(text) {
  const s = String(text || '');
  const cn = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
  if (cn) return `${cn[1]}-${pad2(cn[2])}-${pad2(cn[3])}`;
  const iso = /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    if (y >= 2000 && y <= 2100) return `${y}-${pad2(iso[2])}-${pad2(iso[3])}`;
  }
  return '';
}

/** 绝对日期 + 相对日期（3天前 / 昨天 / 2小时前 / 5月20日） */
export function parseAnyDate(text, base = Date.now()) {
  const s = String(text || '');
  const abs = parseCnDate(s);
  if (abs) return abs;

  const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
  if (md) {
    const y = Number(isoDate(base).slice(0, 4));
    return `${y}-${pad2(md[1])}-${pad2(md[2])}`;
  }

  if (/刚刚|刚才|分钟前/.test(s)) {
    const m = /(\d+)\s*分钟前/.exec(s);
    return isoDate(base - (m ? Number(m[1]) : 0) * 60_000);
  }
  const rel = /(\d+)\s*(小时|天|周|个?月|年)\s*(?:前|以前|之前)/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms = unit === '小时' ? 3600_000 : unit === '天' ? 86400_000 : unit === '周' ? 7 * 86400_000 : unit === '年' ? 365 * 86400_000 : 30 * 86400_000;
    return isoDate(base - n * ms);
  }
  if (/昨天/.test(s)) return isoDate(base - 86400_000);
  if (/前天/.test(s)) return isoDate(base - 2 * 86400_000);
  if (/今天|本日/.test(s)) return isoDate(base);
  return '';
}

export const tsOf = (d) => {
  if (!d) return 0;
  const t = Date.parse(String(d).length <= 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(t) ? 0 : t;
};

/* ---------------- 标题相似度 ---------------- */

export function bigrams(s) {
  const t = String(s || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

/** bigram 包含度：短标题也可靠 */
export function titleSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** 把查询拆成可匹配的小写 token（中英文均按词处理） */
export function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[\s,，+、|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/** 任一 token 命中即返回命中数，用于 feed 关键词过滤 */
export function tokenHits(...fields) {
  return (tokens) => {
    const hay = fields.map((f) => String(f || '').toLowerCase()).join(' \n ');
    return tokens.filter((t) => hay.includes(t)).length;
  };
}
