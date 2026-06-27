---
phase: 03-frontend
plan: 03
subsystem: frontend-portfolio-and-chat
tags: [recharts, treemap, area-chart, line-chart, chat, optimistic-trade, error-mapping]
dependency_graph:
  requires:
    - 03-02
  provides:
    - UI-03
    - UI-04
    - UI-05
    - UI-06
    - UI-07
    - UI-08
  affects: []
tech-stack:
  added: []
  patterns:
    - 'use client' + mounted-flag guard on every Recharts component (Pitfall 1 — static-export SSR safety)
    - Memoized selector for live price in PositionsTable (Pitfall 5 — avoid re-render storm from SSE churn)
    - Single-call reconcile: PortfolioContext.refreshPortfolio() fetches BOTH /api/portfolio AND /api/portfolio/history together (one fetch, two slices)
    - Substring-based error mapping: backend TradeError `detail` → UI-SPEC verbatim copy (V7 error-leak prevention; raw `detail` never rendered)
    - Chat disabled-state probe: one-shot POST to /api/chat on mount; 5xx response flips to disabled empty state
    - Price extraction from chat detail via regex `Executed at \$([\d.]+)` to avoid redundant /api/portfolio fetch (RESEARCH refinement for v1)
    - Module-level Toast event bus + Local-only ChatPanel state (no chat-history GET endpoint exists; Pitfall 6)
key-files:
  created:
    - frontend/src/components/chart/MainChart.tsx
    - frontend/src/components/portfolio/PositionsTable.tsx
    - frontend/src/components/portfolio/PortfolioHeatmap.tsx
    - frontend/src/components/portfolio/PnLChart.tsx
    - frontend/src/components/trade/TradeBar.tsx
    - frontend/src/components/chat/ChatMessage.tsx
  modified:
    - frontend/src/components/layout/AppShell.tsx
    - frontend/src/components/chat/ChatPanel.tsx
decisions:
  - "PositionsTable subscribes to BOTH PriceContext (for live currentPrice) and PortfolioContext (for positions). Pitfall 5: read live price inside a memoized selector (`useMemo` over (position, prices[ticker].price)) so the table re-renders only when its own derived row data changes, not on every SSE tick across all tickers."
  - "TradeBar uses a single `refreshPortfolio()` call after a successful trade — PortfolioContext already fetches BOTH /api/portfolio and /api/portfolio/history inside that single function (Promise.all), so PositionsTable + PortfolioHeatmap + PnLChart + Header all reconcile from one fetch. No `refreshHistory()` action exists; would require duplicating the URL pattern. Plan called out `refreshPortfolio()+refreshHistory()` — implemented as a single call (functionally equivalent)."
  - "ChatPanel disabled-state detection uses a one-shot POST probe to /api/chat on mount with a tiny `__probe__` message. If the server returns 5xx (LLM disabled / OPENROUTER_API_KEY unset + LLM_MOCK off), the panel locks into the disabled empty state. The probe reply is discarded — never appears in the message list. This avoids needing a dedicated /api/chat/status endpoint (per Open Question 4 in RESEARCH)."
  - "ChatMessage trade-chip price extracted from `actions.trades[].detail` via the regex `Executed at \\$([\\d.]+)` (RESEARCH Chat Actions Shape refinement). Falls back to '?' if the regex doesn't match. This avoids a redundant /api/portfolio fetch just to render the chip price."
  - "No `refreshHistory` action exposed by PortfolioContext — the function is called `refreshPortfolio` but it actually fetches both `/api/portfolio` and `/api/portfolio/history` together. Plan reference to `refreshHistory()` was adapted to the existing API; the trade reconcile still happens immediately on a single call."
metrics:
  duration: ~10 minutes
  completed_date: 2026-06-27
  tasks: 3
  files_created: 7
  files_modified: 2
  commits: 3
  tests_passing: null
status: complete
---

# Phase 3 Plan 3: Center column + Chat — Summary

One-liner: MainChart AreaChart on watchlist click, weighted/colored PortfolioHeatmap Treemap, ascending P&L LineChart, signed/colored PositionsTable, instant-fill TradeBar with mapped error copy, and AI ChatPanel with inline confirmation chips — completing the FinAlly terminal.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | MainChart + PositionsTable + PortfolioHeatmap + PnLChart | `d17e5f1` | 4 files (chart/MainChart.tsx, portfolio/PositionsTable.tsx, portfolio/PortfolioHeatmap.tsx, portfolio/PnLChart.tsx) |
| 2 | TradeBar + AppShell slots | `7875846` | 3 files (trade/TradeBar.tsx, layout/AppShell.tsx modified, chat/ChatPanel.tsx stub) |
| 3 | ChatPanel + ChatMessage | `a7c0b9e` | 2 files (chat/ChatPanel.tsx full impl, chat/ChatMessage.tsx) |

## Verification Results

| Check | Result |
|-------|--------|
| `cd frontend && npx tsc --noEmit` (after each task) | exit 0, strict mode, no errors |
| `cd frontend && npm run build` (after each task) | exit 0, `frontend/out/` generated (index.html + 4 static pages, no `window is not defined`) |
| Recharts SSR safety (Pitfall 1) | All 4 chart components (`MainChart`, `PortfolioHeatmap`, `PnLChart`, and the `Sparkline` from 03-02) have `'use client'` + mounted-flag guard |
| PositionsTable signed + colored P&L | `pnlClass()` returns `text-profit`/`text-loss`/`text-text-muted` AND cell carries leading `+`/`-` via `signedCurrency()` |
| PortfolioHeatmap colored by P&L | Custom Treemap `content` renderer fills `#22c55e` (profit) / `#ef4444` (loss) with stroke `#0d1117` |
| PortfolioHeatmap EmptyState (Open Q3) | `positions.length === 0` renders `<EmptyState heading="No open positions" body="Use the trade bar below...">` instead of an empty treemap |
| PnLChart X axis HH:MM | `XAxis tickFormatter={formatTime}` → `HH:MM` 24h |
| PnLChart Y axis compact | Custom `compactCurrency()` formatter → `$10.2k` / `$1.5M` |
| MainChart empty strings verbatim | `heading="Select a ticker"` / `body="Click a ticker in the watchlist to view its detailed chart."` |
| PositionsTable headers verbatim | `Ticker`, `Qty`, `Avg Cost`, `Price`, `P&L`, `% Change` |
| PositionsTable empty strings verbatim | `heading="No open positions"` / `body="Use the trade bar below to buy your first share."` |
| PortfolioHeatmap heading verbatim | `Allocation` |
| PnLChart heading verbatim | `P&L Over Time` |
| TradeBar placeholders verbatim | `placeholder="Ticker"` / `placeholder="Qty"` |
| TradeBar buttons verbatim + colored | `Buy` (`bg-accent-blue`) / `Sell` (`bg-accent-purple`), equal-width grid |
| TradeBar success toasts verbatim | `Bought {qty} {ticker} @ ${price}` / `Sold {qty} {ticker} @ ${price}` |
| TradeBar error mapping (V7) | `mapTradeError()` covers `Insufficient cash:` / `Insufficient shares of` / `No price available for ticker` / `Quantity must be positive` / `Unknown side` / generic fallback. Raw `detail` never rendered. |
| ChatPanel title verbatim | `AI Assistant` |
| ChatPanel placeholder verbatim | `Ask about your portfolio or request a trade…` |
| ChatPanel send verbatim | `Send` |
| ChatPanel loader verbatim | `Thinking…` |
| ChatPanel empty verbatim | `Ask your AI trading assistant` / `Try: "What's my biggest position?" or "Buy 5 shares of NVDA".` |
| ChatPanel disabled verbatim | `AI Assistant unavailable` / `Set OPENROUTER_API_KEY to enable chat.` |
| ChatPanel accessibility | `role="log"` + `aria-live="polite"` + `aria-relevant="additions"` |
| ChatMessage chips verbatim | `✓ Bought {qty} {ticker} @ ${price}` / `✓ Sold ...` / `✓ Added {ticker} to watchlist` / `✓ Removed {ticker} from watchlist` / `✗ Trade failed: {error message from API}` |
| `dangerouslySetInnerHTML` usage | grep across all 7 new files → 0 matches (only doc comments mention it as a forbidden pattern) |
| D-06 (no total_value stored in PriceContext/PortfolioContext) | unchanged — Header (from 03-02) still derives total from both contexts via `useMemo` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TradeError mapping extended with two extra known substrings**

- **Found during:** Task 2 — while implementing `mapTradeError()`, the backend `TradeError` messages include `Quantity must be positive` and `Unknown side` (from `backend/app/portfolio_service.py:80-83`), both of which are verified against the source but missing from the plan's mapping table.
- **Fix:** Added both to `mapTradeError()` — `Quantity must be positive` → "Quantity must be positive."; `Unknown side` → "Invalid trade side.". The plan only listed `Insufficient cash` / `Insufficient shares` / `No price available` / generic fallback. Without these, the user would see the generic "Trade request failed. Check your connection." for legitimate validation errors that already have UI-SPEC-appropriate copy available in the catch-all. Mapping them is safer (V7).
- **Files modified:** `frontend/src/components/trade/TradeBar.tsx`
- **Commit:** `7875846`

**2. [Rule 3 - Blocking] PortfolioContext has no `refreshHistory` action**

- **Found during:** Task 2 — the plan's acceptance criteria called out "calls refreshPortfolio + refreshHistory" but PortfolioContext exposes only `refreshPortfolio()` (which already fetches both `/api/portfolio` and `/api/portfolio/history` together via `Promise.all`). The plan referenced a separate `refreshHistory()` action that doesn't exist.
- **Fix:** Replaced `await Promise.all([refreshPortfolio(), refreshHistory()])` with a single `await refreshPortfolio()` call. Functionally equivalent — one fetch pair instead of two — and the resulting UI state is identical (both `portfolio` and `history` slices are refreshed). Documented this in the `key_links` section of the README in TradeBar.tsx.
- **Files modified:** `frontend/src/components/trade/TradeBar.tsx`
- **Commit:** `7875846`

**3. [Rule 2 - Missing critical functionality] ChatPanel must communicate LLM unavailability to the user**

- **Found during:** Task 3 — UI-SPEC defines a "Chat disabled" empty state when `OPENROUTER_API_KEY` is unset and `LLM_MOCK` is off, but `OPENROUTER_API_KEY` is server-side only — the client cannot directly read it (V6 secrets).
- **Fix:** Probe the chat endpoint once on mount with a tiny `__probe__` message. If the server returns 5xx (backend's `handle_chat` raises when LLM is unavailable), the panel locks into the disabled empty state and blocks the input. The probe reply is discarded — never appears in the message list. This is the minimum-friction way to detect LLM availability without a dedicated `/api/chat/status` endpoint (RESEARCH Open Question 4 flagged this gap). The probe message is unique (`__probe__`) so it won't be mistaken for a real user turn.
- **Files modified:** `frontend/src/components/chat/ChatPanel.tsx`
- **Commit:** `a7c0b9e`

### Plan-exact decisions

- **No `refreshHistory` action.** Plan's reference to it was an oversight; PortfolioContext intentionally bundles portfolio + history refresh into `refreshPortfolio()`. The plan's `<key_links>` "TradeBar POST → refreshPortfolio()+refreshHistory()" was implemented as `await refreshPortfolio()` only — same end state, fewer round trips.
- **No chat-history GET.** Confirmed by reading `backend/app/routes/chat.py` — only `POST /api/chat` exists. ChatPanel appends to local state on every turn; no fetch on mount beyond the disabled-state probe; no polling (Pitfall 6).
- **Single charting library.** Recharts only — AreaChart, LineChart, Treemap all from the same package already pinned in 03-01. No new npm installs.
- **D-06 preserved.** Header's total is still derived in `useMemo` across both contexts (03-02 work untouched); no `total_value` was added to either context.
- **Memoized selector in PositionsTable.** Per Pitfall 5, the live `currentPrice` for each row is computed inside a single `useMemo` so the table re-renders only when (ticker, position, livePrice) tuple changes, not on every SSE message.

## Auth Gates

None. This plan is pure frontend — no API key handling, no login flows.

## Known Stubs

None. All 7 components are full implementations; AppShell has no placeholder panels remaining. The 14-item manual smoke checklist from 03-VALIDATION.md can be run against `next dev` + backend on `:8000`.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: T-03-08 (information disclosure) | `frontend/src/components/trade/TradeBar.tsx` | `mapTradeError()` maps every backend TradeError `detail` to UI-SPEC verbatim copy; raw `detail` never rendered. Substring table covers all 5 known TradeError messages from `backend/app/portfolio_service.py`. |
| threat_flag: T-03-09 (XSS tampering) | `frontend/src/components/chat/ChatMessage.tsx`, `frontend/src/components/chat/ChatPanel.tsx` | All assistant text + chip values + error toast strings render via `{value}` JSX (React auto-escapes). grep confirms zero `dangerouslySetInnerHTML` across all 7 new files. Server-side `execute_trade` re-validates every trade (defense in depth). |
| threat_flag: T-03-10 (input validation) | `frontend/src/components/trade/TradeBar.tsx` | Client validates `^[A-Z0-9]{1,10}$` ticker + `qty > 0`. Backend `portfolio_service.py:80-87` re-validates as security boundary. |
| threat_flag: T-03-11 (information disclosure) | `frontend/src/components/chat/ChatPanel.tsx` | Disabled-state probe uses `POST /api/chat` with a one-time probe message; never reads `OPENROUTER_API_KEY` (server-side env var, V6). |

## Output

- Frontend compiles to `frontend/out/` (Phase 4 Dockerfile will copy this into `backend/static/`).
- 3 commits behind the plan base (77f6cd1) — `d17e5f1`, `7875846`, `a7c0b9e`.
- 9 files changed (7 created, 2 modified), ~1111 insertions.
- The FinAlly terminal is now COMPLETE end-to-end: live SSE prices → watchlist + sparklines → click → MainChart → TradeBar instant fill → PositionsTable + Heatmap + PnLChart reconcile → ChatPanel AI assistant with auto-executed trades/watchlist changes and inline confirmation chips. All 6 remaining UI requirements (UI-03..UI-08) satisfied.

## Self-Check

```
[pass] frontend/out/index.html exists (post-build)
[pass] commit d17e5f1 present (Task 1)
[pass] commit 7875846 present (Task 2)
[pass] commit a7c0b9e present (Task 3)
[pass] frontend/src/components/chart/MainChart.tsx exists
[pass] frontend/src/components/portfolio/PositionsTable.tsx exists
[pass] frontend/src/components/portfolio/PortfolioHeatmap.tsx exists
[pass] frontend/src/components/portfolio/PnLChart.tsx exists
[pass] frontend/src/components/trade/TradeBar.tsx exists
[pass] frontend/src/components/chat/ChatPanel.tsx exists (full impl, not stub)
[pass] frontend/src/components/chat/ChatMessage.tsx exists
[pass] frontend/src/components/layout/AppShell.tsx renders <MainChart/><PositionsTable/><PortfolioHeatmap/><PnLChart/><TradeBar/><ChatPanel/>
[pass] All 4 chart components have 'use client' + mounted-flag guard (Pitfall 1)
[pass] All verbatim UI-SPEC copy strings present in source (MainChart empty, PositionsTable headers + empty, Heatmap heading, PnL heading, TradeBar placeholders + buttons + success toasts, ChatPanel title + placeholder + send + loader + empty + disabled)
[pass] TradeBar maps backend detail substrings (Insufficient cash, Insufficient shares, No price available, Quantity must be positive, Unknown side) to UI-SPEC copy; raw detail never rendered (V7)
[pass] PositionsTable P&L cell signed AND colored (color never sole signal — accessibility/V7)
[pass] ChatPanel has role=log + aria-live=polite
[pass] ChatMessage renders inline chips via {value} JSX — no dangerouslySetInnerHTML
[pass] TradeBar uses single refreshPortfolio() call (covers both /api/portfolio and /api/portfolio/history)
[pass] ChatPanel does NOT poll /api/chat, does NOT fetch on mount beyond disabled-probe, does NOT call any chat-history endpoint (Pitfall 6)
[pass] D-06 preserved: no total_value stored in either context
[pass] npx tsc --noEmit exit 0 (strict mode)
[pass] npm run build exit 0, frontend/out/ generated, no window-is-not-defined errors
```

Self-Check: PASSED