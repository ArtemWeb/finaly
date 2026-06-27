---
phase: 04-docker-testing
plan: 05
subsystem: e2e
tags: [playwright, e2e, docker-compose, test-infra, TEST-04]
provides:
  - playwright-test-project
  - e2e-compose-stack
  - e2e-run-readme
requires:
  - product-image-from-04-01
affects:
  - TEST-04
tech-stack:
  added:
    - "@playwright/test 1.61.1 (devDependency)"
    - "mcr.microsoft.com/playwright:v1.61.0-noble"
  patterns:
    - "compose service-name baseURL (NOT localhost)"
    - "depends_on: condition: service_healthy healthcheck gate"
    - "isolated test data volume (finally-test-data)"
    - "LLM_MOCK=true to avoid real OPENROUTER_API_KEY in E2E"
    - "ipc: host on playwright service for Chromium shared memory"
key-files:
  created:
    - test/package.json
    - test/playwright.config.ts
    - test/docker-compose.test.yml
    - test/README.md
  modified: []
decisions:
  - "baseURL defaults to http://app:8000 (compose service name) — never localhost, because sibling containers reach each other by service name on the internal compose network."
  - "workers: 1 and fullyParallel: false because tests share a single SQLite DB — parallel workers would race on the same DB file."
  - "@playwright/test pinned to 1.61.1 (exact), matching the mcr.microsoft.com/playwright:v1.61.0-noble image tag — version drift between the two is the canonical cause of 'browser not found' failures."
  - "Compose app service builds from source (build: context: ../) rather than pulling :latest, so the E2E always exercises the current code."
  - "Dedicated finally-test-data volume (NOT the production finally-data) so E2E runs can never corrupt user data, and tests get a clean DB every run."
  - "LLM_MOCK=true on the compose app service — no OPENROUTER_API_KEY is needed or accepted in the test environment, satisfying threat model T-04-11."
  - "ipc: host on the playwright service — Chromium inside containers needs host-shared memory on Linux hosts (RESEARCH Standard Stack note)."
  - "Playwright command is npm install && npx playwright test — the container installs the pinned Playwright at run time, so the host npm registry is the only source of truth for the version pin."
  - "Healthcheck uses stdlib urllib (python -c 'import urllib.request; ...') because python:3.12-slim has no curl and adding it would bloat the image (matches 04-01 decision)."
metrics:
  duration: "~3 minutes"
  completed_date: 2026-06-27
  tasks_completed: 2
  files_created: 4
status: complete
---

# Phase 4 Plan 5: E2E test infrastructure (TEST-04) Summary

## What was built

A self-contained E2E test project that exercises the FinAlly product image
without polluting the production runtime. Four files under `test/`:

1. **`test/package.json`** — name `finally-test`, private, single `scripts.test`
   of `playwright test`, and `@playwright/test` pinned to exactly `1.61.1`.
2. **`test/playwright.config.ts`** — `testDir: './e2e'`, `fullyParallel: false`,
   `workers: 1`, `reporter: 'line'`, one chromium project, and
   `baseURL: process.env.BASE_URL ?? 'http://app:8000'` (the compose service
   name, never `localhost`).
3. **`test/docker-compose.test.yml`** — two services. `app` builds from
   `../Dockerfile`, sets `LLM_MOCK=true` + `DB_PATH=/app/db/finally.db`,
   mounts a dedicated `finally-test-data` named volume at `/app/db`,
   and healthchecks `/api/health` via stdlib urllib. `playwright` uses
   `mcr.microsoft.com/playwright:v1.61.0-noble` (matching the npm pin),
   `depends_on: app: condition: service_healthy`, `ipc: host`, bind-mounts
   `./` into `/home/pwuser/test`, and runs `npm install && npx playwright test`.
4. **`test/README.md`** — documents the one-line run command
   `docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright`,
   explains why `baseURL` is the service name, and lists the directory layout.

## Verification

All plan-level verification commands executed and passed:

| Check | Command | Result |
|-------|---------|--------|
| `@playwright/test` pin | `grep '"@playwright/test": "1.61.1"' test/package.json` | match |
| baseURL is service name | `grep 'http://app:8000' test/playwright.config.ts` | match |
| workers=1 | `grep 'workers: 1' test/playwright.config.ts` | match |
| No localhost:8000 in config | `grep -v '^[[:space:]]*//' test/playwright.config.ts \| grep -c 'localhost:8000'` | 0 |
| compose config validates | `docker compose -f test/docker-compose.test.yml config` | exit 0 |
| service_healthy gate | `grep service_healthy test/docker-compose.test.yml` | match |
| LLM_MOCK set | `grep LLM_MOCK test/docker-compose.test.yml` | match |
| Isolated test volume | `grep finally-test-data test/docker-compose.test.yml` | match |
| Playwright image | `grep mcr.microsoft.com/playwright test/docker-compose.test.yml` | match |

## Acceptance criteria met

- [x] `test/package.json` pins `"@playwright/test": "1.61.1"` and has a `scripts.test`
- [x] `test/playwright.config.ts` sets `baseURL` to `http://app:8000` (compose service name)
- [x] `test/playwright.config.ts` sets `workers: 1` and `fullyParallel: false` and `testDir ./e2e`
- [x] `test/playwright.config.ts` does NOT reference `localhost:8000`
- [x] `docker compose -f test/docker-compose.test.yml config` exits 0
- [x] The app service builds from source (build context, not a `:latest` image) and sets `LLM_MOCK=true`
- [x] The app service has a healthcheck probing `/api/health`
- [x] The playwright service has `depends_on` with `condition: service_healthy`
- [x] A dedicated `finally-test-data` volume is used (not the production `finally-data`)
- [x] The playwright image is `mcr.microsoft.com/playwright` (noble tag)
- [x] `test/README.md` documents the compose `up --exit-code-from playwright` command

## Deviations from Plan

None - the plan executed exactly as written. The compose file follows
RESEARCH "Pattern 4" verbatim in structure; the Playwright config follows
RESEARCH "Playwright config (TypeScript, ESM)" verbatim. The only intentional
amplification was the comment headers in each file explaining WHY the
service-name baseURL matters (Pitfall 3) and WHY the isolated volume
matters (threat model T-04-10) — these prevent the two most common E2E
failures (ECONNREFUSED on localhost, tests trampling real data) from
re-appearing during wave-3 spec writing.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All three threats in the plan's `<threat_model>` have mitigations present. T-04-10 (test data isolation): app service mounts the dedicated `finally-test-data` volume; `LLM_MOCK=true` means no real chat. T-04-11 (E2E env / secrets): compose app service sets only `LLM_MOCK=true`; no `OPENROUTER_API_KEY` is passed. T-04-04 (base image trust): `mcr.microsoft.com/playwright` is Microsoft-published official; product Dockerfile uses Docker-library + GHCR-astral-sh (per 04-01). |

## Notes for downstream plans

- **Wave-3 spec writers (plans 04-03, 04-04, 04-06)** add files under
  `test/e2e/`. They MUST NOT change `playwright.config.ts` to localhost
  (Pitfall 3). They MUST use `data-testid` selectors (already documented
  in 04-RESEARCH.md spec examples).
- **The pinned Playwright version** (`1.61.1` in `package.json`,
  `v1.61.0-noble` for the image) MUST stay in lockstep. If a future
  maintenance task bumps one, bump the other in the same commit.
- **The app is reached via the service name** — browser-style network
  hostnames resolve inside compose, but `localhost:8000` from inside the
  playwright container would point at the playwright container itself.
- **`LLM_MOCK=true` means any chat spec must stub or expect the mock
  response shape** (per RESEARCH mock LLM contract) — real LLM responses
  are not available in the test environment by design.
- **The test volume persists between compose runs by default.** If a
  spec needs a clean DB, the cleanest pattern is to add
  `docker compose -f test/docker-compose.test.yml down -v` in a setup
  step (this is a wave-3 concern, not for this plan).

## Self-Check: PASSED

All four `test/` files exist on disk; both task commits (8b81bbd, edf8ce4)
are present in git history; SUMMARY.md exists in the plan directory.