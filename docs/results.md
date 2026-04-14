# Evaluation Results

## Methodology

Three metrics are tracked for each test case:

**Recall** — of the files a developer would actually need to open to complete the task, what fraction did the pipeline return? A missed file means missing context; 100% recall means nothing was left out.

**Precision** — of the files the pipeline returned, what fraction were genuinely needed? An unnecessary file wastes tokens and adds noise; 100% precision means a clean, minimal output.

**File reduction** — what fraction of the repository's total files were eliminated. A 99% reduction on a 1,000-file repo means the developer receives roughly 10 files instead of scrolling through everything.

Ground truth for each test case was established manually: given a specific task description, which source files would a developer actually need to read or modify? Test cases span 10 languages (JavaScript, TypeScript, Python, Go, Rust, Ruby, Java, PHP, C, C++) and repositories ranging from 29 to 20,717 total files — small focused libraries, mid-size frameworks, and large monorepos. All evaluations use `llama-3.3-70b-versatile` via Groq, which corresponds to the user-key path in production.

---

## Results by Pipeline Version

| Version | Repos tested | Recall | Precision | Notes |
|---------|-------------|--------|-----------|-------|
| v1 | 6 | 91.7% | 58.3% | High recall; poor precision |
| v2 | 8 | 87.5% | 93.8% | Precision recovered; slight recall dip |
| v3 | 7 | 85.7% | 100.0% | Perfect precision; recall regressed on one repo |
| v4 | 7 | 92.9% | 85.7% | Recall recovered; precision regression in TS repos |
| v5 | 8 | 92.0% | 100.0% | Both metrics strong; base for production |
| **v6** | **27** | **91%** | **93%** | Expanded test set; two known hard cases remain |

Versions v1–v5 were evaluated against the same initial benchmark of 8 repositories. v6 was extended to 27 repositories across a broader range of frameworks, task types, and languages. The slight precision drop in v6 relative to v5 reflects the expanded test surface — on the original 8-repo benchmark, v6 maintains 100% precision.

---

## v6 Detail — 27 Repositories

**File reduction: 98% average** across the 11 test cases where total file counts were recorded (ranging from 89.7% on a 29-file library to 100.0% on a 20,717-file monorepo). Qualitatively consistent across all 27 cases.

**24 of 27 test cases produced fully correct results** (100% recall and 100% precision). The three exceptions are documented below.

### Known limitations

**`tokio-rs/axum` — 50% recall.** The critical file (`routing/mod.rs`) has no task-relevant keywords in its path and sits in a large Rust monorepo. It falls outside the rescue pass's sampling window when higher-scoring files consume available slots. Persistent across all versions; requires a structural import-graph approach to fix.

**`django/django` — 0% recall.** `core/handlers/base.py` is the correct file but never surfaces as a candidate in a repository with 3,416 source files. The path-scoring step does not reward files whose significance comes entirely from their position in the class hierarchy rather than their name. A known boundary of the current candidacy algorithm.

**`pydantic/pydantic` — 0% recall.** The correct Python API file (`functional_validators.py`) was recovered by the rescue pass but subsequently pruned: the LLM preferred Rust-core validator files that scored higher on content, misidentifying the implementation layer the task requires. An LLM reasoning failure on repos with both a Python API surface and a compiled core.

These three cases represent the current ceiling of the pipeline. All other failure modes observed in earlier versions have been resolved.
