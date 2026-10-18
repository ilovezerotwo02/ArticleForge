import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, Footer, PageNumber, ExternalHyperlink, LevelFormat, convertInchesToTwip,
} from 'docx';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { MEDIA } from '../config.js';

const CODE_FONT = 'Consolas';
const INK = '1B1F24';
const INK2 = '3D4450';
const GRAY = '6B7280';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textOf(node) {
  if (!node) return '';
  return decodeEntities(node.textContent || '').replace(/\u200b/g, '');
}

/** 内联节点 → TextRun 数组 */
function inlineRuns(node, inherit = {}) {
  const runs = [];
  const pushText = (text, fmt = {}) => {
    if (!text) return;
    const clean = text.replace(/\u00a0/g, ' ');
    if (!clean) return;
    runs.push(new TextRun({ text: clean, ...inherit, ...fmt }));
  };

  const walk = (n, fmt) => {
    if (n.nodeType === 3) {
      pushText(n.textContent, fmt);
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') {
      runs.push(new TextRun({ text: '', break: 1 }));
      return;
    }
    if (tag === 'STRONG' || tag === 'B') return [...n.childNodes].forEach((c) => walk(c, { ...fmt, bold: true }));
    if (tag === 'EM' || tag === 'I') return [...n.childNodes].forEach((c) => walk(c, { ...fmt, italics: true }));
    if (tag === 'U') return [...n.childNodes].forEach((c) => walk(c, { ...fmt, underline: {} }));
    if (tag === 'CODE') {
      const t = n.textContent || '';
      if (!t) return;
      runs.push(
        new TextRun({
          text: t,
          ...fmt,
          font: CODE_FONT,
          color: 'B4266B',
          size: 19,
          shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' },
        })
      );
      return;
    }
    if (tag === 'A') {
      const href = n.getAttribute('href') || '';
      const children = [];
      const collect = (x, f) => {
        if (x.nodeType === 3) children.push(new TextRun({ text: x.textContent, ...f, color: '4338CA', underline: {} }));
        else if (x.nodeType === 1) [...x.childNodes].forEach((c) => collect(c, f));
      };
      collect(n, fmt);
      if (!children.length) return;
      if (/^https?:\/\//.test(href)) runs.push(new ExternalHyperlink({ link: href, children }));
      else runs.push(...children);
      return;
    }
    [...n.childNodes].forEach((c) => walk(c, fmt));
  };

  walk(node, inherit);
  return runs.length ? runs : [new TextRun({ text: textOf(node) || ' ', ...inherit })];
}

function resolveImage(src) {
  if (!src) return null;
  let rel = src;
  if (rel.startsWith('/media/')) rel = rel.slice(1);
  if (rel.startsWith('media/')) {
    const file = path.join(MEDIA, rel.slice('media/'.length));
    return fs.existsSync(file) ? file : null;
  }
  if (/^https?:/.test(rel)) return null;
  const abs = path.resolve(rel);
  return fs.existsSync(abs) ? abs : null;
}

function imageParagraph(src, alt, maxWidth = 600) {
  const file = resolveImage(src);
  if (!file) return null;
  try {
    const buf = fs.readFileSync(file);
    const dim = imageSize(buf);
    if (!dim.width || !dim.height) return null;
    const scale = Math.min(1, maxWidth / dim.width);
    const type = (dim.type || 'png').toLowerCase();
    const ext = type === 'jpg' ? 'jpeg' : type;
    const img = new ImageRun({
      data: buf,
      transformation: { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) },
      type: ['png', 'jpeg', 'gif', 'bmp', 'svg'].includes(ext) ? ext : 'png',
    });
    return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 }, children: [img] });
  } catch {
    return null;
  }
}

/** 代码块 → 带底纹与边框的单格表格，模拟代码框 */
function codeTable(code, lang) {
  const label = String(lang || 'text').toUpperCase();
  const lines = code.replace(/\t/g, '    ').split('\n');
  const children = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: label, font: CODE_FONT, size: 15, color: GRAY, characterSpacing: 20 })],
    }),
    ...lines.map(
      (line) =>
        new Paragraph({
          spacing: { after: 0, line: 240, lineRule: 'auto' },
          children: [new TextRun({ text: line || ' ', font: CODE_FONT, size: 18, color: INK })],
        })
    ),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'DDE1E8' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDE1E8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'DDE1E8' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'DDE1E8' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: 'F6F8FA' },
            margins: { top: 100, bottom: 120, left: 160, right: 160 },
            children,
          }),
        ],
      }),
    ],
  });
}

function quoteParagraph(el, depth = 0) {
  const children = inlineRuns(el, { color: '4B5563', italics: false });
  return new Paragraph({
    indent: { left: 360 + depth * 240 },
    spacing: { before: 100, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C7D2FE', space: 8 } },
    children,
  });
}

function listParagraphs(el, ordered, level = 0) {
  const out = [];
  const items = [...el.children].filter((c) => c.tagName === 'LI');
  for (const [i, li] of items.entries()) {
    // 嵌套列表
    const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    const clone = li.cloneNode(true);
    nested.forEach((n) => n.remove());
    out.push(
      new Paragraph({
        spacing: { after: 60 },
        ...(ordered
          ? { numbering: { reference: 'af-ordered', level, instance: 0 } }
          : { bullet: { level } }),
        children: inlineRuns(clone, { color: INK2 }),
      })
    );
    for (const n of nested) {
      out.push(...listParagraphs(n, n.tagName === 'OL', Math.min(level + 1, 2)));
    }
  }
  return out;
}

function tableBlock(table) {
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return null;
  const docxRows = rows.map((tr, ri) => {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    return new TableRow({
      tableHeader: ri === 0,
      children: cells.map(
        (cell) =>
          new TableCell({
            shading: cell.tagName === 'TH' ? { type: ShadingType.CLEAR, fill: 'F4F6F9' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                spacing: { after: 0, line: 260 },
                children: inlineRuns(cell, { size: 19, bold: cell.tagName === 'TH' }),
              }),
            ],
          })
      ),
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D9DDE4' },
    },
    rows: docxRows,
  });
}

const HEADING_MAP = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

function blocks(html) {
  const dom = new JSDOM(`<body><div id="root">${html}</div></body>`);
  const root = dom.window.document.getElementById('root');
  const out = [];

  const walk = (parent) => {
    for (const el of [...parent.children]) {
      const tag = el.tagName;
      if (HEADING_MAP[tag]) {
        out.push(
          new Paragraph({
            heading: HEADING_MAP[tag],
            spacing: { before: tag === 'H2' ? 320 : 240, after: 120 },
            children: inlineRuns(el, { bold: true, color: INK }),
          })
        );
      } else if (tag === 'P') {
        if (el.querySelector('img') && !textOf(el).trim()) {
          for (const img of el.querySelectorAll('img')) {
            const p = imageParagraph(img.getAttribute('src'), img.getAttribute('alt'));
            if (p) out.push(p);
          }
          continue;
        }
        if (!textOf(el).trim()) continue;
        out.push(
          new Paragraph({
            spacing: { after: 140, line: 320 },
            alignment: el.getAttribute('data-align') === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: inlineRuns(el, { color: INK2, size: 21 }),
          })
        );
      } else if (tag === 'PRE') {
        out.push(codeTable(textOf(el), el.getAttribute('data-lang')));
        out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '' })] }));
      } else if (tag === 'FIGURE') {
        const img = el.querySelector('img');
        if (img) {
          const p = imageParagraph(img.getAttribute('src'), img.getAttribute('alt'));
          if (p) out.push(p);
        }
        const cap = el.querySelector('figcaption')?.textContent?.trim();
        if (cap) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [new TextRun({ text: cap, size: 17, color: GRAY })],
            })
          );
        }
      } else if (tag === 'IMG') {
        const p = imageParagraph(el.getAttribute('src'), el.getAttribute('alt'));
        if (p) out.push(p);
      } else if (tag === 'BLOCKQUOTE') {
        const inner = [...el.children].filter((c) => c.tagName === 'P');
        if (inner.length) inner.forEach((p) => out.push(quoteParagraph(p)));
        else out.push(quoteParagraph(el));
      } else if (tag === 'UL' || tag === 'OL') {
        out.push(...listParagraphs(el, tag === 'OL'));
      } else if (tag === 'TABLE') {
        const t = tableBlock(el);
        if (t) {
          out.push(t);
          out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        }
      } else if (tag === 'HR') {
        out.push(
          new Paragraph({
            spacing: { before: 200, after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E6E8EC', space: 1 } },
            children: [],
          })
        );
      } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
        if (el.children.length) walk(el);
        else if (textOf(el).trim()) {
          out.push(new Paragraph({ spacing: { after: 140, line: 320 }, children: inlineRuns(el, { color: INK2, size: 21 }) }));
        }
      } else if (textOf(el).trim()) {
        out.push(new Paragraph({ spacing: { after: 140 }, children: inlineRuns(el, { color: INK2, size: 21 }) }));
      }
    }
  };

  walk(root);
  return out;
}

/**
 * 生成 DOCX
 * @param {object} article
 * @param {string} outPath
 */
export async function exportDocx(article, outPath) {
  const metaLine = [article.account, article.author && `作者 ${article.author}`, article.publishedAt]
    .filter(Boolean)
    .join('  ·  ');

  const children = [
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: article.title, bold: true, size: 44, color: INK, font: 'Microsoft YaHei' })],
    }),
  ];

  if (metaLine) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: metaLine, size: 18, color: GRAY })],
      })
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: article.finalUrl || article.url, size: 16, color: '8A93A3' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E6E8EC', space: 6 } },
      children: [],
    })
  );

  children.push(...blocks(article.html));

  if (article.finalUrl) {
    children.push(
      new Paragraph({
        spacing: { before: 400 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E6E8EC', space: 6 } },
        children: [new TextRun({ text: `原文：${article.finalUrl}`, size: 16, color: '9AA3B2' })],
      })
    );
  }

  const doc = new Document({
    creator: 'ArticleForge',
    title: article.title,
    description: article.summary || '',
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 21, color: INK2 }, paragraph: { spacing: { line: 320 } } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 34, bold: true, color: INK, font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 29, bold: true, color: INK, font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 25, bold: true, color: '2B313B', font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 2 },
        },
        {
          id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, color: '2B313B', font: 'Microsoft YaHei' },
          paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 3 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'af-ordered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 420 + level * 300, hanging: 240 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'ArticleForge · ', size: 16, color: '9AA3B2' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '9AA3B2' }),
                  new TextRun({ text: ' / ', size: 16, color: '9AA3B2' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '9AA3B2' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}
