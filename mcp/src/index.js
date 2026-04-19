#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { runPipeline } from "./pipeline.js";

// ── Config dir ────────────────────────────────────────────────────────────────
const CONFIG_DIR = join(homedir(), ".cache", "mincontext");
const PREFS_FILE = join(CONFIG_DIR, "mcp-prefs.json");
const CONFIG_FILE = join(CONFIG_DIR, "mcp-config.json");

function ensureDir() {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Keychain (macOS) with plaintext fallback ──────────────────────────────────
const KEYCHAIN_SERVICE = "mincontext-mcp";
const KEYCHAIN_ACCOUNT = "groq-api-key";

function saveGroqKey(key) {
  if (platform() === "darwin") {
    try {
      execSync(
        `security add-generic-password -U -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w ${JSON.stringify(key)}`,
        { stdio: "pipe" }
      );
      return { storage: "keychain" };
    } catch {}
  }
  // Fallback: plaintext file (non-macOS or keychain failure)
  ensureDir();
  const config = loadConfigFile();
  config.groqKey = key;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { storage: "file" };
}

function loadGroqKey() {
  if (platform() === "darwin") {
    try {
      return execSync(
        `security find-generic-password -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString().trim();
    } catch {}
  }
  return loadConfigFile().groqKey || null;
}

function loadConfigFile() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}

function getGroqKey() {
  return process.env.GROQ_API_KEY || loadGroqKey() || null;
}

// ── Per-repo LLM preferences ──────────────────────────────────────────────────
function loadPrefs() {
  try { return JSON.parse(readFileSync(PREFS_FILE, "utf8")); } catch { return {}; }
}

function savePrefs(prefs) {
  ensureDir();
  writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

function getRepoPref(repoKey) { return loadPrefs()[repoKey] || null; }

function setRepoPref(repoKey, llm) {
  const prefs = loadPrefs();
  prefs[repoKey] = llm;
  savePrefs(prefs);
}

// ── Git root detector ─────────────────────────────────────────────────────────
function findGitRoot(dir) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString().trim();
  } catch {
    return null;
  }
}

// ── Repo parser ───────────────────────────────────────────────────────────────
function parseRepo(input) {
  const s = input.trim();
  const urlMatch = s.match(/github\.com\/([^/]+)\/([^/\s]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  const shortMatch = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2].replace(/\.git$/, "") };
  return null;
}

// ── Pipeline with timeout ─────────────────────────────────────────────────────
const PIPELINE_TIMEOUT_MS = 90_000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// ── Output formatter ──────────────────────────────────────────────────────────
function formatResults(files, repoLabel, task, backend, fromCache) {
  const header = [
    `Repo:  ${repoLabel}`,
    `Task:  ${task}`,
    `LLM:   ${backend}${fromCache ? " (cached)" : ""}`,
    `Files: ${files.length}`,
    "",
  ].join("\n");

  const fileList = files
    .map((f, i) => `${i + 1}. ${f.path}\n   ${f.reason}`)
    .join("\n\n");

  const pathsBlock =
    "\n\n---\nPaths:\n" + files.map((f) => f.path).join("\n");

  return header + fileList + pathsBlock;
}

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "mincontext", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_relevant_files",
      description:
        "Find the minimum set of files needed to complete a programming task — works on local repos and GitHub repos. " +
        "For local repos: omit both local_path and repo to auto-detect the git root of the current directory, or pass local_path explicitly. " +
        "For GitHub repos: pass repo in owner/repo format. " +
        "On the first call to a new repo, specify the llm parameter — it will be saved and reused automatically.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Description of the programming task.",
          },
          local_path: {
            type: "string",
            description:
              "Absolute path to a local repository. Omit to auto-detect git root from the current working directory.",
          },
          repo: {
            type: "string",
            description:
              "GitHub repository in owner/repo format or full URL. Ignored if local_path is provided.",
          },
          llm: {
            type: "string",
            enum: ["groq", "ollama"],
            description:
              "LLM backend. Required on the first call to a new repo — saved and reused after that. " +
              "\"groq\": free cloud API, fast, requires a Groq API key (set via set_groq_key tool or GROQ_API_KEY env var). " +
              "\"ollama\": local model, no API key needed, auto-started and model auto-downloaded if missing. " +
              "Pass again any time to override the saved preference.",
          },
          github_token: {
            type: "string",
            description:
              "GitHub personal access token. Increases rate limits and enables private repos. Falls back to GITHUB_TOKEN env var.",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "set_groq_key",
      description:
        "Save your Groq API key so mincontext can use the groq backend. " +
        "Get a free key at https://console.groq.com — no credit card required. " +
        "On macOS the key is stored in the system keychain. On other platforms it is stored in ~/.cache/mincontext/mcp-config.json (mode 600).",
      inputSchema: {
        type: "object",
        properties: {
          api_key: {
            type: "string",
            description: "Your Groq API key (starts with gsk_)",
          },
        },
        required: ["api_key"],
      },
    },
    {
      name: "list_config",
      description: "Show current mincontext configuration: Groq key status and saved per-repo LLM preferences.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── set_groq_key ────────────────────────────────────────────────────────────
  if (name === "set_groq_key") {
    const { api_key } = args;
    if (!api_key || !api_key.startsWith("gsk_")) {
      return {
        content: [{ type: "text", text: "Error: invalid key — Groq API keys start with gsk_" }],
        isError: true,
      };
    }
    const { storage } = saveGroqKey(api_key);
    return {
      content: [{
        type: "text",
        text:
          `Groq API key saved to ${storage === "keychain" ? "macOS keychain" : "~/.cache/mincontext/mcp-config.json"}.\n` +
          `You can now use llm="groq" with any repo.`,
      }],
    };
  }

  if (name === "list_config") {
    const key = getGroqKey();
    const prefs = loadPrefs();
    const keyStatus = process.env.GROQ_API_KEY
      ? "set via GROQ_API_KEY env var"
      : key
        ? `saved (${platform() === "darwin" ? "macOS keychain" : "~/.cache/mincontext/mcp-config.json"})`
        : "not set";

    const prefsText = Object.keys(prefs).length
      ? Object.entries(prefs).map(([repo, llm]) => `  ${repo}: ${llm}`).join("\n")
      : "  (none saved yet)";

    return {
      content: [{
        type: "text",
        text:
          `mincontext config\n` +
          `-----------------\n` +
          `Groq API key: ${keyStatus}\n\n` +
          `Saved repo preferences:\n${prefsText}`,
      }],
    };
  }

  if (name !== "get_relevant_files") {
    throw new Error(`Unknown tool: ${name}`);
  }

  // ── get_relevant_files ──────────────────────────────────────────────────────
  const { task, local_path, repo: repoInput, llm: llmParam, github_token } = args;

  if (!task || typeof task !== "string") {
    return { content: [{ type: "text", text: "Error: task is required." }], isError: true };
  }

  // Resolve source
  let localDir = null;
  let parsed = null;
  let repoKey, repoLabel;

  if (local_path) {
    localDir = resolve(local_path);
    if (!existsSync(localDir)) {
      return { content: [{ type: "text", text: `Error: path not found: ${localDir}` }], isError: true };
    }
    repoKey = `local:${localDir}`;
    repoLabel = localDir;
  } else if (repoInput) {
    parsed = parseRepo(repoInput);
    if (!parsed) {
      return {
        content: [{ type: "text", text: `Error: could not parse "${repoInput}". Use owner/repo or a full GitHub URL.` }],
        isError: true,
      };
    }
    repoKey = `${parsed.owner}/${parsed.repo}`;
    repoLabel = repoKey;
  } else {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) {
      return {
        content: [{ type: "text", text: "Error: no local_path or repo provided, and no git repo found in the current directory." }],
        isError: true,
      };
    }
    localDir = gitRoot;
    repoKey = `local:${localDir}`;
    repoLabel = localDir;
  }

  // Resolve LLM backend
  const savedLlm = getRepoPref(repoKey);
  const groqKey = getGroqKey();

  if (llmParam && llmParam !== savedLlm) setRepoPref(repoKey, llmParam);
  const resolvedLlm = llmParam || savedLlm;

  if (!resolvedLlm) {
    const hasGroq = !!groqKey;
    return {
      content: [{
        type: "text",
        text:
          `First time using ${repoLabel} with mincontext.\n\n` +
          `Please re-run with llm set to your preferred backend:\n\n` +
          `  llm="groq"   — free cloud API, fast${hasGroq ? " (your key is already set)" : " (requires a Groq API key — use set_groq_key to add one)"}\n` +
          `  llm="ollama" — local model, no API key needed, auto-started if not running\n\n` +
          `Your choice will be saved for all future calls to this repo.`,
      }],
    };
  }

  const useOllama = resolvedLlm === "ollama";

  if (!useOllama && !groqKey) {
    return {
      content: [{
        type: "text",
        text:
          `${repoLabel} is set to use Groq, but no API key is configured.\n\n` +
          `Options:\n` +
          `  1. Add your key: call set_groq_key with your key from https://console.groq.com\n` +
          `  2. Switch to local: re-run with llm="ollama"`,
      }],
      isError: true,
    };
  }

  // Run pipeline
  try {
    const { files, fromCache } = await withTimeout(
      runPipeline(task, {
        ...(localDir ? { localDir } : { owner: parsed.owner, repo: parsed.repo }),
        groqKey,
        ollama: useOllama,
        ollamaUrl: process.env.OLLAMA_URL,
        ollamaModel: process.env.OLLAMA_MODEL,
        githubToken: github_token || process.env.GITHUB_TOKEN,
      }),
      PIPELINE_TIMEOUT_MS
    );

    if (files.length === 0) {
      return {
        content: [{ type: "text", text: `No relevant files found in ${repoLabel} for: "${task}"` }],
      };
    }

    const backend = useOllama
      ? `ollama (${process.env.OLLAMA_MODEL || "llama3.3"})`
      : "groq (llama-3.3-70b)";

    return {
      content: [{ type: "text", text: formatResults(files, repoLabel, task, backend, fromCache) }],
    };

  } catch (err) {
    // Rate limit: suggest Ollama
    if (err.message.includes("rate limit")) {
      return {
        content: [{
          type: "text",
          text:
            `Groq rate limit hit for ${repoLabel}.\n\n` +
            `You can switch to a local model instead — re-run with llm="ollama".\n` +
            `Ollama will be auto-started and the model auto-downloaded if needed.\n\n` +
            `Or wait a moment and try again with Groq.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
