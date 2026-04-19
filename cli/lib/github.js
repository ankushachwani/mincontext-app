import { pathMatchScore } from "./keywords.js";

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "vendor", "__pycache__",
  ".cache", "coverage", ".nyc_output", "out", "target", ".gradle", ".idea",
  ".vscode", "bower_components", "venv", "__fixtures__",
  "htmlcov", ".tox", ".nox", ".hypothesis", ".pytest_cache", ".mypy_cache",
  ".ruff_cache", ".svn", ".hg", "CVS",
  "examples", "example", "demo", "demos", "docs", "doc", "documentation",
  "website", "site", "gh-pages", "sample", "samples",
  "benchmark", "benchmarks", "bench",
  "scripts", "tools", "hack", "third_party",
  "assets", "static", "public", "images", "media",
]);

const SKIP_PATH_SEGMENTS = new Set([
  "__tests__", "fixtures", "test", "tests", "spec", "specs",
  "e2e", "mocks", "__mocks__", "stubs", "__stubs__",
  "snapshots", "__snapshots__", "testdata", "test-data", "__testfixtures__", "testfixtures",
  "test-helpers", "test-utils", "test-support", "test-fixtures",
  "generated", "gen", "pb", "proto",
  "evals", "eval", "evaluations", "evaluation",
  "generators", "templates",
  "compiled", "dist_client", "dist_server",
  "docs_src", "doc_src",
]);

const SKIP_EXTENSIONS = new Set([
  ".lock", ".min.js", ".min.css", ".map", ".snap",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".avif", ".bmp", ".tiff",
  ".mp3", ".mp4", ".wav", ".ogg", ".flac", ".avi", ".mov", ".webm",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a",
  ".pyc", ".class", ".jar", ".war",
  ".wasm", ".pb", ".proto.js", ".mdx", ".md", ".rst", ".txt",
  ".tt", ".erb.tt", ".rb.tt",
]);

const SKIP_FILENAME_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /go\.sum$/,
  /poetry\.lock$/,
  /\.min\.(js|css)$/,
  /\.bundle\.js$/,
  /\.(test|spec)\.(js|ts|jsx|tsx|py|go|rb)$/,
  /\.test-d\.ts$/,
  /_(test|spec)\.(go|rb|py|js|ts)$/,
  /\.expect\.md$/,
  /^(CHANGELOG|CHANGES|HISTORY|LICENSE|LICENCE|NOTICE|AUTHORS|CONTRIBUTORS)(\.md|\.txt)?$/i,
  /^Readme(\.(md|txt|rst))?$/i,
  // Standalone test/benchmark files by name
  /^(test|tests|spec|specs|benchmark|benchmarks|bench)\.(js|ts|py|rb|go|rs)$/i,
  // Build / bundler configs — never needed to understand or modify source logic
  /^(vite|vitest|tsdown|tsup|rollup|webpack|esbuild|swc|babel\.config|jest\.config|jest\.setup)\.(js|ts|mjs|cjs)$/,
  /^(karma|nightwatch|cypress|playwright)\.config\.(js|ts)$/,
];

// Tooling package directory patterns — skip these in pre-filter.
// When someone queries "add a hook" in a repo, they don't want eslint plugin
// or devtools files; those are linting/debugging tools, not source code.
// Exception: if querying eslint-plugin repos directly, Tier 3 structural
// importance still surfaces them as top files from their own package.
const SKIP_DIR_PATTERNS = [
  /^eslint-plugin/,
  /^babel-plugin/,
  /devtools/,
  /^jest-/,
  /^codemod/,
];

export function shouldSkipFile(path) {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];

  // Skip dotfiles and dot-directories at any level
  for (const part of parts) {
    if (part.startsWith(".")) return true;
  }

  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part) || SKIP_PATH_SEGMENTS.has(part)) return true;
    if (SKIP_DIR_PATTERNS.some(p => p.test(part))) return true;
  }

  if (parts.length === 1 && SKIP_FILENAME_PATTERNS.some(p => p.test(filename))) return true;

  const lastExt = filename.includes(".") ? "." + filename.split(".").pop() : "";
  const fullExt = filename.includes(".") ? "." + filename.split(".").slice(1).join(".") : "";
  if (SKIP_EXTENSIONS.has(lastExt) || SKIP_EXTENSIONS.has(fullExt)) return true;
  for (const pat of SKIP_FILENAME_PATTERNS) {
    if (pat.test(filename)) return true;
  }
  return false;
}

function fileImportanceScore(path) {
  const parts = path.split("/");
  const depth = parts.length;
  const filename = parts[parts.length - 1];
  const topDir = parts[0];
  // Also check second-level dir: repos like django/, rails/, axum/ wrap their
  // source under <repo>/src/, <repo>/core/, etc. — missing this makes depth-4
  // files (e.g. django/core/handlers/base.py, axum/src/routing/mod.rs) score
  // poorly against shallower files that aren't the real source root.
  const secondDir = parts.length >= 3 ? parts[1] : "";
  const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";

  const SOURCE_EXTS = new Set([".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".rb", ".java", ".kt", ".c", ".cpp", ".cs", ".swift", ".php", ".vue", ".svelte"]);
  const CONFIG_EXTS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"]);
  const CORE_DIRS = new Set(["lib", "src", "pkg", "internal", "core", "source", "packages", "app", "cmd", "api"]);

  let score = depth * 8;
  if (CORE_DIRS.has(topDir) || CORE_DIRS.has(secondDir)) score -= 40;
  if (SOURCE_EXTS.has(ext)) score -= 5;
  if (CONFIG_EXTS.has(ext)) score += 10;
  return score;
}

/**
 * Compute IDF (inverse document frequency) for each keyword against all file paths.
 * Keywords appearing in fewer file paths get higher IDF → they are more discriminating.
 * This lets "handler" (rare) outweigh "app" (everywhere) when scoring candidates.
 */
function computeKeywordIDF(allFiles, keywords) {
  const counts = new Map(keywords.map(kw => [kw, 0]));
  const N = allFiles.length;
  for (const f of allFiles) {
    const norm = f.path.toLowerCase().replace(/[-_.\/]/g, " ");
    for (const kw of keywords) {
      if (norm.includes(kw)) counts.set(kw, counts.get(kw) + 1);
    }
  }
  const idf = new Map();
  for (const [kw, count] of counts) {
    // log(N / (1 + count)) so zero-count keywords don't get infinite weight
    idf.set(kw, count > 0 ? Math.log(N / (1 + count)) : 0);
  }
  return idf;
}

/**
 * Score a file path by IDF-weighted keyword matches.
 * Also returns the best single-segment score (for detecting tight clusters
 * like "cache-handlers" matching both "cache" and "handler").
 */
function pathIdfScore(filePath, keywords, idf) {
  const parts = filePath.toLowerCase().split("/");
  const filename = parts[parts.length - 1];
  const parent = parts[parts.length - 2] || "";

  let totalScore = 0;
  let maxSegScore = 0;

  // Per-segment scores
  for (const seg of parts) {
    const words = seg.replace(/[-_.]/g, " ").split(/\s+/);
    let segScore = 0;
    for (const kw of keywords) {
      if (words.some(w => w === kw || w.startsWith(kw))) {
        segScore += idf.get(kw) || 0;
      }
    }
    if (segScore > maxSegScore) maxSegScore = segScore;
    totalScore += segScore;
  }

  // Parent + filename combined (catches "use-cache/handlers.ts")
  const combined = (parent + " " + filename).replace(/[-_.]/g, " ").split(/\s+/);
  let combinedScore = 0;
  for (const kw of keywords) {
    if (combined.some(w => w === kw || w.startsWith(kw))) {
      combinedScore += idf.get(kw) || 0;
    }
  }

  return {
    total: totalScore,
    maxSeg: Math.max(maxSegScore, combinedScore),
  };
}

/** Detect monorepo and return a scoring bonus map: packageDir → bonus score reduction */
function buildMonorepoPackageBonus(allFiles, keywords) {
  if (!keywords.length) return null;
  // Detect monorepo indicators
  const hasWorkspace = allFiles.some(f =>
    f.path === "pnpm-workspace.yaml" || f.path === "lerna.json" || f.path === "nx.json" ||
    f.path === "rush.json" || f.path === "turbo.json"
  );
  const packageJsonFiles = allFiles.filter(f => f.path.match(/^(packages|apps|libs)\/[^/]+\/package\.json$/));
  if (!hasWorkspace && packageJsonFiles.length < 2) return null;

  // Find which packages match keywords via their directory name
  const packageDirs = packageJsonFiles.map(f => f.path.replace("/package.json", ""));
  const bonusMap = new Map(); // dir → score bonus (negative = better)
  for (const dir of packageDirs) {
    const norm = dir.toLowerCase().replace(/[-_./]/g, " ");
    const hits = keywords.filter(kw => norm.includes(kw)).length;
    if (hits > 0) bonusMap.set(dir, -80 * hits); // strongly prefer matching packages
  }
  return bonusMap.size > 0 ? bonusMap : null;
}

/** Use GitHub code search API to recover file paths when tree is truncated. */
async function searchCodeForKeywords(owner, repo, keywords, token) {
  if (!keywords.length) return [];
  try {
    const q = encodeURIComponent(`${keywords.slice(0, 3).join(" ")} repo:${owner}/${repo}`);
    const headers = { Accept: "application/vnd.github.v3+json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/search/code?q=${q}&per_page=30`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => item.path).filter(p => !shouldSkipFile(p));
  } catch { return []; }
}

export async function fetchFileTree(owner, repo, token, keywords = []) {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error(`Repository not found. Check that "${owner}/${repo}" exists and is public.`);
    if (res.status === 401 || res.status === 403) throw new Error(`Access denied. "${owner}/${repo}" may be a private repository.`);
    throw new Error(body.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  let allFiles = (data.tree || []).filter(
    item => item.type === "blob" && !shouldSkipFile(item.path)
  );

  // If tree was truncated, recover more files via code search
  if (data.truncated && keywords.length) {
    const searchPaths = await searchCodeForKeywords(owner, repo, keywords, token);
    const existingPaths = new Set(allFiles.map(f => f.path));
    for (const p of searchPaths) {
      if (!existingPaths.has(p)) allFiles.push({ path: p, type: "blob" });
    }
  }

  const SMALL_REPO = 120;
  let files;

  if (!keywords.length || allFiles.length <= SMALL_REPO) {
    // Small repo or no keywords: include all filtered files, sorted by importance
    files = [...allFiles]
      .sort((a, b) => fileImportanceScore(a.path) - fileImportanceScore(b.path))
      .slice(0, 80);
  } else {
    // IDF-weighted candidate selection
    const idf = computeKeywordIDF(allFiles, keywords);
    const monorepoBonus = buildMonorepoPackageBonus(allFiles, keywords);

    const scored = allFiles.map(f => {
      const idfResult = pathIdfScore(f.path, keywords, idf);
      let importance = fileImportanceScore(f.path);
      // Apply monorepo package bonus: files in the most keyword-matching package score better
      if (monorepoBonus) {
        for (const [dir, bonus] of monorepoBonus) {
          if (f.path.startsWith(dir + "/")) { importance += bonus; break; }
        }
      }
      return { ...f, ...idfResult, importance };
    });

    // Tier 1: files with a high-scoring path segment (tight keyword cluster)
    const T1_THRESHOLD = 5.5;
    const tier1 = scored.filter(f => f.maxSeg >= T1_THRESHOLD);
    const tier1Set = new Set(tier1.map(f => f.path));

    // Scale tier caps with repo size: large repos need more structural coverage
    // to ensure deeply-nested core files (e.g. django/core/handlers/base.py)
    // survive into the content-fetch + LLM stages. 200-file threshold helps
    // monorepos (e.g. axum) where many packages compete for the same slots.
    const TIER_CAP = allFiles.length > 2000 ? 60 : allFiles.length > 500 ? 50 : allFiles.length > 200 ? 45 : 40;

    // Tier 2: remaining files with any keyword match in path, sorted by IDF score
    const tier2 = scored
      .filter(f => !tier1Set.has(f.path) && f.total > 0)
      .sort((a, b) => b.total - a.total || a.importance - b.importance)
      .slice(0, TIER_CAP);
    const tier12Set = new Set([...tier1, ...tier2].map(f => f.path));

    // Tier 3: top files by structural importance (ensures core files are always present)
    const tier3 = scored
      .filter(f => !tier12Set.has(f.path))
      .sort((a, b) => a.importance - b.importance)
      .slice(0, TIER_CAP);

    files = [...tier1, ...tier2, ...tier3];
  }

  return {
    files,
    allFilteredPaths: allFiles.map(f => f.path),
    meta: {
      totalInRepo: (data.tree || []).length,
      totalFiltered: allFiles.length,
      selected: files.length,
      truncated: data.truncated || false,
    },
  };
}

/**
 * Select and rank candidate files from a pre-filtered list.
 * Extracted so local filesystem mode can reuse the exact same IDF scoring.
 */
export function selectCandidates(allFiles, keywords) {
  const SMALL_REPO = 120;
  let files;

  if (!keywords.length || allFiles.length <= SMALL_REPO) {
    files = [...allFiles]
      .sort((a, b) => fileImportanceScore(a.path) - fileImportanceScore(b.path))
      .slice(0, 80);
  } else {
    const idf = computeKeywordIDF(allFiles, keywords);
    const monorepoBonus = buildMonorepoPackageBonus(allFiles, keywords);

    const scored = allFiles.map((f) => {
      const idfResult = pathIdfScore(f.path, keywords, idf);
      let importance = fileImportanceScore(f.path);
      if (monorepoBonus) {
        for (const [dir, bonus] of monorepoBonus) {
          if (f.path.startsWith(dir + "/")) { importance += bonus; break; }
        }
      }
      return { ...f, ...idfResult, importance };
    });

    const T1_THRESHOLD = 5.5;
    const tier1 = scored.filter((f) => f.maxSeg >= T1_THRESHOLD);
    const tier1Set = new Set(tier1.map((f) => f.path));
    const TIER_CAP = allFiles.length > 2000 ? 60 : allFiles.length > 500 ? 50 : allFiles.length > 200 ? 45 : 40;

    const tier2 = scored
      .filter((f) => !tier1Set.has(f.path) && f.total > 0)
      .sort((a, b) => b.total - a.total || a.importance - b.importance)
      .slice(0, TIER_CAP);
    const tier12Set = new Set([...tier1, ...tier2].map((f) => f.path));

    const tier3 = scored
      .filter((f) => !tier12Set.has(f.path))
      .sort((a, b) => a.importance - b.importance)
      .slice(0, TIER_CAP);

    files = [...tier1, ...tier2, ...tier3];
  }

  return files;
}

export async function fetchFileContent(owner, repo, path) {
  const res = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
  );
  if (!res.ok) return null;
  const text = await res.text();
  if (text.includes("\0")) return null;
  return text;
}

export async function fetchMultipleFiles(owner, repo, paths, onProgress) {
  const CONCURRENCY = 30;
  const results = new Map();
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async p => ({ path: p, content: await fetchFileContent(owner, repo, p) }))
    );
    for (const { path, content } of fetched) results.set(path, content);
    if (onProgress) onProgress(Math.min(i + CONCURRENCY, paths.length), paths.length);
  }
  return results;
}
