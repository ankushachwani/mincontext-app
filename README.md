# mincontext

**Find the exact files you need for any task in any GitHub repo.**

Instead of pasting an entire codebase into an AI assistant, mincontext analyzes the repo and returns only the files that matter for your specific task. The AI reads actual file contents and import graphs — not just filename keywords.

---

## How it works

1. **Paste a GitHub repo** — any public repo, any language, any size
2. **Describe your task** — "add rate limiting middleware", "implement OAuth login", "fix memory leak in event loop"
3. **Get the exact files** — copy the GitHub links directly into Claude, ChatGPT, Cursor, or any AI tool

---

## Features

- **Reads actual code** — builds an import graph, then uses an LLM to evaluate candidates by reading file contents and exports
- **Any language** — JavaScript, TypeScript, Python, Go, Rust, Ruby, Java, and more
- **No false positives** — only returns files you would actually open to implement the task
- **Fast** — tree fetch + parallel content fetch + single LLM call, typically under 15 seconds
- **Your key, your quota** — add your free [Groq API key](https://console.groq.com) for higher accuracy and unlimited use

---

## Self-hosting

```bash
git clone https://github.com/your-username/mincontext
cd mincontext
npm install
```

Create a `.env.local` file:

```
GROQ_API_KEY=gsk_your_key_here
```

Get a free key at [console.groq.com](https://console.groq.com) — no credit card required.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Architecture

```
GitHub tree API
  → filter noise (test files, build artifacts, docs)
  → fetch all file contents in parallel
  → parse imports/exports per file
  → build import graph + BFS ordering (keyword-connected files first)
  → LLM binary pruning: keep/remove per file
  → sufficiency check: add back any missing critical files
  → final file set with reasons
```

The LLM receives structured summaries — what each file exports, imports, and defines — not raw file dumps. This keeps token usage low and latency fast.

**Models:**
- Without API key: `llama-3.1-8b-instant` (Groq shared quota)
- With your own API key: `llama-3.3-70b-versatile` (higher accuracy, your own quota)

---

## Stack

- [Next.js 14](https://nextjs.org) — App Router, Edge Functions
- [Groq](https://groq.com) — LLM inference
- GitHub REST API — repo tree and raw file content

---

## License

MIT
