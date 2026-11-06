/**
 * 批注：画笔 / 荧光笔 / 文字 / 橡皮，画在文章正文上（转换页排版预览、知识库阅读视图）
 * - 笔迹和文字是 SVG，坐标相对正文容器，跟着正文一起滚动
 * - 橡皮按对象擦除：碰到哪一笔（哪段文字）就擦掉哪一个
 * - 颜色可选预设或自定义；粗细 / 字号用滑块调
 * - 每篇文章 / 笔记单独保存，重开、重启后都还在
 * 依赖 app.js 里的 $ / $$ / api / toast
 */
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = [
    { c: '#b42318', name: '朱红' },
    { c: '#18181b', name: '墨黑' },
    { c: '#1d4ed8', name: '蓝' },
    { c: '#15803d', name: '绿' },
  ];
  const HL_COLOR = '#facc15';
  const ERASER_R = 10;
  // 每种工具的尺寸范围：画笔 = 线宽，荧光笔 = 笔宽，文字 = 字号
  const RANGE = {
    pen: { min: 1, max: 24, label: '粗细' },
    hl: { min: 8, max: 36, label: '笔宽' },
    text: { min: 12, max: 48, label: '字号' },
  };
  const FONT = '"Segoe UI Variable Text","Segoe UI","Noto Sans SC","Microsoft YaHei UI",sans-serif';

  const st = {
    key: '',
    kind: '',
    host: null,
    doc: null,
    container: null,
    svg: null,
    items: [], // 笔画 {c,s,h,p} 或文字 {t:1,x,y,c,f,text}
    mode: null, // null | pen | hl | text | eraser
    color: COLORS[0].c,
    size: { pen: 3, hl: 16, text: 18 },
    drawing: null,
    editor: null, // 正在输入的文字框
    dirty: false,
    timer: 0,
    undo: [],
    cache: new Map(),
    cleanup: [],
    quick: null,
  };

  /* ---------- 存取 ---------- */

  async function load(key) {
    if (st.cache.has(key)) return st.cache.get(key);
    try {
      const d = await api(`/api/annotations?key=${encodeURIComponent(key)}`);
      const data = { w: d.w || 0, strokes: d.strokes || [] };
      st.cache.set(key, data);
      return data;
    } catch {
      return { w: 0, strokes: [] };
    }
  }

  function scheduleSave() {
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(flush, 500);
  }

  function flush() {
    clearTimeout(st.timer);
    if (!st.dirty || !st.key) return;
    st.dirty = false;
    const body = { key: st.key, w: Math.round(st.host?.clientWidth || 0), strokes: st.items };
    st.cache.set(st.key, { w: body.w, strokes: st.items.slice() });
    api('/api/annotations', { method: 'PUT', body }).catch((e) => toast(`批注保存失败：${e.message}`, 'err'));
  }

  /* ---------- 绘制 ---------- */

  const isText = (it) => it && it.t === 1;

  function pathD(p) {
    if (!p.length) return '';
    if (p.length === 1) return `M${p[0][0]} ${p[0][1]}l0.01 0`;
    let d = `M${p[0][0]} ${p[0][1]}`;
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2;
      const my = (p[i][1] + p[i + 1][1]) / 2;
      d += `Q${p[i][0]} ${p[i][1]} ${mx} ${my}`;
    }
    const last = p[p.length - 1];
    return d + `L${last[0]} ${last[1]}`;
  }

  function makeEl(it, i) {
    if (isText(it)) {
      const el = st.doc.createElementNS(SVG_NS, 'text');
      el.setAttribute('x', it.x);
      el.setAttribute('y', it.y + it.f);
      el.setAttribute('fill', it.c);
      // 应用全局 svg 样式带了描边，文字要显式关掉，否则会发黑发粗
      el.setAttribute('stroke', 'none');
      el.style.stroke = 'none';
      el.setAttribute('font-size', it.f);
      el.setAttribute('data-i', i);
      el.style.fontFamily = FONT;
      el.style.whiteSpace = 'pre';
      String(it.text).split('\n').forEach((line, li) => {
        const ts = st.doc.createElementNS(SVG_NS, 'tspan');
        ts.setAttribute('x', it.x);
        if (li) ts.setAttribute('dy', `${Math.round(it.f * 1.35)}`);
        ts.textContent = line || ' ';
        el.appendChild(ts);
      });
      return el;
    }
    const el = st.doc.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', pathD(it.p));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', it.c);
    el.setAttribute('stroke-width', it.s);
    el.setAttribute('stroke-linecap', it.h ? 'butt' : 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('data-i', i);
    if (it.h) {
      el.setAttribute('stroke-opacity', '0.38');
      el.style.mixBlendMode = 'multiply';
    }
    return el;
  }

  function render() {
    if (!st.svg) return;
    st.svg.replaceChildren(...st.items.map(makeEl));
  }

  function pointOf(e) {
    const r = st.host.getBoundingClientRect();
    return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)];
  }

  function distToSeg(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function hits(it, i, pt) {
    if (isText(it)) {
      // 文字按实际渲染范围判断
      const el = st.svg?.querySelector(`[data-i="${i}"]`);
      if (!el) return false;
      const b = el.getBBox();
      return pt[0] >= b.x - ERASER_R && pt[0] <= b.x + b.width + ERASER_R && pt[1] >= b.y - ERASER_R && pt[1] <= b.y + b.height + ERASER_R;
    }
    const r = ERASER_R + it.s / 2;
    const p = it.p;
    if (p.length === 1) return Math.hypot(pt[0] - p[0][0], pt[1] - p[0][1]) <= r;
    for (let k = 1; k < p.length; k++) if (distToSeg(pt, p[k - 1], p[k]) <= r) return true;
    return false;
  }

  function pushUndo() {
    st.undo.push(st.items.slice());
    if (st.undo.length > 50) st.undo.shift();
  }

  function onDown(e) {
    if (!st.mode || e.button !== 0) return;
    if (st.mode === 'text') return onTextDown(e);
    e.preventDefault();
    e.stopPropagation();
    st.svg.setPointerCapture?.(e.pointerId);
    const pt = pointOf(e);
    if (st.mode === 'eraser') {
      st.drawing = { erasing: true, before: st.items.slice(), changed: false };
      eraseAt(pt);
      return;
    }
    const hl = st.mode === 'hl';
    const stroke = { c: hl ? HL_COLOR : st.color, s: st.size[st.mode], h: hl, p: [pt] };
    st.drawing = { stroke, el: makeEl(stroke, -1) };
    st.svg.appendChild(st.drawing.el);
  }

  function onMove(e) {
    if (!st.drawing) return;
    e.preventDefault();
    const pt = pointOf(e);
    if (st.drawing.erasing) return eraseAt(pt);
    const p = st.drawing.stroke.p;
    const last = p[p.length - 1];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5) return;
    // 荧光笔按住 Shift 拉直线，适合划整行
    if (st.drawing.stroke.h && e.shiftKey) p.splice(1, p.length - 1, [pt[0], p[0][1]]);
    else p.push(pt);
    st.drawing.el.setAttribute('d', pathD(p));
  }

  function onUp() {
    const d = st.drawing;
    st.drawing = null;
    if (!d) return;
    if (d.erasing) {
      if (d.changed) {
        st.undo.push(d.before);
        scheduleSave();
      }
      return;
    }
    pushUndo();
    st.items.push(d.stroke);
    render();
    scheduleSave();
  }

  function eraseAt(pt) {
    const keep = st.items.filter((it, i) => !hits(it, i, pt));
    if (keep.length !== st.items.length) {
      st.items = keep;
      st.drawing.changed = true;
      render();
    }
  }

  /* ---------- 文字工具 ---------- */

  function onTextDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (st.editor) return commitText();
    const hit = e.target.closest?.('text[data-i]');
    if (hit) {
      // 点已有文字：进入编辑，沿用它的颜色和字号
      const i = Number(hit.dataset.i);
      const it = st.items[i];
      if (isText(it)) return openEditor({ x: it.x, y: it.y, c: it.c, f: it.f, text: it.text, index: i });
    }
    const [x, y] = pointOf(e);
    const f = st.size.text;
    openEditor({ x, y: Math.max(0, y - Math.round(f * 0.65)), c: st.color, f, text: '', index: -1 });
  }

  function openEditor(spec) {
    const ta = st.doc.createElement('textarea');
    ta.className = 'af-annot-input';
    ta.value = spec.text;
    ta.rows = 1;
    ta.placeholder = '输入文字';
    Object.assign(ta.style, {
      position: 'absolute', left: `${spec.x - 4}px`, top: `${spec.y - 2}px`, zIndex: '6',
      font: `${spec.f}px/1.35 ${FONT}`, color: spec.c, background: 'rgba(255,255,255,.92)',
      border: '1px dashed #a1a1aa', borderRadius: '4px', padding: '1px 3px', margin: '0',
      outline: 'none', resize: 'none', overflow: 'hidden', minWidth: '120px', whiteSpace: 'pre',
      boxShadow: '0 4px 12px rgba(0,0,0,.08)',
    });
    const fit = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
      ta.style.width = 'auto';
      ta.style.width = `${Math.max(120, ta.scrollWidth + 8)}px`;
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        commitText();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeEditor();
      }
    });
    ta.addEventListener('blur', () => setTimeout(() => st.editor?.ta === ta && commitText(), 0));
    st.host.appendChild(ta);
    st.editor = { ta, spec };
    // 编辑已有文字时先把原文字隐藏
    if (spec.index >= 0) st.svg.querySelector(`[data-i="${spec.index}"]`)?.setAttribute('visibility', 'hidden');
    fit();
    setTimeout(() => ta.focus(), 0);
    renderBar();
  }

  function closeEditor() {
    const ed = st.editor;
    st.editor = null;
    ed?.ta.remove();
    render();
    renderBar();
  }

  function commitText() {
    const ed = st.editor;
    if (!ed) return;
    const text = ed.ta.value.replace(/\s+$/, '');
    const { spec } = ed;
    const item = { t: 1, x: spec.x, y: spec.y, c: spec.c, f: spec.f, text };
    const changed = spec.index < 0 ? Boolean(text) : text !== spec.text || item.c !== st.items[spec.index]?.c || item.f !== st.items[spec.index]?.f;
    if (changed) {
      pushUndo();
      if (spec.index < 0) st.items.push(item);
      else if (text) st.items[spec.index] = item;
      else st.items.splice(spec.index, 1);
      scheduleSave();
    }
    closeEditor();
  }

  /* 文字框打开时改颜色 / 字号，直接作用在正在编辑的文字上 */
  function applyToEditor() {
    const ed = st.editor;
    if (!ed) return;
    ed.spec.c = st.color;
    ed.spec.f = st.size.text;
    ed.ta.style.color = st.color;
    ed.ta.style.fontSize = `${st.size.text}px`;
    ed.ta.dispatchEvent(new Event('input'));
  }

  /* ---------- 挂载到正文 ---------- */

  function detach() {
    if (st.editor) commitText();
    flush();
    st.cleanup.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
    st.cleanup = [];
    st.svg?.remove();
    st.svg = null;
    st.host = null;
    st.doc = null;
    st.key = '';
    st.undo = [];
    setMode(null, { silent: true });
  }

  async function attach({ host, key, kind, container }) {
    if (!host || !key) return detach();
    flush();
    const keepMode = st.key === key ? st.mode : null;
    detach();
    st.key = key;
    st.kind = kind;
    st.host = host;
    st.doc = host.ownerDocument;
    st.container = container;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const svg = st.doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'af-annot');
    Object.assign(svg.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      overflow: 'visible', pointerEvents: 'none', zIndex: '4', touchAction: 'none',
    });
    host.appendChild(svg);
    st.svg = svg;

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    // 正文在 iframe 里时（转换页）才需要单独监听；知识库和工具条同一个 document，重复监听会让一次 Ctrl+Z 撤销两步
    if (st.doc !== document) {
      const doc = st.doc;
      const key2 = (e) => onKey(e);
      doc.addEventListener('keydown', key2, true);
      st.cleanup.push(() => doc.removeEventListener('keydown', key2, true));
    }

    const data = await load(key);
    if (st.key !== key) return;
    st.items = data.strokes.slice();
    render();
    if (keepMode) setMode(keepMode, { silent: true });
  }

  /* ---------- 模式与工具条 ---------- */

  const CURSOR_ERASER = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='${ERASER_R}' fill='rgba(255,255,255,.6)' stroke='#18181b' stroke-width='1.2'/></svg>`
  )}") 12 12, crosshair`;

  function setMode(mode, { silent = false } = {}) {
    if (st.drawing) onUp();
    if (st.editor && mode !== 'text') commitText();
    st.mode = mode;
    if (st.svg) {
      st.svg.style.pointerEvents = mode ? 'auto' : 'none';
      st.svg.style.cursor = mode === 'eraser' ? CURSOR_ERASER : mode === 'text' ? 'text' : mode ? 'crosshair' : '';
    }
    if (st.host) st.host.style.userSelect = mode ? 'none' : '';
    if (mode && st.doc) {
      try {
        st.doc.getSelection()?.removeAllRanges();
      } catch {}
    }
    renderBar();
    $$('[data-annot-toggle]').forEach((b) => b.classList.toggle('on', Boolean(mode)));
    if (!mode) flush();
    if (!silent && mode && !st.host) toast('当前没有可批注的正文', 'err');
  }

  function onKey(e) {
    if (!st.mode) return;
    // 正在输入文字时，按键交给输入框（Esc 由输入框自己处理）
    if (st.editor && e.target === st.editor.ta) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMode(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  }

  function undo() {
    if (!st.undo.length) return;
    st.items = st.undo.pop();
    render();
    scheduleSave();
  }

  function clearAll() {
    if (!st.items.length) return;
    if (!confirm('清除这篇的全部批注？')) return;
    pushUndo();
    st.items = [];
    render();
    scheduleSave();
  }

  const ICONS = {
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/></svg>',
    hl: '<svg viewBox="0 0 24 24"><path d="M9 11l-4.5 4.5V19h3.5L12.5 14.5"/><path d="M9 11l6-6 4 4-6 6z"/><path d="M4 21h8"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L12 18H8z"/><path d="M10 10l5 5"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
  };

  function renderBar() {
    const bar = $('#annotBar');
    if (!bar) return;
    if (!st.mode || !st.host) {
      bar.hidden = true;
      return;
    }
    const m = st.mode;
    const colorable = m === 'pen' || m === 'text';
    const range = RANGE[m];
    const preset = COLORS.some((c) => c.c === st.color);
    const tool = (id, name, key) =>
      `<button class="ab-tool ${m === id ? 'on' : ''}" data-mode="${id}" title="${name}（${key}）">${ICONS[id]}<span>${name}</span></button>`;
    bar.innerHTML = `
      ${tool('pen', '画笔', 'P')}
      ${tool('hl', '荧光笔', 'H')}
      ${tool('text', '文字', 'T')}
      ${tool('eraser', '橡皮', 'E')}
      <i class="ab-sep"></i>
      <div class="ab-group ${colorable ? '' : 'off'}" title="${colorable ? '' : '荧光笔和橡皮不使用颜色'}">
        ${COLORS.map((c) => `<button class="ab-color ${st.color === c.c ? 'on' : ''}" data-color="${c.c}" title="${c.name}" style="--c:${c.c}"></button>`).join('')}
        <label class="ab-custom ${preset ? '' : 'on'}" title="自定义颜色" style="--c:${st.color}"><input type="color" id="abColor" value="${st.color}"></label>
      </div>
      <i class="ab-sep"></i>
      <div class="ab-group ab-range ${range ? '' : 'off'}">
        <span class="ab-label">${range ? range.label : '大小'}</span>
        <input type="range" id="abSize" min="${range?.min || 1}" max="${range?.max || 24}" value="${range ? st.size[m] : 1}" ${range ? '' : 'disabled'}>
        <span class="ab-val" id="abSizeVal">${range ? st.size[m] : ''}</span>
      </div>
      <i class="ab-sep"></i>
      <button class="ab-icon" data-act="undo" title="撤销（Ctrl+Z）">${ICONS.undo}</button>
      <button class="ab-icon" data-act="clear" title="清除全部批注">${ICONS.clear}</button>
      <button class="ab-done" data-act="done" title="退出批注（Esc）">完成</button>`;
    bar.hidden = false;
    $('#abColor').addEventListener('input', (e) => setColor(e.target.value));
    const size = $('#abSize');
    size.addEventListener('input', () => {
      if (!RANGE[st.mode]) return;
      st.size[st.mode] = Number(size.value);
      $('#abSizeVal').textContent = size.value;
      if (st.mode === 'text') applyToEditor();
    });
    placeBar();
  }

  function setColor(c) {
    st.color = c;
    if (st.mode !== 'pen' && st.mode !== 'text') setMode('pen');
    else if (st.mode === 'text') applyToEditor();
    // 只更新选中态，不重画整条（避免取色器被关掉）
    $$('#annotBar .ab-color').forEach((b) => b.classList.toggle('on', b.dataset.color === c));
    const custom = $('#annotBar .ab-custom');
    if (custom) {
      custom.classList.toggle('on', !COLORS.some((x) => x.c === c));
      custom.style.setProperty('--c', c);
    }
  }

  function placeBar() {
    const bar = $('#annotBar');
    if (!bar || bar.hidden || !st.container) return;
    // 停靠在正文区域底部居中，不挡标题和顶部按钮
    const r = st.container.getBoundingClientRect();
    const h = bar.offsetHeight || 40;
    const w = bar.offsetWidth || 600;
    const bottom = Math.min(r.bottom, window.innerHeight);
    bar.style.top = `${Math.round(bottom - h - 16)}px`;
    bar.style.left = `${Math.round(Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), window.innerWidth - w / 2 - 8))}px`;
  }

  function bindBar() {
    const bar = $('#annotBar');
    // 点按钮不抢焦点（文字框保持输入状态）；滑块和取色器需要正常获得焦点
    bar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input')) e.preventDefault();
    });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) setMode(b.dataset.mode);
      else if (b.dataset.color) setColor(b.dataset.color);
      else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'clear') clearAll();
      else if (b.dataset.act === 'done') setMode(null);
    });
    window.addEventListener('resize', placeBar);
    document.addEventListener('keydown', onKey, true);
    // 单键快捷键：P 画笔 / H 荧光笔 / T 文字 / E 橡皮（输入框里不触发）
    const quick = (e) => {
      if (!st.mode || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const m = { p: 'pen', h: 'hl', t: 'text', e: 'eraser' }[e.key.toLowerCase()];
      if (m) {
        e.preventDefault();
        setMode(m);
      }
    };
    document.addEventListener('keydown', quick);
    st.quick = quick;
  }

  /* ---------- 对外接口 ---------- */

  window.Annot = {
    /** 转换页：iframe 加载完后挂到 .af-page 上 */
    attachPreview(frame, articleId) {
      try {
        const host = frame.contentDocument?.querySelector('.af-page');
        if (!host) return detach();
        attach({ host, key: articleId, kind: 'preview', container: frame });
        frame.contentDocument.addEventListener('keydown', (e) => st.quick?.(e));
      } catch {
        detach();
      }
    },
    /** 知识库：挂到阅读视图的正文上 */
    attachKb(body, path, container) {
      attach({ host: body, key: `kb:${path}`, kind: 'kb', container });
    },
    detach,
    toggle(kind) {
      if (!st.host || st.kind !== kind) return toast('当前没有可批注的正文', 'err');
      setMode(st.mode ? null : 'pen');
    },
    exit() {
      if (st.mode) setMode(null);
    },
    get active() {
      return Boolean(st.mode);
    },
  };

  bindBar();
})();
