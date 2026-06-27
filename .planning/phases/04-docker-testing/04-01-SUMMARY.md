---
phase: 04-docker-testing
plan: 01
subsystem: docker
tags: [docker, build, persistence, volume, uv]
provides:
  - dockerfile-multi-stage-build
  - dockerignore-build-context
  - persistence-smoke-script
requires: []
affects:
  - DOCK-01
  - DOCK-02
tech-stack:
  added:
    - node:20-slim (frontend build stage)
    - python:3.12-slim (backend deps + runtime stage)
    - ghcr.io/astral-sh/uv:latest (uv binary in backend-build stage)
  patterns:
    - multi-stage Dockerfile with cache + bind mounts for uv sync
    - HEALTHCHECK via stdlib urllib (no curl in slim image)
    - dedicated test container / volume names (finally-persist-test / finally-persist-data)
    - portable python launcher (python3 with python fallback for Windows)
key-files:
  created:
    - Dockerfile
    - .dockerignore
    - scripts/verify_persistence.sh
  modified: []
decisions:
  - "Three-stage Dockerfile per 04-RESEARCH.md skeleton — stage 1 node:20-slim frontend, stage 2 python:3.12-slim uv deps, stage 3 python:3.12-slim runtime."
  - "uv sync --frozen (NOT --locked, NOT --extra dev, NOT pip) so httpx/pytest stay out of runtime (RESEARCH Pitfall 9)."
  - "NEXT_PUBLIC_API_BASE_URL never set in any stage so static export uses relative URLs (RESEARCH Pitfall 10)."
  - "No ARG/ENV holds a secret value — OPENROUTER_API_KEY only arrives at runtime via --env-file (threat model T-04-01)."
  - "HEALTHCHECK uses stdlib urllib because curl is not in python:3.12-slim and adding it would bloat the image."
  - "Persistence script uses dedicated names finally-persist-test / finally-persist-data so it never touches the real prod finally-app / finally-data."
  - "Persistence script removes the test volume ONLY after the PASS assertion, satisfying threat model T-04-02 (no premature volume rm)."
  - "Python launcher resolved via python3 with python fallback so the script runs on Windows hosts where 'python3' is the Microsoft Store shim."
metrics:
  duration: "~9 minutes (incl. docker build ~90s and end-to-end persistence run)"
  completed_date: 2026-06-27
  tasks_completed: 2
  files_created: 3
status: complete
---

# Phase 4 Plan 1: Single-container Dockerfile + persistence smoke (DOCK-01, DOCK-02) Summary

## What was built

A production-ready single-container build for FinAlly, comprising:

1. **`Dockerfile`** (87 lines, 3 stages) — frontend Node 20 build → backend Python 3.12 deps via uv → Python 3.12 runtime with uvicorn serving API + static export on `0.0.0.0:8000`. HEALTHCHECK probes `/api/health` via stdlib urllib.
2. **`.dockerignore`** (root) — excludes `.env` (with `.env.example` re-include), `.git`, `.claude`, `.planning`, `node_modules`, `.venv` + recursive variants, Python caches, `db/*.db` + WAL/SHM, `frontend/out`, test artefacts.
3. **`scripts/verify_persistence.sh`** (198 lines, bash) — DOCK-02 acceptance: build-if-missing → run detached → trade AAPL → capture state → `docker stop` → `docker start` → re-poll → assert cash + position survived → tear down.

## Verification

All plan-level verification commands executed and passed:

| Check | Command | Result |
|-------|---------|--------|
| Image builds | `docker build -t finally:latest .` | exit 0 (~90s, 25/25 stages) |
| Backend imports in image | `docker run --rm finally:latest python -c "import app.main"` | exit 0, prints `import OK` |
| Health endpoint serves 200 | `curl http://localhost:19000/api/health` (detached container) | HTTP 200, `{"status":"ok","chat_enabled":false}` |
| `.env` excluded | `docker run --rm finally:latest bash -c '[ -e .env ] && echo PRESENT \|\| echo ABSENT'` | ABSENT |
| `.git` excluded | same pattern | ABSENT |
| `node_modules` excluded | same pattern | ABSENT |
| `.planning` excluded | same pattern | ABSENT |
| `.claude` excluded | same pattern | ABSENT |
| `/app/static` present | `docker run --rm finally:latest [ -d /app/static ]` | PRESENT |
| `/app/static/index.html` present | same | PRESENT (Next.js export landed) |
| `/app/db` pre-created | `docker run --rm finally:latest [ -d /app/db ]` | PRESENT |
| Persistence survives stop/start | `PERSIST_TEST_PORT=18000 bash scripts/verify_persistence.sh` | **PASS** — cash 9429.98 and AAPL position 3.0 @ 190.0067 matched pre/post restart |

The persistence smoke proved the must_have truth: *"Portfolio/watchlist/cash data written to SQLite survives docker stop then docker start because the DB lives in the named volume at /app/db."*

## Acceptance criteria met

- [x] `docker build -t finally:latest .` exits 0
- [x] `docker run --rm finally:latest python -c "import app.main"` exits 0
- [x] A running container answers `GET /api/health` with HTTP 200 on port 8000
- [x] Portfolio/cash data survives stop/start via the named volume
- [x] The image does NOT contain `.env`, `.git`, `node_modules`, `.planning`, `.claude`
- [x] `.dockerignore` excludes `.env`, `frontend/out`, `node_modules`, `.venv`, `.git`, `.planning`
- [x] `bash -n scripts/verify_persistence.sh` exits 0 (script syntactically valid)
- [x] Script uses dedicated names `finally-persist-test` and `finally-persist-data`
- [x] Script does NOT `docker volume rm` before the persistence assertion runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `python3` is the Microsoft Store shim on this Windows host**
- **Found during:** Task 2 — first execution of `verify_persistence.sh` after Task 2 commit
- **Issue:** The persistence smoke script invoked `python3 -c '...'` for JSON parsing. On Windows, `python3` resolves to the App Execution Alias shim (`C:\Users\desor\AppData\Local\Microsoft\WindowsApps\python3`), which prints *"Python was not found; run without arguments to install from the Microsoft Store"* and exits non-zero. Real Python is exposed as `python`. The trade POST itself succeeded (cash 10000 → 9809.98), so the fix scope was the JSON parser only.
- **Fix:** Added a portable launcher at the top of the script — `command -v python3 && python3 -c 'pass'` → `PYTHON=python3`, else `PYTHON=python`, else fail with a clear install message. Replaced both `python3 -c` and `$(python3 -c ...)` call sites with `"$PYTHON" -c` / `$("$PYTHON" -c ...)`.
- **Files modified:** `scripts/verify_persistence.sh`
- **Commit:** `99e9949` — *fix(04-01): make verify_persistence.sh portable across Windows hosts*

**2. [Rule 1 - Bug] Python heredoc SyntaxError on f-string with escaped quotes**
- **Found during:** Task 2 — second execution of `verify_persistence.sh` after portability fix
- **Issue:** Inside a bash single-quoted heredoc, `f"{p[\"quantity\"]}"` reaches Python as a literal f-string containing `p[\"quantity\"]` — Python rejects backslashes inside f-string braces with `SyntaxError: unexpected character after line continuation character`.
- **Fix:** Replaced both position-extraction blocks with explicit string concatenation (`str(p["quantity"]) + "|" + str(p["avg_cost"])`). No f-strings, no escapes needed.
- **Files modified:** `scripts/verify_persistence.sh`
- **Commit:** `d861535` — *fix(04-01): avoid escaped quotes in python heredocs inside verify_persistence.sh*

After both fixes, the script runs end-to-end and prints `PASS: DOCK-02 persistence verified via named volume finally-persist-data`.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All four threats in the plan's `<threat_model>` (T-04-01 secret leakage, T-04-02 SIGTERM/volume lifecycle, T-04-03 root user, T-04-04 base image trust) and T-04-SC (uv/npm pinning) have mitigations present. `.dockerignore` excludes `.env` and re-includes only `.env.example` (T-04-01). Dockerfile sets no secret ENV/ARG. `verify_persistence.sh` uses `docker stop` (SIGTERM → FastAPI lifespan shutdown) and tears down the test volume only after the PASS assertion (T-04-02). `uv sync --frozen` pins to committed `uv.lock`; `npm ci` pins to committed `package-lock.json` (T-04-SC). Root-user and digest-pinning threats are accepted per the plan. |

## Notes for downstream plans

- **Phase 4 plans 2-6** (compose, E2E, browser verification) build on this image. The compose file in plan 2 should reuse the production `finally:latest` tag.
- **`STATIC_DIR` and `DB_PATH` are baked into the image** as defaults (`static` and `db/finally.db` respectively). Compose/E2E plans can override via env if needed but don't need to.
- **The HEALTHCHECK is the single source of truth** for "app is up" in the image. Compose healthchecks (plan 2/3) can reuse the same `/api/health` endpoint with shorter intervals for test orchestration.
- **`OPENROUTER_API_KEY` is intentionally not in the image.** Any chat-enabled run must pass it via `--env-file .env` at runtime; chat is disabled otherwise (`chat_enabled: false` in `/api/health`).
