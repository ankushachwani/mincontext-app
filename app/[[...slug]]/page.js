"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchFileTree, fetchMultipleFiles } from "../lib/github";
import { parseFile } from "../lib/parse";
import { extractKeywords } from "../lib/keywords";
// embed is dynamically imported inside runAnalysis so webpack never
// traces @xenova/transformers into the server bundle.

const STEPS = ["Fetching tree", "Fetching files", "Analyzing", "Pruning with AI", "Verifying"];

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
    { label: "vercel/next.js", path: "/vercel/next.js" },
    { label: "expressjs/express", path: "/expressjs/express" },
    { label: "koajs/koa", path: "/koajs/koa" },
    { label: "gin-gonic/gin", path: "/gin-gonic/gin" },
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
            <input
              type="password"
              value={groqKey}
              onChange={e => { setGroqKey(e.target.value); if (e.target.value) setNotifDismissed("1"); }}
              placeholder="gsk_..."
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--bg)", border: "1px solid var(--border-active)",
                borderRadius: "5px", color: "var(--text-primary)", padding: "0.45rem 0.6rem",
                fontSize: "0.82rem", fontFamily: "inherit", outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.6rem" }}>
              <button
                onClick={() => setShowKeyInput(false)}
                style={{ background: "var(--accent)", border: "none", borderRadius: "4px", color: "#fff", fontSize: "0.78rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Key notification — modal overlay, shows every visit when no key set */}
      {showKeyNotif && (
        <div
          onClick={() => setShowKeyNotif(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 50, padding: "1rem",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-active)",
              borderRadius: "10px",
              padding: "1.5rem",
              maxWidth: "380px", width: "100%",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <span style={{ color: "var(--text-primary)", fontSize: "0.95rem", fontWeight: 700 }}>
                Get better results
              </span>
              <button
                onClick={() => setShowKeyNotif(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.1rem", lineHeight: 1, padding: 0, marginLeft: "1rem" }}
              >
                ×
              </button>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem", lineHeight: 1.6, margin: "0 0 1.1rem" }}>
              Add your free Groq API key to unlock higher-accuracy results using a smarter model. Takes 2 minutes — no credit card needed.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => { setShowKeyNotif(false); setShowKeyInput(true); }}
                style={{
                  flex: 1,
                  background: "var(--accent)", border: "none", borderRadius: "6px",
                  color: "#fff", fontSize: "0.82rem", padding: "0.55rem 1rem",
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                }}
              >
                Add key →
              </button>
              <button
                onClick={() => setShowKeyNotif(false)}
                style={{
                  background: "none", border: "1px solid var(--border)", borderRadius: "6px",
                  color: "var(--text-muted)", fontSize: "0.82rem", padding: "0.55rem 1rem",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Maybe later
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
            Find the exact files you need for any task in any public GitHub repo. AI reads the actual code — not just keywords. Paste the links into Claude, ChatGPT, or Cursor.
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
            <button key={ex.label} onClick={() => router.push(ex.path)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-secondary)", fontSize: "0.78rem", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
              {ex.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {[
            { label: "Reads actual code", desc: "AI analyzes file contents and imports — not just filename keywords." },
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
  const [groqKey, setGroqKeyState] = useLocalStorage("groq_key", "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const abortRef = useRef(false);

  if (isHomePage) return <HomePage />;

  async function runAnalysis() {
    if (!task.trim()) return;
    abortRef.current = false;
    setStatus("running");
    setStep(0);
    setStepDetail("");
    setResults([]);
    setError("");

    const keywords = extractKeywords(task);

    try {
      // ── Step 0: Fetch file tree (IDF pre-filter) ─────────────────────────
      setStep(0);
      setStepDetail(`GET /repos/${owner}/${repo}/git/trees/HEAD`);
      const { files: treeFiles, meta } = await fetchFileTree(owner, repo, null, keywords);
      if (abortRef.current) return;

      // ── Step 1: Fetch all file contents ──────────────────────────────────
      setStep(1);
      const fetchedContent = new Map();
      const allPaths = treeFiles.map(f => f.path);
      const contentMap = await fetchMultipleFiles(owner, repo, allPaths,
        (done, total) => setStepDetail(`${done}/${total} files fetched`)
      );
      for (const [k, v] of contentMap) fetchedContent.set(k, v);
      if (abortRef.current) return;

      // ── Step 2: Parse + graph-order candidates ────────────────────────────
      setStep(2);
      setStepDetail("Parsing files and building import graph...");

      const parsed = allPaths
        .filter(p => fetchedContent.get(p) != null)
        .map(path => {
          const content = fetchedContent.get(path) || "";
          return { path, content, ...parseFile(path, content) };
        });

      const { orderByGraph } = await import("../lib/graph");
      const ordered = orderByGraph(parsed, keywords);

      setStepDetail(
        `${meta.totalInRepo.toLocaleString()} total → ${meta.totalFiltered.toLocaleString()} filtered → ${ordered.length} candidates`
      );
      await new Promise(r => setTimeout(r, 60));
      if (abortRef.current) return;

      // ── Step 3: LLM binary pruning ────────────────────────────────────────
      setStep(3);

      // Groq TPM = input_tokens + max_tokens_requested.
      // With max_tokens=2500 and ~1,600 input tokens budget:
      //   35 files × ~65 output tokens = 2,275 → fits in 2500
      //   35 files × ~45 input tokens = 1,575 + 400 prompt = 1,975 input
      //   Total: 1,975 + 2,500 = 4,475 << 6,000 TPM limit ✓
      const MAX_LLM_FILES = 35;
      const MAX_FILE_CHARS = 13000;
      let fileDescriptions = "";
      let includedForLLM = [];
      for (const f of ordered) {
        if (includedForLLM.length >= MAX_LLM_FILES) break;
        const detail = f.summary.startsWith(f.path + ": ")
          ? f.summary.slice(f.path.length + 2)
          : (f.summary || f.path);
        const entry = `FILE: ${f.path}\n${detail}`;
        if (fileDescriptions.length + entry.length + 2 > MAX_FILE_CHARS) break;
        fileDescriptions += (fileDescriptions ? "\n\n" : "") + entry;
        includedForLLM.push(f);
      }

      setStepDetail(`Asking AI to evaluate ${includedForLLM.length} candidates...`);

      const llmHeaders = { "Content-Type": "application/json", ...(groqKey ? { "x-groq-key": groqKey } : {}) };

      const pruneRes = await fetch("/api/llm", {
        method: "POST",
        headers: llmHeaders,
        body: JSON.stringify({
          messages: [{
            role: "user",
            content:
`You are a senior engineer identifying the MINIMUM file set needed to complete a programming task.

Task: "${task}"

${includedForLLM.length} candidate files are listed below. For each file:
Can it be REMOVED without preventing the task from being completed?

REMOVE (removable: true) if the file:
- Handles a clearly different feature area (logging, view rendering, CLI, session management, path routing) when those are not what the task is about
- Is general infrastructure the task doesn't directly touch (error types, utility helpers, internal data structures like routing trees)
- Is metadata (package.json, tsconfig) not specific to this task
- Is "good to know" about the framework but not needed to implement this specific feature
- The developer could complete the task without ever opening this file

KEEP (removable: false) ONLY if the file:
- Defines types or interfaces the task directly creates or consumes
- Contains logic that MUST be read or modified to complete the task
- Is the exact registration/wiring point (e.g. where middleware is applied, where hooks are exported)
- Is a direct import of another kept file AND provides something the task specifically needs

The developer is already familiar with the language and framework. They don't need general reference files. They need ONLY the files that implement, register, or type-check this exact feature.

Be aggressive — 4 perfect files beats 12 with noise. When in doubt, remove it.

Return ONLY a JSON array — no markdown, no explanation:
[{"file":"path","removable":false,"reason":"one sentence"},...]

Include ALL ${includedForLLM.length} files.

FILES:
${fileDescriptions}`,
          }],
          max_tokens: 2500,
        }),
      });

      if (!pruneRes.ok) {
        const errBody = await pruneRes.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `LLM API error ${pruneRes.status}`);
      }
      const pruneData = await pruneRes.json();
      if (abortRef.current) return;

      const pruneText = pruneData.choices?.[0]?.message?.content || "";
      let pruneResults = [];
      try {
        const match = pruneText.match(/\[[\s\S]*\]/);
        pruneResults = JSON.parse(match ? match[0] : pruneText);
      } catch {
        // JSON parse failed — keep everything and continue
        pruneResults = includedForLLM.map(f => ({ file: f.path, removable: false, reason: "" }));
      }

      const keptSet = new Set(pruneResults.filter(r => !r.removable).map(r => r.file));
      // Safety: if LLM removed too many, keep all
      if (keptSet.size < 3) includedForLLM.forEach(f => keptSet.add(f.path));

      const keptFiles = ordered.filter(f => keptSet.has(f.path));
      setStepDetail(`Pruned to ${keptFiles.length} files`);
      if (abortRef.current) return;

      // ── Step 4: Sufficiency check ─────────────────────────────────────────
      setStep(4);
      setStepDetail("Verifying completeness...");

      const keptSummaries = keptFiles.map(f => `- ${f.summary}`).join("\n");
      const allAvailablePaths = parsed.map(f => f.path).join("\n");

      const checkRes = await fetch("/api/llm", {
        method: "POST",
        headers: llmHeaders,
        body: JSON.stringify({
          messages: [{
            role: "user",
            content:
`Task: "${task}"

These ${keptFiles.length} files remain after pruning:
${keptSummaries}

Can this task be completed with ONLY these files?
Specifically check for:
- Missing type definitions or interfaces the task depends on
- Missing request/response object definitions if the task involves HTTP middleware or request handling
- Missing core infrastructure files (e.g. router, dispatcher, middleware chain) needed to understand where the feature hooks in
- Missing registration or wiring files (where the feature gets registered in the framework)
- Missing configuration schemas or option types

Be conservative: if a file defines request/response properties or how the system processes requests/events relevant to this task, include it even if not directly modified.

If anything critical is missing, list the exact file paths from the available set below.

Return ONLY valid JSON — no other text:
{"sufficient":true,"missing":[],"reason":"brief"}
OR
{"sufficient":false,"missing":["exact/path/here"],"reason":"what is missing"}

Available paths to add back if needed:
${allAvailablePaths}`,
          }],
          max_tokens: 512,
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
            for (const missingPath of checkResult.missing) {
              const found = parsed.find(f => f.path === missingPath);
              if (found) keptSet.add(found.path);
            }
          }
        } catch { /* keep current set */ }
      }
      if (abortRef.current) return;

      // ── Build final results ───────────────────────────────────────────────
      const reasonMap = new Map(pruneResults.map(r => [r.file, r.reason]));
      const finalResults = parsed
        .filter(f => keptSet.has(f.path))
        .map(f => ({
          path: f.path,
          content: f.content,
          summary: f.summary,
          reason: reasonMap.get(f.path) || f.summary,
        }));

      setResults(finalResults);
      setSelected(new Set(finalResults.map(r => r.path)));
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
      .join("\n");
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
          {groqKey ? "● key set" : "API key"}
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
          <input
            type="password"
            value={groqKey}
            onChange={e => setGroqKeyState(e.target.value)}
            placeholder="gsk_..."
            style={{
              flex: 1, maxWidth: "380px",
              background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
              borderRadius: "4px", color: "var(--text-primary)", padding: "0.35rem 0.6rem",
              fontSize: "0.8rem", fontFamily: "inherit", outline: "none",
            }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Free at{" "}
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>console.groq.com</a>
            {" "}— stored only in your browser, never sent to our servers.
          </span>
          <button onClick={() => setShowKeyInput(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", padding: "0 0.25rem" }}>×</button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, maxWidth: "860px", width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Task input */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Task description
          </label>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <input
              type="text"
              value={task}
              onChange={e => setTask(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) runAnalysis(); }}
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
              onClick={runAnalysis}
              disabled={status === "running" || !task.trim()}
              style={{
                padding: "0.75rem 1.5rem",
                background: status === "running" ? "var(--bg-tertiary)" : "var(--accent)",
                color: status === "running" ? "var(--text-muted)" : "#fff",
                border: status === "running" ? "1px solid var(--border)" : "none",
                borderRadius: "6px",
                cursor: status === "running" || !task.trim() ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontFamily: "inherit",
                fontWeight: 600,
                whiteSpace: "nowrap",
                transition: "background 0.15s",
              }}
            >
              {status === "running" ? "Running..." : "Find Context"}
            </button>
          </div>
        </div>

        {/* Progress */}
        {status === "running" && (
          <ProgressIndicator step={step} steps={STEPS} detail={stepDetail} modelStatus={modelStatus} />
        )}

        {/* Error */}
        {status === "error" && error && (
          <div style={{
            padding: "1rem",
            background: "#1a0a0a",
            border: "1px solid var(--error)",
            borderRadius: "6px",
            color: "var(--error)",
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
          }}>
            <strong>Error:</strong> {error}
            {error.includes("rate limit") || error.includes("403") ? (
              <span style={{ color: "var(--text-secondary)", display: "block", marginTop: "0.4rem" }}>
                Try adding a GitHub Personal Access Token via the PAT button in the header.
              </span>
            ) : null}
          </div>
        )}

        {/* Results */}
        {status === "done" && results.length > 0 && (
          <Results
            results={results}
            selected={selected}
            toggle={toggleSelected}
            onCopy={copyLinks}
            totalTokens={totalTokens}
            owner={owner}
            repo={repo}
            task={task}
          />
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
              The app fetches the repo file tree, builds an import graph, then uses AI to return only the files you actually need.
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

function Results({ results, selected, toggle, onCopy, totalTokens, owner, repo, task }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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
            {copied ? "✓ Copied!" : `Copy Links (${selected.size})`}
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
