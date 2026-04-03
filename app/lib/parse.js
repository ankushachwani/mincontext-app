/**
 * Regex-based file parser.
 * Goal: produce a natural-language summary that captures what the file DOES,
 * not just a raw list of import names. Better summaries → better embeddings.
 */

export function parseFile(path, content) {
  if (!content) return { summary: path };

  const ext = path.split(".").pop().toLowerCase();
  const snippet = content.slice(0, 12000);

  let imports = [], exports = [], symbols = [], description = "";

  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) {
    ({ imports, exports, symbols, description } = parseJS(snippet));
  } else if (ext === "py") {
    ({ imports, exports, symbols, description } = parsePython(snippet));
  } else if (ext === "go") {
    ({ imports, exports, symbols, description } = parseGo(snippet));
  } else if (ext === "rs") {
    ({ imports, exports, symbols, description } = parseRust(snippet));
  } else if (ext === "rb") {
    ({ imports, exports, symbols } = parseRuby(snippet));
  } else if (["java", "kt"].includes(ext)) {
    ({ imports, exports, symbols } = parseJava(snippet));
  } else {
    // For unknown types, pull meaningful identifiers from the first 500 chars
    const words = snippet.slice(0, 500).match(/\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g) || [];
    symbols = [...new Set(words)].slice(0, 8);
  }

  const parts = [];
  if (description) parts.push(description);
  if (imports.length) parts.push(`uses ${dedupe(imports).slice(0, 5).join(", ")}`);
  if (exports.length) parts.push(`exports ${dedupe(exports).slice(0, 5).join(", ")}`);
  if (symbols.length) parts.push(`defines ${dedupe(symbols).slice(0, 5).join(", ")}`);

  const summary = parts.length
    ? `${path}: ${parts.join("; ")}`
    : path;

  return { imports, exports, symbols, summary };
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// Extract the first meaningful JSDoc/block comment as a file description
function extractTopComment(code) {
  const match = code.match(/^(?:['"]use strict['"];\s*)?(?:\/\*\*?([\s\S]*?)\*\/|\/\/(.*?)(?:\n|$))/m);
  if (!match) return "";
  const raw = (match[1] || match[2] || "")
    .replace(/^\s*\*\s?/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@\w+[^@]*/g, "") // strip JSDoc tags
    .trim();
  // Only use if it looks like a description (not a license header)
  if (raw.length < 10 || /copyright|license|MIT|ISC/i.test(raw)) return "";
  return raw.slice(0, 120);
}

// Extract the JSDoc comment immediately above a function/class definition
function extractJSDocAbove(code, matchIndex) {
  const before = code.slice(Math.max(0, matchIndex - 400), matchIndex);
  const jsdoc = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!jsdoc) return "";
  const text = jsdoc[1]
    .replace(/^\s*\*\s?/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@\w+[^@]*/g, "")
    .trim();
  return text.length > 8 ? text.slice(0, 80) : "";
}

function parseJS(code) {
  const imports = [];
  const exports = [];
  const symbols = [];
  let m;

  const description = extractTopComment(code);

  // ES imports
  const importRe = /import\s+(?:(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+)).*?from\s+['"]([^'"]+)['"])/g;
  while ((m = importRe.exec(code)) !== null) {
    const src = (m[4] || "").split("/").pop().replace(/\.(js|ts|jsx|tsx)$/, "");
    if (src) imports.push(src);
    if (m[1]) m[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => imports.push(n));
    else if (m[2]) imports.push(m[2]);
    else if (m[3]) imports.push(m[3]);
  }

  // CommonJS require
  const reqRe = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  while ((m = reqRe.exec(code)) !== null) {
    const src = (m[3] || "").split("/").pop();
    if (src) imports.push(src);
    if (m[1]) m[1].split(",").map(s => s.trim()).filter(Boolean).forEach(n => imports.push(n));
    else if (m[2]) imports.push(m[2]);
  }

  // Named exports
  const exportRe = /export\s+(?:default\s+)?(?:(?:async\s+)?function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)|\{([^}]+)\})/g;
  while ((m = exportRe.exec(code)) !== null) {
    const name = m[1] || m[2] || m[3] || m[4] || m[5];
    if (name) exports.push(name);
    if (m[6]) m[6].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => exports.push(n));
  }

  // Function/class/method definitions — include a snippet of JSDoc if present
  // Matches: function foo, class Foo, const foo = (, proto.foo =, exports.foo =, Foo.prototype.bar =
  const defRe = /(?:^|\n)[ \t]*(?:(?:async\s+)?function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\()|\w+(?:\.\w+)*\.(\w+)\s*=\s*(?:async\s+)?function)/gm;
  while ((m = defRe.exec(code)) !== null) {
    const name = m[1] || m[2] || m[3] || m[4];
    if (!name || name.length < 2 || name === "function") continue;
    const doc = extractJSDocAbove(code, m.index);
    symbols.push(doc ? `${name} (${doc.split(".")[0]})` : name);
    if (symbols.length >= 8) break;
  }

  return { imports, exports, symbols, description };
}

function parsePython(code) {
  const imports = [];
  const exports = [];
  const symbols = [];
  let m;

  const description = extractTopComment(code);

  const importRe = /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm;
  while ((m = importRe.exec(code)) !== null) {
    m[2].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => imports.push(n));
  }

  const defRe = /^(class|def)\s+(\w+)/gm;
  while ((m = defRe.exec(code)) !== null) symbols.push(m[2]);

  const allRe = /__all__\s*=\s*\[([^\]]+)\]/;
  const allMatch = allRe.exec(code);
  if (allMatch) allMatch[1].split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean).forEach(n => exports.push(n));

  return { imports, exports, symbols, description };
}

function parseGo(code) {
  const imports = [];
  const exports = [];
  const symbols = [];
  let m;
  const description = extractTopComment(code);

  // Package comment
  const pkgComment = code.match(/\/\/(.*?)\npackage\s+\w+/);
  const pkgDesc = pkgComment ? pkgComment[1].trim() : "";

  const importRe = /"([^"]+)"/g;
  const importBlock = code.slice(0, 600);
  while ((m = importRe.exec(importBlock)) !== null) imports.push(m[1].split("/").pop());

  const funcRe = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)/gm;
  while ((m = funcRe.exec(code)) !== null) exports.push(m[1]);

  const typeRe = /^type\s+(\w+)\s+(?:struct|interface)/gm;
  while ((m = typeRe.exec(code)) !== null) symbols.push(m[1]);

  return { imports, exports, symbols, description: pkgDesc || description };
}

function parseRust(code) {
  const imports = [];
  const exports = [];
  const symbols = [];
  let m;
  const description = extractTopComment(code);

  const useRe = /^use\s+([^;]+);/gm;
  while ((m = useRe.exec(code)) !== null) imports.push(m[1].split("::").pop().replace(/[{}]/g, "").trim());

  const pubRe = /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+(\w+)/gm;
  while ((m = pubRe.exec(code)) !== null) exports.push(m[1]);

  const fnRe = /^(?:async\s+)?fn\s+(\w+)/gm;
  while ((m = fnRe.exec(code)) !== null) symbols.push(m[1]);

  return { imports, exports, symbols, description };
}

function parseRuby(code) {
  const imports = [];
  const symbols = [];
  let m;

  const reqRe = /require(?:_relative)?\s+['"]([^'"]+)['"]/g;
  while ((m = reqRe.exec(code)) !== null) imports.push(m[1].split("/").pop());

  const defRe = /^\s*(?:def|class|module)\s+(\w+)/gm;
  while ((m = defRe.exec(code)) !== null) symbols.push(m[1]);

  return { imports, exports: [], symbols, description: "" };
}

function parseJava(code) {
  const imports = [];
  const exports = [];
  const symbols = [];
  let m;

  const importRe = /^import\s+(?:static\s+)?([^;]+);/gm;
  while ((m = importRe.exec(code)) !== null) imports.push(m[1].split(".").pop());

  const classRe = /(?:public|protected)\s+(?:class|interface|enum)\s+(\w+)/g;
  while ((m = classRe.exec(code)) !== null) exports.push(m[1]);

  const methodRe = /(?:public|protected)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/g;
  while ((m = methodRe.exec(code)) !== null) symbols.push(m[1]);

  return { imports, exports, symbols, description: "" };
}
