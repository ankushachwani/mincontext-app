import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { shouldSkipFile, selectCandidates } from "../lib/github.js";

// Directory names to skip recursing into (performance — avoids walking millions of files)
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "vendor", "__pycache__",
  ".cache", "coverage", ".nyc_output", "out", "target", ".gradle", ".idea",
  ".vscode", "bower_components", "venv", "__fixtures__",
  "htmlcov", ".tox", ".nox", ".hypothesis", ".pytest_cache", ".mypy_cache",
  "examples", "example", "demo", "demos", "docs", "doc", "documentation",
  "website", "site", "assets", "static", "public", "images", "media",
  "benchmark", "benchmarks", "scripts", "tools", "hack", "third_party",
]);

function walk(rootDir, dir, results) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      walk(rootDir, fullPath, results);
    } else if (!shouldSkipFile(relPath)) {
      results.push({ path: relPath, type: "blob" });
    }
  }
}

/**
 * Get the local file tree for a directory, using the same IDF scoring as the GitHub path.
 * Returns the same shape as fetchFileTree().
 */
export function getLocalFileTree(rootDir, keywords = []) {
  const allFiles = [];
  walk(rootDir, rootDir, allFiles);

  const files = selectCandidates(allFiles, keywords);

  return {
    files,
    allFilteredPaths: allFiles.map((f) => f.path),
    meta: {
      totalInRepo: allFiles.length,
      totalFiltered: allFiles.length,
      selected: files.length,
      truncated: false,
    },
  };
}

/**
 * Read file contents from disk.
 * Returns the same shape as fetchMultipleFiles() — a Map<path, string|null>.
 */
export function readLocalFiles(rootDir, paths, onProgress) {
  const results = new Map();
  let done = 0;
  for (const p of paths) {
    try {
      const content = readFileSync(join(rootDir, p), "utf8");
      results.set(p, content.includes("\0") ? null : content);
    } catch {
      results.set(p, null);
    }
    done++;
    if (onProgress) onProgress(done, paths.length);
  }
  return results;
}
