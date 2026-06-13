"use strict";

const fs = require("fs");
const path = require("path");
const ts = require("typescript") as typeof import("typescript");

interface FoundComment {
  line: number;
  text: string;
}

interface AllowedComment {
  file: string;
  text: string;
}

const root = process.cwd();
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target"]);
const ignoredFiles = new Set<string>([
  path.normalize(path.join("native", "index.js")),
  path.normalize(path.join("native", "index.d.ts"))
]);
const checkedExtensions = new Set<string>([".ts", ".js", ".rs"]);

const ALLOWED_COMMENTS: AllowedComment[] = [];

function findCommentsTsLike(text: string, fileName: string): FoundComment[] {
  const scriptKind = fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const out: FoundComment[] = [];
  const seen = new Set<number>();
  function add(pos: number, end: number): void {
    if (seen.has(pos)) return;
    seen.add(pos);
    const lc = source.getLineAndCharacterOfPosition(pos);
    out.push({ line: lc.line + 1, text: text.slice(pos, end).trim() });
  }
  function collect(ranges: Array<{ pos: number; end: number }> | undefined): void {
    if (!ranges) return;
    for (const range of ranges) add(range.pos, range.end);
  }
  function visit(node: import("typescript").Node): void {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
  out.sort((a, b) => a.line - b.line);
  return out;
}

function findCommentsRust(text: string): FoundComment[] {
  const out: FoundComment[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = text[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "r" && (text[i + 1] === "\"" || text[i + 1] === "#")) {
      let j = i + 1;
      let hashes = 0;
      while (text[j] === "#") { hashes++; j++; }
      if (text[j] === "\"") {
        j++;
        const close = "\"" + "#".repeat(hashes);
        const idx = text.indexOf(close, j);
        const endPos = idx === -1 ? n : idx + close.length;
        for (let k = i; k < endPos; k++) if (text[k] === "\n") line++;
        i = endPos;
        continue;
      }
    }
    if (c === "\"") {
      let j = i + 1;
      while (j < n && text[j] !== "\"") {
        if (text[j] === "\\") j++;
        else if (text[j] === "\n") line++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "'") {
      if (text[i + 1] === "\\") {
        let j = i + 2;
        while (j < n && text[j] !== "'") j++;
        i = j + 1;
        continue;
      }
      if (text[i + 2] === "'") { i += 3; continue; }
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      out.push({ line, text: text.slice(i, end).trim() });
      i = end;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const startLine = line;
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === "/" && text[j + 1] === "*") { depth++; j += 2; continue; }
        if (text[j] === "*" && text[j + 1] === "/") { depth--; j += 2; continue; }
        if (text[j] === "\n") line++;
        j++;
      }
      out.push({ line: startLine, text: text.slice(i, Math.min(j, n)).split("\n")[0].trim() });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function findComments(text: string, ext: string, fileName = "file.ts"): FoundComment[] {
  if (ext === ".rs") return findCommentsRust(text);
  return findCommentsTsLike(text, fileName);
}

function isAllowed(relFile: string, commentText: string): boolean {
  return ALLOWED_COMMENTS.some(allowed => allowed.file === relFile && allowed.text === commentText.trim());
}

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(fullPath, files); continue; }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!checkedExtensions.has(ext)) continue;
    const rel = path.normalize(path.relative(root, fullPath));
    if (ignoredFiles.has(rel)) continue;
    files.push(fullPath);
  }
}

function run(): void {
  const files: string[] = [];
  walk(root, files);
  const violations: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files.sort()) {
    const rel = path.normalize(path.relative(root, file));
    const text = fs.readFileSync(file, "utf8");
    const comments = findComments(text, path.extname(file), file);
    for (const comment of comments) {
      if (isAllowed(rel, comment.text)) continue;
      violations.push({ file: rel, line: comment.line, text: comment.text });
    }
  }
  if (violations.length > 0) {
    console.error("Comments are not allowed in code files (rule 1). Found:");
    for (const v of violations) {
      const preview = v.text.length > 80 ? `${v.text.slice(0, 77)}...` : v.text;
      console.error(`- ${v.file}:${v.line}  ${preview}`);
    }
    console.error(`\nTotal: ${violations.length}. Move rationale to documentation, or add a clear exception in scripts/check-no-comments.ts.`);
    process.exit(1);
  }
  console.log(`No-comments OK: scanned ${files.length} files, ${ALLOWED_COMMENTS.length} documented exceptions allowed`);
}

module.exports = { findComments, findCommentsTsLike, findCommentsRust, isAllowed, ALLOWED_COMMENTS };

if (require.main === module) run();

export {};
