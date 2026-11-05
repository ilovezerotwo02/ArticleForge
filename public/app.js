/* ArticleForge 前端 */
const $ = (s, r = document) => r.querySelector(s);

/* 线性图标：一套、同尺寸、同描边，颜色跟随文字 */
const IC = {
  folder: '<svg class="ico" viewBox="0 0 24 24"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg class="ico" viewBox="0 0 24 24"><path d="M6.5 3.5h7.5l4 4v13h-11.5z"/><path d="M14 3.5v4h4"/></svg>',
  tag: '<svg class="bi" viewBox="0 0 24 24"><path d="M3.5 4.5v6.6l8.4 8.4a1.6 1.6 0 0 0 2.3 0l5.3-5.3a1.6 1.6 0 0 0 0-2.3L11.1 3.5H4.5a1 1 0 0 0-1 1z"/><circle cx="8" cy="8" r="1.2"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 16.5V21"/><path d="M8.5 4h7l-1 5.5 3 3.5v1.5h-11V13l3-3.5z"/></svg>',
  pinOn: '<svg viewBox="0 0 24 24"><path d="M12 16.5V21"/><path d="M8.5 4h7l-1 5.5 3 3.5v1.5h-11V13l3-3.5z" fill="currentColor"/></svg>',
};
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
  search: null,
  tagFilter: '',
  todos: [],
  // 两侧面板收起状态（Obsidian 式），记忆在 localStorage
  panels: { list: true, ai: true },
  // 标题大纲（Obsidian 式）是否展开，排版预览 / 应用内阅读 / 知识库共用
  outlineOpen: localStorage.getItem('af.outline') !== '0',
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
  // Obsidian 式 ==高亮== → <mark>（跳过代码段，代码里的 == 保持原样）
  text = text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) => (i % 2 ? seg : seg.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>')))
    .join('');

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
  const list = state.articles.filter((a) => {
    if (state.tagFilter && !(a.userTags || []).includes(state.tagFilter)) return false;
    return (
      !q ||
      (a.title || '').toLowerCase().includes(q) ||
      (a.account || '').toLowerCase().includes(q) ||
      (a.tags || []).join(' ').includes(q) ||
      (a.userTags || []).join(' ').includes(q)
    );
  });
  $('#libCount').textContent = state.articles.length;

  // 「未完成」徽章：文章打了「未完成」标签就有计数，点一下只看没办完的
  const todoCount = state.articles.filter((a) => (a.userTags || []).includes('未完成')).length;
  const badge = $('#todoBadge');
  badge.hidden = !state.articles.length;
  badge.innerHTML = `未完成 <b class="${todoCount ? 'n' : ''}">${todoCount}</b>`;
  badge.classList.toggle('on', state.tagFilter === '未完成');

  // 标签筛选栏：常驻显示。内置状态标签（未完成/进行中/已完成/重要）排在前面，
  // 没用过的置灰 —— 不用先打标签也能一眼看到「点这里看未完成的事」
  const counts = new Map();
  for (const a of state.articles) for (const t of a.userTags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const orderedTags = [
    ...TAG_PRESETS,
    ...[...counts.keys()].filter((t) => !TAG_PRESETS.includes(t)).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b, 'zh-CN')),
  ];
  const tagBar = $('#tagFilterBar');
  tagBar.hidden = !state.articles.length;
  tagBar.innerHTML =
    '<span class="tag-filter-label">标签</span>' +
    orderedTags
      .map((t) => {
        const c = counts.get(t) || 0;
        return `<button class="tag-chip ${state.tagFilter === t ? 'on' : ''}${t === '未完成' ? ' todo' : ''}${c ? '' : ' zero'}" data-tag="${esc(t)}" title="点击只看「${esc(t)}」的内容">${esc(t)}<i>${c}</i></button>`;
      })
      .join('');

  const box = $('#articleList');
  if (!list.length) {
    box.innerHTML = `<div class="skeleton">${
      !state.articles.length
        ? '还没有内容，粘贴链接或上传文件开始'
        : state.tagFilter
        ? `「${esc(state.tagFilter)}」下还没有内容；点文章条目上的「＋标签」可以把文章标记进来`
        : '没有匹配的文章'
    }</div>`;
    return;
  }
  box.innerHTML = list
    .map((a) => {
      const utags = a.userTags || [];
      return `<div class="article-item ${state.current?.id === a.id ? 'active' : ''}" data-id="${a.id}">
        <div class="t">${esc(a.title)}</div>
        <div class="m">
          <span class="badge ${a.source === 'wechat' ? 'wx' : a.source === 'upload' ? 'up' : ''}">${
        a.source === 'wechat' ? '公众号' : a.source === 'upload' ? (a.sourceKind || '文件').toUpperCase() : '网页'
      }</span>
          <span>${Number(a.words || 0).toLocaleString('en-US')} 字</span>
          ${a.assets ? `<span>${a.assets} 图</span>` : ''}
          <button class="tagadd ${utags.length ? 'has' : ''}" data-tagedit="${a.id}" title="${utags.length ? `标签：${esc(utags.join('、'))}` : '编辑标签'}">${
        utags.length ? `标签 ${utags.length}` : '加标签'
      }</button>
          <span style="margin-left:auto">${fmtDate(a.createdAt)}</span>
        </div>
        ${
          utags.length
            ? `<div class="a-tags">${utags
                .map((t) => `<span class="a-tag ${t === '未完成' ? 'todo' : ''}">${esc(t)}</span>`)
                .join('')}</div>`
            : ''
        }
        <button class="del" data-del="${a.id}" title="删除">×</button>
      </div>`;
    })
    .join('');
}

/* ---------------- 用户标签 ---------------- */

const TAG_PRESETS = ['未完成', '进行中', '已完成', '重要'];

/** 标签编辑弹窗：与 AI 标签分开，完全由用户自己维护 */
function openTagEditor(id) {
  const item = state.articles.find((x) => x.id === id);
  if (!item) return;
  const working = [...(item.userTags || [])];
  const allTags = [...new Set(state.articles.flatMap((a) => a.userTags || []))];

  const rowHtml = () =>
    working.length
      ? working.map((t) => `<button class="chip active" data-rm="${esc(t)}" title="点击移除">${esc(t)} ×</button>`).join('')
      : '<span class="hint">暂无标签，可从下方选择或输入</span>';
  const presetHtml = () =>
    TAG_PRESETS.filter((p) => !working.includes(p))
      .map((p) => `<button class="chip preset" data-add="${esc(p)}"${p === '未完成' ? ' title="用「未完成」标记还没看完/没办完的事"' : ''}><span class="cl">${esc(p)}</span></button>`)
      .join('');

  const rerender = () => {
    $('#teCur').innerHTML = rowHtml();
    $('#tePresetChips').innerHTML = presetHtml();
    $('#tePresets').style.display = $('#tePresetChips').innerHTML ? '' : 'none';
  };

  openModal(`
    <h2>编辑标签</h2>
    <p class="sub">${esc(item.title)}</p>
    <div class="field"><label>当前标签（点击移除）</label><div class="chip-grid tags" id="teCur">${rowHtml()}</div></div>
    <div class="field" id="tePresets"><label>快速添加</label><div class="chip-grid tags" id="tePresetChips">${presetHtml()}</div></div>
    <div class="field"><label>自定义标签</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="teInput" placeholder="输入标签名，回车添加" list="teAllTags" maxlength="24">
        <datalist id="teAllTags">${allTags.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
        <button class="btn sm primary" id="teAddBtn">添加</button>
      </div>
      <div class="hint">最多 12 个。状态类标签（未完成、进行中、已完成）可在资料库顶部筛选</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" id="teSave">保存</button>
    </div>
  `);

  rerender();
  $('#modal').onclick = (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const i = working.indexOf(rm.dataset.rm);
      if (i >= 0) working.splice(i, 1);
      rerender();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add && !working.includes(add.dataset.add)) {
      working.push(add.dataset.add);
      rerender();
    }
  };
  const addFromInput = () => {
    const v = ($('#teInput').value || '').trim().slice(0, 24);
    if (v && !working.includes(v)) working.push(v);
    $('#teInput').value = '';
    rerender();
    $('#teInput').focus();
  };
  $('#teAddBtn').onclick = addFromInput;
  $('#teInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  });
  $('#teSave').onclick = async () => {
    try {
      const { article } = await api(`/api/articles/${id}`, { method: 'PATCH', body: { userTags: working } });
      const idx = state.articles.findIndex((x) => x.id === id);
      if (idx >= 0) state.articles[idx] = { ...state.articles[idx], userTags: article.userTags || [] };
      if (state.current?.id === id) {
        state.current.userTags = article.userTags || [];
        renderTopActions();
      }
      renderLibrary();
      closeModal();
      toast(working.includes('未完成') ? '已保存，点左侧「未完成」随时找回' : '标签已保存', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
}

async function openArticle(id) {
  try {
    const { article } = await api(`/api/articles/${id}`);
    state.current = article;
    state.tab = 'preview';
    $('#relQuery').value = '';
    $('#relResults').innerHTML = '';
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
  const utags = a.userTags || [];
  $('#topbarActions').innerHTML = `
    ${utags.length ? `<span class="top-tags">${utags.map((t) => `<span class="a-tag ${t === '未完成' ? 'todo' : ''}">${esc(t)}</span>`).join('')}</span>` : ''}
    <button class="btn sm" id="btnTags" title="编辑这篇文章的标签">${IC.tag}标签</button>
    <button class="btn sm" id="btnExport">导出 PDF · DOCX · MD</button>
    ${a.url ? `<button class="btn sm ghost" id="btnOrigin" title="查看原网页：本软件内 / 浏览器">原网页 ▾</button>` : ''}
  `;
  const origin = $('#btnOrigin');
  if (origin) {
    origin.onclick = async () => {
      const url = a.finalUrl || a.url;
      showPop(origin, [{ group: '查看原网页' }, { label: '在本软件里打开', hint: '应用内窗口', run: () => openWebInApp(url) }, 'hr', ...(await browserItems(url))]);
    };
  }
  $('#btnTags').onclick = () => openTagEditor(a.id);
  $('#btnExport').onclick = openExportModal;
}

/* ---------------- Obsidian 式标题大纲（排版预览 / 应用内阅读 / 知识库共用） ---------------- */

const OT_CHEV = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
const OT_FOLD = '<svg viewBox="0 0 24 24"><path d="m7 15 5-5 5 5"/><path d="m7 20 5-5 5 5" opacity=".5"/></svg>';

/** heads: [{id, level, text}]，按层级组装成可折叠的树，带竖向缩进引导线 */
function renderOutline(box, heads, { onJump, onClose, title = '大纲' } = {}) {
  const root = { kids: [] };
  const stack = [{ level: 0, node: root }];
  for (const h of heads) {
    const node = { h, kids: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack[stack.length - 1].node.kids.push(node);
    stack.push({ level: h.level, node });
  }
  const html = (nodes, top) =>
    nodes
      .map(
        (n) => `<div class="ot-node ${top ? 'lv-top' : ''}">
          <div class="ot-row" data-h="${esc(n.h.id)}" title="${esc(n.h.text)}">
            <span class="ot-tw" ${n.kids.length ? 'data-tw="1"' : 'style="visibility:hidden"'}>${OT_CHEV}</span>
            <span class="ot-text">${esc(n.h.text)}</span>
          </div>
          ${n.kids.length ? `<div class="ot-kids">${html(n.kids, false)}</div>` : ''}
        </div>`
      )
      .join('');
  box.innerHTML = `<div class="ot-head">
      <span class="ot-title">${esc(title)}<span class="ot-n">${heads.length}</span></span>
      <button data-ot="fold" title="全部折叠 / 全部展开">${OT_FOLD}</button>
      ${onClose ? '<button data-ot="close" title="收起大纲">×</button>' : ''}
    </div>
    <div class="ot-body">${heads.length ? html(root.kids, true) : '<div class="ot-empty">这篇没有识别出标题</div>'}</div>`;
  box.onclick = (e) => {
    if (e.target.closest('[data-ot="close"]')) return onClose && onClose();
    if (e.target.closest('[data-ot="fold"]')) {
      const parents = $$('.ot-node', box).filter((n) => n.querySelector(':scope > .ot-kids'));
      const anyOpen = parents.some((n) => !n.classList.contains('collapsed'));
      parents.forEach((n) => n.classList.toggle('collapsed', anyOpen));
      return;
    }
    const tw = e.target.closest('[data-tw]');
    if (tw) return tw.closest('.ot-node').classList.toggle('collapsed');
    const row = e.target.closest('.ot-row');
    if (row) {
      setOutlineActive(box, row.dataset.h);
      onJump && onJump(row.dataset.h);
    }
  };
}

/** 高亮当前小节：被折叠的父级自动展开，并把高亮行滚进可视区 */
function setOutlineActive(box, id) {
  let act = null;
  $$('.ot-row', box).forEach((r) => {
    const on = r.dataset.h === id;
    r.classList.toggle('active', on);
    if (on) act = r;
  });
  if (!act || box._lastActive === id) return;
  box._lastActive = id;
  const body = box.querySelector('.ot-body');
  const rb = act.getBoundingClientRect();
  const bb = body.getBoundingClientRect();
  if (rb.top < bb.top + 6 || rb.bottom > bb.bottom - 6) body.scrollTop += rb.top - bb.top - bb.height / 2;
}

/** 给 iframe 里的阅读页挂大纲：提取 h1~h4、点击跳转、滚动跟随高亮。返回标题数 */
function bindFrameOutline(frame, box, opts = {}) {
  let d;
  try {
    d = frame.contentDocument;
  } catch {
    return 0;
  }
  if (!d) return 0;
  const els = $$('.af-content h1, .af-content h2, .af-content h3, .af-content h4', d).filter((h) => h.textContent.trim());
  els.forEach((h, i) => {
    if (!h.id) h.id = `afh-${i}`;
  });
  const heads = els.map((h) => ({ id: h.id, level: Number(h.tagName[1]), text: h.textContent.trim().replace(/\s+/g, ' ') }));
  box._lastActive = '';
  renderOutline(box, heads, {
    ...opts,
    onJump: (id) => d.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  });
  let raf = 0;
  const spy = () => {
    raf = 0;
    let cur = heads[0]?.id;
    for (const h of els) {
      if (h.getBoundingClientRect().top <= 90) cur = h.id;
      else break;
    }
    if (cur) setOutlineActive(box, cur);
  };
  frame.contentWindow.addEventListener('scroll', () => raf || (raf = requestAnimationFrame(spy)), { passive: true });
  spy();
  return heads.length;
}

const hasBg = () => document.body.classList.contains('has-bg');
const previewQuery = () => `embed=1${hasBg() ? '&bg=1' : ''}&t=${Date.now()}`;

/** 排版预览右侧大纲：开关记在 localStorage，没识别出标题时自动隐藏 */
function applyDocOutline() {
  const box = $('#docOutline');
  const n = box._count || 0;
  box.hidden = !(state.tab === 'preview' && state.outlineOpen && n > 0);
  $('#outlineToggle').classList.toggle('on', state.outlineOpen);
  $('#outlineToggle').hidden = state.tab !== 'preview';
}

function setDocOutlineOpen(open) {
  state.outlineOpen = open;
  try {
    localStorage.setItem('af.outline', open ? '1' : '0');
  } catch {}
  applyDocOutline();
}

/** 预览加载完：内容空白时给出提示与重试入口；挂上 Obsidian 式大纲 */
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
    const box = $('#docOutline');
    box._count = bindFrameOutline(frame, box, { onClose: () => setDocOutlineOpen(false) });
    applyDocOutline();
    $('#previewEmpty').hidden = !empty;
    const tab = $('#openPreviewTab');
    if (tab && state.current) tab.href = `/api/articles/${state.current.id}/preview`;
  }, 120);
}

/* ---------------- 查看方式：本软件阅读 / 本软件网页原样 / 浏览器 ---------------- */

let openAppsCache = null;
async function openApps() {
  if (!openAppsCache) {
    openAppsCache = await api('/api/open-with/apps').catch(() => ({ url: [{ id: 'default', label: '系统默认浏览器' }], file: [{ id: 'default', label: '系统默认软件' }] }));
  }
  return openAppsCache;
}

function closePop() {
  $('#popMenu').hidden = true;
}

/** 在锚点下方弹出菜单；items: {label, hint, run} | 'hr' | {group} */
function showPop(anchor, items) {
  const m = $('#popMenu');
  m.innerHTML = items
    .map((it, i) => (it === 'hr' ? '<hr>' : it.group ? `<div class="pm-label">${esc(it.group)}</div>` : `<button data-i="${i}">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`))
    .join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + h + 6 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  m.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closePop();
    items[Number(b.dataset.i)].run();
  };
}

/** 在鼠标位置弹出菜单（右键菜单用） */
function showPopAt(x, y, items) {
  if (!items.length) return;
  const m = $('#popMenu');
  m.innerHTML = items
    .map((it, i) => (it === 'hr' ? '<hr>' : it.group ? `<div class="pm-label">${esc(it.group)}</div>` : `<button data-i="${i}">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`))
    .join('');
  m.hidden = false;
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  m.style.top = `${Math.max(4, y + h > window.innerHeight - 4 ? y - h : y)}px`;
  m.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closePop();
    items[Number(b.dataset.i)].run();
  };
}

/** 网页原样在本软件里打开（桌面版是应用内窗口；纯浏览器模式退化成新标签） */
function openWebInApp(url) {
  if (window.afNative?.openInApp) window.afNative.openInApp(url);
  else window.open(url, '_blank', 'noopener');
}

async function openInBrowser(url, app = 'default') {
  try {
    await api('/api/open-with', { method: 'POST', body: { url, app } });
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function browserItems(url) {
  const apps = await openApps();
  return [{ group: '用浏览器打开' }, ...apps.url.map((a) => ({ label: a.label, run: () => openInBrowser(url, a.id) }))];
}

async function showViewMenu(anchor, url, title = '') {
  showPop(anchor, [
    { group: '在本软件里查看' },
    { label: '应用内阅读', hint: '排版提取 · 不入库', run: () => openReader(url, title) },
    { label: '应用内网页原样', hint: '原网页', run: () => openWebInApp(url) },
    'hr',
    ...(await browserItems(url)),
    'hr',
    { label: '抓取转换并收入资料库', run: () => window.afConvertUrl(url, title) },
    { label: '复制链接', run: () => navigator.clipboard?.writeText(url).then(() => toast('已复制链接', 'ok')) },
  ]);
}

/* ---------------- 应用内阅读：先看后收 ---------------- */

const reader = { seq: 0, id: '', url: '', inLibrary: false, saved: false };

async function openReader(url, title = '') {
  closePop();
  const seq = ++reader.seq;
  Object.assign(reader, { id: '', url, inLibrary: false, saved: false });
  $('#reader').hidden = false;
  $('#readerTitle').textContent = title || url;
  $('#readerLoading').hidden = false;
  $('#readerLoading .spinner').hidden = false;
  $('#readerLoadingText').textContent = '正在提取正文排版…（通常几秒，公众号文章稍慢）';
  $('#readerToc').hidden = true;
  $('#readerSave').disabled = true;
  $('#readerSave').textContent = '收入资料库';
  const frame = $('#readerFrame');
  frame.onload = null;
  frame.src = 'about:blank';
  try {
    const r = await api('/api/peek', { method: 'POST', body: { url, titleHint: title } });
    if (seq !== reader.seq) return;
    reader.id = r.article.id;
    reader.url = r.article.finalUrl || r.article.url || url;
    reader.inLibrary = r.inLibrary;
    $('#readerTitle').textContent = r.article.title || title || url;
    $('#readerSave').disabled = false;
    $('#readerSave').textContent = r.inLibrary ? '已在资料库 · 去打开' : '收入资料库';
    frame.onload = () => {
      if (seq !== reader.seq || frame.src === 'about:blank') return;
      $('#readerLoading').hidden = true;
      const box = $('#readerToc');
      box._count = bindFrameOutline(frame, box, { onClose: () => setReaderOutline(false) });
      setReaderOutline(state.outlineOpen);
    };
    frame.src = `/api/peek/${reader.id}/preview?${previewQuery()}`;
  } catch (e) {
    if (seq !== reader.seq) return;
    $('#readerLoading .spinner').hidden = true;
    $('#readerLoadingText').textContent = `提取失败：${e.message}。可点右上「网页原样」直接看原网页。`;
  }
}

function setReaderOutline(open) {
  const box = $('#readerToc');
  box.hidden = !(open && (box._count || 0) > 0);
  $('#readerOutline').classList.toggle('on', !box.hidden);
}

function closeReader() {
  reader.seq++;
  $('#reader').hidden = true;
  $('#readerFrame').src = 'about:blank';
}

async function saveReader() {
  if (!reader.id) return;
  if (reader.inLibrary || reader.saved) {
    const id = reader.id;
    closeReader();
    switchView('convert');
    return openArticle(id);
  }
  try {
    $('#readerSave').disabled = true;
    await api(`/api/peek/${reader.id}/save`, { method: 'POST' });
    reader.saved = true;
    $('#readerSave').textContent = '已收入 · 去打开';
    toast('已收入资料库', 'ok');
    loadLibrary();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#readerSave').disabled = false;
  }
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
  applyDocOutline();

  if (!a) return;
  if (tab === 'preview') {
    $('#docOutline')._count = 0;
    applyDocOutline();
    frame.onload = onPreviewLoad;
    frame.src = `/api/articles/${a.id}/preview?${previewQuery()}`;
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

/** 相关文章：来源 / 时间 / 排序可选，选择记在 localStorage */
let relSeq = 0;
async function loadRelated(id) {
  const box = $('#relResults');
  const opts = {
    query: $('#relQuery').value.trim(),
    sources: $('#relSource').value,
    timeRange: $('#relTime').value,
    sortBy: $('#relSort').value,
  };
  try {
    localStorage.setItem('af.related', JSON.stringify({ sources: opts.sources, timeRange: opts.timeRange, sortBy: opts.sortBy }));
  } catch {}
  const seq = ++relSeq;
  const slow = opts.sources !== 'web';
  box.innerHTML = `<div class="skeleton">正在检索相关文章…${slow ? '（多源检索，约 5～20 秒）' : ''}</div>`;
  try {
    const { groups } = await api(`/api/articles/${id}/related`, { method: 'POST', body: opts });
    if (seq !== relSeq || state.current?.id !== id) return;
    if (!groups.length) {
      box.innerHTML = '<div class="skeleton">这篇没有提取到可用的检索词，在上面输入检索词试试</div>';
      return;
    }
    box.innerHTML = groups
      .map(
        (g) => `<div class="rel-group">
        <div class="rel-q">检索词 · ${esc(g.query)}${g.results?.length ? ` · ${g.results.length} 条` : ''}</div>
        ${g.notes?.length ? `<div class="rel-note">${esc(g.notes.slice(0, 2).join('；'))}</div>` : ''}
        ${(g.results || []).map(resultRow).join('') || `<div class="skeleton">${esc(g.error ? `检索失败：${g.error}` : '没有找到结果，可换来源或放宽时间')}</div>`}
      </div>`
      )
      .join('');
  } catch (e) {
    if (seq === relSeq) box.innerHTML = `<div class="skeleton">检索失败：${esc(e.message)}</div>`;
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
      $('#exportProgress').innerHTML = '<div class="p-step done">导出完成</div>';
      const links = res.files
        .map(
          (f) => `<a class="btn sm" href="${f.url}" download>${f.name} · ${fmtSize(f.size)}</a>`
        )
        .join('');
      $('#exportProgress').insertAdjacentHTML('beforeend', `<div class="result-links">${links}</div>
        <div class="hint" style="margin-top:8px">文件目录：${esc(res.dir)}</div>`);
      toast('导出完成', 'ok');
    } catch (e) {
      $('#exportProgress').innerHTML = `<div class="p-step err">${esc(e.message)}</div>`;
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
    <p class="sub">${esc(a.title)} · ${Number(a.words || 0).toLocaleString('en-US')} 字 · 整理结果会先预览，确认后再写入</p>

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
            `<div class="p-step done">已整理：${data.organized.points?.length || 0} 个知识点、${data.organized.concepts?.length || 0} 个概念</div>`
          );
        } else if (ev === 'error') {
          prog.insertAdjacentHTML('beforeend', `<div class="p-step err">${esc(data.message)}</div>`);
        }
      });
    } catch (e) {
      prog.insertAdjacentHTML('beforeend', `<div class="p-step err">${esc(e.message)}</div>`);
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
              <span class="dir-ico">${IC.folder}</span>
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

      ${organized.warnings?.length ? `<div class="pv-warn">${organized.warnings.map((w) => esc(w)).join('<br>')}</div>` : ''}

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
                  <span class="dir-name" title="${esc(f)}.md">${esc(f)}</span>
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

/*
 * 对话对象：在知识库页看笔记时，AI 侧栏就对着这篇笔记聊；其它时候对着转换页打开的文章。
 * 两边的对话记录分开保存。
 */
function chatTarget() {
  if (state.view === 'knowledge' && kbBrowser.note) {
    return { kind: 'kb', key: `kb:${kbBrowser.note.path}`, path: kbBrowser.note.path, name: kbBrowser.note.name };
  }
  if (state.current) return { kind: 'article', key: state.current.id, id: state.current.id, name: state.current.title };
  return null;
}

let chatLoadedKey = '';

/** 视图 / 笔记 / 文章变了就把 AI 侧栏切到对应的对话 */
async function syncChatTarget() {
  const t = chatTarget();
  const key = t?.key || '';
  if (key === chatLoadedKey) return;
  chatLoadedKey = key;
  clearSelection();
  if (!t) {
    state.chat = [];
    renderChat();
    return;
  }
  if (t.kind === 'kb') {
    $('#aiHint').textContent = `笔记：${t.name}`;
    try {
      const { messages } = await api(`/api/ai/chat-kb?path=${encodeURIComponent(t.path)}`);
      if (chatLoadedKey !== key) return;
      state.chat = messages.map((m) => ({ role: m.role, content: m.content, selection: m.selection }));
    } catch {
      state.chat = [];
    }
    renderChat();
  } else {
    const a = state.current;
    $('#aiHint').textContent = a.source === 'upload' ? '本地文档' : a.account || '已就绪';
    await loadChat(t.id);
  }
}

async function loadChat(articleId) {
  chatLoadedKey = articleId;
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
    const t = chatTarget();
    box.innerHTML = `<div class="msg assistant">
      <div class="who">阅读助手</div>
      <div class="bubble"><p>${t ? `当前${t.kind === 'kb' ? '笔记' : '文章'}：${t.name ? `「${esc(t.name)}」` : ''}` : '打开一篇文章或知识库笔记后，可在此提问'}</p>
      <ul><li>选中正文文字，可添加到对话或直接提问，右键菜单同样可用</li>
      <li>可询问文中的命令、原理与细节</li>
      <li>可将要点整理后写入知识库</li></ul></div></div>`;
    return;
  }
  box.innerHTML = state.chat
    .map((m) => {
      if (m.role === 'user') {
        return `<div class="msg user">${
          m.selection ? `<div class="cite" title="${esc(m.selection.slice(0, 500))}">引用：${esc(m.selection.slice(0, 60))}${m.selection.length > 60 ? '…' : ''}</div>` : ''
        }<div class="bubble">${esc(m.content)}</div></div>`;
      }
      return `<div class="msg assistant"><div class="who">阅读助手</div><div class="bubble">${mdLite(m.content)}</div></div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMessage(text, selection = '') {
  if (state.streaming) return;
  const target = chatTarget();
  if (!target) return toast('请先打开文章或知识库笔记', 'err');
  const q = (text || '').trim();
  if (!q && !selection) return;

  state.streaming = true;
  $('#sendBtn').disabled = true;
  state.chat.push({ role: 'user', content: q || '（就这段内容提问）', selection });
  renderChat();
  // 引用已经随这条消息发出去了，输入框里的引用块清掉
  clearSelection();

  const bubble = document.createElement('div');
  bubble.className = 'msg assistant';
  bubble.innerHTML = '<div class="who">阅读助手</div><div class="bubble caret"></div>';
  $('#chat').appendChild(bubble);
  const bubbleBody = bubble.querySelector('.bubble');
  $('#chat').scrollTop = $('#chat').scrollHeight;

  let full = '';
  let lastPaint = 0;
  try {
    await sse(
      '/api/ai/chat',
      {
        ...(target.kind === 'kb' ? { kbPath: target.path } : { articleId: target.id }),
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
  } catch (e) {
    bubbleBody.classList.remove('caret');
    bubbleBody.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
    state.chat.pop();
  } finally {
    state.streaming = false;
    $('#sendBtn').disabled = false;
  }
}

/* ---------------- 划词 / 右键：复制粘贴 + 添加到对话 + 在侧边聊天中提问 ---------------- */

// 刚选中、还没决定怎么用的文字（浮条和右键菜单用）
let pendingSel = { text: '', from: '' };

/** 输入框里的引用块：选中的文字显示在输入框上方，发送时一起带上 */
function setSelection(text) {
  state.selection = text || '';
  const box = $('#aiContext');
  if (state.selection) {
    box.hidden = false;
    $('#ctxText').textContent = state.selection;
    const n = state.selection.length;
    $('#ctxLabel').textContent = `引用选中内容 · ${n} 字`;
    $('#composer').placeholder = '针对引用内容提问，Enter 发送';
  } else {
    box.hidden = true;
    $('#composer').placeholder = '提问，Enter 发送';
  }
}

function clearSelection() {
  setSelection('');
  $('#selToolbar').hidden = true;
}

function positionToolbar(x, y) {
  const bar = $('#selToolbar');
  bar.hidden = false;
  const w = bar.offsetWidth || 320;
  const left = Math.min(Math.max(x, w / 2 + 8), window.innerWidth - w / 2 - 8);
  const top = Math.max(y, 54 + bar.offsetHeight);
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

/** 确保右侧 AI 栏是展开的 */
function ensureAiPane() {
  if (state.panels.ai === false) togglePanel('ai');
}

async function copyText(text) {
  if (!text) return;
  try {
    if (window.afNative?.clipWrite) await window.afNative.clipWrite(text);
    else await navigator.clipboard.writeText(text);
    toast('已复制', 'ok', 1200);
  } catch {
    document.execCommand('copy') ? toast('已复制', 'ok', 1200) : toast('复制失败', 'err');
  }
}

/** 添加到对话：追加到输入框的引用块里（可以多次添加，拼在一起） */
function addSelToChat(text) {
  if (!text) return;
  if (!chatTarget()) return toast('请先打开文章或知识库笔记', 'err');
  ensureAiPane();
  const cur = state.selection;
  setSelection(cur && !cur.includes(text) ? `${cur}\n\n${text}` : cur || text);
  $('#composer').focus();
  toast('已添加到对话', 'ok', 1500);
}

/** 在侧边聊天中提问：引用这段 + 预填问题并选中，直接改问题或回车即可 */
function askSelInChat(text) {
  if (!text) return;
  if (!chatTarget()) return toast('请先打开文章或知识库笔记', 'err');
  ensureAiPane();
  setSelection(text);
  const box = $('#composer');
  box.value = '这段内容是什么意思？';
  box.focus();
  box.setSelectionRange(0, box.value.length);
  autoGrow(box);
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'af-preview') return;
  // 划词提问只对资料库里打开的正文生效；应用内阅读（未入库）的选区只给复制
  const fromPreview = e.source === $('#previewFrame').contentWindow;
  const frameEl = fromPreview ? $('#previewFrame') : $('#readerFrame');
  if (d.type === 'selection' && d.text) {
    pendingSel = { text: d.text, from: fromPreview ? 'preview' : 'reader' };
    const frame = frameEl.getBoundingClientRect();
    $('#selToolbar').classList.toggle('copy-only', !fromPreview);
    positionToolbar(frame.left + d.rect.left + d.rect.width / 2, frame.top + d.rect.top - 8);
  } else if (d.type === 'clear') {
    $('#selToolbar').hidden = true;
  } else if (d.type === 'open-url' && d.url) {
    // 正文里的链接直接在本软件里打开，不用切去浏览器
    openWebInApp(d.url);
  } else if (d.type === 'contextmenu') {
    const frame = frameEl.getBoundingClientRect();
    const text = d.text || '';
    const items = [];
    if (text) items.push({ label: '复制', hint: 'Ctrl+C', run: () => copyText(text) });
    items.push({
      label: '全选',
      hint: 'Ctrl+A',
      run: () => {
        try {
          frameEl.contentWindow.focus();
          frameEl.contentDocument.execCommand('selectAll');
        } catch {}
      },
    });
    if (d.link) items.push({ label: '复制链接地址', run: () => copyText(d.link) }, { label: '在本软件里打开链接', run: () => openWebInApp(d.link) });
    if (text && fromPreview) {
      items.push('hr', { label: '添加到对话', run: () => addSelToChat(text) }, { label: '在侧边聊天中提问', run: () => askSelInChat(text) });
    }
    $('#selToolbar').hidden = true;
    showPopAt(frame.left + d.x, frame.top + d.y, items);
  }
});

$('#selToolbar').addEventListener('mousedown', (e) => e.preventDefault()); // 点浮条不丢选区
$('#selToolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const text = pendingSel.text;
  $('#selToolbar').hidden = true;
  if (!text) return;
  if (btn.dataset.act === 'copy') copyText(text);
  else if (btn.dataset.act === 'add') addSelToChat(text);
  else askSelInChat(text);
});

/** 主页面（知识库阅读 / 编辑器）里的划词：在 kbReader 里选中文字就弹浮条 */
function bindKbSelection() {
  const reader = $('#kbReader');
  reader.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? String(sel).replace(/\s+/g, ' ').trim() : '';
      if (!text || text.length < 2 || !sel.rangeCount || !reader.contains(sel.anchorNode)) {
        $('#selToolbar').hidden = true;
        return;
      }
      pendingSel = { text: text.slice(0, 4000), from: 'kb' };
      const r = sel.getRangeAt(0).getBoundingClientRect();
      $('#selToolbar').classList.remove('copy-only');
      positionToolbar(r.left + r.width / 2, r.top - 8);
    }, 10);
  });
  reader.addEventListener('scroll', () => ($('#selToolbar').hidden = true), true);
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#selToolbar') && e.button === 0) $('#selToolbar').hidden = true;
  });
}

/** 全局右键菜单：输入框 / 编辑器给 剪切·复制·粘贴·全选；正文选中文字再加 添加到对话 / 在侧边聊天中提问 */
function editableOf(el) {
  if (!el) return null;
  const inp = el.closest('input, textarea');
  if (inp && !inp.readOnly && !inp.disabled && (inp.tagName === 'TEXTAREA' || /^(text|search|url|email|number|password|tel)$/i.test(inp.type || 'text'))) return inp;
  const ce = el.closest('[contenteditable="true"], [contenteditable=""]');
  return ce || null;
}

function selectedTextIn(el) {
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    return el.value.slice(el.selectionStart || 0, el.selectionEnd || 0);
  }
  const sel = window.getSelection();
  return sel ? String(sel) : '';
}

function runEdit(cmd, target) {
  if (target && document.activeElement !== target) target.focus();
  if (window.afNative?.edit) return window.afNative.edit(cmd);
  // 浏览器模式兜底
  if (cmd === 'paste') {
    navigator.clipboard
      ?.readText()
      .then((t) => t && document.execCommand('insertText', false, t))
      .catch(() => toast('无法读取剪贴板，请使用 Ctrl+V', 'err'));
    return;
  }
  document.execCommand(cmd);
}

function bindContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    // 弹出菜单自己 / 模态框里的普通元素不处理
    if (e.target.closest('#popMenu')) return e.preventDefault();
    const edit = editableOf(e.target);
    const raw = selectedTextIn(edit);
    const text = raw.replace(/\s+/g, ' ').trim();
    const inArticle = Boolean(e.target.closest('#kbReader'));
    const link = e.target.closest('a[href]')?.href || '';
    if (!edit && !text && !link) return; // 空白处不弹菜单
    e.preventDefault();
    const items = [];
    if (edit) {
      items.push(
        { label: '撤销', hint: 'Ctrl+Z', run: () => runEdit('undo', edit) },
        'hr',
        ...(raw ? [{ label: '剪切', hint: 'Ctrl+X', run: () => runEdit('cut', edit) }] : []),
        ...(raw ? [{ label: '复制', hint: 'Ctrl+C', run: () => runEdit('copy', edit) }] : []),
        { label: '粘贴', hint: 'Ctrl+V', run: () => runEdit('paste', edit) },
        { label: '全选', hint: 'Ctrl+A', run: () => runEdit('selectAll', edit) }
      );
    } else {
      if (text) items.push({ label: '复制', hint: 'Ctrl+C', run: () => copyText(raw) });
      if (inArticle) items.push({ label: '全选正文', run: () => {
        const body = $('#kbReader .kb-reader-body');
        if (!body) return;
        const r = document.createRange();
        r.selectNodeContents(body);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      } });
    }
    if (link) items.push('hr', { label: '复制链接地址', run: () => copyText(link) }, { label: '在本软件里打开链接', run: () => openWebInApp(link) });
    if (text && inArticle) {
      items.push('hr', { label: '添加到对话', run: () => addSelToChat(text.slice(0, 4000)) }, { label: '在侧边聊天中提问', run: () => askSelInChat(text.slice(0, 4000)) });
    }
    $('#selToolbar').hidden = true;
    showPopAt(e.clientX, e.clientY, items.filter((it, i, arr) => !(it === 'hr' && (i === 0 || arr[i - 1] === 'hr'))));
  });
}

/* ---------------- 检索 ---------------- */

const PROVIDER_LABEL = {
  sogou: '公众号·搜狗',
  'baidu-wx': '公众号·百度',
  'bing-wx': '公众号·Bing',
  wxrss: '公众号·RSS实时',
  baidu: '百度',
  so360: '360',
  bing: 'Bing',
  duckduckgo: 'DDG',
  'sogou-web': '搜狗网页',
  tavily: 'Tavily',
  'bing-news': 'Bing资讯',
};

function providerList(provider) {
  return [...new Set(String(provider || '').split('+').filter(Boolean))]
    .map((x) => PROVIDER_LABEL[x] || x)
    .join(' + ');
}

function resultRow(r) {
  const tag = r.provider === 'sogou' || r.provider === 'baidu-wx' || r.source === '微信公众号' ? '公众号' : r.source || '网页';
  const isWx = tag === '公众号';
  return `<div class="result">
        <div class="r-main">
          <div class="r-title"><a href="${esc(r.url)}" data-read="${esc(r.url)}" data-title="${esc(r.title)}" title="点击在本软件里阅读">${esc(r.title)}</a></div>
          <div class="r-snippet">${esc(r.snippet || '')}</div>
          <div class="r-meta">
            <span class="src-tag ${isWx ? 'wx' : ''}">${esc(tag)}</span>
            ${r.account ? `<span>${esc(r.account)}</span>` : ''}
            ${r.date ? `<span>${esc(r.date)}</span>` : '<span class="muted">日期未标注</span>'}
            ${r.needsResolve ? '<span>链接将在转换时解析</span>' : ''}
          </div>
        </div>
        <div class="r-actions">
          <button class="btn sm" data-viewmenu="${esc(r.url)}" data-title="${esc(r.title)}" title="选择查看方式：本软件阅读 / 本软件网页原样 / 浏览器">查看 ▾</button>
          <button class="btn sm" data-convert="${esc(r.url)}" data-title="${esc(r.title)}">抓取转换</button>
        </div>
      </div>`;
}

function needsVerify(list) {
  return (list || []).some((t) => /验证码|反爬|安全验证/.test(String(t)));
}

async function runSearch(query, { pages, max } = {}) {  return api('/api/search', {
    method: 'POST',
    body: {
      query,
      sources: $('#searchSource').value,
      timeRange: $('#searchTime').value,
      sortBy: $('#searchSort').value,
      pages: pages ?? (Number($('#searchPages').value) || 5),
      max,
    },
  });
}

function renderSearch(res, meta = {}) {
  const box = $('#searchResults');
  const notes = [...(res.errors || []), ...(res.notes || [])];
  const statsEntries = res.stats ? Object.entries(res.stats).filter(([, v]) => v > 0) : [];
  const stats = statsEntries.map(([k, v]) => `${PROVIDER_LABEL[k] || k} ${v}`).join(' · ');
  const usedProviders = statsEntries.length ? statsEntries.map(([k]) => k).join('+') : res.provider;
  const timeLabel = { day: '24 小时', week: '一周', month: '一个月', '3month': '三个月', year: '一年' }[res.timeRange] || '';
  const canMore = (Number(meta.pages) || 0) < 10 && res.count >= 20;
  state.search = { ...res, pages: Number(meta.pages) || 5 };

  box.innerHTML =
    `<div class="search-summary">共 ${res.count} 条 · 来源 ${esc(providerList(usedProviders))}${stats ? `（${esc(stats)}）` : ''}` +
    `${timeLabel ? ` · ${esc(timeLabel)}内` : ''}${res.sortBy === 'time' ? ' · 按时间排序' : ''} · 翻页 ${esc(String(meta.pages || 5))}` +
    `${res.cached ? ' · 缓存' : ''}</div>` +
    (res.timeFallback ? `<div class="search-warn">${esc((res.notes || []).find((n) => n.includes('没有新内容')) || '所选时间范围内没有新内容，展示的是最新结果')}</div>` : '') +
    (res.timeDropped && !res.timeFallback ? `<div class="search-warn">已按发布时间过滤掉 ${res.timeDropped} 条时间范围外的旧文</div>` : '') +
    (res.results.length ? res.results.map(resultRow).join('') : '<div class="skeleton">没有结果</div>') +
    (canMore
      ? `<div style="display:flex;justify-content:center;margin:14px 0">
           <button class="btn sm" id="searchMoreBtn">加载更多页（当前 ${esc(String(meta.pages || 5))} 页 → ${Math.min(10, (Number(meta.pages) || 5) + 2)} 页）</button>
         </div>`
      : '') +
    (notes.length ? `<div class="hint">提示：${esc(notes.join('；'))}</div>` : '') +
    (needsVerify(notes)
      ? `<div class="search-warn" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
           <span>搜狗/百度对当前 IP 弹了验证码，扫码式的只能人工过一次。</span>
           <button class="btn sm" id="verifyBtn">打开浏览器过验证</button>
         </div>`
      : '');

  const verify = $('#verifyBtn');
  if (verify) {
    verify.onclick = async () => {
      verify.disabled = true;
      verify.textContent = '已弹出浏览器，请在里面完成验证…';
      try {
        const r = await api('/api/search/verify', { method: 'POST', body: { query: res.query } });
        toast(r.ok ? `验证通过（拿到 ${r.cookies} 个 Cookie），正在重搜` : '还没检测到通过，稍后再试', r.ok ? 'ok' : 'info', 6000);
        if (r.ok) {
          const again = await runSearch(res.query, { pages: Number(meta.pages) || 5 });
          renderSearch(again, { pages: Number(meta.pages) || 5 });
          return;
        }
      } catch (e) {
        toast(e.message, 'err');
      }
      verify.disabled = false;
      verify.textContent = '打开浏览器过验证';
    };
  }

  const more = $('#searchMoreBtn');
  if (more) {
    more.onclick = async () => {
      const next = Math.min(10, (Number(meta.pages) || 5) + 2);
      more.disabled = true;
      more.textContent = '加载中…';
      try {
        const r = await runSearch(res.query, { pages: next });
        if (!r.results.length) {
          // 翻页失败（常见于被反爬）时保留已有结果，别把屏幕清空
          toast(`翻页没抓到内容：${(r.errors || []).join('；') || '稍后再试'}`, 'err');
          more.disabled = false;
          more.textContent = '加载更多页';
          return;
        }
        renderSearch(r, { pages: next });
      } catch (e) {
        toast(e.message, 'err');
        more.disabled = false;
        more.textContent = '加载更多页';
      }
    };
  }
}

async function doSearch() {
  const query = $('#searchInput').value.trim();
  // 选了时间范围就自动切到按时间，避免新的被埋在相关度后面
  if ($('#searchTime').value && $('#searchSort').value !== 'time') $('#searchSort').value = 'time';
  if (!query) return toast('请输入关键词', 'err');
  const box = $('#searchResults');
  box.dataset.touched = '1';
  box.innerHTML = '<div class="skeleton">搜索中…（多源并行 + 多页翻页，通常 3～10 秒）</div>';
  try {
    const pages = Number($('#searchPages').value) || 5;
    const res = await runSearch(query, { pages, max: Math.min(200, pages * 12) });
    renderSearch(res, { pages });
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
  const TIME_LABEL = { day: '最近 24 小时', week: '最近一周', month: '最近一个月', '3month': '最近三个月', year: '最近一年' };
  const SRC_LABEL = { all: '全网', wechat: '仅公众号', web: '网页', intel: '安全情报' };
  box.innerHTML = watches
    .map((w) => {
      const hits = w.hits || [];
      const fresh = hits.filter((h) => h.isNew).length;
      return `<div class="watch-card" data-wid="${w.id}">
      <div class="watch-top">
        <span class="watch-q">${esc(w.label || w.query)}</span>
        <span class="badge">${esc(SRC_LABEL[w.sources] || (w.wechatOnly ? '仅公众号' : '全网'))}</span>
        <span class="badge">${esc(TIME_LABEL[w.timeRange] || '不限时间')}</span>
        <span class="badge">${esc(String(w.pages || 5))} 页/源</span>
        <span class="badge">每 ${w.intervalMin} 分钟</span>
        ${fresh ? `<span class="badge" style="background:#e8f7ef;color:#16875a">${fresh} 条待看</span>` : ''}
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn sm" data-check="${w.id}">立即检查</button>
          <button class="btn sm ghost" data-remove="${w.id}">删除</button>
        </div>
      </div>
      <div class="watch-meta">
        <span>上次检查：${w.lastRun ? new Date(w.lastRun).toLocaleString('zh-CN') : '未运行'}</span>
        <span>已见 ${(w.seenKeys || w.seen || []).length} 条</span>
        ${w.lastCount ? `<span>本次抓到 ${w.lastCount} 条</span>` : ''}
        ${w.lastFresh ? `<span>新 ${w.lastFresh} 条</span>` : ''}
        ${w.lastBackfill ? `<span style="color:var(--muted)">旧文补录 ${w.lastBackfill}</span>` : ''}
        ${w.lastError ? `<span style="color:var(--amber)">${esc(String(w.lastError).slice(0, 60))}</span>` : ''}
      </div>
      <div class="watch-hits">
        ${hits
          .slice(0, 8)
          .map(
            (h) => `<div class="hit"><i class="dot"></i>
            <a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.title)}</a>
            ${h.publishDate || h.date ? `<span class="when">${esc(h.publishDate || h.date)}</span>` : ''}
            <span class="when">${h.baseline ? '基线' : h.backfill ? '旧文补录' : h.isNew ? '新增' : fmtDate(h.foundAt || h.at)}</span>
            ${typeof h.score === 'number' && h.isNew && !h.baseline ? `<span class="when" title="按关键词、来源、新鲜度加权">评分 ${h.score}</span>` : ''}
            <button class="link-btn" data-convert="${esc(h.url)}" data-title="${esc(h.title)}">转换</button></div>`
          )
          .join('') || '<div class="hint">暂无命中</div>'}
      </div>
    </div>`;
    })
    .join('');
}

/* ---------------- 知识库 ---------------- */

/* ---- 应用内笔记浏览器：直接翻、直接看知识库里的 md ---- */

const kbBrowser = { files: [], filter: '', current: '', expanded: new Set(), note: null, editing: false, loaded: false };

/** 左侧目录收起 / 展开：存到设置里，重启也记得 */
function kbTreeOpen() {
  return state.status?.ui?.kbTree !== false;
}

function applyKbTree() {
  const open = kbTreeOpen();
  $('#kbBrowserBox')?.classList.toggle('no-tree', !open);
  $$('.kb-tree-btn').forEach((b) => {
    b.classList.toggle('on', open);
    b.title = open ? '收起左侧目录' : '展开左侧目录';
  });
}

function toggleKbTree() {
  const open = !kbTreeOpen();
  state.status = state.status || {};
  state.status.ui = { ...(state.status.ui || {}), kbTree: open };
  applyKbTree();
  api('/api/settings', { method: 'POST', body: { ui: { kbTree: open } } }).catch(() => {});
}

async function loadKbBrowser({ keep = false } = {}) {
  const list = $('#kbNoteList');
  applyKbTree();
  try {
    const r = await api('/api/kb/files');
    const prev = kbBrowser.current;
    kbBrowser.files = r.files || [];
    kbBrowser.root = r.root || '';
    // 第一次进来默认展开第一层目录；之后刷新保持用户的展开状态
    if (!kbBrowser.loaded) {
      kbBrowser.expanded = new Set(
        [...new Set(kbBrowser.files.map((f) => (f.dir || '').split('/')[0]))].filter(Boolean)
      );
      kbBrowser.loaded = true;
    }
    $('#kbBrowserHint').textContent = r.root
      ? `${kbBrowser.files.length} 篇 · ${r.root}`
      : '当前知识库是 API 模式（思源 / Notion），暂不支持应用内浏览';
    const stillThere = keep && prev && kbBrowser.files.some((f) => f.path === prev);
    if (stillThere) {
      renderKbNoteList();
      return;
    }
    kbBrowser.current = '';
    renderKbNoteList();
    $('#kbReader').innerHTML = '<div class="skeleton">从左侧选一篇笔记查看</div>';
    $('#kbToc').hidden = true;
    $('.kb-browser').classList.remove('has-toc');
    if (kbBrowser.files.length) openKbNote(kbBrowser.files[0].path);
  } catch (e) {
    list.innerHTML = `<div class="skeleton">${esc(e.message)}</div>`;
  }
}

/** 把平铺文件清单组装成目录树 */
function kbTreeOf(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = String(f.dir || '').split('/').filter(Boolean);
    let node = root;
    let acc = [];
    for (const p of parts) {
      acc.push(p);
      const key = acc.join('/');
      if (!node.dirs.has(key)) node.dirs.set(key, { name: p, dirs: new Map(), files: [] });
      node = node.dirs.get(key);
    }
    node.files.push(f);
  }
  return root;
}

const kbCountAll = (node) => node.files.length + [...node.dirs.values()].reduce((n, d) => n + kbCountAll(d), 0);

/** 目录树渲染：文件夹可展开折叠，筛选时自动全展开并只留命中分支 */
function renderKbNoteList() {
  const q = kbBrowser.filter.trim().toLowerCase();
  let files = kbBrowser.files;
  if (q) files = files.filter((f) => f.name.toLowerCase().includes(q) || (f.dir || '').toLowerCase().includes(q));
  const tree = kbTreeOf(files);
  const filtering = Boolean(q);
  const rows = [];
  const walk = (node, depth) => {
    for (const [key, d] of [...node.dirs.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-CN'))) {
      const open = filtering || kbBrowser.expanded.has(key);
      rows.push(
        `<div class="kb-row dir" data-dir="${esc(key)}" style="padding-left:${8 + depth * 14}px">
          <span class="tw">${open ? '▾' : '▸'}</span>${IC.folder}<span class="dn">${esc(d.name)}</span><i>${kbCountAll(d)}</i>
        </div>`
      );
      if (open) walk(d, depth + 1);
    }
    for (const f of node.files) {
      rows.push(
        `<div class="kb-row file ${kbBrowser.current === f.path ? 'active' : ''}" data-path="${esc(f.path)}" title="${esc(f.path)}" style="padding-left:${8 + depth * 14 + 16}px">
          ${IC.file}<span class="fn">${esc(f.name)}</span><span class="when">${f.mtime ? new Date(f.mtime).toLocaleDateString('zh-CN') : ''}</span>
        </div>`
      );
    }
  };
  walk(tree, 0);
  $('#kbNoteList').innerHTML =
    rows.join('') ||
    `<div class="skeleton">${kbBrowser.files.length ? '没有匹配的笔记' : '知识库里还没有 md 笔记'}</div>`;
}

async function openKbNote(p) {
  // 正在编辑：先把改动存掉再切（和 Obsidian 一样自动保存，不弹窗）
  if (kbBrowser.editing && kbBrowser.current !== p) await kbFlushSave();
  kbExitEditor();
  kbBrowser.current = p;
  renderKbNoteList();
  const reader = $('#kbReader');
  reader.innerHTML = '<div class="skeleton">加载中…</div>';
  $('#kbToc').hidden = true;
  $('.kb-browser').classList.remove('has-toc');
  try {
    const { note } = await api(`/api/kb/note?path=${encodeURIComponent(p)}`);
    kbBrowser.note = note;
    renderKbReader();
    if (state.view === 'knowledge') syncChatTarget();
  } catch (e) {
    reader.innerHTML = `<div class="skeleton">${esc(e.message)}</div>`;
  }
}

const KB_TREE_ICON = '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>';

/* ---------- Obsidian 式编辑：Vditor 即时渲染（边写边渲染），自动保存 ---------- */

const kbEd = { vd: null, dirty: false, timer: 0, saving: null, path: '' };
let vditorLoading = null;

function loadVditor() {
  if (window.Vditor) return Promise.resolve();
  if (vditorLoading) return vditorLoading;
  vditorLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/vditor/dist/index.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/vendor/vditor/dist/index.min.js';
    s.onload = () => resolve();
    s.onerror = () => {
      vditorLoading = null;
      reject(new Error('编辑器加载失败'));
    };
    document.head.appendChild(s);
  });
  return vditorLoading;
}

function kbSetSaveState(text, cls = '') {
  const el = $('#kbSaveState');
  if (!el) return;
  el.textContent = text;
  el.className = `kb-save-state ${cls}`;
}

/** 立即保存（自动保存 / Ctrl+S / 切换笔记 / 离开页面都走这里） */
async function kbFlushSave() {
  clearTimeout(kbEd.timer);
  // 先同步取出内容：之后编辑器就算被销毁（切页面 / 切笔记）也不会丢改动
  if (!kbEd.vd || !kbEd.dirty) {
    if (kbEd.saving) await kbEd.saving;
    return;
  }
  const path = kbEd.path;
  const content = kbEd.vd.getValue();
  kbEd.dirty = false;
  if (kbBrowser.note?.path === path) kbBrowser.note = { ...kbBrowser.note, content };
  if (kbEd.saving) await kbEd.saving.catch(() => {});
  kbSetSaveState('保存中…');
  kbEd.saving = api('/api/kb/note', { method: 'PUT', body: { path, content } })
    .then(({ note: saved }) => {
      if (kbBrowser.note?.path === saved.path) kbBrowser.note = saved;
      const f = kbBrowser.files.find((x) => x.path === saved.path);
      if (f) {
        f.mtime = saved.mtime;
        f.size = saved.size;
      }
      if (!kbEd.dirty) kbSetSaveState('已保存', 'ok');
    })
    .catch((e) => {
      kbEd.dirty = true;
      kbSetSaveState('保存失败', 'err');
      toast(`保存失败：${e.message}`, 'err');
      throw e;
    })
    .finally(() => (kbEd.saving = null));
  return kbEd.saving;
}

function kbExitEditor() {
  clearTimeout(kbEd.timer);
  try {
    kbEd.vd?.destroy();
  } catch {}
  kbEd.vd = null;
  kbEd.dirty = false;
  kbBrowser.editing = false;
  $('#kbReader')?.classList.remove('editing');
}

async function mountKbEditor(note) {
  const box = $('#kbVditor');
  try {
    await loadVditor();
  } catch (e) {
    box.innerHTML = `<div class="skeleton">${esc(e.message)}</div>`;
    return;
  }
  if (!kbBrowser.editing || kbBrowser.note?.path !== note.path || !document.body.contains(box)) return;
  const dir = note.dir || '';
  kbEd.path = note.path;
  kbEd.dirty = false;
  const linkBase = `${location.origin}/kbfile/${dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : ''}`;
  kbEd.vd = new window.Vditor(box, {
    mode: 'ir', // 即时渲染：光标所在处显示 md 标记，其余直接渲染，和 Obsidian 实时预览一致
    lang: 'zh_CN',
    cdn: '/vendor/vditor',
    icon: 'ant',
    value: note.content || '',
    height: '100%',
    cache: { enable: false },
    placeholder: '开始写…（自动保存，Ctrl+S 立即保存）',
    toolbarConfig: { pin: true },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', 'mark', '|',
      'list', 'ordered-list', 'check', 'quote', 'line', '|',
      'code', 'inline-code', 'link', 'table', 'upload', '|',
      'undo', 'redo', '|', 'edit-mode', 'outline',
    ],
    outline: { enable: false, position: 'right' },
    preview: {
      hljs: { enable: true, style: 'github', lineNumber: false },
      math: { engine: 'KaTeX', inlineDigit: true },
      markdown: { autoSpace: false, fixTermTypo: false, mark: true, footnotes: true, toc: true, linkBase },
    },
    link: { isOpen: false },
    upload: {
      url: '/api/kb/asset',
      fieldName: 'file[]',
      extraData: { dir },
      max: 20 * 1024 * 1024,
      // 粘贴 / 拖进编辑器的图片存到笔记同目录，插入相对路径（Obsidian 里也能直接显示）
      format: (files, text) => {
        let r = {};
        try {
          r = JSON.parse(text);
        } catch {}
        const succMap = {};
        (r.saved || []).forEach((p) => {
          const rel = dir && p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
          succMap[rel.split('/').pop()] = encodeURI(rel);
        });
        return JSON.stringify({ msg: r.error || '', code: r.ok ? 0 : 1, data: { errFiles: r.errors || [], succMap } });
      },
    },
    input: () => {
      kbEd.dirty = true;
      kbSetSaveState('未保存', 'warn');
      clearTimeout(kbEd.timer);
      kbEd.timer = setTimeout(() => kbFlushSave().catch(() => {}), 1200);
    },
    keydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        kbFlushSave().catch(() => {});
      }
    },
    after: () => {
      kbSetSaveState('已保存', 'ok');
      kbEd.vd?.focus();
    },
  });
}

/** 阅读 / 编辑两种模式；头部吸顶，往下翻也随时能点「目录」「大纲」「编辑」 */
function renderKbReader() {
  const note = kbBrowser.note;
  const reader = $('#kbReader');
  if (!note) return;
  const editing = kbBrowser.editing;
  reader.classList.toggle('editing', editing);
  const head = `
    <div class="kb-reader-head">
      <button class="btn sm kb-tree-btn" title="收起 / 展开左侧目录">${KB_TREE_ICON}</button>
      <div class="kb-reader-info">
        <div class="kb-reader-title">${esc(note.name)}${editing ? ' <span class="kb-save-state" id="kbSaveState">加载编辑器…</span>' : ''}</div>
        <div class="kb-reader-meta">${esc(note.path)} · ${note.mtime ? new Date(note.mtime).toLocaleString('zh-CN') : ''} · ${fmtSize(note.size)}</div>
      </div>
      <div class="kb-reader-actions">
        ${
          editing
            ? `<button class="btn sm primary" id="kbDoneBtn" title="保存并回到阅读视图">完成</button>`
            : `<button class="btn sm kb-toc-btn" id="kbTocBtn" hidden>大纲</button>
               <button class="btn sm" id="kbEditBtn" title="像 Obsidian 一样边写边渲染（自动保存回原文件）；也可以双击正文进入">编辑</button>
               <button class="btn sm" id="kbOpenExternal" title="选择用哪个软件打开：默认 / Obsidian / VS Code / Typora / 记事本">打开方式 ▾</button>`
        }
      </div>
    </div>`;

  if (editing) {
    reader.innerHTML = `${head}<div class="kb-vditor" id="kbVditor"></div>`;
    $('#kbDoneBtn').onclick = async () => {
      try {
        await kbFlushSave();
      } catch {
        return; // 保存失败就留在编辑器里，别丢内容
      }
      kbExitEditor();
      renderKbNoteList();
      renderKbReader();
    };
    $('#kbToc').hidden = true;
    $('.kb-browser').classList.remove('has-toc');
    mountKbEditor(note);
  } else {
    let md = note.content || '';
    // 去掉 YAML frontmatter；双链渲染成纯文本，嵌入图标注出来
    md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    md = md
      .replace(/!\[\[([^\]]+)\]\]/g, '（附件：$1）')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1');
    // 笔记里的相对路径图片（如 ![](img.png)）按笔记所在目录从知识库取：渲染前就改写 md，避免先发错误请求
    const base = `/kbfile/${note.dir ? note.dir.split('/').map(encodeURIComponent).join('/') + '/' : ''}`;
    const fixSrc = (src) => (/^(https?:|data:|blob:|\/|#)/i.test(src) ? src : base + src.replace(/^\.\//, ''));
    md = md
      .replace(/(!\[[^\]]*\]\()\s*<?([^)\s>]+)>?/g, (m, pre, src) => pre + fixSrc(src))
      .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)/gi, (m, pre, src) => pre + fixSrc(src));
    reader.innerHTML = `${head}<div class="kb-reader-body" title="双击进入编辑">${mdLite(md)}</div>`;
    const enterEdit = () => {
      kbBrowser.editing = true;
      renderKbReader();
    };
    $('#kbEditBtn').onclick = enterEdit;
    reader.querySelector('.kb-reader-body').addEventListener('dblclick', (e) => {
      if (!e.target.closest('a')) enterEdit();
    });
    const openBtn = $('#kbOpenExternal');
    openBtn.onclick = async () => {
      const apps = await openApps();
      showPop(openBtn, [
        { group: '用其它软件打开这篇笔记' },
        ...apps.file.map((a) => ({
          label: a.label,
          run: async () => {
            try {
              await api('/api/kb/note/open', { method: 'POST', body: { path: note.path, app: a.id } });
              toast(`已用${a.label}打开`, 'ok');
            } catch (e) {
              toast(e.message, 'err');
            }
          },
        })),
      ]);
    };
    buildKbToc(reader);
  }
  reader.querySelector('.kb-reader-head .kb-tree-btn').onclick = toggleKbTree;
  applyKbTree();
}

/* 外部文件拖进知识库：拖到某个文件夹上 = 导入到那个文件夹；拖到别处 = 当前笔记所在目录 */
function kbDropDirAt(target) {
  const dirRow = target?.closest?.('#kbNoteList [data-dir]');
  if (dirRow) return dirRow.dataset.dir;
  const fileRow = target?.closest?.('#kbNoteList [data-path]');
  if (fileRow) return kbBrowser.files.find((f) => f.path === fileRow.dataset.path)?.dir || '';
  return kbBrowser.note?.dir || '';
}

async function kbImport(files, dir) {
  files = [...(files || [])];
  if (!files.length) return;
  if (!kbBrowser.root) return toast('当前知识库是 API 模式（思源 / Notion），不支持拖入文件', 'err');
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('dir', dir || '');
  toast(`正在导入 ${files.length} 个文件到「${dir || '根目录'}」…`, 'info');
  try {
    const res = await fetch('/api/kb/import', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '导入失败');
    if (dir) {
      // 展开目标目录（以及它的上级），让新文件马上看得到
      const parts = dir.split('/');
      parts.forEach((_, i) => kbBrowser.expanded.add(parts.slice(0, i + 1).join('/')));
    }
    await loadKbBrowser({ keep: true });
    const firstMd = (data.saved || []).find((p) => /\.md$/i.test(p));
    if (firstMd) openKbNote(firstMd);
    if (data.saved?.length) toast(`已导入 ${data.saved.length} 个文件`, 'ok');
    if (data.errors?.length) toast(data.errors.join('；'), 'err', 6000);
  } catch (e) {
    toast(e.message, 'err', 6000);
  }
}

function bindKbDrop() {
  const box = $('#kbBrowserBox');
  const mask = $('#kbDrop');
  let depth = 0;
  // 拖进编辑器里的图片交给编辑器自己处理（插到光标处），这里不当成导入笔记
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files') && !e.target.closest?.('.vditor');
  const hide = () => {
    depth = 0;
    mask.hidden = true;
    $$('#kbNoteList .drop-target').forEach((x) => x.classList.remove('drop-target'));
  };
  box.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    mask.hidden = false;
  });
  box.addEventListener('dragover', (e) => {
    if (e.target.closest?.('.vditor')) mask.hidden = true;
    if (!hasFiles(e)) return;
    mask.hidden = false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const dir = kbDropDirAt(e.target);
    $('#kbDropDir').textContent = dir || '知识库根目录';
    $$('#kbNoteList .drop-target').forEach((x) => x.classList.remove('drop-target'));
    e.target.closest?.('#kbNoteList [data-dir]')?.classList.add('drop-target');
  });
  box.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) hide();
  });
  box.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const dir = kbDropDirAt(e.target);
    hide();
    kbImport(e.dataTransfer.files, dir);
  });
}

/** 笔记阅读器的标题目录：从渲染好的正文里提 h1-h4，右侧悬浮面板可跳转、随滚动高亮 */
function buildKbToc(reader) {
  const toc = $('#kbToc');
  const tocBtn = $('#kbTocBtn');
  const browser = toc.closest('.kb-browser');
  const heads = [...reader.querySelectorAll('.kb-reader-body h1, .kb-reader-body h2, .kb-reader-body h3, .kb-reader-body h4')].filter((h) =>
    h.textContent.trim()
  );
  const show = (open) => {
    toc.hidden = !open;
    browser.classList.toggle('has-toc', open);
    tocBtn?.classList.toggle('on', open);
    if (open) kbTocSpy();
  };
  if (heads.length < 2) {
    toc.innerHTML = '';
    if (tocBtn) tocBtn.hidden = true;
    show(false);
    return;
  }
  heads.forEach((h, i) => (h.id = `kbh-${i}`));
  toc._lastActive = '';
  renderOutline(
    toc,
    heads.map((h) => ({ id: h.id, level: Number(h.tagName[1]), text: h.textContent.trim().replace(/\s+/g, ' ') })),
    {
      // 头部吸顶会挡住标题：跳转时减去头部高度
      onJump: (id) => {
        const h = document.getElementById(id);
        if (!h) return;
        const headH = reader.querySelector('.kb-reader-head')?.offsetHeight || 0;
        const top = h.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - headH - 8;
        reader.scrollTo({ top, behavior: 'smooth' });
      },
      onClose: () => {
        setDocOutlineOpen(false);
        show(false);
      },
    }
  );
  if (tocBtn) {
    tocBtn.hidden = false;
    tocBtn.textContent = `大纲 ${heads.length}`;
    tocBtn.onclick = () => show(toc.hidden);
  }
  show(state.outlineOpen !== false);
}

/** 滚动跟随：正文滚到哪一节，大纲就高亮到哪一行 */
function kbTocSpy() {
  const reader = $('#kbReader');
  const toc = $('#kbToc');
  if (!toc || toc.hidden) return;
  const heads = $$('.kb-reader-body [id^="kbh-"]', reader);
  if (!heads.length) return;
  const rb = reader.getBoundingClientRect();
  const headH = reader.querySelector('.kb-reader-head')?.offsetHeight || 0;
  let cur = heads[0].id;
  for (const h of heads) {
    if (h.getBoundingClientRect().top - rb.top <= headH + 40) cur = h.id;
    else break;
  }
  setOutlineActive(toc, cur);
}

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
         <p class="desc">${esc(kb.detail || '配置后，整理结果会写入此处并建立链接')}</p>
         <button class="btn sm primary" onclick="switchView('settings')">去设置</button>`;

    const notes = list.notes || [];
    const histRows = (hist.history || []).slice(0, 12);
    $('#vaultNotes').innerHTML = notes.length
      ? notes
          .map(
            (n) => `<div class="note-item">${IC.file}<span class="nm" title="${esc(n.path || '')}">${esc(n.name)}</span>
               <span class="tm">${n.mtime ? new Date(n.mtime).toLocaleDateString('zh-CN') : ''}</span></div>`
          )
          .join('')
      : histRows.length
      ? histRows
          .map(
            (h) => `<div class="note-item">${IC.file}<span class="nm">${esc(h.title)}</span>
               <span class="tm">${new Date(h.at).toLocaleDateString('zh-CN')}</span></div>`
          )
          .join('')
      : `<div class="skeleton">${list.error ? esc(list.error) : '还没有写入记录，转换一篇文章后点「AI 整理并入库」'}</div>`;

    $('#presetCard').innerHTML = `<div class="card-head"><h3>整理格式模板</h3></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${state.presets.map((p) => `<span class="badge" style="background:var(--brand-soft);color:#574fd6">${esc(p.label)}</span>`).join('')}
      </div>
      <p class="hint" style="margin-top:10px">每次整理时可选择模板、详细程度与是否生成概念笔记，并填写格式要求；选择会被记住</p>`;
  } catch (e) {
    $('#vaultNotes').innerHTML = `<div class="skeleton">${esc(e.message)}</div>`;
  }
  loadKbBrowser({ keep: true });
}

/* ---------------- 设置 ---------------- */

function kbFieldsHtml(dest, s) {
  const f = (label, id, value, ph = '') =>
    `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(value || '')}" placeholder="${esc(ph)}"></div>`;

  if (dest === 'obsidian') {
    return `${f('Vault 路径', 'kbObsVault', s.obsidian?.vaultPath, 'D:/Notes/MyVault')}
      ${f('笔记子目录', 'kbObsFolder', s.obsidian?.folder || 'ArticleForge', 'ArticleForge')}
      <label class="mini-check"><input type="checkbox" id="kbObsConcepts" ${s.obsidian?.createConceptNotes !== false ? 'checked' : ''}> 自动创建概念笔记并双链</label>
      <div class="hint">写入 vault 下的子目录，包含 YAML frontmatter、双链与 _索引.md</div>`;
  }
  if (dest === 'logseq') {
    return `${f('Graph 路径', 'kbGraph', s.logseq?.graphPath, 'D:/Notes/logseq')}
      <label class="mini-check"><input type="checkbox" id="kbLogseqConcepts" ${s.logseq?.conceptPages !== false ? 'checked' : ''}> 每个概念建一页</label>
      <div class="hint">写入 graph/pages，正文转为大纲块，页面属性使用 key:: value</div>`;
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
      <div class="hint">点击「保存并测试」后自动获取笔记本列表</div>`;
  }
  if (dest === 'notion') {
    return `${f('Integration Token', 'kbNoToken', s.notion?.token, 'secret_xxx')}
      ${f('数据库 ID', 'kbNoDb', s.notion?.databaseId, '32 位数据库 ID')}
      ${f('标题属性名', 'kbNoTitle', s.notion?.titleProp || 'Name', 'Name')}
      <div class="hint">需先在目标数据库中添加该 Integration（数据库右上角 ··· → 连接）</div>`;
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
      <p class="desc">OpenAI 兼容接口。本地 Ollama 请填写 http://localhost:11434/v1</p>
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
      <p class="desc">AI 整理结果的写入位置</p>
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
      <div class="hint">当前：${kb.configured ? '已配置：' + esc(kb.detail || kb.target || '') : '未配置'}</div>
    </div>

    <div class="card">
      <h3>检索与监控</h3>
      <p class="desc">公众号同时检索搜狗微信与百度（site:mp.weixin.qq.com）；网页并行检索百度、360、Bing，单个来源失败时自动跳过</p>
      <div class="field"><label>默认搜索源（网页侧首选）</label>
        <select id="setProvider">
          <option value="baidu" ${s.search.provider === 'baidu' ? 'selected' : ''}>百度（国内最稳，推荐）</option>
          <option value="bing" ${s.search.provider === 'bing' ? 'selected' : ''}>Bing</option>
          <option value="duckduckgo" ${s.search.provider === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo（多数网络不可达，会被跳过）</option>
          <option value="sogou-web" ${s.search.provider === 'sogou-web' ? 'selected' : ''}>搜狗网页</option>
          <option value="tavily" ${s.search.provider === 'tavily' ? 'selected' : ''}>Tavily</option>
        </select></div>
      <div class="field"><label>Tavily API Key</label><input type="password" id="setTavily" value="${esc(s.search.tavilyKey)}"></div>
      <div class="field-row">
        <div class="field"><label>GitHub Token（可选，情报源加速）</label><input type="password" id="setGithubToken" value="${esc(s.search.githubToken || '')}"></div>
        <div class="field"><label>NVD API Key（可选）</label><input type="password" id="setNvdKey" value="${esc(s.search.nvdApiKey || '')}"></div>
      </div>
      <div class="field"><label>公众号 RSS 订阅（一行一个 feed 地址，如 wechat2rss.xlab.app；配置后公众号监控多一路免验证码的源）</label>
        <textarea id="setWxFeeds" rows="3" placeholder="https://wechat2rss.xlab.app/feed/xxxx.xml">${esc((s.search.weixinFeeds || []).join('\n'))}</textarea></div>
      <div class="field"><label>监控 Webhook（钉钉/飞书/企业微信机器人地址或自定义 JSON 接口，命中新内容立即推送）</label>
        <input type="text" id="setWebhook" value="${esc(s.watch.webhookUrl || '')}" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."></div>
      <div class="field-row">
        <div class="field"><label>钉钉加签密钥（可选）</label><input type="text" id="setWebhookSecret" value="${esc(s.watch.webhookSecret || '')}"></div>
        <div class="field"><label>Telegram Chat ID（用 TG 推送时填）</label><input type="text" id="setTgChat" value="${esc(s.watch.telegramChatId || '')}"></div>
      </div>
      <div class="field"><label>监控日报 Markdown 目录（留空 = 自动写入知识库的「监控」目录，Obsidian 直接能看能编辑）</label>
        <input type="text" id="setWatchMdDir" value="${esc(s.watch.markdownDir || '')}" placeholder="例如 D:\\Notes\\监控"></div>
      <div class="field-row">
        <div class="field"><label>单次结果上限</label><input type="text" id="setMax" value="${esc(s.search.maxResults)}"></div>
        <div class="field"><label>公众号翻页数（1-10）</label><input type="text" id="setWxPages" value="${esc(s.search.wechatPages)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>网页翻页数（1-4）</label><input type="text" id="setWebPages" value="${esc(s.search.webPages)}"></div>
        <div class="field"><label>即时解析真链条数</label><input type="text" id="setResolveLinks" value="${esc(s.search.resolveLinks)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>监控基础间隔（分钟）</label><input type="text" id="setWatchInterval" value="${esc(s.watch.intervalMin)}"></div>
        <div class="field"><label>监控默认翻页数</label><input type="text" id="setWatchPages" value="${esc(s.watch.pages)}"></div>
      </div>
      <button class="btn sm primary" id="saveSettings2">保存</button>
    </div>

    <div class="card">
      <h3>渲染内核</h3>
      <p class="desc">使用本机已安装的 Chrome 或 Edge 渲染页面并生成 PDF</p>
      <div class="field"><label>浏览器路径（留空自动探测）</label><input type="text" id="setBrowser" value="${esc(s.browser.executablePath)}" placeholder="${esc(browser || '未找到')}"></div>
      <label class="mini-check"><input type="checkbox" id="setHeadless" ${s.browser.headless !== false ? 'checked' : ''}> 无头模式</label>
      <div class="hint">当前：${esc(browser || '未找到，请手动指定')}</div>
      <button class="btn sm primary" id="saveSettings3" style="margin-top:12px">保存</button>
    </div>

    <div class="card">
      <h3>个性化背景</h3>
      <p class="desc">上传图片作为应用背景，调整参数即时生效；图片仅保存在本机数据目录</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn sm" id="bgUploadBtn">上传背景图片</button>
        <input type="file" id="bgFile" accept="image/*" hidden>
        <button class="btn sm ghost" id="bgClearBtn">恢复默认</button>
      </div>
      <div class="field-row" style="margin-top:10px">
        <div class="field"><label>遮暗（<span id="bgDimVal"></span>）</label><input type="range" id="bgDim" min="0" max="85" value="${Math.round((Number(s.ui?.dim) || 0.45) * 100)}"></div>
        <div class="field"><label>背景模糊（<span id="bgBlurVal"></span>）</label><input type="range" id="bgBlur" min="0" max="30" value="${Number(s.ui?.blur) || 0}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>面板浓度（<span id="bgPanelVal"></span>，越高字越清楚）</label><input type="range" id="bgPanel" min="20" max="100" value="${Math.round((Number(s.ui?.panel) || 0.66) * 100)}"></div>
        <div class="field"><label>背景饱和度（<span id="bgSatVal"></span>）</label><input type="range" id="bgSat" min="0" max="200" value="${Math.round((Number(s.ui?.saturate) ?? 1) * 100)}"></div>
      </div>
      <div class="field"><label>图片填充方式</label>
        <select id="bgFit">
          <option value="cover" ${s.ui?.fit !== 'contain' && s.ui?.fit !== 'fill' && s.ui?.fit !== 'center' ? 'selected' : ''}>填满裁剪（推荐）</option>
          <option value="contain" ${s.ui?.fit === 'contain' ? 'selected' : ''}>完整显示（不裁剪）</option>
          <option value="fill" ${s.ui?.fit === 'fill' ? 'selected' : ''}>拉伸铺满</option>
          <option value="center" ${s.ui?.fit === 'center' ? 'selected' : ''}>原始大小居中</option>
        </select></div>
      <div class="hint">当前：${s.ui?.background ? '已设置自定义背景' : '默认背景'}；觉得糊就把「背景模糊」调回 0，嫌字看不清就把「面板浓度」调高。</div>
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
        githubToken: $('#setGithubToken')?.value.trim() || '',
        nvdApiKey: $('#setNvdKey')?.value.trim() || '',
        weixinFeeds: ($('#setWxFeeds')?.value || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30),
        maxResults: Number($('#setMax').value) || 40,
        wechatPages: Math.min(10, Math.max(1, Number($('#setWxPages').value) || 5)),
        webPages: Math.min(4, Math.max(1, Number($('#setWebPages').value) || 3)),
        resolveLinks: Math.min(30, Math.max(0, Number($('#setResolveLinks').value) || 8)),
      },
      watch: {
        intervalMin: Number($('#setWatchInterval').value) || 20,
        pages: Number($('#setWatchPages').value) || 5,
        webhookUrl: $('#setWebhook')?.value.trim() || '',
        webhookSecret: $('#setWebhookSecret')?.value.trim() || '',
        telegramChatId: $('#setTgChat')?.value.trim() || '',
        markdownDir: $('#setWatchMdDir')?.value.trim() || '',
      },
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

  // 个性化背景：上传 / 参数滑块（即时预览 + 保存）/ 填充方式 / 恢复默认
  applyBackground(settings.ui);
  const bgUi = () => state.settings?.ui || {};
  const bgLabels = () => {
    $('#bgDimVal').textContent = `${Math.round((Number($('#bgDim').value) / 100) * 100)}%`;
    $('#bgBlurVal').textContent = `${Number($('#bgBlur').value)}px`;
    $('#bgPanelVal').textContent = `${Number($('#bgPanel').value)}%`;
    $('#bgSatVal').textContent = `${Number($('#bgSat').value)}%`;
  };
  bgLabels();
  $('#bgUploadBtn').onclick = () => $('#bgFile').click();
  $('#bgFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await fetch('/api/background', { method: 'POST', body: fd });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || '上传失败');
      state.settings.ui = d.ui;
      applyBackground(d.ui);
      toast('背景已更新', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
    e.target.value = '';
  };
  const bgApplyLive = () => {
    const ui = bgUi();
    ui.dim = Number($('#bgDim').value) / 100;
    ui.blur = Number($('#bgBlur').value);
    ui.panel = Number($('#bgPanel').value) / 100;
    ui.saturate = Number($('#bgSat').value) / 100;
    ui.fit = $('#bgFit').value;
    bgLabels();
    applyBackground(ui);
  };
  $('#bgDim').oninput = $('#bgBlur').oninput = $('#bgPanel').oninput = $('#bgSat').oninput = bgApplyLive;
  $('#bgFit').onchange = bgApplyLive;
  const bgSliderSave = async () => {
    try {
      await api('/api/background/settings', {
        method: 'POST',
        body: { dim: Number($('#bgDim').value) / 100, blur: Number($('#bgBlur').value), panel: Number($('#bgPanel').value) / 100, saturate: Number($('#bgSat').value) / 100, fit: $('#bgFit').value },
      });
    } catch {}
  };
  $('#bgDim').onchange = $('#bgBlur').onchange = $('#bgPanel').onchange = $('#bgSat').onchange = $('#bgFit').onchange = bgSliderSave;
  $('#bgClearBtn').onclick = async () => {
    try {
      const r = await api('/api/background/clear', { method: 'POST', body: {} });
      state.settings.ui = r.ui;
      applyBackground(r.ui);
      toast('已恢复默认背景', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };

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
        ? `<span style="color:var(--green)">${esc(r.message)}</span>`
        : `<span style="color:var(--red)">${esc(r.message)}</span>`;
      toast(r.ok ? r.message : r.message, r.ok ? 'ok' : 'err', 5000);
    } catch (e) {
      msg.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
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

/* ---------------- 待办便签（记自己没完成的事） ---------------- */

async function loadTodos() {
  try {
    const { todos } = await api('/api/todos');
    state.todos = todos || [];
    renderTodos();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/** 没摆放过的便签自动铺格子（坐标相对便签板） */
function todoAutoPos(i, rect) {
  const cols = Math.max(1, Math.floor((rect.width - 16) / 232));
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: 8 + col * 232, y: 8 + row * 178 };
}

/*
 * 便签坐标：vx / vy = 窗口（视口）坐标，摆在哪就一直在哪，跟哪个页面、便签板在哪都无关。
 * 旧数据只有 x / y（相对便签板），首次渲染时换算成 vx / vy 并存回去，之后不再漂移。
 */
let lastBoardRect = null;

function measureBoard() {
  const board = $('#todoBoard');
  const r = board && board.offsetParent ? board.getBoundingClientRect() : null;
  if (r && r.width > 0) lastBoardRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  return r && r.width > 0 ? lastBoardRect : null;
}

const TITLEBAR_H = () => $('#titlebar')?.getBoundingClientRect().height || 0;

/** 整张便签都留在窗口里：左右、下边都不出界，上边不压住标题栏 */
function clampNotePos(p, w = 216, h = 120) {
  const maxX = Math.max(0, window.innerWidth - w - 4);
  const maxY = Math.max(TITLEBAR_H(), window.innerHeight - h - 4);
  return {
    x: Math.min(Math.max(p.x, 4), maxX),
    y: Math.min(Math.max(p.y, TITLEBAR_H() + 2), maxY),
  };
}

const hasNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 便签显示 / 隐藏：隐藏后只在「待办」页显示（在那里统一整理），状态存到设置里，重启也记得 */
function notesHidden() {
  return Boolean(state.status?.ui?.notesHidden);
}

function applyNotesVisibility() {
  const layer = $('#noteFloat');
  const has = (state.todos || []).length > 0;
  const hide = notesHidden() && state.view !== 'todo';
  layer.hidden = !has || hide;
  const btn = $('#tbNotesToggle');
  if (btn) {
    btn.classList.toggle('off', notesHidden());
    btn.title = notesHidden() ? '显示便签（当前已隐藏，仅待办页可见）' : '隐藏便签（待办页仍可见）';
  }
  const t = $('#toggleNotesBtn');
  if (t) t.textContent = notesHidden() ? '显示便签' : '隐藏便签';
}

async function setNotesHidden(v) {
  state.status = state.status || {};
  state.status.ui = { ...(state.status.ui || {}), notesHidden: Boolean(v) };
  applyNotesVisibility();
  toast(v ? '便签已隐藏（待办页仍可查看）' : '便签已显示', 'ok', 1500);
  try {
    await api('/api/settings', { method: 'POST', body: { ui: { notesHidden: Boolean(v) } } });
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderTodos() {
  const board = $('#todoBoard');
  const layer = $('#noteFloat');
  const todos = state.todos || [];
  const undone = todos.filter((t) => !t.done).length;
  const railCnt = $('#todoRailCount');
  railCnt.hidden = !undone;
  railCnt.textContent = undone > 99 ? '99+' : undone;
  $('#clearDoneTodo').style.display = todos.some((t) => t.done) ? '' : 'none';

  if (!todos.length) {
    layer.innerHTML = '';
    applyNotesVisibility();
    board.innerHTML = '<div class="skeleton">还没有便签，在上面输入第一件没完成的事吧</div>';
    return;
  }
  board.innerHTML =
    '<div class="board-hint">便签可拖到窗口任意位置，切换页面后仍然显示<br>右上角的眼睛按钮可隐藏或显示全部便签</div>';
  const measured = measureBoard();
  const rect = measured || lastBoardRect || { left: 90, top: 150, width: 860, height: 520 };
  // 布局顺序：固定在前，未完成在中（新的在前），已完成垫底
  const ordered = [...todos].sort(
    (a, b) => (b.pinned - a.pinned) || (a.done - b.done) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
  const toSave = [];
  let autoI = 0;
  layer.innerHTML = ordered
    .map((t) => {
      let vp;
      if (hasNum(t.vx) && hasNum(t.vy)) {
        vp = { x: t.vx, y: t.vy };
      } else {
        const pos = hasNum(t.x) && hasNum(t.y) ? { x: t.x, y: t.y } : todoAutoPos(autoI++, rect);
        vp = { x: rect.left + pos.x, y: rect.top + pos.y };
        // 只有量到了真实便签板（或便签已固定）才把位置定下来，避免拿估算值存死
        if (measured || t.pinned) {
          t.vx = Math.round(vp.x);
          t.vy = Math.round(vp.y);
          toSave.push(t);
        }
      }
      const c = clampNotePos(vp);
      return `<div class="todo-note c-${esc(t.color || 'amber')} ${t.done ? 'done' : ''} ${t.pinned ? 'pinned' : ''}" data-id="${t.id}" data-vx="${Math.round(vp.x)}" data-vy="${Math.round(vp.y)}" style="left:${Math.round(c.x)}px;top:${Math.round(c.y)}px">
        <div class="todo-head">
          <button class="t-pin" title="${t.pinned ? '取消固定（恢复可拖动）' : '固定位置，防止误拖'}">${t.pinned ? IC.pinOn : IC.pin}</button>
          <span class="t-date">${t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN') : ''}</span>
          <button class="t-del" title="删除">×</button>
        </div>
        <div class="t-text" title="双击编辑内容">${esc(t.text)}</div>
        <div class="todo-foot">
          ${t.done ? '<button class="t-reopen" title="恢复为未完成">恢复</button>' : '<button class="t-done" title="标记为已完成">完成</button>'}
        </div>
      </div>`;
    })
    .join('');
  applyNotesVisibility();
  // 按便签真实宽高再夹一次，保证整张都在窗口里（只影响显示，不改存储，窗口拉大后回到原位）
  layer.querySelectorAll('.todo-note').forEach((el) => {
    const c = clampNotePos({ x: Number(el.dataset.vx), y: Number(el.dataset.vy) }, el.offsetWidth || 216, el.offsetHeight || 120);
    el.style.left = `${Math.round(c.x)}px`;
    el.style.top = `${Math.round(c.y)}px`;
    bindTodoDrag(el, todos.find((x) => x.id === el.dataset.id));
  });
  for (const t of toSave) api(`/api/todos/${t.id}`, { method: 'PATCH', body: { vx: t.vx, vy: t.vy } }).catch(() => {});
}

function bindTodoDrag(el, t) {
  if (!t) return;
  el.addEventListener('mousedown', (e) => {
    if (t.pinned || e.button !== 0 || e.target.closest('button') || e.target.isContentEditable) return;
    e.preventDefault();
    const noteRect = el.getBoundingClientRect();
    const ox = e.clientX - noteRect.left;
    const oy = e.clientY - noteRect.top;
    el.classList.add('dragging');
    el.style.zIndex = 60;
    const move = (ev) => {
      const p = clampNotePos({ x: ev.clientX - ox, y: ev.clientY - oy }, noteRect.width, noteRect.height);
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
    };
    const up = async () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      el.classList.remove('dragging');
      el.style.zIndex = '';
      t.vx = Math.round(parseFloat(el.style.left) || 0);
      t.vy = Math.round(parseFloat(el.style.top) || 0);
      el.dataset.vx = t.vx;
      el.dataset.vy = t.vy;
      try {
        await api(`/api/todos/${t.id}`, { method: 'PATCH', body: { vx: t.vx, vy: t.vy } });
      } catch {}
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  // 双击编辑内容
  const text = el.querySelector('.t-text');
  text.addEventListener('dblclick', () => {
    if (t.done) return;
    text.contentEditable = 'true';
    text.focus();
    const sel = document.getSelection();
    if (sel) sel.selectAllChildren(text);
  });
  text.addEventListener('blur', async () => {
    if (text.contentEditable !== 'true') return;
    text.contentEditable = 'false';
    const v = text.textContent.trim().slice(0, 200);
    if (v && v !== t.text) {
      t.text = v;
      try {
        await api(`/api/todos/${t.id}`, { method: 'PATCH', body: { text: v } });
        toast('便签已更新', 'ok', 1500);
      } catch (e) {
        toast(e.message, 'err');
      }
    } else {
      text.textContent = t.text;
    }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      text.blur();
    }
  });
}

async function addTodo() {
  const input = $('#todoInput');
  const text = input.value.trim();
  if (!text) return toast('请输入便签内容', 'err');
  input.value = '';
  try {
    const { todo } = await api('/api/todos', { method: 'POST', body: { text } });
    state.todos = [todo, ...(state.todos || [])];
    renderTodos();
    toast('便签已添加', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 自定义背景 ---------------- */

function applyBackground(ui) {
  const layer = $('#bgLayer');
  const cfg = ui || state.settings?.ui || {};
  if (cfg.background) {
    layer.hidden = false;
    layer.style.backgroundImage = `url("${cfg.background}")`;
    const fit = cfg.fit || 'cover';
    layer.style.backgroundSize = fit === 'fill' ? '100% 100%' : fit;
    layer.style.backgroundRepeat = 'no-repeat';
    layer.style.backgroundPosition = 'center';
    const blur = Number(cfg.blur) || 0;
    const dim = Number(cfg.dim ?? 0.45) || 0;
    const sat = Number(cfg.saturate ?? 1);
    const parts = [];
    if (blur > 0) parts.push(`blur(${blur}px)`);
    if (dim > 0) parts.push(`brightness(${(1 - Math.min(0.85, dim)).toFixed(2)})`);
    if (Number.isFinite(sat) && sat !== 1) parts.push(`saturate(${sat})`);
    layer.style.filter = parts.join(' ') || 'none';
    layer.style.transform = blur > 0 ? 'scale(1.06)' : 'none';
    // 面板浓度：半透明面板统一走这个 CSS 变量
    const panel = Number(cfg.panel ?? 0.66);
    document.body.style.setProperty('--panel-a', String(Number.isFinite(panel) ? panel : 0.66));
    document.body.classList.add('has-bg');
  } else {
    layer.hidden = true;
    document.body.classList.remove('has-bg');
  }
}

/* ---------------- 视图切换 ---------------- */

/** 统一算栅格：视图决定资料库栏在不在，收起状态决定两栏显隐（Obsidian 式可收起） */
function applyGrid() {
  const showList = state.view === 'convert' && state.panels.list !== false;
  const showAi = state.panels.ai !== false;
  $('#listPane').style.display = state.view === 'convert' ? (showList ? '' : 'none') : 'none';
  $('#aiPane').style.display = showAi ? '' : 'none';
  const cols = ['66px'];
  if (showList) cols.push('306px');
  cols.push('minmax(0, 1fr)');
  if (showAi) cols.push('372px');
  document.querySelector('.app').style.gridTemplateColumns = cols.join(' ');
  // 顶栏的两个收起按钮：亮色 = 展开中，灰色 = 已收起
  const lt = $('#tbListToggle');
  lt.classList.toggle('on', showList);
  lt.classList.toggle('off', !showList);
  lt.title = state.view !== 'convert' ? '打开资料库栏（回到转换页）' : showList ? '收起左侧资料库栏' : '展开左侧资料库栏';
  const at = $('#tbAiToggle');
  at.classList.toggle('on', showAi);
  at.classList.toggle('off', !showAi);
  at.title = showAi ? '收起右侧 AI 栏' : '展开右侧 AI 栏';
}

function togglePanel(which) {
  state.panels[which] = state.panels[which] === false;
  try {
    localStorage.setItem('afPanels', JSON.stringify(state.panels));
  } catch {}
  applyGrid();
}

function switchView(view) {
  // 离开知识库时正在编辑：自动保存并退回阅读视图
  if (kbBrowser.editing && view !== 'knowledge') {
    kbFlushSave().catch(() => {});
    kbExitEditor();
    renderKbReader();
  }
  state.view = view;
  $('#selToolbar').hidden = true;
  closePop();
  if (!$('#reader').hidden) closeReader();
  $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#tbTodo').classList.toggle('active', view === 'todo');
  $$('.main > .view').forEach((v) => (v.hidden = true));
  const map = { convert: '#viewConvert', search: '#viewSearch', todo: '#viewTodo', watch: '#viewWatch', knowledge: '#viewKnowledge', settings: '#viewSettings' };
  $(map[view]).hidden = false;
  $('#viewTabs').hidden = !(view === 'convert' && state.current);
  applyGrid();
  applyNotesVisibility();

  // 顶部标题栏跟随视图
  const titles = { search: '全网检索', todo: '待办便签', watch: '内容监控', knowledge: '知识库', settings: '设置' };
  $('#topbarActions').style.display = view === 'convert' ? '' : 'none';
  $('#docTitle').textContent = view === 'convert' ? state.current?.title || '未选择文章' : titles[view];

  if (view === 'search' && !$('#searchResults').dataset.touched) {
    $('#searchResults').innerHTML =
      '<div class="empty-hint">输入关键词后按回车检索<div class="hint-chips"><button data-q="内存取证 教程">内存取证 教程</button><button data-q="Volatility 命令">Volatility 命令</button><button data-q="CTF 逆向 入门">CTF 逆向 入门</button></div></div>';
    $$('#searchResults .hint-chips button').forEach((b) => {
      b.onclick = () => {
        $('#searchInput').value = b.dataset.q;
        doSearch();
      };
    });
  }
  if (view === 'todo') loadTodos();
  if (view === 'watch') loadWatches();
  if (view === 'knowledge') loadKb();
  if (view === 'settings') loadSettings();
  if (view === 'convert' && state.current) setTab(state.tab);
  syncChatTarget();
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

  $('#tagFilterBar').onclick = (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    state.tagFilter = state.tagFilter === b.dataset.tag ? '' : b.dataset.tag;
    renderLibrary();
  };

  $('#todoBadge').onclick = () => {
    state.tagFilter = state.tagFilter === '未完成' ? '' : '未完成';
    renderLibrary();
  };

  $('#articleList').onclick = async (e) => {
    const tagEdit = e.target.closest('[data-tagedit]');
    if (tagEdit) {
      e.stopPropagation();
      openTagEditor(tagEdit.dataset.tagedit);
      return;
    }
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
          sources: $('#watchSource')?.value || 'all',
          wechatOnly: ($('#watchSource')?.value || 'all') === 'wechat',
          timeRange: $('#watchTime').value,
          pages: Number($('#watchPages').value) || 5,
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
        const msg = r.firstRun
          ? `已建立基线（${r.baseline} 条，之后只推新内容）`
          : r.fresh
          ? `发现 ${r.fresh} 条新内容${r.backfill ? `，另有 ${r.backfill} 条旧文补录` : ''}`
          : `暂无新内容（本次抓到 ${r.total ?? 0} 条）`;
        toast(msg, r.fresh ? 'ok' : 'info');
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

  $('#addTodoBtn').onclick = addTodo;
  $('#todoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
  });
  $('#noteFloat').addEventListener('click', async (e) => {
    const note = e.target.closest('.todo-note');
    if (!note) return;
    const t = (state.todos || []).find((x) => x.id === note.dataset.id);
    if (!t) return;
    if (e.target.closest('.t-pin')) {
      t.pinned = !t.pinned;
      // 固定时把当前看到的位置一起存下：之后无论切到哪个页面、重启软件都在这里
      const body = { pinned: t.pinned };
      if (t.pinned) {
        t.vx = body.vx = Math.round(parseFloat(note.style.left) || 0);
        t.vy = body.vy = Math.round(parseFloat(note.style.top) || 0);
      }
      try {
        await api(`/api/todos/${t.id}`, { method: 'PATCH', body });
        renderTodos();
      } catch (err) {
        toast(err.message, 'err');
      }
    } else if (e.target.closest('.t-del')) {
      if (!confirm('删除这条便签？')) return;
      try {
        await api(`/api/todos/${t.id}`, { method: 'DELETE' });
        state.todos = state.todos.filter((x) => x.id !== t.id);
        renderTodos();
      } catch (err) {
        toast(err.message, 'err');
      }
    } else if (e.target.closest('.t-done') || e.target.closest('.t-reopen')) {
      t.done = !t.done;
      try {
        await api(`/api/todos/${t.id}`, { method: 'PATCH', body: { done: t.done } });
        renderTodos();
        if (t.done) toast('已标记为完成', 'ok', 1600);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });
  $('#clearDoneTodo').onclick = async () => {
    const done = (state.todos || []).filter((t) => t.done);
    if (!done.length) return;
    if (!confirm(`清空 ${done.length} 条已完成的便签？`)) return;
    await Promise.allSettled(done.map((t) => api(`/api/todos/${t.id}`, { method: 'DELETE' })));
    loadTodos();
  };

  // 窗口变了大小，把便签重新锚定回可见范围
  window.addEventListener('resize', () => {
    if ((state.todos || []).length) renderTodos();
  });

  // 顶栏：两侧面板收起 / 展开、待办、菜单
  $('#tbListToggle').onclick = () => {
    if (state.view !== 'convert') {
      // 其它页面没有资料库栏：点它就回到转换页并展开
      state.panels.list = true;
      try {
        localStorage.setItem('afPanels', JSON.stringify(state.panels));
      } catch {}
      return switchView('convert');
    }
    togglePanel('list');
  };
  $('#tbAiToggle').onclick = () => togglePanel('ai');
  $('#tbTodo').onclick = () => switchView('todo');
  $('#tbNotesToggle').onclick = () => setNotesHidden(!notesHidden());
  $('#toggleNotesBtn').onclick = () => setNotesHidden(!notesHidden());
  if (window.afNative) {
    document.body.classList.add('desktop');
    $('#tbMenu').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      window.afNative.popupMenu(r.left, r.bottom + 2);
    };
  } else {
    $('#tbMenu').hidden = true;
  }
  $('#titlebar').addEventListener('dblclick', (e) => e.preventDefault());

  // 排版预览的标题大纲开关
  $('#outlineToggle').onclick = () => setDocOutlineOpen(!state.outlineOpen);

  // 相关文章：来源 / 时间 / 排序，改了立即重搜
  try {
    const rel = JSON.parse(localStorage.getItem('af.related') || 'null');
    if (rel) {
      if (rel.sources) $('#relSource').value = rel.sources;
      if (rel.timeRange != null) $('#relTime').value = rel.timeRange;
      if (rel.sortBy) $('#relSort').value = rel.sortBy;
    }
  } catch {}
  const relGo = () => state.current && loadRelated(state.current.id);
  $('#relGo').onclick = relGo;
  $('#relQuery').addEventListener('keydown', (e) => e.key === 'Enter' && relGo());
  ['#relSource', '#relTime', '#relSort'].forEach((s) => ($(s).onchange = relGo));
  // 选了时间范围就切到按时间排，避免新文被相关度埋掉
  $('#relTime').addEventListener('change', () => {
    if ($('#relTime').value) $('#relSort').value = 'time';
  });

  // 检索结果 / 相关文章：点标题 = 本软件内阅读；「查看 ▾」= 选择查看方式
  document.addEventListener('click', (e) => {
    const read = e.target.closest('[data-read]');
    if (read) {
      e.preventDefault();
      return openReader(read.dataset.read, read.dataset.title || '');
    }
    const vm = e.target.closest('[data-viewmenu]');
    if (vm) {
      e.stopPropagation();
      return showViewMenu(vm, vm.dataset.viewmenu, vm.dataset.title || '');
    }
    if (!e.target.closest('#popMenu')) closePop();
  });
  window.addEventListener('blur', closePop);

  // 应用内阅读
  $('#readerClose').onclick = closeReader;
  $('#readerSave').onclick = saveReader;
  $('#readerWeb').onclick = () => reader.url && openWebInApp(reader.url);
  $('#readerBrowser').onclick = async (e) => {
    const btn = e.currentTarget;
    e.stopPropagation();
    if (reader.url) showPop(btn, await browserItems(reader.url));
  };
  $('#readerOutline').onclick = () => {
    const open = $('#readerToc').hidden;
    if (open && !($('#readerToc')._count > 0)) return toast('未识别到标题');
    setReaderOutline(open);
  };
  window.afConvertUrl = (url, title = '') => {
    if (!$('#reader').hidden) closeReader();
    switchView('convert');
    $('#urlInput').value = url;
    doFetch(title);
  };

  $('#kbRefreshBtn').onclick = () => loadKbBrowser({ keep: true });
  $('#kbTreeBtn').onclick = toggleKbTree;
  $('#kbImportBtn').onclick = () => $('#kbImportInput').click();
  $('#kbImportInput').onchange = (e) => {
    kbImport(e.target.files, kbBrowser.note?.dir || '');
    e.target.value = '';
  };
  bindKbDrop();
  // 关窗口 / 刷新时还有没存的编辑：用 keepalive 请求兜底写回
  window.addEventListener('beforeunload', () => {
    if (!kbEd.vd || !kbEd.dirty) return;
    try {
      fetch('/api/kb/note', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: kbEd.path, content: kbEd.vd.getValue() }),
      });
    } catch {}
  });
  // 文件拖到别处时别让窗口直接跳去打开它
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  $('#kbNoteFilter').oninput = (e) => {
    kbBrowser.filter = e.target.value;
    renderKbNoteList();
  };
  $('#kbNoteList').onclick = (e) => {
    const dirRow = e.target.closest('[data-dir]');
    if (dirRow) {
      const k = dirRow.dataset.dir;
      if (kbBrowser.expanded.has(k)) kbBrowser.expanded.delete(k);
      else kbBrowser.expanded.add(k);
      renderKbNoteList();
      return;
    }
    const item = e.target.closest('[data-path]');
    if (item) openKbNote(item.dataset.path);
  };
  // 阅读器标题目录：点行跳转，滚正文高亮
  $('#kbReader').addEventListener('scroll', kbTocSpy);
  $('#reloadPreview').onclick = () => setTab('preview');
  $('#organizeBtn').onclick = openOrganizeModal;
  $('#clearChat').onclick = async () => {
    const t = chatTarget();
    if (!t) return;
    await api(t.kind === 'kb' ? `/api/ai/chat-kb?path=${encodeURIComponent(t.path)}` : `/api/ai/chat/${t.id}`, { method: 'DELETE' });
    state.chat = [];
    renderChat();
  };
  // 划词浮条 + 全局右键菜单；弹出菜单按钮不抢焦点，保证剪切/粘贴作用在原来的输入框上
  bindKbSelection();
  bindContextMenu();
  $('#popMenu').addEventListener('mousedown', (e) => e.preventDefault());

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
  $$('#quickAsks button').forEach((b) => (b.onclick = () => sendMessage(b.dataset.q, state.selection)));

  $('#modalMask').onclick = (e) => {
    if (e.target.id === 'modalMask') closeModal();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#popMenu').hidden) return closePop();
      if ($('#modalMask').hidden && !$('#reader').hidden) return closeReader();
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
  es.addEventListener('todos:update', () => {
    loadTodos();
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  bind();
  // 恢复上次的侧栏收起状态
  try {
    const saved = JSON.parse(localStorage.getItem('afPanels') || 'null');
    if (saved && typeof saved === 'object') state.panels = { list: saved.list !== false, ai: saved.ai !== false };
  } catch {}
  applyGrid();
  try {
    const st = await api('/api/status');
    state.status = st;
    state.presets = st.presets || [];
    refreshAiBadge(st.ai);
    applyBackground(st.ui);
    const ver = $('#afVersion');
    if (ver && st.version) ver.textContent = `当前版本 v${st.version}`;
    // 窗口标题直接带版本号，一眼确认运行的不是旧包
    if (st.version) document.title = `ArticleForge v${st.version} · 文章转换与知识沉淀`;
    $('#aiHint').textContent = st.ai.ready ? st.ai.model : 'AI 未配置，去设置';
    if (!st.ai.ready) {
      setTimeout(() => toast('AI 尚未配置。在「设置」中填写 API 地址与密钥后，可使用提问与知识整理', 'info', 7000), 1200);
    }
  } catch (e) {
    toast(e.message, 'err');
  }
  // 便签是全窗口浮层：启动就加载，重启后不用先点「待办」也能看到
  loadTodos();
  await loadLibrary();
  autoGrow($('#composer'));
}

init();
