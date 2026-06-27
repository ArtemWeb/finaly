---
phase: 4
slug: docker-testing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.3.0+, pytest-asyncio (`asyncio_mode="auto"`), httpx TestClient, pytest-cov (backend); @playwright/test 1.61.1 (E2E) |
| **Config file** | `backend/pyproject.toml` `[tool.pytest.ini_options]` (backend); `test/playwright.config.ts` (E2E — Wave 0 creates) |
| **Quick run command** | `cd backend && uv run --extra dev pytest -q` |
| **Full suite command** | `cd backend && uv run --extra dev pytest --cov=app` |
| **Estimated runtime** | backend ~<30s; E2E ~3-5 min first run, <1 min cached |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && uv run --extra dev pytest -q` (unit, <5s)
- **After every plan wave:** Run `cd backend && uv run --extra dev pytest --cov=app` (full backend, <30s)
- **Before `/gsd-verify-work`:** Full backend suite green + `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright` green + manual `scripts/start_*.sh` / `scripts/stop_*.sh` smoke run
- **Max feedback latency:** 30 seconds (backend); E2E is a phase-gate, not per-commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-DOCK-01 | docker | 1 | DOCK-01 | T-04-secrets | No secret ARG/ENV in image; runs uvicorn on 0.0.0.0:8000 | smoke | `docker build -t finally:latest . && docker run --rm finally:latest python -c "import app.main"` | ❌ W0 | ⬜ pending |
| 4-DOCK-02 | docker | 1 | DOCK-02 | — | DB persists across stop/start in named volume | smoke | `scripts/verify_persistence.sh` (write trade → stop → start → read back) | ❌ W0 | ⬜ pending |
| 4-DOCK-03 | scripts | 1 | DOCK-03 | — | Idempotent start/stop; stop preserves volume | manual | shell-level smoke | ❌ W0 | ⬜ pending |
| 4-DOCK-04 | scripts | 1 | DOCK-04 | — | Idempotent start/stop on Windows PowerShell | manual | shell-level smoke | ❌ W0 | ⬜ pending |
| 4-DOCK-05 | env | 1 | DOCK-05 | T-04-config | `.env.example` complete; `.env` gitignored | lint-style | `grep -E '^(OPENROUTER_API_KEY\|LLM_MOCK\|MASSIVE_API_KEY)' backend/.env.example` | ⚠️ verify | ⬜ pending |
| 4-TEST-01 | backend-tests | 1 | TEST-01 | T-04-biz | Trade edge cases (insufficient cash, oversell) reject | unit | `uv run --extra dev pytest tests/test_portfolio.py -k "insufficient or partial or weighted"` | ✅ exists | ⬜ pending |
| 4-TEST-02 | backend-tests | 1 | TEST-02 | — | Full-app GET portfolio/history/watchlist round-trips | unit | `uv run --extra dev pytest tests/test_main_api_coverage.py` | ❌ W0 (gap-fill) | ⬜ pending |
| 4-TEST-03 | backend-tests | 1 | TEST-03 | T-04-llm | Valid-JSON-wrong-schema LLM response handled gracefully | unit | `uv run --extra dev pytest tests/test_llm_malformed.py` | ❌ W0 (gap-fill) | ⬜ pending |
| 4-TEST-04 | e2e-infra | 2 | TEST-04 | — | Compose spins app + Playwright, app healthcheck gates start | integration | `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit` | ❌ W0 | ⬜ pending |
| 4-TEST-05 | e2e-specs | 3 | TEST-05 | — | Fresh start: $10k + 10 tickers streaming | e2e | `npx playwright test e2e/01-fresh-start.spec.ts` | ❌ W0 | ⬜ pending |
| 4-TEST-06 | e2e-specs | 3 | TEST-06 | — | Buy → cash decreases, position appears, heatmap updates | e2e | `npx playwright test e2e/02-buy.spec.ts` | ❌ W0 | ⬜ pending |
| 4-TEST-07 | e2e-specs | 3 | TEST-07 | — | Sell → cash increases, position updates | e2e | `npx playwright test e2e/03-sell.spec.ts` | ❌ W0 | ⬜ pending |
| 4-TEST-08 | e2e-specs | 3 | TEST-08 | T-04-llm | AI chat returns response with inline trade confirmation (page.route stub) | e2e | `npx playwright test e2e/04-chat.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `Dockerfile` (DOCK-01) — multi-stage: `node:20-slim` build → `python:3.12-slim` runtime with `uv sync --frozen`
- [ ] `.dockerignore` (root) — excludes `.venv`, `node_modules`, `.git`, `.env`
- [ ] `scripts/start_mac.sh`, `scripts/stop_mac.sh` (DOCK-03)
- [ ] `scripts/start_windows.ps1`, `scripts/stop_windows.ps1` (DOCK-04)
- [ ] `backend/.env.example` audited/updated for `OPENROUTER_API_KEY`, `LLM_MOCK`, `MASSIVE_API_KEY`, `SNAPSHOT_INTERVAL` (DOCK-05)
- [ ] `test/package.json` with `@playwright/test` 1.61.1 (TEST-04)
- [ ] `test/playwright.config.ts` (TEST-04)
- [ ] `test/docker-compose.test.yml` (TEST-04)
- [ ] `test/e2e/0{1,2,3,4}-*.spec.ts` (TEST-05..08)
- [ ] Frontend `data-testid` hooks — `header-total`, `header-cash`, `connection-dot`, `watchlist-row`, `position-row-{ticker}`, `trade-ticker-input`, `trade-qty-input`, `trade-buy-button`, `trade-sell-button`, `chat-input`, `chat-send`, `chat-message`, `trade-chip` (Pitfall 5)
- [ ] `backend/tests/test_llm_malformed.py` (TEST-03 gap-fill)
- [ ] `backend/tests/test_main_api_coverage.py` (TEST-02 gap-fill)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `start_mac.sh` opens a browser to a working terminal | DOCK-03 | Browser launch + visual confirmation is host/OS-level, not assertable in CI | Run `scripts/start_mac.sh`; confirm browser opens to `http://localhost:8000` showing live terminal |
| `start_windows.ps1` / `stop_windows.ps1` on Windows | DOCK-04 | PowerShell + Windows Docker Desktop host behavior | Run in PowerShell; confirm idempotent start, browser open, stop preserves volume |
| DB persistence across restart | DOCK-02 | Requires real container lifecycle (stop/start) | `scripts/verify_persistence.sh` automates the core check; final confirmation is manual restart |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
