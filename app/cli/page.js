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

export default function CliPage() {
  const router = useRouter();

  const commands = [
    { cmd: "/repo",   desc: "Set the GitHub repo to analyze" },
    { cmd: "/local",  desc: "Analyze the current directory — auto-detects git root" },
    { cmd: "/dir",    desc: "Set a specific local path to analyze" },
    { cmd: "/groq",   desc: "Switch to Groq — free cloud LLM, get a key at console.groq.com" },
    { cmd: "/ollama", desc: "Switch to Ollama — runs locally, model is downloaded automatically" },
    { cmd: "/key",    desc: "Update your Groq API key" },
    { cmd: "/copy",   desc: "Copy the file paths from the last result to clipboard" },
    { cmd: "/clear",  desc: "Clear the screen" },
    { cmd: "/quit",   desc: "Exit" },
  ];

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
            mincontext CLI
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0, lineHeight: 1.6 }}>
            The same AI pipeline as the web app, running in your terminal.
            Analyze GitHub repos or local codebases — no browser needed.
          </p>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        {/* Install */}
        <div style={{ marginTop: "2rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Install
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
            borderRadius: "6px", padding: "0.75rem 1rem",
          }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", userSelect: "none", flexShrink: 0 }}>$</span>
            <code style={{ flex: 1, color: "var(--text-primary)", fontSize: "0.85rem", letterSpacing: "-0.01em" }}>
              npm install -g mincontext
            </code>
            <CopyButton text="npm install -g mincontext" />
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
            Requires Node.js 18+.
          </p>
        </div>

        {/* Usage */}
        <div style={{ marginTop: "2.5rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Usage
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "var(--bg-secondary)", border: "1px solid var(--border-active)",
            borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "0.5rem",
          }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", userSelect: "none", flexShrink: 0 }}>$</span>
            <code style={{ flex: 1, color: "var(--text-primary)", fontSize: "0.85rem", letterSpacing: "-0.01em" }}>
              mincontext
            </code>
            <CopyButton text="mincontext" />
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", lineHeight: 1.5 }}>
            Opens an interactive session. On first run you&apos;ll be guided through a quick setup — choose an LLM and a source repo or local directory. Then just describe your task.
          </p>
        </div>

        {/* Commands */}
        <div style={{ marginTop: "2.5rem" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Commands
          </div>
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            overflow: "hidden",
          }}>
            {commands.map(({ cmd, desc }, i) => (
              <div
                key={cmd}
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
                  width: "72px",
                }}>
                  {cmd}
                </code>
                <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.5 }}>
                  {desc}
                </span>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.73rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
            Type <code style={{ color: "var(--accent)", fontSize: "0.73rem" }}>/</code> at any prompt to open the command menu with live filtering and arrow-key navigation.
          </p>
        </div>

      </div>
    </main>
  );
}
