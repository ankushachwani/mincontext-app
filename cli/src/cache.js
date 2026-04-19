import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const CACHE_DIR = join(homedir(), ".cache", "mincontext");
const CACHE_FILE = join(CACHE_DIR, "cache.json");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function cacheKey(source, task) {
  return `${source}::${task.toLowerCase().trim()}`;
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** source = "gh:owner/repo" or "local:/abs/path" */
export function loadCache(source, task) {
  try {
    const cache = readCache();
    const entry = cache[cacheKey(source, task)];
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function saveCache(source, task, data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const cache = readCache();
    cache[cacheKey(source, task)] = { data, ts: Date.now() };
    writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
  } catch {}
}
