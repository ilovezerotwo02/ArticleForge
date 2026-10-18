import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { MEDIA, ensureDir } from './config.js';
import { fetchHtmlLight, fetchHtmlRendered, fetchBinary } from './fetchPage.js';
import { sanitizeDocument } from './sanitize.js';
import { htmlToMarkdown } from './exporters/markdown.js';
import { hashId } from './store.js';
import { resolveWeixinByTitle, resolveSogouLink } from './search.js';

/** 搜狗跳转链接 → 真实文章地址（服务端解析跳转页，必要时用标题兜底反查） */
export async function resolveRedirect(url, { titleHint = '' } = {}) {
  if (!/sogou\.com\/link/.test(url)) return url;

  try {
    const real = await resolveSogouLink(url);
    if (real) return real;
  } catch {}

  if (titleHint) {
    try {
      const hit = await resolveWeixinByTitle(titleHint);
      if (hit?.url) return hit.url;
    } catch {}
  }
  return url;
}

export function detectSource(url) {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)mp\.weixin\.qq\.com$/.test(host)) return 'wechat';
    if (/(^|\.)weixin\.qq\.com$/.test(host)) return 'wechat';
    if (/zhuanlan\.zhihu\.com|juejin\.cn|csdn\.net|cnblogs\.com|segmentfault|oschina|infoq|sspai|36kr|medium\.com|dev\.to|substack/.test(host)) return 'tech';
    return 'web';
  } catch {
    return 'web';
  }
}

function pickMeta(doc, names) {
  for (const n of names) {
    const el =
      doc.querySelector(`meta[property="${n}"]`) ||
      doc.querySelector(`meta[name="${n}"]`) ||
      doc.querySelector(`meta[itemprop="${n}"]`);
    if (el?.content) return el.content.trim();
  }
  return '';
}

/**
 * 抓取 + 抽取正文
 */
export async function fetchArticleSource(url, { forceRender = false } = {}) {
  if (/sogou\.com\/link/.test(url)) {
    throw new Error('搜狗跳转链接已过期：请回到「检索」重新搜索该文章，结果会直接给出微信原文地址');
  }
  const source = detectSource(url);
  let html = '';
  let finalUrl = url;
  let rendered = false;

  if (!forceRender) {
    try {
      const r = await fetchHtmlLight(url);
      html = r.html;
      finalUrl = r.finalUrl;
    } catch (e) {
      html = '';
    }
  }

  const looksEmpty = (h) => {
    if (!h || h.length < 500) return true;
    if (/环境异常|完成验证|访问过于频繁|Just a moment|Enable JavaScript/i.test(h.slice(0, 4000))) return true;
    return false;
  };

  // 微信：正文容器必须存在
  if (source === 'wechat') {
    const hasContent = html.includes('id="js_content"') || html.includes("id='js_content'");
    if (forceRender || looksEmpty(html) || !hasContent) {
      const r = await fetchHtmlRendered(url, { waitFor: '#js_content' });
      html = r.html || html;
      finalUrl = r.finalUrl || url;
      rendered = true;
    }
  } else if (forceRender || looksEmpty(html)) {
    const r = await fetchHtmlRendered(url);
    html = r.html || html;
    finalUrl = r.finalUrl || url;
    rendered = true;
  }

  if (!html) throw new Error('页面抓取失败：目标站点无响应或被拦截');

  const dom = new JSDOM(html, { url: finalUrl, contentType: 'text/html' });
  const doc = dom.window.document;

  let title = '';
  let author = '';
  let account = '';
  let publishedAt = '';
  let container = null;

  if (source === 'wechat') {
    title = doc.querySelector('#activity-name')?.textContent?.trim() || '';
    account = doc.querySelector('#js_name')?.textContent?.trim() || '';
    author = doc.querySelector('#js_author_name')?.textContent?.trim() || '';
    publishedAt =
      doc.querySelector('#publish_time')?.textContent?.trim() ||
      pickMeta(doc, ['article:published_time', 'og:release_date']) ||
      '';
    if (!publishedAt) {
      const ts = /var\s+ct\s*=\s*"?(\d{10})"?/.exec(html)?.[1] || /create_time\s*[:=]\s*"?(\d{10})/.exec(html)?.[1];
      if (ts) {
        const d = new Date(Number(ts) * 1000);
        publishedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    container = doc.querySelector('#js_content');
    if (!container) throw new Error('未找到微信正文（可能文章已删除、被限制访问或需要验证）');
  } else {
    const clone = doc.cloneNode(true);
    const reader = new Readability(clone, {
      charThreshold: 120,
      keepClasses: false,
      disableJSONLD: false,
    });
    const parsed = reader.parse();
    if (!parsed || !parsed.content || parsed.content.length < 80) {
      throw new Error('未能识别正文内容，可尝试「强制浏览器渲染」后重试');
    }
    title = parsed.title || doc.title || '';
    author = parsed.byline || pickMeta(doc, ['author', 'article:author']);
    publishedAt = pickMeta(doc, ['article:published_time', 'datePublished', 'pubdate']);
    const frag = doc.createElement('div');
    frag.innerHTML = parsed.content;
    container = frag;
  }

  const cover = pickMeta(doc, ['og:image', 'twitter:image']);

  return {
    source,
    url,
    finalUrl,
    title: (title || '未命名文章').replace(/\s+/g, ' ').trim(),
    author,
    account,
    publishedAt,
    cover,
    container,
    doc,
    rendered,
  };
}

/** 下载图片到本地，返回 url -> {src, width, height, file} */
export async function localizeImages(urls, articleId, referer, { limit = 80, concurrency = 5 } = {}) {
  const dir = ensureDir(path.join(MEDIA, articleId));
  const map = new Map();
  const list = urls.slice(0, limit);
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const myIndex = idx++;
      const url = list[myIndex];
      try {
        const { buffer, type } = await fetchBinary(url, referer);
        if (!buffer.length) continue;
        let ext = '';
        try {
          const dim = imageSize(buffer);
          ext = dim.type ? `.${dim.type === 'jpg' ? 'jpg' : dim.type}` : '';
          map.set(url, { width: dim.width, height: dim.height });
        } catch {}
        if (!ext) {
          const ct = /image\/([\w+]+)/.exec(type)?.[1] || '';
          const fromUrl = /wx_fmt=(\w+)/.exec(url)?.[1] || '';
          ext = '.' + (ct || fromUrl || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        }
        const name = `${String(myIndex + 1).padStart(3, '0')}${ext}`;
        fs.writeFileSync(path.join(dir, name), buffer);
        const info = map.get(url) || {};
        map.set(url, { ...info, file: name, local: `/media/${articleId}/${name}`, bytes: buffer.length });
      } catch (e) {
        // 图片失败不影响正文，保留原始外链
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return map;
}

/**
 * 完整流水线：URL → Article 对象
 */
export async function buildArticle(url, { forceRender = false, titleHint = '' } = {}) {
  const resolved = await resolveRedirect(url, { titleHint }).catch(() => url);
  url = resolved || url;
  const src = await fetchArticleSource(url, { forceRender });
  const { doc, container } = src;

  const normalized = sanitizeDocument(doc, container, { baseUrl: src.finalUrl });
  const id = hashId(src.finalUrl + '|' + src.title);

  // 图片本地化
  let assets = [];
  if (normalized.imageUrls.length) {
    const map = await localizeImages(normalized.imageUrls, id, src.finalUrl);
    assets = [...map.entries()]
      .filter(([, v]) => v.local)
      .map(([url, v]) => ({ url, ...v }));

    const wrapper = doc.createElement('div');
    wrapper.innerHTML = normalized.html;
    for (const img of wrapper.querySelectorAll('img')) {
      const origin = img.getAttribute('data-origin') || img.getAttribute('src');
      const hit = map.get(origin);
      if (hit?.local) {
        img.setAttribute('src', hit.local);
        img.removeAttribute('data-origin');
      } else {
        img.removeAttribute('data-origin');
      }
    }
    normalized.html = wrapper.innerHTML;
  }

  // 标题也作为一级信息，正文标题从 h2 起
  const markdown = htmlToMarkdown(normalized.html, {
    title: src.title,
    url: src.finalUrl,
    author: src.author || src.account,
    publishedAt: src.publishedAt,
  });

  const cover = assets[0]?.local || (src.cover && /^https?:/.test(src.cover) ? src.cover : '');

  const article = {
    id,
    url: src.url,
    finalUrl: src.finalUrl,
    source: src.source,
    title: src.title,
    author: src.author || '',
    account: src.account || '',
    publishedAt: src.publishedAt || '',
    cover,
    html: normalized.html,
    markdown,
    text: normalized.text,
    outline: normalized.outline,
    assets,
    headingCount: normalized.headingCount,
    words: (normalized.text.match(/[\u4e00-\u9fa5]/g) || []).length + (normalized.text.match(/[A-Za-z]+/g) || []).length,
    createdAt: new Date().toISOString(),
    tags: [],
    rendered: src.rendered,
  };

  const plain = normalized.text;
  article.summary = plain.slice(0, 220).replace(/\n/g, ' ');
  article.checksum = crypto.createHash('sha1').update(plain).digest('hex').slice(0, 10);

  return article;
}
