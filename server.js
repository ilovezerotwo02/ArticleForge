import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC, MEDIA, EXPORTS, DATA, ROOT, settings, saveSettings, findBrowser,
} from './src/config.js';
import {
  listArticles, getArticle, saveArticle, deleteArticle, addSseClient, emit, chatStore, watchStore, todoStore, hashId,
} from './src/store.js';
import { buildArticle } from './src/extract.js';
import { ingestFile } from './src/ingest.js';
import { exportArticle, zipDir, safeName } from './src/export.js';
import { renderReadingHtml } from './src/render.js';
import { searchWeb, buildRelatedQueries, searchHealth, openSogouVerify } from './src/search.js';
import { addWatch, checkWatch, updateWatch, startWatcher } from './src/watch.js';
import {
  aiStatus, streamChat, organizeKnowledge, CHAT_SYSTEM, buildArticleContext, selectionPrompt, FORMAT_PRESETS, aiConfig, restructureHeadings, pickTargetFile,
} from './src/ai.js';
import {
  kbStatus, kbTest, kbWrite, kbList, listHistory, destinations, getAdapter, currentKey,
  listCategories, previewTarget, kbTree, treeText, dirMeta, nodeByPath,
  kbFiles, kbReadNote, kbOpenNote, kbSaveNote, kbImportFiles, kbRootDir,
} from './src/kb/index.js';
import { closeBrowser } from './src/fetchPage.js';
import { listOpenApps, openUrlWith } from './src/openwith.js';

const app = express();
const PORT = Number(process.env.PORT || 5178);
const HERE = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '8mb' }));
app.use(express.static(PUBLIC));
app.use('/media', express.static(MEDIA, { maxAge: '7d' }));
app.use('/vendor/marked', express.static(path.join(PUBLIC, 'vendor/marked')));
app.use('/vendor/katex', express.static(path.join(PUBLIC, 'vendor/katex')));
app.use('/vendor/vditor', express.static(path.join(PUBLIC, 'vendor/vditor'), { maxAge: '7d' }));
app.use('/exports', express.static(EXPORTS, { maxAge: '1h' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 10 } });
const kbUploadAsset = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, e, code = 400) => res.status(code).json({ ok: false, error: e?.message || String(e) });

/* ---------------- 状态 ---------------- */

app.get('/api/status', (req, res) => {
  const s = settings();
  ok(res, {
    browser: findBrowser(),
    ai: aiStatus(),
    kb: kbStatus(),
    counts: { articles: listArticles().length, watches: watchStore.list().length },
    presets: Object.entries(FORMAT_PRESETS).map(([key, v]) => ({ key, ...v })),
    ui: s.ui || {},
    version: '1.1.0',
  });
});

/* ---------------- 待办便签（用户自己记没完成的事） ---------------- */

const TODO_COLORS = ['amber', 'mint', 'sky', 'rose', 'lilac'];

app.get('/api/todos', (req, res) => ok(res, { todos: todoStore.list() }));

app.post('/api/todos', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 200);
  if (!text) return fail(res, new Error('先写点内容'));
  const colors = TODO_COLORS;
  const item = todoStore.add({
    id: hashId(text + Date.now()),
    text,
    done: false,
    pinned: false,
    color: colors[todoStore.list().length % colors.length],
    x: null,
    y: null,
    createdAt: new Date().toISOString(),
  });
  emit('todos:update', {});
  ok(res, { todo: item });
});

app.patch('/api/todos/:id', (req, res) => {
  const patch = {};
  for (const k of ['text', 'done', 'pinned', 'color', 'x', 'y', 'vx', 'vy']) {
    if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  }
  if (patch.text !== undefined) patch.text = String(patch.text).trim().slice(0, 200) || '（空便签）';
  if (patch.color !== undefined && !TODO_COLORS.includes(patch.color)) delete patch.color;
  for (const k of ['x', 'y', 'vx', 'vy']) if (k in patch && patch[k] !== null) patch[k] = Number(patch[k]) || 0;
  const t = todoStore.update(req.params.id, patch);
  if (!t) return fail(res, new Error('便签不存在'), 404);
  ok(res, { todo: t });
});

app.delete('/api/todos/:id', (req, res) => ok(res, { removed: todoStore.remove(req.params.id) }));

/* ---------------- 自定义背景 ---------------- */

const BG_EXTS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };

app.post('/api/background', upload.single('file'), (req, res) => {
  const f = req.file;
  const ext = BG_EXTS[f?.mimetype];
  if (!f || !ext) return fail(res, new Error('请上传 jpg / png / webp / gif / bmp 图片'));
  try {
    for (const e of Object.values(BG_EXTS)) fs.rmSync(path.join(MEDIA, `app-background.${e}`), { force: true });
    const file = path.join(MEDIA, `app-background.${ext}`);
    fs.writeFileSync(file, f.buffer);
    const next = saveSettings({ ui: { background: `/media/app-background.${ext}?t=${Date.now()}` } });
    ok(res, { ui: next.ui });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.post('/api/background/settings', (req, res) => {
  try {
    const patch = {};
    if (req.body?.dim !== undefined) patch.dim = Math.max(0, Math.min(0.85, Number(req.body.dim) || 0));
    if (req.body?.blur !== undefined) patch.blur = Math.max(0, Math.min(30, Number(req.body.blur) || 0));
    if (req.body?.panel !== undefined) patch.panel = Math.max(0.2, Math.min(1, Number(req.body.panel) || 0.66));
    if (req.body?.saturate !== undefined) {
      const n = Number(req.body.saturate);
      patch.saturate = Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 1;
    }
    if (req.body?.fit !== undefined) {
      patch.fit = ['cover', 'contain', 'fill', 'center'].includes(req.body.fit) ? req.body.fit : 'cover';
    }
    const next = saveSettings({ ui: patch });
    ok(res, { ui: next.ui });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.post('/api/background/clear', (req, res) => {
  try {
    for (const e of Object.values(BG_EXTS)) fs.rmSync(path.join(MEDIA, `app-background.${e}`), { force: true });
    const next = saveSettings({ ui: { background: '' } });
    ok(res, { ui: next.ui });
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- 抓取 / 导入 ---------------- */

app.post('/api/extract', async (req, res) => {
  const { url, forceRender = false, titleHint = '' } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return fail(res, new Error('请输入合法的 http(s) 链接'));
  try {
    const article = await buildArticle(url.trim(), { forceRender: Boolean(forceRender), titleHint });
    saveArticle(article);
    emit('library:update', { id: article.id });
    ok(res, { article: publicArticle(article) });
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- 应用内阅读（先看后收：不进资料库，满意再一键收入） ---------------- */

const PEEK = new Map(); // id -> article，只留最近 20 篇
const PEEK_MAX = 20;

app.post('/api/peek', async (req, res) => {
  const { url, titleHint = '' } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return fail(res, new Error('请输入合法的 http(s) 链接'));
  try {
    const article = await buildArticle(String(url).trim(), { titleHint });
    PEEK.delete(article.id);
    PEEK.set(article.id, article);
    while (PEEK.size > PEEK_MAX) PEEK.delete(PEEK.keys().next().value);
    ok(res, { article: publicArticle(article), inLibrary: !!getArticle(article.id) });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get('/api/peek/:id/preview', (req, res) => {
  const a = PEEK.get(req.params.id) || getArticle(req.params.id);
  if (!a) return res.status(404).type('html').send('<p style="font:14px sans-serif;padding:24px">预览已过期，请重新打开</p>');
  res.type('html').send(renderReadingHtml(a, { mode: 'preview', embed: req.query.embed === '1', translucent: req.query.bg === '1' }));
});

app.post('/api/peek/:id/save', (req, res) => {
  const a = PEEK.get(req.params.id);
  if (!a) return fail(res, new Error('预览已过期，请重新抓取'), 404);
  saveArticle(a);
  emit('library:update', { id: a.id });
  ok(res, { article: publicArticle(a) });
});

app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return fail(res, new Error('没有收到文件'));
  const saved = [];
  const errors = [];
  for (const f of files) {
    try {
      const article = await ingestFile({
        buffer: f.buffer,
        filename: Buffer.from(f.originalname, 'latin1').toString('utf8'),
        mimetype: f.mimetype,
      });
      saveArticle(article);
      saved.push(publicArticle(article));
    } catch (e) {
      errors.push(`${f.originalname}: ${e.message}`);
    }
  }
  emit('library:update', { count: saved.length });
  ok(res, { articles: saved, errors });
});

function publicArticle(a) {
  return {
    id: a.id, title: a.title, url: a.url, finalUrl: a.finalUrl, source: a.source, sourceKind: a.sourceKind,
    account: a.account, author: a.author, publishedAt: a.publishedAt, cover: a.cover, words: a.words,
    assets: a.assets?.length || 0, outline: a.outline, tags: a.tags, userTags: a.userTags || [], summary: a.summary,
    createdAt: a.createdAt, headingCount: a.headingCount, filename: a.filename, rendered: a.rendered,
    warnings: a.warnings || [],
  };
}

/* ---------------- 资料库 ---------------- */

app.get('/api/articles', (req, res) => ok(res, { articles: listArticles() }));

app.get('/api/articles/:id', (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  ok(res, { article: { ...publicArticle(a), html: a.html, markdown: a.markdown, text: a.text } });
});

app.delete('/api/articles/:id', (req, res) => {
  ok(res, { deleted: deleteArticle(req.params.id) });
});

app.patch('/api/articles/:id', (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  if (Array.isArray(req.body?.tags)) a.tags = req.body.tags.slice(0, 12);
  // 用户自建标签：与 AI 生成的 tags 分开存，去重、限长、限个数
  if (Array.isArray(req.body?.userTags)) {
    a.userTags = [...new Set(
      req.body.userTags.map((t) => String(t).trim().slice(0, 24)).filter(Boolean)
    )].slice(0, 12);
  }
  saveArticle(a);
  ok(res, { article: publicArticle(a) });
});

app.get('/api/articles/:id/preview', (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  res.type('html').send(renderReadingHtml(a, { mode: 'preview', embed: req.query.embed === '1', translucent: req.query.bg === '1' }));
});

app.get('/api/articles/:id/markdown', (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  ok(res, { markdown: a.markdown });
});

/* ---------------- 导出 ---------------- */

app.post('/api/articles/:id/export', async (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  const formats = (req.body?.formats || ['md', 'docx', 'pdf']).filter((f) => ['md', 'docx', 'pdf'].includes(f));
  if (!formats.length) return fail(res, new Error('请选择至少一种格式'));
  try {
    const baseUrl = `http://127.0.0.1:${PORT}/`;
    const { dir, files } = await exportArticle(a, formats, { baseUrl });
    const zipPath = path.join(dir, `${safeName(a.title)}-打包.zip`);
    await zipDir(dir, zipPath);
    ok(res, {
      dir,
      files: [
        ...files.map((f) => ({
          format: f.format,
          name: path.basename(f.file),
          size: f.size,
          url: `/exports/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(path.basename(f.file))}`,
        })),
        {
          format: 'zip',
          name: path.basename(zipPath),
          size: fs.statSync(zipPath).size,
          url: `/exports/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(path.basename(zipPath))}`,
        },
      ],
    });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get('/api/download', (req, res) => {
  const p = String(req.query.file || '');
  const abs = path.resolve(p);
  if (!abs.startsWith(path.resolve(EXPORTS)) || !fs.existsSync(abs)) return fail(res, new Error('文件不存在'), 404);
  res.download(abs);
});

/* ---------------- 检索 ---------------- */

app.post('/api/search', async (req, res) => {
  const { query, provider, max, wechatOnly, sources, timeRange, sortBy, pages, fresh } = req.body || {};
  if (!query?.trim()) return fail(res, new Error('请输入检索关键词'));
  try {
    ok(res, await searchWeb(query.trim(), { provider, max, wechatOnly, sources, timeRange, sortBy, pages, fresh }));
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get('/api/search/health', (req, res) => ok(res, { sources: searchHealth() }));

// 人工过验证：弹出真实浏览器窗口，点完验证码后把会话 Cookie 留给服务端复用
app.post('/api/search/verify', async (req, res) => {
  res.setTimeout(0);
  try {
    const out = await openSogouVerify({ timeoutMs: 180000, query: String(req.body?.query || '微信') });
    ok(res, out);
  } catch (e) {
    fail(res, e, 500);
  }
});

app.post('/api/articles/:id/related', async (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  const { sources = 'web', timeRange = '', sortBy = 'relevance', query = '' } = req.body || {};
  const src = ['all', 'wechat', 'web', 'intel'].includes(sources) ? sources : 'web';
  const custom = String(query || '').trim();
  const queries = custom ? [custom] : buildRelatedQueries(a);
  // 只看网页时走轻量快查（单页）；选了公众号 / 全部来源才动用多源，耗时会长一些
  const light = src === 'web';
  const self = String(a.finalUrl || a.url || '').split('#')[0];
  // 几个检索词并行跑（同一源内部仍有互斥锁排队，不会对单个站点连击）
  const groups = await Promise.all(
    queries.map(async (q) => {
      try {
        const r = await searchWeb(q, { max: light ? 8 : 12, sources: src, pages: light ? 1 : 2, timeRange, sortBy, recent: !light });
        // 把文章自己从相关结果里剔掉
        return { query: q, results: r.results.filter((x) => !self || String(x.url).split('#')[0] !== self), notes: r.notes || [] };
      } catch (e) {
        return { query: q, results: [], error: e.message };
      }
    })
  );
  ok(res, { queries, groups, sources: src, timeRange, sortBy });
});

/* ---------------- 监控 ---------------- */

app.get('/api/watches', (req, res) => ok(res, { watches: watchStore.list() }));

app.post('/api/watches', (req, res) => {
  const { query, provider, intervalMin, wechatOnly, label, pages, timeRange, max, sources } = req.body || {};
  if (!query?.trim()) return fail(res, new Error('请输入监控关键词'));
  ok(res, { watch: addWatch({ query, provider, intervalMin, wechatOnly, label, pages, timeRange, max, sources }) });
});

app.patch('/api/watches/:id', async (req, res) => {
  try {
    const patch = {};
    for (const k of ['enabled', 'intervalMin', 'pages', 'timeRange', 'wechatOnly', 'sources', 'label']) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    ok(res, { watch: await updateWatch(req.params.id, patch) });
  } catch (e) {
    fail(res, e, 400);
  }
});

app.delete('/api/watches/:id', (req, res) => {
  watchStore.remove(req.params.id);
  ok(res, { watches: watchStore.list() });
});

app.post('/api/watches/:id/check', async (req, res) => {
  try {
    ok(res, await checkWatch(req.params.id));
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- SSE ---------------- */

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  addSseClient(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {}
  }, 25000);
  req.on('close', () => clearInterval(ping));
});

/* ---------------- AI ---------------- */

app.post('/api/ai/chat', async (req, res) => {
  const { articleId, kbPath = '', messages = [], selection = '', question = '' } = req.body || {};
  let article = articleId ? getArticle(articleId) : null;
  let chatKey = articleId || '';
  // 知识库笔记也能当对话上下文：把 md 当成一篇「文章」
  if (!article && kbPath) {
    try {
      article = kbNoteAsArticle(kbPath);
      chatKey = kbChatKey(kbPath);
    } catch (e) {
      return fail(res, e);
    }
  }
  if (!article) return fail(res, new Error('请先打开一篇文章或知识库笔记'));

  const status = aiStatus();
  if (!status.ready) return fail(res, new Error('AI 未配置：请到「设置」填写 API 地址 / 密钥 / 模型'), 400);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));

    const context = buildArticleContext(article, { query: question + ' ' + selection, maxChars: 9000 });
    const sys = `${CHAT_SYSTEM}\n\n【当前文章上下文】\n${context}`;

    let userContent;
    if (selection) {
      const idx = article.text.indexOf(selection.slice(0, 30));
      const before = idx > 0 ? article.text.slice(Math.max(0, idx - 600), idx) : '';
      const after = idx > 0 ? article.text.slice(idx + selection.length, idx + selection.length + 600) : '';
      userContent = selectionPrompt({ selection, before, after, question: question || '这段话是什么意思？请解释。' });
    } else {
      userContent = question || '请总结这篇文章的核心内容。';
    }

    const finalMessages = [{ role: 'system', content: sys }, ...history];
    if (!history.length || history[history.length - 1].content !== userContent) {
      finalMessages.push({ role: 'user', content: userContent });
    }

    let full = '';
    await streamChat(finalMessages, {
      onDelta: (d) => {
        full += d;
        send('delta', { text: d });
      },
    });
    send('done', { text: full, at: Date.now() });
    res.end();

    // 记录会话，便于刷新后继续追问
    if (chatKey) {
      const stored = chatStore.get(chatKey);
      chatStore.set(chatKey, [
        ...stored,
        { role: 'user', content: question || '（划词提问）', selection, at: Date.now() },
        { role: 'assistant', content: full, at: Date.now() },
      ]);
    }
  } catch (e) {
    send('error', { message: e.message });
    res.end();
  }
});

const kbChatKey = (p) => `kb-${hashId(String(p))}`;

function kbNoteAsArticle(p) {
  const note = kbReadNote(String(p));
  const text = String(note.content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const outline = [...text.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() }));
  return { title: note.name, text, outline, url: '', account: '知识库笔记', author: '', publishedAt: '' };
}

// 知识库笔记的对话记录（与文章对话分开存）
app.get('/api/ai/chat-kb', (req, res) => ok(res, { messages: chatStore.get(kbChatKey(req.query.path || '')) }));
app.delete('/api/ai/chat-kb', (req, res) => {
  chatStore.clear(kbChatKey(req.query.path || ''));
  ok(res, { messages: [] });
});

app.get('/api/ai/chat/:articleId', (req, res) => {
  ok(res, { messages: chatStore.get(req.params.articleId) });
});

app.delete('/api/ai/chat/:articleId', (req, res) => {
  chatStore.clear(req.params.articleId);
  ok(res, { messages: [] });
});

/** AI 整理 + 写入 Obsidian（SSE 汇报进度） */
app.post('/api/ai/knowledge', async (req, res) => {
  const { articleId, spec = {}, write = true } = req.body || {};
  const article = getArticle(articleId);
  if (!article) return fail(res, new Error('文章/文档不存在'), 404);
  if (!aiStatus().ready) return fail(res, new Error('AI 未配置：请到「设置」填写 API 地址 / 密钥 / 模型'));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('step', { phase: 'organize', message: 'AI 正在阅读并整理知识点…' });
    const cats = listCategories();
    const organized = await organizeKnowledge(
      {
        title: article.title,
        url: article.finalUrl || article.url,
        author: article.author || article.account,
        filename: article.filename,
        text: article.text,
      },
      { ...spec, categories: cats.categories }
    );
    send('organized', { organized });

    if (write) {
      send('step', { phase: 'write', message: '正在写入 Obsidian 知识库…' });
      const result = await kbWrite({
        source: {
          title: article.title,
          url: article.finalUrl || article.url,
          author: article.author || article.account,
          publishedAt: article.publishedAt,
          type: article.source === 'upload' ? 'upload' : 'article',
          filename: article.filename,
        },
        organized,
        rawText: article.text,
        category: safeCategory(spec.category || organized.category),
        options: { includeRaw: spec.keepRaw !== false, conceptNotes: spec.conceptNotes !== false },
      });
      send('written', result);
    }

    // 知识点也回写文章标签
    if (organized.tags?.length) {
      article.tags = [...new Set([...(article.tags || []), ...organized.tags])].slice(0, 12);
      article.knowledge = { at: new Date().toISOString(), points: organized.points?.length || 0 };
      saveArticle(article);
    }

    send('done', { ok: true });
    res.end();
  } catch (e) {
    send('error', { message: e.message });
    res.end();
  }
});

app.post('/api/ai/restructure/:id', async (req, res) => {
  const a = getArticle(req.params.id);
  if (!a) return fail(res, new Error('文章不存在'), 404);
  try {
    ok(res, await restructureHeadings(a));
  } catch (e) {
    fail(res, e, 500);
  }
});

/** 只整理不写入：返回结构化结果 + 目录建议 + 目标路径，供前端预览确认 */
app.post('/api/ai/organize', async (req, res) => {
  const { articleId, spec = {} } = req.body || {};
  const article = getArticle(articleId);
  if (!article) return fail(res, new Error('文章/文档不存在'), 404);
  if (!aiStatus().ready) return fail(res, new Error('AI 未配置：请到「设置」填写 API 地址 / 密钥 / 模型'));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const tree = kbTree();
    send('step', { phase: 'organize', message: 'AI 正在阅读、整理并判断归属目录…' });

    const organized = await organizeKnowledge(
      {
        title: article.title,
        url: article.finalUrl || article.url,
        author: article.author || article.account,
        filename: article.filename,
        text: article.text,
      },
      { ...spec, paths: tree.paths, treeText: treeText(tree.nodes), dirMeta: dirMeta(tree.nodes) }
    );

    const target = previewTarget({ category: organized.category, title: organized.title });
    const singleFile = settings().kb?.singleFile !== false;
    send('categorized', { category: organized.category, reason: organized.categoryReason || '' });

    // 判断是否该补充到目标目录里的某个已有笔记
    let mergeInto = '';
    let mergeReason = '';
    const node = nodeByPath(tree.nodes, organized.category);
    try {
      const pick = await pickTargetFile({
        title: organized.title,
        summary: organized.summary,
        tags: organized.tags,
        dirPath: organized.category,
        files: node?.files || [],
      });
      if (pick.target && (node?.files || []).includes(pick.target)) {
        mergeInto = pick.target;
        mergeReason = pick.reason;
      }
    } catch {}

    send('organized', { organized, categories: listCategories(), tree, target, singleFile, mergeInto, mergeReason });
    send('done', { ok: true });
    res.end();
  } catch (e) {
    send('error', { message: e.message });
    res.end();
  }
});

/* ---------------- 设置 ---------------- */

app.get('/api/settings', (req, res) => {
  const s = settings();
  const mask = (v) => (v ? '••••••' : '');
  ok(res, {
    settings: {
      ...s,
      ai: { ...s.ai, apiKey: s.ai.apiKey ? '••••••' + String(s.ai.apiKey).slice(-4) : '' },
      search: {
        ...s.search,
        tavilyKey: mask(s.search.tavilyKey),
        githubToken: mask(s.search.githubToken),
        nvdApiKey: mask(s.search.nvdApiKey),
      },
      siyuan: { ...s.siyuan, token: s.siyuan.token ? '••••••' + String(s.siyuan.token).slice(-4) : '' },
      notion: { ...s.notion, token: s.notion.token ? '••••••' + String(s.notion.token).slice(-4) : '' },
    },
    ai: aiStatus(),
    kb: kbStatus(),
    destinations: destinations(),
    kbHistory: listHistory().slice(0, 12),
    browser: findBrowser(),
  });
});

app.post('/api/settings', (req, res) => {
  const patch = { ...(req.body || {}) };
  // 前端回传掩码时不覆盖原值
  const isMasked = (v) => v === '' || /^••/.test(v);
  if (isMasked(patch.ai?.apiKey)) delete patch.ai.apiKey;
  if (isMasked(patch.search?.tavilyKey)) delete patch.search.tavilyKey;
  if (isMasked(patch.search?.githubToken)) delete patch.search.githubToken;
  if (isMasked(patch.search?.nvdApiKey)) delete patch.search.nvdApiKey;
  if (isMasked(patch.siyuan?.token)) delete patch.siyuan?.token;
  if (isMasked(patch.notion?.token)) delete patch.notion?.token;
  try {
    const next = saveSettings(patch);
    if (patch.browser?.executablePath !== undefined) closeBrowser().catch(() => {});
    ok(res, { settings: next, ai: aiStatus(), kb: kbStatus(), browser: findBrowser() });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.post('/api/ai/test', async (req, res) => {
  try {
    const out = await streamChat([{ role: 'user', content: '只回复两个字：正常' }], { maxTokens: 20 });
    ok(res, { reply: out.trim().slice(0, 50) || '正常' });
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- Obsidian ---------------- */

/* ---------------- 知识库（Obsidian / Logseq / 目录 / 思源 / Notion） ---------------- */

app.get('/api/kb/destinations', (req, res) => {
  ok(res, { destinations: destinations(), current: currentKey() });
});

app.get('/api/kb/status', (req, res) => ok(res, { kb: kbStatus() }));

app.get('/api/kb/categories', (req, res) => ok(res, listCategories()));

app.get('/api/kb/tree', (req, res) => ok(res, kbTree()));

app.post('/api/kb/preview', (req, res) => {
  const { category = '', title = '未命名笔记' } = req.body || {};
  ok(res, { target: previewTarget({ category: safeCategory(category), title }) });
});

function safeCategory(c) {
  // 允许「渗透/内存取证」这样的相对路径，但要挡住越权与绝对路径
  const s = String(c || '').trim().replace(/\\/g, '/');
  if (!s || s.length > 80) return '';
  if (s.includes('..') || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  return s;
}

app.post('/api/kb/test', async (req, res) => {
  try {
    ok(res, await kbTest(req.body?.key || currentKey()));
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get('/api/kb/notes', async (req, res) => {
  try {
    ok(res, await kbList(Number(req.query.limit || 30)));
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- 应用内笔记浏览（文件型知识库） ---------------- */

app.get('/api/kb/files', (req, res) => {
  try {
    ok(res, kbFiles({ limit: Math.min(Number(req.query.limit) || 2000, 5000) }));
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get('/api/kb/note', (req, res) => {
  try {
    ok(res, { note: kbReadNote(String(req.query.path || '')) });
  } catch (e) {
    fail(res, e, 400);
  }
});

app.post('/api/kb/note/open', (req, res) => {
  try {
    ok(res, kbOpenNote(String(req.body?.path || ''), String(req.body?.app || 'default')));
  } catch (e) {
    fail(res, e, 400);
  }
});

// 知识库里的附件（图片等）：编辑器按笔记所在目录解析相对路径，只读、限定在库根目录内
app.get(/^\/kbfile\/(.+)$/, (req, res) => {
  try {
    const root = kbRootDir();
    if (!root) return res.status(404).end();
    const rel = decodeURIComponent(req.params[0] || '').replace(/\\/g, '/');
    if (rel.split('/').includes('..')) return res.status(400).end();
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).end();
    res.sendFile(abs, { dotfiles: 'allow' });
  } catch {
    res.status(404).end();
  }
});

// 编辑器里粘贴 / 拖入图片：存到笔记所在目录，返回相对文件名
app.post('/api/kb/asset', kbUploadAsset.array('file[]', 10), (req, res) => {
  try {
    const files = (req.files || []).map((f) => ({ buffer: f.buffer, filename: Buffer.from(f.originalname, 'latin1').toString('utf8') }));
    if (!files.length) throw new Error('没有收到文件');
    kbImportFiles(String(req.body?.dir || ''), files, null)
      .then((r) => ok(res, r))
      .catch((e) => fail(res, e, 400));
  } catch (e) {
    fail(res, e, 400);
  }
});

// 应用内编辑：覆盖保存一篇已有笔记
app.put('/api/kb/note', (req, res) => {
  try {
    ok(res, { note: kbSaveNote(String(req.body?.path || ''), req.body?.content) });
  } catch (e) {
    fail(res, e, 400);
  }
});

// 外部文件拖进知识库：md/txt 原样复制，pdf/docx/html 转成 md，其它文件当附件复制
const kbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 30 } });
app.post('/api/kb/import', kbUpload.array('files', 30), async (req, res) => {
  try {
    const files = (req.files || []).map((f) => ({
      buffer: f.buffer,
      mimetype: f.mimetype,
      filename: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    }));
    if (!files.length) throw new Error('没有收到文件');
    const convert = async (buffer, filename) => (await ingestFile({ buffer, filename, mimetype: '' })).markdown;
    ok(res, await kbImportFiles(String(req.body?.dir || ''), files, convert));
  } catch (e) {
    fail(res, e, 400);
  }
});

// 打开方式：列出本机可用的浏览器 / 编辑器，按用户选择打开网页或笔记
app.get('/api/open-with/apps', (req, res) => {
  const { url, file } = listOpenApps();
  ok(res, { url, file });
});

app.post('/api/open-with', (req, res) => {
  try {
    ok(res, openUrlWith(String(req.body?.url || ''), String(req.body?.app || 'default')));
  } catch (e) {
    fail(res, e, 400);
  }
});

app.get('/api/kb/history', (req, res) => ok(res, { history: listHistory() }));

app.post('/api/kb/write', async (req, res) => {
  const { articleId, organized, spec = {}, category = '', mergeInto = '' } = req.body || {};
  const article = getArticle(articleId);
  if (!article) return fail(res, new Error('文章/文档不存在'), 404);
  if (!organized?.markdown) return fail(res, new Error('缺少整理结果'));
  try {
    const result = await kbWrite({
      source: {
        title: article.title,
        url: article.finalUrl || article.url,
        author: article.author || article.account,
        publishedAt: article.publishedAt,
        type: article.source === 'upload' ? 'upload' : 'article',
        filename: article.filename,
      },
      organized,
      rawText: article.text,
      category: safeCategory(category),
      mergeInto: String(mergeInto || '').trim().replace(/[\\/]/g, ''),
      options: { includeRaw: spec.keepRaw !== false, conceptNotes: spec.conceptNotes !== false },
    });
    ok(res, result);
  } catch (e) {
    fail(res, e, 500);
  }
});

// 老接口保留，映射到当前知识库目标
app.get('/api/obsidian/notes', async (req, res) => {
  try {
    ok(res, await kbList(Number(req.query.limit || 40)));
  } catch (e) {
    fail(res, e, 500);
  }
});
app.post('/api/obsidian/scan', async (req, res) => {
  try {
    const r = await kbList(50);
    if (!r.configured) return fail(res, new Error(r.error || '知识库未配置'));
    ok(res, { ...r, vault: r.target });
  } catch (e) {
    fail(res, e, 500);
  }
});

/* ---------------- 启动 ---------------- */

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  fail(res, err, 500);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ArticleForge 已启动  →  http://127.0.0.1:${PORT}\n  数据目录：${DATA}\n`);
  startWatcher();
});
