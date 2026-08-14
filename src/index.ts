import * as core from "@actions/core";
import * as cache from "@actions/cache";
import * as exec from "@actions/exec";
import {
  buildCacheKeys,
  buildSummaryBlock,
  generateSHA256SUMS,
  normalizeRel,
  summarizeFiles,
  validateNumber,
  validatePath,
  validateStrategy,
  type GeoInputs,
} from "./shared";

function readInputs(): GeoInputs {
  return {
    dbPath: core.getInput("db-path"),
    cacheDir: core.getInput("cache-dir"),
    cacheKey: core.getInput("cache-key") || "GitFit-geo-v0",
    amapKey: core.getInput("amap-key"),
    detectLimit: core.getInput("detect-limit") || "200",
    detectBatch: core.getInput("detect-batch") || "20",
    detectStrategy: core.getInput("detect-strategy") || "proportional",
    detectTime: core.getInput("detect-time") || "300",
    checkpoint: core.getInput("checkpoint") || "false",
  };
}

function validate(inputs: GeoInputs): void {
  validatePath("db-path", inputs.dbPath);
  validatePath("cache-dir", inputs.cacheDir);
  validatePath("cache-key", inputs.cacheKey);
  validateNumber("detect-limit", inputs.detectLimit);
  validateNumber("detect-batch", inputs.detectBatch);
  validateNumber("detect-time", inputs.detectTime);
  validateStrategy(inputs.detectStrategy);
  if (inputs.checkpoint !== "true" && inputs.checkpoint !== "false") {
    throw new Error(`Invalid checkpoint '${inputs.checkpoint}' (expected true|false)`);
  }
}

function parseDetectSummary(stdout: string): {
  processed: string;
  skipped: string;
  errors: string;
} {
  const m = stdout.match(
    /Geo detection complete:\s+(\d+)\s+processed,\s+(\d+)\s+skipped,\s+(\d+)\s+errors/
  );
  if (!m) {
    return { processed: "n/a", skipped: "n/a", errors: "n/a" };
  }
  return { processed: m[1], skipped: m[2], errors: m[3] };
}

async function run(): Promise<void> {
  const inputs = readInputs();
  validate(inputs);

  const cacheEnabled = inputs.cacheDir !== "";
  const relDir = normalizeRel(inputs.cacheDir);

  // ── Restore point cache ──
  let matchedKey = "";
  if (cacheEnabled) {
    const { sentinel, prefix } = buildCacheKeys(inputs.cacheKey);
    core.info(`Restoring geo cache (key prefix: ${prefix})...`);
    matchedKey = (await cache.restoreCache([relDir], sentinel, [prefix])) || "";
    core.info(matchedKey ? `Restored (key: ${matchedKey})` : "No cache found, skipped");
  } else {
    core.info("cache-dir empty — caching disabled");
  }

  // main → post state handoff
  core.saveState("matched-key", matchedKey);
  core.saveState("cache-enabled", cacheEnabled ? "true" : "false");
  core.saveState("cache-key", inputs.cacheKey);

  // ── Run detect ──
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    GIT_FIT_DATABASE_PATH: inputs.dbPath,
  };
  if (inputs.amapKey) {
    env.AMAP_API_KEY = inputs.amapKey;
  } else {
    core.warning(
      "amap-key not set — China coordinates will fail; international coordinates use Nominatim"
    );
  }

  const args = [
    "fit",
    "geo",
    "detect",
    "--limit",
    inputs.detectLimit,
    "--batch",
    inputs.detectBatch,
    "--strategy",
    inputs.detectStrategy,
    "--time",
    inputs.detectTime,
  ];
  if (inputs.checkpoint === "true") {
    args.push("--checkpoint");
  }
  if (cacheEnabled) {
    args.push("--cache-dir", inputs.cacheDir);
  }

  core.info(`Running: bundle exec git ${args.join(" ")}`);
  let stdout = "";
  let detectFailed = false;
  try {
    await exec.exec("bundle", ["exec", "git", ...args], {
      env,
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
      },
    });
  } catch {
    detectFailed = true;
    core.setFailed("git fit geo detect failed — see runner log");
  }

  // ── Summary (detect block) ──
  let fileLines = "—";
  if (cacheEnabled) {
    generateSHA256SUMS(relDir);
    const fileSummary = summarizeFiles(relDir);
    fileLines = fileSummary
      .map((f) => `${f.name} (${f.lines.toLocaleString()} lines)`)
      .join(", ");
  }
  const summary = parseDetectSummary(stdout);

  core.summary.addRaw(
    buildSummaryBlock(
      "geo-detect",
      ["Status", "DB path", "Processed / Skipped / Errors", "AMap key", "Cache enabled", "Cache files"],
      [
        [
          detectFailed ? "failed" : "ok",
          inputs.dbPath,
          `${summary.processed} / ${summary.skipped} / ${summary.errors}`,
          inputs.amapKey ? "configured" : "missing (China coords fail)",
          cacheEnabled ? inputs.cacheDir : "no",
          fileLines || "—",
        ],
      ],
      ["center", "left", "center", "center", "left", "left"]
    )
  );
  await core.summary.write();

  // Even on detect failure, cache should still be saved (post) if cache files exist.
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
