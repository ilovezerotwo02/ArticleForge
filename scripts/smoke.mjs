import { buildArticle } from '../src/extract.js';
import { saveArticle, getArticle, listArticles } from '../src/store.js';
import { exportArticle } from '../src/export.js';

const url = process.argv[2] || 'https://mp.weixin.qq.com/s/FsA6wPuySmgBn_vEbyAziw';
const formats = (process.argv[3] || 'md,docx,pdf').split(',');

const t0 = Date.now();
const article = await buildArticle(url);
saveArticle(article);

console.log('— 抓取完成 —');
console.log('标题 :', article.title);
console.log('来源 :', article.source, article.account, article.publishedAt);
console.log('字数 :', article.words);
console.log('图片 :', article.assets.length, '张');
console.log('标题 :', article.headingCount, '个 →', article.outline.map((o) => `H${o.level}:${o.text}`).join(' | '));
console.log('代码 :', (article.html.match(/<pre class="code-block"/g) || []).length, '个代码框');
console.log('段落 :', (article.html.match(/<p>/g) || []).length);
console.log('耗时 :', ((Date.now() - t0) / 1000).toFixed(1) + 's');

const res = await exportArticle(article, formats, { baseUrl: 'http://127.0.0.1:5178/' });
console.log('\n— 导出完成 —');
for (const f of res.files) console.log(f.format.padEnd(5), (f.size / 1024).toFixed(0).padStart(5) + ' KB', f.file);
console.log('库内文章数 :', listArticles().length);
