"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handle() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button
      onClick={handle}
      title="Copy"
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "var(--success)" : "var(--text-muted)",
        padding: "0.15rem 0.25rem", display: "flex", alignItems: "center",
        transition: "color 0.15s", flexShrink: 0,
      }}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function CodeBlock({ prefix, code }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.75rem",
      background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
      borderRadius: "6px", padding: "0.75rem 1rem",
    }}>
      {prefix && (
        <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", userSelect: "none", flexShrink: 0 }}>{prefix}</span>
      )}
      <code style={{ flex: 1, color: "var(--text-primary)", fontSize: "0.85rem", letterSpacing: "-0.01em" }}>
        {code}
      </code>
      <CopyButton text={code} />
    </div>
  );
}

function JsonBlock({ text }) {
  return (
    <div style={{
      position: "relative",
      background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
      borderRadius: "6px", padding: "0.75rem 1rem",
    }}>
      <pre style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.82rem", letterSpacing: "-0.01em", lineHeight: 1.6, overflowX: "auto" }}>
        {text}
      </pre>
      <div style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

const JSON_CONFIG = `{
  "mcpServers": {
    "mincontext": {
      "command": "npx",
      "args": ["mincontext-mcp"]
    }
  }
}`;

const CLIENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <CodeBlock prefix="$" code="claude mcp add mincontext --scope user -- npx mincontext-mcp" />
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Runs in your terminal alongside Claude Code. The <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>--scope user</code> flag makes it available across all your projects.
        </p>
      </div>
    ),
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Add to <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows):
        </p>
        <JsonBlock text={JSON_CONFIG} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Restart Claude Desktop after saving.
        </p>
      </div>
    ),
  },
  {
    id: "cursor",
    label: "Cursor",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Add to <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>~/.cursor/mcp.json</code> (global) or <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>.cursor/mcp.json</code> in your project:
        </p>
        <JsonBlock text={JSON_CONFIG} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Or go to <strong style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Cursor Settings → MCP</strong> and add a new server with command <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>npx mincontext-mcp</code>.
        </p>
      </div>
    ),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Add to <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>~/.codeium/windsurf/mcp_config.json</code>:
        </p>
        <JsonBlock text={JSON_CONFIG} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.5 }}>
          Or go to <strong style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Windsurf Settings → MCP Servers</strong> and add the server from there.
        </p>
      </div>
    ),
  },
];

const tools = [
  { name: "get_relevant_files", desc: "Find the minimum set of files needed for a task — works on local repos (auto-detects git root) and GitHub repos" },
  { name: "set_groq_key",       desc: "Save your Groq API key — stored in the macOS keychain or ~/.cache/mincontext/ on other platforms" },
  { name: "list_config",        desc: "Show current key status and saved per-repo LLM preferences" },
];

export default function McpPage() {
  const router = useRouter();
  const [activeClient, setActiveClient] = useState("claude-code");

  const active = CLIENTS.find((c) => c.id === activeClient);

  return (
    <main style={{
      flex: 1,
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "3rem 1.5rem 5rem",
    }}>
      <div style={{ width: "100%", maxWidth: "560px" }}>

        {/* Back */}
        <button
          onClick={() => router.push("/")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--accent)", fontSize: "0.8rem", fontFamily: "inherit",
            padding: 0, marginBottom: "2.5rem", display: "block",
          }}
        >
          ← mincontext
        </button>

        {/* Title */}
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{
            fontSize: "1.35rem", fontWeight: 700,
            color: "var(--text-primary)", margin: "0 0 0.5rem",
            letterSpacing: "-0.03em",
          }}>
            mincontext MCP server
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0, lineHeight: 1.6 }}>
            Use mincontext as a tool inside Claude Code, Claude Desktop, Cursor, Windsurf, or any MCP-compatible AI client — no copy-pasting required.
          </p>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        {/* Setup */}
        <div style={{ marginTop: "2rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Setup
          </div>

          {/* Client tabs */}
          <div style={{ display: "flex", gap: "0", marginBottom: "1.25rem", borderBottom: "1px solid var(--border)" }}>
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveClient(c.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: "0.8rem", padding: "0.5rem 1rem",
                  color: activeClient === c.id ? "var(--text-primary)" : "var(--text-muted)",
                  borderBottom: activeClient === c.id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: "-1px",
                  transition: "color 0.15s",
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {active && <active.content />}

          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", marginTop: "0.75rem", lineHeight: 1.5 }}>
            Requires Node.js 18+.
          </p>
        </div>

        {/* Tools */}
        <div style={{ marginTop: "2.5rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Tools
          </div>
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            overflow: "hidden",
          }}>
            {tools.map(({ name, desc }, i) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "1.25rem",
                  padding: "0.65rem 1rem",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <code style={{
                  color: "var(--accent)",
                  fontSize: "0.8rem",
                  letterSpacing: "-0.01em",
                  flexShrink: 0,
                  width: "148px",
                }}>
                  {name}
                </code>
                <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.5 }}>
                  {desc}
                </span>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
            On the first call to any repo, you&apos;ll be prompted once to choose an LLM — the choice is saved and reused automatically.
          </p>
        </div>

        {/* LLM backends */}
        <div style={{ marginTop: "2.5rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            LLM backends
          </div>
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            overflow: "hidden",
          }}>
            {[
              { name: "groq",   desc: "Free cloud API — get a key at console.groq.com, no credit card required" },
              { name: "ollama", desc: "Runs locally — auto-started and model auto-downloaded on first use, no account needed" },
            ].map(({ name, desc }, i) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "1.25rem",
                  padding: "0.65rem 1rem",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <code style={{
                  color: "var(--accent)",
                  fontSize: "0.82rem",
                  letterSpacing: "-0.01em",
                  flexShrink: 0,
                  width: "56px",
                }}>
                  {name}
                </code>
                <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.5 }}>
                  {desc}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cache note */}
        <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", margin: 0, lineHeight: 1.6 }}>
            Results are cached for 24 hours and persist across server restarts and AI client sessions.
          </p>
        </div>

      </div>
    </main>
  );
}
