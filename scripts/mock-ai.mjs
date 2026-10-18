import http from 'node:http';

const md = `## 核心概念

内存取证是在**不启动系统**的前提下，从内存镜像中提取进程、网络连接、注册表等证据。

### 三个关键命令

1. \`vol.py imageinfo\` — 识别系统版本，得到 profile
2. \`vol.py filescan\` — 扫描文件对象，找可疑文件
3. \`vol.py dumpfiles\` — 把文件从内存里导出来

## 操作步骤

先用 imageinfo 确认镜像是 Win7SP1x64：

\`\`\`bash
vol.py -f MemoryDump_Lab5.raw imageinfo
\`\`\`

再用 filescan 过滤桌面路径，定位可疑的 rar 文件。

> 注意：dump 出来的文件名可能丢失，需要靠文件头判断类型。

## 易错点

- 不加 \`--profile\` 会直接报错；
- 不同 Volatility 版本命令是 \`vol.py\` 与 \`volatility3\` 的区别。`;

const notes = {
  title: '内存取证练习10 · 知识笔记',
  summary: '通过 Volatility 对一个 Win7 内存镜像做取证，找到被访问的可疑文件并还原两个 flag。',
  tags: ['内存取证', 'Volatility', 'CTF'],
  markdown: md,
  points: [
    { title: 'Volatility', definition: '内存取证框架，通过 profile 解析内存结构。', detail: '用 imageinfo 得到 profile，再按插件提取进程、文件、注册表等信息。', relations: [{ target: '内存镜像', type: '前置' }] },
    { title: '内存镜像', definition: '物理内存的完整转储文件。', detail: '常见格式 .raw/.mem/.vmem，取证时只读分析。', relations: [{ target: 'Volatility', type: '相关' }] },
    { title: 'filescan', definition: '扫描内存中的文件对象。', detail: '配合 grep 过滤路径，可以快速定位桌面上的可疑文件。', relations: [{ target: 'Volatility', type: '包含' }] },
    { title: 'dumpfiles', definition: '把内存中的文件对象导出为磁盘文件。', detail: '需要提供物理地址（-Q），导出后按文件头判断真实类型。', relations: [{ target: 'filescan', type: '应用' }] },
  ],
  concepts: [
    { name: '内存镜像', definition: '物理内存的完整转储文件，取证分析的核心输入。', aliases: ['memory dump'] },
    { name: 'Volatility', definition: '开源内存取证框架，支持多平台内存结构解析。', aliases: ['vol.py'] },
  ],
  category: '',
  category_reason: '（测试空目录判断）',
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {}

      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const text = [
          '这篇文章记录了一次 **Win7 内存取证** 练习。',
          '',
          '| 部分 | 含义 |',
          '|---|---|',
          '| `python2` | 用 Python 2 解释器执行，Kali 下要显式写 |',
          '| `-f worldsills3.vmem` | 指定要分析的内存镜像 |',
          '| `--profile=Win7SP1x64` | 指定目标系统的 profile |',
          '| `truecryptmaster` | 扫描 TrueCrypt 驱动/进程残留 |',
          '',
          '预期输出：TrueCrypt 主密钥的十六进制值。',
          '',
          '举个例子，积分 $\\int (3x^2 + 2x + 1)\\,dx = x^3 + x^2 + x + C$，指数形式：',
          '',
          '$$\\int e^{2x}\\,dx = \\frac{1}{2}e^{2x} + C$$',
          '',
          '### 命令示例',
          '',
          '```bash',
          'python2 vol.py -f worldsills3.vmem --profile=Win7SP1x64 truecryptmaster',
          '```',
        ].join('\n');
        const parts = text.match(/[\s\S]{1,5}/g) || [];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= parts.length) {
            res.write('data: [DONE]\n\n');
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        }, 8);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(notes) } }] }));
    });
  })
  .listen(5199, '127.0.0.1', () => console.log('mock AI on 5199'));
