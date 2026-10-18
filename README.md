# ArticleForge

[English](README.en.md)

一个跑在本机的文章整理工具：把网页、公众号文章、本地文档转成干净的 Markdown / Word / PDF，再用 AI 整理成知识笔记，写进你自己的知识库（Obsidian、Logseq、思源、Notion 或任意 Markdown 目录）。顺带解决了「找文章」和「追更新」的问题——公众号和网页检索放在同一次搜索里，关键词可以定时监控。

所有数据都留在本机。文章、聊天记录、设置存在 `%APPDATA%\articleforge\data`，API Key 只写进你本机的配置文件，请求只发给你自己填的 AI 服务商。

## 动机

收藏夹吃灰是常态。看到一篇好文章，存下来只是第一步，真正难的是把它变成自己知识体系里的一部分。ArticleForge 把这条链路做成了流水线：

```
文章链接 / 本地文档
  └─▶ 正文抽取（去广告、图片本地化、公式转本地）
      └─▶ 阅读 / 导出（Markdown / Word / PDF）
          └─▶ AI 整理（知识点抽取、建立关联）
              └─▶ 写入知识库（目录自动归类，先预览再落盘）
```

每一步都可以单独用，也可以从头走到尾。

## 功能

### 转换与导出

- 粘贴链接抓取网页和公众号文章，或上传 PDF / DOCX / HTML / TXT / Markdown
- 正文抽取基于 Readability，逐节点清洗；站内图片下载到本地改写路径，导出的文件离线可看
- 三种产物：Markdown（frontmatter + 围栏代码）、Word（大纲 + 底纹代码框）、PDF（A4 分页）
- 阅读视图带大纲导航，Markdown 视图可看源码

### AI 整理入库

- 兼容任何 OpenAI 格式的接口，DeepSeek、Kimi、OpenAI、本地模型都可以
- 整理前可以选模板、详细程度、知识点数量上限，也能写自己的格式要求（优先级最高）
- **目录自动归类**：读取你知识库的整棵目录树（不限层数），每个目录附带现有笔记名作为归类依据；AI 给出目标目录和理由，服务端校验路径合法性，防止编造
- **补充而非重建**：目标目录里已有同主题笔记时，默认把整理内容以分隔线 + 标题段落的形式追加到那份笔记末尾，不碰原有内容；预览里可以一键改成新建文件
- **先预览再写入**：整理结果、目标路径、写入方式都确认后才落盘

### 知识库对接

- Obsidian（vault 目录直写）、Logseq、任意 Markdown 目录、思源笔记（API）、Notion（API）
- 两种组织方式：单文件（知识点、概念、关联全部内联）或多文件（概念单独成卡 + 双链 + 索引）

### 检索与监控

- 公众号（搜狗微信）与网页（360、Bing、DuckDuckGo，可选 Tavily）多源并行，合并去重
- 按时间范围过滤（24 小时到一年）、按相关度或时间排序
- 公众号结果即时解析成真实 `mp.weixin.qq.com` 地址，点一下就能抓取
- 关键词定时监控，间隔 15 分钟到 12 小时，命中后系统通知，点击直达

### AI 阅读侧栏

- 划词提问、连续追问，回答会引用原文位置
- 数学公式（KaTeX）和 Markdown 表格正常渲染，代码块可复制

## 安装

到 [Releases](https://github.com/ilovezerotwo02/ArticleForge/releases) 下载 `ArticleForge-1.0.0-portable.exe`，双击即用，无需安装。数据在 `%APPDATA%\articleforge\data`，卸载时删掉 exe 和这个目录即可。

## 从源码运行

需要 Node.js 18 以上。

```bash
git clone https://github.com/ilovezerotwo02/ArticleForge.git
cd ArticleForge
npm install
npm run vendor   # 把 marked / KaTeX 拷进 public/vendor
npm start        # 浏览器打开 http://127.0.0.1:5178
```

桌面版开发模式：

```bash
npm run app
```

`npm run vendor` 不是可选步骤：electron-builder 会裁掉代码里没有 import 的依赖（KaTeX 就是这样被裁掉的），所以 marked 和 KaTeX 统一放 `public/vendor`，由脚本从 node_modules 拷入。

## 打包

```bash
npm run vendor
npm run icon        # 重新生成图标（改过 build/icon.png 时）
npm run build:dir   # 绿色版目录 → release/win-unpacked
npm run build       # 单文件便携版 → release/ArticleForge-1.0.0-portable.exe
```

## 快速上手

1. **配 AI**：设置 → AI 模型，填 API 地址、Key、模型名。不配也能转换导出，只是整理入库不可用
2. **配知识库**：设置 → 知识库，选 Obsidian 并指定 vault 路径，或选 Markdown 目录。保存后工具会读你的目录树
3. **抓一篇文章**：粘贴链接点抓取，或直接上传文件
4. **整理入库**：右下角「AI 整理并入库」→「开始整理」→ 预览确认 → 写入
5. **挂监控**：监控页加关键词，到点自动检查，命中的文章一键转进库

## 已知限制

- 免费搜索源的可用性随 IP 波动：DuckDuckGo 偶尔连不上，搜狗偶尔弹验证码。多源并行加自动重试能兜住大部分情况，要稳定可以填一个 Tavily Key
- 公众号检索走搜狗索引，覆盖量比微信内置搜索少一些、旧一些
- 整理质量取决于模型。JSON 输出异常会自动纠错重试，仍失败就退回纯文本保存，不会丢内容

## 目录结构

```
├── server.js            Express 服务与 API 路由
├── electron/            主进程（窗口、托盘、数据目录迁移）
├── src/
│   ├── config.js        设置读写与默认值
│   ├── extract.js       正文抽取与清洗
│   ├── render.js        阅读页 / 导出页渲染
│   ├── ai.js            AI 客户端、整理、目录树判断、合并目标判断
│   ├── search.js        多源检索、公众号链接解析
│   ├── watch.js         关键词监控
│   ├── exporter.js      Markdown / DOCX / PDF 导出
│   └── kb/              知识库适配器（Obsidian / Logseq / 目录 / 思源 / Notion）
├── public/              前端，vendor 下是 marked 与 KaTeX
├── scripts/             vendor 同步、图标生成等辅助脚本
└── data/                运行数据（不入库，首次启动自动创建）
```

## 许可

[MIT](LICENSE)
