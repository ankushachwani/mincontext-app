# Changelog

---

## v6 — Production hardening *(current)*

**Recall 91% / Precision 93% — 27 repositories**

Four targeted fixes applied before the initial public release:

- **Rescue noise filter.** Dialect, generated, and vendor directories are excluded from rescue candidates. Previously, files in these paths (e.g. SQLAlchemy dialect implementations) scored high on keyword content but were irrelevant to user tasks.
- **Adaptive budget with hard cap.** The per-file character budget sent to the LLM now scales with repository size across five tiers (560 chars for small repos down to 300 for repos with 5,000+ filtered files), with a hard 36,000-character prompt cap. Prevents token overflow on large monorepos without degrading quality on small ones.
- **Removed entry-file heuristic from prune prompt.** v5's prune prompt included an explicit instruction to keep top-level entry files. On Django, this caused the LLM to retain `wsgi.py` (looks like an entry point) and prune `handlers/base.py` (the actual base handler class). Entry-file recovery is now handled exclusively by the sufficiency check's registration-file exception, which applies it only when genuinely needed.
- **Fixed coreSrc bucket membership bug.** The rescue pass was filtering the `coreSrc` bucket against `selectedSet` instead of `kwSet`, causing some files to be double-counted across buckets and reducing the effective rescue window.

*vs. v5:* Precision on the original 8-repo benchmark is unchanged (100%). The expanded 27-repo test set yields 91% recall and 93% precision overall. The two hard cases introduced in this version (axum, django) reflect known algorithmic boundaries rather than regressions from v5's fixes.

---

## v5 — Citation-gated sufficiency

**Recall 92% / Precision 100% — 8 repositories**

Two fixes targeting the remaining v4 regressions:

- **Citation-gated sufficiency check.** The sufficiency check now requires a `cited_by` field — the specific kept file that directly inherits from or imports the proposed addition. Proposals without a valid citation are rejected. A registration-file exception (max one per query) allows top-level wiring files to be added without citation, since they are imported *by* the framework, not by user code.
- **Structured prune output.** The prune prompt was rewritten to return `{file, removable, reason}` objects instead of a flat list of paths. This gives the LLM a more constrained output format and surfaces per-file reasoning for debugging.

*vs. v4:* Recall +0% (92.9% → 92.0%, within noise on a small test set). Precision +14.3 points (85.7% → 100%). The TypeScript precision regression from v4 (redux: 10 speculative type additions) is fully resolved — citation gating prevents the LLM from adding utility types that lack an explicit inheritance relationship with kept files. The Flask recall recovery from v4 is preserved: `sansio/app.py` is now found via its `[inherits: SansioApp]` annotation and the citation chain.

---

## v4 — Structural annotations + structured sufficiency

**Recall 92.9% / Precision 85.7% — 7 repositories**

Three fixes applied together:

- **Head scoring for rescue candidates.** Rescue candidates are now scored on their first 50 lines rather than the full file. Large structural files (e.g. `routing/mod.rs`) declare their purpose in import statements and type signatures at the top; full-file TF scoring dilutes this signal with implementation noise.
- **Structural role annotations.** A lightweight regex pass annotates each file's structural role before the LLM sees it — `[inherits: BaseClass]` for Python, `[implements: Trait for Type]` for Rust, `[extends: BaseClass]` for TypeScript/JavaScript, `[interface: Name]` for Go, and `[includes: Module]` for Ruby. This makes inheritance relationships visible to the LLM without requiring it to infer them from code snippets.
- **Structured sufficiency check.** The sufficiency check was rewritten to ask three explicit questions: is there a missing base class? A missing framework registration file? A missing type or struct definition?

*vs. v3:* Recall +7.2 points (85.7% → 92.9%). Precision −14.3 points (100% → 85.7%). The recall gain came from Rails (now 100%) and the structural annotations correctly surfacing base classes. The precision regression came from the "missing type definition" question in the sufficiency check: on TypeScript repositories, nearly every utility is technically a type dependency, causing the LLM to add 10+ files to Redux that had been correctly pruned. Fix 3 needs language-aware scoping, addressed in v5.

---

## v3 — Richer file representation

**Recall 85.7% / Precision 100.0% — 7 repositories**

Two changes to what the LLM sees:

- **Code snippet included.** File descriptions sent to the LLM now include the first 15 lines of actual source code in addition to the parsed summary of imports, exports, and symbols. This lets the LLM evaluate function signatures, type declarations, and structural patterns rather than only metadata.
- **Adaptive per-file character budget.** Budget scales with the number of filtered files (580 chars for small repos, 380 for large), preventing context overflow on repositories with hundreds of candidates.
- **Graph rescue removed.** The import-graph rescue pass introduced experimentally in v2 was dropped. "Imported by a kept file" does not imply "needed for this task" — `lib/application.js` imports `lib/view.js` in Express, but `view.js` is irrelevant to rate limiting. Graph-based rescue requires cross-package scoping to be safe.

*vs. v2:* Recall −1.8 points (87.5% → 85.7%) on the 7 completed repos; one case (axum) was rate-limited and untested. Precision +6.2 points (93.8% → 100%). The precision improvement is from the LLM now seeing actual code: `render/render.go` (Gin) and `lib/view.js` (Express) were previously kept because their metadata looked adjacent to the task; with code visible, the LLM correctly removes them.

---

## v2 — Content rescue pass

**Recall 87.5% / Precision 93.8% — 8 repositories**

The path-scoring pre-filter caps candidates at roughly 80 files. For large repositories, the correct file is often never selected as a candidate at all. v2 adds a rescue pass after content is fetched:

- **Source-extension filter.** Only files with source extensions (`.py`, `.go`, `.rs`, `.rb`, `.js`, `.ts`, etc.) are eligible for rescue. Eliminates READMEs and config files that score high on keyword content because they *describe* features in prose.
- **Structured sampling.** 80 cut files are sampled in priority order: first, cut files with a task keyword in their path (highest prior probability of relevance); then, cut source files in core directories (`src/`, `lib/`, `core/`, `handlers/`, `middleware/`, `routing/`); then remaining source files. This ordering surfaces files like `core/handlers/base.py` in Django even when they have no keywords in their path.
- **Score-gated promotion.** A cut file is only promoted into the candidate set if its head-scored content score (≥ 0.25 threshold) exceeds the score of the weakest existing candidate. This prevents rescue from degrading result quality.

*vs. v1:* Recall −4.2 points (91.7% → 87.5%). Precision +35.5 points (58.3% → 93.8%). The recall dip is one regression — axum's `routing/mod.rs` was accidentally rescued by v1's shallow-path sampling but falls outside v2's structured sampling window. The precision gain reflects elimination of documentation and configuration noise that v1's content reordering floated to the top of the LLM window without filtering.

---

## v1 — Content re-ranking

**Recall 91.7% / Precision 58.3% — 6 repositories**

After fetching candidate file contents, each file is scored by keyword density (TF-weighted, normalized by `sqrt(wordCount)`). Files scoring above 0.2 are promoted to the top of the candidate list before the LLM evaluates them.

This is a reordering pass, not a rescue pass: it improves the order in which the LLM sees existing candidates but does not recover files that were excluded by the path-scoring pre-filter. For large repositories where the correct file was never selected as a candidate, reordering has no effect.

*Baseline (v0):* Path-scoring only. No content evaluation at any stage. Recall and precision numbers for v0 were not formally measured, but qualitative testing showed frequent misses on files with generic names and high false-positive rates from structurally prominent but task-irrelevant files.
