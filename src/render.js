/**
 * 阅读版 HTML —— 预览与 PDF 共用
 * 排版规则：中文正文 16px/1.85、标题层级、代码框（标题栏+语言标签）、表格、引用、图片
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const CSS = `
:root{
  --ink:#1b1f24; --ink-2:#3d4450; --ink-3:#6b7280; --line:#e6e8ec;
  --bg:#ffffff; --bg-soft:#f7f8fa; --brand:#4f46e5; --code-bg:#f6f8fa; --code-line:#e3e6eb;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink);
  font-family:"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC",-apple-system,"Segoe UI",sans-serif;
  font-size:16px; line-height:1.85; -webkit-font-smoothing:antialiased;
}
.af-page{max-width:760px;margin:0 auto;padding:40px 34px 80px}
.af-title{font-size:30px;line-height:1.35;font-weight:800;letter-spacing:-.3px;margin:0 0 14px}
.af-meta{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;color:var(--ink-3);font-size:13px;margin-bottom:8px}
.af-meta .dot{width:3px;height:3px;border-radius:50%;background:#c9ced6}
.af-src{color:var(--ink-3);font-size:12.5px;word-break:break-all;margin-bottom:22px}
.af-src a{color:#7c8598;text-decoration:none}
.af-stats{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 26px}
.af-stats span{font-size:12px;color:#5b6472;background:var(--bg-soft);border:1px solid var(--line);padding:3px 9px;border-radius:999px}
.af-toc{border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:0 0 32px;background:linear-gradient(180deg,#fbfcfe,#f7f8fa)}
.af-toc h4{margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a93a3;font-weight:600}
.af-toc ol{margin:0;padding-left:2px;list-style:none;max-height:36vh;overflow:auto}
.af-toc ol li{position:relative;padding-left:14px}
.af-toc ol li::before{content:"";position:absolute;left:2px;top:.78em;width:4px;height:4px;border-radius:50%;background:#c3c9d6}
.af-toc li{font-size:13.5px;line-height:1.9;color:var(--ink-2)}
.af-toc a{color:inherit;text-decoration:none}
.af-toc a:hover{color:var(--brand)}
.af-body{font-size:16px;line-height:1.9;color:var(--ink-2);word-break:break-word}
.af-body p{margin:0 0 1.1em}
.af-body h2,.af-body h3,.af-body h4{color:var(--ink);font-weight:750;line-height:1.45;position:relative}
.af-body h2{font-size:23px;margin:2.1em 0 .7em;padding-left:14px}
.af-body h2::before{content:"";position:absolute;left:0;top:.22em;bottom:.22em;width:4px;border-radius:3px;background:linear-gradient(180deg,#6366f1,#8b5cf6)}
.af-body h3{font-size:19px;margin:1.7em 0 .6em}
.af-body h4{font-size:16.5px;margin:1.4em 0 .5em;color:#2b313b}
.af-body h2:first-child,.af-body h3:first-child{margin-top:.2em}
.af-body strong{color:#111827;font-weight:650}
.af-body a{color:#4338ca;text-decoration:none;border-bottom:1px solid #c7d2fe}
.af-body ul,.af-body ol{margin:0 0 1.1em;padding-left:1.5em}
.af-body li{margin:.3em 0}
.af-body blockquote{
  margin:1.4em 0;padding:12px 18px;border-left:3px solid #c7d2fe;background:#f8f9ff;
  color:#4b5563;border-radius:0 8px 8px 0;
}
.af-body blockquote p:last-child{margin-bottom:0}
.af-body code{
  font-family:"JetBrains Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
  font-size:.88em;background:#eef1f5;border:1px solid #e2e6ec;border-radius:4px;padding:.12em .36em;color:#be185d;
}
.af-body hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.af-body figure{margin:1.6em 0;text-align:center}
.af-body img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 1px 3px rgba(16,24,40,.08);display:block;margin:0 auto}
.af-body figcaption{font-size:12.5px;color:#8a93a3;margin-top:8px;line-height:1.6}
.af-body .af-table{width:100%;border-collapse:collapse;margin:1.4em 0;font-size:14px;display:table;overflow:auto}
.af-body .af-table th,.af-body .af-table td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top}
.af-body .af-table thead th{background:#f4f6f9;font-weight:600;color:#374151}

/* —— 代码框 —— */
.af-body pre.code-block{
  position:relative;margin:1.5em 0;padding:0;background:var(--code-bg);
  border:1px solid var(--code-line);border-radius:10px;overflow:hidden;
}
.af-body pre.code-block::before{
  content:attr(data-lang);
  display:block;padding:7px 14px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;
  color:#7a8494;background:#eef1f5;border-bottom:1px solid var(--code-line);
  font-family:"JetBrains Mono",Consolas,monospace;
}
.af-body pre.code-block code{
  display:block;padding:14px 16px;background:transparent;border:0;color:#1f2937;
  font-size:13px;line-height:1.72;white-space:pre;overflow-x:auto;
  font-family:"JetBrains Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
}
.af-body .copy-btn{
  position:absolute;right:10px;top:6px;font-size:11px;color:#6b7280;background:#fff;
  border:1px solid #dfe3ea;border-radius:6px;padding:2px 8px;cursor:pointer;
}
.af-body .copy-btn:hover{color:#111;border-color:#c8cedb}
.af-foot{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);color:#9aa3b2;font-size:12px;display:flex;justify-content:space-between;gap:12px}

@media print{
  html,body{background:#fff}
  .af-page{max-width:none;padding:0}
  .af-title{font-size:26px}
  .af-body{font-size:15px;line-height:1.8}
  .af-body h2{break-after:avoid;page-break-after:avoid}
  .af-body h3,.af-body h4{break-after:avoid;page-break-after:avoid}
  .af-body img{break-inside:avoid;page-break-inside:avoid;max-height:21cm;box-shadow:none;border:1px solid #eee}
  .af-body figure,.af-body blockquote{break-inside:avoid;page-break-inside:avoid}
  .af-body .af-table{font-size:12.5px;break-inside:auto}
  .af-body .af-table thead{display:table-header-group}
  .af-body .af-table tr{break-inside:avoid}
  .af-body pre.code-block{break-inside:avoid;page-break-inside:avoid;border-radius:6px}
  .af-body pre.code-block code{white-space:pre-wrap;word-break:break-all;font-size:11.5px}
  .copy-btn{display:none}
  .af-toc{break-inside:avoid}
  a{color:#1f2937 !important;border-bottom:none !important}
  .af-src{color:#8a93a3}
}
`;

/** 自定义背景时的半透明正文：页面透明透出背景，正文是一张半透明纸，保证可读 */
const TRANSLUCENT_CSS = `
html,body{background:transparent !important}
.af-page{background:rgba(255,255,255,var(--af-paper,.82));border-radius:14px;margin:18px auto;box-shadow:0 6px 28px rgba(16,24,40,.10);backdrop-filter:blur(3px)}
.af-toc{background:rgba(255,255,255,.6) !important}
.af-stats span{background:rgba(255,255,255,.6) !important}
.af-body pre.code-block{background:rgba(246,248,250,.86)}
.af-body pre.code-block::before{background:rgba(238,241,245,.86)}
.af-body blockquote{background:rgba(248,249,255,.75)}
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
      ? `<nav class="af-toc"><h4>目录 · ${tocItems.length} 节</h4><ol>${tocItems
          .map((o) => `<li><a href="#${esc(o.id)}">${esc(o.text)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const stats = `<div class="af-stats">
      <span>${words || 0} 字</span>
      <span>${assets.length} 张图</span>
      <span>${outline.length} 个标题</span>
      ${article.rendered ? '<span>浏览器渲染抓取</span>' : ''}
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
  ${url ? `<div class="af-src">来源：<a href="${esc(url)}">${esc(url)}</a></div>` : ''}
  ${stats}
  ${toc}
  <article class="af-body af-content">${html}</article>
  <div class="af-foot"><span>由 ArticleForge 转换 · ${mode === 'pdf' ? 'PDF' : '阅读预览'}</span><span>${new Date().toLocaleString('zh-CN')}</span></div>
</main>
<script>
(function () {
  var isPreview = ${isPreview ? 'true' : 'false'};

  // 代码框复制按钮
  document.querySelectorAll('pre.code-block').forEach(function (pre) {
    if (!isPreview) return;

  // 预览页里的外链统一交给外层用系统浏览器打开，避免 iframe 被 X-Frame-Options 打成空白
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
    if (!e.target.closest('.copy-btn')) post('clear');
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
