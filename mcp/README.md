# mincontext MCP server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes mincontext as a tool — letting Claude, Cursor, or any MCP-capable AI client call it directly without copy-pasting.

## Install

```bash
npm install -g mincontext-mcp
```

## Register with Claude Code

```bash
claude mcp add mincontext --scope user -- mincontext-mcp
```

Or without a global install:

```bash
claude mcp add mincontext --scope user -- npx mincontext-mcp
```

## Tools

### `get_relevant_files`

Find the minimum set of files needed for a task. Works on local repos and GitHub repos.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | What you want to build or fix |
| `local_path` | string | no | Absolute path to a local repo. Omit to auto-detect git root from current directory |
| `repo` | string | no | GitHub repo — `owner/repo` or full URL. Ignored if `local_path` is set |
| `llm` | `"groq"` \| `"ollama"` | first call only | Backend to use — saved per repo, never asked again |
| `github_token` | string | no | For private repos or higher rate limits |

**First call to any repo** prompts once for `llm`, then saves and reuses it. Pass `llm` again any time to change the saved preference.

If Groq hits a rate limit, mincontext tells you and suggests switching to `ollama`.

### `set_groq_key`

Save your Groq API key. Get one free at [console.groq.com](https://console.groq.com).

- On macOS: stored in the system keychain
- On Linux/Windows: stored in `~/.cache/mincontext/mcp-config.json` (mode 600)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `api_key` | string | yes | Your Groq API key (starts with `gsk_`) |

### `list_config`

Show current key status and saved per-repo LLM preferences. No parameters.

## LLM backends

| Backend | Setup | Notes |
|---------|-------|-------|
| `groq` | Free key from [console.groq.com](https://console.groq.com) | Fast, cloud |
| `ollama` | No account needed | Local, auto-started, model auto-downloaded on first use |

## Environment variables

These are optional — the tools above handle configuration interactively.

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key (takes priority over saved key) |
| `GITHUB_TOKEN` | GitHub token for private repos |
| `OLLAMA_URL` | Ollama base URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model (default: `llama3.3`) |

## Cache

Results are cached to `~/.cache/mincontext/mcp-cache.json` for 24 hours and persist across server restarts and Claude Code sessions.
