"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCacheKeys,
  computeContentHash,
  generateSHA256SUMS,
  isDirectory,
  isFile,
  normalizeRel,
  shortCacheKey,
  summarizeFiles,
  summaryTable,
  validateNumber,
  validatePath,
  validateStrategy,
} = require("../dist/shared.cjs");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "git-fit-geo-test-"));
}

function write(base, rel, content) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// ── validatePath ──

test("validatePath: accepts normal paths", () => {
  assert.doesNotThrow(() => validatePath("db-path", "data/db/git-fit.db"));
  assert.doesNotThrow(() => validatePath("cache-dir", "data/cache/geo"));
});

test("validatePath: rejects control characters and leading dash", () => {
  assert.throws(() => validatePath("db-path", "data\n/db"), /Invalid db-path/);
  assert.throws(() => validatePath("cache-dir", "--flag"), /Invalid cache-dir/);
});

test("validatePath: accepts empty string", () => {
  assert.doesNotThrow(() => validatePath("cache-dir", ""));
});

// ── validateStrategy / validateNumber ──

test("validateStrategy: accepts valid strategies", () => {
  assert.doesNotThrow(() => validateStrategy("proportional"));
  assert.doesNotThrow(() => validateStrategy("start_end"));
});

test("validateStrategy: rejects unknown strategy", () => {
  assert.throws(() => validateStrategy("random"), /Invalid detect-strategy/);
});

test("validateNumber: accepts integers, rejects junk", () => {
  assert.doesNotThrow(() => validateNumber("detect-limit", "200"));
  assert.doesNotThrow(() => validateNumber("detect-time", ""));
  assert.throws(() => validateNumber("detect-limit", "abc"), /Invalid detect-limit/);
  assert.throws(() => validateNumber("detect-limit", "-5"), /Invalid detect-limit/);
});

// ── buildCacheKeys ──

test("buildCacheKeys: sentinel + prefix", () => {
  const k = buildCacheKeys("GitFit-geo-v0");
  assert.equal(k.sentinel, "GitFit-geo-v0-sentinel");
  assert.equal(k.prefix, "GitFit-geo-v0-");
});

// ── SHA256SUMS / content hash ──

test("generateSHA256SUMS: writes per-file hashes with relative paths", () => {
  const dir = tmpdir();
  write(dir, "amap-points.jsonl", "a\nb\n");
  write(dir, "nominatim-points.jsonl", "c\n");
  generateSHA256SUMS(dir);
  const sums = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").trim();
  const lines = sums.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.endsWith("  amap-points.jsonl")));
  assert.ok(lines.some((l) => l.endsWith("  nominatim-points.jsonl")));
  // 64 hex chars + 2-space separator + rel path
  assert.match(lines[0], /^[0-9a-f]{64}  \S+$/);
});

test("computeContentHash: stable, changes when content changes, excludes SHA256SUMS", () => {
  const dir = tmpdir();
  write(dir, "amap-points.jsonl", "hello");
  const h1 = computeContentHash(dir);
  assert.ok(h1 && /^[0-9a-f]{64}$/.test(h1));

  generateSHA256SUMS(dir);
  const h2 = computeContentHash(dir);
  assert.equal(h1, h2, "SHA256SUMS generation must not change the content hash");

  write(dir, "amap-points.jsonl", "hello world");
  const h3 = computeContentHash(dir);
  assert.notEqual(h1, h3);
});

test("computeContentHash: null on empty / missing dir", () => {
  const dir = tmpdir();
  assert.equal(computeContentHash(dir), null);
  assert.equal(computeContentHash(path.join(dir, "nope")), null);
});

// ── isDirectory / isFile ──

test("isDirectory / isFile", () => {
  const dir = tmpdir();
  write(dir, "a.jsonl", "x");
  assert.equal(isDirectory(dir), true);
  assert.equal(isFile(path.join(dir, "a.jsonl")), true);
  assert.equal(isDirectory(path.join(dir, "missing")), false);
  assert.equal(isFile(path.join(dir, "missing")), false);
});

// ── summarizeFiles ──

test("summarizeFiles: counts lines per provider file", () => {
  const dir = tmpdir();
  write(dir, "amap-points.jsonl", "a\nb\nc\n");
  write(dir, "nominatim-points.jsonl", "d\n");
  write(dir, "SHA256SUMS", "ignored\n");
  const files = summarizeFiles(dir);
  assert.deepEqual(files, [
    { name: "amap-points.jsonl", lines: 3 },
    { name: "nominatim-points.jsonl", lines: 1 },
  ]);
});

test("summarizeFiles: empty dir", () => {
  assert.deepEqual(summarizeFiles(tmpdir()), []);
});

// ── normalizeRel ──

test("normalizeRel: relativizes under GITHUB_WORKSPACE", () => {
  const ws = tmpdir();
  process.env.GITHUB_WORKSPACE = ws;
  try {
    assert.equal(normalizeRel(path.join(ws, "data", "cache")), path.join("data", "cache"));
    assert.equal(normalizeRel(ws), ".");
  } finally {
    delete process.env.GITHUB_WORKSPACE;
  }
});

test("normalizeRel: leaves absolute path when outside workspace", () => {
  const ws = tmpdir();
  process.env.GITHUB_WORKSPACE = ws;
  try {
    const outside = "/tmp/somewhere-else";
    assert.equal(normalizeRel(outside), outside);
  } finally {
    delete process.env.GITHUB_WORKSPACE;
  }
});

test("shortCacheKey: strips namespace, truncates hash to 12 hex", () => {
  const full = "GitFit-geo-v0-be157841103de268aaebfc7e84ab4d547b1ec0608f5461da784578554db81fe1";
  assert.equal(shortCacheKey(full), "be157841103d");
});

test("shortCacheKey: empty key stays empty", () => {
  assert.equal(shortCacheKey(""), "");
});

test("summaryTable: mixed alignment separator (left + centered)", () => {
  const md = summaryTable(
    ["Status", "DB path", "Cache files"],
    [["ok", "data/db/workouts.db", "a (3 lines)"]],
    ["center", "left", "left"]
  );
  assert.match(md, /\| Status \| DB path \| Cache files \|/);
  assert.match(md, /\| :---: \| --- \| --- \|/);
  assert.match(md, /\| ok \| data\/db\/workouts\.db \| a \(3 lines\) \|/);
});

test("summaryTable: escapes pipe characters in cells", () => {
  const md = summaryTable(["A"], [["x|y"]], ["left"]);
  assert.match(md, /x\\\|y/);
});
