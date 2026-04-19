import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const CONFIG_FILE = join(homedir(), ".cache", "mincontext", "config.json");

const DEFAULTS = {
  llm: null,            // 'groq' | 'ollama'
  groqKey: null,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.3",
  source: null,         // 'github' | 'local'
  githubRepo: null,     // 'owner/repo'
  localDir: null,       // absolute path
  githubToken: null,
  approvedDirs: [],     // local directories the user has granted access to
};

export function loadConfig() {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config) {
  try {
    mkdirSync(join(homedir(), ".cache", "mincontext"), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch {}
}
