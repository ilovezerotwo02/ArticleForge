/**
 * 标题层级推断
 * 微信文章（尤其是从 Word 粘贴的）没有 h1~h6，标题只是"短、加粗、居中或无句末标点"的段落。
 * 这里用「字号 / 字重 / 长度 / 标点 / 编号 / 章节关键词」多维打分，推断出层级并修复跳级。
 */

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'FIGURE']);

const SECTION_WORDS =
  /^(题目描述|题目分析|题目|背景|前言|简介|概述|摘要|导语|引言|环境|准备工作?|实验环境|工具|安装|配置|步骤|操作步骤|过程|分析|分析过程|思路|解题思路|原理|原理分析|核心|要点|知识点|正文|实践|实战|示例|案例|代码|实现|结果|输出|结论|总结|小结|思考|扩展|延伸|参考(资料)?|附录|答案|参考答案|注意(事项)?|提示|说明|坑点|踩坑|复盘|引用|参考文献|相关阅读|写在最后|最后|下一[章步]|part\s*\d+|step\s*\d+)$/i;

const NUMBERING =
  /^(第[一二三四五六七八九十百\d]+[章节部分篇]|[一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十\d]+）|\([一二三四五六七八九十\d]+\)|\d+(\.\d+)*[、.．\s)]|[A-Z][.、)]\s)/;

const END_PUNCT = /[。！？；，,.;:!?]$/;

export function fontSizePx(el) {
  let max = 0;
  const scan = (node) => {
    if (node.nodeType === 1) {
      const s = node.getAttribute?.('style') || '';
      const m = /font-size\s*:\s*([\d.]+)\s*(pt|px|em|rem)/i.exec(s);
      if (m) {
        const v = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        const px = unit === 'pt' ? v * 1.3333 : unit === 'em' || unit === 'rem' ? v * 16 : v;
        if (px > max) max = px;
      }
      const tag = node.tagName;
      if (tag === 'H1') max = Math.max(max, 26);
      if (tag === 'H2') max = Math.max(max, 22);
      if (tag === 'H3') max = Math.max(max, 19);
      for (const c of node.children) scan(c);
    }
  };
  scan(el);
  return max;
}

export function isBold(el) {
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') return true;
  const s = el.getAttribute?.('style') || '';
  if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(s)) return true;
  const cls = el.getAttribute?.('class') || '';
  if (/strong|bold/i.test(cls)) return true;
  return false;
}

export function boldRatio(el) {
  const total = (el.textContent || '').replace(/\s/g, '').length;
  if (!total) return 0;
  let boldChars = 0;
  const walk = (node, inherited) => {
    if (node.nodeType === 3) {
      if (inherited) boldChars += node.textContent.replace(/\s/g, '').length;
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const strong = inherited || isBold(node);
    for (const c of node.childNodes) walk(c, strong);
  };
  walk(el, false);
  return boldChars / total;
}

export function isCentered(el) {
  const s = el.getAttribute?.('style') || '';
  if (/text-align\s*:\s*center/i.test(s)) return true;
  const p = el.closest?.('[style*="text-align"]');
  return p ? /text-align\s*:\s*center/i.test(p.getAttribute('style') || '') : false;
}

function isLeafBlock(el) {
  if (!BLOCK_TAGS.has(el.tagName)) return false;
  if (el.closest('pre, code, table, ul, ol, blockquote, figure')) return false;
  for (const c of el.children) {
    if (BLOCK_TAGS.has(c.tagName)) return false;
  }
  const text = (el.textContent || '').replace(/\u200b/g, '').trim();
  return text.length > 0;
}

/** 正文常见字号（取众数），用于判断"比正文小 = 代码"之类 */
export function estimateBodyFontSize(container) {
  const counts = new Map();
  for (const el of container.querySelectorAll('p, div, section')) {
    if (!isLeafBlock(el)) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 30) continue;
    const fs = Math.round(fontSizePx(el));
    if (!fs) continue;
    counts.set(fs, (counts.get(fs) || 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [fs, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = fs;
    }
  }
  return best || 16;
}

function headingLevelFromSize(fs, body) {
  if (!fs) return 0;
  if (fs >= Math.max(body * 1.55, 24)) return 2;
  if (fs >= body * 1.28) return 3;
  if (fs >= body * 1.12) return 4;
  return 0;
}

/**
 * @returns {number} 识别出的标题数量
 */
export function inferHeadings(container, doc, { maxLevel = 4 } = {}) {
  const body = estimateBodyFontSize(container);
  const candidates = [...container.querySelectorAll('p, div, section, h1, h2, h3, h4, h5, h6')].filter(isLeafBlock);
  const decisions = [];

  for (const el of candidates) {
    const raw = (el.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    const len = raw.length;
    if (!len || len > 120) continue;
    // 纯数字/符号的装饰性编号（如 "01"、"——"）不做标题
    if (len <= 6 && /^[\d\s.\-–—#|·、/]+$/.test(raw)) continue;

    const tagLevel = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
    const fs = fontSizePx(el);
    const bold = boldRatio(el) >= 0.75;
    const centered = isCentered(el);
    const numbered = NUMBERING.test(raw);
    const isSectionWord = SECTION_WORDS.test(raw.replace(/[\s:：]+$/, ''));
    const noEndPunct = !END_PUNCT.test(raw);
    const hasComma = /[，,]/.test(raw);
    const endsWithColon = /[:：]$/.test(raw);
    const isLongSentence = len > 40 && hasComma;

    let level = 0;
    if (tagLevel) level = Math.max(2, tagLevel);

    if (!level) {
      const sizeLevel = headingLevelFromSize(fs, body);
      if (sizeLevel && len <= 60 && !hasComma) level = sizeLevel;
    }

    if (!level && len <= 32 && noEndPunct && !hasComma) {
      if (numbered) level = Math.min(4, 2 + (raw.match(/^(\d+\.){2,}/) ? 1 : 0));
      else if (isSectionWord) level = 2;
      else if ((bold || centered) && len <= 24) level = 3;
    }

    // 极短 + 加粗 + 结尾冒号（如 "环境："）也当小标题
    if (!level && len <= 14 && bold && endsWithColon) level = 4;

    // 长句、带逗号的一律不做标题
    if (isLongSentence) level = 0;
    if (!level) continue;

    decisions.push({ el, level: Math.min(level, maxLevel), text: raw });
  }

  // 以第一个标题为基准对齐到 h2：全文层级整体平移，避免出现「首个标题是 h3、后面又有 h2」的错位
  if (decisions.length) {
    const shift = 2 - Math.max(2, decisions[0].level);
    if (shift) {
      for (const d of decisions) d.level = Math.min(4, Math.max(2, d.level + shift));
    }
  }

  // 层级规范化：正文从 h2 起、不跳级
  let last = 2;
  for (const d of decisions) {
    let lvl = Math.max(2, d.level);
    if (lvl > last + 1) lvl = last + 1;
    d.level = lvl;
    last = lvl;

    const h = doc.createElement(`h${lvl}`);
    h.className = `af-h af-h${lvl}`;
    h.setAttribute('data-af-heading', '1');
    // 标题内部只保留文本，样式交给模板，避免微信内联样式污染
    const span = doc.createElement('span');
    span.textContent = d.text;
    h.appendChild(span);
    d.el.replaceWith(h);
  }

  return decisions.length;
}
