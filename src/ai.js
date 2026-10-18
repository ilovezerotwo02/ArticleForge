import { settings } from './config.js';

export function aiConfig() {
  const ai = settings().ai || {};
  let base = (ai.baseUrl || '').trim().replace(/\/+$/, '');
  if (base && !/\/chat\/completions$/.test(base)) base += '/chat/completions';
  return {
    endpoint: base,
    apiKey: (ai.apiKey || '').trim(),
    model: ai.model || 'deepseek-chat',
    temperature: ai.temperature ?? 0.4,
    enabled: Boolean(ai.enabled && base),
  };
}

export function aiStatus() {
  const c = aiConfig();
  const local = /localhost|127\.0\.0\.1|ollama/i.test(c.endpoint);
  return {
    ready: c.enabled && (Boolean(c.apiKey) || local),
    enabled: c.enabled,
    model: c.model,
    endpoint: c.endpoint,
    needsKey: !c.apiKey && !local,
  };
}

function assertReady() {
  const c = aiConfig();
  if (!c.enabled) throw new Error('AI 未启用：请到「设置」填写 API 地址、密钥与模型名');
  const local = /localhost|127\.0\.0\.1|ollama/i.test(c.endpoint);
  if (!c.apiKey && !local) throw new Error('AI 未配置密钥：请到「设置」填写 API Key');
  return c;
}

function headers(c) {
  const h = { 'Content-Type': 'application/json' };
  if (c.apiKey) h.Authorization = `Bearer ${c.apiKey}`;
  return h;
}

/** 流式对话：逐段回调 */
export async function streamChat(messages, { onDelta, signal, temperature, maxTokens = 2000 } = {}) {
  const c = assertReady();
  const res = await fetch(c.endpoint, {
    method: 'POST',
    headers: headers(c),
    signal,
    body: JSON.stringify({
      model: c.model,
      messages,
      temperature: temperature ?? c.temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI 接口错误 ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {}
    }
  }
  return full;
}

/** 非流式（要结构化 JSON 时用） */
export async function complete(messages, { temperature, maxTokens = 3000, jsonMode = false } = {}) {
  const c = assertReady();
  const payload = {
    model: c.model,
    messages,
    temperature: temperature ?? 0.3,
    max_tokens: maxTokens,
    stream: false,
  };
  if (jsonMode && settings().ai?.jsonMode !== false) payload.response_format = { type: 'json_object' };

  const res = await fetch(c.endpoint, {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI 接口错误 ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

function escapeControlChars(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        out += ch;
        inStr = false;
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    } else {
      out += ch;
      if (ch === '"') inStr = true;
    }
  }
  return out;
}

/** 从任意文本中截出第一个完整的 JSON 对象（字符串感知的括号配对） */
function sliceJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** 输出被截断时补上未闭合的引号/括号 */
function closeTruncated(s) {
  let inStr = false;
  let esc = false;
  const stack = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

export function parseJsonLoose(text) {
  if (!text) throw new Error('AI 返回为空');
  let s = String(text).trim().replace(/^\uFEFF/, '');
  // 以 ``` 开头时只剥掉最外层围栏（内部 markdown 代码块里的 ``` 不能当结尾）
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-z]*\r?\n?/i, '').replace(/```\s*$/, '').trim();
  }
  // 字符串感知的括号截取，兼容前后有解释文字 / 没有闭合围栏
  s = sliceJsonObject(s);
  const attempts = [s, s.replace(/,\s*([}\]])/g, '$1'), escapeControlChars(s)];
  attempts.push(escapeControlChars(s).replace(/,\s*([}\]])/g, '$1'));
  attempts.push(closeTruncated(escapeControlChars(s)));
  attempts.push(closeTruncated(escapeControlChars(s)).replace(/,\s*([}\]])/g, '$1'));

  let lastErr = null;
  for (const a of attempts) {
    try {
      const v = JSON.parse(a);
      if (v && typeof v === 'object') return v;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`JSON 解析失败：${lastErr?.message || '未知原因'}`);
}

/** 让模型输出 JSON：带 1 次纠错重试 + 纯文本兜底，避免「AI 返回为空」 */
export async function completeJson(messages, { maxTokens = 6000, temperature = 0.2 } = {}) {
  let raw = '';
  try {
    raw = await complete(messages, { maxTokens, temperature, jsonMode: true });
  } catch (e) {
    // 有的模型/网关不支持 response_format，退回普通模式再试
    if (/400|response_format|json/i.test(e.message)) raw = await complete(messages, { maxTokens, temperature });
    else throw e;
  }

  let data = null;
  try {
    data = parseJsonLoose(raw);
  } catch (e) {
    const retry = [
      ...messages,
      { role: 'assistant', content: String(raw).slice(0, 1500) },
      {
        role: 'user',
        content: `上面这段不是合法 JSON（${e.message}）。请重新只输出一个合法 JSON 对象：字符串里的换行写成 \\n，不要代码围栏，不要解释文字。`,
      },
    ];
    const raw2 = await complete(retry, { maxTokens, temperature, jsonMode: true }).catch(() => '');
    try {
      data = parseJsonLoose(raw2);
      raw = raw2;
    } catch {
      data = null;
    }
  }
  return { data, raw };
}

/* ---------------- 上下文构造 ---------------- */

export function chunkParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 关键词相关度：挑最相关的段落 + 前后邻居，控制 token */
export function selectRelevantContext(text, query, { maxChars = 9000 } = {}) {
  if (text.length <= maxChars) return text;
  const paras = chunkParagraphs(text);
  const q = String(query || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const scores = paras.map((p) => {
    const s = p.toLowerCase();
    let score = 0;
    for (const w of q) {
      if (s.includes(w)) score += Math.min(3, (s.split(w).length - 1));
    }
    return score;
  });

  const picked = new Set();
  let used = 0;
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    const block = [paras[i - 1], paras[i], paras[i + 1]].filter(Boolean).join('\n\n');
    if (picked.has(i)) continue;
    if (used + block.length > maxChars) continue;
    for (const j of [i - 1, i, i + 1]) if (paras[j]) picked.add(j);
    used += block.length;
    if (used >= maxChars * 0.9) break;
  }
  if (!picked.size) return text.slice(0, maxChars);
  return [...picked]
    .sort((a, b) => a - b)
    .map((i) => paras[i])
    .join('\n\n')
    .slice(0, maxChars);
}

export function articleOutlineText(article) {
  return (article.outline || []).map((o) => `${'  '.repeat(Math.max(0, o.level - 2))}- ${o.text}`).join('\n');
}

export function buildArticleContext(article, { query = '', maxChars = 9000 } = {}) {
  const outline = articleOutlineText(article);
  const body = selectRelevantContext(article.text || '', query, { maxChars });
  return [
    `文章标题：${article.title}`,
    article.account ? `来源公众号：${article.account}` : '',
    article.author ? `作者：${article.author}` : '',
    article.publishedAt ? `发布时间：${article.publishedAt}` : '',
    article.url ? `原文链接：${article.url}` : '',
    outline ? `\n【大纲】\n${outline}` : '',
    `\n【正文节选】\n${body}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---------------- 系统提示 ---------------- */

export const CHAT_SYSTEM = `你是 ArticleForge 的阅读助手，帮助用户读懂、读透当前文章。

规则：
1. 默认用简体中文回答；用户用其它语言提问则跟随用户语言。
2. 只依据提供的文章内容回答；文章没写的内容，明确说「文章没有提到」，可补充通用知识但必须标注「（补充知识）」。
3. 引用原文时用「」包裹，并尽量指出所在小节。
4. 解释代码时说明每一步在做什么、参数含义、预期输出。
5. 回答结构化：先给结论，再给依据；较复杂时用小标题或列表；避免空话。
6. 用户可能在连续追问，要结合对话历史理解指代。
7. 输出用标准 Markdown，界面会渲染：需要对比时用 Markdown 表格（| 列 | 列 | 加分隔行），不要用空格对齐或画 ASCII 表格。
8. 数学公式一律用 LaTeX：行内 $...$，独立公式 $$...$$。不要把公式放进代码块或行内代码里；纯文字能表达清楚时优先用文字。
9. 表格单元格里也可以用行内公式，例如 $\\int x^2 dx = \\frac{x^3}{3} + C$。`;

export function selectionPrompt({ selection, before, after, question }) {
  return `请针对下面这段被选中的内容回答问题。

【选中内容】
"""${selection}"""

【上下文·前文】
${before || '（无）'}

【上下文·后文】
${after || '（无）'}

【用户问题】
${question}

要求：
- 先直接回答，再解释依据；
- 如果问的是代码/命令，逐行解释作用与参数；
- 如果这段内容本身有歧义或错误，指出来。`;
}

/* ---------------- 知识整理 ---------------- */

export const FORMAT_PRESETS = {
  study: {
    label: '学习笔记',
    desc: '概念 → 原理 → 步骤 → 代码 → 易错点，适合技术文章沉淀',
    instruction:
      '按「一句话概括 / 核心概念 / 原理拆解 / 操作步骤 / 代码与命令 / 易错点与坑 / 延伸思考」组织。每个知识点独立成小节，概念先定义再解释。',
  },
  card: {
    label: '概念卡片',
    desc: '一词一卡，原子化，适合 Zettelkasten 双链',
    instruction:
      '每个知识点写成一张原子卡片：标题是概念名（名词短语），正文 80~200 字，包含定义、为什么重要、一个例子。卡片之间用 [[双链]] 关联，不写大段综述。',
  },
  tutorial: {
    label: '实操教程',
    desc: '环境 → 命令 → 验证 → 排错，适合复现类内容',
    instruction:
      '按「目标 / 前置条件与环境 / 逐步操作（每步含命令与预期输出）/ 验证方法 / 常见报错与解决」组织。命令必须放进 ```bash 代码块，并解释关键参数。',
  },
  qa: {
    label: '问答笔记',
    desc: '把内容拆成 Q&A，适合复习与自测',
    instruction:
      '把内容拆成 6~12 组「### Q: 问题」与「A: 答案」。问题要具体可回答，答案 2~5 句，可附代码。最后给一个「自测清单」。',
  },
  compare: {
    label: '对比分析',
    desc: '多维对比表 + 选型建议',
    instruction:
      '提炼可对比的维度，用 Markdown 表格对比；表格后给「差异解读」与「选型建议（什么场景选哪个）」。',
  },
  timeline: {
    label: '流程/时间线',
    desc: '按事件或步骤顺序梳理',
    instruction: '按时间或流程顺序组织，每一步写清「输入 → 动作 → 输出」，关键节点加粗，最后给一张流程概览列表。',
  },
  custom: {
    label: '自定义',
    desc: '完全按你的格式要求来',
    instruction: '',
  },
};

/**
 * AI 把文章/文档整理成知识笔记（含知识点与概念关联）
 * @returns {{title:string,summary:string,tags:string[],markdown:string,points:Array,concepts:Array}}
 */
export async function organizeKnowledge(source, spec = {}) {
  const preset = FORMAT_PRESETS[spec.preset] || FORMAT_PRESETS.study;
  const detail = { brief: '每个知识点 1~2 句，只留骨架', normal: '每个知识点 3~6 句，讲清 why 和 how', deep: '每个知识点尽量展开，包含原理、例子、边界条件' }[spec.detail || 'normal'];
  const language = spec.language || '中文';
  const maxPoints = Number(spec.maxPoints || 8);

  const formatBlock = [
    `- 组织模板：${preset.label}${preset.instruction ? `（${preset.instruction}）` : ''}`,
    `- 详细程度：${detail}`,
    `- 输出语言：${language}`,
    spec.keepCode ? '- 必须保留原文中的命令/代码，并用带语言标注的代码块呈现' : '- 代码只在必要处保留',
    spec.keepQuote ? '- 在每节末尾可用 > 引用 1 句原文作为出处' : '- 不要大段复述原文',
    spec.conceptNotes ? '- 概念名要能独立成笔记（名词短语，2~8 字），便于建立双链' : '- 概念名可写长一些',
    `- 知识点数量上限：${maxPoints}`,
    spec.treeText
      ? `- 目标目录：下面是用户知识库的目录树（缩进=层级，不限层数）。目录名后的括号列出该目录**现有的笔记文件名**，代表这个目录平时放什么内容，请以此作为归类依据。请按文章内容选一个最贴近的**已有目录**，原样返回它的完整路径（用 / 连接，例如 渗透/工具/burpsuite）；只有整棵树里确实没有合适目录时，才返回「已有目录/新目录名」在某个已有目录下新建一层，父目录必须已在树里。\n${spec.treeText}`
      : '',
    spec.custom?.trim() ? `- 用户额外格式要求（优先级最高）：${spec.custom.trim()}` : '',
    spec.userTemplate?.trim() ? `\n用户提供的笔记骨架（严格按此结构填充，可增删小节但保持顺序）：\n"""\n${spec.userTemplate.trim()}\n"""` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const sys = `你是资深知识管理助手，擅长把长文整理成可直接放进个人知识库（Obsidian / Logseq / 思源 / Notion）的知识笔记。

输出必须是**单个 JSON 对象**，不要 markdown 代码围栏，不要任何解释文字。结构：
{
  "title": "笔记标题（不超过 40 字）",
  "summary": "80 字以内的摘要",
  "tags": ["3~6 个中文标签"],
  "markdown": "笔记正文，Markdown 格式，以 ## 开头（不要重复标题），可含 ### 小节、列表、表格、代码块",
  "points": [
    {
      "title": "知识点名称（2~10 字，名词短语）",
      "definition": "一句话定义",
      "detail": "2~5 句解释，含为什么/怎么用",
      "relations": [{"target": "另一个知识点名称", "type": "前置|包含|对比|应用|相关"}]
    }
  ],
  "concepts": [{"name": "核心概念名", "definition": "一句话定义", "aliases": ["别名"]}],
  "category": "从目录树里选一个最匹配的已有目录，原样返回完整路径（用 / 连接）；确实没有合适的才返回空字符串",
  "category_reason": "为什么放这个目录，一句话"
}

注意：
- markdown 字段里的换行用 \\n 转义；
- points 至少 3 条、最多 ${maxPoints} 条，relations 的 target 必须是 points 或 concepts 里出现过的名字；
- 不要编造原文没有的事实，推测内容标「（推测）」；
- 表格用标准 Markdown 表格。`;

  const user = `【文档信息】
标题：${source.title || '未命名'}
${source.url ? `来源：${source.url}` : ''}
${source.author ? `作者：${source.author}` : ''}
${source.filename ? `文件名：${source.filename}` : ''}

【格式要求】
${formatBlock}

【正文】
${source.text.slice(0, 24000)}`;

  const { data: parsed, raw } = await completeJson(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    { temperature: 0.25, maxTokens: 6000 }
  );

  let data = parsed;
  const warnings = [];
  if (!data) {
    // 模型没吐 JSON，但可能吐了成篇的 Markdown —— 直接把正文当笔记，别丢结果
    let text = String(raw || '').trim();
    const fence = /```(?:markdown|md)?\s*([\s\S]*?)```/i.exec(text);
    if (fence) text = fence[1].trim();
    if (text.length < 80) throw new Error('AI 返回内容无法解析（既不是 JSON 也没有可用正文），请重试或换个模型');
    warnings.push('AI 未按 JSON 返回，已按纯 Markdown 正文保存（知识点与标签从文章推断）');
    data = {
      title: source.title || '未命名笔记',
      summary: '',
      tags: [],
      markdown: text,
      points: [],
      concepts: [],
      category: '',
    };
  }

  data.title = (data.title || source.title || '未命名笔记').slice(0, 60);
  data.summary = data.summary || '';
  data.tags = Array.isArray(data.tags) ? data.tags.slice(0, 8) : [];
  data.points = Array.isArray(data.points) ? data.points.slice(0, maxPoints) : [];
  data.concepts = Array.isArray(data.concepts) ? data.concepts.slice(0, 20) : [];
  data.markdown = String(data.markdown || '').trim();
  if (!data.markdown) throw new Error('AI 未返回有效的笔记正文');

  // 目录校验：必须是已有目录，或「已有目录/新目录」这种在已有父目录下新建一层
  const paths = Array.isArray(spec.paths) ? spec.paths : [];
  let picked = String(data.category || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (picked && picked.includes('..')) picked = '';
  if (picked && !paths.includes(picked)) {
    const parent = picked.split('/').slice(0, -1).join('/');
    if (!parent || !paths.includes(parent)) picked = '';
  }
  data.category = picked;

  // 模型没给出目录时，用一个便宜的小请求专问目录；再不行才回默认目录
  if (!data.category && spec.treeText) {
    try {
      const again = await pickCategory({
        title: source.title,
        summary: data.summary,
        tags: data.tags,
        treeText: spec.treeText,
      });
      let p2 = String(again.category || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (p2 && !p2.includes('..')) {
        if (!paths.includes(p2)) {
          const parent = p2.split('/').slice(0, -1).join('/');
          if (parent && paths.includes(parent)) {
            // 允许「已有目录/新目录」
          } else {
            p2 = '';
          }
        }
        if (p2) {
          data.category = p2;
          data.categoryReason = `二次判断：${again.reason || '根据笔记内容与目录树匹配'}`;
          warnings.push('首次判断未给出目录，已通过二次判断补上');
        }
      }
    } catch {}
  }

  data.categoryReason = data.category
    ? String(data.category_reason || '').trim() || '已按目录树判断'
    : 'AI 未能从目录树里选出合适目录，已放默认目录；请在上方手动选（也可以新建）';
  data.warnings = [...(Array.isArray(data.warnings) ? data.warnings : []), ...warnings];
  return data;
}

/** 目录二次判断：模型没给目录时，用一个小请求专问目录（便宜且专注） */
export async function pickCategory({ title, summary, tags, treeText }) {
  const sys = '你是文件归类助手。根据笔记内容，从目录树里选出最合适的一个目录。目录名后的括号列出的是该目录现有的笔记文件名，代表这个目录放什么内容。只输出 JSON：{"category":"完整目录路径或空字符串","reason":"一句话理由"}。category 必须是树里已有的目录（用 / 连接的完整路径），原样返回，不要发明新目录；确实没有合适的才给空字符串。';
  const user = `【目录树】
${treeText}

【笔记】
标题：${title || ''}
摘要：${summary || ''}
标签：${(tags || []).join('、')}

请选出最贴近的已有目录。`;
  const { data } = await completeJson(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    { maxTokens: 300, temperature: 0.1 }
  );
  return { category: String(data.category || '').trim(), reason: String(data.reason || '').trim() };
}

/** 判断新笔记应该补充到目录里哪个已有文件，还是新建 */
export async function pickTargetFile({ title, summary, tags, dirPath, files }) {
  if (!Array.isArray(files) || !files.length) return { target: '', reason: '目录里还没有笔记' };
  const sys = '你是笔记整理助手。判断一篇新笔记应该**补充合并**到目录里哪个已有笔记文件的末尾，还是作为独立新文件创建。只输出 JSON：{"target":"已有文件名（不带 .md），空字符串表示新建","reason":"一句话理由"}。判断标准：同一主题的深化、补充、另一种解法 → 合并；主题不同 → 新建。宁可新建也不要错误合并。';
  const user = `【目录】${dirPath || '（根目录）'}
【目录里已有的笔记文件】
${files.map((f) => `- ${f}`).join('\n')}

【新笔记】
标题：${title || ''}
摘要：${summary || ''}
标签：${(tags || []).join('、')}

请判断。`;
  const { data } = await completeJson(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    { maxTokens: 300, temperature: 0.1 }
  );
  return { target: String(data.target || '').trim(), reason: String(data.reason || '').trim() };
}

/** AI 修正标题层级（可选增强） */
export async function restructureHeadings(article) {
  const blocks = chunkParagraphs(article.text).slice(0, 120);
  const numbered = blocks.map((t, i) => `${i + 1}. ${t.slice(0, 120)}`).join('\n');
  const sys = `你是文章结构编辑。给下面每个段落判定层级：h2（一级小节）、h3（二级小节）、p（正文）。
只输出 JSON：{"levels":[{"i":1,"level":"h2"},...]}，不要解释。判断依据：短句、编号、章节词、语气转折、主题切换。`;
  const raw = await complete(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `标题：${article.title}\n\n${numbered}` },
    ],
    { temperature: 0.1, maxTokens: 2000 }
  );
  return parseJsonLoose(raw);
}
