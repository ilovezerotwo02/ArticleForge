<div align="center">

# 📚 ArticleForge

**把任意文章，变成可归档的知识**

网页 / 公众号文章 / 本地文档 → 干净的 Markdown · Word · PDF → AI 整理成知识笔记 → 写入你自己的知识库（Obsidian / Logseq / 思源 / Notion）。顺带解决「找文章」和「追更新」：全网检索 + 免验证码安全情报源 + 关键词监控推送。

[![Release](https://img.shields.io/github/v/release/ilovezerotwo02/ArticleForge?style=flat-square&color=4f46e5)](https://github.com/ilovezerotwo02/ArticleForge/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-4f46e5?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011-0078d4?style=flat-square&logo=windows11)](https://github.com/ilovezerotwo02/ArticleForge/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-33-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Stars](https://img.shields.io/github/stars/ilovezerotwo02/ArticleForge?style=flat-square&color=e8590c&logo=github)](https://github.com/ilovezerotwo02/ArticleForge/stargazers)

**免安装 · 完全免费开源 · 数据全部留在本机 · 兼容任何 OpenAI 格式的 AI（DeepSeek / Kimi / 通义 / Ollama）**

[⬇️ 下载最新版](https://github.com/ilovezerotwo02/ArticleForge/releases/latest) · [✨ 功能总览](#功能) · [🚀 快速上手](#快速上手) · [🐛 反馈问题](https://github.com/ilovezerotwo02/ArticleForge/issues)

![ArticleForge 主界面 · 资料库与用户标签](docs/screenshots/library.png)

</div>

[English](README.en.md)

| ✨ 一眼看亮点 | |
|---|---|
| 🔍 **全网检索** | 公众号四路并行（搜狗 + 百度 + Bing + RSS 实时源）、免验证码安全情报源（GitHub / NVD / CISA KEV / Exploit-DB / 安全客 / 先知…）、关键词相关度门禁，结果按真实发布日期排序 |
| ⏰ **关键词监控** | 定时盯关键词，命中按打分排序、跨源去重，推送钉钉 / 飞书 / 企业微信 / Telegram，自动生成 Obsidian 监控日报 |
| 🤖 **AI 整理入库** | 划词提问、按模板整理知识点、自动判断归属目录、补充而非重建，先预览再写入 |
| 📝 **待办便签** | 随手记没完成的事：便签可以拖到窗口任意位置，切到别的页面也一直显示、📌 固定防误拖、做完打勾归档 |
| 🎨 **自定义背景** | 上传任意照片当应用背景，遮暗 / 模糊 / 面板浓度 / 饱和度 / 填充方式五项参数实时可调，正文阅读区也一起透 |
| 🗂 **侧栏可收起** | 资料库栏与 AI 栏一键收起 / 展开（收起后窗口边缘留小拉手唤回），状态自动记忆，正文瞬间铺满全屏 |
| 🔒 **本机优先** | 文章、便签、设置、API Key 全部存在本机 %APPDATA%，请求只发给你自己配的 AI 服务商 |

<table>
<tr>
<td width="33%" align="center"><b>全网检索 · 按时间排序</b><br><img src="docs/screenshots/search.png" alt="检索"></td>
<td width="33%" align="center"><b>待办便签 · 拖动 / 固定 / 打勾</b><br><img src="docs/screenshots/todo.png" alt="待办"></td>
<td width="33%" align="center"><b>知识库目录树 · 应用内直接读</b><br><img src="docs/screenshots/kb.png" alt="知识库"></td>
</tr>
</table>

---


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
- **用户标签**：每篇文章可自己打标签（内置「未完成 / 进行中 / 已完成 / 重要」快选，也可自定义），资料库顶部按标签一键筛选——追没看完、没办完的事就点一下「未完成」
- **「未完成」徽章**：资料库标题栏常驻「未完成 N」计数，点一下直接过滤出所有没办完的事
- **待办便签板**：独立「待办」页，随手记自己没完成的事——便签不关在板子里，可以拖到窗口任意位置，切到检索 / 知识库 / 阅读页都一直漂浮显示、📌固定防误拖、做完打勾归档（自动去灰），导航图标带未完成计数
- **自定义背景**：设置 → 个性化背景，上传任意照片当应用背景，可调遮暗与模糊，全界面半透明适配（含正文阅读区与 Markdown / 大纲 / 相关文章视图）
- **侧栏可收起**：资料库栏和 AI 阅读栏都能一键收起（面板上的 « » 按钮），收起后点窗口边缘的小拉手展开，状态自动记忆——像 Obsidian 一样把正文铺满全屏

### AI 整理入库

- 兼容任何 OpenAI 格式的接口，DeepSeek、Kimi、OpenAI、本地模型都可以
- 整理前可以选模板、详细程度、知识点数量上限，也能写自己的格式要求（优先级最高）
- **目录自动归类**：读取你知识库的整棵目录树（不限层数），每个目录附带现有笔记名作为归类依据；AI 给出目标目录和理由，服务端校验路径合法性，防止编造
- **补充而非重建**：目标目录里已有同主题笔记时，默认把整理内容以分隔线 + 标题段落的形式追加到那份笔记末尾，不碰原有内容；预览里可以一键改成新建文件
- **先预览再写入**：整理结果、目标路径、写入方式都确认后才落盘

### 知识库对接

- Obsidian（vault 目录直写）、Logseq、任意 Markdown 目录、思源笔记（API）、Notion（API）
- 两种组织方式：单文件（知识点、概念、关联全部内联）或多文件（概念单独成卡 + 双链 + 索引）
- **应用内笔记浏览器（目录树）**：知识库页按你知识库原本的目录树展示 md（文件夹可展开/折叠、带篇数，按笔记名/目录筛选时自动展开命中分支），点开就在应用里看渲染好的正文，右侧自带**标题目录**——点标题平滑跳转、滚动正文自动高亮当前小节，还能一键「用默认软件打开」——不用再开一个软件（思源 / Notion 是 API 模式，暂不支持）

### 检索与监控

- 公众号四路并行：搜狗微信（**最多翻 10 页 ≈ 100 条/关键词**）+ 百度 `site:mp.weixin.qq.com`（直接给真实 mp 地址和发布日期）+ Bing `site:mp.weixin.qq.com`（收录普遍比百度新鲜，**强制只留真公众号链接**——Bing 在 site: 命中太少时会自动「放宽查询」混入无关站点，这里已收紧）+ **公众号 RSS 实时源**（wechat2rss，feed 里就是刚推送的文章，不受搜索引擎收录延迟影响）
- **按时间排序严格从新到旧**：解析不出发布日期的结果固定垫底；选了时间范围或「按时间」时，百度自动带 `gpc=stf` **收录时间窗**、Bing 自动带 `qft=interval` 时间过滤（专治「搜出来的全是几个月前的旧文」，百度窗内没结果会自动回退全量检索）
- **Bing 资讯 RSS**：网页侧新增的免验证码实时源，自带发布日期，「找最新」优先出它；配了 Tavily 时短时间窗（24 小时/一周）自动切 news 话题
- **安全情报源（免验证码）**：GitHub（仓库+Issue）/ NVD / CISA KEV（在野利用）/ Exploit-DB / MITRE CVE / 安全客 / 先知 / FreeBuf / 知道创宇 / 绿盟 / The Hacker News / BleepingComputer，全部走官方 API 与 RSS——不经过搜索引擎，**永远不会弹 Cookie 验证**；搜「CVE-xxxx」还会直查 MITRE 官方记录
- **关键词相关度门禁**：搜狗微信在时间窗内没内容时会回「标题里带个内存就算命中」的近似结果——相关结果够多时直接过滤无关项，不够多时沉底，全都不相关时明说，绝不冒充搜索结果
- **情报源相关度门禁**：GitHub 中文分词会把「内存取证」拆成 内存+取证 分别匹配，搜出一堆各含一词的无关仓库——现在按相关度排序（不再按更新时间），只有**完整短语命中**或全部词命中的结果才收录；Exploit-DB 的最新条目在带关键词搜索时也必须命中关键词
- 查询里带安全类关键词（漏洞 / exploit / 红队 / 渗透…）时，「全部来源」会自动并入情报源，不用手动切换
- 每个源都能翻页，「翻页数」可选 2/3/5/8/10 页，结果还能「加载更多页」；单次结果上限 200 条
- 按时间范围过滤（24 小时到一年）、按相关度或时间排序；**发布日期是从结果里真实解析的**，范围内没结果会回退「最新几条」并明确告知
- 相关度排序综合：标题 / 摘要 / 公众号名分词命中 + 整个查询短语直击标题 + 新鲜度轻加权（同等相关度时新文靠前）
- 公众号结果即时解析成真实 `mp.weixin.qq.com` 地址，点一下就能抓取；设置里还能填**公众号 RSS 订阅**（wechat2rss），给公众号监控加一路永不验证码的源
- 关键词定时监控：来源可选 全网 / 公众号 / 网页 / 安全情报；命中按**打分排序**（关键词命中 + 官方源加权 + 新鲜度），跨源重复报道按标题相似度去重
- 监控命中可推 **Webhook**：钉钉（支持加签）/ 飞书 / 企业微信 / Telegram / 自定义 JSON 接口
- 每个监控任务自动生成**监控日报 Markdown**（frontmatter + 分轮次命中列表），默认写进知识库的「监控」目录，Obsidian / Typora 里直接看、直接编辑，不用换软件
- 源被限流会自动熔断并退避（反爬判定从 5 分钟起、上限 15 分钟），同一源请求串行化 + 抖动量速，不拖慢整次搜索
- 直连被反爬拦下时自动换**内置浏览器会话**重跑；搜狗对 IP 弹点击式验证码时，界面会有「打开浏览器过验证」按钮，人工过一次后本机 Cookie 复用，随后自动重搜（用安全情报源监控则完全不会走到这一步）

### AI 阅读侧栏

- 划词提问、连续追问，回答会引用原文位置
- 数学公式（KaTeX）和 Markdown 表格正常渲染，Obsidian 的 ==高亮== 语法照常显示，代码块可复制

## 安装

**方式一 · 安装版（推荐）**：到 [Releases](https://github.com/ilovezerotwo02/ArticleForge/releases/latest) 下载 `ArticleForge-1.0.7-setup.exe` 双击安装，桌面快捷方式直接可用。

**方式二 · 便携版**：下载 `ArticleForge-1.0.7-portable.exe` 双击即用，无需安装。

- 数据全部存在 `%APPDATA%\articleforge\data`，卸载时删掉 exe 和这个目录即可
- 安装包未做代码签名，首次运行若被 SmartScreen 拦截，点「更多信息 → 仍要运行」即可（完全开源，可自行审查或从源码运行）

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
npm run build       # 单文件便携版 → release/ArticleForge-1.0.7-portable.exe
```

## 快速上手

1. **配 AI**：设置 → AI 模型，填 API 地址、Key、模型名。不配也能转换导出，只是整理入库不可用
2. **配知识库**：设置 → 知识库，选 Obsidian 并指定 vault 路径，或选 Markdown 目录。保存后工具会读你的目录树
3. **抓一篇文章**：粘贴链接点抓取，或直接上传文件
4. **整理入库**：右下角「AI 整理并入库」→「开始整理」→ 预览确认 → 写入
5. **挂监控**：监控页加关键词，到点自动检查，命中的文章一键转进库

## 已知限制

- 免费搜索源的可用性随 IP 波动：DuckDuckGo 在国内多数网络不可达（已自动熔断跳过），搜狗/百度连续请求会弹验证码。**安全情报源全部走 API/RSS，没有验证码问题**；要更稳可以填一个 Tavily Key
- 情报源里的 Google News / Reddit / Hacker News 在国内直连不可达，会自动熔断跳过（有代理即自动恢复），不影响其余源
- 公众号检索靠搜狗 + 百度 + Bing 的公开索引，覆盖量仍小于微信内置「搜一搜」，且收录都有延迟（搜狗以天计、百度以月计）——**要真正的「最新」请配置公众号 RSS（wechat2rss）**，feed 是实时推送的，配置后公众号搜索/监控会自动并入这一路；「按时间」排序时百度还会强制带收录时间窗
- 搜狗的 `sort`/`tsn`/`ft`/`et`（按时间）参数已被官方忽略，所以「按时间」是本地解析发布日期后重排；解析不出日期的结果垫底，不会冒充新文
- 360 的结果页不提供发布日期，这类结果在时间过滤时会被标为「日期未标注」而非当作新内容
- GitHub 搜索匿名额度 10 次/分钟，NVD 无 Key 5 次/30 秒——监控任务多时建议在设置里填 GitHub Token / NVD Key
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
│   ├── intel.js         免验证码情报源聚合（GitHub/NVD/KEV/EDB/CVE/社区 RSS/公众号 RSS）
│   ├── health.js        源健康度熔断（指数退避、冷却跳过）
│   ├── util.js          日期解析 / 标题相似度等共享工具
│   ├── watch.js         关键词监控（打分、去重、Webhook、Markdown 日报）
│   ├── exporter.js      Markdown / DOCX / PDF 导出
│   └── kb/              知识库适配器（Obsidian / Logseq / 目录 / 思源 / Notion）
├── public/              前端，vendor 下是 marked 与 KaTeX
├── scripts/             vendor 同步、图标生成、冒烟测试等辅助脚本
└── data/                运行数据（不入库，首次启动自动创建）
```

## 支持项目

如果 ArticleForge 帮你省下了时间，欢迎点一个 ⭐ Star —— 这是纯开源个人项目的全部动力；也欢迎 [提 Issue](https://github.com/ilovezerotwo02/ArticleForge/issues) 反馈 bug 和想要的功能。

[![Star History Chart](https://api.star-history.com/svg?repos=ilovezerotwo02/ArticleForge&type=Date)](https://star-history.com/#ilovezerotwo02/ArticleForge&Date)

## 许可

[MIT](LICENSE)
