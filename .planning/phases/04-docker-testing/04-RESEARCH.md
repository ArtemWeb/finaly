# Phase 4: Docker & Testing - Research

**Researched:** 2026-06-27
**Domain:** Container packaging (multi-stage uv + Node), cross-platform start/stop scripts, backend pytest completion, Playwright E2E in Docker
**Confidence:** MEDIUM-HIGH (project codebase fully understood; Docker/Playwright patterns sourced from official docs; some open question about exact image tag requires pinning)

## Summary

Phase 4 ships a single-container product. The codebase is mostly ready: a 2-stage Dockerfile does not exist yet, but all source code is committed (backend FastAPI, frontend Next.js static export already in `frontend/out/`, scripts/ empty). Backend unit tests already cover most of TEST-01/TEST-02/TEST-03; the planner's job is to **fill narrow gaps** (full create_app() coverage of watchlist/portfolio router, an explicit malformed-LLM-parse test, a happy-path LLM test asserting structured output fields) and **add E2E**. E2E requires test hooks (data-testid or stable aria-label) the frontend does not yet have — the planner must add them as part of TEST-04 wiring (DOCK/TEST wave 0), then write 4 Playwright specs against the running container.

The recommended approach: a two-stage Dockerfile (Node 20 builder → Python 3.12 runtime using `uv sync --frozen`), a named volume `finally-data` mounted at `/app/db`, idempotent start/stop scripts (bash + PowerShell) that pass `--env-file`, build if needed, detect already-running containers, and open the browser. E2E lives in `test/` and spins up the app container + an `mcr.microsoft.com/playwright` runner via `test/docker-compose.test.yml`; the app runs with `LLM_MOCK=true` so chat is deterministic.

**Primary recommendation:** Build the Docker artifact first (DOCK-01..05), then verify locally with one E2E run before committing the test suite — this de-risks the more expensive E2E loop.

## Project Constraints (from CLAUDE.md)

These directives come from the project's own `CLAUDE.md` files and are non-negotiable. Research must not contradict them, and plans must enforce them.

- **Single container** — one Docker image, one port (8000), no service orchestration. The runtime container is a multi-stage build that bundles both Node-built static files and Python-served FastAPI; the Playwright test container is *test infrastructure only* and is out of scope for the product image.
- **Python runtime: uv** — all dependency install steps use `uv sync`, not `pip`. `pyproject.toml` and `uv.lock` are committed; `--frozen` is the right flag (asserts lockfile is in sync, fails fast if drift).
- **Python 3.12** — base image must be `python:3.12-slim` (or `python:3.12-bookworm` for slightly broader binary compatibility with `numpy`/`pandas`-shaped deps; this project only uses `numpy`, so `slim` is sufficient).
- **Static Next.js export** — `output: 'export'` is already in `frontend/next.config.js`; the `npm run build` step produces `frontend/out/`. FastAPI's `STATIC_DIR` defaults to `static`; the Dockerfile must `COPY frontend/out /app/static` to match.
- **SQLite only, async** — `aiosqlite` is in `pyproject.toml`. DB lives at `db/finally.db` (controlled by `DB_PATH` env var, default `db/finally.db`; parent dir is auto-created by `app.db.get_db_path()`). In Docker the path must be `/app/db/finally.db`, with `/app/db` being the volume mount point.
- **OPENROUTER_API_KEY required for chat** — but `LLM_MOCK=true` short-circuits all LLM calls; this is the only configuration E2E may use.
- **No confirmation dialogs, instant fills** — already in frontend; E2E just needs to NOT wait for a modal that doesn't exist.
- **uvicorn port 8000, host 0.0.0.0** — `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`.
- **Backend Python conventions** (from backend/CLAUDE.md): snake_case, `__all__`, ABC for contracts, `@dataclass(frozen=True, slots=True)`, `pytest-asyncio` `asyncio_mode = "auto"`, ruff with the E/F/I/N/W ruleset, line-length 100, Python 3.12+.

## User Constraints

No `04-CONTEXT.md` exists. The user has NOT made any locked decisions for this phase. The planner therefore has Claude's discretion over all 13 requirements (DOCK-01..05, TEST-01..08), subject to the project CLAUDE.md constraints above. Recommendations below reflect what the established codebase already implies.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Frontend static build | Build-time (Node 20) | — | `npm run build` produces `frontend/out/` at image-build time, baked into the image, served by FastAPI at runtime. No runtime Node. |
| Backend API + SSE | Runtime (Python 3.12) | — | `uvicorn` runs FastAPI; all routes (`/api/*`) plus static mount at `/` for non-`/api` paths. |
| SQLite persistence | Runtime (Python, aiosqlite) | Host volume | `db/finally.db` lives in `/app/db` inside the container; a named Docker volume (`finally-data`) is mounted there so data survives `docker stop` + `docker start`. |
| AI chat (real path) | Runtime (Python, LiteLLM) | External (OpenRouter → Cerebras) | Real LLM call; not exercised in containerized E2E (mocked). |
| AI chat (mock path) | Runtime (Python, in-process) | — | `LLM_MOCK=true` makes `complete_chat` a pure-Python deterministic function. E2E MUST use this. |
| E2E browser tests | Separate test container | App container | The product image does NOT include Playwright. A second compose file (`test/docker-compose.test.yml`) spins up a sibling `mcr.microsoft.com/playwright` container that talks to the app container over the compose network. |
| Start/stop UX | Host machine | Container | `scripts/start_mac.sh` / `start_windows.ps1` wrap `docker run` / `docker start` and `open` the browser via OS shell. |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Docker Engine | 29.x (verified locally: 29.4.3) | Container runtime | [VERIFIED: local probe] `docker --version` returns `Docker version 29.4.3, build 055a478`; `docker compose version` returns `v5.1.3`. The project is single-host, so this is the only required runtime. |
| Docker Compose | v5.1.3 (verified) | Local multi-container for E2E | [VERIFIED: local probe] Compose is bundled with Docker Desktop; used only for `test/docker-compose.test.yml` (not for production deployment). |
| `python:3.12-slim` (base image) | 3.12-slim | Python runtime stage | [CITED: https://docs.astral.sh/uv/guides/integration/docker/] The uv docs use `python:3.12-slim` as the recommended base. Matches `requires-python = ">=3.12"` in `backend/pyproject.toml`. |
| `ghcr.io/astral-sh/uv` | latest (pulled at build time) | uv CLI in builder | [CITED: https://docs.astral.sh/uv/guides/integration/docker/] Official uv Docker integration guide: `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/`. |
| `node:20-slim` | 20-slim | Frontend builder | [CITED: Docker Hub node:20-slim] Specified by `DOCK-01`; supports Next.js 14 (`frontend/package.json` pins `"next": "14.2.32"`). |
| `uvicorn[standard]` | 0.32.0+ | ASGI server | [VERIFIED: backend/pyproject.toml] Already in dependencies; `uvicorn app.main:app --host 0.0.0.0 --port 8000` is the documented entry. |
| pytest | 8.3.0+ | Backend test runner | [VERIFIED: backend/pyproject.toml] `asyncio_mode = "auto"`, `httpx >= 0.27.0` in dev extras for `TestClient`. |
| @playwright/test | 1.61.1 (latest) | E2E browser tests | [VERIFIED: npm view @playwright/test version → 1.61.1] Latest as of 2026-06-27; pin in `test/package.json` so it matches the Docker image tag. |
| `mcr.microsoft.com/playwright` | 1.61.x (matches npm pkg) | Test runner container | [CITED: https://playwright.dev/docs/docker] Official Playwright docs: "Run the container: `docker run -it --rm --ipc=host mcr.microsoft.com/playwright:v1.61.0-noble /bin/bash`". Tag is `v<version>-noble` (Ubuntu 24.04 LTS base). Use `--ipc=host` to avoid Chromium shared-memory issues. |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `wait-on` (npm) | latest | Block tests until app is up | Optional in `test/docker-compose.test.yml`; `depends_on: condition: service_healthy` is preferred (Playwright container can `sleep` 5s as a fallback). |
| `httpx` (Python) | 0.27.0+ | `TestClient` for FastAPI | [VERIFIED: backend/pyproject.toml dev extras] Already in use; tests use `TestClient` from FastAPI which wraps `httpx`. |
| `pytest-asyncio` | 0.24.0+ | Async test support | [VERIFIED: backend/pyproject.toml] `asyncio_mode = "auto"`. |
| PowerShell 5+ | bundled with Windows 10/11 | Cross-platform start script | [VERIFIED: local probe] `powershell` available at `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell`. PowerShell Core (`pwsh`) is the recommended path but not installed on this host — the script must work on `powershell.exe` (Windows PowerShell 5.1). |
| Bash (git-bash or macOS/Linux) | — | Unix start script | Available via Git Bash on this host. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Multi-stage `python:3.12-slim` runtime | `python:3.12-bookworm` | Bookworm has slightly broader wheel support; `slim` is enough for `numpy` and `aiosqlite` (both ship manylinux wheels). Default to `slim` for image size. |
| `uv sync --frozen` | `uv sync --locked` | `--frozen` accepts the existing lockfile as-is; `--locked` *requires* it to be up-to-date. Both work for production builds, but `--frozen` is the right flag when the image is built from a known-good lockfile and you want a hard fail if the image is built without the lockfile. [CITED: https://docs.astral.sh/uv/reference/cli/#uv-sync] |
| `mcr.microsoft.com/playwright` Docker image | `npx playwright test` on host with `chromium` browsers installed | The containerized runner is hermetic (no host browser pollution, works in CI without `npx playwright install`). For this project, the container is the right call because `start_mac.sh` / `start_windows.ps1` are meant to work on a clean machine. |
| Single `docker run` for E2E | Compose file | Compose is the only sane way to spin up the app + a sibling test container with a healthcheck. |

**Installation (one-time per host, not in image):**
```bash
# Already present on this host (verified):
docker --version       # 29.4.3
docker compose version # 5.1.3
node --version         # v24.16.0
uv --version           # 0.11.16
```

**Version verification (already run):**
```bash
npm view @playwright/test version    # 1.61.1  (latest)
npm view playwright version          # 1.61.1
```

## Package Legitimacy Audit

> This phase installs **no new backend Python deps** (all are already in `backend/pyproject.toml`). It adds **two npm devDependencies** to a new `test/package.json` (Playwright + a type def), and uses **two Docker base images** (Node + Python) and **one Microsoft-published image** (`mcr.microsoft.com/playwright`).

| Package | Registry | Source | Verdict | Disposition |
|---------|----------|--------|---------|-------------|
| @playwright/test | npm | github.com/microsoft/playwright | OK | Approved (used inside test container, not in product image) |
| @types/node | npm | typescript-DefinitelyTyped | OK | Approved (test runner may need it; only if `test/` is TypeScript — JS-only is fine, drop this dep) |
| `ghcr.io/astral-sh/uv` | GHCR (OCI image) | astral-sh/uv | OK | Approved (official; copied via `COPY --from=` in builder stage) |
| `mcr.microsoft.com/playwright` | MCR (Microsoft Container Registry) | microsoft/playwright | OK | Approved (official; recommended by https://playwright.dev/docs/docker) |
| `python:3.12-slim` | Docker Hub | python/docker-library | OK | Approved |
| `node:20-slim` | Docker Hub | nodejs/docker-node | OK | Approved |

**Packages discovered via WebSearch / training data and verified:**
- `uv` integration: [VERIFIED: official docs] `https://docs.astral.sh/uv/guides/integration/docker/` provides the exact `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` line; this is the project's only source for the uv-in-Docker pattern.
- `mcr.microsoft.com/playwright`: [VERIFIED: official docs] `https://playwright.dev/docs/docker` confirms image name and `--ipc=host` flag.
- Next.js static export: [VERIFIED: official docs] `https://nextjs.org/docs/app/guides/static-exports` confirms `output: 'export'` produces an `out/` directory with HTML/CSS/JS assets.

**Packages removed due to SLOP verdict:** none (no candidates removed).

## Architecture Patterns

### System Architecture Diagram

```
  ┌────────────────────────┐
  │  scripts/start_mac.sh  │  (or start_windows.ps1)
  │  - docker build        │
  │  - docker run          │  ← volume mount ─────►  [finally-data]  (named volume, /app/db)
  │  - open browser        │
  └──────────┬─────────────┘
             │ port 8000, --env-file .env
             ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Container: finally-app  (single image)                  │
  │  ┌────────────────────┐  ┌──────────────────────────┐     │
  │  │  Node 20 builder   │  │  Python 3.12 runtime     │     │
  │  │  (transient)       │─▶│  - uvicorn app.main:app  │     │
  │  │  - npm ci           │  │  - /api/*                │     │
  │  │  - npm run build    │  │  - /api/stream/prices    │     │
  │  │  → frontend/out/    │  │  - /  (StaticFiles       │     │
  │  │                     │  │      from /app/static)   │     │
  │  │                     │  │  - DB: /app/db/finally.db│     │
  │  └────────────────────┘  └──────────────────────────┘     │
  └──────────────────────────────────────────────────────────┘

  ┌────────────────────────────┐
  │  test/docker-compose.test.yml (CI / local, NOT shipped)  │
  │                                                            │
  │  ┌──────────────────┐       ┌───────────────────────┐     │
  │  │  finally-test-app │       │  playwright           │     │
  │  │  (builds product) │──────▶│  mcr.microsoft.com/   │     │
  │  │  LLM_MOCK=true    │ :8000│  playwright:v1.61-nob │     │
  │  │  healthcheck curl │       │  npx playwright test  │     │
  │  └──────────────────┘       └───────────────────────┘     │
  │                  ▲                                          │
  │                  └─── shared compose network ───           │
  └────────────────────────────┘
```

### Recommended Repository Layout

```
finally/
├── Dockerfile                       # NEW (DOCK-01) — multi-stage: Node builder + Python runtime
├── .dockerignore                    # NEW — exclude node_modules, .venv, .git, etc.
├── .env.example                     # EXISTS (top-level, generic) — keep
├── backend/
│   ├── .env.example                 # EXISTS — keep; may need to merge with top-level
│   ├── pyproject.toml               # EXISTS
│   ├── uv.lock                      # EXISTS
│   ├── app/                         # EXISTS
│   │   ├── main.py
│   │   ├── db.py
│   │   ├── llm.py
│   │   ├── portfolio_service.py
│   │   ├── chat_service.py
│   │   └── routes/{portfolio,watchlist,chat}.py
│   ├── tests/                       # EXISTS — extend
│   │   ├── conftest.py
│   │   ├── test_db.py
│   │   ├── test_portfolio.py
│   │   ├── test_watchlist.py
│   │   ├── test_main.py
│   │   ├── test_chat_route.py
│   │   ├── test_chat_service.py
│   │   └── test_llm.py
│   └── .dockerignore                # NEW (backend-only; or use root)
├── frontend/                        # EXISTS — built into image
│   ├── next.config.js
│   ├── package.json
│   ├── package-lock.json
│   ├── src/                         # source
│   └── out/                         # gitignored build output
├── scripts/                         # NEW (DOCK-03, DOCK-04)
│   ├── start_mac.sh
│   ├── stop_mac.sh
│   ├── start_windows.ps1
│   └── stop_windows.ps1
└── test/                            # NEW (TEST-04) — E2E only
    ├── package.json                 # @playwright/test
    ├── playwright.config.ts
    ├── docker-compose.test.yml      # app + playwright runner
    ├── e2e/
    │   ├── 01-fresh-start.spec.ts
    │   ├── 02-buy.spec.ts
    │   ├── 03-sell.spec.ts
    │   └── 04-chat.spec.ts
    └── README.md
```

### Pattern 1: Multi-stage Dockerfile with uv

**What:** Two-stage build. Stage 1 (Node 20 slim) runs `npm ci && npm run build` to produce `frontend/out/`. Stage 2 (`python:3.12-slim`) is the runtime; it `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` once to get the uv CLI, runs `uv sync --frozen --no-dev` to install backend deps into a `.venv`, copies the prebuilt `out/` to `/app/static`, and runs uvicorn on port 8000.

**Why this pattern (citation):**
- [CITED: https://docs.astral.sh/uv/guides/integration/docker/] The uv docs' recommended pattern is: builder stage installs uv + the project into a `.venv`, runtime stage copies only `.venv` + source. We extend that with an *intermediate Node stage* to build the static frontend.
- [CITED: same] `--mount=type=cache,target=/root/.cache/uv` + `--mount=type=bind,source=uv.lock,target=uv.lock` keeps Docker layers small and rebuilds fast when only source code changes.
- [CITED: same] `uv sync --locked --no-install-project --no-editable` in the deps-only layer; full `uv sync --locked` after copying source. Use `--frozen` instead of `--locked` if you want the build to fail when the lockfile is out of date (this is the right flag for production images).

**Skeleton (the planner must refine):**
```dockerfile
# ---------- Stage 1: build frontend ----------
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # produces out/

# ---------- Stage 2: build backend deps ----------
FROM python:3.12-slim AS backend-build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_PYTHON_DOWNLOADS=0
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-editable

# ---------- Stage 3: runtime ----------
FROM python:3.12-slim
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=backend-build /app/.venv /app/.venv
COPY backend/ /app/
COPY --from=frontend-build /build/out /app/static
RUN mkdir -p /app/db
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Critical correctness notes:**
- `STATIC_DIR` env var defaults to `static` (see `backend/app/main.py:135`), so `/app/static` is the right destination.
- `DB_PATH` env var defaults to `db/finally.db` (see `backend/app/db.py:128`); relative to the process CWD which is `/app` in the container, this resolves to `/app/db/finally.db`. The volume must mount at `/app/db`.
- `app.db.get_db_path()` calls `os.makedirs(parent, exist_ok=True)`, so the `mkdir -p /app/db` in the Dockerfile is belt-and-braces; the volume mount will work even without it.
- `aiohttp`/`httpx`/`websockets`/`uvicorn[standard]` all ship manylinux wheels; no compiler needed. `numpy` ships manylinux wheels too; no `build-essential`.
- `python:3.12-slim` is Debian Bookworm-based; do **not** need `build-essential` for this project's deps.

### Pattern 2: Named volume for SQLite persistence

**What:** `docker run -v finally-data:/app/db ...`. `db/finally.db` lives at `/app/db/finally.db` inside the container; the volume's bind point is the parent directory.

**Why a named volume (not a bind mount):**
- Cross-host portable (no Windows path issues — a bind mount like `./db:/app/db` works on macOS/Linux but on Windows requires careful path translation; named volume avoids this).
- Docker manages the host path (`/var/lib/docker/volumes/finally-data/_data` on Linux, similar on macOS/Windows), which keeps the start/stop scripts OS-agnostic.
- A bind mount would expose the DB to the user as a regular file they could accidentally delete; a named volume hides the actual host location.

**Why not `:ro` or a tmpfs:**
- `:ro` would prevent the backend from writing.
- tmpfs loses data on container restart, which is the opposite of DOCK-02's goal.

### Pattern 3: Idempotent start/stop scripts

**What:** `start_mac.sh` and `start_windows.ps1`:
1. `docker image inspect finally:latest >/dev/null 2>&1` → if missing, `docker build -t finally:latest .`
2. `docker container inspect finally-app >/dev/null 2>&1`:
   - If running → `docker stop finally-app` first (idempotent: harmless if already stopped)
   - If exists but stopped → just `docker start`
   - If missing → `docker run -d --name finally-app -p 8000:8000 --env-file .env -v finally-data:/app/db --restart unless-stopped finally:latest`
3. Wait for `/api/health` to return 200 (poll with curl; timeout 30s).
4. Open browser: `open http://localhost:8000` (mac) / `xdg-open http://localhost:8000` (Linux) / `Start-Process http://localhost:8000` (Windows).

`stop_mac.sh` / `stop_windows.ps1`:
1. `docker stop finally-app` (no `-v`, **no volume removal**) — this is the DOCK-02 requirement.
2. Do NOT `docker rm` (would lose container metadata; not strictly needed).
3. Do NOT `docker volume rm finally-data` — that would destroy the DB. Optionally print "Data preserved in volume 'finally-data'".

**Browser-open cross-platform table (verified idioms):**

| OS | Command |
|----|---------|
| macOS | `open "http://localhost:8000"` |
| Linux | `xdg-open "http://localhost:8000"` (fallback: `xdg-open` may be missing; check `command -v xdg-open` first) |
| Windows PowerShell | `Start-Process "http://localhost:8000"` |

**Why idempotent:** the project's CLAUDE.md says "single `docker run` command launches" but also says students may stop/start repeatedly during the demo. An idempotent script means running it twice doesn't fail or double-bind the port.

### Pattern 4: Healthcheck in compose for E2E startup ordering

**What:** In `test/docker-compose.test.yml`:
```yaml
services:
  app:
    build: .
    environment:
      - LLM_MOCK=true
      - DB_PATH=/app/db/finally.db
    volumes:
      - finally-test-data:/app/db
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health').read()"]
      interval: 2s
      timeout: 3s
      retries: 30
  playwright:
    image: mcr.microsoft.com/playwright:v1.61.0-noble
    depends_on:
      app:
        condition: service_healthy
    working_dir: /home/pwuser/test
    volumes:
      - ./test:/home/pwuser/test
    command: npx playwright test --reporter=line
volumes:
  finally-test-data:
```

**Why this pattern:**
- `depends_on: condition: service_healthy` is the only way in compose v2 to wait for an app *and not just for it to be started* (which would race against uvicorn).
- The healthcheck polls `/api/health` (already exists, returns `{"status": "ok", "chat_enabled": true}` when `LLM_MOCK=true`).
- The Playwright container gets the test directory mounted in; `working_dir: /home/pwuser/test` matches the official image's default user. [CITED: https://playwright.dev/docs/docker]
- Volume `finally-test-data` is a SEPARATE volume from production `finally-data` so tests don't trample real data.

### Anti-Patterns to Avoid

- **Don't bind-mount the source tree into the runtime image.** A common anti-pattern is `COPY . .` in the runtime stage, which leaks `node_modules`, `.venv`, test files, and `.git` into the final image. Use a `.dockerignore` (see Don't Hand-Roll below) and copy only `backend/`.
- **Don't use `:latest` tags in compose for the app image.** The test compose should build the app from source (`build: .`) so the test always matches the current code.
- **Don't pass `--rm` to the production container.** Without `--rm`, the container sticks around after `docker stop`, so a follow-up `docker start` works (matches the "data persists across restarts" DOCK-02 goal). `--rm` would delete the container (but NOT the volume) on stop, which is technically OK for a single-user app but breaks the simple "start → stop → start" workflow the start/stop scripts implement.
- **Don't `docker volume rm` in `stop_*`.** That's the canonical way to lose user data; the script should be conservative.
- **Don't use `pip install` in the Dockerfile.** The project uses `uv` everywhere; the Dockerfile must too.
- **Don't put `OPENROUTER_API_KEY` in `docker run` as a literal arg** (visible in `docker inspect`). Use `--env-file .env` which is the documented secure pattern.
- **Don't have the E2E container run a long-lived command** — `command: npx playwright test` exits with the test result code, so the container's exit code reflects pass/fail.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| uv-in-Docker install | `apt-get install python3-pip && pip install uv` | `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` | [CITED: https://docs.astral.sh/uv/guides/integration/docker/] Official multi-arch image; works on amd64 + arm64. |
| Polling for browser availability | Custom `for i in {1..30}; do curl ...; done` in shell | Same pattern, but keep it inside a function in the start script (do not invent a binary or a Python waiter). The shell-level polling is fine and idiomatic; do not wrap it in a Python script. | |
| Healthcheck in compose | Custom `entrypoint.sh` that polls itself | compose's native `healthcheck:` + `depends_on: condition: service_healthy` | Compose v2 supports this natively; no custom code. |
| Container browser open | `xdg-open` from inside the container | OS-level `open` / `xdg-open` / `Start-Process` from the host | The browser is on the host, not in the container; the script runs on the host. |
| LLM mocking in tests | Hand-rolled stubs of `litellm.completion` | `LLM_MOCK=true` env var | `app.llm.build_mock_response` already exists and is tested (`backend/tests/test_llm.py:115`). Reuse it. |
| Static file serving | Custom FastAPI route returning `FileResponse` for each path | `app.mount("/", StaticFiles(directory=str(static_path), html=True))` | Already in `backend/app/main.py:207`; works for any directory tree. |
| Test database isolation | Resetting the real DB between tests | Per-test `tmp_path / "test_*.db"` + `monkeypatch.setenv("DB_PATH", ...)` | Pattern already used in 6 existing test files (see `test_portfolio.py`, `test_watchlist.py`, `test_chat_route.py`, etc.). |
| Playwright E2E browser | Manually install chromium on host | `mcr.microsoft.com/playwright:v1.61.0-noble` | [CITED: https://playwright.dev/docs/docker] Image ships all browsers; `--ipc=host` flag prevents shared-memory issues. |

**Key insight:** the project is intentionally minimal — there's already a working FastAPI app, an SSE layer, a chat layer, a chat service, a portfolio service, an LLM layer, a DB layer. The Docker phase is mostly *packaging + cross-cutting concerns*, not new business logic. Resist the urge to refactor.

## Runtime State Inventory

> This phase is **greenfield packaging**, not a rename/migration. There is no rename target and no existing runtime state to preserve. The only state in scope is the SQLite DB, which is **deliberately created by this phase** (the volume is new). The `.gitignore` already excludes `db/finally.db` (line 211), `*.db-journal`, `*.db-wal`, `*.db-shm` — the test must verify these exclusions are correct for the in-container case.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None (new volume `finally-data` will be created on first `docker run`) | None — greenfield |
| Live service config | None | None — greenfield |
| OS-registered state | None | None — greenfield |
| Secrets/env vars | `.env` is gitignored; `.env.example` files exist (top-level, backend, frontend). E2E must pass `LLM_MOCK=true` (no `OPENROUTER_API_KEY`); production user can opt-in. | Verify `.dockerignore` does NOT copy `.env` into the image; planner must add `.env` to `.dockerignore`. |
| Build artifacts | `frontend/out/` already exists on the host (from `npm run build`); the Dockerfile regenerates it from source. | No action; `out/` is gitignored (`frontend/.gitignore` should be checked). |

**Nothing found in category:** explicit "None" for all 5 categories — this is a packaging phase, not a refactor. If the user later wants to migrate data out of a non-Docker setup, that's a separate phase.

## Common Pitfalls

### Pitfall 1: Static dir path mismatch between Dockerfile and main.py
**What goes wrong:** Container builds and starts, but `GET /` returns 404 (the API routes work, the frontend index.html isn't found).
**Why it happens:** `backend/app/main.py:135` reads `STATIC_DIR` env var, default `"static"`. If the Dockerfile copies the frontend build to `/app/frontend/out` instead of `/app/static`, the static mount silently fails (with a `logger.warning` — see line 214).
**How to avoid:** COPY to `/app/static` exactly, OR set `ENV STATIC_DIR=/app/static` explicitly. The first is preferred (no env needed).
**Warning signs:** `WARN Static directory 'static' not found` in container logs.

### Pitfall 2: SQLite WAL files in the volume cause data corruption
**What goes wrong:** After a hard `docker kill` (not `docker stop`), the DB has lost some recent writes.
**Why it happens:** SQLite uses write-ahead logging (`-wal`, `-shm` files) and the `aiosqlite` connection may not have checkpointed. The volume contains `finally.db`, `finally.db-wal`, `finally.db-shm`; if the volume is mounted but the host path is on a different filesystem layer (overlay), the `rename()` SQLite uses for checkpointing can fail.
**How to avoid:** (a) Always `docker stop` (sends SIGTERM, lets lifespan shutdown run — see `backend/app/main.py:97-104` for the cleanup). (b) Document in `stop_*.sh` that `--rm` is intentionally NOT used. (c) Don't `kill -9` the container.
**Warning signs:** "database disk image is malformed" errors after restart.

### Pitfall 3: Playwright container can't reach the app on `localhost`
**What goes wrong:** All E2E tests time out trying to connect to `http://localhost:8000` from inside the Playwright container.
**Why it happens:** Two containers in the same compose network reach each other by **service name**, not `localhost`. The Playwright container hitting `http://localhost:8000` looks for a server on its own loopback, which is empty.
**How to avoid:** `playwright.config.ts` must set `baseURL: 'http://app:8000'` (where `app` is the compose service name). Do not use `localhost`.
**Warning signs:** `Error: connect ECONNREFUSED 127.0.0.1:8000` in Playwright output.

### Pitfall 4: SSE price events haven't arrived yet by the time E2E asserts "prices streaming"
**What goes wrong:** TEST-05 expects "10 tickers streaming", but the page only shows 4 with prices because the test assertion runs 200ms after page load and the simulator's first batch takes ~500ms.
**Why it happens:** `SimulatorDataSource` emits prices in waves; the first emit may take 500-1000ms.
**How to avoid:** The E2E spec should wait for `await expect.poll(() => page.locator('[data-testid=watchlist-row]').count()).toBe(10)` followed by a 3-second settle for the first SSE batch. Or use Playwright's `page.waitForResponse()` / `page.waitForFunction(() => hasPrice)`. **TEST-05 is the hard one** — TEST-06/07/08 don't depend on the simulator cadence.
**Warning signs:** Intermittent "expected 10 got 4" failures.

### Pitfall 5: Frontend lacks `data-testid` hooks for E2E selectors
**What goes wrong:** Playwright spec does `page.locator('text=Trade')` and finds 5 matches (or zero, if the label is rendered via a CSS class).
**Why it happens:** The frontend was built with `aria-label` and Tailwind class names, but no `data-testid` attributes. E2E needs stable selectors that don't change with copy.
**How to avoid:** **Add `data-testid` attributes** to: watchlist row, position row, trade bar ticker input, trade bar qty input, trade Buy button, trade Sell button, chat input, chat send button, cash display, total value display, each chat message bubble. This is a wave-0 step before any E2E spec is written.
**Warning signs:** E2E specs are flaky because the CSS class they target gets renamed.

### Pitfall 6: `LLM_MOCK=true` makes every chat reply identical
**What goes wrong:** TEST-08 says "AI chat returns a response with inline trade confirmation" but the mock response has empty `trades` and `watchlist_changes`.
**Why it happens:** `app.llm.build_mock_response` returns a fixed response with `trades=[]` and `watchlist_changes=[]` (see `backend/app/llm.py:115`). It's deterministic, but it doesn't *trade*.
**How to avoid:** TEST-08 must test the *end-to-end chat pipeline with a deterministic stub LLM*, not the default mock. There are two clean options:
  (a) Patch `app.chat_service.complete_chat` in a custom test-only fixture (this is what `test_chat_route.py:152-164` already does for unit tests; the E2E spec could intercept `/api/chat` at the network layer with Playwright's `page.route()`).
  (b) Add a new env var `LLM_MOCK_TRADE=1` (or `LLM_MOCK_BUY_AAPL=1`) that makes the mock return a trade. **Option (a) is the right call** — option (b) adds product code for test convenience, which is an anti-pattern. Use `page.route('**/api/chat', route => route.fulfill({ status: 200, body: JSON.stringify({ message: '[MOCK] bought', actions: { trades: [{ ticker: 'AAPL', side: 'buy', quantity: 1, status: 'executed', detail: 'Executed at $150.00' }], watchlist_changes: [] } }) }))`.
**Warning signs:** TEST-08 passes when it shouldn't, because the chat says "I received your message" with no trade chip.

### Pitfall 7: `--restart unless-stopped` in `docker run` re-starts the app after `docker stop`+`docker start` (correct), but `docker stop` followed by `docker start` preserves the volume (also correct); however a *rebuilt* image (new `docker build` + `docker run`) re-creates the container and the volume is still mounted, so the new container reads the old DB. This is actually desired behavior, not a pitfall — but the test must verify it (DOCK-02 acceptance).
**How to verify:** stop the container, run a manual SQL UPDATE on the volume, restart, see the update.

### Pitfall 8: Backend pytest fixture pollution between TEST-02 tests
**What goes wrong:** A test inserts a row into the DB; a later test sees it.
**Why it happens:** Tests that use the *full* `create_app()` (not isolated routers) share the `tmp_path / "test.db"` only if the fixture scopes it correctly. `test_main.py` does scope per-test, but a new test that forgets `monkeypatch.setenv("DB_PATH", ...)` will silently use the repo's real `db/finally.db`.
**How to avoid:** The new test files MUST `monkeypatch.setenv("DB_PATH", tmp_path / "test_*.db")` BEFORE `create_app()` is imported (or before any `db.connect()`). This is already a documented pattern (see `backend/tests/test_main.py:33-36`).
**Warning signs:** Test pollution in CI, flapping on first run after checkout.

### Pitfall 9: `uv sync --no-dev` in the production image — `httpx` (used by FastAPI TestClient) is in `[project.optional-dependencies] dev`
**What goes wrong:** If a future test is added that imports `app` from inside the running image, the import will fail because `httpx` isn't installed.
**Why it happens:** `httpx >= 0.27.0` is in `dev` extras, not the main dependency group. The Dockerfile uses `uv sync --frozen` (no `--extra dev`).
**How to avoid:** Don't add tests inside the runtime image. The TEST-* requirements are satisfied by `uv run --extra dev pytest` in the host env, not by anything inside the container. **Don't add a test stage to the production Dockerfile.**
**Warning signs:** "ModuleNotFoundError: httpx" inside the container.

### Pitfall 10: Frontend uses relative URLs (`apiUrl('')`), so in production it works, but in `next dev` mode it needs `NEXT_PUBLIC_API_BASE_URL`. The Docker image serves from FastAPI at `/`, so the static export must NOT hard-code `localhost:3000`.
**What it looks like in code:** `frontend/src/lib/api.ts:12` reads `process.env.NEXT_PUBLIC_API_BASE_URL`; if unset, returns `''` (relative). At `next build` time this is baked in. If you don't set the env var at build, the static export is correct for production. **If you do set it, set it to `''` or omit it.** Do not set it to `http://localhost:8000` in the Dockerfile.
**How to avoid:** In the Dockerfile's Node stage, do NOT pass `NEXT_PUBLIC_API_BASE_URL=...` as an env var. (The frontend will work either way, but explicitness prevents confusion.)

## Code Examples

Verified patterns from official sources:

### Dockerfile skeleton (multi-stage, uv-based)
```dockerfile
# Source: https://docs.astral.sh/uv/guides/integration/docker/

# ----- Stage 1: build frontend -----
FROM node:20-slim AS frontend-build
WORKDIR /build
# Pin to lockfile; `npm ci` is the right command (deterministic, no lockfile drift)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ----- Stage 2: install backend deps (uses uv from official image) -----
FROM python:3.12-slim AS backend-build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_PYTHON_DOWNLOADS=0
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-editable
COPY backend/ /app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-editable

# ----- Stage 3: runtime -----
FROM python:3.12-slim
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=backend-build /app/.venv /app/.venv
COPY --from=backend-build /app/app /app/app
COPY --from=frontend-build /build/out /app/static
RUN mkdir -p /app/db
ENV DB_PATH=/app/db/finally.db
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### .dockerignore (root of repo)
```
.git
.claude
.planning
node_modules
.venv
**/.venv
**/__pycache__
**/*.pyc
**/.pytest_cache
**/.ruff_cache
db/*.db
db/*.db-journal
db/*.db-wal
db/*.db-shm
frontend/out
.env
.env.*
!.env.example
test-results
playwright-report
```

### Start script (macOS / Linux) — idempotent
```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="finally"
CONTAINER_NAME="finally-app"
VOLUME_NAME="finally-data"
PORT="${PORT:-8000}"

# 1. Build image if missing
if ! docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
  echo "Building $IMAGE_NAME:latest..."
  docker build -t "$IMAGE_NAME:latest" .
fi

# 2. Start container (idempotent)
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Container $CONTAINER_NAME exists — starting if stopped..."
  docker start "$CONTAINER_NAME" >/dev/null
else
  echo "Creating and starting $CONTAINER_NAME..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:8000" \
    --env-file .env \
    -v "$VOLUME_NAME:/app/db" \
    --restart unless-stopped \
    "$IMAGE_NAME:latest"
fi

# 3. Wait for /api/health (poll up to 30s)
echo "Waiting for app to be ready..."
for i in {1..30}; do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "App is ready."
    break
  fi
  sleep 1
done

# 4. Open browser
URL="http://localhost:$PORT"
if command -v open >/dev/null; then
  open "$URL"
elif command -v xdg-open >/dev/null; then
  xdg-open "$URL"
else
  echo "Open $URL in your browser."
fi
```

### Stop script (macOS / Linux) — does NOT remove the volume
```bash
#!/usr/bin/env bash
set -euo pipefail
CONTAINER_NAME="finally-app"
VOLUME_NAME="finally-data"
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker stop "$CONTAINER_NAME"
  echo "Stopped $CONTAINER_NAME. Data preserved in volume '$VOLUME_NAME'."
else
  echo "Container $CONTAINER_NAME is not running."
fi
```

### Windows PowerShell start script
```powershell
# scripts/start_windows.ps1
$ErrorActionPreference = 'Stop'
$ImageName   = 'finally'
$Container   = 'finally-app'
$Volume      = 'finally-data'
$Port        = if ($env:PORT) { $env:PORT } else { 8000 }

# 1. Build if missing
$img = docker image inspect "$ImageName`:latest" 2>$null
if (-not $img) {
  Write-Host "Building $ImageName`:latest..."
  docker build -t "$ImageName`:latest" .
}

# 2. Start (idempotent)
$exists = docker container inspect "$Container" 2>$null
if ($exists) {
  Write-Host "Container $Container exists — starting if stopped..."
  docker start "$Container" | Out-Null
} else {
  Write-Host "Creating and starting $Container..."
  docker run -d `
    --name "$Container" `
    -p "$Port`:8000" `
    --env-file .env `
    -v "$Volume`:/app/db" `
    --restart unless-stopped `
    "$ImageName`:latest"
}

# 3. Wait for /api/health
Write-Host "Waiting for app to be ready..."
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { Write-Host "App is ready."; break }
  } catch { Start-Sleep -Seconds 1 }
}

# 4. Open browser
Start-Process "http://localhost:$Port"
```

### Windows PowerShell stop script
```powershell
# scripts/stop_windows.ps1
$ErrorActionPreference = 'Stop'
$Container = 'finally-app'
$Volume    = 'finally-data'
$exists = docker container inspect "$Container" 2>$null
if ($exists) {
  docker stop "$Container" | Out-Null
  Write-Host "Stopped $Container. Data preserved in volume '$Volume'."
} else {
  Write-Host "Container $Container is not running."
}
```

### Playwright config (TypeScript, ESM)
```ts
// test/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,  // single shared DB
  workers: 1,            // avoid port contention / DB race
  reporter: 'line',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://app:8000',  // compose service name
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

### Playwright spec example (TEST-05: fresh start)
```ts
// test/e2e/01-fresh-start.spec.ts
import { test, expect } from '@playwright/test';

test('fresh start shows $10k cash and 10 tickers', async ({ page }) => {
  await page.goto('/');
  // Cash display
  await expect(page.getByTestId('header-cash')).toContainText('$10,000');
  // Total value
  await expect(page.getByTestId('header-total')).toContainText('$10,000');
  // 10 watchlist rows
  await expect(page.getByTestId('watchlist-row')).toHaveCount(10);
  // Connection dot eventually turns blue (SSE open)
  await expect(page.getByTestId('connection-dot')).toHaveAttribute('aria-label', /streaming/i, { timeout: 10_000 });
  // At least one ticker has a live price
  await expect.poll(async () => {
    return await page.locator('[data-testid=watchlist-row] [data-testid=price]').filter({ hasText: /\$/ }).count();
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
});
```

### Playwright spec example (TEST-08: AI chat with deterministic stub)
```ts
// test/e2e/04-chat.spec.ts
import { test, expect } from '@playwright/test';

test('AI chat returns a response with inline trade confirmation', async ({ page }) => {
  // Stub /api/chat to return a deterministic trade (Pitfall 6)
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: '[MOCK] Buying 1 share of AAPL',
        actions: {
          trades: [{
            ticker: 'AAPL', side: 'buy', quantity: 1,
            status: 'executed', detail: 'Executed at $150.00; cash_balance=9850.00',
          }],
          watchlist_changes: [],
        },
      }),
    });
  });

  await page.goto('/');
  // Wait for chat to be enabled (healthcheck probed)
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('chat-input').fill('buy 1 AAPL');
  await page.getByTestId('chat-send').click();
  // Assistant bubble contains [MOCK]
  await expect(page.locator('[data-testid=chat-message]').last()).toContainText('[MOCK]');
  // Trade chip shows executed
  await expect(page.getByTestId('trade-chip')).toContainText('Bought 1 AAPL @ $150.00');
  // Portfolio reflects new AAPL position
  await expect(page.getByTestId('position-row-AAPL')).toBeVisible();
});
```

### Backend test gap-fill example (TEST-03: malformed LLM response)
```python
# backend/tests/test_llm_malformed.py
# Gap: test_llm.py covers invalid JSON (line 198) and network error (line 226),
# but not "valid JSON, wrong schema" (e.g. {"foo": "bar"} or {"message": 123}).
# Add 2-3 tests here.

import pytest

@pytest.mark.asyncio
async def test_complete_chat_json_missing_required_field(monkeypatch):
    """LLM returns valid JSON but missing the 'message' field — graceful fallback."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    import app.llm as llm_mod
    class _M:
        content = '{"trades": []}'  # missing 'message'
    class _C:
        message = _M()
    class _R:
        choices = [_C()]
    monkeypatch.setattr(llm_mod, "completion", lambda *a, **k: _R())
    from app.llm import complete_chat, ChatResponse
    r = await complete_chat([{"role": "user", "content": "hi"}])
    assert isinstance(r, ChatResponse)
    assert r.message  # graceful fallback
    assert r.trades == []

@pytest.mark.asyncio
async def test_complete_chat_json_wrong_type(monkeypatch):
    """LLM returns valid JSON but 'message' is a number — graceful fallback."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    import app.llm as llm_mod
    class _M:
        content = '{"message": 12345, "trades": []}'
    class _C:
        message = _M()
    class _R:
        choices = [_C()]
    monkeypatch.setattr(llm_mod, "completion", lambda *a, **k: _R())
    from app.llm import complete_chat, ChatResponse
    r = await complete_chat([{"role": "user", "content": "hi"}])
    assert isinstance(r, ChatResponse)
    assert r.message  # graceful fallback
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next export` CLI | `next build` with `"output": "export"` in config | Next.js 14.0 (2023-10) | Already in this project; verified working. |
| `pip install -r requirements.txt` in Docker | `uv sync --frozen` | uv 0.4+ (2024-08) | 10-100x faster install; deterministic from `uv.lock`. |
| `depends_on: app` (just waits for "started") | `depends_on: condition: service_healthy` | Compose v2.3+ (2021-12) | Solves the "uvicorn isn't ready" race. |
| Playwright as Node dep on host | `mcr.microsoft.com/playwright` Docker image | Official since 2021 | Zero host pollution; ideal for CI. |
| Bind mount for SQLite | Named volume | Docker native (always) | Cross-host portable; no Windows path issues. |
| Manual SSE polling in frontend | Native `EventSource` with auto-reconnect via `retry:` | Always current | Already in `frontend/src/hooks/useSse.ts`. |
| `pip install` for httpx in production image | `uv sync` (no dev extras in image) | Project decision (locked) | Image stays small; test deps don't leak. |

**Deprecated/outdated:**
- `next export` CLI: removed in Next.js 14. Project already uses `output: 'export'`. No action.
- Manual SSE polling: not used. No action.
- `pip install`: not used. No action.

## Environment Availability

> All required host tools are already installed on the dev host (verified 2026-06-27). E2E containers download their own browsers at first run.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | DOCK-01..05, TEST-04 | ✓ | 29.4.3 | — |
| Docker Compose | TEST-04 | ✓ | v5.1.3 (bundled with Docker Desktop) | — |
| Node.js (for `npm run build` in `frontend/`) | DOCK-01 (host-side dev cycle) | ✓ | 24.16.0 | — |
| npm | DOCK-01 | ✓ | 11.13.0 | — |
| uv | Backend dev workflow; DOCKER builder (via image) | ✓ | 0.11.16 | — |
| PowerShell 5+ | DOCK-04 (Windows) | ✓ | 5.1 (built-in) | pwsh 7+ if installed |
| Bash | DOCK-03 (mac/Linux) | ✓ | git-bash on this host; native on mac | — |
| Python 3.12 | Backend dev (uv manages) | ✓ | uv-managed | — |

**Missing dependencies with no fallback:** none — the test container image (`mcr.microsoft.com/playwright`) ships its own browsers.

**Missing dependencies with fallback:** none.

**Network access at first run:**
- `docker build` will pull `python:3.12-slim`, `node:20-slim`, `ghcr.io/astral-sh/uv:latest` (~150 MB total).
- First `docker compose -f test/docker-compose.test.yml up` will pull `mcr.microsoft.com/playwright:v1.61.0-noble` (~2 GB with browsers).
- Subsequent runs are cache hits.

## Validation Architecture

> `nyquist_validation: true` in `.planning/config.json` (line 14). Sampling rate: per-task commit for unit tests, per-wave merge for full backend suite, phase-gate for E2E.

### Test Framework

| Property | Value |
|----------|-------|
| Backend framework | pytest 8.3.0+, pytest-asyncio (asyncio_mode="auto"), httpx (TestClient via FastAPI), pytest-cov |
| Backend config | `backend/pyproject.toml` `[tool.pytest.ini_options]` |
| Backend quick command | `cd backend && uv run --extra dev pytest -q` |
| Backend full command | `cd backend && uv run --extra dev pytest --cov=app` |
| Backend lint | `cd backend && uv run --extra dev ruff check app/ tests/` |
| E2E framework | @playwright/test 1.61.1 |
| E2E config | `test/playwright.config.ts` |
| E2E command (local) | `cd test && npm install && npx playwright test` (requires app running on `localhost:8000`) |
| E2E command (compose) | `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright` |
| E2E browsers | Inside the `mcr.microsoft.com/playwright` image |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOCK-01 | Multi-stage build produces a working image | manual + smoke | `docker run --rm finally:latest python -c "import app.main"` + `curl /api/health` | ❌ Wave 0 (smoke script) |
| DOCK-02 | DB persists across `docker stop` + `docker start` | manual + smoke | bash script in `scripts/verify_persistence.sh` (writes trade, stops, starts, reads back) | ❌ Wave 0 |
| DOCK-03 | start/stop_mac.sh idempotent, opens browser | manual | n/a (shell-level) | ❌ Wave 0 (new file) |
| DOCK-04 | start/stop_windows.ps1 idempotent, opens browser | manual | n/a (shell-level) | ❌ Wave 0 (new file) |
| DOCK-05 | .env.example complete, .env gitignored | lint-style | `grep -E '^(OPENROUTER_API_KEY\|LLM_MOCK\|MASSIVE_API_KEY)' backend/.env.example` | ❌ Wave 0 (audit + update) |
| TEST-01 | Trade edge cases: insufficient cash, sell more than owned, partial sell, weighted avg cost | unit | `uv run --extra dev pytest tests/test_portfolio.py -k "insufficient or partial or weighted"` | ✅ exists; full coverage (see `test_portfolio.py:167-340`) |
| TEST-02 | All API routes: status codes, response shapes, errors | unit | `uv run --extra dev pytest tests/test_watchlist.py tests/test_portfolio.py tests/test_chat_route.py tests/test_main.py` | ✅ mostly; **gap**: `test_main.py` does not exercise `GET /api/watchlist` or `GET /api/portfolio` end-to-end through the full app — only the watchlist test does. Add 2 tests to `test_main.py` (GET portfolio, GET history). |
| TEST-03 | LLM structured output, malformed responses, mock mode | unit | `uv run --extra dev pytest tests/test_llm.py` | ✅ mock + happy path; **gap**: no test for "valid JSON, wrong schema" (see Pitfall 6 + Code Example above). Add 1-2 tests. |
| TEST-04 | docker-compose.test.yml + Playwright container | integration | `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit` | ❌ Wave 0 (new file) |
| TEST-05 | E2E: fresh start shows $10k + 10 tickers streaming | e2e | `npx playwright test e2e/01-fresh-start.spec.ts` | ❌ Wave 0 (new spec) |
| TEST-06 | E2E: buy → cash decreases, position appears, heatmap updates | e2e | `npx playwright test e2e/02-buy.spec.ts` | ❌ Wave 0 (new spec) |
| TEST-07 | E2E: sell → cash increases, position updates | e2e | `npx playwright test e2e/03-sell.spec.ts` | ❌ Wave 0 (new spec) |
| TEST-08 | E2E: AI chat returns response with inline trade confirmation | e2e | `npx playwright test e2e/04-chat.spec.ts` | ❌ Wave 0 (new spec, with `page.route()` stub per Pitfall 6) |

### Sampling Rate
- **Per task commit:** `cd backend && uv run --extra dev pytest -q` (unit, <5s)
- **Per wave merge:** `cd backend && uv run --extra dev pytest --cov=app` (full backend, <30s)
- **Per PR to main:** full backend + `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright` (E2E, ~3-5 min first run, <1 min cached)
- **Phase gate:** all of the above green + manual `scripts/start_*.sh` + `scripts/stop_*.sh` smoke run

### Wave 0 Gaps

The following must be created before any test work can be planned:

- [ ] `Dockerfile` (DOCK-01) — multi-stage per Pattern 1
- [ ] `.dockerignore` (root) — excludes `.venv`, `node_modules`, `.git`, `.env`, etc.
- [ ] `scripts/start_mac.sh`, `scripts/stop_mac.sh` (DOCK-03)
- [ ] `scripts/start_windows.ps1`, `scripts/stop_windows.ps1` (DOCK-04)
- [ ] `backend/.env.example` updated to document `OPENROUTER_API_KEY`, `LLM_MOCK`, `MASSIVE_API_KEY`, `SNAPSHOT_INTERVAL` (DOCK-05 — may already be done; verify)
- [ ] `test/package.json` with `@playwright/test` 1.61.1 (TEST-04)
- [ ] `test/playwright.config.ts` (TEST-04)
- [ ] `test/docker-compose.test.yml` (TEST-04)
- [ ] `test/e2e/0{1,2,3,4}-*.spec.ts` (TEST-05..08)
- [ ] **Frontend test hooks** (Pitfall 5): add `data-testid` attributes to `Header`, `WatchlistRow`, `TradeBar`, `ChatPanel`, `ChatMessage`, `PositionsTable`, `ConnectionDot` — at minimum: `header-total`, `header-cash`, `connection-dot`, `watchlist-row`, `position-row-{ticker}`, `trade-ticker-input`, `trade-qty-input`, `trade-buy-button`, `trade-sell-button`, `chat-input`, `chat-send`, `chat-message`, `trade-chip`
- [ ] `backend/tests/test_llm_malformed.py` (TEST-03 gap-fill; 1-2 tests, see Code Example)
- [ ] `backend/tests/test_main_api_coverage.py` (TEST-02 gap-fill; add 2-3 tests: full-app `GET /api/portfolio`, `GET /api/portfolio/history`, `GET /api/watchlist` round-trips)

*(If no gaps: N/A — there are 10+ Wave 0 items above.)*

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json` (lines 22-23). All ASVS level-1 controls must be verified.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control | Already in place? |
|---------------|---------|------------------|------------------|
| V1 Architecture | yes | Single host, single port, single process; no network segmentation needed | ✅ (project constraint) |
| V2 Authentication | no (out of scope per REQUIREMENTS.md) | n/a | n/a |
| V3 Session Management | no (out of scope; no auth) | n/a | n/a |
| V4 Access Control | no (out of scope) | n/a | n/a |
| V5 Input Validation | yes | Pydantic models at the boundary | ✅ (`TradeRequest`, `WatchlistAddRequest`, `ChatRequest` all use Pydantic) |
| V6 Cryptography | partial | `.env` for `OPENROUTER_API_KEY`; never baked into image | ✅ via `--env-file` (no `ARG`/`ENV` for secrets) |
| V7 Error Handling | yes | FastAPI `HTTPException(400, detail=...)` for client errors; no stack traces in prod | ✅ (no `debug=True`); already verified in `test_portfolio.py:552-590` |
| V8 Data Protection | yes | SQLite file in a Docker volume (not a tmpfs) | ✅ via DOCK-02 |
| V9 Communication | yes | Single-container means no internal network to secure; only localhost:8000 exposed | ✅ (single port) |
| V10 Malicious Code | yes | Pinned base images (`python:3.12-slim`, `node:20-slim`); `--mount=type=cache` for uv | ✅ (image digests in compose pinning is "nice to have", not ASVS-1) |
| V11 Business Logic | yes | Trade validation (insufficient cash, shares) | ✅ (see `portfolio_service.py:79-86`) |
| V12 Files and Resources | no | No file upload; LLM only | n/a |
| V13 API and Web Service | partial | No CSRF (no auth); no rate limiting needed for single-user demo | n/a |
| V14 Configuration | yes | `.env.example` complete; `.env` gitignored; secrets not in Dockerfile | ✅ via `.gitignore:138` and DOCK-05 |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation | Already in place? |
|---------|--------|---------------------|------------------|
| LLM prompt injection (crafted user message could instruct trade) | Tampering | LLM output is parsed by Pydantic into `TradeAction` with strict types; trades still go through `execute_trade` validation (insufficient cash, etc.) | ✅ (`app.llm.ChatResponse` + `portfolio_service.execute_trade` validation) |
| Trade amount overflow | Tampering | `TradeAction.quantity: float = Field(gt=0, lt=1e9)` (see `app/llm.py:62`) | ✅ |
| SQL injection | Tampering | All queries use parameterized `?` placeholders; see `db.py:177`, `portfolio_service.py:113` | ✅ |
| Path traversal via ticker param | Information Disclosure | Watchlist ticker is normalized to uppercase + `isalnum()` check (`watchlist.py:83`); rejects `BRK.B`, `SPY-ETF`, etc. | ✅ (`test_watchlist.py:201-211` verifies) |
| LLM response with adversarial JSON | Tampering | `ChatResponse.model_validate_json` raises on schema mismatch; caught and returned as graceful fallback | ✅ (`test_llm.py:198-225`) |
| Secrets in image layers | Information Disclosure | `--env-file .env`; no `ARG OPENROUTER_API_KEY` in Dockerfile; `.dockerignore` excludes `.env` | ✅ (after this phase) |

**ASVS-1 audit checklist (must pass in plan checker):**
- [ ] `Dockerfile` does not contain any `ARG` or `ENV` that sets a secret value.
- [ ] `.dockerignore` excludes `.env` (the file itself, not just the contents).
- [ ] Container runs as non-root user (the default `python` user in the slim image is root; consider adding `USER` directive — ASVS-1 "V10" calls this a best practice but not strictly required for level 1).
- [ ] Container has a `HEALTHCHECK` directive (or compose healthcheck) — already in Pattern 4 for the E2E compose; consider adding to the production Dockerfile too (FastAPI's `/api/health` is already there).
- [ ] `.env.example` documents all required and optional env vars without example values that look like real secrets.

## Assumptions Log

> Claims tagged `[ASSUMED]` need user confirmation before becoming locked decisions. Most of the Phase 4 research is verified, but the following items are reasonable engineering judgement calls that the planner should re-confirm.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `python:3.12-slim` is sufficient; no `build-essential` needed. | Standard Stack / Pattern 1 | Low — `numpy` and `aiosqlite` both ship manylinux wheels. If a future dep needs compile, the image would fail at `uv sync`; trivially fixed by adding `RUN apt-get update && apt-get install -y build-essential` to the backend-build stage. |
| A2 | `mcr.microsoft.com/playwright:v1.61.0-noble` is the right image tag (matches npm `1.61.1`). | Standard Stack / Pattern 4 | Low — the tag is the literal example from https://playwright.dev/docs/docker. If the image isn't yet pushed at that exact tag when the planner runs, fall back to `v1.61.0-noble` or whatever matches `npm view @playwright/test version`. |
| A3 | `LLM_MOCK=true` is the only E2E-supported chat configuration. | Pattern 4 / TEST-08 | Medium — this is project policy, not a technical constraint. If the user wants E2E against the real LLM, the start script would need to inject `OPENROUTER_API_KEY`, and tests would be non-deterministic. Recommendation stands. |
| A4 | `data-testid` is the right E2E selector strategy (vs. `aria-label` or CSS class). | Pitfall 5 / Wave 0 Gaps | Low — `aria-label` would also work (e.g. `Remove AAPL from watchlist`), but `data-testid` is the most common Playwright convention and survives copy changes. |
| A5 | The default port 8000 and the volume name `finally-data` are the right names. | Pattern 2 / Pattern 3 | Low — these are convention choices. If the user has a conflicting local container, change the names in the start script. |
| A6 | `page.route()` stubbing in TEST-08 is preferable to adding an `LLM_MOCK_BUY=1` env var. | Pitfall 6 | Low — this is a test-design preference. Either works; `page.route()` keeps product code clean. |
| A7 | Backend tests should NOT be added to the production image (TEST-01..03 run on the host only). | Pitfall 9 | High if wrong — if tests must run inside the container, the Dockerfile needs an `as builder` test stage and the image would be larger. The intent is that the host runs tests before pushing. |
| A8 | The default `powerShell.exe` (5.1) on Windows is acceptable for the start script (no `pwsh` 7+ required). | Standard Stack | Low — `Start-Process` and `Invoke-WebRequest` both work in 5.1. If the user wants 7+ features (e.g. `&&` chaining), they'd need to install `pwsh` and adjust the shebang line. |

**If this table were empty:** every recommendation would be either officially cited or locally verified. The 8 items above are all LOW risk and are standard engineering choices that don't need a separate `/gsd-discuss-phase` round.

## Open Questions

1. **Where should `data-testid` attributes be added in the frontend?**
   - What we know: The frontend uses `aria-label` extensively but has no `data-testid`. The list of needed IDs is in Wave 0 Gaps.
   - What's unclear: Should the planner add them in a separate "frontend test hooks" task, or interleave with the E2E spec work?
   - Recommendation: Separate task. Add all `data-testid` first (small, mechanical, in one wave-0 plan), then E2E specs in a later wave. This makes the E2E specs reviewable on their own.

2. **Should the E2E compose bind-mount a snapshot of the test code, or copy it in?**
   - What we know: Bind-mounting `./test:/home/pwuser/test` means edits to spec files on the host are immediately visible in the container.
   - What's unclear: This is a developer-experience choice; CI may prefer a self-contained image.
   - Recommendation: Bind-mount for local dev (faster iteration), build a dedicated image in CI. For Phase 4, local dev is enough; the planner can document CI-build as a follow-up.

3. **Should the production Dockerfile include a `HEALTHCHECK` directive?**
   - What we know: `app.main.create_app()` already exposes `/api/health`. The test compose uses a healthcheck. The production Dockerfile (in this phase) does not need one for the success criteria, but it's a defensive practice.
   - What's unclear: Whether to add it.
   - Recommendation: Add it. One line, no downside. `HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health').read()"`.

## Sources

### Primary (HIGH confidence)
- https://docs.astral.sh/uv/guides/integration/docker/ — Multi-stage `uv` Dockerfile pattern (verified pattern in Code Example).
- https://playwright.dev/docs/docker — Official Playwright Docker image (`mcr.microsoft.com/playwright:v1.61.0-noble`) and `--ipc=host` flag.
- https://docs.astral.sh/uv/reference/cli/#uv-sync — `uv sync --frozen` vs `--locked` distinction; `--frozen` is right for production Docker.
- https://nextjs.org/docs/app/guides/static-exports — Next.js `output: 'export'` produces an `out/` directory; HTML/CSS/JS assets; deployable to any static web server.
- Local probe (`docker --version`, `docker compose version`, `node --version`, `uv --version`) — environment availability audit.

### Secondary (MEDIUM confidence)
- `backend/app/main.py:135` — confirms `STATIC_DIR` env var default is `static`.
- `backend/app/db.py:128` — confirms `DB_PATH` env var default is `db/finally.db` (relative).
- `backend/app/llm.py:115` — `build_mock_response` returns fixed `trades=[]`, `watchlist_changes=[]`.
- `backend/tests/conftest.py` + 6 test files — confirms established patterns (TestClient, `monkeypatch.setenv("DB_PATH", tmp_path / ...)`, `asyncio_mode = "auto"`).
- `frontend/src/lib/api.ts:12` — confirms `NEXT_PUBLIC_API_BASE_URL` is read at build time.

### Tertiary (LOW confidence)
- `mcr.microsoft.com/playwright` image variants — confirmed `v1.61.0-noble` is a current example, but I did not enumerate all available tags. Mitigation: use the version that matches `npm view @playwright/test version` at planner-execution time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep is already in `backend/pyproject.toml` or `frontend/package.json`; Docker base images are official; Playwright image is cited from official docs.
- Architecture: HIGH — derived from project CLAUDE.md (single container, port 8000, uv, SQLite at `db/finally.db`) and `backend/app/main.py:135-218` (STATIC_DIR, lifespan, health).
- Pitfalls: MEDIUM-HIGH — all 10 pitfalls are concrete observations from reading the code + standard Docker knowledge; 3 of them (Pitfall 5, 6, 9) are non-obvious and worth surfacing to the planner.
- E2E selectors: MEDIUM — `data-testid` is the standard Playwright convention but I did not exhaustively grep for existing test hooks; the Wave 0 list is a starting point, not a comprehensive inventory.
- Test gaps: HIGH — read all 6 existing backend test files and `test_chat_route.py` to determine what's covered vs missing.

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (30 days) — Docker/uv/Next.js/Playwright all stable; the only thing that could shift is the exact Playwright image tag.
