# Minimum Context Finder

Find the minimal set of files relevant to any task in a public GitHub repo. Copy the result into an AI tool (Claude, GPT-4, Cursor, etc.) with exactly the context it needs — nothing more.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_USERNAME%2Fmincontext)

## How it works

1. Paste a GitHub repo URL or `owner/repo` into the input
2. Describe what you're trying to build or fix (e.g. "add OAuth login")
3. Click **Find Context**

The app will:
- Fetch the repo's file tree via the GitHub REST API
- Pre-filter noise (lock files, binaries, `node_modules`, etc.)
- Fetch each file's content
- Parse imports/exports/symbols with regex-based static analysis
- Build a one-line summary per file
- Run `Xenova/all-MiniLM-L6-v2` embeddings **in your browser** (no server)
- Rank files by cosine similarity to your task description
- Return the top 20 most relevant files

Then check/uncheck files and click **Copy Context** to get a formatted blob ready to paste into any AI tool.

## Key properties

- **Zero server cost** — embeddings and ranking run entirely in the browser via `@xenova/transformers` (ONNX/WASM)
- **No auth required** — works with any public repo
- **Optional GitHub PAT** — add a personal access token via the header button to avoid rate limits on large repos; stored only in `localStorage`
- **No database, no accounts**

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Embeddings | `@xenova/transformers` — `all-MiniLM-L6-v2` |
| Parsing | Regex-based static analysis (JS/TS/Py/Go/Rust/Ruby/Java) |
| Data | GitHub REST API (unauthenticated) |
| Hosting | Vercel free tier |

## Local development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Deploy to Vercel

Click the button above, or:

```bash
npm i -g vercel
vercel
```

No environment variables required for basic usage.

## URL structure

```
mincontext.dev/                    → Landing page
mincontext.dev/facebook/react      → Analyze facebook/react
mincontext.dev/vercel/next.js      → Analyze vercel/next.js
```

Mirrors GitHub's URL structure so you can replace `github.com` with `mincontext.dev` in any repo URL.

## License

MIT
