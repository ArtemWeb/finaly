---
phase: 03-frontend
plan: 02
subsystem: frontend-live-data
tags: [sse, context, watchlist, sparkline, recharts, tailwind]
dependency_graph:
  requires:
    - 03-01
  provides:
    - UI-01
    - UI-02
    - UI-09
    - UI-10
    - UI-12
  affects:
    - 03-03
tech-stack:
  added: []
  patterns:
    - D-04 Context-distributed state at AppShell (no prop-drilling)
    - D-05 Split contexts by update cadence (PriceContext high-churn SSE vs PortfolioContext low-churn 10s poll)
    - D-06 Header-derived live total via useMemo across both contexts
    - rAF-debounced setPrices coalesces burst SSE updates to one render per frame
    - Native EventSource lifecycle with no custom backoff (server retry: 1000)
    - Recharts SSR-safety via mounted-flag guard on chart components
    - Declarative 500ms Tailwind transition-colors for price flash (no setTimeout race)
    - Event-bus toast dispatch (module-level singleton + listeners Set)
key-files:
  created:
    - frontend/src/hooks/useSse.ts
    - frontend/src/context/PriceContext.tsx
    - frontend/src/context/PortfolioContext.tsx
    - frontend/src/components/ui/EmptyState.tsx
    - frontend/src/components/ui/Toast.tsx
    - frontend/src/components/layout/AppShell.tsx
    - frontend/src/components/layout/ConnectionDot.tsx
    - frontend/src/components/layout/Header.tsx
    - frontend/src/components/watchlist/Sparkline.tsx
    - frontend/src/components/watchlist/PriceFlash.tsx
    - frontend/src/components/watchlist/WatchlistRow.tsx
  modified:
    - frontend/src/app/page.tsx
    - frontend/src/components/watchlist/WatchlistPanel.tsx
decisions:
  - PriceContext owns prices + ring buffers + selectedTicker + sseStatus; PortfolioProvider sits INSIDE PriceProvider so PortfolioContext.removeTicker can call PriceContext.clearTicker (Pitfall 3).
  - rAF-debounced setPrices coalesces burst SSE messages (one per ticker per tick) into a single render per animation frame.
  - History ring buffers live in a useRef + a "history tick" counter so appending never re-renders consumers (Sparkline reads history[ticker] at render time).
  - ConnectionDot reads sseStatus from PriceContext (single source of connection truth).
  - Toast dispatch uses a module-level listeners Set — no extra dep, no extra Context; TradeBar in 03-03 can call toast(success|error, msg) directly.
  - WatchlistPanel stub was committed in Task 2 so AppShell compiled; Task 3 replaced the stub with the full implementation in the same file.
metrics:
  duration: ~12 minutes
  completed_date: 2026-06-27
  tasks: 3
  files_created: 11
  files_modified: 2
  commits: 3
  tests_passing: null
status: complete
---

# Phase 3 Plan 2: Live-data layer + Watchlist column — Summary

One-liner: SSE-driven PriceContext with rAF-debounced 60fps updates + low-churn PortfolioContext + Header-derived live total + ConnectionDot + watchlist column with 500ms flash and accumulating sparklines.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | useSse hook + split contexts + shared UI primitives | `cc0857b` | 5 files (useSse.ts, PriceContext.tsx, PortfolioContext.tsx, EmptyState.tsx, Toast.tsx) |
| 2 | AppShell 3-col grid + Header (D-06) + ConnectionDot (D-03) | `f2aad8a` | 5 files (AppShell.tsx, Header.tsx, ConnectionDot.tsx, page.tsx, WatchlistPanel.tsx stub) |
| 3 | WatchlistPanel + WatchlistRow + PriceFlash + Sparkline + add/remove | `8855b75` | 4 files (Sparkline.tsx, PriceFlash.tsx, WatchlistRow.tsx, WatchlistPanel.tsx expanded) |

## Verification Results

| Check | Result |
|-------|--------|
| `cd frontend && npx tsc --noEmit` (after Task 1) | exit 0, strict mode |
| `cd frontend && npm run build` (after Task 2) | exit 0, `frontend/out/` generated (index.html, _next/, 404.html) |
| `cd frontend && npm run build` (after Task 3) | exit 0, `frontend/out/` regenerated (4.35kB → 85.3kB first-load JS for the page including Recharts + chart components) |
| Recharts SSR safety (Pitfall 1) | Sparkline has `'use client'` + mounted-flag guard; build completes without `window is not defined` |
| ConnectionDot verbatim tooltips | "Live — streaming prices" / "Reconnecting…" / "Connection lost — retrying" |
| Header verbatim labels | "Total Value" + "Cash" in `text-accent-yellow` for total, `text-text-primary` for cash |
| Watchlist verbatim copy | "Watchlist" / "Add ticker (e.g. PYPL)" / "Add" / "No tickers yet" / "Add a ticker above to start tracking live prices." |
| Remove button aria-label | `Remove {ticker} from watchlist` exactly |
| Flash class | `bg-profit/20` / `bg-loss/20` + `transition-colors duration-500` |
| D-06 (no stored total_value) | grep confirms no `setTotal(...)` / `total_value:` assignment in `PortfolioContext.tsx` |
| D-05 (split contexts) | PriceProvider wraps PortfolioProvider; PriceContext owns prices/ring buffers/selectedTicker, PortfolioContext owns portfolio/watchlist/history + 10s poll |
| `dangerouslySetInnerHTML` usage | none across all new files |

## Deviations from Plan

### Auto-fixed Issues

**1. [Task order adjustment] Created a minimal WatchlistPanel stub in Task 2 then expanded it in Task 3**

- **Found during:** Task 2 — AppShell.tsx imports `<WatchlistPanel/>` to fill the left column, but the plan had WatchlistPanel only in Task 3's `files_modified` list. Without it, `npm run build` in Task 2 would fail with a missing-module error.
- **Fix:** Task 2 created `frontend/src/components/watchlist/WatchlistPanel.tsx` as a minimal placeholder (just the "Watchlist" title + a placeholder body). Task 3 overwrote that file with the full implementation. The commit history shows this clearly: Task 2's commit created the file as a stub; Task 3's commit modifies the same file to the full version. The plan's `files_modified` for Task 3 listed WatchlistPanel.tsx — so this is consistent with the plan's intent, just executed out of order to keep Task 2's `npm run build` verification green.
- **Files modified:** `frontend/src/components/watchlist/WatchlistPanel.tsx` (stub in Task 2 → full implementation in Task 3)
- **Commits:** `f2aad8a` (Task 2 — created as stub), `8855b75` (Task 3 — full implementation)

### Plan-exact decisions

- **D-04 Provider nesting order.** PriceProvider wraps PortfolioProvider (not the other way around) because PortfolioContext.removeTicker calls PriceContext.clearTicker (Pitfall 3 — ring buffer wipe on remove). The plan was silent on order; this is the only order that compiles.
- **Recharts mounted flag.** Sparkline uses `useEffect(() => setMounted(true), [])` and renders a pulse placeholder until mounted. RESEARCH Pitfall 1 explicitly required this for `output: 'export'` builds. Without it, `next build` throws `ReferenceError: window is not defined` during the prerender pass because `ResponsiveContainer` reads `window.innerWidth`.
- **Toast dispatch mechanism.** Plan said "event bus OR Context". I went with a module-level `listeners: Set<Listener>` + `toast(variant, msg)` export — no Context needed, smaller surface, and TradeBar in 03-03 can call `toast(...)` from any component without importing a hook.

## Auth Gates

None. This plan is pure frontend — no backend changes, no API key handling.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| Center column ("Main chart" / "Portfolio" / "Trade bar" labels) | `frontend/src/components/layout/AppShell.tsx` (CenterColumn, PlaceholderPanel) | Plan 03-02's `<must_haves>` and `<artifacts_this_phase_produces>` list explicitly scope this plan to "left watchlist + full-width header". The center and right columns are owned by plan 03-03 (chart / portfolio / trade / chat). |
| Right column ("AI Assistant" label) | `frontend/src/components/layout/AppShell.tsx` (RightColumn, PlaceholderPanel) | Same — chat panel belongs to plan 03-03. |

These are intentional placeholders matching the plan's per-plan scope, not accidental stubs. Plan 03-03 replaces them.

## Threat Flags

None — no new endpoints, no new auth paths, no new file access. The plan's `<threat_model>` covers all the new surface:

- T-03-04 (XSS via ticker): all tickers rendered via `{ticker}` JSX; no `dangerouslySetInnerHTML` anywhere in the plan's files (verified by grep).
- T-03-05 (Add-ticker validation): client-side regex `/^[A-Z0-9]{1,10}$/` + server-side `isalnum` re-validation in `backend/app/routes/watchlist.py:83` — defense in depth.
- T-03-06 (SSE re-render storm): rAF-debounced `setPrices` coalesces burst SSE messages to one render per frame.
- T-03-07 (SSE parse error): swallowed in useSse's `try/catch`, logged via `console.error`, no sensitive data in the price feed, UI keeps last good state.
- T-03-SC (npm installs): no new packages in this plan (recharts/lucide-react already pinned in 03-01 per RESEARCH package audit).

## Output

- Frontend compiles to `frontend/out/` (Phase 4 Dockerfile copies this into `backend/static/`).
- 3 commits behind the plan base (86dea41) — `cc0857b`, `f2aad8a`, `8855b75`.
- 13 files changed, 1139 insertions, 6 deletions.
- The terminal's real-time spine is live: SSE prices drive Header total + WatchlistRow flashes + Sparklines; ConnectionDot reflects readyState; add/remove works optimistically with revert on failure. Plan 03-03 plugs MainChart + PortfolioPanel + TradeBar + ChatPanel into the existing center/right columns.

## Self-Check

```
[pass] frontend/out/index.html exists
[pass] commit cc0857b present (Task 1)
[pass] commit f2aad8a present (Task 2)
[pass] commit 8855b75 present (Task 3)
[pass] frontend/src/hooks/useSse.ts exists
[pass] frontend/src/context/PriceContext.tsx exists
[pass] frontend/src/context/PortfolioContext.tsx exists
[pass] frontend/src/components/ui/EmptyState.tsx exists
[pass] frontend/src/components/ui/Toast.tsx exists
[pass] frontend/src/components/layout/AppShell.tsx exists
[pass] frontend/src/components/layout/Header.tsx exists
[pass] frontend/src/components/layout/ConnectionDot.tsx exists
[pass] frontend/src/components/watchlist/WatchlistPanel.tsx exists (full impl)
[pass] frontend/src/components/watchlist/WatchlistRow.tsx exists
[pass] frontend/src/components/watchlist/PriceFlash.tsx exists
[pass] frontend/src/components/watchlist/Sparkline.tsx exists
[pass] frontend/src/app/page.tsx renders <AppShell/>
[pass] PortfolioContext does NOT assign total_value into state (D-06)
[pass] All verbatim UI-SPEC copy strings present in source
[pass] No dangerouslySetInnerHTML in any of the new files
[pass] Sparkline has 'use client' + mounted-flag guard
[pass] PriceFlash uses transition-colors duration-500 + bg-profit/20/bg-loss/20
[pass] WatchlistRow remove button has aria-label="Remove {ticker} from watchlist"
[pass] ConnectionDot has role="status" and three verbatim tooltip strings
[pass] Header subscribes to BOTH usePrices() and usePortfolio(), uses useMemo for total
[pass] npx tsc --noEmit exit 0
[pass] npm run build exit 0, frontend/out/ generated
```

Self-Check: PASSED
