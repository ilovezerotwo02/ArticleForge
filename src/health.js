/* ---------------- 源健康度熔断 ----------------
 * 免费源被限流/网络不可达时按指数退避冷却，冷却期内直接跳过：
 * - 普通失败（超时、网络不可达）从 90 秒起
 * - 反爬/验证码/限流（涉及 IP 封禁）从 5 分钟起，最长 15 分钟
 * 连续成功会把失败计数清零。
 */

const health = new Map();

export function noteOk(name) {
  const prev = health.get(name);
  health.set(name, { fails: 0, lastErr: '', skipUntil: 0, ok: (prev?.ok || 0) + 1 });
}

export function noteFail(name, msg) {
  const h = health.get(name) || { fails: 0 };
  h.fails += 1;
  h.lastErr = msg;
  h.ok = 0;
  // 被判定为反爬/验证码时要歇得久一点，否则 90 秒后重试只会把封禁续上
  const blocked = /反爬|验证|限流|额度|forbidden|rate.?limit/i.test(msg);
  const base = blocked ? 5 * 60_000 : 90_000;
  h.skipUntil = Date.now() + Math.min(15 * 60_000, base * 2 ** Math.min(h.fails - 1, 3));
  health.set(name, h);
}

export function isDown(name) {
  const h = health.get(name);
  return Boolean(h && h.skipUntil > Date.now());
}

export function healthDetail(name) {
  return health.get(name) || null;
}

export function searchHealth() {
  return [...health.entries()].map(([name, h]) => ({
    name,
    fails: h.fails || 0,
    lastErr: h.lastErr || '',
    cooldownSec: h.skipUntil > Date.now() ? Math.round((h.skipUntil - Date.now()) / 1000) : 0,
  }));
}
