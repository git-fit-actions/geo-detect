import * as core from "@actions/core";
import * as cache from "@actions/cache";
import {
  buildCacheKeys,
  computeContentHash,
  generateSHA256SUMS,
  isDirectory,
  normalizeRel,
  summarizeFiles,
} from "./shared";

async function run(): Promise<void> {
  const cacheEnabled = core.getState("cache-enabled") === "true";
  const matchedKey = core.getState("matched-key") || "";
  const cacheKey = core.getState("cache-key") || "GitFit-geo-v0";

  if (!cacheEnabled) {
    await writeSummary("skipped (caching disabled)", matchedKey, []);
    return;
  }

  const cacheDir = core.getInput("cache-dir");
  const relDir = normalizeRel(cacheDir);

  if (!isDirectory(relDir)) {
    await writeSummary("skipped (no cache directory)", matchedKey, []);
    return;
  }

  generateSHA256SUMS(relDir);
  const hash = computeContentHash(relDir);
  if (!hash) {
    await writeSummary("skipped (no point files)", matchedKey, []);
    return;
  }

  const { prefix } = buildCacheKeys(cacheKey);
  const saveKey = `${prefix}${hash}`;

  if (saveKey === matchedKey) {
    await writeSummary("skipped (unchanged)", matchedKey, summarizeFiles(relDir));
    return;
  }

  core.info(`Saving geo cache (key: ${saveKey})...`);
  const saved = await cache.saveCache([relDir], saveKey);
  if (saved) {
    await writeSummary("saved", matchedKey, summarizeFiles(relDir), saveKey);
  } else {
    await writeSummary("save failed (another job may hold the key)", matchedKey, summarizeFiles(relDir), saveKey);
  }
}

async function writeSummary(
  status: string,
  matchedKey: string,
  files: { name: string; lines: number }[],
  saveKey?: string
): Promise<void> {
  const fileLines = files
    .map((f) => `${f.name} (${f.lines.toLocaleString()} lines)`)
    .join(", ");
  core.summary.addHeading("GitFit geo cache", 3);
  core.summary.addTable([
    [{ data: "Item", header: true }, { data: "Value", header: true }],
    ["Status", status],
    ["Restored key", matchedKey || "none (miss)"],
    ["Save key", saveKey || "—"],
    ["Cache files", fileLines || "—"],
  ]);
  await core.summary.write();
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
