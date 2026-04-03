// Server-side stub — embedding only runs in the browser (WASM/ONNX).
// This file is aliased to embed.js for server builds to prevent Next.js
// from bundling @xenova/transformers server-side and emitting WASM chunks
// that only exist in the client output (the root cause of the ./948.js error).
export async function loadEmbeddingModel() {}
export async function embed() { return []; }
export function rankFiles() { return []; }
