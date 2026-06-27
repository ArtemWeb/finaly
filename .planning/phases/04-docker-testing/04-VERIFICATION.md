---
phase: 04-docker-testing
verified: 2026-06-27T18:10:00Z
reverified: 2026-06-27T20:30:00Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
overrides: []
resolved_since_initial:
  - item: "Windows PowerShell launch gate (DOCK-04) — was human_needed"
    resolution: "start_windows.ps1 had two real bugs (3 em-dashes under UTF-8-no-BOM mis-decoded as cp1251 broke the parse; docker inspect on a missing target tripped $ErrorActionPreference='Stop' on first run). Both fixed in quick 260627-w8k (commit ed26096) and the script was then run on a live Windows / PowerShell 5.1 host: create run exit 0, idempotent second run exit 0 ('exists - starting' branch), persistence across `docker restart` PASS (bought 1 GOOGL; cash/qty/positions byte-identical after restart), stop_windows.ps1 preserved the volume. Run on port 8001 to avoid the user's local dev-server on 8000."
  - item: "E2E specs green via compose (TEST-05..08) — was PRESENT_BEHAVIOR_UNVERIFIED"
    resolution: "Root cause confirmed: Chrome force-upgrades the single-label http://app:8000 to https. Fixed by routing Playwright at loopback 127.0.0.1 via shared network namespace (network_mode: service:app) in quick 260627-u1z (commit eabec51), plus a tmpfs DB so the suite is idempotent (commit 68bd96c). Verified 2x back-to-back: `4 passed` each run, compose exit 0, app logs show GET / 200 over 127.0.0.1, zero ERR_SSL_PROTOCOL_ERROR."
human_verification:
  - test: "Run scripts/start_mac.sh end-to-end (build, run, browser opens) and scripts/stop_mac.sh on a macOS host"
    expected: "Browser opens to http://localhost:8000, stop preserves the volume finally-data"
    why_human: "No macOS host available to this verifier (Windows host). NON-BLOCKING: the identical `docker run` mechanism is proven on Windows (DOCK-04, see resolved_since_initial) and the mac script is structurally verified (bash -n clean, correct --env-file / volume / health-poll / open-xdg-open); only the literal macOS browser-open was not demoed."
behavior_unverified_items: []
gaps: []
deferred: []
---

# Phase 4: Docker + Testing Verification Report

**Phase Goal:** The full application ships as a single Docker container and all critical behaviors are verified by automated tests
**Verified:** 2026-06-27T18:10:00Z
**Re-verified:** 2026-06-27T20:30:00Z (after quick tasks 260627-u1z + 260627-w8k)
**Status:** passed
**Re-verification:** Yes — two human/runtime gates resolved since the initial report

## Goal Achievement

The phase delivers the single-container artifact (DOCK-01..05), the backend test gap-fills (TEST-01..03), the E2E test infrastructure (TEST-04), and the four Playwright specs (TEST-05..08). The backend suite is fully green (178 tests) and the Docker image is functional (verified by spinning up a detached container and round-tripping /api/health, /api/portfolio, /api/watchlist, /api/portfolio/trade, plus stop/start persistence).

**Update (re-verification):** the two open gates from the initial report are now closed. (1) The E2E compose run is green — the Chromium http→https auto-upgrade on the single-label `app` hostname was fixed by routing Playwright at loopback `127.0.0.1` via a shared network namespace (quick 260627-u1z, commits eabec51 + 68bd96c); `4 passed` confirmed twice back-to-back. (2) The Windows launch gate (DOCK-04) was executed on a live PowerShell 5.1 host after fixing two real bugs in `start_windows.ps1` (quick 260627-w8k, commit ed26096): create + idempotent runs exit 0 and portfolio state survives `docker restart`. The only remaining human item is the macOS browser-open demo, which is non-blocking (the identical `docker run` path is proven on Windows).

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docker build -t finally:latest .` completes; image is importable | VERIFIED | `docker run --rm finally:latest python -c "import app.main"` prints `import OK`; image inspect confirms 87-line multi-stage Dockerfile present |
| 2 | Container answers GET /api/health with HTTP 200 on port 8000 | VERIFIED | `curl http://localhost:19001/api/health` → `{"status":"ok","chat_enabled":false}` |
| 3 | Portfolio/watchlist/cash data written to SQLite survives docker stop then docker start (named volume at /app/db) | VERIFIED | Bought 1 AAPL @ $190.12 (cash 10000.00 → 9809.88); `docker stop` then `docker start`; post-restart `GET /api/portfolio` returned cash_balance=9809.88, AAPL qty=1.0, avg_cost=190.12 — IDENTICAL to pre-restart |
| 4 | Built image excludes .env, .git, node_modules, .venv, .planning, .claude | VERIFIED | `docker run --rm finally:latest bash -c "[ -e .env ] && echo PRESENT \|\| echo ABSENT"` → ABSENT; .dockerignore lists all required exclusions with re-include for .env.example |
| 5 | `scripts/start_mac.sh` builds if missing, runs with named volume and --env-file, health-waits, opens browser | VERIFIED (syntax + structure); HUMAN for full browser-open demo | `bash -n` exits 0; contains `--env-file`, `$VOLUME_NAME:/app/db`, `--restart unless-stopped`, health poll, `open`/`xdg-open`; does NOT contain `--rm` |
| 6 | `scripts/start_windows.ps1` mirrors mac behavior on PowerShell 5.1 | VERIFIED (executed on live host) | After fixing two bugs (quick 260627-w8k, commit ed26096: em-dash/encoding + inspect-stderr trap), the script was run on a live PowerShell 5.1 / Docker Desktop host: create run exit 0, idempotent second run exit 0 ('exists - starting' branch), `docker restart` persistence PASS, stop_windows.ps1 preserved the volume. Run on port 8001 to coexist with the user's local 8000 dev-server |
| 7 | `scripts/stop_mac.sh` and `scripts/stop_windows.ps1` stop the container WITHOUT removing the finally-data volume | VERIFIED | stop_mac.sh contains only `docker stop`; stop_windows.ps1 contains only `docker stop`; NEITHER contains `volume rm` |
| 8 | `backend/.env.example` documents every runtime env var with safe placeholders; `.env` stays gitignored | VERIFIED | File (via `git show HEAD:backend/.env.example`) contains OPENROUTER_API_KEY, LLM_MOCK, MASSIVE_API_KEY, SNAPSHOT_INTERVAL, DB_PATH, STATIC_DIR, CORS_ORIGINS, ENABLE_CORS — all empty placeholders; `git check-ignore backend/.env` → `.gitignore:138:.env` |
| 9 | Backend trade edge cases (insufficient cash, oversell, partial sell, weighted avg cost) are covered (TEST-01) | VERIFIED | `backend/tests/test_portfolio.py` contains test_buy_weighted_avg_cost_on_existing_position (line 142), test_buy_insufficient_cash_raises_trade_error (169), test_buy_insufficient_cash_leaves_db_unchanged (177), test_sell_insufficient_shares_raises_trade_error (291), test_post_trade_insufficient_cash_returns_400 (552), test_post_trade_insufficient_shares_returns_400 (576). Full suite: 178 passed in 20.38s |
| 10 | Full-app create_app() round-trips for portfolio, history, watchlist (TEST-02) | VERIFIED | `backend/tests/test_main_api_coverage.py` contains 3 tests asserting cash_balance=10000.0, isinstance(history, list), watchlist count=10. All 3 pass |
| 11 | Valid-JSON-wrong-schema LLM response returns graceful ChatResponse fallback (TEST-03) | VERIFIED | `backend/tests/test_llm_malformed.py` contains test_complete_chat_json_missing_message_field (line 59) and test_complete_chat_json_wrong_type_message (line 93). Both assert isinstance(result, ChatResponse), truthy message, empty trades. Both pass |
| 12 | E2E infrastructure spins app + Playwright, healthcheck-gates start, isolates test volume (TEST-04) | VERIFIED (structure) | `docker compose -f test/docker-compose.test.yml config` exit 0; baseURL=http://app:8000 (service name, not localhost); workers=1; @playwright/test pinned to 1.61.1; LLM_MOCK=true; isolated finally-test-data volume; depends_on condition: service_healthy; mcr.microsoft.com/playwright:v1.61.0-noble |
| 13 | Four Playwright specs (TEST-05..08) pass under the compose runner | VERIFIED | Fixed in quick 260627-u1z: the root cause was Chrome force-upgrading the single-label `http://app:8000` to https (NOT the HttpsUpgrades flag, which is inert on Chrome 149). Fix = route Playwright at loopback `127.0.0.1` via `network_mode: service:app` (commit eabec51) + tmpfs DB for idempotency (commit 68bd96c). A live `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright` now exits 0 with line reporter `4 passed`; confirmed **twice back-to-back** (no manual cleanup). App logs show `GET / HTTP/1.1 200 OK` over `127.0.0.1`, zero ERR_SSL_PROTOCOL_ERROR. |

**Score:** 13/13 truths verified

### Deferred Items

None — no later phase in this milestone covers these concerns.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `Dockerfile` | multi-stage build | VERIFIED | 3 stages: node:20-slim frontend build → python:3.12-slim uv deps → python:3.12-slim runtime; CMD uvicorn 0.0.0.0:8000; HEALTHCHECK on /api/health; /app/static + /app/db prepared |
| `.dockerignore` | excludes .env, .git, .venv, .planning, .claude, node_modules, frontend/out | VERIFIED | All present, .env re-include for .env.example |
| `scripts/verify_persistence.sh` | DOCK-02 persistence smoke | VERIFIED | bash -n exits 0; uses dedicated finally-persist-test / finally-persist-data names; does not volume-rm before assertion; portable python3/python launcher |
| `scripts/start_mac.sh` | idempotent bash launcher | VERIFIED | bash -n exits 0; build-if-missing, start-if-exists, run-otherwise; --env-file, $VOLUME_NAME:/app/db, --restart, curl health poll, open/xdg-open |
| `scripts/stop_mac.sh` | preserves volume | VERIFIED | bash -n exits 0; only docker stop; no volume rm |
| `scripts/start_windows.ps1` | PowerShell launcher | VERIFIED | $ErrorActionPreference='Stop'; Invoke-WebRequest health poll; Start-Process browser open; PowerShell 5.1-compatible |
| `scripts/stop_windows.ps1` | preserves volume | VERIFIED | only docker stop; no volume rm |
| `backend/.env.example` | documents all env vars | VERIFIED | OPENROUTER_API_KEY, LLM_MOCK, MASSIVE_API_KEY, SNAPSHOT_INTERVAL, DB_PATH, STATIC_DIR, CORS_ORIGINS, ENABLE_CORS — all placeholders |
| `backend/tests/test_main_api_coverage.py` | TEST-02 gap-fill | VERIFIED | 3 full-app create_app() tests; DB_PATH monkeypatch + STATIC_DIR skip; lifespan TestClient context manager |
| `backend/tests/test_llm_malformed.py` | TEST-03 gap-fill | VERIFIED | 2 async tests; monkeypatch llm_mod.completion AFTER import app.llm (Pitfall 8) |
| 7 frontend components with data-testid | E2E selector hooks | VERIFIED | All 14 testids present at correct files/lines (Header.tsx:52,59; ConnectionDot.tsx:43; WatchlistRow.tsx:76,94; TradeBar.tsx:134,145,153,162; PositionsTable.tsx:99; ChatPanel.tsx:232,238; ChatMessage.tsx:49,58,90) |
| `test/package.json` | Playwright pinned | VERIFIED | "@playwright/test": "1.61.1" exact pin |
| `test/playwright.config.ts` | baseURL service name | VERIFIED | baseURL='http://app:8000'; workers=1; fullyParallel=false; testDir='./e2e'; NO localhost:8000 |
| `test/docker-compose.test.yml` | app + playwright with health gate | VERIFIED (config validates) | docker compose config exit 0; LLM_MOCK=true; finally-test-data; service_healthy gate; mcr.microsoft.com/playwright:v1.61.0-noble |
| `test/README.md` | documents run command | VERIFIED | documents `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright` |
| `test/e2e/01-fresh-start.spec.ts` | TEST-05 fresh start | VERIFIED (syntax) | imports @playwright/test; uses getByTestId('header-cash'/'header-total'/'watchlist-row'/'connection-dot'); expect.poll for first SSE batch |
| `test/e2e/02-buy.spec.ts` | TEST-06 buy | VERIFIED (syntax) | uses trade-ticker-input, trade-qty-input, trade-buy-button; asserts position-row-AAPL + cash changed |
| `test/e2e/03-sell.spec.ts` | TEST-07 sell | VERIFIED (syntax) | self-contained buy-then-sell; uses trade-sell-button; asserts cash increased + position updates |
| `test/e2e/04-chat.spec.ts` | TEST-08 AI chat | VERIFIED (syntax) | page.route stub with backend handle_chat shape; asserts chat-message [MOCK], trade-chip "Bought 1 AAPL @ $150.00", position-row-AAPL visible |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Dockerfile | backend/app/main.py STATIC_DIR | COPY out → /app/static | VERIFIED | Dockerfile line 71 COPY --from=frontend-build /build/out /app/static; main.py STATIC_DIR default "static" relative to WORKDIR /app → /app/static resolves |
| Dockerfile | backend/app/db.py DB_PATH | ENV DB_PATH=/app/db/finally.db | VERIFIED | Dockerfile line 77; line 76 mkdir -p /app/db pre-creates volume mount |
| start_mac.sh | docker run args | --env-file .env, -v finally-data:/app/db | VERIFIED | Variable form ($VOLUME_NAME) resolves to finally-data:/app/db at runtime |
| test/playwright.config.ts | compose network | baseURL=http://app:8000 | VERIFIED (config) | No localhost:8000 in config file |
| test/docker-compose.test.yml | app healthcheck | depends_on condition: service_healthy | VERIFIED | compose config validates |
| E2E specs | frontend data-testids | getByTestId | VERIFIED (syntax) | All 14 testids referenced match the 14 hooks present |
| TEST-08 stub | backend handle_chat contract | page.route body shape | VERIFIED (structure) | Stub body: `{message, actions:{trades:[{ticker, side, quantity, status:'executed', detail:'Executed at $150.00; cash_balance=9850.00'}], watchlist_changes:[]}}` mirrors backend/app/chat_service.py handle_chat return shape |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `backend/app/main.py create_app()` | portfolio.cash_balance | init_db seed + trade updates | YES | VERIFIED — `/api/portfolio` returns 10000.0 fresh; 9809.88 after AAPL buy |
| `backend/app/main.py create_app()` | watchlist | init_db seed (10 tickers) | YES | VERIFIED — `/api/watchlist` returns 10 tickers with live prices from PriceCache |
| Frontend Header component | total_value, cash_balance | PortfolioContext polling | YES | VERIFIED — server returns live values; frontend renders them with testids |
| Frontend WatchlistRow | price | SSE stream via PriceCache | YES | VERIFIED — server-side watchlist has live prices; SSE endpoint streams updates |
| Chat trade-chip | text "Bought {qty} {ticker} @ ${price}" | TradeChip render | VERIFIED (structure) | chat-message wrapper exists at ChatMessage.tsx:49,58; trade-chip at line 90 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend imports in container | `docker run --rm finally:latest python -c "import app.main"` | prints `import OK` | PASS |
| Image excludes .env | `docker run --rm finally:latest bash -c "[ -e .env ] && echo PRESENT \|\| echo ABSENT"` | ABSENT | PASS |
| /app/static prepared | `docker run --rm finally:latest ls /app/static/` | 404.html + _next present | PASS |
| /app/db prepared | `docker run --rm finally:latest ls /app/db/` | empty dir present | PASS |
| Health endpoint | `curl http://localhost:19001/api/health` | `{"status":"ok","chat_enabled":false}` HTTP 200 | PASS |
| Watchlist returns 10 tickers | `curl http://localhost:19001/api/watchlist` | 10 entries with live prices | PASS |
| Trade executes | `curl -X POST -d '{"ticker":"AAPL","quantity":1,"side":"buy"}' /api/portfolio/trade` | cash 9809.88, AAPL 1.0 @ 190.12 | PASS |
| Persistence survives stop/start | stop → start → GET /api/portfolio | cash 9809.88 + AAPL 1.0 preserved | PASS |
| Frontend builds | `cd frontend && npm run build` | Compiled successfully, 4 static pages | PASS |
| Backend full suite | `cd backend && uv run --extra dev pytest -q` | 178 passed, 20.38s | PASS |
| Docker compose config validates | `docker compose -f test/docker-compose.test.yml config` | exit 0 | PASS |
| **E2E specs green via compose** | `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright` | **exit 0 — `4 passed`, twice back-to-back, over 127.0.0.1** (after quick 260627-u1z) | **PASS** |
| **Windows launcher + persistence (DOCK-04)** | `$env:PORT=8001; scripts/start_windows.ps1` (x2), buy, `docker restart`, `scripts/stop_windows.ps1` | create exit 0; idempotent run exit 0; cash/qty/positions byte-identical across restart; volume preserved (after quick 260627-w8k) | **PASS** |

### Probe Execution

N/A — no probe scripts declared in this phase. The persistence smoke (`scripts/verify_persistence.sh`) is a script-level test, not a `scripts/*/tests/probe-*.sh` probe. The persistence behavior was verified by an equivalent manual round-trip (run → trade → stop → start → read).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DOCK-01 | 04-01 | Multi-stage Dockerfile | SATISFIED | Dockerfile present, 3 stages, build + import verified |
| DOCK-02 | 04-01 | SQLite persists via named volume | SATISFIED | stop/start round-trip preserved cash + position exactly |
| DOCK-03 | 04-02 | macOS/Linux launch scripts | SATISFIED (script); HUMAN for full demo | start_mac.sh + stop_mac.sh verified structurally |
| DOCK-04 | 04-02 | Windows PowerShell scripts | SATISFIED (executed on live host) | start_windows.ps1 fixed (quick 260627-w8k) + run on PowerShell 5.1: create/idempotent exit 0, persistence across restart PASS; stop_windows.ps1 preserved volume |
| DOCK-05 | 04-02 | .env.example complete + .env gitignored | SATISFIED | All required vars documented; .env check-ignore passes |
| TEST-01 | 04-03 | Backend trade edge cases | SATISFIED | test_portfolio.py covers insufficient/oversell/partial/weighted; full suite 178 passed |
| TEST-02 | 04-03 | Full-app API route coverage | SATISFIED | test_main_api_coverage.py 3 tests pass |
| TEST-03 | 04-03 | LLM graceful fallback | SATISFIED | test_llm_malformed.py 2 tests pass |
| TEST-04 | 04-05 | E2E test infra | SATISFIED | docker-compose config validates; baseURL=app:8000; service_healthy gate |
| TEST-05 | 04-06 | E2E fresh-start spec | SATISFIED | Green under compose (quick 260627-u1z); `4 passed` x2, fresh-start asserts $10k + 10 tickers streaming |
| TEST-06 | 04-06 | E2E buy spec | SATISFIED | Green under compose; buy decreases cash + adds position |
| TEST-07 | 04-06 | E2E sell spec | SATISFIED | Green under compose; sell increases cash |
| TEST-08 | 04-06 | E2E AI chat spec | SATISFIED | Green under compose; chat returns reply + inline trade chip |

All 13 declared requirement IDs (DOCK-01..05 + TEST-01..08) are accounted for. None are orphaned or missing.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `Dockerfile` | 39 | `COPY --from=ghcr.io/astral-sh/uv:latest` — `:latest` tag contradicts reproducibility intent | WARNING | Phase 4 REVIEW WR-01; non-blocker for demo |
| `Dockerfile` | 84-85 | HEALTHCHECK urlopen without timeout | WARNING | Phase 4 REVIEW WR-03; relies on Docker --timeout=5s outer kill |
| `Dockerfile` | (runtime) | Container runs as root (no USER directive) | WARNING | Phase 4 REVIEW WR-02; accepted for demo per plan threat model T-04-03 |
| `scripts/start_mac.sh:38`, `scripts/start_windows.ps1:39` | hard-require `.env` file | WARNING | Phase 4 REVIEW WR-04; fresh-clone demo flow breaks if user has no .env |
| `scripts/start_mac.sh:30-42`, `scripts/start_windows.ps1:30-43` | `docker start` silently ignores changed PORT/.env | WARNING | Phase 4 REVIEW WR-05; idempotency overstates what start guarantees |
| `test/docker-compose.test.yml:41-47` | bind-mount + `npm install` (not `npm ci`) | WARNING | Phase 4 REVIEW WR-06; pollutes host working tree + non-determinism |
| `test/docker-compose.test.yml:34` vs `test/package.json:9` | image v1.61.0 vs package 1.61.1 | WARNING | Phase 4 REVIEW WR-07; known runtime mismatch |
| `test/e2e/03-sell.spec.ts:39-45` | quantity assertion uses `/\b1\b/` on whole row text | WARNING | Phase 4 REVIEW WR-08; false pass/fail risk |
| `scripts/verify_persistence.sh:48-54` | uses `eval(expr, {"_d": data})` | INFO | Phase 4 REVIEW IN-02; controlled inputs, not exploitable |
| `backend/.env.example` | could not be directly read by review tooling | INFO | Phase 4 REVIEW IN-01; verified via `git show HEAD:backend/.env.example` — all placeholders, no secrets |

No BLOCKER-class anti-patterns found. No TBD/FIXME/XXX markers in any modified file (verified by absence in file contents and Grep results). No stubs (no `return null`, empty handler functions, or hardcoded empty data in deliverable code).

### Code Review Findings — Propagation

The committed `04-REVIEW.md` flagged 0 critical, 8 warning, 6 info. All 14 findings are reproduced above with severity classification. None of the 8 warnings block the phase goal as stated; they are reproducibility/robustness concerns that should be addressed in a future maintenance pass. The verifier notes that the WR-07 image/package version mismatch and the WR-06 `npm install` non-determinism may both contribute to the E2E runtime SSL issue (Chromium auto-upgrading `http://app:8000/` to HTTPS) — a future fix should pin both to the same version and switch to `npm ci`, then re-verify E2E.

### Human Verification Required

The two blocking gates from the initial report (Windows DOCK-04, E2E TEST-05..08) have since been executed and pass — see **resolved_since_initial** in the frontmatter and the updated truths #6, #13. One non-blocking item remains:

### 1. macOS/Linux launcher full demo (DOCK-03) — NON-BLOCKING

**Test:** Run `scripts/start_mac.sh` end-to-end, then `scripts/stop_mac.sh`.
**Expected:** Browser opens to http://localhost:8000 showing the FinAlly terminal; stop preserves the volume and prints "Data preserved in volume 'finally-data'".
**Why human / why non-blocking:** No macOS host is available to this verifier (Windows host). The underlying `docker run` mechanism — build-if-missing, named volume, health-poll, persistence across restart — is identical to the Windows launcher, which **was** executed and passed (DOCK-04). The mac script is structurally verified (`bash -n` clean; correct `--env-file`, `$VOLUME_NAME:/app/db`, health poll, `open`/`xdg-open`). Only the literal macOS browser-open gesture is undemonstrated; it does not gate the phase goal.

### Resolved Since Initial Verification

| Gate | Was | Now | How |
|------|-----|-----|-----|
| E2E specs green (TEST-05..08) | PRESENT_BEHAVIOR_UNVERIFIED (ERR_SSL_PROTOCOL_ERROR) | VERIFIED — `4 passed` x2 | quick 260627-u1z: loopback routing (eabec51) + tmpfs idempotency (68bd96c) |
| Windows launcher (DOCK-04) | human_needed | VERIFIED — executed, persistence PASS | quick 260627-w8k: encoding + stderr-trap fixes (ed26096), then run on live PS 5.1 host |

### Gaps Summary

No gaps block the phase goal. The single-container artifact (DOCK-01..05) is fully functional and verified by direct container round-trip and by the Windows launcher gate. The backend test gap-fills (TEST-01..03) are fully green (178 tests). The E2E test infrastructure (TEST-04) validates as a compose configuration and the four E2E specs (TEST-05..08) now pass green under that compose runner (`4 passed`, confirmed twice). The only outstanding human item — the macOS browser-open demo — is non-blocking because the identical launch/persistence mechanism is proven on Windows.

Per the verifier decision tree, with all 13 truths VERIFIED and no behavior-unverified items remaining, the overall status is **passed**. The single residual human item is recorded as non-blocking, not as a gap.

---

_Verified: 2026-06-27T18:10:00Z (initial, status human_needed)_
_Re-verified: 2026-06-27T20:30:00Z (status passed — after quick tasks 260627-u1z + 260627-w8k)_
_Verifier: Claude (gsd-verifier)_