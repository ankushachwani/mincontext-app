"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchFileTree, fetchMultipleFiles } from "../lib/github";
import { parseFile } from "../lib/parse";
import { extractKeywords, contentMatchScore, pathMatchScore } from "../lib/keywords";
// embed is dynamically imported inside runAnalysis so webpack never
// traces @xenova/transformers into the server bundle.

// ── Head-scored content match (first N lines only) ────────────────────────────
// Large files declare their purpose at the top (imports, type signatures).
// Full-file TF scoring dilutes this signal; head scoring is more discriminating.
function contentScoreHead(content, keywords, lines = 50) {
  return contentMatchScore(content.split("\n").slice(0, lines).join("\n"), keywords);
}

// ── Structural role detection ─────────────────────────────────────────────────
// Annotates each file with its structural role (base class, trait, interface, etc.)
// so the LLM sees relationship context beyond the filename and summary.
function detectRole(filePath, content) {
  const head = content.slice(0, 1200);
  const ext = filePath.split(".").pop().toLowerCase();
  const roles = [];
  if (ext === "py") {
    const inherit = head.match(/^class\s+\w+\s*\(([^)]+)\)/m);
    if (inherit) roles.push(`[inherits: ${inherit[1].trim()}]`);
    const deco = [...head.matchAll(/@\w+\.(before_request|after_request|route|errorhandler)/g)];
    if (deco.length) roles.push(`[defines: ${[...new Set(deco.map(m => m[1]))].join(", ")}]`);
  } else if (ext === "rb") {
    const inherit = head.match(/class\s+\w+\s*<\s*(\S+)/);
    if (inherit) roles.push(`[inherits: ${inherit[1]}]`);
    const inc = head.match(/^\s+include\s+(\w[\w:]*)/m);
    if (inc) roles.push(`[includes: ${inc[1]}]`);
  } else if (ext === "rs") {
    const impls = [...head.matchAll(/impl\s+([\w:]+)\s+for\s+(\w+)/g)];
    if (impls.length) roles.push(`[implements: ${impls.slice(0,3).map(m => `${m[1]} for ${m[2]}`).join(", ")}]`);
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
    if (impl) roles.push(`[implements: ${impl[1].trim().split(/[\s,]+/).slice(0,2).join(", ")}]`);
  }
  return roles.join(" ");
}

// ── Registration/entry file detection ────────────────────────────────────────
// Wiring files (app.go, application.js, Kernel.php…) register features in the
// framework. The sufficiency check can add them without a citation because
// kept files don't import them — it's the other way around.
function isRegistrationFile(filePath) {
  const name = filePath.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  return ["app", "application", "main", "server", "kernel", "bootstrap", "init"].includes(name);
}

const STEPS = ["Fetching tree", "Fetching files", "Analyzing", "Narrowing down", "Verifying"];

function useLocalStorage(key, defaultValue) {
  const [val, setVal] = useState(defaultValue);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setVal(stored);
    } catch {}
  }, [key]);
  const save = useCallback((v) => {
    setVal(v);
    try { localStorage.setItem(key, v); } catch {}
  }, [key]);
  return [val, save];
}

function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [groqKey, setGroqKey] = useLocalStorage("groq_key", "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [showKeyNotif, setShowKeyNotif] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [keyAction, setKeyAction] = useState(null); // null | 'saved' | 'removed'

  useEffect(() => { if (showKeyInput) { setDraftKey(groqKey); setKeyAction(null); } }, [showKeyInput]);

  // Show the key notification on every page visit if no key is set
  useEffect(() => {
    const stored = localStorage.getItem("groq_key") || "";
    if (!stored) setShowKeyNotif(true);
  }, []);

  function parseInput(val) {
    val = val.trim();
    const urlMatch = val.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/);
    if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
    const slashMatch = val.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const parsed = parseInput(input);
    if (!parsed) { setError("Enter a GitHub URL or owner/repo (e.g. facebook/react)"); return; }
    setError("");
    router.push(`/${parsed.owner}/${parsed.repo}`);
  }

  const examples = [
    { label: "expressjs/express", path: "/expressjs/express", task: "add error handling middleware" },
    { label: "gin-gonic/gin",     path: "/gin-gonic/gin",     task: "add custom middleware" },
    { label: "reduxjs/redux",     path: "/reduxjs/redux",     task: "add logging middleware" },
    { label: "pallets/flask",     path: "/pallets/flask",     task: "add a before_request hook" },
  ];

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", background: "var(--bg)", position: "relative" }}>

      {/* Top-right API key button */}
      <div style={{ position: "fixed", top: "1rem", right: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", zIndex: 20 }}>
        <button
          onClick={() => setShowKeyInput(!showKeyInput)}
          style={{
            background: groqKey ? "rgba(34,197,94,0.1)" : "var(--bg-secondary)",
            border: `1px solid ${groqKey ? "var(--success)" : "var(--border-active)"}`,
            borderRadius: "6px",
            color: groqKey ? "var(--success)" : "var(--text-secondary)",
            fontSize: "0.78rem", padding: "0.35rem 0.75rem", cursor: "pointer",
            fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          {groqKey ? "● API key set" : "+ Add API key"}
        </button>

        {showKeyInput && (
          <div style={{
            position: "absolute", top: "calc(100% + 0.5rem)", right: 0,
            background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
            borderRadius: "8px", padding: "1rem", width: "320px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 30,
          }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: 600, marginBottom: "0.4rem" }}>
              Groq API key
            </div>
            <div style={{ fontSize: "0.73rem", color: "var(--text-muted)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
              Get a free key at{" "}
              <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", cursor: "pointer" }}>console.groq.com</a>
              . Stored in your browser only.
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                type="password"
                value={draftKey}
                onChange={e => setDraftKey(e.target.value)}
                placeholder="gsk_..."
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--bg)", border: "1px solid var(--border-active)",
                  borderRadius: "5px", color: "var(--text-primary)", padding: "0.45rem 2rem 0.45rem 0.6rem",
                  fontSize: "0.82rem", fontFamily: "inherit", outline: "none",
                }}
              />
              {draftKey && (
                <button
                  onClick={() => { navigator.clipboard.writeText(draftKey); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 1500); }}
                  title="Copy key"
                  style={{
                    position: "absolute", right: "0.4rem",
                    background: "none", border: "none", cursor: "pointer",
                    color: keyCopied ? "var(--success)" : "var(--text-muted)", padding: "0.1rem", display: "flex", alignItems: "center",
                    transition: "color 0.15s",
                  }}
                >
                  {keyCopied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.6rem", gap: "0.5rem" }}>
              {groqKey && (
                <button
                  onClick={() => { setKeyAction("removed"); setGroqKey(""); setDraftKey(""); setTimeout(() => setShowKeyInput(false), 700); }}
                  style={{
                    background: "none", border: `1px solid ${keyAction === "removed" ? "var(--error, #ef4444)" : "var(--border)"}`,
                    borderRadius: "4px", color: keyAction === "removed" ? "var(--error, #ef4444)" : "var(--text-muted)",
                    fontSize: "0.78rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontFamily: "inherit",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                >
                  {keyAction === "removed" ? "Removed ✓" : "Remove key"}
                </button>
              )}
              <button
                onClick={() => { setKeyAction("saved"); setGroqKey(draftKey); setTimeout(() => setShowKeyInput(false), 700); }}
                style={{
                  background: keyAction === "saved" ? "var(--success)" : "var(--accent)",
                  border: "none", borderRadius: "4px", color: "#fff", fontSize: "0.78rem",
                  padding: "0.3rem 0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, marginLeft: "auto",
                  transition: "background 0.15s",
                }}
              >
                {keyAction === "saved" ? "Saved ✓" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Key notification — speech bubble anchored to the API key button */}
      {showKeyNotif && (
        <div style={{
          position: "fixed", top: "3.2rem", right: "1.25rem",
          zIndex: 50,
        }}>
          {/* Tail pointing up-right toward the button */}
          <div style={{
            position: "absolute", top: "-7px", right: "18px",
            width: 0, height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderBottom: "7px solid var(--border-active)",
          }} />
          <div style={{
            position: "absolute", top: "-5px", right: "19px",
            width: 0, height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderBottom: "6px solid var(--bg-secondary)",
            zIndex: 1,
          }} />
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-active)",
            borderRadius: "10px",
            padding: "1rem 1.1rem",
            width: "270px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-primary)", fontSize: "0.85rem", fontWeight: 700 }}>
                API key required
              </span>
              <button
                onClick={() => setShowKeyNotif(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", lineHeight: 1, padding: 0, marginLeft: "0.75rem" }}
              >
                ×
              </button>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.6, margin: "0 0 0.85rem" }}>
              A free Groq API key is required to run analyses. Takes 2 minutes to set up, no card needed.
            </p>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                onClick={() => { setShowKeyNotif(false); setShowKeyInput(true); }}
                style={{
                  flex: 1,
                  background: "var(--accent)", border: "none", borderRadius: "5px",
                  color: "#fff", fontSize: "0.78rem", padding: "0.45rem 0.75rem",
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                }}
              >
                Add key →
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ width: "100%", maxWidth: "560px" }}>
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", marginBottom: "0.9rem" }}>
            <span style={{ fontSize: "0.95rem", color: "var(--accent)", fontWeight: 700 }}>mincontext</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>.dev</span>
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.25 }}>
            Minimum Context Finder
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.6rem", lineHeight: 1.6, maxWidth: "420px" }}>
            Paste a GitHub repo, describe what you&apos;re building. Get back the exact files worth reading — nothing more.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", border: `1px solid ${error ? "var(--error)" : "var(--border-active)"}`, borderRadius: "6px", overflow: "hidden", background: "var(--bg-secondary)" }}>
            <span style={{ padding: "0.75rem 0.875rem", color: "var(--text-muted)", fontSize: "0.85rem", borderRight: "1px solid var(--border)", display: "flex", alignItems: "center", whiteSpace: "nowrap", userSelect: "none", flexShrink: 0 }}>
              github.com/
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              placeholder="owner/repo"
              autoFocus
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: "0.9rem", padding: "0.75rem 0.875rem", fontFamily: "inherit", minWidth: 0 }}
            />
            <button type="submit" style={{ padding: "0.75rem 1.25rem", background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit", fontWeight: 600, flexShrink: 0 }}>
              Open →
            </button>
          </div>
          {error && <p style={{ color: "var(--error)", fontSize: "0.8rem", marginTop: "0.4rem" }}>{error}</p>}
        </form>

        <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>try:</span>
          {examples.map((ex) => (
            <button key={ex.label} onClick={() => router.push(`${ex.path}?task=${encodeURIComponent(ex.task)}`)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-secondary)", fontSize: "0.78rem", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
              {ex.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {[
            { label: "Import-aware", desc: "Builds a real import graph across the repo — connected files surface together." },
            { label: "Any language", desc: "JavaScript, TypeScript, Python, Go, Rust, Ruby, Java, and more." },
            { label: "Built for AI tools", desc: "Copy file links directly into Claude, ChatGPT, Cursor, or any AI assistant." },
          ].map(({ label, desc }) => (
            <div key={label}>
              <div style={{ color: "var(--text-primary)", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>{label}</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function cacheKey(owner, repo, task) {
  return `mc_${owner}/${repo}/${task.toLowerCase().trim()}`;
}

function loadCache(owner, repo, task) {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo, task));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(cacheKey(owner, repo, task)); return null; }
    return data;
  } catch { return null; }
}

function saveCache(owner, repo, task, data) {
  try {
    localStorage.setItem(cacheKey(owner, repo, task), JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export default function RepoPage({ params }) {
  const router = useRouter();
  const slug = params?.slug || [];

  const owner = slug[0];
  const repo = slug[1];
  const isHomePage = !owner && !repo;

  const [task, setTask] = useState("");
  const [status, setStatus] = useState(null); // null | 'running' | 'done' | 'error'
  const [step, setStep] = useState(0);
  const [stepDetail, setStepDetail] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState("");
  const [largeRepoWarning, setLargeRepoWarning] = useState("");
  const [repoTotalFiles, setRepoTotalFiles] = useState(0);
  const [ranTask, setRanTask] = useState(""); // task that produced current results
  const [fromCache, setFromCache] = useState(false);
  const [groqKey, setGroqKeyState] = useLocalStorage("groq_key", "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [keyAction, setKeyAction] = useState(null); // null | 'saved' | 'removed'
  const abortRef = useRef(false);

  useEffect(() => { if (showKeyInput) { setDraftKey(groqKey); setKeyAction(null); } }, [showKeyInput]);
  const taskInputRef = useRef(null);

  // On mount: read task from URL and pre-fill the input.
  // Avoids useSearchParams which causes a hydration mismatch in Next.js 14.
  useEffect(() => {
    if (!owner || !repo) return;
    const urlTask = new URLSearchParams(window.location.search).get("task");
    if (urlTask) setTask(urlTask);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isHomePage) return <HomePage />;

  async function checkServerCache(owner, repo, task) {
    try {
      const k = `${owner}/${repo}/${task}`;
      const res = await fetch(`/api/cache?k=${encodeURIComponent(k)}`);
      if (!res.ok) return null;
      const { files } = await res.json() || {};
      if (!Array.isArray(files) || !files.length) return null;
      // Re-fetch content from GitHub (fast: 3-4 files in parallel)
      const contentMap = await fetchMultipleFiles(owner, repo, files.map(f => f.path));
      const { parseFile } = await import("../lib/parse");
      return files
        .filter(f => contentMap.get(f.path) != null)
        .map(f => ({
          path: f.path,
          content: contentMap.get(f.path) || "",
          summary: f.path,
          reason: f.reason || "",
          ...parseFile(f.path, contentMap.get(f.path) || ""),
        }));
    } catch { return null; }
  }

  function storeServerCache(owner, repo, task, finalResults) {
    const k = `${owner}/${repo}/${task}`;
    fetch("/api/cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: k,
        files: finalResults.map(f => ({ path: f.path, reason: f.reason })),
      }),
    }).catch(() => {});
  }

  async function runAnalysis(taskOverride) {
    const t = (taskOverride ?? task).trim();
    if (!t) return;

    // Check cache — play through steps animation before revealing
    const cached = loadCache(owner, repo, t) || await checkServerCache(owner, repo, t);
    if (cached) {
      setTask(t);
      setFromCache(true);
      setStatus("running");
      setStep(0); setStepDetail("Reading file tree...");
      window.history.replaceState(null, "", `/${owner}/${repo}?task=${encodeURIComponent(t)}`);
      await new Promise(r => setTimeout(r, 300));
      setStep(1); setStepDetail(`${cached.length} files fetched`);
      await new Promise(r => setTimeout(r, 300));
      setStep(2); setStepDetail("Building import graph...");
      await new Promise(r => setTimeout(r, 300));
      setStep(3); setStepDetail(`Reviewing ${cached.length} candidates...`);
      await new Promise(r => setTimeout(r, 300));
      setStep(4); setStepDetail("Verifying completeness...");
      await new Promise(r => setTimeout(r, 250));
      setResults(cached);
      setSelected(new Set(cached.map(r => r.path)));
      setRanTask(t);
      setStatus("done");
      return;
    }

    abortRef.current = false;
    setStatus("running");
    setStep(0);
    setStepDetail("");
    setResults([]);
    setError("");
    setLargeRepoWarning("");
    setFromCache(false);
    setTask(t);
    window.history.replaceState(null, "", `/${owner}/${repo}?task=${encodeURIComponent(t)}`);

    // Read key directly from localStorage to avoid stale closure on auto-run
    const activeKey = groqKey || (typeof window !== "undefined" ? localStorage.getItem("groq_key") || "" : "");

    // Require an API key — shared quota uses a model too small for accurate results
    if (!activeKey) {
      setShowKeyInput(true);
      return;
    }

    const keywords = extractKeywords(t);

    try {
      // ── Step 0: Fetch file tree (IDF pre-filter) ─────────────────────────
      setStep(0);
      setStepDetail("Reading file tree...");
      const { files: treeFiles, allFilteredPaths, meta } = await fetchFileTree(owner, repo, null, keywords);
      if (abortRef.current) return;

      setRepoTotalFiles(meta.totalInRepo);
      if (meta.totalInRepo > 5000) {
        setLargeRepoWarning(`Large repository (${meta.totalInRepo.toLocaleString()} files) — this may take additional time.`);
      }

      // ── Step 1: Fetch all file contents ──────────────────────────────────
      setStep(1);
      const fetchedContent = new Map();
      const candidatePaths = treeFiles.map(f => f.path);
      const contentMap = await fetchMultipleFiles(owner, repo, candidatePaths,
        (done, total) => setStepDetail(`${done}/${total} files fetched`)
      );
      for (const [k, v] of contentMap) fetchedContent.set(k, v);
      if (abortRef.current) return;

      // ── Content rescue pass ───────────────────────────────────────────────
      // After IDF path-scoring selects ~80 candidates, some high-value files
      // get cut because they have generic names (e.g. handlers/base.py for a
      // middleware task). Rescue: fetch content for a smart sample of cut files,
      // score by keyword density, and swap the weakest candidates for any
      // cut files that score significantly higher.
      if (keywords.length > 0 && allFilteredPaths.length > candidatePaths.length) {
        const RESCUE_SOURCE_EXTS = new Set(['.py','.go','.rs','.rb','.js','.ts','.jsx','.tsx','.java','.kt','.c','.cpp','.cs','.swift','.php','.vue','.svelte']);
        const RESCUE_CORE_DIRS   = new Set(['src','lib','pkg','core','internal','app','source','main','handler','handlers','middleware','router','routing','dispatch']);
        // v6: filter dialect/generated/vendor noise from rescue candidates
        const RESCUE_NOISE = [/\/dialects?\//i, /\/generated\//i, /\/vendor\//i];
        const isRescuable = p =>
          RESCUE_SOURCE_EXTS.has('.' + p.split('.').pop().toLowerCase()) &&
          !RESCUE_NOISE.some(r => r.test(p));

        const selectedSet = new Set(candidatePaths);
        const cutPaths    = allFilteredPaths.filter(p => !selectedSet.has(p));
        const validCut    = cutPaths.filter(isRescuable);

        // Sampling order: files with keyword in path first (most likely relevant),
        // then source files in core dirs, then everything else.
        const byDepth = arr => [...arr].sort((a, b) => a.split('/').length - b.split('/').length);
        const kwHits  = validCut.filter(p => keywords.some(kw => p.toLowerCase().replace(/[-_.]/g, ' ').includes(kw)));
        const kwSet   = new Set(kwHits);
        const coreSrc = validCut.filter(p => !kwSet.has(p) && p.split('/').some(d => RESCUE_CORE_DIRS.has(d.toLowerCase())));
        const coreSrcSet = new Set(coreSrc);
        const rest    = validCut.filter(p => !kwSet.has(p) && !coreSrcSet.has(p));
        const rescueSample = [
          ...byDepth(kwHits).slice(0, 30),
          ...byDepth(coreSrc).slice(0, 50),
          ...byDepth(rest).slice(0, 10),
        ].slice(0, 80);

        if (rescueSample.length > 0) {
          const rescueMap = await fetchMultipleFiles(owner, repo, rescueSample);

          // v6: use head scoring (first 50 lines) — large structural files declare
          // their purpose at the top; full-file scoring dilutes the signal.
          const candidateScored = candidatePaths
            .map(p => ({ path: p, score: contentScoreHead(fetchedContent.get(p) || "", keywords) }))
            .sort((a, b) => a.score - b.score);

          const cutScored = rescueSample
            .map(p => ({ path: p, score: contentScoreHead(rescueMap.get(p) || "", keywords) }))
            .filter(f => f.score >= 0.25)
            .sort((a, b) => b.score - a.score);

          // Swap: replace weakest candidates with stronger cut files
          for (let i = 0; i < Math.min(5, cutScored.length); i++) {
            if (i >= candidateScored.length) break;
            if (cutScored[i].score > candidateScored[i].score) {
              fetchedContent.delete(candidateScored[i].path);
              fetchedContent.set(cutScored[i].path, rescueMap.get(cutScored[i].path));
            }
          }
        }
      }
      if (abortRef.current) return;

      // ── Step 2: Parse + graph-order candidates ────────────────────────────
      setStep(2);
      setStepDetail("Parsing files and building import graph...");

      const allPaths = [...fetchedContent.keys()];
      const parsed = allPaths
        .filter(p => fetchedContent.get(p) != null)
        .map(path => {
          const content = fetchedContent.get(path) || "";
          return { path, content, ...parseFile(path, content) };
        });

      // Build monorepo package map: package-name → directory path
      // Used to resolve cross-package imports (e.g. @supabase/pg-meta → packages/pg-meta/src)
      const packageMap = new Map();
      for (const f of parsed) {
        if (f.path.match(/^(packages|apps|libs)\/[^/]+\/package\.json$/) && f.content) {
          try {
            const pkg = JSON.parse(f.content);
            if (pkg.name) packageMap.set(pkg.name, f.path.replace("/package.json", ""));
          } catch {}
        }
      }

      const { orderByGraph } = await import("../lib/graph");
      const graphOrdered = orderByGraph(parsed, keywords, packageMap.size > 0 ? packageMap : null);

      // Content re-ranking: promote files whose content strongly matches keywords.
      // This catches files with generic names but task-specific content (e.g. ReactFiberThrow.js).
      // High-scorers float to the top of the LLM window; the LLM pruner removes false positives.
      let ordered;
      if (keywords.length > 0) {
        const CONTENT_THRESHOLD = 0.2;
        const withScores = graphOrdered.map(f => ({
          ...f,
          _cs: contentMatchScore(f.content || "", keywords),
        }));
        const high = withScores.filter(f => f._cs >= CONTENT_THRESHOLD)
          .sort((a, b) => b._cs - a._cs);
        const highSet = new Set(high.map(f => f.path));
        ordered = [...high, ...withScores.filter(f => !highSet.has(f.path))];
      } else {
        ordered = graphOrdered;
      }

      setStepDetail(
        `${meta.totalInRepo.toLocaleString()} total → ${meta.totalFiltered.toLocaleString()} filtered → ${ordered.length} candidates`
      );
      await new Promise(r => setTimeout(r, 60));
      if (abortRef.current) return;

      // ── Step 3: LLM pruning ───────────────────────────────────────────────
      setStep(3);

      // Scale candidate window with repo size so large repos (django, rails) get
      // enough structural files into the LLM window.
      // Formula: log10(totalFiltered) * 18, clamped [35, 75].
      // ~300 files → 44, ~1000 → 54, ~3000 → 63, ~10000 → 72
      const MAX_LLM_FILES = Math.min(75, Math.max(35, Math.floor(Math.log10(meta.totalFiltered + 1) * 18)));
      const MAX_PRUNE_TOKENS = Math.max(2500, MAX_LLM_FILES * 90);
      // v6: finer adaptive budget + hard char cap to prevent token overflow on large repos
      const PER_FILE_BUDGET =
        meta.totalFiltered > 5000 ? 300 :
        meta.totalFiltered > 1000 ? 360 :
        meta.totalFiltered > 500  ? 400 :
        meta.totalFiltered > 150  ? 460 : 560;
      const MAX_PROMPT_CHARS = 36000;
      let fileDescriptions = "";
      let includedForLLM = [];
      for (const f of ordered) {
        if (includedForLLM.length >= MAX_LLM_FILES) break;
        if (fileDescriptions.length > MAX_PROMPT_CHARS) break;
        const detail = f.summary.startsWith(f.path + ": ")
          ? f.summary.slice(f.path.length + 2)
          : (f.summary || f.path);
        // v6: include structural role annotation + first 15 code lines
        const role = detectRole(f.path, f.content || "");
        const codeLines = (f.content || "").split("\n").slice(0, 15).join("\n");
        let entry = `FILE: ${f.path}`;
        if (role) entry += `\n${role}`;
        entry += `\n${detail}\n---\n${codeLines}`;
        if (entry.length > PER_FILE_BUDGET) entry = entry.slice(0, PER_FILE_BUDGET) + "…";
        fileDescriptions += (fileDescriptions ? "\n\n" : "") + entry;
        includedForLLM.push(f);
      }

      const llmHeaders = { "Content-Type": "application/json", ...(activeKey ? { "x-groq-key": activeKey } : {}) };

      // For tiny repos (≤20 candidates) the LLM degrades quality — it receives
      // nearly everything and hedges toward keeping all of it. Skip it and rely
      // on the content/graph ordering which is already calibrated.
      const keptSet = new Set();
      let allPruneResults = []; // [{file, removable, reason}] — populated when LLM runs
      const TINY_REPO = 20;

      if (includedForLLM.length <= TINY_REPO) {
        setStepDetail(`${includedForLLM.length} candidates — using ranked order`);
        ordered.slice(0, 8).forEach(f => keptSet.add(f.path));
      } else {
        setStepDetail(`Reviewing ${includedForLLM.length} candidates...`);

        const pruneRes = await fetch("/api/llm", {
          method: "POST",
          headers: llmHeaders,
          body: JSON.stringify({
            messages: [{
              role: "user",
              content:
`You are a senior engineer identifying the MINIMUM file set needed to complete a programming task.

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
            max_tokens: MAX_PRUNE_TOKENS,
          }),
        });

        let usedFallback = false;
        if (!pruneRes.ok) {
          // LLM unavailable (rate limit, outage, etc.) — fall back to graph+content ordering.
          // Users still get useful results; a banner will note AI pruning was skipped.
          usedFallback = true;
        }

        if (!usedFallback) {
          const pruneData = await pruneRes.json();
          if (abortRef.current) return;

          const pruneText = pruneData.choices?.[0]?.message?.content || "";
          let pruneResults = [];
          try {
            const match = pruneText.match(/\[[\s\S]*\]/);
            pruneResults = JSON.parse(match ? match[0] : pruneText);
          } catch {
            usedFallback = true;
          }

          if (!usedFallback) {
            // v6: LLM returns [{file, removable, reason}] objects
            allPruneResults = pruneResults;
            pruneResults.filter(r => !r.removable).forEach(r => keptSet.add(r.file));
            if (keptSet.size < 1) includedForLLM.forEach(f => keptSet.add(f.path));
          }
        }

        if (usedFallback) {
          // Heuristic fallback: top files by graph+content ranking, no LLM needed
          ordered.slice(0, 6).forEach(f => keptSet.add(f.path));
          setModelStatus("AI pruning unavailable — showing top files by relevance ranking.");
        }
      }

      const keptFiles = ordered.filter(f => keptSet.has(f.path));
      setStepDetail(`Pruned to ${keptFiles.length} files`);
      if (abortRef.current) return;

      // ── Step 4: Sufficiency check ─────────────────────────────────────────
      setStep(4);
      setStepDetail("Verifying completeness...");

      // v6: include structural role annotations in kept summaries so the LLM can
      // see inheritance relationships and cite them in the sufficiency response.
      const keptSummaries = keptFiles.map(f => {
        const role = detectRole(f.path, f.content || "");
        const detail = f.summary.startsWith(f.path + ": ") ? f.summary.slice(f.path.length + 2) : f.summary;
        return `- ${f.path}${role ? " " + role : ""}: ${detail}`;
      }).join("\n");

      const availablePaths = parsed
        .filter(f => !keptSet.has(f.path) && (keywords.length === 0 || pathMatchScore(f.path, keywords) > 0))
        .map(f => f.path)
        .join("\n");

      const checkRes = await fetch("/api/llm", {
        method: "POST",
        headers: llmHeaders,
        body: JSON.stringify({
          messages: [{
            role: "user",
            content:
`Task: "${t}"

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
          max_tokens: 500,
        }),
      });

      if (!checkRes.ok) {
        // Sufficiency check failed — just use what we have
      } else {
        const checkData = await checkRes.json();
        const checkText = checkData.choices?.[0]?.message?.content || "";
        try {
          const match = checkText.match(/\{[\s\S]*\}/);
          const checkResult = JSON.parse(match ? match[0] : checkText);
          if (!checkResult.sufficient && Array.isArray(checkResult.missing)) {
            const availableSet = new Set(parsed.map(f => f.path));
            let added = 0;
            let registrationAdded = 0;
            for (const item of checkResult.missing) {
              if (added >= 3) break;
              const missingPath = typeof item === "string" ? item : item?.path;
              const citedBy = typeof item === "object" ? item?.cited_by : null;
              const itemType = typeof item === "object" ? item?.type : null;
              if (!missingPath || !availableSet.has(missingPath)) continue;
              if (itemType === "registration" || isRegistrationFile(missingPath)) {
                // Registration/entry files: add without citation, max 1
                if (registrationAdded >= 1) continue;
                keptSet.add(missingPath); added++; registrationAdded++;
              } else {
                // Base classes: require valid citation from a kept file
                if (!citedBy || !keptSet.has(citedBy)) continue;
                keptSet.add(missingPath); added++;
              }
            }
          }
        } catch { /* keep current set */ }
      }
      if (abortRef.current) return;

      // ── Build final results ───────────────────────────────────────────────
      const reasonMap = new Map(allPruneResults.map(r => [r.file, r.reason]));
      const finalResults = parsed
        .filter(f => keptSet.has(f.path))
        .map(f => ({
          path: f.path,
          content: f.content,
          summary: f.summary,
          reason: reasonMap.get(f.path) || (f.summary.startsWith(f.path + ": ") ? f.summary.slice(f.path.length + 2) : f.summary),
        }));

      saveCache(owner, repo, t, finalResults);
      storeServerCache(owner, repo, t, finalResults);
      setResults(finalResults);
      setSelected(new Set(finalResults.map(r => r.path)));
      setRanTask(t);
      setStatus("done");
    } catch (err) {
      setError(err.message || "Something went wrong");
      setStatus("error");
    }
  }

  function toggleSelected(path) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function copyLinks() {
    const links = results
      .filter(r => selected.has(r.path))
      .map(r => `https://github.com/${owner}/${repo}/blob/HEAD/${r.path}`)
      .join("\n") + "\n";
    navigator.clipboard.writeText(links).catch(() => {});
  }

  const selectedResults = results.filter(r => selected.has(r.path));
  const totalTokens = selectedResults.reduce((sum, r) => sum + Math.ceil((r.content || "").length / 4), 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0.75rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        background: "var(--bg-secondary)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <button
          onClick={() => router.push("/")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--accent)", fontSize: "0.85rem", fontFamily: "inherit", padding: 0,
            fontWeight: 700, letterSpacing: "-0.01em",
          }}
        >
          mincontext
        </button>
        <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>/</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>{owner}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>/</span>
        <span style={{ color: "var(--text-primary)", fontSize: "0.85rem", fontWeight: 600 }}>{repo}</span>
        <a
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "auto", textDecoration: "none" }}
        >
          ↗ github
        </a>
        <button
          onClick={() => setShowKeyInput(!showKeyInput)}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: "4px",
            color: groqKey ? "var(--success)" : "var(--text-muted)",
            fontSize: "0.75rem", padding: "0.2rem 0.5rem", cursor: "pointer", fontFamily: "inherit",
          }}
          title="Add your free Groq API key for unlimited usage"
        >
          {groqKey ? "● API key set" : "API key"}
        </button>
      </header>

      {showKeyInput && (
        <div style={{
          padding: "0.75rem 1.5rem",
          background: "var(--bg-tertiary)",
          borderBottom: "1px solid var(--border)",
          display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap",
        }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>Groq API key:</span>
          <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1, maxWidth: "380px" }}>
            <input
              type="password"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
              placeholder="gsk_..."
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
                borderRadius: "4px", color: "var(--text-primary)", padding: "0.35rem 2rem 0.35rem 0.6rem",
                fontSize: "0.8rem", fontFamily: "inherit", outline: "none",
              }}
            />
            {draftKey && (
              <button
                onClick={() => { navigator.clipboard.writeText(draftKey); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 1500); }}
                title="Copy key"
                style={{
                  position: "absolute", right: "0.4rem",
                  background: "none", border: "none", cursor: "pointer",
                  color: keyCopied ? "var(--success)" : "var(--text-muted)", padding: "0.1rem", display: "flex", alignItems: "center",
                  transition: "color 0.15s",
                }}
              >
                {keyCopied ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                )}
              </button>
            )}
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Free at{" "}
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>console.groq.com</a>
            {" "}— stored only in your browser, never sent to our servers.
          </span>
          {groqKey && (
            <button
              onClick={() => { setKeyAction("removed"); setGroqKeyState(""); setDraftKey(""); setTimeout(() => setShowKeyInput(false), 700); }}
              style={{
                background: "none", border: `1px solid ${keyAction === "removed" ? "var(--error, #ef4444)" : "var(--border)"}`,
                borderRadius: "4px", cursor: "pointer",
                color: keyAction === "removed" ? "var(--error, #ef4444)" : "var(--text-muted)",
                fontSize: "0.75rem", padding: "0.2rem 0.5rem", fontFamily: "inherit", whiteSpace: "nowrap",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >{keyAction === "removed" ? "Removed ✓" : "Remove key"}</button>
          )}
          <button
            onClick={() => { setKeyAction("saved"); setGroqKeyState(draftKey); setTimeout(() => setShowKeyInput(false), 700); }}
            style={{
              background: keyAction === "saved" ? "var(--success)" : "var(--accent)",
              border: "none", borderRadius: "4px", color: "#fff",
              fontSize: "0.75rem", padding: "0.2rem 0.6rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap",
              transition: "background 0.15s",
            }}
          >{keyAction === "saved" ? "Saved ✓" : "Save"}</button>
          <button onClick={() => setShowKeyInput(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", padding: "0 0.25rem" }}>×</button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, maxWidth: "860px", width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Contextual nav — below header */}
        {status !== "running" && (
          <div style={{ marginBottom: "1.25rem" }}>
            {status === "done" && results.length > 0 ? (
              <button
                onClick={() => { setStatus(null); setResults([]); setRanTask(""); setTimeout(() => taskInputRef.current?.focus(), 50); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: "0.82rem", fontFamily: "inherit", padding: 0 }}
              >
                ← new task
              </button>
            ) : (
              <button
                onClick={() => router.push("/")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: "0.82rem", fontFamily: "inherit", padding: 0 }}
              >
                ← new repo
              </button>
            )}
          </div>
        )}

        {/* Task input */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Task description
          </label>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <input
              ref={taskInputRef}
              type="text"
              value={task}
              onChange={e => setTask(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { if (task.trim()) runAnalysis(); else setShowKeyInput(true); } }}
              placeholder='e.g. "add OAuth login", "fix memory leak in event loop", "implement dark mode"'
              disabled={status === "running"}
              style={{
                flex: 1,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-active)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "0.9rem",
                padding: "0.75rem 1rem",
                fontFamily: "inherit",
                outline: "none",
                opacity: status === "running" ? 0.6 : 1,
              }}
            />
            <button
              onClick={() => task.trim() ? runAnalysis() : setShowKeyInput(true)}
              disabled={status === "running" || (!!groqKey && !task.trim())}
              style={{
                padding: "0.75rem 1.5rem",
                background: status === "running" ? "var(--bg-tertiary)" : !groqKey ? "var(--bg-secondary)" : "var(--accent)",
                color: status === "running" ? "var(--text-muted)" : !groqKey ? "var(--accent)" : "#fff",
                border: status === "running" ? "1px solid var(--border)" : !groqKey ? "1px solid var(--accent)" : "none",
                borderRadius: "6px",
                cursor: status === "running" || (!!groqKey && !task.trim()) ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontFamily: "inherit",
                fontWeight: 600,
                whiteSpace: "nowrap",
                transition: "background 0.15s",
              }}
            >
              {status === "running" ? "Running..." : !groqKey ? "Add API key →" : "Find Context"}
            </button>
          </div>
        </div>

        {/* Progress */}
        {status === "running" && (
          <ProgressIndicator step={step} steps={STEPS} detail={stepDetail} modelStatus={modelStatus} />
        )}

        {/* Large repo warning */}
        {largeRepoWarning && status === "running" && (
          <div style={{
            padding: "0.6rem 1rem", background: "rgba(234,179,8,0.08)",
            border: "1px solid rgba(234,179,8,0.3)", borderRadius: "6px",
            color: "rgb(234,179,8)", fontSize: "0.8rem", marginBottom: "1rem",
          }}>
            {largeRepoWarning}
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div style={{
            padding: "1rem", background: "#1a0a0a",
            border: "1px solid var(--error)", borderRadius: "6px",
            color: "var(--error)", fontSize: "0.85rem", marginBottom: "1.5rem",
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Results */}
        {status === "done" && results.length > 0 && (
          <>
            <Results
              results={results}
              selected={selected}
              toggle={toggleSelected}
              onCopy={copyLinks}
              totalTokens={totalTokens}
              totalInRepo={repoTotalFiles}
              owner={owner}
              repo={repo}
              task={ranTask}
            />
          </>
        )}

        {/* Idle state hint */}
        {!status && (
          <div style={{
            padding: "2rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textAlign: "center",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              Describe the task you&apos;re working on, then click <strong style={{ color: "var(--text-secondary)" }}>Find Context</strong>.
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
              Fetches the repo file tree, builds an import graph, then returns only the files you actually need.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressIndicator({ step, steps, detail, modelStatus }) {
  return (
    <div style={{
      padding: "1.25rem",
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      marginBottom: "1.5rem",
    }}>
      <div style={{ display: "flex", gap: "0", marginBottom: "1rem", position: "relative" }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: i === 0 ? "flex-start" : i === steps.length - 1 ? "flex-end" : "center" }}>
            <div style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              background: i < step ? "var(--success)" : i === step ? "var(--accent)" : "var(--border)",
              border: i === step ? "2px solid var(--accent)" : "2px solid transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.65rem",
              color: "#fff",
              fontWeight: 700,
              transition: "background 0.3s",
              position: "relative",
              zIndex: 1,
            }}>
              {i < step ? "✓" : i + 1}
            </div>
            <div style={{
              fontSize: "0.7rem",
              color: i <= step ? "var(--text-secondary)" : "var(--text-muted)",
              marginTop: "0.35rem",
              textAlign: i === 0 ? "left" : i === steps.length - 1 ? "right" : "center",
              maxWidth: "80px",
              lineHeight: 1.3,
            }}>
              {s}
            </div>
          </div>
        ))}
        {/* Connector line */}
        <div style={{
          position: "absolute",
          top: "9px",
          left: "10px",
          right: "10px",
          height: "2px",
          background: "var(--border)",
          zIndex: 0,
        }} />
      </div>

      {/* Spinner + detail */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.5rem" }}>
        <Spinner />
        <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
          {detail || steps[step]}
        </span>
      </div>
      {modelStatus && (
        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.3rem", marginLeft: "1.4rem" }}>
          {modelStatus}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: "14px",
      height: "14px",
      border: "2px solid var(--border-active)",
      borderTopColor: "var(--accent)",
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      flexShrink: 0,
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function Results({ results, selected, toggle, onCopy, totalTokens, totalInRepo, owner, repo, task }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    navigator.clipboard.writeText(url).catch(() => {});
    setShared(true);
    setTimeout(() => setShared(false), 1800);
  }

  return (
    <div>
      {/* Results header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "1rem",
        flexWrap: "wrap",
        gap: "0.5rem",
      }}>
        <div>
          <span style={{ color: "var(--text-primary)", fontSize: "0.9rem", fontWeight: 600 }}>
            {results.length} file{results.length !== 1 ? "s" : ""}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "0.6rem" }}>
            relevant to &quot;{task}&quot;
          </span>
          {totalInRepo > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "0.6rem" }}>
              · {Math.round((1 - results.length / totalInRepo) * 100)}% reduction
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            ~{totalTokens.toLocaleString()} tokens
          </span>
          <button
            onClick={handleCopy}
            style={{
              padding: "0.5rem 1.1rem",
              background: copied ? "var(--success)" : "var(--bg-tertiary)",
              border: `1px solid ${copied ? "var(--success)" : "var(--border-active)"}`,
              borderRadius: "5px",
              color: copied ? "#fff" : "var(--text-primary)",
              fontSize: "0.82rem",
              fontFamily: "inherit",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {copied ? "✓ Copied!" : `Copy links (${selected.size})`}
          </button>
          <button
            onClick={handleShare}
            style={{
              padding: "0.5rem 1.1rem",
              background: shared ? "var(--success)" : "var(--bg-tertiary)",
              border: `1px solid ${shared ? "var(--success)" : "var(--border-active)"}`,
              borderRadius: "5px",
              color: shared ? "#fff" : "var(--text-primary)",
              fontSize: "0.82rem",
              fontFamily: "inherit",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {shared ? "✓ Copied!" : "Share"}
          </button>
        </div>
      </div>

      {/* File list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {results.map((r, i) => (
          <FileRow
            key={r.path}
            rank={i + 1}
            file={r}
            isSelected={selected.has(r.path)}
            onToggle={() => toggle(r.path)}
            owner={owner}
            repo={repo}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({ rank, file, isSelected, onToggle, owner, repo }) {
  const [expanded, setExpanded] = useState(false);
  const tokens = Math.ceil((file.content || "").length / 4);

  const ext = file.path.split(".").pop().toLowerCase();
  const langColor = {
    js: "#f0db4f", jsx: "#61dafb", ts: "#3178c6", tsx: "#61dafb",
    py: "#3572a5", go: "#00add8", rs: "#f74c00", rb: "#cc342d",
    java: "#b07219", kt: "#a97bff", css: "#563d7c", html: "#e34c26",
    md: "#083fa1", json: "#292929", yml: "#cb171e", yaml: "#cb171e",
    sh: "#89e051", c: "#555555", cpp: "#f34b7d", cs: "#178600",
  }[ext] || "var(--text-muted)";

  return (
    <div style={{
      border: `1px solid ${isSelected ? "var(--border-active)" : "var(--border)"}`,
      borderRadius: "6px",
      background: isSelected ? "var(--bg-secondary)" : "var(--bg)",
      opacity: isSelected ? 1 : 0.45,
      transition: "all 0.15s",
    }}>
      <div
        style={{ padding: "0.75rem 1rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.75rem" }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Checkbox */}
        <div
          onClick={e => { e.stopPropagation(); onToggle(); }}
          style={{
            width: "16px",
            height: "16px",
            border: `2px solid ${isSelected ? "var(--accent)" : "var(--border-active)"}`,
            borderRadius: "3px",
            background: isSelected ? "var(--accent)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "pointer",
          }}
        >
          {isSelected && <span style={{ color: "#fff", fontSize: "0.65rem", lineHeight: 1 }}>✓</span>}
        </div>

        {/* Rank */}
        <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", width: "18px", textAlign: "right", flexShrink: 0 }}>
          #{rank}
        </span>

        {/* Lang dot */}
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: langColor, flexShrink: 0 }} />

        {/* Path */}
        <span style={{
          flex: 1,
          color: "var(--text-primary)",
          fontSize: "0.82rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}>
          {file.path}
        </span>

        {/* Token count */}
        <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", width: "64px", textAlign: "right", flexShrink: 0 }}>
          ~{tokens.toLocaleString()}t
        </span>

        {/* Expand arrow */}
        <span style={{ color: "var(--text-muted)", fontSize: "0.7rem", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}>
          ▾
        </span>
      </div>

      {/* Summary + preview */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 1rem" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.78rem", marginBottom: "0.6rem", lineHeight: 1.5 }}>
            <span style={{ color: "var(--text-muted)" }}>reason: </span>
            {file.reason || file.summary?.replace(file.path + ": ", "") || "—"}
          </div>
          {file.content && (
            <pre style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "0.6rem 0.75rem",
              overflow: "auto",
              maxHeight: "240px",
              margin: 0,
              lineHeight: 1.5,
              fontFamily: "inherit",
            }}>
              {file.content.slice(0, 2000)}{file.content.length > 2000 ? "\n\n... (truncated in preview)" : ""}
            </pre>
          )}
          <div style={{ marginTop: "0.5rem" }}>
            <a
              href={`https://github.com/${owner}/${repo}/blob/HEAD/${file.path}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", fontSize: "0.75rem", textDecoration: "none" }}
            >
              ↗ view on GitHub
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
