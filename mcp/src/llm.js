import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const OLLAMA_DEFAULT_MODEL = "llama3.3";

export async function callLLM(messages, maxTokens, config = {}) {
  if (config.ollama) {
    await ensureOllama(config);
    return callOllama(messages, maxTokens, config);
  }
  return callGroq(messages, maxTokens, config.groqKey);
}

async function ensureOllama(config = {}) {
  const base = (config.ollamaUrl || OLLAMA_DEFAULT_URL).replace(/\/$/, "");
  const model = config.ollamaModel || OLLAMA_DEFAULT_MODEL;

  if (!(await isOllamaRunning(base))) {
    try {
      await execFileAsync("ollama", ["--version"]);
    } catch {
      throw new Error("Ollama is not installed. Install it at https://ollama.com and re-run.");
    }

    const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    child.unref();

    const started = await waitFor(() => isOllamaRunning(base), 8000, 400);
    if (!started) {
      throw new Error("Ollama started but is taking too long to respond. Try running `ollama serve` manually.");
    }
  }

  if (!(await isModelAvailable(base, model))) {
    await pullModel(base, model);
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
    return models.some((m) => m.name === model || m.name.startsWith(model + ":"));
  } catch {
    return false;
  }
}

async function pullModel(base, model) {
  const res = await fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to pull model: ${err.error || `HTTP ${res.status}`}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.status === "success") return;
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
    if (res.status === 401) throw new Error(`Invalid Groq API key. Get a free key at https://console.groq.com`);
    if (res.status === 429) throw new Error(`Groq rate limit hit. Try again in a moment.`);
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
