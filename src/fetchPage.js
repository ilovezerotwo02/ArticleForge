import puppeteer from 'puppeteer-core';
import { UA, findBrowser, settings } from './config.js';

let browserPromise = null;

export async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {}
    browserPromise = null;
  }
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new Error('未找到 Chrome / Edge 浏览器，请在「设置」里手动指定浏览器可执行文件路径');
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: settings().browser?.headless === false ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--hide-scrollbars',
      '--font-render-hinting=none',
    ],
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
  });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {}
  browserPromise = null;
}

const BROWSER_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 轻量抓取：普通 HTTP 请求，速度快 */
export async function fetchHtmlLight(url, { timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const referer = new URL(url).origin + '/';
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Referer: referer },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { html: decode(buf, res.headers.get('content-type')), finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function decode(buf, contentType = '') {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = buf.slice(0, 4096).toString('latin1');
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  const norm = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(norm === 'gb2312' ? 'gbk' : norm).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/** 浏览器渲染抓取：应对 SPA / 懒加载 / 反爬 */
export async function fetchHtmlRendered(url, { timeout = 45000, waitFor = null, scroll = true } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
    }
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => {});
    if (scroll) {
      // 触发懒加载图片
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.9;
        for (let y = 0; y < document.body.scrollHeight && y < 30000; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
    }
    const html = await page.content();
    return { html, finalUrl: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

/** 用浏览器把 HTML 打印成 PDF */
export async function printPdf(html, outPath, { pageSize = 'A4', margin = '16mm', footer = true, baseUrl } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const withBase = baseUrl && html.includes('<head>')
      ? html.replace('<head>', `<head><base href="${baseUrl}">`)
      : html;
    // networkidle0 在 setContent 场景下容易永远不触发，用 load + 显式等图片
    await page.setContent(withBase, { waitUntil: ['domcontentloaded', 'load'], timeout: 45000 });
    // 等图片解码完成，避免 PDF 里出现空白图
    await page.evaluate(async () => {
      const imgs = [...document.images];
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? null
            : new Promise((r) => {
                img.onload = img.onerror = r;
                setTimeout(r, 4000);
              })
        )
      );
      if (document.fonts?.ready) await document.fonts.ready;
    }).catch(() => {});

    const footerTemplate = footer
      ? `<div style="width:100%;font-size:8px;color:#9aa0a6;font-family:'Microsoft YaHei',sans-serif;padding:0 12mm;display:flex;justify-content:space-between;">
           <span>ArticleForge</span><span class="pageNumber"></span>/<span class="totalPages"></span>
         </div>`
      : '';

    await page.pdf({
      path: outPath,
      format: pageSize,
      printBackground: true,
      margin: { top: margin, right: margin, bottom: footer ? '18mm' : margin, left: margin },
      displayHeaderFooter: footer,
      headerTemplate: '<div></div>',
      footerTemplate,
      preferCSSPageSize: false,
      tagged: true,
    });
    return outPath;
  } finally {
    await page.close().catch(() => {});
  }
}

/** 下载图片等二进制资源 */
export async function fetchBinary(url, referer, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: referer || 'https://mp.weixin.qq.com/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      type: res.headers.get('content-type') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}
