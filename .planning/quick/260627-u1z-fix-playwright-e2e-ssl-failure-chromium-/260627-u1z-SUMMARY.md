---
phase: quick-260627-u1z
plan: 01
type: execute
subsystem: test-harness
tags: [playwright, e2e, chromium, ssl, https-upgrades, loopback, regression]
status: complete
dependency_graph:
  requires: []
  provides: [green-e2e-gate]
  affects: [test/playwright.config.ts, test/docker-compose.test.yml, test/e2e/01-fresh-start.spec.ts, test/e2e/02-buy.spec.ts, test/e2e/03-sell.spec.ts, test/e2e/04-chat.spec.ts]
tech-stack:
  added: []
  patterns:
    - "Playwright runner shares the app container's network namespace (network_mode: service:app) and targets the app on loopback 127.0.0.1 — loopback is the one origin Chrome never force-upgrades http->https"
key-files:
  created: []
  modified:
    - test/playwright.config.ts
    - test/docker-compose.test.yml
decisions:
  - "Attempt 1 (the --disable-features=HttpsUpgrades launch flag, commit 00142f4) is PROVEN INERT against Chrome 149 — kept in history but reverted in attempt 2"
  - "Attempt 2: route Playwright at loopback (127.0.0.1) via network_mode: service:app — version-independent, no reliance on a Chromium feature-flag name"
  - "Used 127.0.0.1 literally, NOT localhost — uvicorn binds 0.0.0.0 (IPv4); localhost can resolve to ::1 and miss it"
  - "Did NOT add ignoreHTTPSErrors (would not address a protocol upgrade) and did NOT add networks:/ports: to the playwright service (incompatible with network_mode: service:*)"
metrics:
  duration: "~12m across both attempts (build + 2 compose runs + diagnostics + cleanup)"
  completed_date: 2026-06-27
  tasks_completed: 1
  tasks_total: 1
  code_files_changed: 2
---

# Quick 260627-u1z Plan 01: Fix Playwright E2E SSL failure (Chromium auto-upgrade)

## Outcome

**Status: COMPLETE.** The E2E gate is green. The fix that worked was NOT the
plan's original launch-flag approach (attempt 1, which is documented below as a
genuine failure) but a version-independent loopback-routing approach authorized
by the coordinator after attempt 1 was proven dead (attempt 2).

Final verification: **compose exited 0**, Playwright line reporter printed
**`4 passed (12.7s)`** (01-fresh-start, 02-buy, 03-sell, 04-chat). No spec hit
`ERR_SSL_PROTOCOL_ERROR`.

## Final committed change (attempt 2)

New commit hash: **`eabec51`** — `fix(test): route Playwright at loopback to avoid Chrome https upgrade`.

Two files changed, no app code, no specs:

### test/playwright.config.ts
- Removed the inert `launchOptions` block from the chromium project (back to
  `{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }`).
- Changed the baseURL default from `'http://app:8000'` to `'http://127.0.0.1:8000'`
  (BASE_URL env override preserved: `process.env.BASE_URL ?? 'http://127.0.0.1:8000'`).
- Rewrote the comment above baseURL to explain the netns/loopback rationale.
- Did NOT touch `testDir`, `fullyParallel`, `workers`, `reporter`, `use.trace`.

### test/docker-compose.test.yml
- Added `network_mode: "service:app"` to the `playwright` service (with an
  explanatory comment) so it shares the app container's network namespace and
  can reach the app on `127.0.0.1:8000`.
- `depends_on` (service_healthy gate), `ipc: host`, `working_dir`, `volumes`,
  and `command` are unchanged. No `networks:` or `ports:` added (incompatible
  with `network_mode: service:*`). The `app` service and the `volumes` block are
  completely unchanged.

## Verification command

```
cd "$(git rev-parse --show-toplevel)"
docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright
```

## Verification result (attempt 2 — PASS)

- **Compose exit code: 0**
- **Exact final reporter line: `4 passed (12.7s)`**
- `playwright-1 exited with code 0`; `app-1 exited with code 0`
- App logs show every spec navigating over loopback HTTP successfully, e.g.
  `app-1 | INFO: 127.0.0.1:37562 - "GET / HTTP/1.1" 200 OK` for spec 1, plus the
  expected `POST /api/portfolio/trade HTTP/1.1 200 OK` for the buy/sell/chat
  specs. No `ERR_SSL_PROTOCOL_ERROR` anywhere in the run.

Post-run cleanup: `docker compose -f test/docker-compose.test.yml down` (without
`-v`). Verified afterwards: no `test-app-1`/`test-playwright-1` containers remain;
the `test_finally-test-data` volume is preserved. The production `finally-data`
volume was never touched.

## Attempt 1 (honest failure record)

Commit **`00142f4`** added
`launchOptions.args: ['--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable']`
to the chromium project, exactly as the plan specified. That run **failed**:
compose exited 1, `4 failed`, every spec hit
`net::ERR_SSL_PROTOCOL_ERROR at http://app:8000/` at `page.goto('/')`.

I verified independently (same `mcr.microsoft.com/playwright:v1.61.0-noble`
image, same Chromium build `Google Chrome for Testing 149.0.7827.55`) that the
flag was accepted by Chromium but did NOT stop the single-label-hostname
auto-upgrade: headless Chromium with that flag still produced an
`ERR_SSL_PROTOCOL_ERROR` page for `http://app:8000`, while `http://127.0.0.1:8000`
produced a different (connection-level) error. Conclusion: in Chrome 149 the
`app` single-label upgrade is not gated by `HttpsUpgrades`, so the flag is inert.

Commit `00142f4` was deliberately NOT amended — the failed attempt is kept in
git history. Attempt 2 reverts the inert flag and lands the loopback fix on top.

## Why loopback works (version-independent)

Chrome force-upgrades non-loopback http origins to https, but treats loopback
(`127.0.0.1`) as a trustworthy/exempt origin that is never auto-upgraded. By
sharing the app container's network namespace (`network_mode: service:app`), the
app's `0.0.0.0:8000` listener is reachable at `127.0.0.1:8000` from inside the
Playwright container, so pointing `baseURL` at `127.0.0.1:8000` sidesteps the
upgrade entirely — no dependency on any Chromium feature-flag name that could
change between versions.

## Constraint compliance

- Only `test/playwright.config.ts` and `test/docker-compose.test.yml` changed in
  the code commit (`eabec51`). Verified via `git show --stat HEAD`:
  `test/docker-compose.test.yml | 5 +++++`, `test/playwright.config.ts | 22 +++++++---------------`
  (`2 files changed, 12 insertions(+), 15 deletions(-)`).
- No application code, no spec files modified.
- No `.planning/` docs committed in the code commit (orchestrator handles docs).
- The `app` service and the compose `volumes` block are unchanged.
- exit-0-with-4-passed observed — this is the only state reported as complete.

## Self-Check

- [x] Commit `eabec51` exists: `git show --stat eabec51` returns the expected
      2-file diff (`test/docker-compose.test.yml`, `test/playwright.config.ts`).
- [x] Commit `00142f4` (attempt 1) still exists in history, un-amended.
- [x] Only the two test-harness files changed in `eabec51`; no app code, no specs.
- [x] Compose stack torn down after the passing run (no leftover containers);
      `test_finally-test-data` volume preserved.
- [x] E2E gate MET: compose exit 0, reporter line `4 passed (12.7s)`.