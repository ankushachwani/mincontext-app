/**
 * Import graph builder + BFS candidate selection.
 *
 * Given a set of files with content, builds a directed import graph and
 * runs multi-source BFS from keyword-matching roots to produce an ordered
 * candidate list for LLM pruning — most-connected relevant files first.
 */

/** Extract raw import specifiers from file content. */
function extractRawImports(content, filePath) {
  const results = [];

  // ES6 static: import ... from '...'
  const esRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esRe.exec(content)) !== null) results.push(m[1]);

  // Dynamic: import('...')
  const dynRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(content)) !== null) results.push(m[1]);

  // CommonJS: require('...')
  const cjsRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) results.push(m[1]);

  // Python relative: from .foo import bar / from .sansio.app import App
  // Convert Python dot-notation to slash paths so the resolver can find them:
  // .sansio.app → ./sansio/app, ..utils.helpers → ../utils/helpers
  const pyRe = /^from\s+(\.[^\s]+)\s+import/gm;
  while ((m = pyRe.exec(content)) !== null) {
    const raw = m[1];
    const leadingDots = raw.match(/^\.+/)[0];
    const rest = raw.slice(leadingDots.length);
    results.push(leadingDots + (rest ? rest.replace(/\./g, "/") : ""));
  }

  // Keep relative, common aliases, and scoped packages (for monorepo resolution)
  return results.filter(
    (r) => r.startsWith(".") || r.startsWith("@/") || r.startsWith("~/") || r.startsWith("@")
  );
}

/** Resolve a raw import path to an actual file path present in pathSet. */
function resolveImport(raw, fromPath, pathSet, packageMap = null) {
  const fromDir = fromPath.split("/").slice(0, -1).join("/");
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".rb"];
  const suffixes = exts.flatMap((e) => [e, `/index${e}`]);

  if (raw.startsWith("@/") || raw.startsWith("~/")) {
    const rel = raw.slice(2);
    const prefixes = ["", "app/", "src/"];
    for (const pre of prefixes) {
      for (const s of suffixes) {
        if (pathSet.has(pre + rel + s)) return pre + rel + s;
      }
    }
    return null;
  }

  // Monorepo package-scoped import: @scope/pkg or @scope/pkg/subpath
  if (raw.startsWith("@") && packageMap) {
    for (const [pkgName, pkgDir] of packageMap) {
      if (raw === pkgName || raw.startsWith(pkgName + "/")) {
        const sub = raw.slice(pkgName.length).replace(/^\//, "");
        const bases = sub ? [`${pkgDir}/${sub}`, `${pkgDir}/src/${sub}`] : [`${pkgDir}/src`, pkgDir];
        for (const b of bases) {
          for (const s of suffixes) {
            if (pathSet.has(b + s)) return b + s;
          }
        }
      }
    }
    return null;
  }

  if (!raw.startsWith(".")) return null;

  // Relative: resolve against fromDir
  const parts = (fromDir ? fromDir + "/" + raw : raw).split("/");
  const resolved = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== "." && p !== "") resolved.push(p);
  }
  const base = resolved.join("/");
  for (const s of suffixes) {
    if (pathSet.has(base + s)) return base + s;
  }
  return null;
}

/** Build forward (imports) and reverse (imported-by) adjacency maps. */
function buildImportGraph(files, packageMap = null) {
  const pathSet = new Set(files.map((f) => f.path));
  const forward = new Map();
  const reverse = new Map();
  for (const f of files) {
    forward.set(f.path, new Set());
    reverse.set(f.path, new Set());
  }

  for (const f of files) {
    for (const raw of extractRawImports(f.content, f.path)) {
      const resolved = resolveImport(raw, f.path, pathSet, packageMap);
      if (resolved) {
        forward.get(f.path).add(resolved);
        if (reverse.has(resolved)) reverse.get(resolved).add(f.path);
      }
    }
  }

  return { forward, reverse };
}

/**
 * Multi-source BFS — traverses both forward (imports) and reverse (used-by).
 * Returns Map<path, { depth, sources }> for all reached nodes.
 */
function bfs(roots, graph, maxDepth = 3, maxNodes = 80) {
  const { forward, reverse } = graph;
  const visited = new Map();
  const queue = roots.map((r) => ({ path: r, depth: 0, source: r }));

  while (queue.length > 0 && visited.size < maxNodes) {
    const { path, depth, source } = queue.shift();
    if (visited.has(path)) {
      visited.get(path).sources.add(source);
      continue;
    }
    visited.set(path, { depth, sources: new Set([source]) });

    if (depth < maxDepth) {
      const neighbors = [
        ...(forward.get(path) || []),
        ...(reverse.get(path) || []),
      ];
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push({ path: n, depth: depth + 1, source });
      }
    }
  }

  return visited;
}

/**
 * Find BFS roots:
 * 1. Files whose path contains task keywords
 * 2. Entry points (index/main/app near the root)
 * 3. Top-5 most-imported files
 */
function findRoots(files, keywords, graph) {
  const roots = new Set();
  const { reverse } = graph;

  // 1. Keyword path matches
  for (const f of files) {
    const norm = f.path.toLowerCase().replace(/[-_./]/g, " ");
    const words = norm.split(/\s+/);
    if (keywords.some((kw) => words.some((w) => w === kw || w.startsWith(kw)))) {
      roots.add(f.path);
    }
  }

  // 2. Entry points at shallow depth
  for (const f of files) {
    const parts = f.path.split("/");
    const name = parts[parts.length - 1].replace(/\.[^.]+$/, "").toLowerCase();
    if (parts.length <= 3 && ["index", "main", "app", "server", "cli", "mod"].includes(name)) {
      roots.add(f.path);
    }
  }

  // 3. High-degree nodes
  [...files]
    .sort((a, b) => (reverse.get(b.path) || new Set()).size - (reverse.get(a.path) || new Set()).size)
    .slice(0, 5)
    .forEach((f) => roots.add(f.path));

  return [...roots];
}

/**
 * Given parsed files with content, return them reordered so the most
 * graph-connected + keyword-relevant files come first.
 *
 * Files outside BFS reach are appended at the end (so LLM still sees them).
 */
export function orderByGraph(files, keywords, packageMap = null) {
  if (files.length <= 15) return files; // small enough, no reorder needed

  const graph = buildImportGraph(files, packageMap);
  const roots = findRoots(files, keywords, graph);

  if (roots.length === 0) return files;

  const visited = bfs(roots, graph, 3, files.length);

  // Score: root = 0, then by (−sources, depth)
  const rootSet = new Set(roots);
  const scored = files.map((f) => {
    const v = visited.get(f.path);
    if (!v) return { file: f, order: 1e9 }; // not reached by BFS
    const isRoot = rootSet.has(f.path) ? -1 : 0;
    return { file: f, order: isRoot * 1e6 - v.sources.size * 1000 + v.depth };
  });

  return scored.sort((a, b) => a.order - b.order).map((s) => s.file);
}
