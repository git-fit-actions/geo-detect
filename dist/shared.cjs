"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared.ts
var shared_exports = {};
__export(shared_exports, {
  LEGEND: () => LEGEND,
  buildCacheKeys: () => buildCacheKeys,
  buildSummaryBlock: () => buildSummaryBlock,
  computeContentHash: () => computeContentHash,
  generateSHA256SUMS: () => generateSHA256SUMS,
  glyphFor: () => glyphFor,
  isDirectory: () => isDirectory,
  isFile: () => isFile,
  needsLegend: () => needsLegend,
  normalizeRel: () => normalizeRel,
  shortCacheKey: () => shortCacheKey,
  summarizeFiles: () => summarizeFiles,
  summaryTable: () => summaryTable,
  validateNumber: () => validateNumber,
  validatePath: () => validatePath,
  validateStrategy: () => validateStrategy
});
module.exports = __toCommonJS(shared_exports);
var crypto = __toESM(require("crypto"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function validatePath(name, value) {
  if (value.length === 0) {
    return;
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith("-")) {
    throw new Error(`Invalid ${name} '${value}'`);
  }
}
function validateStrategy(value) {
  if (value !== "proportional" && value !== "start_end") {
    throw new Error(
      `Invalid detect-strategy '${value}' (expected proportional|start_end)`
    );
  }
}
function validateNumber(name, value) {
  if (value.length === 0) {
    return;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name} '${value}' (expected a non-negative integer)`);
  }
}
function buildCacheKeys(cacheKey) {
  return {
    sentinel: `${cacheKey}-sentinel`,
    prefix: `${cacheKey}-`
  };
}
function shortCacheKey(key) {
  if (!key) {
    return "";
  }
  return key.replace(/^GitFit-geo-v0-/, "").slice(0, 12);
}
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function summaryTable(headers, rows, alignments) {
  const escape = (s) => s.replace(/\|/g, "\\|");
  const separator = headers.map((_, i) => alignments[i] === "center" ? ":---:" : "---").join(" | ");
  const lines = [`| ${headers.map(escape).join(" | ")} |`, `| ${separator} |`];
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(" | ")} |`);
  }
  return lines.join("\n");
}
function buildSummaryBlock(heading, headers, rows, alignments, footer) {
  const block = `### GitFit ${heading}

${summaryTable(headers, rows, alignments)}`;
  return footer ? `${block}

${footer}` : block;
}
var LEGEND = "_\u2705 \u6B63\u5E38\u4EA7\u51FA \xB7 \u23ED\uFE0F \u9884\u6599\u5185\u65E0\u53D8\u5316/\u515C\u5E95 \xB7 \u274C \u5931\u8D25_";
var GLYPH_OK = /* @__PURE__ */ new Set(["hit", "ok", "saved", "imported", "attempted", "changed", "pushed", "present", "cache"]);
var GLYPH_SKIP = /* @__PURE__ */ new Set(["miss", "skipped", "unchanged", "none", "git"]);
var GLYPH_FAIL = /* @__PURE__ */ new Set(["failed", "errors", "missing"]);
var LEGEND_TRIGGER = /* @__PURE__ */ new Set(["miss", "failed", "errors", "missing"]);
function needsLegend(statuses) {
  return statuses.some((s) => LEGEND_TRIGGER.has(s.split(/\s/)[0]));
}
function glyphFor(status) {
  if (GLYPH_OK.has(status) || GLYPH_OK.has(status.split(/\s/)[0])) {
    return `\u2705 ${status}`;
  }
  if (GLYPH_SKIP.has(status) || GLYPH_SKIP.has(status.split(/\s/)[0])) {
    return `\u23ED\uFE0F ${status}`;
  }
  if (GLYPH_FAIL.has(status) || GLYPH_FAIL.has(status.split(/\s/)[0])) {
    return `\u274C ${status}`;
  }
  return status;
}
function generateSHA256SUMS(dir) {
  if (!isDirectory(dir)) {
    return;
  }
  const entries = collectFiles(dir);
  const lines = entries.map((rel) => {
    const hash = sha256File(path.join(dir, rel));
    return `${hash}  ${rel}`;
  }).sort();
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), lines.length ? lines.join("\n") + "\n" : "");
}
function computeContentHash(dir) {
  if (!isDirectory(dir)) {
    return null;
  }
  const entries = collectFiles(dir).filter((rel) => rel !== "SHA256SUMS");
  if (entries.length === 0) {
    return null;
  }
  const h = crypto.createHash("sha256");
  for (const rel of entries.sort()) {
    h.update(rel);
    h.update("\0");
    h.update(sha256File(path.join(dir, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}
function collectFiles(dir) {
  const out = [];
  const walk = (base, rel) => {
    for (const entry of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(base, childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(dir, "");
  return out;
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function normalizeRel(p) {
  const abs = path.resolve(p);
  const ws = process.env.GITHUB_WORKSPACE;
  if (ws) {
    const wsAbs = path.resolve(ws);
    if (abs === wsAbs) return ".";
    if (abs.startsWith(wsAbs + path.sep)) {
      return abs.substring(wsAbs.length + 1);
    }
  }
  return abs;
}
function summarizeFiles(dir) {
  if (!isDirectory(dir)) {
    return [];
  }
  return collectFiles(dir).filter((rel) => rel.endsWith(".jsonl")).map((rel) => ({
    name: path.basename(rel),
    lines: fs.readFileSync(path.join(dir, rel), "utf8").split("\n").filter((l) => l.trim()).length
  })).sort((a, b) => a.name.localeCompare(b.name));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEGEND,
  buildCacheKeys,
  buildSummaryBlock,
  computeContentHash,
  generateSHA256SUMS,
  glyphFor,
  isDirectory,
  isFile,
  needsLegend,
  normalizeRel,
  shortCacheKey,
  summarizeFiles,
  summaryTable,
  validateNumber,
  validatePath,
  validateStrategy
});
