---
phase: 04-docker-testing
reviewed: 2026-06-27T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - Dockerfile
  - .dockerignore
  - scripts/verify_persistence.sh
  - scripts/start_mac.sh
  - scripts/stop_mac.sh
  - scripts/start_windows.ps1
  - scripts/stop_windows.ps1
  - backend/tests/test_main_api_coverage.py
  - backend/tests/test_llm_malformed.py
  - frontend/src/components/layout/Header.tsx
  - frontend/src/components/layout/ConnectionDot.tsx
  - frontend/src/components/watchlist/WatchlistRow.tsx
  - frontend/src/components/trade/TradeBar.tsx
  - frontend/src/components/portfolio/PositionsTable.tsx
  - frontend/src/components/chat/ChatPanel.tsx
  - frontend/src/components/chat/ChatMessage.tsx
  - test/package.json
  - test/playwright.config.ts
  - test/docker-compose.test.yml
  - test/README.md
  - test/e2e/01-fresh-start.spec.ts
  - test/e2e/02-buy.spec.ts
  - test/e2e/03-sell.spec.ts
  - test/e2e/04-chat.spec.ts
findings:
  critical: 0
  warning: 8
  info: 6
  total: 14
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-27
**Depth:** standard
**Files Reviewed:** 23 (24 in scope; `backend/.env.example` could not be read — see Coverage Gap)
**Status:** issues_found

## Summary

Phase 4 delivers the single-container product artifact (multi-stage Dockerfile), cross-platform launch/stop scripts, a persistence smoke test, backend test gap-fills, frontend `data-testid` hooks, and Playwright E2E infrastructure + four specs.

Overall the work is careful and well-documented. Security posture for secrets is good: `.dockerignore` correctly excludes `.env`/`.env.*` and re-includes `.env.example`; no secret is baked into any build ARG/ENV; `OPENROUTER_API_KEY` only arrives at runtime via `--env-file`; all frontend text renders through JSX (React auto-escape) with no `dangerouslySetInnerHTML`. The backend tests correctly exercise the assembled-app path and the LLM valid-JSON-wrong-schema fallback (verified against `app/llm.py:159-180`, which catches `Exception` broadly).

No BLOCKER-class defects (no injection, secret leakage, data-loss, or auth bypass) were found. The findings below are reproducibility, robustness, and test-determinism issues that should be fixed before this is treated as the canonical "one `docker run`" artifact.

**Coverage gap:** `backend/.env.example` is in scope but the review tooling was denied read access to it on this host. The secret-leakage concern for that file therefore could **not** be verified directly. It must be reviewed manually to confirm it contains only placeholder values (no real `OPENROUTER_API_KEY`/`MASSIVE_API_KEY`).

## Warnings

### WR-01: Dockerfile pulls `uv:latest` — non-reproducible build, contradicts its own comment

**File:** `Dockerfile:38-39`
**Issue:** The build copies the uv binary from `ghcr.io/astral-sh/uv:latest`. `:latest` is a floating tag: two builds of the same commit on different days can resolve different uv versions, which can change dependency-resolution behavior and silently break the "reproducible single-container" guarantee. The inline comment even says "pinned to the latest tag at build time", which is self-contradictory — `:latest` is the opposite of pinned. This undercuts the `uv sync --frozen` reproducibility intent stated at `Dockerfile:15-16`.
**Fix:**
```dockerfile
# Pin to a concrete uv release for reproducible builds
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /bin/
```
(Use whatever version is current/tested; the point is a fixed tag or digest, not `latest`.)

### WR-02: Runtime container runs as root — no non-root USER

**File:** `Dockerfile:57-87`
**Issue:** The runtime stage never creates or switches to a non-root user, so the process (and anything that compromises it) runs as UID 0 inside the container. This was an explicit focus item for the phase ("non-root user"). For a student-facing artifact that mounts a host-visible named volume at `/app/db`, root-owned DB files and unnecessary privilege are avoidable risk.
**Fix:**
```dockerfile
# after COPY steps and mkdir -p /app/db
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app/db
USER appuser
```
Ensure `/app/db` is writable by `appuser` so the lazy SQLite init still works against the mounted volume.

### WR-03: HEALTHCHECK `urlopen` has no timeout — probe can hang

**File:** `Dockerfile:84-85`
**Issue:** The healthcheck runs `urllib.request.urlopen('http://localhost:8000/api/health')` with no `timeout` argument. If the server accepts the connection but stalls before responding, `urlopen` blocks indefinitely; the only bound is Docker's `--timeout=5s`, after which Docker kills the probe and records a failure — workable, but relying on the outer kill is fragile and obscures the real failure mode. The same probe is duplicated in `test/docker-compose.test.yml:26` with the same omission.
**Fix:**
```dockerfile
CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=4).read()"
```

### WR-04: Launch scripts hard-require a `.env` file — fresh clone fails despite "works without API key"

**File:** `scripts/start_mac.sh:38`, `scripts/start_windows.ps1:39`
**Issue:** Both launchers pass `--env-file .env` unconditionally. `docker run --env-file .env` errors out (`open .env: no such file or directory`) when the file is absent. On a fresh clone the file does not exist (it is gitignored, only `.env.example` is committed), so the documented "single `docker run` to launch" / "app works without `OPENROUTER_API_KEY` (chat disabled)" promise (CLAUDE.md constraints) breaks for the most common first-run path. This is a functional regression for the primary demo flow.
**Fix (bash):**
```bash
ENV_ARGS=()
[ -f .env ] && ENV_ARGS+=(--env-file .env)
docker run -d --name "$CONTAINER_NAME" -p "$PORT:8000" "${ENV_ARGS[@]}" \
  -v "$VOLUME_NAME:/app/db" --restart unless-stopped "$IMAGE_NAME:latest"
```
**Fix (PowerShell):**
```powershell
$envArgs = if (Test-Path .env) { @('--env-file', '.env') } else { @() }
docker run -d --name $Container -p "$Port`:8000" @envArgs `
  -v "$Volume`:/app/db" --restart unless-stopped "$ImageName`:latest"
```

### WR-05: Idempotent restart silently ignores changed PORT / env on an existing container

**File:** `scripts/start_mac.sh:30-42`, `scripts/start_windows.ps1:30-43`
**Issue:** When the container already exists, both scripts call `docker start` only. `docker start` reuses the container's *original* port mapping, env-file values, and volume binding — it cannot apply a new `PORT`, an updated `.env`, or a rebuilt image. A user who edits `.env` (e.g. adds `OPENROUTER_API_KEY`) and re-runs the launcher will be silently served the stale container with chat still disabled, with no warning. The "idempotent" comment overstates what `docker start` guarantees.
**Fix:** Either document that config changes require `stop` + `docker rm finally-app` first, or detect a config-affecting change and recreate. Minimal safe improvement — warn explicitly:
```bash
echo "Note: reusing existing container $CONTAINER_NAME. PORT/.env changes require: docker rm -f $CONTAINER_NAME, then re-run."
```

### WR-06: E2E test compose bind-mounts the whole `test/` dir and runs `npm install` (not `npm ci`)

**File:** `test/docker-compose.test.yml:41-47`
**Issue:** Two coupled robustness problems:
1. The runner bind-mounts `./:/home/pwuser/test` (the host `test/` dir) and then runs `npm install`. This writes `node_modules/`, `package-lock.json` changes, `test-results/`, and `playwright-report/` back onto the host working tree, polluting it. Conversely, a pre-existing host `node_modules` (built for a different OS/arch) is mounted into the Linux container and can break the run. The pinned `package.json` exists specifically for determinism, but `npm install` may still drift the lockfile; `npm ci` is the deterministic counterpart and is what the Dockerfile correctly uses at line 28.
2. `npm install` on every run defeats layer caching and adds non-determinism the phase otherwise designed for.
**Fix:** Use `npm ci` for determinism, and isolate the mount or use an anonymous volume for `node_modules`:
```yaml
command: ["sh", "-c", "npm ci && npx playwright test --reporter=line"]
volumes:
  - ./:/home/pwuser/test
  - /home/pwuser/test/node_modules   # anonymous volume shadows host node_modules
```
(`npm ci` requires `package-lock.json` to be committed under `test/`; confirm it exists.)

### WR-07: Playwright runner image tag does not match the pinned client version

**File:** `test/docker-compose.test.yml:34` vs `test/package.json:9`
**Issue:** `package.json` pins `@playwright/test` to `1.61.1`, but the runner image is `mcr.microsoft.com/playwright:v1.61.0-noble` (1.61.**0**). Playwright requires the browser image and the `@playwright/test` package to be the *same* version; a mismatch produces a hard runtime error ("Executable doesn't exist… browser was installed for a different version") or subtle behavioral drift. The comment at line 33 acknowledges the tag "if unavailable" fallback but ships a known-mismatched pair.
**Fix:** Align both to the same version, e.g. set the image to `mcr.microsoft.com/playwright:v1.61.1-noble`, or pin the package to `1.61.0` to match the image — whichever tag actually exists in the registry.

### WR-08: Sell-spec quantity assertion uses `/\b1\b/` against the entire row text — false pass/fail risk

**File:** `test/e2e/03-sell.spec.ts:39-45`
**Issue:** After selling, the test asserts the remaining row text does **not** match `/\b1\b/`. But `row.textContent()` concatenates *every* cell: ticker, quantity, avg cost, price, P&L, % change. Any standalone "1" anywhere in that string — e.g. a price of `$1xx`? no (`151` has no word-boundary 1), but `$1.00`, a `+1.23%` change, an avg cost of `$1.50`, or `1` shares of a *different* unit — trips the regex. So the assertion can fail even when quantity is correctly reduced, or (less likely) pass spuriously. The test is checking quantity but reads the whole row, so it is not actually pinned to the Qty cell.
**Fix:** Target the quantity cell specifically rather than the whole row. Give the Qty `<td>` a testid (e.g. `position-qty-AAPL`) in `PositionsTable.tsx` and assert on that:
```ts
const qtyCell = page.getByTestId('position-qty-AAPL');
await expect(qtyCell).not.toHaveText('1');
```
Until a dedicated testid exists, scope to the nth cell rather than `textContent()` of the row.

## Info

### IN-01: `.env.example` could not be reviewed — confirm no real secrets

**File:** `backend/.env.example`
**Issue:** The file is in the review scope but read access was denied on this host, so its contents (placeholder vs. real key values) were not verified. Threat model T-04-01 hinges on this template carrying only documentation placeholders.
**Fix:** Manually confirm every value is a placeholder (e.g. `OPENROUTER_API_KEY=sk-or-...your-key-here`) and that no real credential was committed.

### IN-02: Persistence smoke test uses `eval()` on JSON-parsed data

**File:** `scripts/verify_persistence.sh:48-54`
**Issue:** `json_get` runs `eval(expr, {"_d": data})` where `expr` is a hardcoded literal (`_d["cash_balance"]`). Inputs are controlled by the script author, not external, so this is not an exploitable injection — but `eval` is a flagged pattern and a maintenance hazard if someone later passes a dynamic expression. The adjacent inline `python -c` blocks (lines 128-138, 172-182) already avoid `eval` by iterating explicitly; `json_get` could do the same.
**Fix:** Replace `eval` with explicit key access, e.g. accept a key name and do `print(data[sys.argv[2]])`, or keep the inline non-eval pattern used later in the same file for consistency.

### IN-03: `PositionsTable` casts `live` to number after a finiteness check that accepts `undefined` semantics loosely

**File:** `frontend/src/components/portfolio/PositionsTable.tsx:59-61`
**Issue:** `Number.isFinite(live)` returns `false` for `undefined`, so the fallback to `p.current_price` is correct. The subsequent `live as number` assertion is safe given the guard, but it relies on the reader trusting the guard rather than narrowing. `Header.tsx:37` does the same thing more explicitly (`typeof live === 'number' && Number.isFinite(live)`). Minor inconsistency, not a bug.
**Fix (optional, for consistency):**
```ts
const currentPrice = typeof live === 'number' && Number.isFinite(live) ? live : p.current_price;
```

### IN-04: Buy/Sell specs rely solely on cash-text changing, not on the expected direction/amount

**File:** `test/e2e/02-buy.spec.ts:31-33`, `test/e2e/03-sell.spec.ts:31-33`
**Issue:** Both specs assert cash `.not.toBe(preCashText)` — i.e. "cash changed", not "cash decreased by ~price" (buy) or "increased" (sell). Because live prices tick every ~500ms, the formatted total could change for reasons unrelated to the trade, so the assertion can pass without the trade itself being correct. The header-cash value, however, is cash_balance only (not mark-to-market), so it should be stable except on trades — making a directional assertion both feasible and stronger.
**Fix:** Parse the numeric cash value and assert direction (buy: after < before; sell: after > before), e.g. strip `$,` and compare `Number`. This catches a trade that no-ops or moves cash the wrong way.

### IN-05: Chat spec stubs `/api/chat` but the chip render path is the only thing actually proven

**File:** `test/e2e/04-chat.spec.ts:42-84`
**Issue:** The spec is honest about this (the header comment explains the stub does not mutate the DB), and the design is reasonable. Noting for traceability: because `/api/chat` is fully stubbed, this test exercises the frontend `TradeChip` render contract and the real buy path, but does **not** exercise the backend chat→trade execution path end-to-end. That path is covered by backend tests, so coverage exists — just not in this E2E. No change required; flagged so a future reader does not over-trust this spec as backend chat coverage.
**Fix:** None required. Optionally add a comment cross-referencing the backend chat-execution test that does cover the server path.

### IN-06: `.dockerignore` excludes `frontend/out` but not other Next.js caches; relies on stage isolation

**File:** `.dockerignore:17-20`
**Issue:** `node_modules` and `frontend/out` are excluded, but `.next/` (Next.js build cache) is not listed. The multi-stage build copies `frontend/` into the build stage (`Dockerfile:30`), so a stale host `.next/` would be copied into the build context and the image's build stage (it does not reach the runtime stage, so no image bloat, but it enlarges the build context and could mask cache issues). Low impact because `npm run build` regenerates it.
**Fix (optional):** Add `frontend/.next` (and `**/.next`) to `.dockerignore` to keep the build context lean and deterministic.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
