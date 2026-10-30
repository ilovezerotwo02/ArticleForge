// README 配图演示数据：往临时数据目录写演示 library.json / vault / settings，再发几条待办
// 用法：AFDIR=<临时数据目录> AF_URL=http://127.0.0.1:5199 node scripts/seed-demo.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = (process.env.AFDIR || '.').replace(/\\/g, '/');
const BASE = process.env.AF_URL || 'http://127.0.0.1:5199';
const now = Date.now();
const day = (n) => new Date(now - n * 86400_000).toISOString();

const phase = process.argv[2] || 'files';

if (phase === 'files') {
  const lib = [
  { id: 'demo0001a', title: '内存取证入门：从内存转储到进程列表', url: 'https://mp.weixin.qq.com/s/demo1', source: 'wechat', account: '玄天CTF实验室', author: '', publishedAt: '2026-10-27', createdAt: day(1), words: 4820, imageCount: 6, tags: ['取证', 'Volatility'], userTags: ['未完成'] },
  { id: 'demo0002b', title: 'Volatility 3 命令速查（含网络扫描与注册表）', url: 'https://mp.weixin.qq.com/s/demo2', source: 'wechat', account: '数字取证与响应', author: '', publishedAt: '2026-10-24', createdAt: day(3), words: 3115, imageCount: 4, tags: ['取证'], userTags: ['进行中'] },
  { id: 'demo0003c', title: 'CTF 取证题的常见套路与工具链', url: 'https://example.org/ctf-forensics', source: 'web', account: '', author: 'SecPulse', publishedAt: '2026-10-20', createdAt: day(5), words: 5630, imageCount: 9, tags: ['CTF'], userTags: ['已完成'] },
  { id: 'demo0004d', title: 'Windows 事件日志分析入门', url: '', source: 'upload', account: '', author: '', publishedAt: '', createdAt: day(7), words: 2100, imageCount: 0, tags: ['蓝队', '日志'], userTags: ['重要'] },
];
fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(lib, null, 2));

const v = path.join(dir, 'demo-vault');
fs.mkdirSync(path.join(v, '取证', '内存'), { recursive: true });
fs.mkdirSync(path.join(v, '取证', '磁盘'), { recursive: true });
fs.mkdirSync(path.join(v, '网络'), { recursive: true });
fs.writeFileSync(path.join(v, '取证', '内存', '内存取证入门.md'), '# 内存取证入门\n==只读== 与 ==共享== 是代码区的两大特点。\n');
fs.writeFileSync(path.join(v, '取证', '内存', 'Volatility速查.md'), '# Volatility 速查\npslist / netscan / cmdline\n');
fs.writeFileSync(path.join(v, '取证', '磁盘', 'Autopsy上手.md'), '# Autopsy 上手\n');
fs.writeFileSync(path.join(v, '网络', 'Wireshark常用过滤器.md'), '# Wireshark 过滤器\n');
fs.writeFileSync(path.join(v, '索引.md'), '# 索引\n');

const sf = path.join(dir, 'settings.json');
// settings.json 平时不落盘，直接写精简版（服务端 readSettings 会与默认值深合并）
// 配一个演示 apiKey，避免截图里弹「AI 未配置」的 toast
fs.writeFileSync(
  sf,
  JSON.stringify({ obsidian: { vaultPath: v }, ai: { enabled: true, apiKey: 'sk-demo-screenshot', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' } }, null, 2)
);
console.log('seeded files:', dir);
process.exit(0);
}

/* phase === 'todos'：需要服务已启动 */
const todo = async (text, done = false) => {
  const r = await fetch(BASE + '/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const d = await r.json();
  if (done) await fetch(BASE + `/api/todos/${d.todo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
};
await todo('把 Volatility 速查表整理进知识库');
await todo('复现 CVE-2026-31334 的内存转储流程');
await todo('整理完 CTF 取证工具链笔记', true);
console.log('seeded todos');
