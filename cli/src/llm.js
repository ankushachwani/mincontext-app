import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
export const OLLAMA_DEFAULT_MODEL = "llama3.3";

/**
 * Ensure Ollama is running and the model is available.
 * Auto-starts Ollama if installed but not running.
 * Auto-pulls the model if not downloaded yet.
 *
 * @param {object}   config
 * @param {string}   [config.ollamaUrl]   - Ollama base URL
 * @param {string}   [config.ollamaModel] - Model name
 * @param {function} [config.onStatus]    - (message: string) => void  for progress updates
 */
export async function ensureOllama(config = {}) {
  const base = (config.ollamaUrl || OLLAMA_DEFAULT_URL).replace(/\/$/, "");
  const model = config.ollamaModel || OLLAMA_DEFAULT_MODEL;
  const onStatus = config.onStatus || (() => {});

  // 1. Check if Ollama is already running
  if (!(await isOllamaRunning(base))) {
    onStatus("Starting Ollama...");

    // Check if ollama is installed
    try {
      await execFileAsync("ollama", ["--version"]);
    } catch {
      throw new Error(
        "Ollama is not installed. Install it at https://ollama.com and re-run."
      );
    }

    // Start ollama serve in background
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait up to 8 seconds for it to come up
    const started = await waitFor(() => isOllamaRunning(base), 8000, 400);
    if (!started) {
      throw new Error(
        "Ollama started but is taking too long to respond. Try running `ollama serve` manually."
      );
    }
  }

  // 2. Check if the model is already pulled
  if (!(await isModelAvailable(base, model))) {
    onStatus(`Downloading model ${model} (first time only, may take a few minutes)...`);
    await pullModel(base, model, onStatus);
  }
}

async function isOllamaRunning(base) {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isModelAvailable(base, model) {
  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return false;
    const { models = [] } = await res.json();
    // model names may include a tag like "llama3.3:latest"
    return models.some(
      (m) => m.name === model || m.name.startsWith(model + ":")
    );
  } catch {
    return false;
  }
}

async function pullModel(base, model, onStatus) {
  const res = await fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to pull model: ${err.error || `HTTP ${res.status}`}`);
  }

  // Stream NDJSON progress lines
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.status === "success") {
          onStatus(`Model ${model} ready.`);
          return;
        }
        if (evt.total && evt.completed) {
          const pct = Math.round((evt.completed / evt.total) * 100);
          const mb = Math.round(evt.completed / 1024 / 1024);
          const total = Math.round(evt.total / 1024 / 1024);
          onStatus(`Downloading ${model}  ${pct}%  (${mb} / ${total} MB)`);
        } else if (evt.status) {
          onStatus(`${evt.status}`);
        }
      } catch {}
    }
  }
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ── LLM call ──────────────────────────────────────────────────────────────────

/**
 * Call LLM via Groq (cloud) or Ollama (local).
 * ensureOllama() must have been called before using the Ollama path.
 */
export async function callLLM(messages, maxTokens, config = {}) {
  if (config.ollama) return callOllama(messages, maxTokens, config);
  return callGroq(messages, maxTokens, config.groqKey);
}

async function callGroq(messages, maxTokens, apiKey) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${res.status}`;
    if (res.status === 401)
      throw new Error(`Invalid Groq API key. Get a free key at https://console.groq.com`);
    if (res.status === 429)
      throw new Error(`Groq rate limit hit. Try again in a moment.`);
    throw new Error(`Groq API error: ${msg}`);
  }

  return res.json();
}

async function callOllama(messages, maxTokens, config) {
  const base = (config.ollamaUrl || OLLAMA_DEFAULT_URL).replace(/\/$/, "");
  const model = config.ollamaModel || OLLAMA_DEFAULT_MODEL;

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0, num_predict: maxTokens },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Ollama error: ${err.error || `HTTP ${res.status}`}`);
  }

  const data = await res.json();
  return {
    choices: [{ message: { content: data.message?.content || "" } }],
  };
}
