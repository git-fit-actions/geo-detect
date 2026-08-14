# git-fit-actions/geo-detect

GitHub Action for detecting administrative divisions (省/市/区/乡镇) for
activities with GPS data, driving `git fit geo detect`. Write-once: **main**
restores the geo point cache and runs detection; **post** saves the cache at
the end of the job, only when the job succeeded (`post-if: success()`).

## How it works

1. **main**: validates inputs → restores the point cache
   (`data/cache/geo/` whole directory) → runs `bundle exec git fit geo detect`
   → writes a detect summary.
2. **post** (job end, on success): recomputes the cache content hash → saves
   the cache under a content-addressed key when it differs from what was
   restored → writes a cache summary.

Point cache lookups precede reverse geocoding, so a warm cache avoids network
calls entirely.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `db-path` | no | `data/db/git-fit.db` | SQLite database path |
| `cache-dir` | no | `data/cache/geo` | Geo cache directory (point files + `SHA256SUMS`). Empty string disables caching |
| `cache-key` | no | `GitFit-geo-v0` | Cache key namespace; content hash appended at save |
| `amap-key` | no | — | AMap API key for China coordinates. Missing → China coords fail (warned), intl uses Nominatim |
| `detect-limit` | no | `200` | Max activities to process |
| `detect-batch` | no | `20` | Batch size |
| `detect-strategy` | no | `proportional` | Sampling strategy (`proportional`\|`start_end`) |
| `detect-time` | no | `300` | Time budget in seconds |
| `checkpoint` | no | `false` | Run WAL checkpoint after detect |

## Cache key discipline

Follows the org-wide `GitFit-*-v0-*` convention:

```
<ns>-sentinel    restore exact key — never written, forces prefix fallback
<ns>-            restore-keys prefix — most recent wins
<ns>-<sha256>    save key — content-addressed by the point cache hash
```

## Usage

```yaml
steps:
  - uses: git-fit-actions/geo-detect@v1
    with:
      db-path: data/db/git-fit.db
      cache-dir: data/cache/geo
      amap-key: ${{ secrets.AMAP_API_KEY }}
```

Requires a Ruby environment with the `git-fit` gem installed (the action
shells out to `bundle exec git fit geo detect`).

There are **no outputs** — post steps cannot surface outputs downstream.
Status (detect + cache) is reported in the step summary.

## Development

```sh
npm ci
npm run typecheck
npm test        # builds dist then runs node --test
npm run build:check   # asserts dist is up to date
```

CI runs on push to `mainline` (default branch) and on tag push (`v*`): `check-dist` (dist
freshness), `test` (actionlint + unit tests), and `smoke` (real detection
against a throwaway DB with a pre-seeded point cache — network-free). `smoke`
runs against the latest git-fit release by default; trigger it manually with
`workflow_dispatch` and set `git-fit-version` to a specific constraint
(e.g. `~> 0.13.0`) to validate a pinned version. The step summary always
reports the exact git-fit version tested.

## License

MIT
