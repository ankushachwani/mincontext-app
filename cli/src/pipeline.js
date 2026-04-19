import { fetchFileTree, fetchMultipleFiles } from "../lib/github.js";
import { getLocalFileTree, readLocalFiles } from "./local.js";
import { parseFile } from "../lib/parse.js";
import {
  extractKeywords,
  contentMatchScore,
  pathMatchScore,
} from "../lib/keywords.js";
import { orderByGraph } from "../lib/graph.js";
import { callLLM } from "./llm.js";
import { loadCache, saveCache } from "./cache.js";

// ── Head-scored content match (first N lines only) ────────────────────────────
function contentScoreHead(content, keywords, lines = 50) {
  return contentMatchScore(
    content.split("\n").slice(0, lines).join("\n"),
    keywords
  );
}

// ── Structural role detection ──────────────────────────────────────────────────
function detectRole(filePath, content) {
  const head = content.slice(0, 1200);
  const ext = filePath.split(".").pop().toLowerCase();
  const roles = [];
  if (ext === "py") {
    const inherit = head.match(/^class\s+\w+\s*\(([^)]+)\)/m);
    if (inherit) roles.push(`[inherits: ${inherit[1].trim()}]`);
    const deco = [
      ...head.matchAll(
        /@\w+\.(before_request|after_request|route|errorhandler)/g
      ),
    ];
    if (deco.length)
      roles.push(
        `[defines: ${[...new Set(deco.map((m) => m[1]))].join(", ")}]`
      );
  } else if (ext === "rb") {
    const inherit = head.match(/class\s+\w+\s*<\s*(\S+)/);
    if (inherit) roles.push(`[inherits: ${inherit[1]}]`);
    const inc = head.match(/^\s+include\s+(\w[\w:]*)/m);
    if (inc) roles.push(`[includes: ${inc[1]}]`);
  } else if (ext === "rs") {
    const impls = [...head.matchAll(/impl\s+([\w:]+)\s+for\s+(\w+)/g)];
    if (impls.length)
      roles.push(
        `[implements: ${impls
          .slice(0, 3)
          .map((m) => `${m[1]} for ${m[2]}`)
          .join(", ")}]`
      );
    const trait = head.match(/^pub\s+trait\s+(\w+)/m);
    if (trait) roles.push(`[trait: ${trait[1]}]`);
  } else if (ext === "go") {
    const iface = head.match(/type\s+(\w+)\s+interface\s*\{/);
    if (iface) roles.push(`[interface: ${iface[1]}]`);
  } else if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    const ext2 = head.match(/class\s+\w+\s+extends\s+(\w+)/);
    if (ext2) roles.push(`[extends: ${ext2[1]}]`);
  } else if (ext === "php") {
    const inherit = head.match(/class\s+\w+\s+extends\s+(\w+)/);
    if (inherit) roles.push(`[extends: ${inherit[1]}]`);
    const impl = head.match(/implements\s+([\w\\,\s]+)/);
    if (impl)
      roles.push(
        `[implements: ${impl[1]
          .trim()
          .split(/[\s,]+/)
          .slice(0, 2)
          .join(", ")}]`
      );
  }
  return roles.join(" ");
}

function isRegistrationFile(filePath) {
  const name = filePath
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
  return [
    "app", "application", "main", "server", "kernel", "bootstrap", "init",
  ].includes(name);
}

/**
 * Run the full mincontext pipeline.
 *
 * @param {string} task
 * @param {object} options
 * @param {string}   [options.owner]        - GitHub owner (required for GitHub source)
 * @param {string}   [options.repo]         - GitHub repo  (required for GitHub source)
 * @param {string}   [options.localDir]     - Absolute path (required for local source)
 * @param {string}   [options.groqKey]      - Groq API key
 * @param {boolean}  [options.ollama]       - Use Ollama instead of Groq
 * @param {string}   [options.ollamaUrl]
 * @param {string}   [options.ollamaModel]
 * @param {string}   [options.githubToken]
 * @param {boolean}  [options.useCache]     - default true
 * @param {function} [options.onProgress]   - (step: 0-4, detail: string) => void
 * @returns {{ files: Array<{path,content,summary,reason}>, fromCache: boolean }}
 */
export async function runPipeline(task, options = {}) {
  const {
    owner,
    repo,
    localDir,
    groqKey,
    ollama = false,
    ollamaUrl,
    ollamaModel,
    githubToken,
    useCache = true,
    onProgress = () => {},
  } = options;

  const isLocal = !!localDir;
  const t = task.trim();
  if (!t) throw new Error("Task description is required.");

  const llmConfig = { groqKey, ollama, ollamaUrl, ollamaModel };
  const cacheSource = isLocal ? `local:${localDir}` : `gh:${owner}/${repo}`;

  // ── Cache check ────────────────────────────────────────────────────────────
  if (useCache) {
    const cached = loadCache(cacheSource, t);
    if (cached) return { files: cached, fromCache: true };
  }

  const keywords = extractKeywords(t);

  // ── Step 0: Get file tree ──────────────────────────────────────────────────
  onProgress(0, isLocal ? "Reading local files..." : "Reading file tree...");
  const { files: treeFiles, allFilteredPaths, meta } = isLocal
    ? getLocalFileTree(localDir, keywords)
    : await fetchFileTree(owner, repo, githubToken || null, keywords);

  // ── Step 1: Fetch / read file contents ────────────────────────────────────
  onProgress(1, `${isLocal ? "Reading" : "Fetching"} ${treeFiles.length} files...`);
  const fetchedContent = new Map();
  const candidatePaths = treeFiles.map((f) => f.path);

  const contentMap = isLocal
    ? readLocalFiles(localDir, candidatePaths, (done, total) =>
        onProgress(1, `${done}/${total} files read`)
      )
    : await fetchMultipleFiles(owner, repo, candidatePaths, (done, total) =>
        onProgress(1, `${done}/${total} files fetched`)
      );

  for (const [k, v] of contentMap) fetchedContent.set(k, v);

  // ── Content rescue pass ────────────────────────────────────────────────────
  if (keywords.length > 0 && allFilteredPaths.length > candidatePaths.length) {
    const RESCUE_SOURCE_EXTS = new Set([
      ".py", ".go", ".rs", ".rb", ".js", ".ts", ".jsx", ".tsx",
      ".java", ".kt", ".c", ".cpp", ".cs", ".swift", ".php", ".vue", ".svelte",
    ]);
    const RESCUE_CORE_DIRS = new Set([
      "src", "lib", "pkg", "core", "internal", "app", "source", "main",
      "handler", "handlers", "middleware", "router", "routing", "dispatch",
    ]);
    const RESCUE_NOISE = [/\/dialects?\//i, /\/generated\//i, /\/vendor\//i];
    const isRescuable = (p) =>
      RESCUE_SOURCE_EXTS.has("." + p.split(".").pop().toLowerCase()) &&
      !RESCUE_NOISE.some((r) => r.test(p));

    const selectedSet = new Set(candidatePaths);
    const validCut = allFilteredPaths
      .filter((p) => !selectedSet.has(p) && isRescuable(p));

    const byDepth = (arr) =>
      [...arr].sort((a, b) => a.split("/").length - b.split("/").length);
    const kwHits = validCut.filter((p) =>
      keywords.some((kw) => p.toLowerCase().replace(/[-_.]/g, " ").includes(kw))
    );
    const kwSet = new Set(kwHits);
    const coreSrc = validCut.filter(
      (p) => !kwSet.has(p) &&
        p.split("/").some((d) => RESCUE_CORE_DIRS.has(d.toLowerCase()))
    );
    const coreSrcSet = new Set(coreSrc);
    const rest = validCut.filter((p) => !kwSet.has(p) && !coreSrcSet.has(p));
    const rescueSample = [
      ...byDepth(kwHits).slice(0, 30),
      ...byDepth(coreSrc).slice(0, 50),
      ...byDepth(rest).slice(0, 10),
    ].slice(0, 80);

    if (rescueSample.length > 0) {
      const rescueMap = isLocal
        ? readLocalFiles(localDir, rescueSample)
        : await fetchMultipleFiles(owner, repo, rescueSample);

      const candidateScored = candidatePaths
        .map((p) => ({
          path: p,
          score: contentScoreHead(fetchedContent.get(p) || "", keywords),
        }))
        .sort((a, b) => a.score - b.score);

      const cutScored = rescueSample
        .map((p) => ({
          path: p,
          score: contentScoreHead(rescueMap.get(p) || "", keywords),
        }))
        .filter((f) => f.score >= 0.25)
        .sort((a, b) => b.score - a.score);

      for (let i = 0; i < Math.min(5, cutScored.length); i++) {
        if (i >= candidateScored.length) break;
        if (cutScored[i].score > candidateScored[i].score) {
          fetchedContent.delete(candidateScored[i].path);
          fetchedContent.set(cutScored[i].path, rescueMap.get(cutScored[i].path));
        }
      }
    }
  }

  // ── Step 2: Parse + graph-order ────────────────────────────────────────────
  onProgress(2, "Parsing files and building import graph...");

  const allPaths = [...fetchedContent.keys()];
  const parsed = allPaths
    .filter((p) => fetchedContent.get(p) != null)
    .map((path) => {
      const content = fetchedContent.get(path) || "";
      return { path, content, ...parseFile(path, content) };
    });

  const packageMap = new Map();
  for (const f of parsed) {
    if (
      f.path.match(/^(packages|apps|libs)\/[^/]+\/package\.json$/) &&
      f.content
    ) {
      try {
        const pkg = JSON.parse(f.content);
        if (pkg.name) packageMap.set(pkg.name, f.path.replace("/package.json", ""));
      } catch {}
    }
  }

  const graphOrdered = orderByGraph(
    parsed, keywords, packageMap.size > 0 ? packageMap : null
  );

  let ordered;
  if (keywords.length > 0) {
    const CONTENT_THRESHOLD = 0.2;
    const withScores = graphOrdered.map((f) => ({
      ...f,
      _cs: contentMatchScore(f.content || "", keywords),
    }));
    const high = withScores
      .filter((f) => f._cs >= CONTENT_THRESHOLD)
      .sort((a, b) => b._cs - a._cs);
    const highSet = new Set(high.map((f) => f.path));
    ordered = [...high, ...withScores.filter((f) => !highSet.has(f.path))];
  } else {
    ordered = graphOrdered;
  }

  onProgress(
    2,
    `${meta.totalInRepo.toLocaleString()} total → ${meta.totalFiltered.toLocaleString()} filtered → ${ordered.length} candidates`
  );

  // ── Step 3: LLM pruning ────────────────────────────────────────────────────
  onProgress(3, "Reviewing candidates...");

  const MAX_LLM_FILES = Math.min(
    75, Math.max(35, Math.floor(Math.log10(meta.totalFiltered + 1) * 18))
  );
  const MAX_PRUNE_TOKENS = Math.max(2500, MAX_LLM_FILES * 90);
  const PER_FILE_BUDGET =
    meta.totalFiltered > 5000 ? 300
    : meta.totalFiltered > 1000 ? 360
    : meta.totalFiltered > 500 ? 400
    : meta.totalFiltered > 150 ? 460
    : 560;
  const MAX_PROMPT_CHARS = 36000;

  let fileDescriptions = "";
  let includedForLLM = [];
  for (const f of ordered) {
    if (includedForLLM.length >= MAX_LLM_FILES) break;
    if (fileDescriptions.length > MAX_PROMPT_CHARS) break;
    const detail = f.summary.startsWith(f.path + ": ")
      ? f.summary.slice(f.path.length + 2)
      : f.summary || f.path;
    const role = detectRole(f.path, f.content || "");
    const codeLines = (f.content || "").split("\n").slice(0, 15).join("\n");
    let entry = `FILE: ${f.path}`;
    if (role) entry += `\n${role}`;
    entry += `\n${detail}\n---\n${codeLines}`;
    if (entry.length > PER_FILE_BUDGET) entry = entry.slice(0, PER_FILE_BUDGET) + "…";
    fileDescriptions += (fileDescriptions ? "\n\n" : "") + entry;
    includedForLLM.push(f);
  }

  const keptSet = new Set();
  let allPruneResults = [];
  const TINY_REPO = 20;

  if (includedForLLM.length <= TINY_REPO) {
    onProgress(3, `${includedForLLM.length} candidates — using ranked order`);
    ordered.slice(0, 8).forEach((f) => keptSet.add(f.path));
  } else {
    onProgress(3, `Reviewing ${includedForLLM.length} candidates...`);
    let usedFallback = false;

    try {
      const pruneData = await callLLM(
        [{
          role: "user",
          content: `You are a senior engineer identifying the MINIMUM file set needed to complete a programming task.

Task: "${t}"

REMOVE (removable: true) if the file:
- Handles a clearly different feature area not needed for this task
- Is metadata or config not specific to this task
- The developer could complete the task without ever opening this file

KEEP (removable: false) if the file:
- Directly implements or defines the feature
- Is the single framework-level file where this specific feature type is registered or processed
- Is a base class a kept file MUST inherit from (check [inherits:] or [extends:] annotations)
- Contains logic that MUST be read or modified to complete the task

Be aggressive: 4 perfect files beats 12 with noise. When in doubt, remove.

Return ONLY a JSON array — no markdown, no explanation:
[{"file":"path","removable":false,"reason":"one sentence"},...]

Include ALL ${includedForLLM.length} files.

FILES:
${fileDescriptions}`,
        }],
        MAX_PRUNE_TOKENS,
        llmConfig
      );

      const pruneText = pruneData.choices?.[0]?.message?.content || "";
      let pruneResults = [];
      try {
        const match = pruneText.match(/\[[\s\S]*\]/);
        pruneResults = JSON.parse(match ? match[0] : pruneText);
      } catch {
        usedFallback = true;
      }

      if (!usedFallback) {
        allPruneResults = pruneResults;
        pruneResults.filter((r) => !r.removable).forEach((r) => keptSet.add(r.file));
        if (keptSet.size < 1) includedForLLM.forEach((f) => keptSet.add(f.path));
      }
    } catch (err) {
      usedFallback = true;
      if (err.message.includes("Invalid Groq") || err.message.includes("API key")) {
        throw err;
      }
    }

    if (usedFallback) {
      ordered.slice(0, 6).forEach((f) => keptSet.add(f.path));
    }
  }

  const keptFiles = ordered.filter((f) => keptSet.has(f.path));

  // ── Step 4: Sufficiency check ──────────────────────────────────────────────
  onProgress(4, "Verifying completeness...");

  const keptSummaries = keptFiles
    .map((f) => {
      const role = detectRole(f.path, f.content || "");
      const detail = f.summary.startsWith(f.path + ": ")
        ? f.summary.slice(f.path.length + 2)
        : f.summary;
      return `- ${f.path}${role ? " " + role : ""}: ${detail}`;
    })
    .join("\n");

  const availablePaths = parsed
    .filter(
      (f) => !keptSet.has(f.path) &&
        (keywords.length === 0 || pathMatchScore(f.path, keywords) > 0)
    )
    .map((f) => f.path)
    .join("\n");

  try {
    const checkData = await callLLM(
      [{
        role: "user",
        content: `Task: "${t}"

Files kept after pruning:
${keptSummaries}

Check ONLY for these two things:
1. A base class or mixin a kept file explicitly inherits from — visible in [inherits:] or [extends:] annotations above
2. The top-level application/router entry file (app.go, application.js, Application.php, app.rs, Kernel.php, server.js) where this feature type gets registered in the framework

For case 1 (base class): provide "cited_by" — the exact kept file that inherits from it. No valid citation = skip it.
For case 2 (registration file): provide "type":"registration" — no citation needed, just name the entry file.
Max 3 additions total. Do NOT add type utilities, helpers, or unrelated files.

Available paths:
${availablePaths || "(none)"}

Return ONLY valid JSON:
{"sufficient":true,"missing":[]}
{"sufficient":false,"missing":[
  {"path":"exact/path","cited_by":"kept/file/that/inherits"},
  {"path":"app.go","type":"registration"}
]}`,
      }],
      500,
      llmConfig
    );

    const checkText = checkData.choices?.[0]?.message?.content || "";
    try {
      const match = checkText.match(/\{[\s\S]*\}/);
      const checkResult = JSON.parse(match ? match[0] : checkText);
      if (!checkResult.sufficient && Array.isArray(checkResult.missing)) {
        const availableSet = new Set(parsed.map((f) => f.path));
        let added = 0;
        let registrationAdded = 0;
        for (const item of checkResult.missing) {
          if (added >= 3) break;
          const missingPath = typeof item === "string" ? item : item?.path;
          const citedBy = typeof item === "object" ? item?.cited_by : null;
          const itemType = typeof item === "object" ? item?.type : null;
          if (!missingPath || !availableSet.has(missingPath)) continue;
          if (itemType === "registration" || isRegistrationFile(missingPath)) {
            if (registrationAdded >= 1) continue;
            keptSet.add(missingPath); added++; registrationAdded++;
          } else {
            if (!citedBy || !keptSet.has(citedBy)) continue;
            keptSet.add(missingPath); added++;
          }
        }
      }
    } catch {}
  } catch (err) {
    if (err.message.includes("Invalid Groq") || err.message.includes("API key")) throw err;
  }

  // ── Final results ──────────────────────────────────────────────────────────
  const reasonMap = new Map(allPruneResults.map((r) => [r.file, r.reason]));
  const finalResults = parsed
    .filter((f) => keptSet.has(f.path))
    .map((f) => ({
      path: f.path,
      content: f.content,
      summary: f.summary,
      reason:
        reasonMap.get(f.path) ||
        (f.summary.startsWith(f.path + ": ")
          ? f.summary.slice(f.path.length + 2)
          : f.summary),
    }));

  if (useCache) saveCache(cacheSource, t, finalResults);

  return { files: finalResults, fromCache: false };
}
