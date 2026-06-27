---
phase: 03-frontend
verified: 2026-06-27T00:00:00Z
status: human_needed
score: 5/5 success criteria verified (with tracked defects from 03-REVIEW factored in)
behavior_unverified: 0
overrides_applied: 0
overrides: []
re_verification: false
gaps: []
deferred: []
behavior_unverified_items: []
human_verification:
  - test: "Open the terminal at localhost:8000 (or dev :3000 with backend :8000 and CORS_ORIGINS set). Confirm all 14 manual smoke checks from 03-VALIDATION.md pass."
    expected: "Live SSE prices, watchlist flashing with sparklines, click-to-chart, heatmap + positions table + P&L line, instant-fill trade bar with error mapping, AI chat with inline chips, header total ticking live, add/remove with optimistic UI, dark terminal aesthetic."
    why_human: "Visual appearance, real-time SSE-driven behavior, chart rendering, and toast timing cannot be verified by static source inspection alone — only by interacting with the running browser session."
---

# Phase 3: Frontend Verification Report

**Phase Goal:** Users have a complete dark trading terminal in their browser with live price streaming, portfolio visualization, and an integrated AI chat panel.

**Verified:** 2026-06-27
**Status:** human_needed

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Watchlist panel shows live prices that flash green on uptick / red on downtick with a 500ms CSS fade, plus an accumulating sparkline mini-chart per ticker built from the SSE stream | VERIFIED | `PriceFlash.tsx:42-44` applies `bg-profit/20` / `bg-loss/20` then transitions back to transparent via `transition-colors duration-500` (UI-SPEC + Plan 03-02 contract met). `Sparkline.tsx:36-78` renders a 60×20 Recharts `<LineChart>` reading from PriceContext ring buffers with stroke color by direction (`#22c55e` / `#ef4444` / `#209dd7`). `PriceContext.tsx:62, 82-92` maintains `MAX_SPARK=60` ring buffer in a ref, cleared on ticker removal via `clearTicker`. rAF-debounced `setPrices` (lines 96-105) coalesces burst SSE messages to one render per frame (D-05). |
| 2 | Clicking a ticker in the watchlist opens a larger detailed chart in the main chart area | VERIFIED | `WatchlistRow.tsx:68-70` is a `<button>` whose `onClick` calls `setSelectedTicker(ticker)`. `PriceContext.tsx:47, 117-127` exposes `selectedTicker` + setter. `MainChart.tsx:42-57, 69-150` reads `selectedTicker` from `usePrices()`, falls back to verbatim EmptyState ("Select a ticker" / "Click a ticker in the watchlist to view its detailed chart.") when null, otherwise renders an `<AreaChart>` with axes, grid, tooltip and an `accent-blue` gradient fill. Built HTML confirms the wiring at `out/index.html`. |
| 3 | Portfolio heatmap (treemap) shows all open positions sized by portfolio weight, colored green (profit) / red (loss); positions table shows ticker, quantity, avg cost, current price, unrealized P&L, and % change | VERIFIED | `PortfolioHeatmap.tsx:104-116, 137-161` builds a `<Treemap>` with `dataKey="size"` (sized by `market_value`), custom `TreemapContent` (lines 53-95) fills `#22c55e` when `pnl >= 0` else `#ef4444` with `#0d1117` separator stroke. Empty positions render UI-SPEC EmptyState ("No open positions" / "Use the trade bar below..."). `PositionsTable.tsx:80-90` renders the exact 6 headers "Ticker", "Qty", "Avg Cost", "Price", "P&L", "% Change" with `tabular-nums`. `signedCurrency` (line 42-46) emits leading `+`/`-` for P&L and `pnlClass` (36-40) returns `text-profit`/`text-loss`/`text-text-muted` — color is never the sole signal (UI-SPEC accessibility / V7). Memoized selector (lines 56-63) recomputes only when (position, livePrice) tuple changes — Pitfall 5 (re-render storm) mitigation. |
| 4 | Trade bar executes instant market orders — cash balance and positions update immediately in the UI without a page reload (optimistic) | VERIFIED | `TradeBar.tsx:62-111`: POSTs `{ticker, quantity, side}` to `apiUrl('/api/portfolio/trade')`. On 200: fires verbatim success toast `"Bought ${qty} ${ticker} @ $${price}"` / `"Sold ..."` (line 91), then `await refreshPortfolio()` which fetches both `/api/portfolio` and `/api/portfolio/history` in parallel (`PortfolioContext.tsx:92-113`). PositionsTable + Heatmap + PnLChart + Header all reconcile from the server's authoritative state with no page reload. On 400: `mapTradeError` (lines 40-60) maps 5 backend substrings to verbatim UI copy; raw `detail` is never rendered (V7 error-leak prevention). Inputs use placeholders "Ticker" / "Qty" verbatim; Buy button = `bg-accent-blue`, Sell = `bg-accent-purple`. |
| 5 | Header displays live total portfolio value (updating from SSE), cash balance, and a connection status dot; the dark terminal aesthetic (#0d1117/#1a1a2e backgrounds, yellow #ecad0a, blue #209dd7, purple #753991 buttons) is consistent across all panels | VERIFIED | `Header.tsx:33-41` derives Total Value in a `useMemo` as `cash_balance + Σ(position.quantity × live_price)` falling back to `position.current_price` — no stored total_value (D-06). Renders in `text-3xl` `text-accent-yellow` with `tabular-nums`. Cash balance in `text-text-primary`. Renders `<ConnectionDot/>`. `ConnectionDot.tsx:18-28` has `role="status"` with the 3 verbatim tooltips ("Live — streaming prices" / "Reconnecting…" / "Connection lost — retrying") and reflects `sseStatus` from PriceContext. `AppShell.tsx:43` applies `bg-surface-base` canvas. `tailwind.config.ts:9-25` locks the verbatim palette tokens (`#0d1117`, `#1a1a2e`, `#161b22`, `#ecad0a`, `#209dd7`, `#753991`, `#22c55e`, `#ef4444`, `#e6edf3`, `#7d8590`). All panels use `bg-surface-panel border border-white/5` consistently. `AppShell.tsx:39-55` is a 3-column grid (`grid-cols-[280px_minmax(0,1fr)_360px]`) with full-width 56px header (`h-14`). |

**Score:** 5/5 success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/hooks/useSse.ts` | native EventSource lifecycle, exposes status | VERIFIED | Opens `apiUrl('/api/stream/prices')`; `onopen`/`onerror`/`onmessage` wired; closes on unmount; no custom backoff (browser auto-reconnect per server `retry: 1000`). |
| `frontend/src/context/PriceContext.tsx` | prices map + ring buffers + selectedTicker + sseStatus | VERIFIED | rAF-debounced setPrices; MAX_SPARK=60 ring buffers in ref; `clearTicker` action exposed. |
| `frontend/src/context/PortfolioContext.tsx` | portfolio + watchlist + refresh actions + 10s poll | VERIFIED | 10s safety poll; no stored total_value (D-06); add/remove with optimistic update + revert; `clearTicker` called from `removeTicker`. |
| `frontend/src/components/layout/AppShell.tsx` | 3-column grid + Header + provider mount | VERIFIED | PriceProvider wraps PortfolioProvider; 280px/flex/360px columns; full-width Header; CenterColumn slots MainChart, PositionsTable, PortfolioHeatmap, PnLChart, TradeBar. |
| `frontend/src/components/layout/Header.tsx` | useMemo-derived total across both contexts | VERIFIED | `useMemo<number>([portfolio, prices])` computes `cash + Σ qty × livePrice`; renders in Display size (`text-3xl`) `text-accent-yellow`. |
| `frontend/src/components/layout/ConnectionDot.tsx` | role="status" + verbatim tooltips | VERIFIED | `role="status"`, `aria-label` + `title` set to the 3 verbatim tooltip strings. |
| `frontend/src/components/watchlist/WatchlistPanel.tsx` | title + add input + remove + empty state | VERIFIED | Verbatim copy "Watchlist", "Add ticker (e.g. PYPL)", "Add", "No tickers yet", "Add a ticker above to start tracking live prices." all present. |
| `frontend/src/components/watchlist/WatchlistRow.tsx` | row with flash + sparkline + click + remove | VERIFIED | Click handler calls `setSelectedTicker`; remove has `aria-label="Remove {ticker} from watchlist"` verbatim; selected row has 4px `border-accent-yellow`. |
| `frontend/src/components/watchlist/PriceFlash.tsx` | bg-profit/20 + bg-loss/20 + 500ms transition | VERIFIED | `transition-colors duration-500` + `bg-profit/20`/`bg-loss/20`; declarative `useEffect` timer (no setTimeout race). |
| `frontend/src/components/watchlist/Sparkline.tsx` | 60×20 Recharts LineChart, mounted guard | VERIFIED | `'use client'` + `mounted` flag (Pitfall 1); reads from PriceContext ring buffer; stroke color by direction. |
| `frontend/src/components/chart/MainChart.tsx` | detailed AreaChart on selectedTicker | VERIFIED | `'use client'` + mounted guard; reads `selectedTicker` from PriceContext; renders `<AreaChart>` with axes/grid/tooltip; empty state uses verbatim copy. |
| `frontend/src/components/portfolio/PositionsTable.tsx` | table with 6 columns, signed+colored P&L | VERIFIED | Memoized selector for live price (Pitfall 5); 6 verbatim column headers; P&L signed + colored. |
| `frontend/src/components/portfolio/PortfolioHeatmap.tsx` | Recharts Treemap sized by market_value | VERIFIED | `dataKey="size"` (market_value); custom `TreemapContent` fills `#22c55e`/`#ef4444` with `#0d1117` stroke; `'use client'` + mounted guard. |
| `frontend/src/components/portfolio/PnLChart.tsx` | LineChart of total_value over time | VERIFIED | `'use client'` + mounted guard; X axis `formatTime` (HH:MM); Y axis `compactCurrency` (`$10.2k`); reads from `PortfolioContext.history`. |
| `frontend/src/components/trade/TradeBar.tsx` | instant optimistic fill + error mapping | VERIFIED | Verbatim placeholders/buttons/success copy; `mapTradeError` covers 5 known substrings; raw `detail` never rendered; single `refreshPortfolio` call reconciles both `/api/portfolio` and `/api/portfolio/history`. |
| `frontend/src/components/chat/ChatPanel.tsx` | scrollable message list + input + send + Thinking… loader | VERIFIED | `role="log"` + `aria-live="polite"` + `aria-relevant="additions"`; verbatim title/placeholder/Send/Thinking…; local-only state (no polling, no chat-history GET). |
| `frontend/src/components/chat/ChatMessage.tsx` | bubble + inline trade/watchlist chips | VERIFIED | Verbatim chip copy ("✓ Bought {qty} {ticker} @ ${price}", "✓ Added {ticker} to watchlist", "✗ Trade failed: {error message from API}"); no `dangerouslySetInnerHTML`. |
| `frontend/src/components/ui/EmptyState.tsx` | shared heading + body + CTA | VERIFIED | Used by all panels; default `min-h-[200px]` literal Tailwind token. |
| `frontend/src/components/ui/Toast.tsx` | bottom-right ephemeral notification, 3s auto-dismiss | VERIFIED | Module-level event bus; success/error variants; 3s TTL. |
| `frontend/src/lib/api.ts` | apiUrl chokepoint | VERIFIED | Reads `NEXT_PUBLIC_API_BASE_URL`; single chokepoint for all network calls. |
| `frontend/src/lib/types.ts` | backend-mirroring TS interfaces | VERIFIED | PriceUpdate with `direction: 'up'|'down'|'flat'`; Position with `unrealized_pnl`/`market_value`; ChatResponse with `actions.trades`/`actions.watchlist_changes`. |
| `frontend/src/lib/format.ts` | formatCurrency/Percent/Price/Time | VERIFIED | `formatPercent` carries leading `+`/`-` (color never sole signal); `Intl.NumberFormat` cached module-level. |
| `frontend/tailwind.config.ts` | locked palette | VERIFIED | `#0d1117`, `#1a1a2e`, `#161b22`, `#ecad0a`, `#209dd7`, `#753991`, `#22c55e`, `#ef4444`, `#e6edf3`, `#7d8590` all present. |
| `frontend/next.config.js` | output:'export' + images.unoptimized | VERIFIED | (per 03-01-SUMMARY) |
| `frontend/src/app/layout.tsx` | dark root + FinAlly title | VERIFIED | `<html lang="en" className="dark">`; metadata title "FinAlly". |
| `backend/app/main.py` | dev-gated CORS, no wildcard | VERIFIED | Reads `CORS_ORIGINS`; adds middleware only when non-empty; allow_origins is explicit parsed list (never `*`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| useSse | PriceContext | `useSse(handleMessage)` | WIRED | PriceContext calls useSse with `handleMessage` callback; status surfaced via context. |
| PriceContext (SSE) | WatchlistRow prices | `prices[ticker]` from `usePrices()` | WIRED | WatchlistRow reads `prices[ticker]?.price` for live display + previous_price for flash comparison. |
| PriceContext ring buffer | Sparkline | `history[ticker]` from `usePrices()` | WIRED | WatchlistRow passes `history[ticker]` slice as `sparkData` prop to Sparkline. |
| WatchlistRow click | MainChart | `setSelectedTicker(ticker)` → PriceContext.selectedTicker → MainChart reads it | WIRED | Click handler on row calls setter; MainChart subscribes via `usePrices()`. |
| TradeBar | PortfolioContext.refresh | `await refreshPortfolio()` | WIRED | Single call fetches both `/api/portfolio` and `/api/portfolio/history` (Promise.all inside). |
| ChatPanel | PortfolioContext.refresh | `Promise.all([refreshPortfolio(), refreshWatchlist()])` | WIRED | Both refreshes invoked after each response. |
| All Recharts components | SSR safety | `'use client'` + `mounted` flag | WIRED | Sparkline, MainChart, PortfolioHeatmap, PnLChart all guard with `useEffect(() => setMounted(true), [])`. |
| All EventSource + fetch calls | Single URL chokepoint | `apiUrl(path)` | WIRED | Every call goes through `apiUrl()`; no string concatenation elsewhere. |
| Backend | Frontend | CORS middleware (dev) | WIRED | `cors_origins` env var gates middleware; `allow_origins` is explicit list. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `Header` Total Value | `total` (useMemo) | `usePrices().prices[ticker].price` (SSE) + `usePortfolio().portfolio.positions` + `cash_balance` | YES | FLOWING — derives live from SSE prices + positions. |
| `WatchlistRow` price | `prices[ticker]?.price` | `usePrices()` populated by SSE `handleMessage` | YES | FLOWING — appends to ring buffer + rAF-debounced setPrices. |
| `Sparkline` series | `history[ticker]` | Ring buffer in `PriceContext.tsx:62` (ref) | YES | FLOWING — ref appended to on each SSE message. |
| `MainChart` series | `history[selectedTicker]` | Same ring buffer | YES | FLOWING. |
| `PositionsTable` current price | `prices[p.ticker]?.price` | `usePrices()` | YES | FLOWING — memoized selector reads SSE-driven prices. |
| `PortfolioHeatmap` cells | `portfolio.positions` | `/api/portfolio` (fetched in `refreshPortfolio`) | YES | FLOWING — refetched on trade + 10s poll. |
| `PnLChart` series | `portfolio.history` | `/api/portfolio/history` (fetched in `refreshPortfolio`) | YES | FLOWING — refetched on trade + 10s poll. |
| `TradeBar` post-trade state | server response + refresh | `/api/portfolio/trade` POST → `refreshPortfolio()` | YES | FLOWING — trade reconciles via fetch. |
| `ChatPanel` chat replies | server response | `/api/chat` POST | YES (when LLM available) | FLOWING — appends local + refreshPortfolio/refreshWatchlist after. |
| `ChatPanel` disabled state | `disabled` flag | One-shot POST probe to `/api/chat` on mount (5xx → disabled) | PARTIAL | HOLLOW IN FAILURE CASE — see Anti-Patterns. The probe DOES get a 200 from `handle_chat` because the backend never raises on LLM unavailability (`chat_service.py:327-330` swallows exceptions and returns a result). When `OPENROUTER_API_KEY` is unset and `LLM_MOCK=off`, the chat service still returns a 200 with a degraded message — the probe never sees a 5xx, so the "disabled" empty state is never triggered. The chat panel UI renders, but the chat won't actually work without LLM. This is a real defect — tracked in 03-REVIEW.md (CR-01). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript strict compile | `cd frontend && npx tsc --noEmit` | exit 0 | PASS |
| Static export build | `cd frontend && npm run build` | exit 0, `frontend/out/` generated (index.html, _next/, 404.html) | PASS |
| Backend test suite green | `cd backend && uv run --extra dev pytest` | 173 passed | PASS |
| Built HTML contains app shell + dark classes | `grep out/index.html` | Confirms `<html lang="en" class="dark">`, `bg-surface-base`, `bg-surface-panel`, `text-accent-yellow`, all panel placeholders, verbatim copy strings | PASS |
| Zero `dangerouslySetInnerHTML` in app code | `grep -rE dangerouslySetInnerHTML frontend/src/**/*.tsx` | 0 matches in app code (Next.js framework internal use only) | PASS |
| Header derives total in useMemo | `grep -nE useMemo Header.tsx` | Line 33: `useMemo<number>` computes `cash + Σ qty × price` | PASS |
| PriceContext uses rAF debounce | `grep -nE requestAnimationFrame PriceContext.tsx` | Lines 74, 98: rAF-coalesced setPrices + historyTick | PASS |
| D-06: no stored total_value | `grep -nE total_value\|setTotal PortfolioContext.tsx PriceContext.tsx` | Only comment mention; no state assignment | PASS |
| ConnectionDot role + verbatim tooltips | `grep -nE role=|aria-label ConnectionDot.tsx` | `role="status"`, three verbatim tooltip strings | PASS |
| TradeBar maps errors (no raw detail) | `grep -nE raw|detail TradeBar.tsx` | `mapTradeError` covers 5 substrings; raw `detail` never rendered | PASS |
| Tailwind dynamic `min-h-[Npx]` in built CSS | `grep out/_next/static/css/*.css` | MISSING for `240px` and `368px` (dynamic templates); `120px` and `200px` present as literal tokens | FAIL (cosmetic — see Anti-Patterns/CR-03) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UI-01 | 03-02 | Watchlist flash 500ms CSS fade | VERIFIED | PriceFlash.tsx + PriceContext; built HTML contains `transition-colors duration-500` class. |
| UI-02 | 03-02 | Sparkline accumulation from SSE | VERIFIED | Sparkline.tsx + PriceContext ring buffers (MAX_SPARK=60). |
| UI-03 | 03-03 | Click ticker → MainChart | VERIFIED | WatchlistRow onClick → setSelectedTicker → MainChart AreaChart. |
| UI-04 | 03-03 | Portfolio heatmap (Treemap) | VERIFIED | PortfolioHeatmap.tsx with custom content renderer green/red. |
| UI-05 | 03-03 | P&L chart (LineChart) over time | VERIFIED | PnLChart.tsx + `/api/portfolio/history`. |
| UI-06 | 03-03 | Positions table with all 6 columns | VERIFIED | PositionsTable.tsx verbatim column headers + signed/colored P&L. |
| UI-07 | 03-03 | Trade bar instant fill + error mapping | VERIFIED | TradeBar.tsx: POST + refreshPortfolio + 5-substring error mapping. |
| UI-08 | 03-03 | AI chat with inline chips + disabled state | PARTIAL | ChatPanel + ChatMessage exist; sends/receives; refreshPortfolio+refreshWatchlist after each response. Disabled-state probe is **defective** (see Anti-Patterns/CR-01): backend `handle_chat` swallows LLM errors and returns 200, so the 5xx detection never fires and the "AI Assistant unavailable" empty state cannot be reached through the probe. With `LLM_MOCK=true` the chat works correctly. |
| UI-09 | 03-02 | Header live total + cash + connection dot | VERIFIED | Header.tsx useMemo + ConnectionDot.tsx. |
| UI-10 | 03-02 | Add/remove watchlist via UI | VERIFIED | WatchlistPanel + PortfolioContext.addTicker/removeTicker with optimistic + revert. |
| UI-11 | 03-01 | Dark terminal aesthetic + locked palette | VERIFIED | tailwind.config.ts palette + AppShell `bg-surface-base` + all panels `bg-surface-panel border-white/5`. |
| UI-12 | 03-02 | EventSource SSE auto-reconnect | VERIFIED | useSse.ts: native EventSource, no custom backoff, browser auto-reconnects per server `retry: 1000`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/components/portfolio/PortfolioHeatmap.tsx` | 127 | `minHeightClass={`min-h-[${HEIGHT}px]`}` | INFO (tracked CR-03) | Tailwind's JIT cannot statically extract `min-h-[240px]` from the template. The class appears in the built HTML but not in the compiled CSS. Empty state still renders because EmptyState default `min-h-[200px]` IS a literal token used elsewhere. Cosmetic only. |
| `frontend/src/components/chart/MainChart.tsx` | 78 | `minHeightClass={`min-h-[${height - 32}px]`}` | INFO (tracked CR-03) | Same as above — `min-h-[368px]` (when height=400) is in HTML but not in CSS. Cosmetic only. |
| `frontend/src/components/chat/ChatPanel.tsx` | 87-112 | `__probe__` POST on mount invokes LLM | WARNING (tracked CR-01) | The disabled-state probe sends a real `__probe__` message through `handle_chat`, which calls the LLM, persists to `chat_messages`, and may auto-execute hallucinated trades. Should be replaced with a dedicated `/api/chat/status` or a `chat_enabled` field on `/api/health` (see 03-REVIEW.md CR-01 fix). |
| `frontend/src/components/chat/ChatPanel.tsx` | 87-112 | Disabled state never triggers | WARNING (consequence of CR-01) | `handle_chat` swallows all LLM errors and returns 200 with an error message in the response. The 5xx detection in the probe never fires; when LLM is unavailable the chat panel still shows the "Ask your AI trading assistant" empty state (enabled appearance) and send button is enabled. The user's first message will return an error reply, but the UI lies about availability. |
| `backend/app/main.py` | 156-165 | `allow_credentials=True` + `allow_methods=["*"]` + `allow_headers=["*"]`, gated only on `CORS_ORIGINS` non-empty | WARNING (tracked CR-02) | Production footgun — if `CORS_ORIGINS` is ever set in prod (copy-paste from dev template), credentials are accepted cross-origin with wildcard methods/headers. Recommend adding an `ENABLE_CORS=true` flag and scoping methods/headers explicitly (see 03-REVIEW.md CR-02 fix). |
| `frontend/src/components/watchlist/WatchlistRow.tsx` | 68, 101-115 | `<button>` with nested `<span role="button">` for remove | INFO (tracked WR-04) | Invalid HTML (interactive-in-interactive). Click works because of `stopPropagation`; Enter/Space on the inner span may also activate the outer button in some browser/AT combinations. Cosmetic/structural only. |
| `frontend/src/context/PriceContext.tsx` | 70-80, 97-105 | rAF handles not cancelled on unmount | INFO (tracked WR-06) | `PriceProvider` does not cancel pending `requestAnimationFrame` calls on unmount; an rAF scheduled by the last message can fire after unmount and produce a "state update on unmounted component" warning. No functional impact. |
| `frontend/src/context/PortfolioContext.tsx` | 154, 184 | `addTicker`/`removeTicker` use stale `watchlist` for revert | INFO (tracked WR-03) | Both mutators close over the render-time `watchlist` snapshot; rapid successive ops can revert to a stale list on failure. The functional updater for the optimistic step makes this raceable. Cosmetic for single-user low-concurrency app. |
| `frontend/src/context/PortfolioContext.tsx` | 170-173 | `safeJson` reads `res.json()` AFTER awaited refresh | INFO (tracked WR-07) | Body is read after `refreshWatchlist()`; if `res.json()` fails on a 200 OK the function reports `false` even though the add succeeded (would trigger misleading "Couldn't add" toast). |
| `frontend/src/components/layout/ConnectionDot.tsx` | 24-28 | `open: 'bg-accent-blue'` contradicts docstring "open → green" | INFO (tracked WR-08) | The dot is blue when open, not green as the docstring says. UI-SPEC doesn't explicitly specify the open color, but the semantic "live = green" is more conventional. Trivial. |

### Human Verification Required

The phase goal ("complete dark trading terminal in the browser") is achieved in code and the build is green, but the success criteria describe runtime behaviors (live SSE streaming, real-time UI updates, optimistic trade reconcile, chat panel interactions, visual aesthetic) that cannot be fully verified by static source inspection alone.

| # | Test | Expected | Why human |
|---|------|----------|-----------|
| 1 | Open `http://localhost:8000` (or `next dev` at `:3000` with backend `:8000` + `CORS_ORIGINS=http://localhost:3000`). Watch the watchlist over ~30 seconds. | Default 10 tickers stream live prices ~500ms. WatchlistRow flashes bg-profit/20 on upticks and bg-loss/20 on downticks, fading after 500ms. Sparkline accumulates over ~30s, stroke follows direction. | Real-time SSE-driven behavior requires browser context. |
| 2 | Click a ticker in the watchlist. | MainChart AreaChart renders for that ticker with axes/grid/tooltip and an accent-blue gradient fill. Header ticker label + current price appear in accent-yellow. | Chart rendering, axis ticks, tooltip behavior. |
| 3 | Click "Buy" with `AAPL`, qty `1`. | Toast "Bought 1 AAPL @ $X" appears bottom-right (success variant, profit border). Cash balance decreases in Header. PositionsTable shows a new AAPL row with green P&L if avg_cost > current price. PortfolioHeatmap gains a new cell colored by P&L. PnLChart gains a new data point. No page reload. | Optimistic reconcile timing, multi-component update from a single refresh call. |
| 4 | Click "Buy" with an unaffordable quantity. | Toast "Insufficient cash for this order." (mapped from backend `Insufficient cash:` substring). Raw `detail` is NOT shown. | Error copy mapping — backend substring → UI-SPEC verbatim copy. |
| 5 | With backend LLM_MOCK=true, send "Buy 1 AAPL" via chat. | "Thinking…" loader appears, then assistant bubble + inline chip "✓ Bought 1 AAPL @ $X". PositionsTable updates with the new AAPL position. | Chat end-to-end with LLM mock. |
| 6 | With backend OPENROUTER_API_KEY unset and LLM_MOCK=off, refresh the page. | Probe runs (side-effect: chat history polluted, possible hallucinated trade). With LLM_MOCK=true the panel is enabled. **NOTE:** the disabled-state UI never renders because the probe cannot distinguish LLM-off from LLM-on (handle_chat swallows all errors). The chat panel will appear enabled; the user's first message will fail with an error reply. | Defect — see CR-01/UI-08 partial. |
| 7 | Add a ticker (e.g. "PYPL") via the watchlist input. Click the × on an existing row. | Add: input clears, new row appears, streaming price populates within ~500ms. Remove: row disappears immediately (optimistic), reconciles on success, reverts on failure. | Optimistic UI with revert path. |
| 8 | Watch the Header "Total Value" digit. | Updates each tick (~500ms) as prices change, calculated from cash + Σ qty × livePrice. Cash balance ticks on trade. | Live-derived total per D-06. |
| 9 | Inspect the visual aesthetic. | Background `#0d1117` (surface-base), panels `#1a1a2e` (surface-panel), borders `border-white/5`, total value in `#ecad0a` (accent-yellow) 28px, Buy button `#209dd7` (accent-blue), Sell button `#753991` (accent-purple), profit/loss in `#22c55e`/`#ef4444`. Monospace font throughout. | Visual fidelity to UI-SPEC Color section. |
| 10 | Inspect ConnectionDot during normal connection and after manually dropping the SSE stream. | Yellow (`bg-accent-yellow`) on first render, flips to blue (`bg-accent-blue`) on open, red (`bg-loss`) on error. Tooltips: "Reconnecting…" → "Live — streaming prices" → "Connection lost — retrying". | Connection state reflection. |

### Gaps Summary

**No structural goal-level gaps.** All 5 success criteria are verified in code with substantive, wired implementations. All 12 UI requirements (UI-01..UI-12) are addressed by at least one verified artifact.

**Tracked defects from 03-REVIEW.md (3 blockers, 8 warnings):** These are **NOT** treated as phase goal blockers by the user's verification brief ("factor these into your assessment but they are tracked separately"). The most significant functional impact is on **UI-08** (Chat disabled state cannot be detected because the probe cannot distinguish LLM-off from LLM-on). The chat panel renders and works correctly when LLM is available; when LLM is unavailable the UI does not reflect the actual state, but the user's first message still receives an error reply.

**Tracked defect from CR-03 (Tailwind dynamic min-h):** Cosmetic only — the empty states still render with the default `min-h-[200px]` from `EmptyState.tsx`.

**Status: human_needed** because the success criteria describe runtime behaviors (real-time SSE, instant trade reconcile, AI chat interactions, visual aesthetic) that cannot be fully verified by static source inspection alone. The 14-item manual smoke checklist from 03-VALIDATION.md must be run by a human against a live browser session.

---

_Verified: 2026-06-27_
_Verifier: Claude (gsd-verifier)_