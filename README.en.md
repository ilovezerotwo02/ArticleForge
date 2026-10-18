# ArticleForge

[简体中文](README.md)

A local-first article toolkit: turn web pages, WeChat official account posts and local documents into clean Markdown / Word / PDF, then let AI reorganize them into knowledge notes and file them into your own knowledge base — Obsidian, Logrange, SiYuan, Notion, or any plain Markdown folder. It also handles the "finding" part: official-account and web search in one place, plus scheduled keyword watch.

Everything stays on your machine. Articles, chat history and settings live in `%APPDATA%\articleforge\data`; your API key is written only to your local config, and requests go only to the AI provider you choose.

## Why

Saved articles rot in bookmark folders. Saving is the easy part; turning an article into something that belongs to your own knowledge system is the hard part. ArticleForge turns that path into a pipeline:

```
Link / local document
  └─▶ Extract (ads removed, images localized, formulas kept)
      └─▶ Read / Export (Markdown / Word / PDF)
          └─▶ AI organize (points, relations, concepts)
              └─▶ Write to knowledge base (auto-routed, preview before write)
```

Each step works on its own; or run the whole thing end to end.

## Features

### Convert and export

- Paste a link (web or WeChat article) or upload PDF / DOCX / HTML / TXT / Markdown
- Readability-based extraction with per-node cleanup; remote images are downloaded and rewritten to local paths, so exports work offline
- Three outputs: Markdown (frontmatter + fenced code), Word (outline + shaded code blocks), PDF (A4 pagination)
- Reading view with outline navigation; a Markdown view shows the source

### AI organize and file into your knowledge base

- Works with any OpenAI-compatible endpoint: DeepSeek, Kimi, OpenAI, local models
- Choose a template, detail level and point limit before organizing; custom format requirements override everything
- **Directory routing**: the whole directory tree of your knowledge base is read (no depth limit), each folder annotated with existing note names as evidence; the AI picks a target and explains why, and the server validates the path so nothing gets invented
- **Append, don't duplicate**: when the target folder already contains a note on the same topic, the organized content is appended to that note (separator + dated heading) instead of creating a new file; one click in the preview switches to creating a new file
- **Preview before write**: result, target path and write mode are all confirmed before anything touches disk

### Knowledge base adapters

- Obsidian (direct vault writes), Logseq, any Markdown folder, SiYuan (API), Notion (API)
- Two layouts: single file (points, concepts and relations inlined) or multi file (concept cards + wiki links + index)

### Search and watch

- WeChat official accounts (via Sogou) and the web (360, Bing, DuckDuckGo, optional Tavily) queried in parallel, merged and deduplicated
- Filter by time range (24h to a year), sort by relevance or date
- WeChat results are resolved to real `mp.weixin.qq.com` addresses so one click starts the conversion
- Scheduled keyword watch, 15 minutes to 12 hours, with system notifications

### Reading sidebar

- Select text to ask, keep asking in a thread; answers cite where they came from
- Math (KaTeX) and Markdown tables render properly; code blocks are copyable

## Install

Grab `ArticleForge-1.0.0-portable.exe` from [Releases](https://github.com/ilovezerotwo02/ArticleForge/releases) and run it. Data lives in `%APPDATA%\articleforge\data`; to uninstall, delete the exe and that folder.

## Run from source

Node.js 18 or newer.

```bash
git clone https://github.com/ilovezerotwo02/ArticleForge.git
cd ArticleForge
npm install
npm run vendor   # copies marked / KaTeX into public/vendor
npm start        # opens http://127.0.0.1:5178
```

Desktop mode during development:

```bash
npm run app
```

`npm run vendor` is not optional: electron-builder prunes dependencies that are never imported (KaTeX got pruned that way), so marked and KaTeX live in `public/vendor`, copied from node_modules by the script.

## Build

```bash
npm run vendor
npm run icon        # regenerate icons after changing build/icon.png
npm run build:dir   # unpacked → release/win-unpacked
npm run build       # portable exe → release/ArticleForge-1.0.0-portable.exe
```

## Quick start

1. **AI**: Settings → AI model. Fill in base URL, key and model name. Without it, converting and exporting still work — only organizing is disabled.
2. **Knowledge base**: Settings → Knowledge base. Pick Obsidian and point to your vault, or pick a Markdown folder. The directory tree is read for routing.
3. **Grab an article**: paste a link, or upload a file.
4. **Organize**: "AI organize" → "Start (preview first)" → review → write.
5. **Watch**: add keywords on the Watch page; hits show up as notifications.

## Known limitations

- Free search sources fluctuate with your IP: DuckDuckGo sometimes refuses to connect, Sogou occasionally shows a captcha. Parallel sources plus retries cover most of it; a Tavily key makes things stable.
- Official-account search uses Sogou's index, which is smaller and older than WeChat's built-in search.
- Organizing quality depends on the model. Broken JSON is auto-repaired and retried; on total failure the raw text is saved instead, so nothing is lost.

## Layout

```
├── server.js            Express server and API routes
├── electron/            Main process (window, tray, data directory)
├── src/
│   ├── config.js        Settings storage and defaults
│   ├── extract.js       Content extraction and cleanup
│   ├── render.js        Reading / export page rendering
│   ├── ai.js            AI client, organizing, routing, merge target
│   ├── search.js        Multi-source search, WeChat link resolving
│   ├── watch.js         Keyword watch
│   ├── exporter.js      Markdown / DOCX / PDF export
│   └── kb/              Knowledge base adapters (Obsidian / Logseq / folder / SiYuan / Notion)
├── public/              Frontend; vendor holds marked and KaTeX
├── scripts/             Vendor sync, icon generation, dev helpers
└── data/                Runtime data (not committed, created on first run)
```

## License

[MIT](LICENSE)
