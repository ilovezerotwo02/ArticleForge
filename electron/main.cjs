/**
 * ArticleForge 桌面版主进程（CommonJS，Electron 兼容性最稳）
 * - 复用同一份 Express 服务（内置，起在本地空闲端口）
 * - 数据写到 %APPDATA%/ArticleForge/data，不污染安装目录
 * - 监控命中走系统通知，外链走系统浏览器，托盘常驻
 */
const { app, BrowserWindow, Menu, Tray, shell, nativeImage, Notification, dialog, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SHOT = process.env.AF_SHOT || '';

let win = null;
const TITLEBAR_H = 38;
let tray = null;
let serverPort = 0;

// 少数环境（虚拟机 / 远程桌面 / 沙箱）GPU 进程会崩溃，用软件渲染更稳
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  start().catch((e) => {
    dialog.showErrorBox('ArticleForge 启动失败', String(e && e.stack ? e.stack : e));
    app.quit();
  });
}

/* ---------------- 工具 ---------------- */

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) {
      try {
        fs.copyFileSync(s, d);
      } catch {}
    }
  }
}

function freePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(start + 1)));
    srv.once('listening', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.listen(start, '127.0.0.1');
  });
}

async function waitServer(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const importEsm = (absPath) => import(pathToFileURL(absPath).href);

/* ---------------- 启动 ---------------- */

async function start() {
  await app.whenReady();
  app.setAppUserModelId('com.articleforge.app');

  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.AF_DATA_DIR = dataDir;

  // 首次启动：把安装包内的示例数据搬过来（不覆盖已有）
  const bundledData = path.join(ROOT, 'data');
  if (!fs.existsSync(path.join(dataDir, 'library.json')) && fs.existsSync(bundledData)) {
    try {
      copyDir(bundledData, dataDir);
    } catch {}
  }

  serverPort = await freePort(Number(process.env.PORT) || 5178);
  process.env.PORT = String(serverPort);

  await importEsm(path.join(ROOT, 'server.js'));

  const ok = await waitServer(serverPort);
  if (!ok) dialog.showErrorBox('服务未就绪', '本地服务启动超时，请重试。');

  createWindow();
  createMenu();
  try {
    createTray();
  } catch {}
  listenWatchEvents();

  if (SHOT) {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(SHOT, img.toPNG());
      } catch (e) {
        fs.writeFileSync(SHOT + '.err.txt', String(e));
      }
      app.quit();
    }, 5500);
  }
}

function createWindow() {
  // 按屏幕可用区域自适应，避免小屏上窗口超出边界
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1580, Math.max(1024, wa.width - 80));
  const height = Math.min(1000, Math.max(680, wa.height - 80));

  win = new BrowserWindow({
    width,
    height,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#f6f7f9',
    title: 'ArticleForge',
    icon: path.join(ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    // 隐藏系统标题栏，由页面自绘顶栏（待办 / 两侧收起按钮在最上面），右上角保留系统窗口按钮
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#4b5563', height: TITLEBAR_H },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (!SHOT) win.focus();
  });

  win.loadURL(`http://127.0.0.1:${serverPort}/`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.includes(`127.0.0.1:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // iframe（正文预览）里点链接要交给系统浏览器，否则原站拒绝内嵌会变白页
  win.webContents.on('will-frame-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

/* ---------------- 页面 ↔ 主进程：顶栏菜单、应用内网页窗口 ---------------- */

ipcMain.on('af:menu', (e, pos) => {
  const menu = Menu.getApplicationMenu();
  if (!menu || !win) return;
  menu.popup({ window: win, x: Math.round(pos?.x || 12), y: Math.round(pos?.y || TITLEBAR_H) });
});

ipcMain.on('af:overlay', (e, opt) => {
  try {
    if (win && opt) win.setTitleBarOverlay({ color: opt.color || '#00000000', symbolColor: opt.symbol || '#4b5563' });
  } catch {}
});

/** 在本软件里直接打开网页原样（不跳系统浏览器）：独立子窗口，带返回/前进/外部打开 */
function openInAppWindow(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  const child = new BrowserWindow({
    width: Math.min(1280, (win && win.getBounds().width) || 1200),
    height: Math.min(900, (win && win.getBounds().height) || 860),
    parent: undefined,
    title: '网页查看 · ArticleForge',
    icon: path.join(ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  child.setMenu(
    Menu.buildFromTemplate([
      { label: '← 后退', accelerator: 'Alt+Left', click: () => child.webContents.navigationHistory?.canGoBack() && child.webContents.navigationHistory.goBack() },
      { label: '前进 →', accelerator: 'Alt+Right', click: () => child.webContents.navigationHistory?.canGoForward() && child.webContents.navigationHistory.goForward() },
      { label: '刷新', accelerator: 'F5', click: () => child.webContents.reload() },
      { label: '在系统浏览器打开', click: () => shell.openExternal(child.webContents.getURL()) },
      { label: '收入资料库', click: () => {
          const u = child.webContents.getURL();
          if (win) {
            win.show();
            win.webContents.executeJavaScript(`window.afConvertUrl && window.afConvertUrl(${JSON.stringify(u)})`).catch(() => {});
          }
        } },
    ])
  );
  child.setMenuBarVisibility(true);
  child.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u)) child.loadURL(u);
    return { action: 'deny' };
  });
  child.webContents.on('page-title-updated', (e, t) => child.setTitle(`${t} · 网页查看`));
  child.loadURL(url);
}

ipcMain.on('af:open-in-app', (e, url) => openInAppWindow(url));

function createMenu() {
  const dataDir = process.env.AF_DATA_DIR;
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => shell.openPath(dataDir) },
        { label: '打开导出目录', click: () => shell.openPath(path.join(dataDir, 'exports')) },
        { type: 'separator' },
        { label: '在浏览器中打开', click: () => shell.openExternal(`http://127.0.0.1:${serverPort}/`) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用说明', click: () => shell.openPath(path.join(ROOT, 'README.md')) },
        {
          label: '关于 ArticleForge',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: 'ArticleForge',
              detail: `版本 ${app.getVersion()}\n文章 → PDF / DOCX / Markdown，AI 阅读与 Obsidian 沉淀。\n\n数据目录：${dataDir}\n服务端口：${serverPort}`,
              buttons: ['好'],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const iconPath = path.join(ROOT, 'build', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  const img = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(img);
  tray.setToolTip('ArticleForge');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => (win ? win.show() : createWindow()) },
      { label: '打开导出目录', click: () => shell.openPath(path.join(process.env.AF_DATA_DIR, 'exports')) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
  tray.on('click', () => (win ? win.show() : createWindow()));
}

/* ---------------- 监控命中 → 系统通知 ---------------- */

async function listenWatchEvents() {
  if (!Notification.isSupported()) return;
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/events`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() || '';
      for (const chunk of chunks) {
        if (!chunk.includes('event: watch:hit')) continue;
        const dataLine = /^data:\s*(.+)$/m.exec(chunk);
        if (!dataLine) continue;
        try {
          const d = JSON.parse(dataLine[1]);
          const n = new Notification({
            title: '监控发现新文章',
            body: `「${d.query}」新增 ${d.count} 篇：${(d.items && d.items[0] && d.items[0].title) || ''}`,
            icon: path.join(ROOT, 'build', 'icon.png'),
          });
          n.on('click', () => {
            if (!win) createWindow();
            win.show();
            win.focus();
            win.webContents.executeJavaScript("window.switchView && window.switchView('watch')").catch(() => {});
          });
          n.show();
        } catch {}
      }
    }
  } catch {}
}

/* ---------------- 生命周期 ---------------- */

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  try {
    const m = await importEsm(path.join(ROOT, 'src/fetchPage.js'));
    await m.closeBrowser();
  } catch {}
});
