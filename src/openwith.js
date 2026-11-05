/**
 * 「打开方式」：网页链接可选 默认浏览器 / Edge / Chrome / Firefox，
 * 本地笔记可选 默认软件 / Obsidian / VS Code / Typora / 记事本。
 * 只探测本机实际装了的软件；一律 spawn 参数数组，不经 shell，避免命令注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const env = (k) => process.env[k] || '';

/** 每个候选软件：可能的安装路径 + 能打开的目标类型 */
const CANDIDATES = [
  {
    id: 'edge',
    label: 'Microsoft Edge',
    kinds: ['url'],
    paths: [
      path.join(env('ProgramFiles(x86)'), 'Microsoft/Edge/Application/msedge.exe'),
      path.join(env('ProgramFiles'), 'Microsoft/Edge/Application/msedge.exe'),
    ],
  },
  {
    id: 'chrome',
    label: 'Google Chrome',
    kinds: ['url'],
    paths: [
      path.join(env('ProgramFiles'), 'Google/Chrome/Application/chrome.exe'),
      path.join(env('ProgramFiles(x86)'), 'Google/Chrome/Application/chrome.exe'),
      path.join(env('LOCALAPPDATA'), 'Google/Chrome/Application/chrome.exe'),
    ],
  },
  {
    id: 'firefox',
    label: 'Firefox',
    kinds: ['url'],
    paths: [
      path.join(env('ProgramFiles'), 'Mozilla Firefox/firefox.exe'),
      path.join(env('ProgramFiles(x86)'), 'Mozilla Firefox/firefox.exe'),
    ],
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    kinds: ['file'],
    uri: true, // 走 obsidian://open?path=，在已打开的库里定位到这篇
    paths: [path.join(env('LOCALAPPDATA'), 'Programs/Obsidian/Obsidian.exe'), path.join(env('ProgramFiles'), 'Obsidian/Obsidian.exe')],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    kinds: ['file'],
    paths: [
      path.join(env('LOCALAPPDATA'), 'Programs/Microsoft VS Code/Code.exe'),
      path.join(env('ProgramFiles'), 'Microsoft VS Code/Code.exe'),
    ],
  },
  {
    id: 'typora',
    label: 'Typora',
    kinds: ['file'],
    paths: [path.join(env('ProgramFiles'), 'Typora/Typora.exe'), path.join(env('LOCALAPPDATA'), 'Programs/Typora/Typora.exe')],
  },
  {
    id: 'notepad',
    label: '记事本',
    kinds: ['file'],
    paths: [path.join(env('SystemRoot') || 'C:/Windows', 'System32/notepad.exe')],
  },
];

let cache = null;
let cacheAt = 0;

/** 本机可用的打开方式（结果缓存 60s，装了新软件刷新一下就能看到） */
export function listOpenApps() {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  const found = [];
  if (IS_WIN) {
    for (const c of CANDIDATES) {
      const exe = c.paths.find((p) => p && fs.existsSync(p));
      if (exe) found.push({ id: c.id, label: c.label, kinds: c.kinds, exe, uri: !!c.uri });
    }
  }
  cache = {
    url: [{ id: 'default', label: '系统默认浏览器' }, ...found.filter((a) => a.kinds.includes('url')).map(({ id, label }) => ({ id, label }))],
    file: [{ id: 'default', label: '系统默认软件' }, ...found.filter((a) => a.kinds.includes('file')).map(({ id, label }) => ({ id, label }))],
    _exe: Object.fromEntries(found.map((a) => [a.id, a])),
  };
  cacheAt = Date.now();
  return cache;
}

function launch(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

function openDefault(target) {
  const cmd = IS_WIN ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  launch(cmd, [target]);
}

/** 用指定软件打开网页链接 */
export function openUrlWith(url, appId = 'default') {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('只能打开 http/https 链接');
  // 校验能被 URL 解析，挡住带引号/换行的畸形输入
  const safe = new URL(u).href;
  if (!appId || appId === 'default') {
    openDefault(safe);
    return { opened: safe, app: 'default' };
  }
  const a = listOpenApps()._exe[appId];
  if (!a || !a.kinds.includes('url')) throw new Error('本机没有找到这个浏览器');
  launch(a.exe, [safe]);
  return { opened: safe, app: appId };
}

/** 用指定软件打开本地文件（调用方负责先把路径限定在知识库内） */
export function openFileWith(abs, appId = 'default') {
  if (!appId || appId === 'default') {
    openDefault(abs);
    return { opened: abs, app: 'default' };
  }
  const a = listOpenApps()._exe[appId];
  if (!a || !a.kinds.includes('file')) throw new Error('本机没有找到这个软件');
  if (a.uri && appId === 'obsidian') {
    openDefault(`obsidian://open?path=${encodeURIComponent(abs)}`);
  } else {
    launch(a.exe, [abs]);
  }
  return { opened: abs, app: appId };
}
