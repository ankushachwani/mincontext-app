# mincontext

**Find the minimum set of files needed for any task — in your terminal.**

Paste a GitHub repo or point it at a local directory. Describe what you're building. Get back exactly the files worth reading, nothing more. The same AI pipeline as [mincontext.dev](https://mincontext.dev), running locally.

```
  task › add rate limiting middleware

  ── add rate limiting middleware ────────────────────────────

  ✓  Fetching tree
  ✓  Fetching files
  ✓  Analyzing
  ✓  Narrowing down
  ✓  Verifying

  ✓  6 files  ·  ~9.2k tokens

  lib/application.js
  lib/router/index.js
  lib/router/route.js
  lib/router/layer.js
  lib/utils.js
  index.js
```

---

## Install

```bash
npm install -g mincontext
```

Requires Node.js 18+. Run once — `mincontext` is then available anywhere in your terminal.

---

## Usage

```bash
mincontext
```

Opens an interactive session. On first launch you'll pick an LLM backend and a source — a GitHub repo or a local directory. After setup, just describe your task and get results.

---

## Commands

Type `/` at any prompt to open the command menu with live filtering and arrow-key navigation. Or type the command name directly.

| Command | Description |
|---------|-------------|
| `/repo` | Set the GitHub repo to analyze |
| `/local` | Analyze the current directory — auto-detects git root and requests access |
| `/dir` | Set a specific local path |
| `/groq` | Switch to Groq — free cloud LLM, fastest option |
| `/ollama` | Switch to Ollama — runs entirely on your machine, model downloads automatically |
| `/key` | Update your Groq API key |
| `/copy` | Copy file paths from the last result to clipboard |
| `/clear` | Clear the screen |
| `/quit` | Exit |

---

## LLM backends

### Groq (recommended)
Fast, free, runs in the cloud. Get a key at [console.groq.com](https://console.groq.com) — no credit card needed. Set it once with `/key` or via the environment:

```bash
export GROQ_API_KEY=gsk_...
```

### Ollama
Runs entirely on your machine — no account, no data leaving your system. Install from [ollama.com](https://ollama.com). Select `/ollama` in the session and the model downloads automatically on first use.

---

## How it works

1. Fetches the file tree from GitHub or walks the local filesystem
2. Scores candidates by IDF-weighted keyword relevance
3. Builds an import graph and reorders by structural connectivity
4. Sends compact, structured summaries to an LLM for pruning — not raw file dumps
5. Runs a sufficiency check to recover missing base classes or framework entry files
6. Returns the minimum file set with per-file reasoning

The same pipeline powers [mincontext.dev](https://mincontext.dev). Results are cached locally for 24 hours — re-running the same task is instant.

---

## License

[MIT](https://github.com/ankushachwani/mincontext-app/blob/main/LICENSE)
