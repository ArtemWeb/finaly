---
status: testing
phase: 04-docker-testing
source: [04-VERIFICATION.md]
started: 2026-06-27T00:00:00Z
updated: 2026-06-27T00:00:00Z
---

## Current Test

number: 1
name: E2E suite green run via Docker compose
expected: |
  `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright`
  exits 0 with all 4 specs (fresh-start, buy, sell, chat) passing.
awaiting: user response

## Tests

### 1. E2E suite green run via Docker compose
expected: |
  Running `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright`
  exits 0 with all 4 specs passing. CURRENTLY FAILS: every spec errors at `page.goto('/')` with
  `net::ERR_SSL_PROTOCOL_ERROR at http://app:8000/` — Chromium in the playwright image auto-upgrades the
  plain-HTTP request to HTTPS even though `curl http://app:8000/api/health` from inside the container returns 200.
  Likely fix: align the runner image `mcr.microsoft.com/playwright:v1.61.0-noble` to `v1.61.1-noble` to match the
  `@playwright/test: 1.61.1` pin (REVIEW WR-07), switch `npm install` → `npm ci` (WR-06), and investigate the
  HTTPS-upgrade (e.g. set an explicit `http://` baseURL / disable HSTS upgrade in the Playwright config).
result: [pending]

### 2. Windows PowerShell start/stop scripts
expected: |
  On a Windows host with Docker Desktop: `scripts/start_windows.ps1` builds + runs the container, waits for
  health, opens the browser to a working terminal; `scripts/stop_windows.ps1` stops the container while
  preserving the named volume (portfolio state survives a subsequent start). Note REVIEW WR-04: start script
  hard-requires `.env` via `--env-file`, which fails on a fresh clone (`.env` is gitignored) — confirm the
  documented "works without API key" first-run flow.
result: [pending]

### 3. macOS/Linux full demo flow
expected: |
  On macOS/Linux: `scripts/start_mac.sh` builds + runs the container, waits for health, opens the browser;
  the terminal shows $10k cash + 10 streaming tickers; a buy/sell round-trips; `scripts/stop_mac.sh` preserves
  the volume. Same WR-04 `.env` caveat applies.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
