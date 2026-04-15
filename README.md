# mincontext

<p align="center">
  <strong>Find the minimum set of files needed for any task in any GitHub repo.</strong><br/>
  <sub>Paste a repo. Describe your task. Get exactly the files worth reading.</sub>
</p>

<p align="center">
  <a href="https://mincontext-app.vercel.app">
    <img alt="Website" src="https://img.shields.io/badge/website-mincontext--app.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white" />
  </a>
  &nbsp;
  <a href="https://console.groq.com">
    <img alt="Groq API Key" src="https://img.shields.io/badge/get_a_free_groq_api_key-F55036?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0tMSAxNHYtNEg3bDUtOHY0aDRsLTUgOHoiLz48L3N2Zz4=" />
  </a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-black" />
  <img alt="Model" src="https://img.shields.io/badge/model-llama--3.3--70b-orange" />
</p>

---

## What it does

You paste a GitHub repo and describe what you're building. mincontext returns the minimum set of files a developer would need to open to complete that task — nothing more. Copy the results straight into Claude, ChatGPT, Cursor, or any AI coding tool.

## Results

Evaluated across **27 repositories** spanning 10 languages, from 29 to 20,717 files:

| Metric | Score |
|--------|-------|
| Recall | 91% |
| Precision | 93% |
| File reduction | 98% |

24 of 27 test cases produced fully correct output (100% recall and precision). The three exceptions are documented in [`docs/results.md`](docs/results.md).

---

## Getting started

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- A free [Groq API key](https://console.groq.com) (no credit card required)

### Installation

```bash
git clone https://github.com/ankushachwani/mincontext-app
cd mincontext-app
npm install
```

Create a `.env.local` file in the root:

```bash
GROQ_API_KEY=gsk_your_key_here
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How it works

```
GitHub tree API
  → strip noise: tests, build artifacts, docs, generated files
  → IDF-weighted path scoring → select up to 80 candidates
  → fetch all candidate contents in parallel
  → rescue pass: promote cut files that score higher than weakest candidates
  → parse imports/exports/symbols, build import graph, reorder by relevance
  → LLM prune pass: keep/remove per file with structural role annotations
  → LLM sufficiency check: base class recovery + registration file detection
  → final file set with per-file reasoning
```

The LLM receives structured summaries — parsed symbols and the first 15 lines of each file — not raw dumps. This keeps prompts compact and latency low.

---

## Stack

| | |
|---|---|
| Framework | [Next.js 14](https://nextjs.org) (App Router) |
| Inference | [Groq](https://groq.com) — `llama-3.3-70b-versatile` |
| Data | GitHub REST API |
| Cache | Vercel KV (7-day TTL) |

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss what you'd like to change.

---

## License

[MIT](LICENSE)
