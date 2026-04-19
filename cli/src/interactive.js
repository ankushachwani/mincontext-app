import { createInterface, emitKeypressEvents } from "readline";
import { execSync } from "child_process";
import { platform, homedir } from "os";
import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import { loadConfig, saveConfig } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { ensureOllama, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_URL } from "./llm.js";

const VERSION = "1.0.0";
const STEP_NAMES = ["Fetching tree", "Fetching files", "Analyzing", "Narrowing down", "Verifying"];
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Most-recent completed analysis — persists across prompts in this session
let lastResult = null; // { files, task, config snapshot }

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortPath(p) {
  if (!p) return "";
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function termWidth() {
  return process.stdout.columns || 80;
}

function hr() {
  const w = Math.min(termWidth() - 2, 78);
  console.log(chalk.dim("  " + "─".repeat(w)));
}

// ── label ──────────────── (task name embedded in separator)
function hrLabel(label) {
  const w = Math.min(termWidth() - 2, 78);
  const max = w - 6;
  const l = label.length > max ? label.slice(0, max - 1) + "…" : label;
  const right = Math.max(w - l.length - 4, 2);
  process.stdout.write(chalk.dim("  ── ") + chalk.dim(l) + chalk.dim(" " + "─".repeat(right)) + "\n");
}

function parseGithubRepo(input) {
  const urlMatch = input.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/);
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`;
  const slashMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) return `${slashMatch[1]}/${slashMatch[2]}`;
  return null;
}

function copyToClipboard(text) {
  try {
    if (platform() === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    if (platform() === "win32") {
      execSync("clip", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    try {
      execSync("xclip -selection clipboard", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch {
      execSync("xsel --clipboard --input", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
  } catch {
    return false;
  }
}

function detectGitRoot(startDir) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

// Copy file paths (local) or GitHub links (remote) — no reasons
function copyResult(result) {
  if (!result) {
    console.log(chalk.dim("  No previous result to copy.\n"));
    return;
  }
  const { files, config } = result;
  const isLocal    = config.source === "local";
  const githubBase = !isLocal && config.githubRepo
    ? `https://github.com/${config.githubRepo}/blob/HEAD/`
    : null;
  const text = files.map((f) => (githubBase ? githubBase + f.path : f.path)).join("\n") + "\n";
  if (copyToClipboard(text)) {
    console.log(chalk.green("  ✓ Copied to clipboard\n"));
  } else {
    console.log(chalk.dim("  (clipboard not available)\n"));
    process.stdout.write(text + "\n");
  }
}

// ── Banner ────────────────────────────────────────────────────────────────────

function showBanner(config) {
  const llmLine = !config.llm
    ? chalk.dim("not configured")
    : config.llm === "groq"
    ? chalk.dim("Groq · llama-3.3-70b-versatile")
    : chalk.dim(`Ollama · ${config.ollamaModel || OLLAMA_DEFAULT_MODEL}`);

  const sourceLine =
    config.source === "github" && config.githubRepo
      ? chalk.dim(`github.com/${config.githubRepo}`)
      : config.source === "local" && config.localDir
      ? chalk.dim(shortPath(config.localDir))
      : chalk.dim("no source  —  type /repo or /local");

  console.log();
  console.log(chalk.cyan("▛████▜") + "  " + chalk.bold("mincontext") + "  " + chalk.dim(`v${VERSION}`));
  console.log(chalk.cyan("▝█████") + "  " + llmLine);
  console.log(chalk.cyan("  ▀▀  ") + "  " + sourceLine);
  console.log();
}

// ── Local directory permission ────────────────────────────────────────────────
// Called at the moment a local directory is SELECTED — never again for that dir.
// Persists approvals in config.approvedDirs so they survive restarts.

async function requestLocalAccess(dir, config) {
  const approved = Array.isArray(config.approvedDirs) ? config.approvedDirs : [];
  if (approved.includes(dir)) return true;

  process.stdout.write(
    "\n  " + chalk.yellow("⚠") + "  Allow mincontext to read files in " +
    chalk.bold(shortPath(dir)) + "?\n" +
    "  " + chalk.dim("[y] yes   [n] no") + "\n\n  "
  );

  const answer = await waitForKey(["y", "n"]);
  process.stdout.write("\n");

  if (answer === "y") {
    config.approvedDirs = [...approved, dir];
    saveConfig(config);
    console.log(chalk.green("  ✓ Access granted\n"));
    return true;
  }
  console.log(chalk.dim("  Access denied. Directory not changed.\n"));
  return false;
}

// ── Animated progress display ─────────────────────────────────────────────────

class ProgressDisplay {
  constructor() {
    this.states  = new Array(STEP_NAMES.length).fill("pending");
    this.details = new Array(STEP_NAMES.length).fill("");
    this.frameIdx = 0;
    this.rendered = false;
    this.timer    = null;
  }

  _line(i) {
    const s    = this.states[i];
    const icon = s === "done"   ? chalk.green("✓")
               : s === "active" ? chalk.cyan(SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length])
               :                  chalk.dim("○");
    const name = s === "active" ? chalk.bold(STEP_NAMES[i]) : chalk.dim(STEP_NAMES[i]);
    const det  = this.details[i] ? chalk.dim("  " + this.details[i]) : "";
    return `  ${icon}  ${name}${det}`;
  }

  _draw() {
    if (!this.rendered) {
      for (let i = 0; i < STEP_NAMES.length; i++) process.stdout.write(this._line(i) + "\n");
      this.rendered = true;
    } else {
      process.stdout.write(`\x1b[${STEP_NAMES.length}A`);
      for (let i = 0; i < STEP_NAMES.length; i++) process.stdout.write("\r\x1b[2K" + this._line(i) + "\n");
    }
  }

  start() {
    this.rendered = false;
    this._draw();
    this.timer = setInterval(() => { this.frameIdx++; this._draw(); }, 80);
  }

  update(step, detail) {
    for (let i = 0; i < step; i++) this.states[i] = "done";
    this.states[step]  = "active";
    this.details[step] = detail || "";
  }

  done(summary) {
    clearInterval(this.timer); this.timer = null;
    for (let i = 0; i < STEP_NAMES.length; i++) this.states[i] = "done";
    this._draw();
    console.log();
    if (summary) console.log("  " + chalk.green("✓") + "  " + chalk.bold(summary));
    console.log();
  }

  cancel() {
    clearInterval(this.timer); this.timer = null;
    // Mark active step as pending again to show it was interrupted
    for (let i = 0; i < STEP_NAMES.length; i++) {
      if (this.states[i] === "active") this.states[i] = "pending";
    }
    this._draw();
    console.log();
    console.log("  " + chalk.dim("Cancelled"));
    console.log();
  }

  fail(msg) {
    clearInterval(this.timer); this.timer = null;
    this._draw();
    console.log();
    if (msg) console.log("  " + chalk.red("✗") + "  " + chalk.red(msg));
    console.log();
  }
}

// ── Command definitions ───────────────────────────────────────────────────────

const COMMANDS = [
  { name: "copy",   label: "/copy",   desc: "Copy last result" },
  { name: "repo",   label: "/repo",   desc: "Change GitHub repo" },
  { name: "local",  label: "/local",  desc: "Analyze current directory" },
  { name: "dir",    label: "/dir",    desc: "Set a different local path" },
  { name: "groq",   label: "/groq",   desc: "Switch to Groq cloud LLM" },
  { name: "ollama", label: "/ollama", desc: "Switch to local Ollama" },
  { name: "key",    label: "/key",    desc: "Update Groq API key" },
  { name: "clear",  label: "/clear",  desc: "Clear screen" },
  { name: "quit",   label: "/quit",   desc: "Exit" },
];

// ── Raw input with live slash dropdown ────────────────────────────────────────

function readInput(promptStr) {
  return new Promise((resolve_) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.once("line", (line) => { rl.close(); resolve_(line.trim()); });
      return;
    }

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let buffer       = "";
    let slashMode    = false;
    let slashFilter  = "";
    let selectedIdx  = 0;
    let dropdownLines = 0;

    function renderPrompt() {
      process.stdout.write("\r\x1b[2K" + promptStr + (slashMode ? "/" + slashFilter : buffer));
    }

    function filteredCmds() {
      if (!slashFilter) return COMMANDS;
      const f = slashFilter.toLowerCase();
      return COMMANDS.filter((c) => c.name.startsWith(f));
    }

    function clearDropdown() {
      if (dropdownLines > 0) {
        for (let i = 0; i < dropdownLines; i++) process.stdout.write("\n\r\x1b[2K");
        process.stdout.write(`\x1b[${dropdownLines}A`);
        dropdownLines = 0;
      }
    }

    function renderDropdown() {
      clearDropdown();
      const cmds = filteredCmds();
      if (cmds.length === 0) return;
      if (selectedIdx >= cmds.length) selectedIdx = cmds.length - 1;
      if (selectedIdx < 0) selectedIdx = 0;
      let n = 0;
      for (let i = 0; i < cmds.length; i++) {
        const sel    = i === selectedIdx;
        const prefix = sel ? chalk.cyan(" › ") : "   ";
        const label  = sel ? chalk.cyan.bold(cmds[i].label) : chalk.cyan(cmds[i].label);
        process.stdout.write("\n\r\x1b[2K" + prefix + label.padEnd(10) + "  " + chalk.dim(cmds[i].desc));
        n++;
      }
      process.stdout.write(`\x1b[${n}A`);
      dropdownLines = n;
    }

    function cleanup() {
      clearDropdown();
      process.stdin.setRawMode(false);
      process.stdin.removeListener("keypress", onKey);
    }

    function deleteLastWord(str) {
      const s = str.replace(/\s+$/, "");
      const i = s.lastIndexOf(" ");
      return i === -1 ? "" : s.slice(0, i + 1);
    }

    renderPrompt();

    const onKey = (ch, key) => {
      if (!key) return;

      if (key.ctrl && key.name === "c") { cleanup(); process.stdout.write("\n"); process.exit(0); }

      // ── Slash mode ────────────────────────────────────────────────────────

      if (slashMode) {
        const cmds  = filteredCmds();
        const count = Math.max(cmds.length, 1);

        if (key.name === "up")   { selectedIdx = (selectedIdx - 1 + count) % count; renderPrompt(); renderDropdown(); return; }
        if (key.name === "down") { selectedIdx = (selectedIdx + 1) % count; renderPrompt(); renderDropdown(); return; }

        if (key.name === "return" || key.name === "tab") {
          const sel = cmds[selectedIdx];
          cleanup(); process.stdout.write("\n");
          resolve_(sel ? "/" + sel.name : slashFilter ? "/" + slashFilter : "/");
          return;
        }

        if (key.name === "escape") {
          clearDropdown(); slashMode = false; slashFilter = ""; selectedIdx = 0;
          renderPrompt(); return;
        }

        if (key.name === "backspace") {
          if (slashFilter.length > 0) { slashFilter = slashFilter.slice(0, -1); selectedIdx = 0; renderPrompt(); renderDropdown(); }
          else { clearDropdown(); slashMode = false; slashFilter = ""; selectedIdx = 0; renderPrompt(); }
          return;
        }

        if (key.ctrl && (key.name === "w" || key.name === "u")) {
          clearDropdown(); slashMode = false; slashFilter = ""; buffer = ""; selectedIdx = 0;
          renderPrompt(); return;
        }

        if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
          slashFilter += ch; selectedIdx = 0; renderPrompt(); renderDropdown();
        }
        return;
      }

      // ── Normal mode ───────────────────────────────────────────────────────

      if (key.name === "return") { cleanup(); process.stdout.write("\n"); resolve_(buffer.trim()); return; }

      if (key.name === "escape") {
        // Clear current input
        buffer = ""; renderPrompt(); return;
      }

      if (key.name === "backspace") {
        if (key.meta) { buffer = deleteLastWord(buffer); renderPrompt(); return; }
        if (buffer.length > 0) { buffer = buffer.slice(0, -1); renderPrompt(); }
        return;
      }

      if (key.ctrl && key.name === "w") { buffer = deleteLastWord(buffer); renderPrompt(); return; }
      if (key.ctrl && key.name === "u") { buffer = ""; renderPrompt(); return; }

      if (ch === "/" && buffer.length === 0) {
        slashMode = true; slashFilter = ""; selectedIdx = 0;
        renderPrompt(); renderDropdown(); return;
      }

      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { buffer += ch; renderPrompt(); }
    };

    process.stdin.on("keypress", onKey);
  });
}

// ── Single-keypress wait ──────────────────────────────────────────────────────

function waitForKey(allowed) {
  return new Promise((resolve_) => {
    if (!process.stdin.isTTY) { resolve_(null); return; }

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKey = (ch, key) => {
      if (key?.ctrl && key?.name === "c") { process.stdout.write("\n"); process.exit(0); }
      // Escape always maps to "return" (go back / cancel)
      if (key?.name === "escape") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", onKey);
        resolve_("return");
        return;
      }
      const k   = (ch || "").toLowerCase() || key?.name;
      const hit = allowed.includes(k) || (key?.name === "return" && allowed.includes("return"));
      if (hit) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", onKey);
        resolve_(key?.name === "return" ? "return" : k);
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

// ── Escape listener for pipeline cancellation ─────────────────────────────────

function listenForEscape() {
  if (!process.stdin.isTTY) return { promise: new Promise(() => {}), cleanup: () => {} };

  let resolve_;
  const promise = new Promise((r) => { resolve_ = r; });

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const onKey = (ch, key) => {
    if (key?.ctrl && key?.name === "c") { process.stdout.write("\n"); process.exit(0); }
    if (key?.name === "escape") resolve_(true);
  };

  process.stdin.on("keypress", onKey);

  const cleanup = () => {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.removeListener("keypress", onKey);
  };

  return { promise, cleanup };
}

// ── Enquirer helpers ──────────────────────────────────────────────────────────

async function inputPrompt(message, initial = "", hint = "") {
  const { default: enquirer } = await import("enquirer");
  const inp = new enquirer.Input({ name: "v", message, initial, hint });
  try { return (await inp.run()).trim(); } catch { return null; }
}

async function passwordPrompt(message) {
  const { default: enquirer } = await import("enquirer");
  const pw = new enquirer.Password({ name: "v", message });
  try { return (await pw.run()).trim(); } catch { return null; }
}

async function selectEnquirer(message, choices) {
  const { default: enquirer } = await import("enquirer");
  const sel = new enquirer.Select({ name: "v", message, choices });
  try { return await sel.run(); } catch { return null; }
}

// ── First-time setup wizard ───────────────────────────────────────────────────

async function runSetupWizard(config) {
  console.log(chalk.bold("  Quick setup") + chalk.dim("  (takes ~30 seconds)\n"));

  const llm = await selectEnquirer("LLM backend", [
    { message: "  Groq   — cloud, free, fast  (console.groq.com)", name: "groq" },
    { message: "  Ollama — local, private, runs on your machine",   name: "ollama" },
  ]);
  if (!llm) process.exit(0);
  config.llm = llm;

  if (llm === "groq") {
    const key = await passwordPrompt("Groq API key  (get one free at console.groq.com)");
    if (!key) process.exit(0);
    config.groqKey = key;
  } else {
    const model = await inputPrompt("Ollama model", OLLAMA_DEFAULT_MODEL, "run `ollama pull llama3.3` first");
    config.ollamaModel = model || OLLAMA_DEFAULT_MODEL;
  }

  const source = await selectEnquirer("Where to analyze", [
    { message: `  This directory  (${shortPath(process.cwd())})`, name: "local" },
    { message: "  A GitHub repo",                                  name: "github" },
  ]);
  if (!source) process.exit(0);
  config.source = source;

  if (source === "github") {
    const repo   = await inputPrompt("GitHub repo", "", "owner/repo or full URL");
    const parsed = parseGithubRepo(repo || "");
    if (!parsed) { console.log(chalk.red("  Invalid repo format.\n")); process.exit(1); }
    config.githubRepo = parsed;
  } else {
    const dir = detectGitRoot(process.cwd()) || process.cwd();
    // Ask permission right now
    const granted = await requestLocalAccess(dir, config);
    if (!granted) {
      // Fall back to github source or exit
      console.log(chalk.yellow("  Switching to GitHub mode. Use /repo to set a repo, or /local to try again.\n"));
      config.source = null;
    } else {
      config.localDir = dir;
    }
  }

  saveConfig(config);
  console.log(chalk.green("  ✓ Setup complete!\n"));
  return config;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleCommand(cmd, config) {
  switch (cmd) {

    case "copy": {
      copyResult(lastResult);
      break;
    }

    case "repo": {
      const input = await inputPrompt("GitHub repo", config.githubRepo || "", "owner/repo or URL");
      if (!input) break;
      const parsed = parseGithubRepo(input);
      if (!parsed) { console.log(chalk.red("\n  Invalid repo format.\n")); break; }
      config.githubRepo = parsed;
      config.source     = "github";
      saveConfig(config);
      console.log(chalk.green(`\n  ✓ Repo set to github.com/${parsed}\n`));
      break;
    }

    case "local": {
      const gitRoot = detectGitRoot(process.cwd());
      const dir     = gitRoot || process.cwd();
      const granted = await requestLocalAccess(dir, config);
      if (!granted) break;
      config.source   = "local";
      config.localDir = dir;
      saveConfig(config);
      console.log(chalk.green(`  ✓ Source set to ${shortPath(dir)}`));
      if (gitRoot && gitRoot !== process.cwd()) console.log(chalk.dim(`     (git root: ${shortPath(gitRoot)})`));
      console.log();
      break;
    }

    case "dir": {
      const input = await inputPrompt("Local directory path", config.localDir || process.cwd());
      if (!input) break;
      const abs = resolve(input.replace(/^~/, homedir()));
      if (!existsSync(abs)) { console.log(chalk.red(`\n  Directory not found: ${abs}\n`)); break; }
      const granted = await requestLocalAccess(abs, config);
      if (!granted) break;
      config.source   = "local";
      config.localDir = abs;
      saveConfig(config);
      console.log(chalk.green(`  ✓ Directory set to ${shortPath(abs)}\n`));
      break;
    }

    case "groq": {
      config.llm = "groq";
      if (!config.groqKey) {
        const key = await passwordPrompt("Groq API key  (console.groq.com)");
        if (!key) break;
        config.groqKey = key;
      }
      saveConfig(config);
      console.log(chalk.green("\n  ✓ Switched to Groq\n"));
      break;
    }

    case "ollama": {
      const model        = await inputPrompt("Ollama model", config.ollamaModel || OLLAMA_DEFAULT_MODEL);
      config.llm         = "ollama";
      config.ollamaModel = model || OLLAMA_DEFAULT_MODEL;
      saveConfig(config);
      console.log(chalk.green(`\n  ✓ Switched to Ollama (${config.ollamaModel})\n`));
      break;
    }

    case "key": {
      const key = await passwordPrompt("New Groq API key");
      if (!key) break;
      config.groqKey = key;
      config.llm     = "groq";
      saveConfig(config);
      console.log(chalk.green("\n  ✓ API key updated\n"));
      break;
    }

    case "clear": {
      console.clear();
      showBanner(config);
      break;
    }

    case "quit": {
      console.log(chalk.dim("\n  Bye!\n"));
      process.exit(0);
    }

    default: {
      console.log(chalk.dim(`\n  Unknown command: /${cmd}  —  type / to see options\n`));
    }
  }
}

// ── Run analysis ──────────────────────────────────────────────────────────────
// Returns { files, task, config } on success, null if cancelled/errored.

async function runAnalysis(task, config) {
  // ── Validate ──────────────────────────────────────────────────────────────
  if (!config.source) {
    console.log(chalk.yellow("  No source set. Type / → /repo or /local\n"));
    return null;
  }
  if (config.source === "github" && !config.githubRepo) {
    console.log(chalk.yellow("  No repo set. Type / → /repo\n"));
    return null;
  }
  if (!config.llm) {
    console.log(chalk.yellow("  No LLM configured. Type / → /groq or /ollama\n"));
    return null;
  }
  if (config.llm === "groq" && !config.groqKey) {
    console.log(chalk.yellow("  No Groq API key. Type / → /key\n"));
    return null;
  }

  const isLocal  = config.source === "local";
  const localDir = isLocal ? (config.localDir || process.cwd()) : undefined;

  // For local mode, verify access was previously approved (shouldn't be needed
  // since we gate at set-time, but acts as a safety net)
  if (isLocal) {
    const approved = Array.isArray(config.approvedDirs) ? config.approvedDirs : [];
    if (!approved.includes(localDir)) {
      console.log(chalk.yellow(`  Access not approved for ${shortPath(localDir)}. Use /local or /dir to re-add it.\n`));
      return null;
    }
  }

  let owner, repo;
  if (!isLocal) [owner, repo] = config.githubRepo.split("/");

  // ── Top separator with task label ─────────────────────────────────────────
  console.log();
  hrLabel(task);
  console.log();

  // ── Ensure Ollama is ready ────────────────────────────────────────────────
  if (config.llm === "ollama") {
    try {
      await ensureOllama({
        ollamaUrl:   config.ollamaUrl,
        ollamaModel: config.ollamaModel,
        onStatus:    (msg) => { process.stdout.write("\r\x1b[2K  " + chalk.dim(msg)); },
      });
      process.stdout.write("\r\x1b[2K");
    } catch (err) {
      console.log(chalk.red("  Ollama setup failed: ") + err.message + "\n");
      hr(); console.log();
      return null;
    }
  }

  // ── Progress + pipeline (Escape cancels) ─────────────────────────────────
  const progress = new ProgressDisplay();
  progress.start();

  const esc = listenForEscape();

  let pipelineResult;
  try {
    const raceResult = await Promise.race([
      runPipeline(task, {
        owner, repo, localDir,
        groqKey:     config.groqKey,
        ollama:      config.llm === "ollama",
        ollamaUrl:   config.ollamaUrl,
        ollamaModel: config.ollamaModel,
        githubToken: config.githubToken,
        useCache:    true,
        onProgress:  (step, detail) => progress.update(step, detail),
      }).then((r) => ({ type: "done", r })),
      esc.promise.then(() => ({ type: "cancelled" })),
    ]);

    esc.cleanup();

    if (raceResult.type === "cancelled") {
      progress.cancel();
      hr(); console.log();
      return null;
    }
    pipelineResult = raceResult.r;
  } catch (err) {
    esc.cleanup();
    progress.fail(err.message);
    hr(); console.log();
    return null;
  }

  const { files, fromCache } = pipelineResult;
  const totalTokens = files.reduce((s, f) => s + Math.ceil((f.content || "").length / 4), 0);

  progress.done(
    `${files.length} file${files.length !== 1 ? "s" : ""}` +
    chalk.dim(`  ·  ~${(totalTokens / 1000).toFixed(1)}k tokens`) +
    (fromCache ? chalk.dim("  ·  cached") : "")
  );

  // ── File list ─────────────────────────────────────────────────────────────
  for (const f of files) {
    console.log("  " + chalk.cyan(f.path));
    if (f.reason && f.reason !== f.path && f.reason !== f.summary) {
      const short = f.reason.length > 100 ? f.reason.slice(0, 97) + "…" : f.reason;
      console.log("  " + chalk.dim(short));
    }
  }
  console.log();

  // ── Actions ───────────────────────────────────────────────────────────────
  const githubBase = !isLocal && config.githubRepo
    ? `https://github.com/${config.githubRepo}/blob/HEAD/`
    : null;

  // Local: "copy file paths"  |  GitHub: "copy links"
  const copyHint = isLocal
    ? chalk.cyan("[c]") + chalk.dim(" copy file paths")
    : chalk.cyan("[c]") + chalk.dim(" copy links");

  const hints = [
    copyHint,
    chalk.cyan("[j]") + chalk.dim(" json"),
    chalk.cyan("[↵]") + chalk.dim(" new task"),
    chalk.cyan("[q]") + chalk.dim(" quit"),
  ];
  console.log("  " + hints.join("   "));
  console.log();

  const key = await waitForKey(["c", "j", "return", "q"]);

  const resultData = { files, task, config: { ...config } };

  if (key === "c") {
    const text = files.map((f) => (githubBase ? githubBase + f.path : f.path)).join("\n") + "\n";
    if (copyToClipboard(text)) {
      console.log(chalk.green("  ✓ Copied to clipboard\n"));
    } else {
      console.log(chalk.dim("  (clipboard not available)\n"));
      process.stdout.write(text + "\n");
    }
  } else if (key === "j") {
    console.log(JSON.stringify({
      source: isLocal ? shortPath(localDir) : `github.com/${config.githubRepo}`,
      task,
      files: files.map((f) => ({
        path: f.path,
        ...(githubBase ? { url: githubBase + f.path } : {}),
        reason: f.reason,
      })),
    }, null, 2));
    console.log();
  } else if (key === "q") {
    console.log(chalk.dim("\n  Bye!\n"));
    process.exit(0);
  }

  // ── Bottom separator ──────────────────────────────────────────────────────
  hr();
  console.log();

  return resultData;
}

// ── Main session ──────────────────────────────────────────────────────────────

export async function startSession() {
  console.clear();

  let config = loadConfig();
  showBanner(config);

  // First-time setup
  if (!config.llm || !config.source) {
    config = await runSetupWizard(config);
    console.clear();
    showBanner(config);
  }

  while (true) {
    // Status line
    const parts = [];
    if (config.llm === "groq")        parts.push("Groq");
    else if (config.llm === "ollama") parts.push(`Ollama (${config.ollamaModel || OLLAMA_DEFAULT_MODEL})`);
    if (config.source === "github" && config.githubRepo)
      parts.push(config.githubRepo);
    else if (config.source === "local")
      parts.push(shortPath(config.localDir || process.cwd()));
    if (parts.length) console.log(chalk.dim("  " + parts.join("  ·  ")));

    // Re-copy hint
    if (lastResult) console.log(chalk.dim("  /copy to re-copy last result"));

    const input = await readInput(chalk.dim("  task") + chalk.cyan(" ›") + " ");
    if (!input) { console.log(); continue; }

    if (input.startsWith("/")) {
      const cmd = input.slice(1).toLowerCase().split(" ")[0];
      console.log();
      if (cmd) await handleCommand(cmd, config);
    } else {
      const result = await runAnalysis(input, config);
      if (result) lastResult = result;
    }
  }
}
