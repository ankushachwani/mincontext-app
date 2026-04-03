import { pathMatchScore } from "./keywords.js";

let pipeline = null;
let loadingPromise = null;

export async function loadEmbeddingModel(onProgress) {
  if (pipeline) return pipeline;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline: createPipeline, env } = await import("@xenova/transformers");

    env.backends.onnx.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    if (onProgress) onProgress("Downloading model (first run only)...");

    const p = await createPipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      {
        quantized: true,
        progress_callback: (info) => {
          if (onProgress && info.status === "progress") {
            onProgress(`Loading model: ${info.file} (${Math.round(info.progress ?? 0)}%)`);
          }
        },
      }
    );
    pipeline = p;
    return p;
  })();

  return loadingPromise;
}

export async function embed(texts) {
  const p = await loadEmbeddingModel();
  const output = await p(texts, { pooling: "mean", normalize: true });
  const dim = 384;
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return results;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pre-filter: return the top-N files by pure cosine similarity.
 * No threshold, no keyword boost — used in pass 1 to select candidates
 * for content fetch without applying final-ranking logic prematurely.
 */
export function topByEmbedding(fileEmbeddings, taskEmbedding, n) {
  return fileEmbeddings
    .map((f) => ({ ...f, score: cosineSimilarity(f.embedding, taskEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * Rank files and return an adaptive slice — not a fixed top-N.
 *
 * Scoring (per file):
 *   70% semantic similarity  — captures conceptual relevance
 *   30% path keyword match   — surfaces files whose path directly names the task domain
 *
 * Content keyword scoring is intentionally excluded: it rewards files that
 * reference a concept (like all the examples/ files that use "middleware")
 * rather than files that implement or define it.
 *
 * Adaptive cutoff:
 *   Include all files above max(absoluteFloor, topScore * relativeFloor).
 *   This returns 3–30 files depending on how tightly the scores cluster.
 */
export function rankFiles(fileEmbeddings, taskEmbedding, keywords, semanticWeight = 0.7) {
  const ABSOLUTE_FLOOR = 0.15;  // never include files below this score
  const RELATIVE_FLOOR = 0.80;  // must be within 20% drop of the top score
  const MIN_RESULTS = 3;
  const MAX_RESULTS = 30;

  const pathWeight = 1 - semanticWeight;

  const scored = fileEmbeddings
    .map(({ path, embedding, summary, content }) => {
      const semantic = cosineSimilarity(embedding, taskEmbedding);
      const pathKw = pathMatchScore(path, keywords);
      const score = semanticWeight * semantic + pathWeight * pathKw;

      // Build reason
      const reasons = [];
      if (pathKw > 0) {
        const norm = path.toLowerCase().replace(/[-_./]/g, " ");
        const matched = keywords.filter((kw) => norm.includes(kw));
        if (matched.length) reasons.push(`path: ${matched.join(", ")}`);
      }
      const detail = summary.replace(path + ": ", "");
      if (detail && detail !== path) reasons.push(detail);

      return { path, summary, content, score, reason: reasons.join(" · ") || path };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const topScore = scored[0].score;
  const threshold = Math.max(ABSOLUTE_FLOOR, topScore * RELATIVE_FLOOR);

  const filtered = scored.filter((f) => f.score >= threshold);
  const clamped = filtered.slice(0, MAX_RESULTS);
  return clamped.length >= MIN_RESULTS ? clamped : scored.slice(0, MIN_RESULTS);
}
