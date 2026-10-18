/** 知识库写入的公共工具：命名、frontmatter、笔记正文 */
import fs from 'node:fs';
import path from 'node:path';

export function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_·、,，。.:：!！?？'"“”‘’()（）\[\]【】#]/g, '')
    .trim();
}

export function yamlValue(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  return /[:#\[\]{}'"&*!|>%@`]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 合并知识点关系，去重（按目标名） */
export function relatedList(organized) {
  const map = new Map();
  for (const p of organized.points || []) {
    for (const r of p.relations || []) {
      if (!r?.target) continue;
      const key = normalizeName(r.target);
      if (!map.has(key)) map.set(key, { target: safeName(r.target), type: r.type || '相关' });
    }
  }
  return [...map.values()].slice(0, 14);
}

/** 概念集合：先取 concepts，再用知识点标题补齐 */
export function conceptList(organized) {
  const map = new Map();
  for (const c of organized.concepts || []) {
    if (c?.name) map.set(normalizeName(c.name), { name: safeName(c.name), definition: c.definition || '' });
  }
  for (const p of organized.points || []) {
    const key = normalizeName(p?.title);
    if (key && !map.has(key)) map.set(key, { name: safeName(p.title), definition: p.definition || '' });
  }
  return map;
}

/**
 * 生成主笔记 Markdown
 * @param {object} style { yaml, callout, wiki, excerpt, related, points, single }
 *   single=true 时：关联写成纯文本、概念清单一并内联（不建独立概念笔记/索引）
 */
export function buildMainMarkdown({ source, organized, rawText = '', options = {}, style = {} }) {
  const s = { yaml: true, callout: true, wiki: true, excerpt: true, related: true, points: true, single: false, ...style };
  const title = organized.title || source.title || '未命名笔记';
  const link = (name) => (s.wiki && !s.single ? `[[${name}]]` : name);
  const parts = [];

  if (s.yaml) {
    parts.push(
      [
        '---',
        `title: ${yamlValue(title)}`,
        source.url ? `source: ${yamlValue(source.url)}` : '',
        `type: ${source.type || 'article'}`,
        source.author ? `author: ${yamlValue(source.author)}` : '',
        source.publishedAt ? `published: ${yamlValue(source.publishedAt)}` : '',
        `created: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        `tags: [${(organized.tags || []).map((t) => yamlValue(t)).join(', ')}]`,
        'ai_generated: true',
        '---',
        '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  parts.push(`# ${title}`, '');

  if (organized.summary) {
    const sum = organized.summary.replace(/\n/g, ' ');
    parts.push(s.callout ? '> [!summary] 摘要' : '> **摘要**', `> ${sum}`, '');
  }
  if (source.url) {
    parts.push(`> 来源：[${source.url.replace(/^https?:\/\//, '').slice(0, 70)}](${source.url})`, '');
  }

  parts.push(String(organized.markdown || '').trim(), '');

  const related = s.related ? relatedList(organized) : [];
  if (related.length) {
    parts.push('## 知识点关联', '');
    for (const r of related) parts.push(`- ${link(r.target)} · ${r.type}`);
    parts.push('');
  }

  if (s.points && organized.points?.length) {
    parts.push('## 知识点清单', '');
    for (const p of organized.points) {
      const rel = (p.relations || []).map((r) => `${r.target}（${r.type}）`).filter(Boolean).join('、');
      parts.push(`- **${p.title}**：${p.definition || ''}${rel ? `　关联：${rel}` : ''}`);
    }
    parts.push('');
  }

  // 单文件模式：概念也内联，不再单独建卡
  if (s.single) {
    const concepts = (organized.concepts || []).filter((c) => c?.name);
    if (concepts.length) {
      parts.push('## 概念清单', '');
      for (const c of concepts) parts.push(`- **${c.name}**：${c.definition || '（待补充）'}`);
      parts.push('');
    }
  }

  if (s.excerpt && options.includeRaw !== false && rawText && rawText.length > 600) {
    parts.push('## 原文摘录', '', '<details><summary>展开原文（前 3000 字）</summary>', '', rawText.slice(0, 3000), '', '</details>', '');
  }

  return { markdown: parts.join('\n'), title, related };
}

/** 同名文件不覆盖：返回可用的文件路径 */
export function pickFilePath(dir, name, { suffixOnConflict = true } = {}) {
  ensureDir(dir);
  let file = path.join(dir, `${name}.md`);
  if (!fs.existsSync(file) || !suffixOnConflict) return file;
  const stamp = Date.now().toString().slice(-5);
  file = path.join(dir, `${name} - ${stamp}.md`);
  return file;
}

export function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

/** Markdown → Logseq 大纲块（标题/列表/代码都变成 block） */
export function mdToLogseqOutline(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let lang = '';

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      if (!inCode) {
        inCode = true;
        lang = fence[1] || '';
        out.push(`- \`\`\`${lang}`.trimEnd());
      } else {
        inCode = false;
        out.push('  ```');
      }
      continue;
    }
    if (inCode) {
      out.push(line ? `  ${line}` : '  ');
      continue;
    }
    if (!line.trim()) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`- ${h[1]} ${h[2]}`);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      out.push(`- ${line.replace(/^[-*+]\s+/, '')}`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(`- ${line.replace(/^>\s?/, '')}`);
      continue;
    }
    out.push(`- ${line}`);
  }
  return out.join('\n');
}
