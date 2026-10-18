/**
 * 代码块识别与重建
 *
 * 微信文章里代码绝大多数不是 <pre>，而是"字号更小 + 全是 ASCII + 以命令开头"的普通段落。
 * 这里做两件事：
 *   1. 真实 <pre>/<code> 直接规范化成带代码框的 block
 *   2. 纯文本行按启发式打分，连续代码行合并成一个 block，并自动识别语言
 */
import { fontSizePx, isBold, estimateBodyFontSize } from './headings.js';

const CMD_START =
  /^(\$|#|>|PS[ >]|C:\\[^>]*>|[a-z]:\\[^>]*>|\/\/|>>>|\.\.\.\s)/i;

const KNOWN_TOOLS =
  /^(vol\.py|volatility|python3?|pip3?|git|npm|pnpm|yarn|npx|node|curl|wget|ssh|scp|nc|ncat|nmap|sqlmap|msfconsole|msfvenom|gobuster|dirb|dirsearch|ffuf|hydra|john|hashcat|binwalk|strings|xxd|hexdump|file|exiftool|tcpdump|tshark|wireshark|sudo|apt|apt-get|yum|brew|docker|docker-compose|kubectl|systemctl|service|ps|kill|chmod|chown|cat|ls|cd|cp|mv|rm|mkdir|grep|awk|sed|find|sort|uniq|head|tail|echo|printf|export|source|tar|unzip|zip|7z|rar|openssl|base64|md5sum|sha256sum|whoami|netstat|ifconfig|ipconfig|reg|powershell|cmd|r2|radare2|ida64?|ghidra|gdb|objdump|readelf|jadx|apktool|frida|adb|xray|burpsuite|dirbuster|nikto|whatweb|wpscan|searchsploit|impacket|smbclient|rpcclient|evil-winrm|crackmapexec|responder|ettercap|aircrack-ng|reaver|autopsy|ftk|memdump|procdump|mimikatz|bloodhound|mssqlclient|redis-cli|mysql|mongo|psql)/i;

const CODE_FILE = /\b[\w./\\-]+\.(py|sh|bash|ps1|bat|cmd|exe|dll|sys|raw|mem|vmem|txt|log|php|js|ts|java|c|cpp|h|go|rs|rb|pl|sql|json|yaml|yml|xml|html|css|conf|ini|pcap|pcapng|zip|rar|7z|tar|gz|img|iso)\b/i;

const SYMBOLS = /[{}[\]()=;<>$|#/\\`~^&*+%!@:]/g;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isLeafBlock(el) {
  if (!/^(P|DIV|SECTION|LI)$/.test(el.tagName)) return false;
  if (el.closest('pre, code, table, ul, ol, blockquote, figure')) return false;
  for (const c of el.children) {
    if (/^(P|DIV|SECTION|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|FIGURE)$/.test(c.tagName)) return false;
  }
  return true;
}

function mono(el) {
  const s = (el.getAttribute('style') || '') + ' ' + (el.getAttribute('class') || '');
  if (/monospace|consolas|courier|menlo|monaco|source code|fira code|jetbrains/i.test(s)) return true;
  return [...el.querySelectorAll('span,code')].some((n) =>
    /monospace|consolas|courier|menlo|monaco/i.test((n.getAttribute('style') || '') + (n.getAttribute('class') || ''))
  );
}

function textOf(el) {
  let t = '';
  const walk = (n) => {
    if (n.nodeType === 3) t += n.textContent;
    else if (n.nodeType === 1) {
      if (n.tagName === 'BR') t += '\n';
      else n.childNodes.forEach(walk);
    }
  };
  walk(el);
  return t.replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
}

function looksLikeCode(text, el, bodySize) {
  const t = text.replace(/\r/g, '').trim();
  if (!t || t.length > 400) return false;

  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const cjkRatio = cjk / t.length;
  const symbols = (t.match(SYMBOLS) || []).length;
  const symbolRatio = symbols / t.length;
  const spaces = (t.match(/\s/g) || []).length;
  const fs = fontSizePx(el);
  const smaller = fs > 0 && bodySize > 0 && fs <= bodySize - 1.2;
  const isMono = mono(el);
  const cmdStart = CMD_START.test(t) || KNOWN_TOOLS.test(t.trim());
  const hasFlag = /^[\w-]*\{[\w!@#$%^&*_\-=+]{6,}\}$/.test(t);

  // 中文长句一定不是代码
  if (cjkRatio > 0.28) return false;
  // 带句号结尾的中文段落不是代码
  if (/[\u4e00-\u9fa5]。\s*$/.test(t)) return false;

  let score = 0;
  if (isMono) score += 2.5;
  if (smaller) score += 2;
  if (cjk === 0) score += 1.2;
  if (symbolRatio > 0.1) score += 1.2;
  if (symbolRatio > 0.22) score += 0.8;
  if (cmdStart) score += 2.5;
  if (/--?[a-zA-Z][\w-]*/.test(t)) score += 1;
  if (CODE_FILE.test(t)) score += 1.2;
  if (hasFlag) score += 1;
  if (/\s{2,}\S/.test(t)) score += 0.4;

  // 低于阈值的拒绝；纯 ASCII 但没有任何代码特征（如英文短句）也拒绝
  if (score < 3.2) return false;
  if (!(isMono || smaller || cmdStart || symbolRatio > 0.18)) return false;
  // 无空格的纯字母串（比如变量名、flag）不单独成块
  if (spaces === 0 && !cmdStart && !isMono) return false;
  return true;
}

export function detectLanguage(code) {
  const t = code.trim();
  if (/^(PS[ >]|PS>|Get-[A-Z]|Set-[A-Z]|Invoke-[A-Z]|New-Item|Write-Host|\$env:)/im.test(t)) return 'powershell';
  if (/^(>>>|import |from .+ import |def |class .+:|print\()/m.test(t)) return 'python';
  if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\b/i.test(t) && /;|\bFROM\b/i.test(t)) return 'sql';
  if (/^\{[\s\S]*\}$/.test(t) && /"[^"]+"\s*:/.test(t)) return 'json';
  if (/^\s*(---\s*$|[\w-]+:\s+\S+)/m.test(t) && !/\$|;/.test(t) && /:\s/.test(t) && !/^(https?):/i.test(t)) return 'yaml';
  if (/<(!DOCTYPE|html|div|span|script|body|head)\b/i.test(t)) return 'html';
  if (/^\s*(#include|int main|printf\(|std::|using namespace)/m.test(t)) return 'c';
  if (/\b(public class|System\.out\.println|import java\.)/.test(t)) return 'java';
  if (/\b(const |let |var |=>|console\.log|function\s*\w*\s*\()/.test(t)) return 'javascript';
  if (/^\s*(curl|wget|sudo|apt|git|npm|pip|python3?|docker|kubectl|ssh|nmap|vol\.py|volatility|echo|cat|ls|cd|grep|chmod|find|binwalk|strings|tar|unzip)\b/m.test(t)) return 'bash';
  if (/^(\$|#)\s/m.test(t)) return 'bash';
  return 'text';
}

function buildCodeBlock(doc, code, lang, { inline = false } = {}) {
  const pre = doc.createElement('pre');
  pre.className = 'code-block';
  pre.setAttribute('data-lang', lang || 'text');
  const codeEl = doc.createElement('code');
  codeEl.textContent = code.replace(/\s+$/, '');
  pre.appendChild(codeEl);
  return pre;
}

/**
 * 处理已有 <pre>
 */
function normalizePre(doc, pre) {
  if (pre.closest('.code-block')) return;
  const codeEl = pre.querySelector('code');
  let raw = textOf(codeEl || pre);
  const lang =
    codeEl?.getAttribute('class')?.match(/language-([\w+-]+)/)?.[1] ||
    pre.getAttribute('data-lang') ||
    '';
  const block = buildCodeBlock(doc, raw.replace(/^\n+/, ''), (lang || detectLanguage(raw)).toLowerCase());
  pre.replaceWith(block);
}

/**
 * 把纯文本代码行合并为代码块
 */
export function detectCodeBlocks(container, doc) {
  const body = estimateBodyFontSize(container);

  // 1. pre 规范化
  [...container.querySelectorAll('pre')].forEach((pre) => normalizePre(doc, pre));
  // 2. 独立 code 段落（<p><code>...</code></p>）
  for (const el of [...container.querySelectorAll('p')]) {
    const kids = [...el.children];
    if (kids.length === 1 && kids[0].tagName === 'CODE' && !kids[0].closest('pre')) {
      const raw = textOf(kids[0]);
      if (raw.trim().length > 3) {
        el.replaceWith(buildCodeBlock(doc, raw.trim(), detectLanguage(raw)));
      }
    }
  }

  // 3. 行级识别 + 相邻合并
  const groups = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    groups.push(current);
    current = null;
  };

  for (const el of [...container.querySelectorAll('p, div, section, li')]) {
    if (!isLeafBlock(el)) continue;
    if (el.closest('pre.code-block')) continue;
    if (el.hasAttribute('data-af-heading') || /^H[1-6]$/.test(el.tagName)) {
      flush();
      continue;
    }
    if (el.querySelector('img, table, video, iframe')) {
      flush();
      continue;
    }
    const text = textOf(el);
    if (!text.trim()) continue;

    if (looksLikeCode(text, el, body)) {
      if (!current) current = { lines: [] };
      current.lines.push(text.replace(/\s+$/, ''));
      current.nodes = current.nodes || [];
      current.nodes.push(el);
    } else {
      flush();
    }
  }
  flush();

  for (const g of groups) {
    if (!g.lines.length) continue;
    const code = g.lines.join('\n');
    // 单行且过短、且不像命令的，保留为段落更自然
    if (g.lines.length === 1 && code.trim().length < 8) continue;
    const block = buildCodeBlock(doc, code, detectLanguage(code));
    g.nodes[0].replaceWith(block);
    g.nodes.slice(1).forEach((n) => n.remove());
  }
}

export { buildCodeBlock, textOf };
