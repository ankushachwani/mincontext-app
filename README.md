# mincontext

**Find the exact files you need for any task in any GitHub repo.**

Paste a GitHub repository and a task description. mincontext returns the minimum set of files a developer would need to open to complete that task — nothing more, nothing less. Copy the results directly into Claude, ChatGPT, Cursor, or any AI coding tool.

---

## How it works

1. **Paste a GitHub repo** — any public repository, any language, any size
2. **Describe your task** — e.g. "add rate limiting middleware", "implement OAuth login", "add a custom health indicator"
3. **Get the file set** — copy the GitHub links directly into your AI tool of choice

The pipeline fetches the repository tree, pre-filters noise (tests, build artifacts, generated files, docs), fetches candidate file contents in parallel, builds an import graph to identify connected files, and runs two LLM passes: one to prune irrelevant candidates, one to verify completeness. The result is a small, precise set of files with a one-line explanation for each.

---

## Accuracy

Evaluated across **27 repositories** spanning 10 languages and a range of repository sizes (29 to 20,717 files):

| Metric | Score |
|--------|-------|
| Recall | 91% |
| Precision | 93% |
| File reduction | 98% |

**Recall** is the fraction of files a developer would actually need, that the pipeline returned. **Precision** is the fraction of returned files that were genuinely needed. **File reduction** is the fraction of repository files eliminated.

24 of 27 test cases produced fully correct output (100% recall and precision). The three exceptions are documented in [`docs/results.md`](docs/results.md) along with their root causes.

---

## Usage

### Web app

[mincontext.app](https://mincontext.app) — requires a free [Groq API key](https://console.groq.com). Takes 2 minutes to set up, no credit card needed. Your key is stored only in your browser and never sent to our servers.

The pipeline uses `llama-3.3-70b-versatile` — the model all evaluation numbers above reflect.

### Self-hosting

```bash
git clone https://github.com/your-username/mincontext
cd mincontext
npm install
```

Create `.env.local`:

```
GROQ_API_KEY=gsk_your_key_here
```

Get a free key at [console.groq.com](https://console.groq.com) — no credit card required.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Pipeline

```
GitHub tree API
  → pre-filter: strip tests, build artifacts, docs, generated files
  → IDF-weighted path scoring: select up to 80 candidate files
  → fetch all candidate contents in parallel (batched)
  → rescue pass: sample cut files by content score, promote if stronger than weakest candidate
  → parse imports/exports/symbols per file (JS/TS, Python, Go, Rust, Ruby, Java, PHP)
  → build import graph → BFS from keyword-matching roots → reorder by relevance
  → LLM prune pass: keep/remove decision per file with structural role annotations
  → LLM sufficiency check: citation-gated base class recovery + registration file detection
  → final file set with per-file reasoning
```

The LLM receives structured file summaries — parsed imports, exports, symbols, and the first 15 lines of code — not raw file dumps. This keeps prompts compact and latency low while giving the model enough signal to make accurate keep/remove decisions.

---

## Stack

- [Next.js 14](https://nextjs.org) — App Router, Edge Functions
- [Groq](https://groq.com) — LLM inference (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`)
- GitHub REST API — repository tree and raw file content
- Vercel KV — shared result cache (server-side, 7-day TTL)

---

## Deploying

1. Push to GitHub, import project on [Vercel](https://vercel.com)
2. Add environment variable: `GROQ_API_KEY=gsk_...`
3. Vercel dashboard → Storage → Create KV database → Connect to project
4. Deploy

The KV cache means the first request for a given repo/task pays the LLM cost; all subsequent users receive the cached result in ~500ms with no model call.

---

## License

MIT
