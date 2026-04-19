# mincontext

<p align="center">
  <strong>Find the minimum set of files needed for any task in any codebase.</strong><br/>
  <sub>Paste a repo. Describe what you're building. Get exactly the files worth reading — nothing more.</sub>
</p>

<p align="center">
  <a href="https://mincontext.dev">
    <img alt="Website" src="https://img.shields.io/badge/website-mincontext.dev-000000?style=for-the-badge&logo=vercel&logoColor=white" />
  </a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
  &nbsp;
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-black" />
  &nbsp;
  <img alt="Model" src="https://img.shields.io/badge/model-llama--3.3--70b-orange" />
  &nbsp;
  <img alt="Node" src="https://img.shields.io/badge/node-18+-green" />
</p>

---

mincontext figures out which files in a codebase are actually relevant to what you're building. Give it a GitHub repo and a task description — it returns a small, precise set of files to read or modify, cutting out everything else. Copy the results straight into Claude, Cursor, ChatGPT, or any AI coding tool.

Available as a **web app** and a **CLI**.

---

## Results

Evaluated across **27 repositories** spanning 10 languages, from 29 to 20,717 files:

| Metric | Score |
|--------|-------|
| Recall | 91% |
| Precision | 93% |
| File reduction | 98% |

24 of 27 test cases produced fully correct output (100% recall and precision). The three exceptions are documented in [`docs/results.md`](docs/results.md).

---

## Web App

Live at [mincontext.dev](https://mincontext.dev) — no setup needed. To run it locally:

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- A free [Groq API key](https://console.groq.com) (no credit card required)

### Setup

```bash
git clone https://github.com/ankushachwani/mincontext-app
cd mincontext-app
npm install
```

Create a `.env.local` file in the project root:

```bash
GROQ_API_KEY=gsk_your_key_here
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### How to use

1. Enter a GitHub repo (`owner/repo` or full URL)
2. Describe the task you're working on
3. mincontext returns the relevant files with reasoning
4. Copy the file links into your AI tool of choice

---

## CLI

Install once, use anywhere:

```bash
npm install -g mincontext
```

Requires Node.js 18+. Supports GitHub repos and local codebases. Works with Groq (free, cloud) or Ollama (local, no account needed).

### Getting started

```bash
mincontext
```

Opens an interactive session. On first launch you'll pick an LLM backend and a source — a GitHub repo or a local directory. After that, just describe your task.

```
  task › add rate limiting middleware

  ── add rate limiting middleware ────────────────────────────────

  ✓  Fetching tree
  ✓  Fetching files
  ✓  Analyzing
  ✓  Narrowing down
  ✓  Verifying

  ✓  6 files  ·  ~9.2k tokens

  lib/application.js
    Core app — where middleware is registered via app.use()
  lib/router/index.js
    Router implementation — processes the middleware stack
  lib/router/route.js
    Route handler — individual route dispatch
  lib/router/layer.js
    Layer — wraps each middleware function
  lib/utils.js
    Shared utilities referenced across the stack
  index.js
    Entry point

  [c] copy file paths   [j] json   [↵] new task   [q] quit
```

### Commands

Type `/` at any prompt to open the command menu with live filtering and arrow-key navigation.

| Command | Description |
|---------|-------------|
| `/repo` | Set the GitHub repo to analyze |
| `/local` | Analyze the current directory — auto-detects git root |
| `/dir` | Set a specific local path |
| `/groq` | Switch to Groq — free cloud LLM |
| `/ollama` | Switch to Ollama — runs locally, model downloads automatically |
| `/key` | Update your Groq API key |
| `/copy` | Copy file paths from the last result to clipboard |
| `/clear` | Clear the screen |
| `/quit` | Exit |

---

## How it works

The same pipeline runs on both the web app and the CLI:

```
repo / local directory
  → strip noise: tests, build artifacts, docs, generated files
  → IDF-weighted path scoring → select up to 80 candidates
  → fetch file contents in parallel
  → rescue pass: promote cut files that outscore the weakest candidates
  → parse imports/exports/symbols, build import graph, reorder by connectivity
  → LLM prune: keep/remove per file with structural role annotations
  → LLM sufficiency check: recover missing base classes + framework entry files
  → final set with per-file reasoning
```

The LLM receives structured summaries — parsed symbols and the first 15 lines of each file — not raw content. This keeps prompts compact and latency low. Results are cached for 24 hours.

---

## Stack

| | |
|---|---|
| Framework | [Next.js 14](https://nextjs.org) (App Router) |
| Inference | [Groq](https://groq.com) — `llama-3.3-70b-versatile` |
| CLI | Node.js 18+, [chalk](https://github.com/chalk/chalk), [enquirer](https://github.com/enquirer/enquirer) |
| Data | GitHub REST API |
| Cache | Vercel KV (server) · localStorage (browser) · `~/.cache/mincontext` (CLI) |

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
