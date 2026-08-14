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
 * Build a markdown table for the step summary (GFM). Per-column alignment
 * follows the org convention: short categorical values / numbers / tokens are
 * centered, paths / labels / long text are left-aligned. Pipe characters are
 * escaped so cell values cannot break the layout.
 */
export function summaryTable(
  headers: string[],
  rows: string[][],
  alignments: Array<"left" | "center" | "right">
): string {
  const escape = (s: string): string => s.replace(/\|/g, "\\|");
  const separator = headers
    .map((_, i) => (alignments[i] === "center" ? ":---:" : "---"))
    .join(" | ");
  const lines = [`| ${headers.map(escape).join(" | ")} |`, `| ${separator} |`];
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(" | ")} |`);
  }
  return lines.join("\n");
}

/**
 * Build a full step-summary block: `### GitFit <heading>` heading plus a blank
 * line plus the GFM table. The whole block is pure markdown — mixing an HTML
 * heading (`core.summary.addHeading`) with a markdown table would let the
 * CommonMark HTML block swallow the table and render it as raw text.
 */
export function buildSummaryBlock(
  heading: string,
  headers: string[],
  rows: string[][],
  alignments: Array<"left" | "center" | "right">,
  footer?: string
): string {
  const block = `### GitFit ${heading}\n\n${summaryTable(headers, rows, alignments)}`;
  return footer ? `${block}\n\n${footer}` : block;
}

/**
 * Step-summary legend line, shared verbatim across all git-fit actions so a
 * reader learns one glyph language. `✅` = fresh success, `⏭️` = expected
 * no-change / fallback, `❌` = failure.
 */
export const LEGEND = "_✅ 正常产出 · ⏭️ 预料内无变化/兜底 · ❌ 失败_";

const GLYPH_OK = new Set(["hit", "ok", "saved", "imported", "attempted", "changed", "pushed", "present", "cache"]);
const GLYPH_SKIP = new Set(["miss", "skipped", "unchanged", "none", "git"]);
const GLYPH_FAIL = new Set(["failed", "errors", "missing"]);

/**
 * Statuses that warrant the legend line — a fallback that changed the
 * restore path (`miss`) or a failure (`failed`/`errors`/`missing`). Pure
 * no-op statuses (`unchanged`/`skipped`) and fresh successes do not repeat
 * the legend, keeping a normal run free of repeated legend lines.
 */
const LEGEND_TRIGGER = new Set(["miss", "failed", "errors", "missing"]);

/**
 * Whether a block should append the shared legend line: only when it holds at
 * least one attention status, so a single workflow run does not repeat the
 * legend across every normal block.
 */
export function needsLegend(statuses: string[]): boolean {
  return statuses.some((s) => LEGEND_TRIGGER.has(s.split(/\s/)[0]));
}

/**
 * Prefix a status word with a colored glyph so abnormal states jump out at a
 * glance. Unknown statuses pass through unchanged (never mislabeled). The
 * exact-key word is matched first; a status like `skipped (unchanged)` is
 * matched by its leading word so it stays on the neutral glyph.
 */
export function glyphFor(status: string): string {
  if (GLYPH_OK.has(status) || GLYPH_OK.has(status.split(/\s/)[0])) {
    return `✅ ${status}`;
  }
  if (GLYPH_SKIP.has(status) || GLYPH_SKIP.has(status.split(/\s/)[0])) {
    return `⏭️ ${status}`;
  }
  if (GLYPH_FAIL.has(status) || GLYPH_FAIL.has(status.split(/\s/)[0])) {
    return `❌ ${status}`;
  }
  return status;
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
