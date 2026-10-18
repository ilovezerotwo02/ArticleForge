import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function yamlEscape(v) {
  const s = String(v || '').replace(/\r?\n/g, ' ').trim();
  return /[:#\[\]{}'"&*!|>%@`,-]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

export function buildFrontmatter(meta = {}) {
  const lines = ['---'];
  if (meta.title) lines.push(`title: ${yamlEscape(meta.title)}`);
  if (meta.url) lines.push(`source: ${yamlEscape(meta.url)}`);
  if (meta.author) lines.push(`author: ${yamlEscape(meta.author)}`);
  if (meta.publishedAt) lines.push(`published: ${yamlEscape(meta.publishedAt)}`);
  lines.push(`saved: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  if (meta.tags?.length) lines.push(`tags: [${meta.tags.map((t) => yamlEscape(t)).join(', ')}]`);
  if (meta.summary) lines.push(`summary: ${yamlEscape(String(meta.summary).replace(/\s+/g, ' ').slice(0, 110))}`);
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * 归一化 HTML → Markdown
 * @param {string} html
 * @param {{title?:string,url?:string,author?:string,publishedAt?:string,tags?:string[],summary?:string,frontmatter?:boolean,imagePrefix?:string,headingOffset?:number}} meta
 */
export function htmlToMarkdown(html, meta = {}) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    hr: '---',
  });

  td.use(gfm);

  // 代码块：保留语言标识
  td.addRule('fencedCodeBlock', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const code = (node.textContent || '').replace(/\n+$/, '').replace(/\u00a0/g, ' ');
      let lang = node.getAttribute('data-lang') || '';
      if (lang === 'text') lang = '';
      const fence = code.includes('```') ? '~~~~' : '```';
      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    },
  });

  // 行内代码
  td.addRule('inlineCode', {
    filter: (node) => node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE',
    replacement: (content) => {
      const text = content.replace(/\n/g, ' ');
      if (!text.trim()) return '';
      const ticks = text.includes('`') ? '``' : '`';
      return `${ticks}${text}${ticks}`;
    },
  });

  // 图片：路径重写
  td.addRule('imageSrc', {
    filter: 'img',
    replacement: (_c, node) => {
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      let src = node.getAttribute('src') || '';
      if (meta.imagePrefix !== undefined && src.startsWith('/media/')) {
        src = meta.imagePrefix + src.replace(/^\/media\//, '');
      }
      return src ? `![${alt}](${src})` : '';
    },
  });

  // figure/figcaption 会重复输出 alt，去掉 figcaption 的重复文本
  td.addRule('figure', {
    filter: 'figure',
    replacement: (_c, node) => {
      const img = node.querySelector('img');
      if (!img) return '\n\n';
      const alt = (img.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      let src = img.getAttribute('src') || '';
      if (meta.imagePrefix !== undefined && src.startsWith('/media/')) {
        src = meta.imagePrefix + src.replace(/^\/media\//, '');
      }
      const cap = node.querySelector('figcaption')?.textContent?.trim() || '';
      const capLine = cap && cap !== alt ? `\n*${cap}*` : '';
      return `\n\n![${alt || cap}](${src})${capLine}\n\n`;
    },
  });

  // 表格：GFM 插件已处理，这里加个空行包裹
  td.addRule('tableWrap', {
    filter: 'table',
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });

  let md = td.turndown(html);
  md = md
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (meta.frontmatter === false) return md + '\n';
  return `${buildFrontmatter(meta)}${md}\n`;
}

export function plainToMarkdown(text, meta = {}) {
  return `${buildFrontmatter(meta)}${text.trim()}\n`;
}
