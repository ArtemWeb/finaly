---
phase: 03-frontend
fixed_at: 2026-06-27T00:00:00Z
review_path: .planning/phases/03-frontend/03-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-06-27
**Source review:** .planning/phases/03-frontend/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (3 critical + 8 warning; 6 info findings excluded per critical_warning scope)
- Fixed: 11
- Skipped: 0

**Verification gates run:**
- Frontend `tsc --noEmit`: exit 0 (run after every frontend edit, using the project's local TypeScript via a node_modules junction since the worktree had no native install).
- Frontend `npm run build` (Next.js static export): exit 0, generated `out/`. Confirmed CR-03's `min-height:240px` is now present in the emitted CSS (`out/_next/static/css/*.css`), proving the previously-dead Tailwind class is now live. Build run in the main repo because webpack module resolution fails across a node_modules junction in the worktree.
- Frontend `next lint`: exit 0. The only remaining warning (`PortfolioHeatmap.tsx:102` `positions` exhaustive-deps) is pre-existing and unchanged from the base commit `970db32` — not introduced by these fixes.
- Backend `uv run --extra dev pytest -q`: 173 passed (run after the CR-01 and CR-02 backend edits).

## Fixed Issues

### CR-01: Chat "disabled" probe sends a real LLM turn on every mount

**Files modified:** `backend/app/main.py`, `frontend/src/components/chat/ChatPanel.tsx`
**Commit:** 9adcf00
**Applied fix:** Replaced the side-effecting `POST {message:'__probe__'}` chat probe with a side-effect-free signal. Extended `GET /api/health` to return `{"status":"ok","chat_enabled": is_llm_enabled()}` — reusing the existing `backend/app/llm.py:is_llm_enabled()` env-config check, which never invokes the LLM, executes trades, or writes chat history. ChatPanel's mount effect now reads `chat_enabled` from `/api/health` and flips to the disabled empty state only when it is explicitly `false`. This removes the per-mount LLM spend, the hallucinated-trade execution risk, and the `chat_messages` history pollution, and aligns with UI-SPEC line 233.

### CR-02: Dev-gated CORS allows credentials with wildcard methods/headers, gated only on a non-empty origins var

**Files modified:** `backend/app/main.py`
**Commit:** 614b472
**Applied fix:** The credentialed CORS bridge is now gated on BOTH an explicit `ENABLE_CORS=true` (or `1`) opt-in AND a non-empty `CORS_ORIGINS`, so a stray `CORS_ORIGINS` leaking into a production env can no longer silently open credentialed cross-origin access. Methods scoped to `["GET","POST","DELETE","OPTIONS"]` and headers to `["Content-Type"]` instead of wildcards. Added a `logger.warning` at startup whenever the bridge is enabled. No backend tests reference CORS; the suite stays at 173 passed.

### CR-03: Runtime-interpolated Tailwind arbitrary classes never generated — min-height silently fails

**Files modified:** `frontend/src/components/ui/EmptyState.tsx`, `frontend/src/components/chart/MainChart.tsx`, `frontend/src/components/portfolio/PortfolioHeatmap.tsx`
**Commit:** e4f9f1e
**Applied fix:** Added an optional `style?: CSSProperties` prop to `EmptyState` and applied it on the root. MainChart now passes `style={{ minHeight: height - 32 }}` (a runtime prop value) with `minHeightClass=""` instead of the dead `min-h-[${height-32}px]` class. PortfolioHeatmap uses the literal `min-h-[240px]` (HEIGHT is the compile-time constant 240) so Tailwind's static scanner emits it. Verified `min-height:240px` appears in the production CSS after `npm run build`.

### WR-01: PriceContext exposes a mutable ref as the `history` context value

**Files modified:** `frontend/src/context/PriceContext.tsx`
**Commits:** a0960c8, cde0383
**Applied fix:** `handleMessage` and `clearTicker` now rebuild the top-level history Record (shallow copy) on each flush so its object identity changes, making identity-based memoization in consumers correct. A `historyTick` state counter is included in the context-value `useMemo` deps so `value.history` identity advances per flush. Used the stable `setHistoryTick` setter directly (no alias) and a scoped `eslint-disable-next-line react-hooks/exhaustive-deps` for the intentional `historyTick` dep that the lint rule cannot see through the ref read.

### WR-02: `clearTicker` called twice on remove; ring buffer never restored on failed remove

**Files modified:** `frontend/src/context/PortfolioContext.tsx`, `frontend/src/components/watchlist/WatchlistRow.tsx`
**Commit:** 642e2b1
**Applied fix:** Removed the optimistic `clearTicker(ticker)` from `WatchlistRow.handleRemove`; `removeTicker` now owns clearing and only does so AFTER a confirmed-successful DELETE. This eliminates the double-wipe and the phantom empty-sparkline gap when a failed remove reverts the row (no buffer was wiped, so nothing to restore).

### WR-03: `addTicker`/`removeTicker` capture stale `watchlist` via closure, racing the optimistic update

**Files modified:** `frontend/src/context/PortfolioContext.tsx`
**Commit:** 642e2b1
**Applied fix:** Reverts now use surgical functional updaters instead of replacing the whole array with a stale render-time snapshot. `addTicker` tracks whether it actually inserted (`inserted` flag) and reverts by filtering out only that ticker; `removeTicker` captures the removed entry inside the functional updater and re-inserts only that entry if it isn't already back. Removed `watchlist` from both `useCallback` dep arrays, so concurrent in-flight mutations no longer clobber each other.

### WR-04: `WatchlistRow` nests an interactive `role="button"` inside a `<button>`

**Files modified:** `frontend/src/components/watchlist/WatchlistRow.tsx`
**Commit:** 642e2b1
**Applied fix:** The row is now a `<div role="button" tabIndex={0}>` with its own click + Enter/Space keyboard handler, and the remove control is a real sibling `<button>` (no longer a nested interactive `<span role="button">`). This produces valid HTML and removes the screen-reader button-inside-button announcement and keyboard duplication. The remove button keeps the verbatim `aria-label="Remove {ticker} from watchlist"`, native Enter/Space handling, and a `disabled={pendingRemove}` guard.

### WR-05: ChatPanel renders a perpetual pulse skeleton if the availability probe never resolves

**Files modified:** `frontend/src/components/chat/ChatPanel.tsx`
**Commit:** e5fca2a
**Applied fix:** The `/api/health` availability probe is now bounded by an `AbortController` with a 4000ms timeout. On abort/timeout/network-error the panel fails OPEN (`setDisabled(false)`) so the user can always type — the real submit still surfaces errors. The timeout is cleared in `finally` and on effect cleanup, and the controller is aborted on unmount.

### WR-06: `PriceProvider` never cancels pending rAF callbacks on unmount

**Files modified:** `frontend/src/context/PriceContext.tsx`
**Commit:** a0960c8
**Applied fix:** Added a `mountedRef` plus a cleanup effect that cancels both the prices rAF (`rafRef`) and the new history rAF (`historyRafRef`) on unmount. Both rAF callbacks now early-return when `!mountedRef.current`, preventing "state update on unmounted component" warnings from queued frames firing after unmount.

### WR-07: `safeJson` reads `res.json()` after an awaited refresh in `addTicker` success path

**Files modified:** `frontend/src/context/PortfolioContext.tsx`
**Commit:** 642e2b1
**Applied fix:** `addTicker` now reads the response body once (before `refreshWatchlist()`) and treats any 2xx as success regardless of body parseability, returning `true`. An empty 200 body no longer produces a misleading "Couldn't add" toast.

### WR-08: `ConnectionDot` open state uses `bg-accent-blue` but the docstring describes green

**Files modified:** `frontend/src/components/layout/ConnectionDot.tsx`
**Commit:** 1af17ec
**Applied fix:** Reconciled the contradiction by fixing the misleading docstring to say "open → blue (accent-blue)", keeping `bg-accent-blue`. Rationale: the UI-SPEC palette contract (Color table line 89 and the palette bullet line 99) BOTH explicitly assign the "connection-status active dot" / "SSE connected-status dot" to `accent-blue` (#209dd7). Changing the dot to green would contradict the locked palette; the docstring and the single "green" mention at UI-SPEC line 172 were the inaccurate parts.

---

_Fixed: 2026-06-27_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
