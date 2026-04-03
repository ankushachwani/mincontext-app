const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "in", "with", "and", "or", "of", "on",
  "at", "by", "it", "is", "be", "as", "do", "if", "my", "we", "our",
  "add", "make", "build", "create", "implement", "write", "update", "change",
  "modify", "fix", "get", "set", "put", "use", "using", "new", "into",
  "that", "this", "from", "via", "how", "when", "what", "where", "which",
  "can", "so", "also", "want", "need", "should", "would", "will", "able",
  "support", "allow", "enable", "handle", "work", "works", "working",
]);

/**
 * Extract meaningful keywords from a task description.
 * Returns lowercase, deduped tokens ≥ 3 chars with stopwords removed.
 */
export function extractKeywords(task) {
  return [
    ...new Set(
      task
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    ),
  ];
}

/**
 * Score a file path against keywords.
 * Normalises separators so "rate-limit", "rateLimit", "rate_limit" all match "rate" and "limit".
 */
export function pathMatchScore(filePath, keywords) {
  if (!keywords.length) return 0;
  const norm = filePath.toLowerCase().replace(/[-_./]/g, " ");
  const hits = keywords.filter((kw) => norm.includes(kw));
  return hits.length / keywords.length;
}

/**
 * Score file content against keywords using simplified TF scoring.
 * Normalised by sqrt(wordCount) to avoid large files dominating.
 */
export function contentMatchScore(content, keywords) {
  if (!content || !keywords.length) return 0;
  const text = content.toLowerCase();
  const wordCount = Math.max(1, text.split(/\s+/).length);
  let totalHits = 0;
  for (const kw of keywords) {
    // count occurrences
    let pos = 0, count = 0;
    while ((pos = text.indexOf(kw, pos)) !== -1) { count++; pos++; }
    totalHits += count;
  }
  // Normalize: hits per keyword per sqrt-word, capped at 1
  return Math.min(1, (totalHits / keywords.length) / Math.sqrt(wordCount) * 10);
}
