# FinAlly E2E Tests

Self-contained Playwright E2E infrastructure for FinAlly.

The product image does NOT contain Playwright (single-container constraint).
E2E runs as separate test infrastructure, orchestrated via this compose file.

## Run

From the repo root:

```bash
docker compose -f test/docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright
```

What happens:

1. The `app` service builds the product image from `../Dockerfile` (the repo root).
2. The app starts with `LLM_MOCK=true` and mounts the isolated `finally-test-data`
   volume at `/app/db` so tests never touch production data.
3. The app's `/api/health` healthcheck gates the `playwright` service
   (`depends_on: condition: service_healthy`) — no race against uvicorn startup.
4. The `playwright` service runs `npm install` then `npx playwright test`,
   and the container exits with the test result code.
5. `--abort-on-container-exit --exit-code-from playwright` propagates that
   exit code to the host shell.

## Specs

Tests live in `test/e2e/` (one spec per acceptance criterion). They target
the compose service name `http://app:8000` via `playwright.config.ts` —
never `localhost:8000`, because sibling containers reach each other by
service name on the internal compose network.

## Layout

```
test/
  package.json              # @playwright/test 1.61.1 (pin matches image tag)
  playwright.config.ts      # baseURL=http://app:8000, workers=1, single chromium
  docker-compose.test.yml   # app (build) + playwright (service_healthy gate)
  e2e/                      # *.spec.ts — written in phase-04 wave-3 plans
```