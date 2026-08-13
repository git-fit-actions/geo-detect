import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface GeoInputs {
  dbPath: string;
  cacheDir: string;
  cacheKey: string;
  amapKey: string;
  detectLimit: string;
  detectBatch: string;
  detectStrategy: string;
  detectTime: string;
  checkpoint: string;
}

/**
 * Validate a path-ish / scalar input. Rejects empty-less control characters
 * and leading `-` (flag-injection guard), mirroring db-store's discipline.
 */
export function validatePath(name: string, value: string): void {
  if (value.length === 0) {
    return;
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith("-")) {
    throw new Error(`Invalid ${name} '${value}'`);
  }
}

export function validateStrategy(value: string): void {
  if (value !== "proportional" && value !== "start_end") {
    throw new Error(
      `Invalid detect-strategy '${value}' (expected proportional|start_end)`
    );
  }
}

export function validateNumber(name: string, value: string): void {
  if (value.length === 0) {
    return;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name} '${value}' (expected a non-negative integer)`);
  }
}

export interface CacheKeys {
  sentinel: string;
  prefix: string;
}

/**
 * Cache keys, aligned with the org-wide `GitFit-*-v0-*` discipline:
 *   <ns>-sentinel   (restore exact key — never written, forces prefix fallback)
 *   <ns>-           (restore-keys prefix — most recent wins)
 *   <ns>-<sha256>   (save key — content-addressed by the point cache hash)
 */
export function buildCacheKeys(cacheKey: string): CacheKeys {
  return {
    sentinel: `${cacheKey}-sentinel`,
    prefix: `${cacheKey}-`,
  };
}

/**
 * Compress a geo cache key for the horizontal summary table: strip the
 * `GitFit-geo-v0-` namespace prefix (derivable from context) and truncate the
 * content hash to 12 hex chars. Empty key stays empty (callers render the
 * "none"/miss placeholder).
 */
export function shortCacheKey(key: string): string {
  if (!key) {
    return "";
  }
  return key.replace(/^GitFit-geo-v0-/, "").slice(0, 12);
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Generate `SHA256SUMS` inside `dir` listing every regular file under it
 * (relative paths), the standard git-fit data-store format.
 */
export function generateSHA256SUMS(dir: string): void {
  if (!isDirectory(dir)) {
    return;
  }
  const entries = collectFiles(dir);
  const lines = entries
    .map((rel) => {
      const hash = sha256File(path.join(dir, rel));
      return `${hash}  ${rel}`;
    })
    .sort();
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), lines.length ? lines.join("\n") + "\n" : "");
}

/**
 * Content hash of every regular file under `dir` (excluding SHA256SUMS itself
 * for save-key stability) — `find | sort | xargs sha256sum | sha256sum`,
 * content-addressed save key.
 */
export function computeContentHash(dir: string): string | null {
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

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (base: string, rel: string) => {
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

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * Normalize an input path to a repo-relative path when under GITHUB_WORKSPACE,
 * matching db-store/cache/restore's derive logic so cache paths are stable
 * across runner working-directory differences.
 */
export function normalizeRel(p: string): string {
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

export function summarizeFiles(dir: string): { name: string; lines: number }[] {
  if (!isDirectory(dir)) {
    return [];
  }
  return collectFiles(dir)
    .filter((rel) => rel.endsWith(".jsonl"))
    .map((rel) => ({
      name: path.basename(rel),
      lines: fs.readFileSync(path.join(dir, rel), "utf8").split("\n").filter((l) => l.trim()).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
