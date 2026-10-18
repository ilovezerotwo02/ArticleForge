/* ArticleForge 前端 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  view: 'convert',
  articles: [],
  current: null,
  status: null,
  settings: null,
  presets: [],
  chat: [],
  selection: '',
  tab: 'preview',
  streaming: false,
  lastOrganized: null,
  organizeSpec: JSON.parse(localStorage.getItem('af.organizeSpec') || 'null') || {
    preset: 'study',
    detail: 'normal',
    language: '中文',
    maxPoints: 8,
    conceptNotes: true,
    keepRaw: false,
    keepCode: true,
    keepQuote: false,
    custom: '',
    userTemplate: '',
  },
};

/* ---------------- 基础工具 ---------------- */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function toast(msg, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => {
    el.style.transition = '.25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function escText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input').forEach((n) => n.remove());
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(attr.name);
      else if ((n === 'href' || n === 'src') && /^\s*(javascript|data:text\/html)/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  return tpl.innerHTML;
}

const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

function looksLikeMath(tex, display) {
  if (display) return true;
  const t = String(tex).trim();
  if (!t || t.length > 300) return false;
  if (/^[\d.,]+$/.test(t)) return false;
  return /[\\^_{}=<>+\-*/∫√∑∏π≤≥≈≠×÷·∞∂Δ]|[a-zA-Z]\s*[=<>]/.test(t);
}

/** 纯文本里的 x^2 / x_1 也转成上标下标，至少是「人看的」 */
function supSub(escaped) {
  return escaped
    .replace(/\^\(([^)]+)\)/g, '<sup>$1</sup>')
    .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
    .replace(/\^([A-Za-z0-9+\-.]+)/g, '<sup>$1</sup>')
    .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
    .replace(/_(\d+)/g, '<sub>$1</sub>');
}

function enhanceTextNode(node) {
  const text = node.nodeValue;
  if (!text || !text.trim()) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  let matched = false;
  let m;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(text))) {
    const tex = m[1] ?? m[2] ?? m[3] ?? m[4];
    const display = Boolean(m[1] || m[2]);
    if (!tex || !looksLikeMath(tex, display)) continue;
    matched = true;
    if (m.index > last) {
      const s1 = document.createElement('span');
      s1.innerHTML = supSub(escText(text.slice(last, m.index)));
      frag.appendChild(s1);
    }
    try {
      const s2 = document.createElement('span');
      s2.innerHTML = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: 'html' });
      if (display) s2.className = 'math-block';
      frag.appendChild(s2);
    } catch {
      const s3 = document.createElement('span');
      s3.innerHTML = supSub(escText(m[0]));
      frag.appendChild(s3);
    }
    last = m.index + m[0].length;
  }
  if (!matched) {
    const converted = supSub(escText(text));
    if (converted !== escText(text)) {
      const span = document.createElement('span');
      span.innerHTML = converted;
      node.parentNode.replaceChild(span, node);
    }
    return;
  }
  const tail = document.createElement('span');
  tail.innerHTML = supSub(escText(text.slice(last)));
  frag.appendChild(tail);
  node.parentNode.replaceChild(frag, node);
}

function renderMathAndTables(html) {
  const root = document.createElement('div');
  root.innerHTML = html;

  if (window.katex) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(PRE|CODE|SCRIPT|STYLE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.katex')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(enhanceTextNode);
  }

  for (const table of [...root.querySelectorAll('table')]) {
    if (table.parentElement?.classList.contains('table-wrap')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
  return root.innerHTML;
}

/** 把 \(..\) / \[..\] 统一成 $..$ / $$..$$（markdown 会把 \( 当转义吃掉） */
function normalizeMathDelims(text) {
  const parts = String(text).split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg
        .replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => `\n$$\n${String(t).trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => `$${String(t).trim()}$`);
    })
    .join('');
}

/** Markdown → HTML（GFM 表格、代码块、KaTeX 公式） */
function mdLite(src) {
  let text = String(src ?? '');
  if (!text) return '';
  // 有些模型会把换行输出成字面量 \n，这里兜一下
  if ((text.match(/\\n/g) || []).length > 3 && !/\n/.test(text)) text = text.replace(/\\n/g, '\n');
  text = normalizeMathDelims(text);

  // 块级公式先摘出来：marked 会把它拆成多个节点，事后再补回去
  const blocks = [];
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
    blocks.push(String(tex).trim());
    return `\n\nMATHBLOCK${blocks.length - 1}END\n\n`;
  });

  let html;
  if (window.marked) {
    try {
      html = window.marked.parse(text, { gfm: true, breaks: true });
    } catch {
      html = escText(text).replace(/\n/g, '<br>');
    }
  } else {
    html = escText(text).replace(/\n/g, '<br>');
  }
  html = sanitizeHtml(html);

  // 还原块级公式
  if (blocks.length && window.katex) {
    html = html.replace(/<p>\s*MATHBLOCK(\d+)END\s*<\/p>/g, (m, i) => {
      try {
        const out = katex.renderToString(blocks[Number(i)], { displayMode: true, throwOnError: false, output: 'html' });
        return `<div class="math-block">${out}</div>`;
      } catch {
        return `<p>${escText(blocks[Number(i)])}</p>`;
      }
    });
    html = html.replace(/MATHBLOCK(\d+)END/g, (m, i) => {
      try {
        return katex.renderToString(blocks[Number(i)], { displayMode: true, throwOnError: false, output: 'html' });
      } catch {
        return escText(blocks[Number(i)]);
      }
    });
  }

  return renderMathAndTables(html);
}

/* ---------------- SSE ---------------- */

async function sse(path, body, onEvent) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('event-stream')) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const ev = /^event:\s*(.+)$/m.exec(chunk)?.[1];
      const dataLine = /^data:\s*(.+)$/m.exec(chunk)?.[1];
      if (!ev) continue;
      let payload = {};
      try {
        payload = dataLine ? JSON.parse(dataLine) : {};
      } catch {}
      onEvent(ev, payload);
    }
  }
}

/* ---------------- 资料库 ---------------- */

async function loadLibrary() {
  try {
    const { articles } = await api('/api/articles');
    state.articles = articles;
    renderLibrary();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderLibrary() {
  const q = ($('#libFilter').value || '').toLowerCase().trim();
  const list = state.articles.filter(
    (a) => !q || (a.title || '').toLowerCase().includes(q) || (a.account || '').toLowerCase().includes(q) || (a.tags || []).join(' ').includes(q)
  );
  $('#libCount').textContent = state.articles.length;
  const box = $('#articleList');
  if (!list.length) {
    box.innerHTML = `<div class="skeleton">${state.articles.length ? '没有匹配的文章' : '还没有内容，粘贴链接或上传文件开始'}</div>`;
    return;
  }
  box.innerHTML = list
    .map(
      (a) => `<div class="article-item ${state.current?.id === a.id ? 'active' : ''}" data-id="${a.id}">
        <div class="t">${esc(a.title)}</div>
        <div class="m">
          <span class="badge ${a.source === 'wechat' ? 'wx' : a.source === 'upload' ? 'up' : ''}">${
        a.source === 'wechat' ? '公众号' : a.source === 'upload' ? (a.sourceKind || '文件').toUpperCase() : '网页'
      }</span>
          <span>${a.words || 0} 字</span>
          ${a.assets ? `<span>${a.assets} 图</span>` : ''}
          <span style="margin-left:auto">${fmtDate(a.createdAt)}</span>
        </div>
        <button class="del" data-del="${a.id}" title="删除">×</button>
      </div>`
    )
    .join('');
}

async function openArticle(id) {
  try {
    const { article } = await api(`/api/articles/${id}`);
    state.current = article;
    state.tab = 'preview';
    $('#emptyState').hidden = true;
    $('#previewWrap').hidden = false;
    $('#viewTabs').hidden = false;
    $('#docTitle').textContent = article.title;
    $('#aiHint').textContent = article.source === 'upload' ? '本地文档' : article.account || '已就绪';
    setTab('preview');
    renderLibrary();
    renderTopActions();
    await loadChat(id);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderTopActions() {
  const a = state.current;
  if (!a) return ($('#topbarActions').innerHTML = '');
  $('#topbarActions').innerHTML = `
    <button class="btn sm" id="btnExport">导出 PDF · DOCX · MD</button>
    ${a.url ? `<a class="btn sm ghost" href="${esc(a.url)}" target="_blank" rel="noreferrer">打开原文</a>` : ''}
  `;
  $('#btnExport').onclick = openExportModal;
}

/** 预览加载完检测：内容空白时给出提示与重试入口 */
function onPreviewLoad() {
  const frame = $('#previewFrame');
  setTimeout(() => {
    let empty = true;
    try {
      const d = frame.contentDocument;
      const content = d && d.querySelector('.af-content');
      const textLen = content ? content.textContent.trim().length : 0;
      const media = content ? content.querySelectorAll('img, pre, table, ul, ol, blockquote').length : 0;
      empty = !content || (textLen < 40 && media === 0);
    } catch {}
    $('#previewEmpty').hidden = !empty;
    const tab = $('#openPreviewTab');
    if (tab) tab.href = frame.src;
  }, 300);
}

function setTab(tab) {
  state.tab = tab;
  $('#selToolbar').hidden = true;
  $$('#viewTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const a = state.current;
  const frame = $('#previewFrame');
  $('#mdView').hidden = tab !== 'markdown';
  $('#outlineView').hidden = tab !== 'outline';
  $('#relatedView').hidden = tab !== 'related';
  frame.style.visibility = tab === 'preview' ? 'visible' : 'hidden';

  if (!a) return;
  if (tab === 'preview') {
    frame.onload = onPreviewLoad;
    frame.src = `/api/articles/${a.id}/preview?t=${Date.now()}`;
    $('#previewEmpty').hidden = true;
  } else if (tab === 'markdown') {
    $('#mdSource').textContent = a.markdown || '（无内容）';
  } else if (tab === 'outline') {
    const items = a.outline || [];
    $('#outlineView').innerHTML = items.length
      ? items
          .map(
            (o) => `<div class="ol-item"><span class="lv ${o.level === 2 ? 'h2' : ''}">H${o.level}</span>
              <span class="ol-text" style="padding-left:${(o.level - 2) * 18}px">${esc(o.text)}</span></div>`
          )
          .join('')
      : '<div class="skeleton">这篇文章没有识别出标题层级</div>';
  } else if (tab === 'related') {
    loadRelated(a.id);
  }
}

async function loadRelated(id) {
  const box = $('#relatedView');
  box.innerHTML = '<div class="skeleton">正在检索相关文章…</div>';
  try {
    const { groups } = await api(`/api/articles/${id}/related`, { method: 'POST', body: {} });
    box.innerHTML = groups
      .map(
        (g) => `<div class="rel-group">
        <div class="rel-q">检索词 · ${esc(g.query)}</div>
        ${(g.results || [])
          .map(
            (r) => `<div class="result">
            <div class="r-main">
              <div class="r-title"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)}</a></div>
              <div class="r-snippet">${esc(r.snippet || '')}</div>
              <div class="r-meta"><span>${esc(r.source)}</span></div>
            </div>
            <button class="btn sm" data-convert="${esc(r.url)}" data-title="${esc(r.title)}">转换</button>
          </div>`
          )
          .join('') || '<div class="skeleton">没有找到结果</div>'}
      </div>`
      )
      .join('');
  } catch (e) {
    box.innerHTML = `<div class="skeleton">检索失败：${esc(e.message)}</div>`;
  }
}

/* ---------------- 抓取 / 上传 ---------------- */

async function doFetch(titleHint = '') {
  const url = $('#urlInput').value.trim();
  if (!url) return toast('请先粘贴文章链接', 'err');
  const btn = $('#fetchBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const { article } = await api('/api/extract', {
      method: 'POST',
      body: { url, forceRender: $('#forceRender').checked, titleHint: typeof titleHint === 'string' ? titleHint : '' },
    });
    await loadLibrary();
    await openArticle(article.id);
    $('#urlInput').value = '';
    toast(`已抓取：${article.title.slice(0, 26)}`, 'ok');
  } catch (e) {
    toast(e.message, 'err', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '抓取';
  }
}

async function doUpload(files) {
  if (!files?.length) return;
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  toast(`正在解析 ${files.length} 个文件…`, 'info');
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '上传失败');
    await loadLibrary();
    if (data.articles?.[0]) await openArticle(data.articles[0].id);
    toast(`已导入 ${data.articles.length} 个文件`, 'ok');
    if (data.errors?.length) toast(data.errors.join('；'), 'err', 6000);
  } catch (e) {
    toast(e.message, 'err', 6000);
  }
  $('#fileInput').value = '';
}

/* ---------------- 导出 ---------------- */

function openModal(html, { wide = false } = {}) {
  $('#modal').className = `modal${wide ? ' wide' : ''}`;
  $('#modal').innerHTML = `<button class="close-x" onclick="closeModal()">×</button>${html}`;
  $('#modalMask').hidden = false;
}
window.closeModal = () => {
  $('#modalMask').hidden = true;
};

function openExportModal() {
  const a = state.current;
  if (!a) return;
  openModal(`
    <h2>导出</h2>
    <p class="sub">${esc(a.title)}</p>
    <div class="export-list">
      <label class="export-row"><input type="checkbox" value="pdf" checked>
        <div><div class="en">PDF</div><div class="ed">A4 分页、代码框、图片本地化，适合打印与归档</div></div></label>
      <label class="export-row"><input type="checkbox" value="docx" checked>
        <div><div class="en">DOCX</div><div class="ed">代码块为带底纹的表格框，标题带 Word 大纲级别</div></div></label>
      <label class="export-row"><input type="checkbox" value="md" checked>
        <div><div class="en">Markdown</div><div class="ed">YAML frontmatter + 围栏代码块 + 本地图片，通用性最好</div></div></label>
    </div>
    <div id="exportProgress" class="progress" style="margin-top:14px"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" id="doExport">开始导出</button>
    </div>
  `);

  $('#doExport').onclick = async () => {
    const formats = $$('#modal .export-row input:checked').map((i) => i.value);
    if (!formats.length) return toast('至少选择一种格式', 'err');
    const btn = $('#doExport');
    btn.disabled = true;
    $('#exportProgress').innerHTML = '<div class="p-step"><span class="spinner"></span> 正在生成，PDF 渲染约需 5~15 秒…</div>';
    try {
      const res = await api(`/api/articles/${a.id}/export`, { method: 'POST', body: { formats } });
      $('#exportProgress').innerHTML = '<div class="p-step done">✓ 导出完成</div>';
      const links = res.files
        .map(
          (f) => `<a class="btn sm" href="${f.url}" download>${f.name} · ${fmtSize(f.size)}</a>`
        )
        .join('');
      $('#exportProgress').insertAdjacentHTML('beforeend', `<div class="result-links">${links}</div>
        <div class="hint" style="margin-top:8px">文件目录：${esc(res.dir)}</div>`);
      toast('导出完成', 'ok');
    } catch (e) {
      $('#exportProgress').innerHTML = `<div class="p-step err">✕ ${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };
}

/* ---------------- AI 整理 ---------------- */

function openOrganizeModal() {
  const a = state.current;
  if (!a) return toast('请先打开一篇文章或文档', 'err');
  const spec = state.organizeSpec;
  const presets = state.presets.length
    ? state.presets
    : [{ key: 'study', label: '学习笔记', desc: '' }];

  openModal(
    `
    <h2>AI 整理 · 预览确认后入库</h2>
    <p class="sub">${esc(a.title)} · 共 ${a.words || 0} 字 · 整理完会先给你看内容和目录</p>

    <div class="field">
      <label>整理模板</label>
      <div class="chip-grid">
        ${presets
          .map(
            (p) => `<button class="chip ${spec.preset === p.key ? 'active' : ''}" data-preset="${p.key}">
              <span class="cl">${esc(p.label)}</span><span class="cd">${esc(p.desc || '')}</span></button>`
          )
          .join('')}
      </div>
    </div>

    <div class="field-row">
      <div class="field"><label>详细程度</label>
        <select id="specDetail">
          <option value="brief" ${spec.detail === 'brief' ? 'selected' : ''}>精简 · 只留骨架</option>
          <option value="normal" ${spec.detail === 'normal' ? 'selected' : ''}>标准 · 讲清 why/how</option>
          <option value="deep" ${spec.detail === 'deep' ? 'selected' : ''}>详尽 · 原理+例子+边界</option>
        </select>
      </div>
      <div class="field"><label>输出语言</label>
        <input type="text" id="specLang" value="${esc(spec.language || '中文')}">
      </div>
      <div class="field"><label>知识点上限</label>
        <input type="text" id="specMax" value="${spec.maxPoints || 8}">
      </div>
    </div>

    <div class="field-row" style="margin-top:2px">
      <label class="mini-check"><input type="checkbox" id="specConcepts" ${spec.conceptNotes ? 'checked' : ''}> 自动创建概念笔记并双链</label>
      <label class="mini-check"><input type="checkbox" id="specCode" ${spec.keepCode ? 'checked' : ''}> 保留代码/命令</label>
      <label class="mini-check"><input type="checkbox" id="specQuote" ${spec.keepQuote ? 'checked' : ''}> 保留原文引用</label>
      <label class="mini-check"><input type="checkbox" id="specRaw" ${spec.keepRaw ? 'checked' : ''}> 附原文摘录</label>
    </div>

    <div class="field" style="margin-top:12px">
      <label>自定义格式要求（优先级最高，可写任意规则）</label>
      <textarea id="specCustom" placeholder="例如：每个知识点必须包含「定义 / 原理 / 命令示例 / 易错点」四段；命令统一用 bash 代码块；不要写总结套话；标签只用 3 个。">${esc(spec.custom || '')}</textarea>
    </div>

    <div class="field">
      <label>笔记骨架（可选，AI 会严格按此结构填充）</label>
      <textarea id="specTemplate" placeholder="## 环境准备&#10;## 关键步骤&#10;## 命令速查&#10;## 踩坑记录" style="min-height:88px">${esc(spec.userTemplate || '')}</textarea>
    </div>

    <div id="orgProgress" class="progress"></div>
    <div id="orgPreview"></div>
    <div class="modal-actions" id="orgActions">
      <label class="mini-check" style="margin-right:auto"><input type="checkbox" id="specRemember" checked> 记住这些要求</label>
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" id="runOrganize">开始整理（先预览）</button>
    </div>
  `,
    { wide: true }
  );

  $$('#modal .chip').forEach((chip) => {
    chip.onclick = () => {
      $$('#modal .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.organizeSpec.preset = chip.dataset.preset;
    };
  });

  const collect = () => ({
    preset: $('#modal .chip.active')?.dataset.preset || 'study',
    detail: $('#specDetail').value,
    language: $('#specLang').value.trim() || '中文',
    maxPoints: Number($('#specMax').value) || 8,
    conceptNotes: $('#specConcepts').checked,
    keepCode: $('#specCode').checked,
    keepQuote: $('#specQuote').checked,
    keepRaw: $('#specRaw').checked,
    custom: $('#specCustom').value.trim(),
    userTemplate: $('#specTemplate').value.trim(),
  });

  const run = async () => {
    const spec = collect();
    state.organizeSpec = spec;
    if ($('#specRemember').checked) localStorage.setItem('af.organizeSpec', JSON.stringify(spec));

    const prog = $('#orgProgress');
    const btn = $('#runOrganize');
    prog.innerHTML = '<div class="p-step"><span class="spinner"></span> AI 正在阅读、整理并判断归属目录…（约 10~40 秒）</div>';
    $('#orgPreview').innerHTML = '';
    btn.disabled = true;

    let payload = null;
    try {
      await sse('/api/ai/organize', { articleId: a.id, spec }, (ev, data) => {
        if (ev === 'step') {
          prog.insertAdjacentHTML('beforeend', `<div class="p-step">· ${esc(data.message)}</div>`);
        } else if (ev === 'organized') {
          payload = data;
          prog.insertAdjacentHTML(
            'beforeend',
            `<div class="p-step done">✓ 已整理：${data.organized.points?.length || 0} 个知识点、${data.organized.concepts?.length || 0} 个概念</div>`
          );
        } else if (ev === 'error') {
          prog.insertAdjacentHTML('beforeend', `<div class="p-step err">✕ ${esc(data.message)}</div>`);
        }
      });
    } catch (e) {
      prog.insertAdjacentHTML('beforeend', `<div class="p-step err">✕ ${esc(e.message)}</div>`);
    } finally {
      btn.disabled = false;
    }

    if (payload) {
      state.lastOrganized = payload.organized;
      state.lastCategories = payload.categories;
      renderOrganizePreview(payload, spec);
    }
  };

  $('#runOrganize').onclick = run;
  $('#previewOrganize')?.remove();
}

/** 整理结果预览：内容 + 目录 + 确认写入 */
function renderOrganizePreview({ organized, categories, target, singleFile = true, mergeInto = '', mergeReason = '' }, spec) {
  const cats = categories?.categories || [];
  const routable = categories?.routable;
  const selected = organized.category || '';

  $('#orgPreview').innerHTML = `
    <div class="pv-card">
      <div class="pv-head">
        <strong>${esc(organized.title)}</strong>
        <span class="badge">${organized.points?.length || 0} 知识点</span>
        <span class="badge">${organized.concepts?.length || 0} 概念</span>
        ${(organized.tags || []).slice(0, 4).map((t) => `<span class="badge" style="background:var(--brand-soft);color:#574fd6">${esc(t)}</span>`).join('')}
      </div>

      <div class="pv-dir">
        <div class="pv-dir-row">
          <label>写入目录</label>
          <div class="dir-picker-wrap">
            <button class="dir-picker" id="pvDirBtn" ${routable ? '' : 'disabled'} type="button">
              <span class="dir-ico">📁</span>
              <span id="pvDirLabel">${selected ? esc(selected) : `默认目录（${esc(categories?.defaultDir || target?.dir || '根目录')}）`}</span>
              <span class="dir-caret">▾</span>
            </button>
            <div class="dir-pop" id="pvDirPop" hidden>
              <div class="dir-pop-tools">
                <input id="dirFilter" type="text" placeholder="筛选目录…" autocomplete="off">
                <button class="dir-mini" id="dirNewBtn" type="button" title="在当前选中的目录下新建">＋ 新建文件夹</button>
              </div>
              <div class="dir-tree" id="dirTree"></div>
              <div class="dir-pop-foot">
                <button class="dir-mini" data-path="" type="button">默认目录（${esc(categories?.defaultDir || target?.dir || '根目录')}）</button>
                <span class="dir-hint">点名字选目录 · 点箭头展开 · ＋新建子目录</span>
              </div>
            </div>
          </div>
          <span class="hint" style="margin:0">${routable ? 'AI 按你整个目录树判断的，可手动改' : '当前知识库不支持分目录'}</span>
        </div>
        ${organized.categoryReason ? `<div class="pv-reason">AI 判断：${esc(organized.categoryReason)}</div>` : ''}
        <div class="pv-path" id="pvPath">${esc(target?.display || '')}</div>
        <div class="pv-mode">写入方式：${singleFile ? '<b>单个 Markdown</b>（知识点、概念、关联都内联在这一个文件里）' : '<b>多文件</b>（概念单独建卡 + 双链 + 索引）'}</div>
        ${mergeInto ? `
        <div class="pv-merge">
          <label class="mini-check"><input type="radio" name="pvwrite" value="merge" checked> <b>补充到已有笔记</b>：${esc(mergeInto)}.md${mergeReason ? `<span class="hint">　${esc(mergeReason)}</span>` : ''}</label>
          <label class="mini-check"><input type="radio" name="pvwrite" value="new"> 新建文件</label>
        </div>` : ''}
      </div>

      ${organized.warnings?.length ? `<div class="pv-warn">${organized.warnings.map((w) => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}

      <div class="pv-label">内容预览</div>
      <div class="pv-body" id="pvBody">${mdLite(organized.markdown || '')}</div>
    </div>
  `;

  // ---------- 目录树选择器 ----------
  state.dir = {
    nodes: categories?.tree || [],
    custom: [],
    selected,
    expanded: new Set(selected ? selected.split('/').slice(0, -1).reduce((acc, _, i, arr) => { acc.add(arr.slice(0, i + 1).join('/')); return acc; }, new Set()) : []),
    filter: '',
  };

  const allNodes = () => [...(state.dir.nodes || []), ...state.dir.custom];
  const findNode = (path0, nodes = allNodes()) => {
    for (const n of nodes) {
      if (n.path === path0) return n;
      const hit = findNode(path0, n.children || []);
      if (hit) return hit;
    }
    return null;
  };

  const renderTree = () => {
    const kw = state.dir.filter.trim().toLowerCase();
    const rows = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const hit = !kw || n.name.toLowerCase().includes(kw) || n.path.toLowerCase().includes(kw);
        const kidsHit = kw && (n.children || []).some((c) => c.path.toLowerCase().includes(kw));
        if (hit || kidsHit) {
          const open = kw ? true : state.dir.expanded.has(n.path);
          const hasKids = (n.children || []).length > 0;
          rows.push(
            `<div class="dir-row ${state.dir.selected === n.path ? 'sel' : ''}" data-path="${esc(n.path)}" style="padding-left:${7 + depth * 13}px">
              <span class="dir-tw ${hasKids ? '' : 'leaf'}" data-toggle="${esc(n.path)}">${hasKids ? (open ? '▾' : '▸') : '·'}</span>
              <span class="dir-name" data-pick="${esc(n.path)}" title="${esc(n.path)}">${esc(n.name)}</span>
              <button class="dir-add" data-add="${esc(n.path)}" type="button" title="在此目录下新建">＋</button>
            </div>`
          );
          if (open && hasKids) walk(n.children || [], depth + 1);
          // 目录下的 md 笔记（像 Obsidian 一样显示），点它=选所在目录
          if (open) {
            for (const f of n.files || []) {
              rows.push(
                `<div class="dir-row file" data-filepick="${esc(n.path)}" data-filename="${esc(f)}" style="padding-left:${20 + depth * 13}px">
                  <span class="dir-tw leaf">·</span>
                  <span class="dir-name" title="${esc(f)}.md">📄 ${esc(f)}</span>
                </div>`
              );
            }
          }
        }
      }
    };
    // 顶层新建输入行
    if (state.dir.creating === '') {
      rows.unshift(
        `<div class="dir-newrow" style="padding-left:7px">
          <input id="dirNewInput" placeholder="新顶层目录名，回车确认" autocomplete="off">
          <button class="dir-mini" id="dirNewOk" type="button">确定</button>
          <button class="dir-mini" id="dirNewCancel" type="button">取消</button>
        </div>`
      );
    }
    walk(allNodes(), 0);
    // 某目录下的新建输入行
    if (state.dir.creating) {
      const idx = rows.findIndex((r) => r.includes(`data-pick="${state.dir.creating}"`));
      if (idx >= 0) {
        const depth = state.dir.creating.split('/').length;
        rows.splice(idx + 1, 0,
          `<div class="dir-newrow" style="padding-left:${20 + depth * 13}px">
            <input id="dirNewInput" placeholder="新目录名，回车确认" autocomplete="off">
            <button class="dir-mini" id="dirNewOk" type="button">确定</button>
            <button class="dir-mini" id="dirNewCancel" type="button">取消</button>
          </div>`
        );
      }
    }
    $('#dirTree').innerHTML = rows.join('') || '<div class="dir-empty">没有匹配的目录</div>';
    $('#dirNewOk')?.addEventListener('click', (e) => { e.stopPropagation(); confirmNew(); });
    $('#dirNewCancel')?.addEventListener('click', (e) => { e.stopPropagation(); cancelNew(); });
    $('#dirNewInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmNew();
      if (e.key === 'Escape') cancelNew();
      e.stopPropagation();
    });
  };

  const mergePath = () => (target?.display || '').replace(/[^/]+$/, `${mergeInto}.md`);
  const refreshPath = () => {
    const mode = document.querySelector('input[name="pvwrite"]:checked')?.value || (mergeInto ? 'merge' : 'new');
    $('#pvPath').textContent = mode === 'merge' && mergeInto ? mergePath() : target?.display || '';
  };
  document.querySelectorAll('input[name="pvwrite"]').forEach((r) => {
    r.onchange = refreshPath;
  });
  refreshPath();

  const setSelected = async (path0) => {
    state.dir.selected = path0;
    $('#pvDirLabel').textContent = path0 || `默认目录（${categories?.defaultDir || target?.dir || '根目录'}）`;
    $('#pvDirPop').hidden = true;
    try {
      const r = await api('/api/kb/preview', { method: 'POST', body: { category: path0, title: organized.title } });
      state.dir.targetDisplay = r.target.display;
      const mode = document.querySelector('input[name="pvwrite"]:checked')?.value || (mergeInto ? 'merge' : 'new');
      $('#pvPath').textContent = mode === 'merge' && mergeInto ? (r.target.display || '').replace(/[^/]+$/, `${mergeInto}.md`) : r.target.display;
    } catch {}
  };

  renderTree();
  $('#pvDirBtn').onclick = (e) => {
    e.stopPropagation();
    $('#pvDirPop').hidden = !$('#pvDirPop').hidden;
    if (!$('#pvDirPop').hidden) {
      state.dir.filter = '';
      $('#dirFilter').value = '';
      renderTree();
      setTimeout(() => $('#dirFilter').focus(), 30);
    }
  };
  $('#dirFilter').oninput = (e) => {
    state.dir.filter = e.target.value;
    renderTree();
  };
  $('#dirTree').addEventListener('click', (e) => {
    const tw = e.target.closest('[data-toggle]');
    if (tw) {
      // ▸/▾ 只负责展开折叠，绝不顺带选中
      e.stopPropagation();
      const p = tw.dataset.toggle;
      state.dir.expanded.has(p) ? state.dir.expanded.delete(p) : state.dir.expanded.add(p);
      renderTree();
      return;
    }
  }, true);

  $('#dirTree').onclick = async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.stopPropagation();
      newFolder(add.dataset.add);
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle && toggle.dataset.toggle) {
      const p = toggle.dataset.toggle;
      state.dir.expanded.has(p) ? state.dir.expanded.delete(p) : state.dir.expanded.add(p);
      renderTree();
      return;
    }
    const fileRow = e.target.closest('[data-filepick]');
    if (fileRow) {
      setSelected(fileRow.dataset.filepick);
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) setSelected(pick.dataset.pick);
  };
  const newFolder = (parent) => {
    // Electron 不支持 window.prompt，用行内输入框
    state.dir.creating = parent || '';
    state.dir.expanded.add(parent || '__root__');
    state.dir.filter = '';
    $('#dirFilter').value = '';
    renderTree();
    setTimeout(() => $('#dirNewInput')?.focus(), 30);
  };
  const confirmNew = () => {
    const parent = state.dir.creating || '';
    const raw = $('#dirNewInput')?.value || '';
    const clean = raw.trim().replace(/[\\/:*?"<>|]/g, '');
    state.dir.creating = null;
    if (!clean) {
      renderTree();
      return;
    }
    const path0 = parent ? `${parent}/${clean}` : clean;
    if (!findNode(path0)) state.dir.custom.push({ name: clean, path: path0, children: [], isNew: true });
    if (parent) state.dir.expanded.add(parent);
    renderTree();
    setSelected(path0);
  };
  const cancelNew = () => {
    state.dir.creating = null;
    renderTree();
  };
  $('#dirNewBtn').onclick = (e) => {
    e.stopPropagation();
    newFolder(state.dir.selected);
  };
  $('#pvDirPop').addEventListener('click', (e) => {
    const def = e.target.closest('[data-path]');
    if (def) {
      e.stopPropagation();
      setSelected(def.dataset.path);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dir-picker-wrap')) $('#pvDirPop').hidden = true;
  });

  setTimeout(() => $('#orgPreview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

  $('#orgActions').innerHTML = `
    <label class="mini-check" style="margin-right:auto"><input type="checkbox" id="specRemember" ${localStorage.getItem('af.organizeSpec') ? 'checked' : ''}> 记住这些要求</label>
    <button class="btn" onclick="closeModal()">取消</button>
    <button class="btn" id="reorganize">重新整理</button>
    <button class="btn primary" id="confirmWrite">确认写入</button>
  `;

  $('#reorganize').onclick = () => openOrganizeModal();
  $('#confirmWrite').onclick = async () => {
    const btn = $('#confirmWrite');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await api('/api/kb/write', {
        method: 'POST',
        body: {
          articleId: state.current.id,
          organized,
          spec,
          category: state.dir?.selected || '',
          mergeInto: (document.querySelector('input[name="pvwrite"]:checked')?.value || (mergeInto ? 'merge' : 'new')) === 'merge' ? mergeInto : '',
        },
      });
      const where = res.category ? `${res.category}/${res.relativeNote || res.notePath}` : res.relativeNote || res.notePath || res.url;
      toast(`已写入 ${where}`, 'ok', 5000);
      closeModal();
      loadKb();
    } catch (e) {
      toast(e.message, 'err', 6000);
      btn.disabled = false;
      btn.textContent = '确认写入';
    }
  };
}

/* ---------------- AI 对话 ---------------- */

async function loadChat(articleId) {
  try {
    const { messages } = await api(`/api/ai/chat/${articleId}`);
    state.chat = messages.map((m) => ({ role: m.role, content: m.content, selection: m.selection }));
    renderChat();
  } catch {
    state.chat = [];
    renderChat();
  }
}

function renderChat() {
  const box = $('#chat');
  if (!state.chat.length) {
    box.innerHTML = `<div class="msg assistant">
      <div class="who">AI 阅读助手</div>
      <div class="bubble"><p>我已经读完这篇文章。你可以：</p>
      <ul><li>选中正文任意一句，点「在侧边聊天中提问」</li>
      <li>直接问我文章里的命令、原理或疑点</li>
      <li>让我把知识点整理进知识库</li></ul></div></div>`;
    return;
  }
  box.innerHTML = state.chat
    .map((m) => {
      if (m.role === 'user') {
        return `<div class="msg user"><div class="bubble">${esc(m.content)}</div>${
          m.selection ? `<div class="cite">引用：${esc(m.selection.slice(0, 40))}…</div>` : ''
        }</div>`;
      }
      return `<div class="msg assistant"><div class="who">AI 阅读助手</div><div class="bubble">${mdLite(m.content)}</div></div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMessage(text, selection = '') {
  if (state.streaming) return;
  if (!state.current) return toast('请先打开一篇文章', 'err');
  const q = (text || '').trim();
  if (!q && !selection) return;

  state.streaming = true;
  $('#sendBtn').disabled = true;
  state.chat.push({ role: 'user', content: q || '（就这段内容提问）', selection });
  renderChat();

  const bubble = document.createElement('div');
  bubble.className = 'msg assistant';
  bubble.innerHTML = '<div class="who">AI 阅读助手</div><div class="bubble caret"></div>';
  $('#chat').appendChild(bubble);
  const bubbleBody = bubble.querySelector('.bubble');
  $('#chat').scrollTop = $('#chat').scrollHeight;

  let full = '';
  let lastPaint = 0;
  try {
    await sse(
      '/api/ai/chat',
      {
        articleId: state.current.id,
        messages: state.chat.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        selection,
        question: q,
      },
      (ev, data) => {
        if (ev === 'delta') {
          full += data.text;
          const now = performance.now();
          if (now - lastPaint > 70) {
            bubbleBody.innerHTML = mdLite(full);
            lastPaint = now;
            $('#chat').scrollTop = $('#chat').scrollHeight;
          }
        } else if (ev === 'done') {
          bubbleBody.innerHTML = mdLite(full);
          bubbleBody.classList.remove('caret');
        } else if (ev === 'error') {
          bubbleBody.classList.remove('caret');
          bubbleBody.innerHTML = `<span style="color:var(--red)">${esc(data.message)}</span>`;
        }
      }
    );
    state.chat.push({ role: 'assistant', content: full });
    clearSelection();
  } catch (e) {
    bubbleBody.classList.remove('caret');
    bubbleBody.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
    state.chat.pop();
  } finally {
    state.streaming = false;
    $('#sendBtn').disabled = false;
  }
}

/* ---------------- 划词 ---------------- */

function setSelection(text) {
  state.selection = text;
  if (text) {
    $('#aiContext').hidden = false;
    $('#ctxText').textContent = text;
  } else {
    $('#aiContext').hidden = true;
  }
}

function clearSelection() {
  state.selection = '';
  $('#aiContext').hidden = true;
  $('#selToolbar').hidden = true;
}

function positionToolbar(x, y) {
  const bar = $('#selToolbar');
  bar.hidden = false;
  const w = 300;
  const left = Math.min(Math.max(x, w / 2 + 8), window.innerWidth - w / 2 - 8);
  const top = Math.max(y, 54);
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'af-preview') return;
  if (d.type === 'selection' && d.text) {
    const frame = $('#previewFrame').getBoundingClientRect();
    setSelection(d.text);
    positionToolbar(frame.left + d.rect.left + d.rect.width / 2, frame.top + d.rect.top - 8);
  } else if (d.type === 'clear') {
    $('#selToolbar').hidden = true;
  } else if (d.type === 'open-url' && d.url) {
    window.open(d.url, '_blank', 'noopener');
  }
});

$('#selToolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const sel = state.selection;
  $('#selToolbar').hidden = true;
  if (!sel) return;
  if (btn.dataset.act === 'add') {
    toast('已加入对话上下文', 'ok');
    $('#composer').focus();
    $('#composer').placeholder = '针对选中内容继续提问…';
  } else {
    $('#composer').value = '这段内容是什么意思？';
    $('#composer').focus();
    $('#composer').setSelectionRange(0, 7);
    autoGrow($('#composer'));
  }
});

/* ---------------- 检索 ---------------- */

async function doSearch() {
  const query = $('#searchInput').value.trim();
  // 选了时间范围就自动切到按时间，避免新的被埋在相关度后面
  if ($('#searchTime').value && $('#searchSort').value !== 'time') $('#searchSort').value = 'time';
  if (!query) return toast('请输入关键词', 'err');
  const box = $('#searchResults');
  box.dataset.touched = '1';
  box.innerHTML = '<div class="skeleton">搜索中…</div>';
  try {
    const res = await api('/api/search', {
      method: 'POST',
      body: {
        query,
        sources: $('#searchSource').value,
        timeRange: $('#searchTime').value,
        sortBy: $('#searchSort').value,
        max: 30,
      },
    });
    if (!res.results.length) {
      box.innerHTML = `<div class="skeleton">没有结果${res.errors?.length ? '：' + esc(res.errors.join('；')) : ''}</div>`;
      return;
    }
    const timeNote = (res.errors || []).find((e) => e.includes('时间范围'));
    box.innerHTML =
      (timeNote ? `<div class="search-warn">⚠ ${esc(timeNote)}</div>` : '') +
      `<div class="search-summary">共 ${res.count} 条 · 来源 ${esc([...new Set(String(res.provider).split('+').map((x) => ({ sogou: '公众号', so360: '网页', duckduckgo: '网页', bing: '网页', 'sogou-web': '网页', tavily: '网页' }[x] || x)))].join(' + '))}${res.timeRange ? ` · ${esc({ day: '24 小时', week: '一周', month: '一个月', year: '一年' }[res.timeRange] || res.timeRange)}内` : ''}${res.sortBy === 'time' ? ' · 按时间排序' : ''}</div>` +
      res.results
        .map(
          (r) => `<div class="result">
        <div class="r-main">
          <div class="r-title"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)}</a></div>
          <div class="r-snippet">${esc(r.snippet || '')}</div>
          <div class="r-meta">
            <span class="src-tag ${r.provider === 'sogou' ? 'wx' : ''}">${esc(r.provider === 'sogou' ? '公众号' : r.provider === 'so360' ? '网页' : r.source || '网页')}</span>
            ${r.date ? `<span>${esc(r.date)}</span>` : ''}
            ${r.provider === 'sogou' && r.needsResolve ? '<span>链接将在转换时解析</span>' : ''}
          </div>
        </div>
        <button class="btn sm" data-convert="${esc(r.url)}" data-title="${esc(r.title)}">抓取转换</button>
      </div>`
        )
        .join('') + (res.errors?.length ? `<div class="hint">提示：${esc(res.errors.join('；'))}</div>` : '');
  } catch (e) {
    box.innerHTML = `<div class="skeleton">搜索失败：${esc(e.message)}</div>`;
  }
}

/* ---------------- 监控 ---------------- */

async function loadWatches() {
  const { watches } = await api('/api/watches');
  const box = $('#watchList');
  if (!watches.length) {
    box.innerHTML = '<div class="skeleton">还没有监控任务，添加关键词后系统会定时检查新内容</div>';
    return;
  }
  box.innerHTML = watches
    .map(
      (w) => `<div class="watch-card" data-wid="${w.id}">
      <div class="watch-top">
        <span class="watch-q">${esc(w.label || w.query)}</span>
        <span class="badge">${w.wechatOnly ? '仅公众号' : '全网'}</span>
        <span class="badge">每 ${w.intervalMin} 分钟</span>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn sm" data-check="${w.id}">立即检查</button>
          <button class="btn sm ghost" data-remove="${w.id}">删除</button>
        </div>
      </div>
      <div class="watch-meta">
        <span>上次检查：${w.lastRun ? new Date(w.lastRun).toLocaleString('zh-CN') : '未运行'}</span>
        <span>已见 ${(w.seen || []).length} 条</span>
        ${w.lastError ? `<span style="color:var(--amber)">${esc(w.lastError.slice(0, 60))}</span>` : ''}
      </div>
      <div class="watch-hits">
        ${(w.hits || [])
          .slice(0, 6)
          .map(
            (h) => `<div class="hit"><i class="dot"></i>
            <a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.title)}</a>
            <span class="when">${h.baseline ? '基线' : fmtDate(h.at)}</span>
            <button class="link-btn" data-convert="${esc(h.url)}" data-title="${esc(h.title)}">转换</button></div>`
          )
          .join('') || '<div class="hint">暂无命中</div>'}
      </div>
    </div>`
    )
    .join('');
}

/* ---------------- 知识库 ---------------- */

async function loadKb() {
  try {
    const [{ kb }, list, hist] = await Promise.all([
      api('/api/kb/status'),
      api('/api/kb/notes?limit=20'),
      api('/api/kb/history').catch(() => ({ history: [] })),
    ]);

    const card = $('#vaultCard');
    card.innerHTML = kb.configured
      ? `<div class="card-head"><h3>${esc(kb.label)}</h3><span class="badge" style="background:#e8f7ef;color:#16875a">已就绪</span></div>
         <div class="hint" style="margin-bottom:10px;word-break:break-all">${esc(kb.detail || kb.target || '')}</div>
         <div style="display:flex;gap:8px">
           <button class="btn sm" onclick="switchView('settings')">更换目标</button>
         </div>`
      : `<div class="card-head"><h3>${esc(kb.label)}</h3><span class="badge">未配置</span></div>
         <p class="desc">${esc(kb.detail || '配置后，AI 整理结果会自动写入并建立链接。')}</p>
         <button class="btn sm primary" onclick="switchView('settings')">去设置</button>`;

    const notes = list.notes || [];
    const histRows = (hist.history || []).slice(0, 12);
    $('#vaultNotes').innerHTML = notes.length
      ? notes
          .map(
            (n) => `<div class="note-item"><span>📄</span><span class="nm" title="${esc(n.path || '')}">${esc(n.name)}</span>
               <span class="tm">${n.mtime ? new Date(n.mtime).toLocaleDateString('zh-CN') : ''}</span></div>`
          )
          .join('')
      : histRows.length
      ? histRows
          .map(
            (h) => `<div class="note-item"><span>📝</span><span class="nm">${esc(h.title)}</span>
               <span class="tm">${new Date(h.at).toLocaleDateString('zh-CN')}</span></div>`
          )
          .join('')
      : `<div class="skeleton">${list.error ? esc(list.error) : '还没有写入记录，转换一篇文章后点「AI 整理并入库」'}</div>`;

    $('#presetCard').innerHTML = `<div class="card-head"><h3>整理格式模板</h3></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${state.presets.map((p) => `<span class="badge" style="background:var(--brand-soft);color:#574fd6">${esc(p.label)}</span>`).join('')}
      </div>
      <p class="hint" style="margin-top:10px">每次整理可在弹窗里选择模板、详细程度、是否生成概念笔记，并写自定义格式要求（会记住上次选择）。</p>`;
  } catch (e) {
    $('#vaultNotes').innerHTML = `<div class="skeleton">${esc(e.message)}</div>`;
  }
}

/* ---------------- 设置 ---------------- */

function kbFieldsHtml(dest, s) {
  const f = (label, id, value, ph = '') =>
    `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(value || '')}" placeholder="${esc(ph)}"></div>`;

  if (dest === 'obsidian') {
    return `${f('Vault 路径', 'kbObsVault', s.obsidian?.vaultPath, 'D:/Notes/MyVault')}
      ${f('笔记子目录', 'kbObsFolder', s.obsidian?.folder || 'ArticleForge', 'ArticleForge')}
      <label class="mini-check"><input type="checkbox" id="kbObsConcepts" ${s.obsidian?.createConceptNotes !== false ? 'checked' : ''}> 自动创建概念笔记并双链</label>
      <div class="hint">写入 vault 下子目录，带 YAML frontmatter、双链和 _索引.md。</div>`;
  }
  if (dest === 'logseq') {
    return `${f('Graph 路径', 'kbGraph', s.logseq?.graphPath, 'D:/Notes/logseq')}
      <label class="mini-check"><input type="checkbox" id="kbLogseqConcepts" ${s.logseq?.conceptPages !== false ? 'checked' : ''}> 每个概念建一页</label>
      <div class="hint">写入 graph/pages，正文转成大纲块，页面属性用 key:: value。</div>`;
  }
  if (dest === 'siyuan') {
    const books = state.siyuanNotebooks || [];
    return `${f('API 地址', 'kbSyUrl', s.siyuan?.apiUrl || 'http://127.0.0.1:6806')}
      ${f('API Token', 'kbSyToken', s.siyuan?.token, '思源 → 设置 → 关于 → API token')}
      <div class="field"><label>笔记本</label>
        <select id="kbSyNotebook">
          <option value="">（自动选第一个）</option>
          ${books.map((b) => `<option value="${esc(b.id)}" ${s.siyuan?.notebook === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          ${s.siyuan?.notebook && !books.some((b) => b.id === s.siyuan.notebook) ? `<option value="${esc(s.siyuan.notebook)}" selected>${esc(s.siyuan.notebookName || s.siyuan.notebook)}</option>` : ''}
        </select></div>
      <div class="hint">「保存并测试」会自动拉取笔记本列表。</div>`;
  }
  if (dest === 'notion') {
    return `${f('Integration Token', 'kbNoToken', s.notion?.token, 'secret_xxx')}
      ${f('数据库 ID', 'kbNoDb', s.notion?.databaseId, '32 位数据库 ID')}
      ${f('标题属性名', 'kbNoTitle', s.notion?.titleProp || 'Name', 'Name')}
      <div class="hint">记得把 Integration 邀请进目标数据库（数据库右上角 ··· → 连接）。</div>`;
  }
  return `${f('保存目录', 'kbDir', s.folder?.dir, 'D:/Notes/Inbox')}
    ${f('概念笔记子目录', 'kbConceptDir', s.folder?.conceptSubdir ?? '概念', '留空则不建概念笔记')}
    <div class="field"><label>链接写法</label>
      <select id="kbLinkStyle">
        <option value="wiki" ${s.kb?.linkStyle !== 'plain' ? 'selected' : ''}>[[双链]]</option>
        <option value="plain" ${s.kb?.linkStyle === 'plain' ? 'selected' : ''}>纯文本</option>
      </select></div>
    <label class="mini-check"><input type="checkbox" id="kbIndex" ${s.folder?.index !== false ? 'checked' : ''}> 维护 _索引.md</label>`;
}

/* ---------------- 设置 ---------------- */

async function loadSettings() {
  const { settings, ai, kb, browser, destinations } = await api('/api/settings');
  state.settings = settings;
  state.kbDestinations = destinations || [];
  const s = settings;
  const grid = $('#settingsGrid');
  grid.innerHTML = `
    <div class="card">
      <h3>AI 模型</h3>
      <p class="desc">OpenAI 兼容接口，推荐 DeepSeek / Kimi / 通义千问；本地 Ollama 填 http://localhost:11434/v1</p>
      <div class="field"><label>API 地址</label><input type="text" id="setBase" value="${esc(s.ai.baseUrl)}" placeholder="https://api.deepseek.com/v1"></div>
      <div class="field"><label>API Key</label><input type="password" id="setKey" value="${esc(s.ai.apiKey)}" placeholder="sk-..."></div>
      <div class="field-row">
        <div class="field"><label>模型名</label><input type="text" id="setModel" value="${esc(s.ai.model)}" placeholder="deepseek-chat"></div>
        <div class="field"><label>温度</label><input type="text" id="setTemp" value="${esc(s.ai.temperature)}"></div>
      </div>
      <label class="mini-check"><input type="checkbox" id="setAiEnabled" ${s.ai.enabled ? 'checked' : ''}> 启用 AI 功能</label>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn sm primary" id="saveSettings">保存</button>
        <button class="btn sm" id="testAi">测试连接</button>
      </div>
      <div class="hint">当前状态：${esc(ai.model)} ${ai.ready ? '· 已就绪' : '· 未就绪'}</div>
    </div>

    <div class="card">
      <h3>知识库</h3>
      <p class="desc">整理结果写到哪个知识库由你选，不限 Obsidian。</p>
      <div class="field"><label>写入目标</label>
        <select id="kbDest">
          ${(state.kbDestinations || []).map((d) => `<option value="${d.key}" ${s.kb?.destination === d.key ? 'selected' : ''}>${d.label}${d.kind === 'api' ? '（API）' : ''}</option>`).join('')}
        </select>
        <div class="hint" id="kbDestDesc">${esc((state.kbDestinations || []).find((d) => d.key === (s.kb?.destination || 'obsidian'))?.desc || '')}</div>
      </div>
      <div id="kbFields">${kbFieldsHtml(s.kb?.destination || 'obsidian', s)}</div>
      <label class="mini-check" style="margin-top:8px"><input type="checkbox" id="kbSingleFile" ${s.kb?.singleFile !== false ? 'checked' : ''}> 整理成<b>单个 Markdown</b>（知识点、概念、关联都内联在一个文件里，不单独建概念卡和索引）</label>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn sm primary" id="saveKb">保存</button>
        <button class="btn sm" id="testKb">保存并测试</button>
        <span class="hint" id="kbTestMsg" style="margin:0"></span>
      </div>
      <div class="hint">当前：${kb.configured ? '✓ ' + esc(kb.detail || kb.target || '') : '未配置'}</div>
    </div>

    <div class="card">
      <h3>检索与监控</h3>
      <p class="desc">DuckDuckGo 免 Key，适合全网；搜狗微信专查公众号文章；Tavily 需 Key，质量最稳。</p>
      <div class="field"><label>默认搜索源</label>
        <select id="setProvider">
          <option value="duckduckgo" ${s.search.provider === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo（免 Key，推荐）</option>
          <option value="sogou" ${s.search.provider === 'sogou' ? 'selected' : ''}>搜狗微信（公众号文章）</option>
          <option value="bing" ${s.search.provider === 'bing' ? 'selected' : ''}>Bing</option>
          <option value="tavily" ${s.search.provider === 'tavily' ? 'selected' : ''}>Tavily</option>
        </select></div>
      <div class="field"><label>Tavily API Key</label><input type="password" id="setTavily" value="${esc(s.search.tavilyKey)}"></div>
      <div class="field-row">
        <div class="field"><label>单次结果数</label><input type="text" id="setMax" value="${esc(s.search.maxResults)}"></div>
        <div class="field"><label>监控基础间隔（分钟）</label><input type="text" id="setWatchInterval" value="${esc(s.watch.intervalMin)}"></div>
      </div>
      <button class="btn sm primary" id="saveSettings2">保存</button>
    </div>

    <div class="card">
      <h3>渲染内核</h3>
      <p class="desc">使用本机 Chrome / Edge 无头渲染与打印 PDF，不额外下载浏览器。</p>
      <div class="field"><label>浏览器路径（留空自动探测）</label><input type="text" id="setBrowser" value="${esc(s.browser.executablePath)}" placeholder="${esc(browser || '未找到')}"></div>
      <label class="mini-check"><input type="checkbox" id="setHeadless" ${s.browser.headless !== false ? 'checked' : ''}> 无头模式</label>
      <div class="hint">当前：${esc(browser || '未找到，请手动指定')}</div>
      <button class="btn sm primary" id="saveSettings3" style="margin-top:12px">保存</button>
    </div>
  `;

  const kbPatch = () => {
    const dest = $('#kbDest').value;
    const patch = { kb: { destination: dest, singleFile: $('#kbSingleFile').checked } };
    if (dest === 'obsidian') {
      patch.obsidian = {
        vaultPath: $('#kbObsVault').value.trim(),
        folder: $('#kbObsFolder').value.trim() || 'ArticleForge',
        createConceptNotes: $('#kbObsConcepts').checked,
      };
    } else if (dest === 'logseq') {
      patch.logseq = { graphPath: $('#kbGraph').value.trim(), conceptPages: $('#kbLogseqConcepts').checked };
    } else if (dest === 'folder') {
      patch.folder = {
        dir: $('#kbDir').value.trim(),
        conceptSubdir: $('#kbConceptDir').value.trim(),
        index: $('#kbIndex').checked,
      };
      patch.kb.linkStyle = $('#kbLinkStyle').value;
    } else if (dest === 'siyuan') {
      const sel = $('#kbSyNotebook');
      patch.siyuan = {
        apiUrl: $('#kbSyUrl').value.trim(),
        token: $('#kbSyToken').value.trim(),
        notebook: sel ? sel.value : '',
        notebookName: sel ? sel.options[sel.selectedIndex]?.textContent || '' : '',
      };
    } else if (dest === 'notion') {
      patch.notion = {
        token: $('#kbNoToken').value.trim(),
        databaseId: $('#kbNoDb').value.trim(),
        titleProp: $('#kbNoTitle').value.trim() || 'Name',
      };
    }
    return patch;
  };

  const save = async (extra = {}) => {
    const silent = Boolean(extra.silent);
    delete extra.silent;
    const patch = {
      ai: {
        baseUrl: $('#setBase').value.trim(),
        apiKey: $('#setKey').value.trim(),
        model: $('#setModel').value.trim(),
        temperature: Number($('#setTemp').value) || 0.4,
        enabled: $('#setAiEnabled').checked,
      },
      ...kbPatch(),
      search: {
        provider: $('#setProvider').value,
        tavilyKey: $('#setTavily').value.trim(),
        maxResults: Number($('#setMax').value) || 12,
      },
      watch: { intervalMin: Number($('#setWatchInterval').value) || 30 },
      browser: { executablePath: $('#setBrowser').value.trim(), headless: $('#setHeadless').checked },
      ...extra,
    };
    try {
      const res = await api('/api/settings', { method: 'POST', body: patch });
      state.settings = res.settings;
      refreshAiBadge(res.ai);
      if (!silent) toast('设置已保存', 'ok');
      loadKb();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  $('#saveSettings').onclick = () => save();
  $('#saveSettings2').onclick = () => save();
  $('#saveSettings3').onclick = () => save();
  $('#saveKb').onclick = () => save();

  const rerenderKb = () => {
    const dest = $('#kbDest').value;
    $('#kbFields').innerHTML = kbFieldsHtml(dest, s);
    $('#kbDestDesc').textContent = (state.kbDestinations || []).find((d) => d.key === dest)?.desc || '';
    bindKbFields();
  };
  const bindKbFields = () => {
    const nb = $('#kbSyNotebook');
    if (nb) {
      nb.onchange = () => {
        const name = nb.options[nb.selectedIndex]?.textContent || '';
        state.siyuanNotebookName = name;
        save();
      };
    }
  };
  $('#kbDest').onchange = rerenderKb;
  bindKbFields();

  $('#testKb').onclick = async () => {
    const btn = $('#testKb');
    const msg = $('#kbTestMsg');
    btn.disabled = true;
    msg.textContent = '测试中…';
    try {
      await save({ silent: true });
      const r = await api('/api/kb/test', { method: 'POST', body: { key: $('#kbDest').value } });
      if (r.notebooks?.length) {
        state.siyuanNotebooks = r.notebooks;
        const cur = $('#kbSyNotebook')?.value || '';
        $('#kbFields').innerHTML = kbFieldsHtml('siyuan', state.settings);
        bindKbFields();
        if (cur) $('#kbSyNotebook').value = cur;
      }
      msg.innerHTML = r.ok
        ? `<span style="color:var(--green)">✓ ${esc(r.message)}</span>`
        : `<span style="color:var(--red)">✕ ${esc(r.message)}</span>`;
      toast(r.ok ? r.message : r.message, r.ok ? 'ok' : 'err', 5000);
    } catch (e) {
      msg.innerHTML = `<span style="color:var(--red)">✕ ${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  };
  $('#testAi').onclick = async () => {
    const btn = $('#testAi');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('/api/ai/test', { method: 'POST', body: {} });
      toast(`连接正常：${r.reply}`, 'ok');
    } catch (e) {
      toast(e.message, 'err', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  };
}

function refreshAiBadge(ai) {
  const ready = ai?.ready;
  $('#aiDot').classList.toggle('on', Boolean(ready));
  $('#aiModel').textContent = ready ? ai.model : '未配置';
}

/* ---------------- 视图切换 ---------------- */

function switchView(view) {
  state.view = view;
  $('#selToolbar').hidden = true;
  $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.main > .view').forEach((v) => (v.hidden = true));
  const map = { convert: '#viewConvert', search: '#viewSearch', watch: '#viewWatch', knowledge: '#viewKnowledge', settings: '#viewSettings' };
  $(map[view]).hidden = false;
  $('#listPane').style.display = view === 'convert' ? '' : 'none';
  $('#viewTabs').hidden = !(view === 'convert' && state.current);
  document.querySelector('.app').style.gridTemplateColumns =
    view === 'convert' ? '' : '66px minmax(0,1fr) 372px';

  // 顶部标题栏跟随视图
  const titles = { search: '全网检索', watch: '内容监控', knowledge: '知识库', settings: '设置' };
  $('#topbarActions').style.display = view === 'convert' ? '' : 'none';
  $('#docTitle').textContent = view === 'convert' ? state.current?.title || '未选择文章' : titles[view];

  if (view === 'search' && !$('#searchResults').dataset.touched) {
    $('#searchResults').innerHTML =
      '<div class="empty-hint">输入关键词后回车，或试试这些方向：<div class="hint-chips"><button data-q="内存取证 教程">内存取证 教程</button><button data-q="Volatility 命令">Volatility 命令</button><button data-q="CTF 逆向 入门">CTF 逆向 入门</button></div></div>';
    $$('#searchResults .hint-chips button').forEach((b) => {
      b.onclick = () => {
        $('#searchInput').value = b.dataset.q;
        doSearch();
      };
    });
  }
  if (view === 'watch') loadWatches();
  if (view === 'knowledge') loadKb();
  if (view === 'settings') loadSettings();
  if (view === 'convert' && state.current) setTab(state.tab);
}
window.switchView = switchView;

/* ---------------- 事件绑定 ---------------- */

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 132) + 'px';
}

function bind() {
  $$('.rail-btn').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  $('#fetchBtn').onclick = doFetch;
  $('#urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFetch();
  });
  $('#uploadBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => doUpload(e.target.files);
  $('#refreshLib').onclick = loadLibrary;
  $('#libFilter').oninput = renderLibrary;

  $('#articleList').onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm('删除这篇内容？')) return;
      await api(`/api/articles/${del.dataset.del}`, { method: 'DELETE' });
      if (state.current?.id === del.dataset.del) {
        state.current = null;
        $('#emptyState').hidden = false;
        $('#previewWrap').hidden = true;
        $('#viewTabs').hidden = true;
        $('#docTitle').textContent = '未选择文章';
        $('#topbarActions').innerHTML = '';
      }
      await loadLibrary();
      return;
    }
    const item = e.target.closest('.article-item');
    if (item) openArticle(item.dataset.id);
  };

  $$('#viewTabs .tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  document.addEventListener('click', (e) => {
    const conv = e.target.closest('[data-convert]');
    if (conv) {
      switchView('convert');
      $('#urlInput').value = conv.dataset.convert;
      doFetch(conv.dataset.title || '');
    }
  });

  $('#searchBtn').onclick = doSearch;
  $('#searchInput').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());

  $('#addWatchBtn').onclick = async () => {
    const query = $('#watchInput').value.trim();
    if (!query) return toast('请输入监控关键词', 'err');
    try {
      await api('/api/watches', {
        method: 'POST',
        body: {
          query,
          intervalMin: Number($('#watchInterval').value),
          wechatOnly: $('#watchWechat').checked,
        },
      });
      $('#watchInput').value = '';
      toast('监控已添加', 'ok');
      loadWatches();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  $('#watchList').onclick = async (e) => {
    const check = e.target.closest('[data-check]');
    const remove = e.target.closest('[data-remove]');
    if (check) {
      check.disabled = true;
      check.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await api(`/api/watches/${check.dataset.check}/check`, { method: 'POST', body: {} });
        toast(r.fresh ? `发现 ${r.fresh} 条内容` : '暂无新内容', r.fresh ? 'ok' : 'info');
        loadWatches();
      } catch (err) {
        toast(err.message, 'err');
        check.disabled = false;
        check.textContent = '立即检查';
      }
    }
    if (remove) {
      if (!confirm('删除这个监控任务？')) return;
      await api(`/api/watches/${remove.dataset.remove}`, { method: 'DELETE' });
      loadWatches();
    }
  };

  $('#scanVaultBtn').onclick = loadKb;
  $('#reloadPreview').onclick = () => {
    const f = $('#previewFrame');
    f.src = f.src.split('?')[0] + '?t=' + Date.now();
    $('#previewEmpty').hidden = true;
  };
  $('#organizeBtn').onclick = openOrganizeModal;
  $('#clearChat').onclick = async () => {
    if (!state.current) return;
    await api(`/api/ai/chat/${state.current.id}`, { method: 'DELETE' });
    state.chat = [];
    renderChat();
  };

  $('#sendBtn').onclick = () => {
    const box = $('#composer');
    const text = box.value;
    const sel = state.selection;
    box.value = '';
    autoGrow(box);
    sendMessage(text, sel);
  };
  $('#composer').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#sendBtn').click();
    }
  });
  $('#composer').addEventListener('input', (e) => autoGrow(e.target));
  $('#ctxClose').onclick = () => setSelection('');
  $$('#quickAsks button').forEach((b) => (b.onclick = () => sendMessage(b.dataset.q)));

  $('#modalMask').onclick = (e) => {
    if (e.target.id === 'modalMask') closeModal();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      $('#selToolbar').hidden = true;
    }
  });

  // SSE：监控命中提醒
  const es = new EventSource('/api/events');
  es.addEventListener('watch:hit', (e) => {
    const d = JSON.parse(e.data);
    toast(`监控「${d.query}」发现 ${d.count} 篇新文章`, 'ok', 6000);
    if (state.view === 'watch') loadWatches();
  });
  es.addEventListener('library:update', () => {
    if (state.view === 'convert') loadLibrary();
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  bind();
  try {
    const st = await api('/api/status');
    state.status = st;
    state.presets = st.presets || [];
    refreshAiBadge(st.ai);
    $('#aiHint').textContent = st.ai.ready ? st.ai.model : 'AI 未配置，去设置';
    if (!st.ai.ready) {
      setTimeout(() => toast('AI 功能未配置：到「设置」填入 API 地址与密钥后即可划词提问与知识整理', 'info', 7000), 1200);
    }
  } catch (e) {
    toast(e.message, 'err');
  }
  await loadLibrary();
  autoGrow($('#composer'));
}

init();
