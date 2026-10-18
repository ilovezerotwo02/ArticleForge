/**
 * HTML 清洗 + 语义化
 * 目标：把微信/网页的"视觉排版 HTML"变成干净的语义 HTML（h2/p/strong/em/code/pre/figure/table）
 */
import { inferHeadings, estimateBodyFontSize } from './headings.js';
import { detectCodeBlocks, textOf } from './codeblocks.js';

const JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'link', 'meta', 'iframe', 'canvas', 'svg', 'form', 'input', 'button', 'select', 'textarea',
  '.qr_code_pc', '#js_pc_qr_code', '.rich_media_area_extra', '.rich_media_tool', '#js_article_comment', '.discuss_container',
  '.reward_area', '.js_ad_area', 'mp-common-profile', 'mp-common-clipboard', 'mp-common-mpaudio', '.share_notice', '.weui-msg',
  '.preview_tips', '#js_pc_qr_code', '.rich_media_meta_list', '.rich_media_content .js_ad_link', '.mp_profile_iframe_wrp',
  '.appmsg_card_context', '.js_underline_content .js_ad_area', 'mp-miniprogram', 'mp-style-type', '.code-snippet__fix .code-snippet__line-index',
  'qqmusic', 'mpvoice', 'mpprofile', 'mpprofile', '.js_unread_message', '.translate_translate', '.original_area_primary',
  '[style*="display:none"]', '[style*="display: none"]', '[hidden]', '[aria-hidden="true"]',
];

const NOISE_TEXT =
  /^(微信扫一扫(关注该公众号|可打开此内容.*)?|长按识别二维码(关注)?|预览时标签不可点|使用完整服务|继续滑动看下一个|向上滑动看下一个|轻触阅读原文|阅读原文|分享|收藏|点赞|在看|写留言|广告|了解更多|点击(关注|查看|阅读)|扫码(关注|添加)|关注该公众号|视频加载失败|已关注|取消关注|作者|来源：|编辑：|排版：|校对：)$/;

function absUrl(src, base) {
  if (!src) return '';
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

function isTinyImage(img) {
  const w = Number(img.getAttribute('width') || 0);
  const h = Number(img.getAttribute('height') || 0);
  if (w && w <= 3) return true;
  if (h && h <= 3) return true;
  const src = img.getAttribute('src') || '';
  if (/^data:image\/svg/i.test(src) && !img.getAttribute('data-src')) return true;
  return false;
}

/**
 * @param {Document} doc
 * @param {Element} container 正文容器
 * @param {{baseUrl:string}} opts
 */
export function sanitizeDocument(doc, container, { baseUrl }) {
  // 1) 去掉垃圾节点
  for (const sel of JUNK_SELECTORS) {
    try {
      container.querySelectorAll(sel).forEach((n) => n.remove());
    } catch {}
  }

  // 1.5) Word / Office 命名空间残留（<o:p>、<o:page>、<v:shape>、<w:*>）
  for (const el of [...container.querySelectorAll('*')]) {
    if (el.tagName.includes(':')) el.remove();
  }

  // 2) 图片：懒加载 → 真实地址，过滤占位图/追踪像素
  const imageUrls = [];
  const embedded = [];
  for (const img of [...container.querySelectorAll('img')]) {
    const real =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('src') ||
      '';
    if (!real || isTinyImage(img)) {
      img.remove();
      continue;
    }
    if (/^data:image\//i.test(real)) {
      for (const attr of [...img.attributes]) {
        if (!['src', 'alt'].includes(attr.name)) img.removeAttribute(attr.name);
      }
      img.setAttribute('src', real);
      img.setAttribute('data-embed', '1');
      embedded.push(real);
      continue;
    }
    const url = absUrl(real, baseUrl);
    const alt = (img.getAttribute('alt') || '').trim();
    for (const attr of [...img.attributes]) {
      if (!['src', 'alt'].includes(attr.name)) img.removeAttribute(attr.name);
    }
    img.setAttribute('src', url);
    img.setAttribute('data-origin', url);
    if (alt) img.setAttribute('alt', alt);
    imageUrls.push(url);
  }

  // 3) 链接：保留文字与地址，去掉微信跳转脚本
  for (const a of [...container.querySelectorAll('a')]) {
    const href = absUrl(a.getAttribute('href') || '', baseUrl);
    a.setAttribute('href', href);
    for (const attr of [...a.attributes]) {
      if (!['href', 'title'].includes(attr.name)) a.removeAttribute(attr.name);
    }
  }

  // 4) 视频/音频：转成可读链接（PDF 里无法播放）
  for (const iframe of [...container.querySelectorAll('iframe')]) {
    const src = absUrl(iframe.getAttribute('data-src') || iframe.getAttribute('src') || '', baseUrl);
    if (!src) {
      iframe.remove();
      continue;
    }
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', src);
    a.textContent = `▶ 嵌入媒体：${src.slice(0, 80)}`;
    p.appendChild(a);
    iframe.replaceWith(p);
  }

  // 5) 去掉纯噪声段落（"微信扫一扫"等）
  for (const el of [...container.querySelectorAll('p, div, section, span')]) {
    if (el.children.length) continue;
    const t = (el.textContent || '').replace(/\s+/g, '').trim();
    if (t && t.length <= 24 && NOISE_TEXT.test(t)) el.remove();
  }

  // 6) 标题层级推断（必须在去掉内联样式之前，因为要用字号）
  const headingCount = inferHeadings(container, doc);

  // 7) 代码块识别（同样依赖字号/字体信息）
  detectCodeBlocks(container, doc);

  // 8) 内联样式 → 语义标签
  inlineize(container, doc);

  // 9) 结构整理
  normalizeStructure(container, doc);

  // 10) 序列化
  const wrapper = doc.createElement('div');
  wrapper.className = 'af-body';
  wrapper.innerHTML = container.innerHTML;

  // 清理空段落 / 空标题
  for (const h of [...wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6')]) {
    if (!(h.textContent || '').trim()) h.remove();
  }
  for (const el of [...wrapper.querySelectorAll('p, div, section')]) {
    if (el.children.length === 0 && !(el.textContent || '').trim()) el.remove();
    else if (el.tagName === 'P' && !(el.textContent || '').trim() && !el.querySelector('img')) el.remove();
  }

  const outline = [...wrapper.querySelectorAll('h2, h3, h4')].map((h, i) => ({
    id: `h-${i}`,
    level: Number(h.tagName[1]),
    text: h.textContent.trim(),
  }));
  for (const [i, h] of [...wrapper.querySelectorAll('h2, h3, h4')].entries()) {
    h.setAttribute('id', `h-${i}`);
  }

  const text = extractText(wrapper);

  return {
    html: wrapper.innerHTML,
    text,
    outline,
    imageUrls: [...new Set(imageUrls)],
    embedded,
    headingCount,
    bodyFontSize: estimateBodyFontSize(container),
  };
}

/** span 扁平化：加粗/斜体/下划线/等宽 转语义标签，其余解包 */
function inlineize(root, doc) {
  const BLOCK = /^(P|DIV|SECTION|H[1-6]|UL|OL|LI|TABLE|THEAD|TBODY|TR|TD|TH|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|HR|IMG)$/;

  // 先深后浅，避免父节点被移除后子节点失效
  const nodes = [...root.querySelectorAll('span, font, center, b, i, u, strong, em')].reverse();
  for (const el of nodes) {
    if (!el.isConnected) continue;
    const style = el.getAttribute('style') || '';
    const tag = el.tagName.toLowerCase();

    const bold = /font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(style) || tag === 'b' || tag === 'strong';
    const italic = /font-style\s*:\s*italic/i.test(style) || tag === 'i' || tag === 'em';
    const underline = /text-decoration[^;]*underline/i.test(style) || tag === 'u';
    const monoStyle = /monospace|consolas|courier|menlo|monaco/i.test(style);
    const hasBlockChild = [...el.children].some((c) => BLOCK.test(c.tagName));

    let replacementTag = null;
    if (monoStyle) replacementTag = 'code';
    else if (bold) replacementTag = 'strong';
    else if (italic) replacementTag = 'em';
    else if (underline) replacementTag = 'u';

    if (replacementTag && !hasBlockChild) {
      // 已经是同样语义的标签，解包即可
      if (el.tagName.toLowerCase() === replacementTag) {
        el.removeAttribute('style');
        continue;
      }
      const repl = doc.createElement(replacementTag);
      while (el.firstChild) repl.appendChild(el.firstChild);
      el.replaceWith(repl);
    } else {
      // 纯样式壳子，解包
      if (el.tagName.toLowerCase() === 'center') {
        // 保留居中语义（少见），转成 div
        const div = doc.createElement('div');
        div.setAttribute('data-align', 'center');
        while (el.firstChild) div.appendChild(el.firstChild);
        el.replaceWith(div);
        continue;
      }
      const frag = doc.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
    }
  }

  // 清掉残留的内联样式 / 微信专有属性
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName === 'IMG') continue;
    const keep = ['href', 'alt', 'src', 'title', 'colspan', 'rowspan', 'data-lang', 'class', 'id', 'start'];
    for (const attr of [...el.attributes]) {
      if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (el.classList.length === 0) el.removeAttribute('class');
  }
}

/** 结构整理：div/section → p、图片套 figure、表格加壳、空行压缩 */
function normalizeStructure(root, doc) {
  // 纯内联内容的 div/section 转 p
  for (const el of [...root.querySelectorAll('div, section')].reverse()) {
    if (el.classList.contains('af-body')) continue;
    const hasBlockChild = [...el.children].some((c) =>
      /^(P|DIV|SECTION|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|FIGURE|HR)$/.test(c.tagName)
    );
    if (!hasBlockChild) {
      const p = doc.createElement('p');
      while (el.firstChild) p.appendChild(el.firstChild);
      if ((p.textContent || '').trim() || p.querySelector('img')) el.replaceWith(p);
      else el.remove();
    }
  }

  // 仅含图片的段落 → figure
  for (const p of [...root.querySelectorAll('p')]) {
    const imgs = p.querySelectorAll('img');
    if (imgs.length && !(p.textContent || '').trim()) {
      const fig = doc.createElement('figure');
      const img = imgs[0];
      p.replaceWith(fig);
      fig.appendChild(img);
      const cap = (img.getAttribute('alt') || '').trim();
      if (cap && cap.length < 100) {
        const fc = doc.createElement('figcaption');
        fc.textContent = cap;
        fig.appendChild(fc);
      }
    }
  }

  // 表格：补 tbody、加 class
  for (const table of root.querySelectorAll('table')) {
    table.classList.add('af-table');
    if (!table.querySelector('tbody') && table.querySelector('tr')) {
      const tbody = doc.createElement('tbody');
      const rows = [...table.querySelectorAll('tr')];
      const isHeaderRow = (r) => r.querySelector('th') || /<t[dh][^>]*>\s*<strong/i.test(r.innerHTML);
      let startIdx = 0;
      if (rows.length && isHeaderRow(rows[0])) {
        const thead = doc.createElement('thead');
        thead.appendChild(rows[0].cloneNode(true));
        table.insertBefore(thead, table.firstChild);
        startIdx = 1;
      }
      for (const r of rows.slice(startIdx)) tbody.appendChild(r);
      if (!table.querySelector('thead')) table.appendChild(tbody);
      else table.appendChild(tbody);
    }
  }

  // 合并连续空行
  const nodes = [...root.children];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (
      a.tagName === 'P' && b.tagName === 'P' &&
      !(a.textContent || '').trim() && !(b.textContent || '').trim()
    ) {
      a.remove();
    }
  }
}

/** 带段落换行的纯文本，供 AI 与 Markdown 使用 */
export function extractText(root) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\s+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'PRE') {
      parts.push('\n' + textOf(node).trim() + '\n\n');
      return;
    }
    if (tag === 'IMG') {
      parts.push(`[图片${node.getAttribute('alt') ? '：' + node.getAttribute('alt') : ''}]`);
      return;
    }
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    const block = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|FIGURE|FIGCAPTION|TABLE|TR|SECTION)$/.test(tag);
    if (block) parts.push('\n');
    for (const c of node.childNodes) walk(c);
    if (block) parts.push(tag.startsWith('H') ? '\n' : '\n');
  };
  walk(root);
  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
