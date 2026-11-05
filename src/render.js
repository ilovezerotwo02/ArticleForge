/**
 * 阅读版 HTML —— 预览与 PDF 共用
 * 排版规则：中文正文 16px/1.85、标题层级、代码框（标题栏+语言标签）、表格、引用、图片
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const CSS = `
:root{
  --ink:#18181b; --ink-2:#3f3f46; --ink-3:#71717a; --line:#e4e4e7;
  --bg:#ffffff; --bg-soft:#fafafa; --brand:#b42318; --link:#912018; --code-bg:#fafafa; --code-line:#e4e4e7;
  --sans:"Segoe UI Variable Text","Segoe UI","Noto Sans SC","Microsoft YaHei UI","PingFang SC",sans-serif;
  --serif:"Noto Serif SC","Source Han Serif SC","Songti SC","Noto Sans SC",serif;
  --mono:"Cascadia Mono","JetBrains Mono",Consolas,"SF Mono",Menlo,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink); font-family:var(--sans);
  font-size:16px; line-height:1.85; -webkit-font-smoothing:antialiased;
}
::selection{background:#f3d5d1}
.af-page{max-width:720px;margin:0 auto;padding:48px 32px 80px}
.af-title{font-family:var(--serif);font-size:30px;line-height:1.4;font-weight:600;letter-spacing:0;margin:0 0 12px;color:var(--ink)}
.af-meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;color:var(--ink-3);font-size:13px;margin-bottom:4px}
.af-meta .dot{width:3px;height:3px;border-radius:50%;background:#d4d4d8}
.af-src{color:var(--ink-3);font:12px/1.6 var(--mono);word-break:break-all;margin-bottom:4px}
.af-src a{color:var(--ink-3);text-decoration:none}
.af-src a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.af-stats{font:12px/1.6 var(--mono);color:var(--ink-3);margin:4px 0 32px;padding-bottom:24px;border-bottom:1px solid var(--line)}
.af-stats span+span::before{content:" · "}
.af-toc{border-left:2px solid var(--line);padding:4px 0 4px 16px;margin:0 0 32px}
.af-toc h4{margin:0 0 8px;font-size:13px;color:var(--ink-3);font-weight:500}
.af-toc ol{margin:0;padding-left:0;list-style:none;max-height:36vh;overflow:auto;counter-reset:toc}
.af-toc ol li{counter-increment:toc}
.af-toc ol li::before{content:counter(toc,decimal-leading-zero);font:11px/1 var(--mono);color:#a1a1aa;margin-right:10px}
.af-toc li{font-size:14px;line-height:1.9;color:var(--ink-2)}
.af-toc a{color:inherit;text-decoration:none}
.af-toc a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.af-body{font-size:16px;line-height:1.9;color:var(--ink-2);word-break:break-word}
.af-body p{margin:0 0 1.1em}
.af-body h2,.af-body h3,.af-body h4{font-family:var(--serif);color:var(--ink);font-weight:600;line-height:1.5;position:relative;letter-spacing:0}
.af-body h2{font-size:22px;margin:2.2em 0 .7em}
.af-body h3{font-size:18.5px;margin:1.8em 0 .6em}
.af-body h4{font-size:16.5px;margin:1.5em 0 .5em}
.af-body h2:first-child,.af-body h3:first-child{margin-top:.2em}
.af-body strong{color:var(--ink);font-weight:600}
.af-body a{color:var(--link);text-decoration:underline;text-decoration-color:rgba(145,32,24,.3);text-underline-offset:3px}
.af-body a:hover{text-decoration-color:var(--link)}
.af-body ul,.af-body ol{margin:0 0 1.1em;padding-left:1.5em}
.af-body li{margin:.3em 0}
.af-body li::marker{color:#a1a1aa}
.af-body blockquote{margin:1.4em 0;padding:2px 0 2px 18px;border-left:2px solid #d4d4d8;color:var(--ink-3)}
.af-body blockquote p:last-child{margin-bottom:0}
.af-body code{font-family:var(--mono);font-size:.86em;background:#f4f4f5;border-radius:4px;padding:.12em .36em;color:var(--ink)}
.af-body hr{border:0;border-top:1px solid var(--line);margin:2.4em 0}
.af-body figure{margin:1.8em 0;text-align:center}
.af-body img{max-width:100%;height:auto;border-radius:4px;display:block;margin:0 auto}
.af-body figcaption{font-size:13px;color:var(--ink-3);margin-top:8px;line-height:1.6}
.af-body .af-table{width:100%;border-collapse:collapse;margin:1.6em 0;font-size:14px;display:table;overflow:auto}
.af-body .af-table th,.af-body .af-table td{border-bottom:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}
.af-body .af-table thead th{border-bottom:1px solid #d4d4d8;font-weight:600;color:var(--ink);background:none}

/* —— 代码框 —— */
.af-body pre.code-block{
  position:relative;margin:1.6em 0;padding:0;background:var(--code-bg);
  border:1px solid var(--code-line);border-radius:8px;overflow:hidden;
}
.af-body pre.code-block::before{
  content:attr(data-lang);
  display:block;padding:6px 16px;font:11.5px/1.6 var(--mono);color:var(--ink-3);
  background:#f4f4f5;border-bottom:1px solid var(--code-line);
}
.af-body pre.code-block code{
  display:block;padding:14px 16px;background:transparent;border:0;color:var(--ink);
  font-size:13px;line-height:1.75;white-space:pre;overflow-x:auto;font-family:var(--mono);
}
.af-body .copy-btn{
  position:absolute;right:8px;top:4px;font:12px/1.6 var(--sans);color:var(--ink-3);background:#fff;
  border:1px solid var(--line);border-radius:6px;padding:0 8px;cursor:pointer;
}
.af-body .copy-btn:hover{color:var(--ink);border-color:#d4d4d8}
.af-foot{margin-top:64px;padding-top:16px;border-top:1px solid var(--line);color:#a1a1aa;font:12px/1.6 var(--mono);display:flex;justify-content:space-between;gap:12px}

@media print{
  html,body{background:#fff}
  .af-page{max-width:none;padding:0}
  .af-title{font-size:26px}
  .af-body{font-size:15px;line-height:1.8}
  .af-body h2{break-after:avoid;page-break-after:avoid}
  .af-body h3,.af-body h4{break-after:avoid;page-break-after:avoid}
  .af-body img{break-inside:avoid;page-break-inside:avoid;max-height:21cm;border:1px solid #eee}
  .af-body figure,.af-body blockquote{break-inside:avoid;page-break-inside:avoid}
  .af-body .af-table{font-size:12.5px;break-inside:auto}
  .af-body .af-table thead{display:table-header-group}
  .af-body .af-table tr{break-inside:avoid}
  .af-body pre.code-block{break-inside:avoid;page-break-inside:avoid;border-radius:6px}
  .af-body pre.code-block code{white-space:pre-wrap;word-break:break-all;font-size:11.5px}
  .copy-btn{display:none}
  .af-toc{break-inside:avoid}
  a{color:#18181b !important;text-decoration:none !important}
  .af-src{color:#71717a}
}
`;

/** 自定义背景时的半透明正文：页面透明透出背景，正文是一张半透明纸，保证可读 */
const TRANSLUCENT_CSS = `
html,body{background:transparent !important}
.af-page{background:rgba(255,255,255,var(--af-paper,.82));border-radius:14px;margin:16px auto;box-shadow:0 8px 24px rgba(0,0,0,.08);backdrop-filter:blur(3px)}
.af-body pre.code-block{background:rgba(250,250,250,.86)}
.af-body pre.code-block::before{background:rgba(244,244,245,.86)}
`;

export function renderReadingHtml(article, { mode = 'preview', embed = false, translucent = false } = {}) {
  const isPreview = mode !== 'pdf';
  const { title, account, author, publishedAt, url, html, outline = [], assets = [], words } = article;
  const metaBits = [
    account ? `<span>${esc(account)}</span>` : '',
    author ? `<span>作者 ${esc(author)}</span>` : '',
    publishedAt ? `<span>${esc(publishedAt)}</span>` : '',
  ].filter(Boolean);

  const tocItems = outline.filter((o) => o.level <= 2);
  // 嵌在应用里时由外层的大纲侧栏（Obsidian 式）负责目录，正文里不再重复一个目录框
  const toc =
    !embed && tocItems.length >= 3
      ? `<nav class="af-toc"><h4>目录</h4><ol>${tocItems
          .map((o) => `<li><a href="#${esc(o.id)}">${esc(o.text)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const stats = `<div class="af-stats">
      <span>${Number(words || 0).toLocaleString('en-US')} 字</span>
      ${assets.length ? `<span>${assets.length} 张图</span>` : ''}
      ${outline.length ? `<span>${outline.length} 个标题</span>` : ''}
      ${article.rendered ? '<span>浏览器渲染</span>' : ''}
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
${translucent ? `<style id="af-translucent">${TRANSLUCENT_CSS}</style>` : ''}
</head>
<body>
<main class="af-page">
  <h1 class="af-title">${esc(title)}</h1>
  ${metaBits.length ? `<div class="af-meta">${metaBits.join('<i class="dot"></i>')}</div>` : ''}
  ${url ? `<div class="af-src"><a href="${esc(url)}">${esc(url)}</a></div>` : ''}
  ${stats}
  ${toc}
  <article class="af-body af-content">${html}</article>
  <div class="af-foot"><span>ArticleForge</span><span>${new Date().toLocaleString('zh-CN')}</span></div>
</main>
<script>
(function () {
  var isPreview = ${isPreview ? 'true' : 'false'};

  // 预览页里的外链统一交给外层打开，避免 iframe 被 X-Frame-Options 打成空白
  // （以前这段误放在下面的代码块循环里，有 N 个代码块就会触发 N 次打开）
  if (isPreview) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!/^https?:/i.test(href) && href.indexOf('//') !== 0) return;
      e.preventDefault();
      try {
        parent.postMessage({ source: 'af-preview', type: 'open-url', url: a.href }, '*');
      } catch (err) {}
    });
  }

  // 代码框复制按钮
  document.querySelectorAll('pre.code-block').forEach(function (pre) {
    if (!isPreview) return;
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    pre.appendChild(btn);
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn');
    if (!btn) return;
    var code = btn.closest('pre').querySelector('code');
    var text = code ? code.innerText : '';
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = '复制'; }, 1200);
    }).catch(function () {});
  });

  if (!isPreview) return;

  // 划词 → 通知父窗口（工具栏 / 侧栏提问）
  var lastText = '';
  function post(type, payload) {
    try { parent.postMessage(Object.assign({ source: 'af-preview', type: type }, payload || {}), '*'); } catch (e) {}
  }

  document.addEventListener('mouseup', function () {
    setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? String(sel).replace(/\\s+/g, ' ').trim() : '';
      if (!text || text.length < 2) { post('clear'); lastText = ''; return; }
      if (text === lastText) return;
      lastText = text;
      var rect = { left: 0, top: 0, width: 0 };
      try {
        var r = sel.getRangeAt(0).getBoundingClientRect();
        rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      } catch (e) {}
      post('selection', { text: text.slice(0, 2000), rect: rect });
    }, 10);
  });

  document.addEventListener('mousedown', function (e) {
    // 右键不清掉选区，否则右键菜单里拿不到选中的文字
    if (e.button === 2) return;
    if (!e.target.closest('.copy-btn')) post('clear');
  });

  // 右键：交给外层弹统一菜单（复制 / 全选 / 添加到对话 / 在侧边聊天中提问）
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var sel = window.getSelection();
    var text = sel ? String(sel).replace(/\\s+/g, ' ').trim() : '';
    var a = e.target.closest && e.target.closest('a[href]');
    post('contextmenu', { x: e.clientX, y: e.clientY, text: text.slice(0, 4000), link: a ? a.href : '' });
  });

  // 目录锚点平滑滚动
  document.querySelectorAll('.af-toc a').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = a.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) { ev.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
})();
</script>
</body></html>`;
}
