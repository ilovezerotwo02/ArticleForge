/**
 * 批注：画笔 / 荧光笔 / 橡皮，画在文章正文上（转换页排版预览、知识库阅读视图）
 * - 笔迹是 SVG 路径，坐标相对正文容器，跟着正文一起滚动
 * - 橡皮按笔画擦除：碰到哪一笔就擦掉哪一笔
 * - 每篇文章 / 笔记单独保存，重开、重启后都还在
 * 依赖 app.js 里的 $ / api / toast
 */
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = [
    { c: '#b42318', name: '朱红' },
    { c: '#18181b', name: '墨黑' },
    { c: '#1d4ed8', name: '蓝' },
    { c: '#15803d', name: '绿' },
  ];
  const SIZES = [
    { s: 2, name: '细' },
    { s: 4, name: '中' },
    { s: 7, name: '粗' },
  ];
  const HL = { c: '#facc15', s: 16 };
  const ERASER_R = 10;

  const st = {
    key: '', // 文章 id 或 kb:<路径>
    kind: '', // preview | kb
    host: null, // 正文容器（笔迹相对它定位）
    doc: null, // host 所在 document（预览在 iframe 里）
    container: null, // 用来摆放工具条的可视区域
    svg: null,
    strokes: [],
    mode: null, // null | pen | hl | eraser
    color: COLORS[0].c,
    size: SIZES[0].s,
    drawing: null,
    dirty: false,
    timer: 0,
    undo: [], // 撤销栈：每一步保存当时的 strokes 快照
    cache: new Map(),
    cleanup: [],
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
    const body = { key: st.key, w: Math.round(st.host?.clientWidth || 0), strokes: st.strokes };
    st.cache.set(st.key, { w: body.w, strokes: st.strokes.slice() });
    api('/api/annotations', { method: 'PUT', body }).catch((e) => toast(`批注保存失败：${e.message}`, 'err'));
  }

  /* ---------- 绘制 ---------- */

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

  function makePath(stroke) {
    const el = st.doc.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', pathD(stroke.p));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', stroke.c);
    el.setAttribute('stroke-width', stroke.s);
    el.setAttribute('stroke-linecap', stroke.h ? 'butt' : 'round');
    el.setAttribute('stroke-linejoin', 'round');
    if (stroke.h) {
      el.setAttribute('stroke-opacity', '0.38');
      el.style.mixBlendMode = 'multiply';
    }
    return el;
  }

  function render() {
    if (!st.svg) return;
    st.svg.replaceChildren(...st.strokes.map(makePath));
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

  function hits(stroke, pt) {
    const r = ERASER_R + stroke.s / 2;
    const p = stroke.p;
    if (p.length === 1) return Math.hypot(pt[0] - p[0][0], pt[1] - p[0][1]) <= r;
    for (let i = 1; i < p.length; i++) if (distToSeg(pt, p[i - 1], p[i]) <= r) return true;
    return false;
  }

  function pushUndo() {
    st.undo.push(st.strokes.slice());
    if (st.undo.length > 50) st.undo.shift();
  }

  function onDown(e) {
    if (!st.mode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    st.svg.setPointerCapture?.(e.pointerId);
    const pt = pointOf(e);
    if (st.mode === 'eraser') {
      st.drawing = { erasing: true, before: st.strokes.slice(), changed: false };
      eraseAt(pt);
      return;
    }
    const hl = st.mode === 'hl';
    const stroke = { c: hl ? HL.c : st.color, s: hl ? HL.s : st.size, h: hl, p: [pt] };
    st.drawing = { stroke, el: makePath(stroke) };
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
    st.strokes.push(d.stroke);
    scheduleSave();
  }

  function eraseAt(pt) {
    const keep = st.strokes.filter((s) => !hits(s, pt));
    if (keep.length !== st.strokes.length) {
      st.strokes = keep;
      st.drawing.changed = true;
      render();
    }
  }

  /* ---------- 挂载到正文 ---------- */

  function detach() {
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
    // 同一篇重新渲染（如 iframe 重载）也重新挂，先把没存的写掉
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
    const key2 = (e) => onKey(e);
    st.doc.addEventListener('keydown', key2, true);
    st.cleanup.push(() => st.doc?.removeEventListener('keydown', key2, true));

    const data = await load(key);
    if (st.key !== key) return; // 加载期间已切到别的文章
    st.strokes = data.strokes.slice();
    render();
    if (keepMode) setMode(keepMode, { silent: true });
  }

  /* ---------- 模式与工具条 ---------- */

  const CURSOR_ERASER = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='${ERASER_R}' fill='rgba(255,255,255,.6)' stroke='#18181b' stroke-width='1.2'/></svg>`
  )}") 12 12, crosshair`;

  function setMode(mode, { silent = false } = {}) {
    if (st.drawing) onUp();
    st.mode = mode;
    if (st.svg) {
      st.svg.style.pointerEvents = mode ? 'auto' : 'none';
      st.svg.style.cursor = mode === 'eraser' ? CURSOR_ERASER : mode ? 'crosshair' : '';
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
    st.strokes = st.undo.pop();
    render();
    scheduleSave();
  }

  function clearAll() {
    if (!st.strokes.length) return;
    if (!confirm('清除这篇的全部批注？')) return;
    pushUndo();
    st.strokes = [];
    render();
    scheduleSave();
  }

  const ICONS = {
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/></svg>',
    hl: '<svg viewBox="0 0 24 24"><path d="M9 11l-4.5 4.5V19h3.5L12.5 14.5"/><path d="M9 11l6-6 4 4-6 6z"/><path d="M4 21h8"/></svg>',
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
    bar.innerHTML = `
      <button class="ab-tool ${st.mode === 'pen' ? 'on' : ''}" data-mode="pen" title="画笔（P）">${ICONS.pen}<span>画笔</span></button>
      <button class="ab-tool ${st.mode === 'hl' ? 'on' : ''}" data-mode="hl" title="荧光笔（H），按住 Shift 画直线">${ICONS.hl}<span>荧光笔</span></button>
      <button class="ab-tool ${st.mode === 'eraser' ? 'on' : ''}" data-mode="eraser" title="橡皮（E），碰到的笔画整笔擦除">${ICONS.eraser}<span>橡皮</span></button>
      <i class="ab-sep"></i>
      ${COLORS.map((c) => `<button class="ab-color ${st.color === c.c && st.mode === 'pen' ? 'on' : ''}" data-color="${c.c}" title="${c.name}" style="--c:${c.c}"></button>`).join('')}
      <i class="ab-sep"></i>
      ${SIZES.map((z) => `<button class="ab-size ${st.size === z.s && st.mode === 'pen' ? 'on' : ''}" data-size="${z.s}" title="${z.name}"><b style="width:${z.s + 2}px;height:${z.s + 2}px"></b></button>`).join('')}
      <i class="ab-sep"></i>
      <button class="ab-icon" data-act="undo" title="撤销（Ctrl+Z）">${ICONS.undo}</button>
      <button class="ab-icon" data-act="clear" title="清除全部批注">${ICONS.clear}</button>
      <button class="ab-done" data-act="done" title="退出批注（Esc）">完成</button>`;
    bar.hidden = false;
    placeBar();
  }

  function placeBar() {
    const bar = $('#annotBar');
    if (!bar || bar.hidden || !st.container) return;
    // 停靠在正文区域底部居中，不挡标题和顶部按钮
    const r = st.container.getBoundingClientRect();
    const h = bar.offsetHeight || 38;
    const bottom = Math.min(r.bottom, window.innerHeight);
    bar.style.top = `${Math.round(bottom - h - 16)}px`;
    bar.style.left = `${Math.round(Math.min(Math.max(r.left + r.width / 2, bar.offsetWidth / 2 + 8), window.innerWidth - bar.offsetWidth / 2 - 8))}px`;
  }

  function bindBar() {
    const bar = $('#annotBar');
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) setMode(b.dataset.mode);
      else if (b.dataset.color) {
        st.color = b.dataset.color;
        setMode('pen');
      } else if (b.dataset.size) {
        st.size = Number(b.dataset.size);
        setMode('pen');
      } else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'clear') clearAll();
      else if (b.dataset.act === 'done') setMode(null);
    });
    window.addEventListener('resize', placeBar);
    document.addEventListener('keydown', onKey, true);
    // 批注模式下的单键快捷键：P 画笔 / H 荧光笔 / E 橡皮（输入框里不触发）
    const quick = (e) => {
      if (!st.mode || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.closest?.('input, textarea, [contenteditable="true"]'))) return;
      const m = { p: 'pen', h: 'hl', e: 'eraser' }[e.key.toLowerCase()];
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
