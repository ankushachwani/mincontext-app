#!/usr/bin/env node

// ── Interactive mode: `mincontext` with no arguments ─────────────────────────
if (process.argv.length <= 2) {
  const { startSession } = await import("../src/interactive.js");
  await startSession();
  process.exit(0);
}

// ── CLI mode: `mincontext <repo> <task> [flags]` ──────────────────────────────
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runPipeline } from "../src/pipeline.js";
import { ensureOllama, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_URL } from "../src/llm.js";

const STEPS = ["Fetching tree", "Fetching files", "Analyzing", "Narrowing down", "Verifying"];

import { resolve } from "path";
import { existsSync, statSync } from "fs";

function parseRepo(input) {
  const urlMatch = input.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  const slashMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
  return null;
}

// Returns an absolute path if the input looks like a local directory, otherwise null.
function parseLocalPath(input) {
  if (input === "." || input.startsWith("./") || input.startsWith("../") || input.startsWith("/")) {
    const abs = resolve(input);
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
  }
  return null;
}

const program = new Command();

program
  .name("mincontext")
  .description("Find the minimum set of files needed to complete a task in any GitHub repo.")
  .version("1.0.0")
  .argument("<repo>", "GitHub repo as owner/repo or full URL")
  .argument("<task>", 'Task description (e.g. "add error handling middleware")')
  .option("-k, --key <key>", "Groq API key (or set GROQ_API_KEY env var)")
  .option("-t, --token <token>", "GitHub token (or set GITHUB_TOKEN env var)")
  .option("--ollama", "Use local Ollama instead of Groq")
  .option("--ollama-url <url>", `Ollama server URL (default: ${OLLAMA_DEFAULT_URL})`)
  .option("--ollama-model <model>", `Ollama model (default: ${OLLAMA_DEFAULT_MODEL})`)
  .option("--no-cache", "Skip local result cache")
  .option("--links", "Output full GitHub URLs")
  .option("--json", "Output results as JSON")
  .addHelpText("after", `
LLM backends:
  Groq (free cloud):
    $ mincontext expressjs/express "add middleware" --key gsk_xxx
    $ GROQ_API_KEY=gsk_xxx mincontext expressjs/express "add middleware"

  Ollama (local, no key needed):
    $ ollama pull llama3.3
    $ mincontext expressjs/express "add middleware" --ollama

Interactive mode (recommended):
    $ mincontext
`)
  .action(async (repoArg, taskArg, opts) => {
    const localDir = parseLocalPath(repoArg);
    const parsed = localDir ? null : parseRepo(repoArg);

    if (!localDir && !parsed) {
      console.error(chalk.red("Error:"), "Invalid source. Use owner/repo, a GitHub URL, or a local path (. or /abs/path).");
      process.exit(1);
    }

    const useOllama = !!opts.ollama;
    const groqKey = opts.key || process.env.GROQ_API_KEY;

    if (!useOllama && !groqKey) {
      console.error(chalk.red("Error:"), "An LLM backend is required.\n");
      console.error(chalk.bold("Option 1 — Groq") + chalk.dim(" (free):"));
      console.error(`  $ mincontext ${repoArg} "${taskArg}" --key <groq-key>`);
      console.error("  Get a key at", chalk.cyan("https://console.groq.com"));
      console.error();
      console.error(chalk.bold("Option 2 — Ollama") + chalk.dim(" (local, no account):"));
      console.error("  $ ollama pull llama3.3");
      console.error(`  $ mincontext ${repoArg} "${taskArg}" --ollama`);
      console.error("  Install at", chalk.cyan("https://ollama.com"));
      process.exit(1);
    }

    const owner = parsed?.owner;
    const repo = parsed?.repo;

    if (!opts.json) {
      console.log();
      console.log(chalk.bold("mincontext"), chalk.dim(localDir ? localDir : `${owner}/${repo}`));
      console.log(chalk.dim(`Task: ${taskArg}`));
      console.log(chalk.dim(`LLM:  ${useOllama ? `Ollama (${opts.ollamaModel || OLLAMA_DEFAULT_MODEL})` : "Groq"}`));
      console.log();
    }

    const spinner = opts.json ? null : ora({ text: "Starting...", color: "cyan" }).start();

    if (useOllama) {
      try {
        await ensureOllama({
          ollamaUrl: opts.ollamaUrl,
          ollamaModel: opts.ollamaModel,
          onStatus: (msg) => { if (spinner) spinner.text = chalk.dim(msg); },
        });
      } catch (err) {
        if (spinner) spinner.fail(chalk.red("Ollama setup failed"));
        console.error(chalk.red("Error:"), err.message);
        process.exit(1);
      }
    }

    try {
      const { files, fromCache } = await runPipeline(taskArg, {
        owner,
        repo,
        localDir: localDir || undefined,
        groqKey,
        ollama: useOllama,
        ollamaUrl: opts.ollamaUrl,
        ollamaModel: opts.ollamaModel,
        githubToken: opts.token || process.env.GITHUB_TOKEN,
        useCache: opts.cache !== false,
        onProgress: (step, detail) => {
          if (!spinner) return;
          spinner.text =
            chalk.cyan(`[${step + 1}/${STEPS.length}]`) + " " +
            chalk.bold(STEPS[step]) + "  " + chalk.dim(detail);
        },
      });

      if (spinner) spinner.succeed(chalk.green("Done") + chalk.dim(fromCache ? "  (cached)" : ""));

      const ghBase = !localDir ? `https://github.com/${owner}/${repo}/blob/HEAD/` : null;

      if (opts.json) {
        console.log(JSON.stringify({
          source: localDir || `${owner}/${repo}`, task: taskArg, fromCache,
          files: files.map((f) => ({
            path: f.path,
            ...(ghBase ? { url: ghBase + f.path } : {}),
            reason: f.reason,
          })),
        }, null, 2));
        return;
      }

      console.log();
      if (opts.links && ghBase) {
        for (const f of files) console.log(ghBase + f.path);
      } else {
        for (const f of files) {
          console.log(chalk.cyan(f.path));
          if (f.reason && f.reason !== f.path) console.log(chalk.dim(`  ${f.reason}`));
        }
      }
      console.log();
      console.log(chalk.dim(`${files.length} file${files.length !== 1 ? "s" : ""}`) + (fromCache ? chalk.dim("  · cached") : ""));
    } catch (err) {
      if (spinner) spinner.fail(chalk.red("Failed"));
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program.parse();
