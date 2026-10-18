/** 把 marked / katex 拷进 public/vendor，保证桌面版打包时一定带上 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(ROOT, 'node_modules');
const out = path.join(ROOT, 'public', 'vendor');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

fs.rmSync(out, { recursive: true, force: true });

copyFile(path.join(nm, 'marked/lib/marked.umd.js'), path.join(out, 'marked/marked.umd.js'));

const katex = path.join(nm, 'katex/dist');
copyFile(path.join(katex, 'katex.min.js'), path.join(out, 'katex/katex.min.js'));
copyFile(path.join(katex, 'katex.min.css'), path.join(out, 'katex/katex.min.css'));
copyDir(path.join(katex, 'fonts'), path.join(out, 'katex/fonts'));

const size = (p) => {
  let total = 0;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(f);
      else total += fs.statSync(f).size;
    }
  };
  walk(p);
  return (total / 1024).toFixed(0) + ' KB';
};

console.log('vendor 就绪：', size(out), '→ public/vendor');
