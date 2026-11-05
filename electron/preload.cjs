/**
 * 预加载：只暴露三个窄接口给页面（顶栏菜单、标题栏按钮配色、应用内网页窗口），不给页面任何 Node 能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('afNative', {
  isDesktop: true,
  titlebarHeight: 38,
  popupMenu: (x, y) => ipcRenderer.send('af:menu', { x, y }),
  setOverlay: (color, symbol) => ipcRenderer.send('af:overlay', { color, symbol }),
  openInApp: (url) => ipcRenderer.send('af:open-in-app', String(url || '')),
});
