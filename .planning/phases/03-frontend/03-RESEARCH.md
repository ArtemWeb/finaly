# Phase 3: Frontend - Research

**Researched:** 2026-06-27
**Domain:** Next.js 14 static-export trading terminal consuming FastAPI REST + SSE
**Confidence:** HIGH

## Summary

Phase 3 builds the entire UI as a **single static export** (`next build` → `out/`), served at build-time by Docker alongside FastAPI on port 8000. The UI-SPEC has already locked Recharts (3.x), lucide-react, Next 14 App Router + TypeScript strict, Tailwind CSS — and the interaction contract (single `useSse` hook, Context-based state, 60fps with 10 SSE streams every 500ms). CONTEXT.md has already locked D-01..D-06: relative `/api/...` URLs with `NEXT_PUBLIC_API_BASE_URL` override, dev-only CORS in `backend/app/main.py`, skeleton-first-load state, Context split (PriceContext vs PortfolioContext), and Header-derived `total_value`.

What this research adds: (a) **version pinning** for Next 14 vs latest 16 and Recharts 3.x compatibility with React 19, (b) **charting library confirmation** — Recharts alone covers sparkline, area chart, treemap, and P&L line chart (the four chart types the UI-SPEC needs), so no second charting dep is justified, (c) **precise SSE payload contract** verified from `backend/app/market/stream.py` — the event body is a **flat map** `{AAPL: {...}, GOOGL: {...}}`, not a wrapper, (d) **backend route shapes verified** end-to-end against the source so the planner can map each UI-01..UI-12 to an exact endpoint + field set with zero ambiguity, (e) **Next.js `output: 'export'` gotchas** — Rewrites/Redirects/Server Actions/Route Handlers with Request/middleware are dropped at build, so the relative-URL strategy in D-01 is correct and the CORS middleware in D-02 is the only viable dev cross-origin bridge.

**Primary recommendation:** Stay with the UI-SPEC's locked Recharts + lucide-react + Next 14 App Router stack; pin Next 14.2.x (matches the UI-SPEC's "Next 14" spec, stable App Router output: 'export' behavior) and React 18.x (Recharts 3.x peer dep includes ^19 but the UI-SPEC pins React 19 as `19.2.7` per npm registry — verify before scaffolding), Tailwind 3.4.x (v4 brings breaking config changes). Build via `next build` → `out/`, copy `out/*` into `backend/static/` during the Docker build stage (Phase 4 concern). The frontend is a pure consumer — every endpoint it needs exists.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Relative paths + env override for base URL.** All `fetch` and `EventSource` URLs default to relative `/api/...`. `NEXT_PUBLIC_API_BASE_URL` empty/unset in prod (same-origin), `http://localhost:8000` in dev.
- **D-02: Add dev-gated CORS middleware to the backend.** `CORSMiddleware` inside `create_app()` with allowed origins from `CORS_ORIGINS` env var (default empty → off). Prod is same-origin so CORS is inert. ⚠ Edits `backend/app/main.py`.
- **D-03: First-load state = skeleton panels + connecting dot.** Skeleton placeholders before fetches resolve; `ConnectionDot` starts yellow, flips green on SSE `onopen`. Reuses `EmptyState` and `ConnectionDot` from UI-SPEC inventory.
- **D-04: Distribute shared state via React Context provider(s), not prop-drilling.** Providers mounted at `AppShell`.
- **D-05: Split contexts by update frequency.** Separate **PriceContext** (high-churn, ~500ms SSE map) from **PortfolioContext** (low-churn, mutation/10s-poll).
- **D-06: Derive the live total portfolio value in the Header consumer.** `Header` subscribes to both contexts; computes `cash + Σ(qty × currentPrice)` in a `useMemo`. Do not store total_value in PortfolioContext.

### Claude's Discretion

- Exact context module structure, provider nesting order, hook naming (`usePrices()`, `usePortfolio()`, etc.).
- The precise `CORS_ORIGINS` env-var name/format and where the URL-builder helper lives in `frontend/src/`.

### Deferred Ideas (OUT OF SCOPE)

- Scaffolding & build approach details (create-next-app vs hand-rolled, version pinning, export target path) — standard setup task for the planner.
- **Phase 3 frontend component tests** — Phase 4 owns Playwright E2E and backend unit tests per ROADMAP. Phase 3 has no test framework.

## Project Constraints (from CLAUDE.md)

These HARD-BOUND every research recommendation:

- **Static export only.** `output: 'export'` — no Node server at runtime. No Next.js Route Handlers with Request, no Server Actions, no middleware, no Rewrites/Redirects/Headers (all dropped at build per Next.js docs).
- **Single container, single port 8000.** FastAPI serves the exported `static/` AND REST AND SSE from the same origin.
- **Backend already complete (Phases 1-2).** No new endpoints, no route changes — only D-02's CORS middleware addition.
- **No confirmation dialogs.** Trades execute instantly; UI updates without page reload.
- **Same-origin in production** — so `NEXT_PUBLIC_API_BASE_URL` must be empty/unset in the Docker build.
- **Stack locked by UI-SPEC:** Next.js 14 App Router + TypeScript strict, Tailwind CSS, Recharts, lucide-react. No shadcn, no component registry.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Watchlist live prices flash green/red with 500ms fade | Recharts not needed; Tailwind `transition-colors duration-500` + class-swap on price prop change. SSE payload includes `direction: "up"\|"down"\|"flat"` (verified in `PriceUpdate.to_dict()`). |
| UI-02 | Watchlist sparklines accumulated from SSE | Recharts `<LineChart>` 60×20px, no axes/tooltip, single series. Ring buffer of last 60 prices per ticker in PriceContext. rAF-debounced append. |
| UI-03 | Click ticker → detailed chart in main area | Recharts `<AreaChart>` ~600×400px with axes/tooltip/grid. `selectedTicker` in AppShell state. No URL routing (UI-SPEC). |
| UI-04 | Portfolio heatmap treemap sized by weight, colored by P&L | Recharts `<Treemap>` (built-in, no extra dep). Cell `content` prop renders custom colored rect. |
| UI-05 | P&L chart line over time | Recharts `<LineChart>` from `GET /api/portfolio/history`. X = `recorded_at`, Y = `total_value`. |
| UI-06 | Positions table with P&L column | Plain Tailwind `<table>` + `tabular-nums`. P&L cell colored by sign using `text-profit`/`text-loss`. |
| UI-07 | Trade bar — instant market orders | `POST /api/portfolio/trade` (200 returns `{ticker, side, quantity, price, cash_balance}`; 400 returns `{detail: "..."}`). UI-SPEC mandates no confirmation, optimistic update on 200. |
| UI-08 | AI chat panel with inline trade confirmations | `POST /api/chat` returns `{message, actions: {trades, watchlist_changes}}`. Each action has `{status: "executed"\|"error"\|"ok"}` + `detail`. Disable panel if `OPENROUTER_API_KEY` unset and `LLM_MOCK` off. |
| UI-09 | Header: live total value + cash + SSE dot | Header subscribes to both PriceContext + PortfolioContext; derives total via `useMemo` (D-06). ConnectionDot reflects `EventSource.readyState`. |
| UI-10 | Add/remove tickers via UI | `POST /api/watchlist` (body `{ticker}`, 200 returns `{status: "ok", ticker}`). `DELETE /api/watchlist/{ticker}`. Optimistic local removal, revert on error. |
| UI-11 | Dark terminal aesthetic | Tailwind tokens locked in UI-SPEC: `bg-surface-base` (#0d1117), `bg-surface-panel` (#1a1a2e), `accent-yellow/blue/purple`, `text-profit/loss`. `darkMode: 'class'` forced. |
| UI-12 | EventSource SSE to `/api/stream/prices` with auto-reconnect | Native `EventSource`, server sends `retry: 1000` so browser reconnects automatically. No custom backoff needed (per UI-SPEC). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Live price flashing | Browser (CSS class swap) | — | Pure DOM state change; no fetch, no server roundtrip. |
| Sparkline accumulation | Browser (in-memory ring buffer) | — | SSE pushes the data; client maintains the buffer. |
| SSE connection lifecycle | Browser (EventSource) | FastAPI stream endpoint | EventSource native; server only emits `text/event-stream`. |
| Portfolio valuation | FastAPI `/api/portfolio` | Browser (Header re-derives) | All P&L math runs on the server; browser just displays. **The one exception: Header live total** (D-06) — browser computes `cash + Σ(qty × currentPrice)` to avoid coupling PriceContext churn into PortfolioContext. |
| Trade execution | FastAPI `/api/portfolio/trade` | Browser (optimistic update) | Server is source of truth (atomic aiosqlite transaction); browser updates local state on 200, re-fetches portfolio + history on success. |
| Watchlist mutation | FastAPI `/api/watchlist*` | Browser (optimistic UI for delete) | Server-side insert/delete + market_source.add_ticker/remove_ticker for live tracking. |
| Chat + LLM | FastAPI `/api/chat` | Browser (rendering only) | Browser is dumb renderer; LLM call, trade auto-execution, and chat persistence are server-side. |
| Static asset serving | FastAPI `StaticFiles` mount at `/` | — | `out/` from `next build` is copied into `backend/static/` at Docker build time (Phase 4 task). |
| Dark aesthetic tokens | Tailwind config (build-time) | — | Locked palette in `tailwind.config.ts` `theme.extend.colors`. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 14.2.x (latest 16.2.9 available but 14.x is UI-SPEC-locked) | App Router, static export, file-based routing | UI-SPEC pins Next 14; App Router stable since 13.4. |
| `react`, `react-dom` | 18.x (Recharts 3.x supports ^19; UI-SPEC version is `19.2.7` per npm) — **DECISION GATE** | Component runtime | See "React 18 vs 19" below. |
| `typescript` | 5.x | Strict mode type checking | UI-SPEC requires strict mode. |
| `tailwindcss` | 3.4.x (NOT 4.x — breaking config changes) | Utility CSS framework | UI-SPEC pins Tailwind; v4 (released Q1 2025) changes config to CSS-first, breaks existing `theme.extend.colors` syntax. |
| `recharts` | 3.9.0 (verified `npm view recharts version` 2026-06-23) | Charts: sparkline, AreaChart, Treemap, LineChart | UI-SPEC pins Recharts; one library covers all four chart types (no need for a separate sparkline lib). React 19 compatible per peer deps. |
| `lucide-react` | 1.21.0 (verified `npm view lucide-react version`) | Icons (tree-shakeable, Tailwind-friendly) | UI-SPEC pins lucide-react. React 19 compatible per peer deps. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `postcss` | 8.x | Required by Tailwind 3.4 | Build dep only. |
| `autoprefixer` | 10.x | Vendor prefixes | Build dep only. |
| `@types/react`, `@types/react-dom`, `@types/node` | matching | TS type defs | Dev dep. |
| `eslint`, `eslint-config-next` | matching | Linting | Optional dev dep; Next 14 ships lint config. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts (4 chart types) | `lightweight-charts` for main chart + Recharts for sparkline/treemap | `lightweight-charts` is purpose-built for finance (candlesticks, time-series, faster), but adds a SECOND charting dep. UI-SPEC specifies Recharts for "all panels." Stick with Recharts — sparkline/area/treemap/line are all simple cases where lightweight-charts' advantages don't apply. |
| Recharts Treemap | `nivo` treemap, d3-treemap directly | nivo adds ~100KB; d3-treemap requires hand-rolling React integration. Recharts ships treemap natively. |
| `react-sparklines` | Recharts for sparkline | Adds a 2nd charting dep; UI-SPEC already commits to Recharts. |
| Zustand for shared state | React Context (per D-04) | D-04 explicitly mandates Context — UI-SPEC says "useState + useSse, no Redux/Zustand". |
| Custom SSE hook | `react-sse` or `@microsoft/fetch-event-source` | Native `EventSource` is simpler, has auto-reconnect built-in, and works with same-origin. `fetch-event-source` only needed for custom headers/auth — not this case. |

**Installation:**
```bash
cd frontend
npm install next@14 react@18 react-dom@18 typescript@5 \
            tailwindcss@3.4 postcss@8 autoprefixer@10 \
            recharts@3 lucide-react@1
npm install -D @types/react @types/react-dom @types/node eslint eslint-config-next@14
```

**Version verification (run before scaffolding):**
```bash
npm view next version            # → 16.2.9 (pin to 14.2.x for UI-SPEC compliance)
npm view react version           # → 19.2.7 (verify UI-SPEC's 19.2.7 assumption holds)
npm view recharts version        # → 3.9.0 ✓
npm view lucide-react version    # → 1.21.0 ✓
npm view tailwindcss version     # → 4.3.1 (DO NOT pin 4.x — pin 3.4.x for theme.extend.colors compat)
```

### React 18 vs 19 — Decision Gate

UI-SPEC does NOT pin a React major. npm registry shows React 19.2.7 as latest. Recharts 3.x peer dep is `^16.8 || ^17 || ^18 || ^19` — both work.

**Recommendation: pin React 18.3.x.**

Reasons:
1. **Next 14 + React 18 is the most-tested combo** for `output: 'export'`. Next 14 ships React 18 RC; pairing Next 14 with React 19 is officially supported but introduces hydration warning potential with recharts' internal hooks (unconfirmed in current docs but a known risk in 3.x's early lifecycle).
2. **The app has no React 19 features** — no Server Components (all client), no use(), no Actions. Nothing in this app justifies the risk.
3. **Recharts 3.0 was the first major to support React 19** (verified peer dep) but had several regression fixes through 3.7.0. Sticking to React 18 sidesteps any residual issues.

If the executor prefers React 19: it's a permitted upgrade; just note it in the plan as a deliberate deviation. Planner should add a `checkpoint:human-verify` task to manually confirm the first Recharts render in the browser.

## Package Legitimacy Audit

> Run before scaffolding. All packages below are widely-known, npm-trusted.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `next` | npm | 9 yrs | millions/wk | github.com/vercel/next.js | OK | Approved (pin 14.2.x) |
| `react`, `react-dom` | npm | 11 yrs | millions/wk | github.com/facebook/react | OK | Approved (pin 18.3.x) |
| `recharts` | npm | 11 yrs | ~2M/wk | github.com/recharts/recharts | OK | Approved (pin 3.9.0) |
| `lucide-react` | npm | 5 yrs | ~3M/wk | github.com/lucide-icons/lucide | OK | Approved (pin 1.21.0) |
| `tailwindcss` | npm | 7 yrs | ~7M/wk | github.com/tailwindlabs/tailwindcss | OK | Approved (pin 3.4.x, NOT 4.x) |

**Packages removed:** none.
**Packages flagged as suspicious:** none.

All packages are well-known, high-download libraries with public source repositories — verified via npm registry metadata. No `postinstall` scripts of concern.

## Architecture Patterns

### System Architecture Diagram

```
+---------------------- BROWSER (Next.js static export) ----------------------+
|                                                                              |
|  AppShell                                                                   |
|  ├─ Header (subscribes PriceContext + PortfolioContext → derives total)    |
|  │   └─ ConnectionDot                                                      |
|  ├─ WatchlistPanel ← PriceContext (prices map, ring buffers)              |
|  │   └─ WatchlistRow[] ← PriceContext + flash class                       |
|  │       └─ Sparkline (Recharts <LineChart>, no axes)                     |
|  ├─ MainChart (AreaChart when selectedTicker is set)                      |
|  ├─ PortfolioPanel                                                        |
|  │   ├─ PositionsTable ← PortfolioContext (positions) + PriceContext      |
|  │   │              (currentPrice column merges both contexts)            |
|  │   ├─ PortfolioHeatmap (Treemap)                                        |
|  │   └─ PnLChart (LineChart from history)                                |
|  ├─ TradeBar ← both contexts (display only); POSTs to backend             |
|  ├─ ChatPanel ← sends; receives message + actions                         |
|  └─ Toast (ephemeral feedback)                                            |
|                                                                              |
|  useSse hook (PriceContext provider):                                     |
|    new EventSource('/api/stream/prices')                                 |
|    onmessage → JSON.parse → update prices map → trigger flash             |
|                                                                              |
|  URL helper (apiUrl):                                                     |
|    base = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''  // empty in prod   |
|    fetch(`${base}/api/portfolio/trade`, { ... })                         |
|                                                                              |
+------------------ HTTP / SSE (same-origin in prod, :8000 in dev) -----------+
                            ↓
+---------------------- BACKEND (FastAPI :8000) ----------------------------+
|                                                                              |
|  main.py:                                                                  |
|    [CORSMiddleware if CORS_ORIGINS set]   ← D-02 change                   |
|    include_router(stream_router)         → /api/stream/prices            |
|    include_router(portfolio_router)      → /api/portfolio*               |
|    include_router(watchlist_router)      → /api/watchlist*               |
|    include_router(chat_router)           → /api/chat                     |
|    @app.get(/api/health)                                                  |
|    mount(/, StaticFiles(static/))                                        |
|                                                                              |
|  routes/portfolio.py   : TradeRequest, TradeError → 400                   |
|  routes/watchlist.py   : WatchlistAddRequest                               |
|  routes/chat.py        : ChatRequest, handle_chat → LLM + auto-execute   |
|  market/stream.py      : SSE 500ms cadence, retry: 1000                  |
|  market/cache.py       : PriceCache (thread-safe, versioned)              |
|  market/models.py      : PriceUpdate (frozen, has direction)             |
|  portfolio_service.py  : execute_trade, get_portfolio, record_snapshot   |
|  chat_service.py       : SYSTEM_PROMPT, handle_chat                      |
|  db.py                 : aiosqlite, 6-table schema, seed                  |
|                                                                              |
+------------------ PERSISTENCE ------------------------------------------+
|  db/finally.db (volume-mounted at /app/db in container)                  |
+------------------------------------------------------------------------+
```

### Recommended Project Structure

```
frontend/
├── package.json                    # Locked deps (next 14, react 18, recharts 3, etc.)
├── next.config.js                  # { output: 'export', trailingSlash: false }
├── tsconfig.json                   # strict: true
├── tailwind.config.ts              # darkMode: 'class', theme.extend.colors (locked palette)
├── postcss.config.js               # tailwindcss + autoprefixer
├── .eslintrc.json                  # next/core-web-vitals
├── public/                         # static assets copied to out/
│   └── favicon.ico
└── src/
    ├── app/
    │   ├── layout.tsx              # Root layout; <html class="dark">; providers mount
    │   ├── page.tsx                # The single trading-terminal page (renders <AppShell/>)
    │   └── globals.css             # @tailwind base/components/utilities; font-mono body
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx        # 3-column grid; mounts <PriceProvider><PortfolioProvider>
    │   │   ├── Header.tsx          # Subscribes both contexts; useMemo total (D-06)
    │   │   └── ConnectionDot.tsx   # readyState → color + tooltip
    │   ├── watchlist/
    │   │   ├── WatchlistPanel.tsx
    │   │   ├── WatchlistRow.tsx
    │   │   ├── Sparkline.tsx       # Recharts <LineChart> 60×20
    │   │   └── PriceFlash.tsx      # Wraps row, applies bg-profit/20 or bg-loss/20
    │   ├── chart/
    │   │   └── MainChart.tsx       # Recharts <AreaChart> 600×400
    │   ├── portfolio/
    │   │   ├── PositionsTable.tsx
    │   │   ├── PortfolioHeatmap.tsx # Recharts <Treemap>
    │   │   └── PnLChart.tsx         # Recharts <LineChart>
    │   ├── trade/
    │   │   └── TradeBar.tsx
    │   ├── chat/
    │   │   ├── ChatPanel.tsx
    │   │   └── ChatMessage.tsx
    │   └── ui/
    │       ├── Toast.tsx
    │       └── EmptyState.tsx
    ├── context/
    │   ├── PriceContext.tsx        # prices map, ring buffers, selectedTicker
    │   └── PortfolioContext.tsx    # portfolio, watchlist, refreshPortfolio, refreshWatchlist
    ├── hooks/
    │   └── useSse.ts               # Native EventSource lifecycle
    ├── lib/
    │   ├── api.ts                  # apiUrl(path) helper (D-01)
    │   ├── types.ts                # TS interfaces mirroring backend response shapes
    │   └── format.ts               # currency, pct, timestamp formatters
    └── styles/                     # (reserved — palette in tailwind.config.ts)
```

### Pattern 1: SSE Hook with Native EventSource

**What:** A single `useSse` hook opens one `EventSource` connection at app mount and exposes `prices`, `status`, and the raw payload. The hook returns the parsed price map; consumers subscribe via context.

**When to use:** The entire app needs live prices, and the SSE endpoint is server-driven with auto-reconnect (`retry: 1000`). Custom reconnect logic is unnecessary.

**Verified backend payload shape** (from `backend/app/market/stream.py:80-83`):
```python
data = {ticker: update.to_dict() for ticker, update in prices.items()}
payload = json.dumps(data)
yield f"data: {payload}\n\n"
```
And `PriceUpdate.to_dict()` (from `backend/app/market/models.py:39-49`):
```python
{"ticker": "...", "price": 190.50, "previous_price": 190.45, "timestamp": 1719565432.1,
 "change": 0.05, "change_percent": 0.0263, "direction": "up"}
```

So a single SSE event is a **flat object keyed by ticker** — the client iterates `Object.entries(payload)` to update each ticker's ring buffer.

**Example (frontend/src/hooks/useSse.ts):**
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/lib/api';
import type { PriceUpdate } from '@/lib/types';

export type ConnectionStatus = 'connecting' | 'open' | 'error';

export function useSse(onMessage: (prices: Record<string, PriceUpdate>) => void) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Native EventSource; relative URL works same-origin in prod
    const url = apiUrl('/api/stream/prices');
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onopen = () => setStatus('open');
    es.onerror = () => {
      // Browser auto-reconnects per server's `retry: 1000` directive
      // EventSource.readyState will be CONNECTING (0) until reconnect succeeds
      setStatus('error');
    };
    es.onmessage = (ev) => {
      try {
        const prices = JSON.parse(ev.data) as Record<string, PriceUpdate>;
        setStatus('open');
        onMessage(prices);
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };

    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, source: sourceRef };
}
```

### Pattern 2: Split Context for Cadence Isolation (D-05)

**What:** Two providers — `PriceProvider` (high-churn, SSE ~500ms × 10 tickers) and `PortfolioProvider` (low-churn, mutation/10s-poll). Components subscribe only to what they need.

**When to use:** Whenever one piece of state updates at 10× the rate of another, and many components use the slow piece.

**Example (PriceContext):**
```tsx
'use client';

import { createContext, useContext, useRef, useState, useCallback } from 'react';
import { useSse } from '@/hooks/useSse';
import type { PriceUpdate } from '@/lib/types';

const MAX_SPARK = 60;

type PriceState = {
  prices: Record<string, PriceUpdate>;
  history: Record<string, PriceUpdate[]>; // ring buffers for sparklines
  selectedTicker: string | null;
  setSelectedTicker: (t: string | null) => void;
};

const PriceContext = createContext<PriceState | null>(null);

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const historyRef = useRef<Record<string, PriceUpdate[]>>({});
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  // rAF-debounced batched state update — coalesces rapid SSE messages
  const pendingRef = useRef<Record<string, PriceUpdate> | null>(null);
  const rafRef = useRef<number | null>(null);

  const handleMessage = useCallback((next: Record<string, PriceUpdate>) => {
    // Append to ring buffers (no re-render)
    for (const [ticker, update] of Object.entries(next)) {
      const buf = historyRef.current[ticker] ?? [];
      buf.push(update);
      if (buf.length > MAX_SPARK) buf.shift();
      historyRef.current[ticker] = buf;
    }
    // Coalesce state update to one per frame
    pendingRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        if (pendingRef.current) setPrices(pendingRef.current);
        pendingRef.current = null;
        rafRef.current = null;
      });
    }
  }, []);

  const { status } = useSse(handleMessage);

  return (
    <PriceContext.Provider value={{
      prices, history: historyRef.current,
      selectedTicker, setSelectedTicker,
    }}>
      {children}
      {/* status passed via separate <ConnectionStatusContext> to avoid churn */}
    </PriceContext.Provider>
  );
}

export const usePrices = () => {
  const ctx = useContext(PriceContext);
  if (!ctx) throw new Error('usePrices must be used within PriceProvider');
  return ctx;
};
```

### Pattern 3: Optimistic Trade with Reconcile

**What:** TradeBar `POST`s to `/api/portfolio/trade`. On 200, the server returns `{ticker, side, quantity, price, cash_balance}` (post-trade state). UI updates immediately: subtracts cash, increments position quantity locally, fires a success toast, then calls `refreshPortfolio()` + `refreshHistory()` to reconcile.

**Why:** UI-SPEC mandates no confirmation dialog and instant fill. The server is authoritative but the response already contains enough state to update the local portfolio without a follow-up GET.

**Example (TradeBar submit):**
```tsx
async function handleSubmit() {
  // Validate
  if (!ticker || quantity <= 0) return;
  setSubmitting(true);
  try {
    const res = await fetch(apiUrl('/api/portfolio/trade'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, quantity, side }),
    });
    if (res.ok) {
      const data: TradeResponse = await res.json();
      // Server is authoritative — reconcile immediately
      await Promise.all([refreshPortfolio(), refreshHistory()]);
      toast({ type: 'success', message: `Bought ${quantity} ${ticker} @ $${data.price}` });
      // Reset form
      setTicker(''); setQuantity('');
    } else {
      const { detail } = await res.json();
      // Map backend error strings to UI-SPEC copywriting
      const msg = detail.startsWith('Insufficient cash')
        ? 'Insufficient cash for this order.'
        : detail.startsWith('Insufficient shares')
        ? `You don't own that many shares of ${ticker}.`
        : detail.startsWith('No price available')
        ? `No live price for ${ticker}. Try again in a moment.`
        : 'Trade request failed. Check your connection.';
      toast({ type: 'error', message: msg });
    }
  } catch {
    toast({ type: 'error', message: 'Trade request failed. Check your connection.' });
  } finally {
    setSubmitting(false);
  }
}
```

### Anti-Patterns to Avoid

- **Using `EventSource` polyfills or `fetch-event-source`** — native `EventSource` has built-in reconnect driven by `retry:` directive (verified in HTML spec). No library needed.
- **Storing `total_value` in PortfolioContext** — couples high-churn SSE prices into a low-churn context, reintroducing the re-render storm D-05 explicitly avoids. D-06 mandates Header-derived.
- **Prop-drilling `refreshPortfolio()` through the tree** — D-04 requires Context; use `usePortfolio()` everywhere.
- **Polling `/api/portfolio` every 1s to "get live prices"** — wasteful; live prices come via SSE; `/api/portfolio` should be polled at 10s (UI-SPEC safety) and re-fetched on mutation.
- **Custom exponential backoff on SSE** — UI-SPEC explicitly says "No custom exponential backoff needed"; browser auto-reconnects per server's `retry: 1000`.
- **Using `next/image` without a custom loader** — Default Image Optimization API is unsupported in `output: 'export'` (verified Next.js docs). Phase 3 doesn't use `next/image` (all UI is type/SVG/Tailwind), so this is a non-issue — but if executor adds images, they must use plain `<img>` or define a custom loader.
- **Using `next.config.js` rewrites/redirects/middleware** — All dropped at build per Next.js `output: 'export'` docs. Use FastAPI middleware (CORS) or backend-side routing instead.
- **Adding `next.config.js` `basePath`** — Not needed; static export is served at root by FastAPI `StaticFiles` mount at `/`.
- **Using a separate charting library for sparklines** — UI-SPEC mandates Recharts for all chart types; do not introduce `react-sparklines` or similar.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Price flash animation | Custom `setTimeout` + class toggle | Tailwind `transition-colors duration-500` + class swap on prop change | Browsers already animate class transitions declaratively; any manual `setTimeout` race-conditions with React's render cycle. |
| SSE reconnection | Manual `new EventSource()` + `setTimeout(backoff)` loop | Native `EventSource` (server sends `retry: 1000`) | Browser auto-reconnects per spec; manual backoff conflicts with the spec's connection state machine. |
| Treemap layout algorithm | Custom rect-packing math | Recharts `<Treemap>` | Treemap layout is non-trivial (squarified algorithm). Recharts ships the standard one. |
| Chart axis tick generation | `formatYAxis` reimplementation | Recharts `<YAxis tickFormatter={...}>` | Recharts handles tick selection. |
| Trade form error mapping | `try { ... } catch (everything)` | Map `HTTP 400 detail` strings to UI-SPEC copy | Backend `TradeError` messages are stable and documented; no need to generalize. |
| Currency formatting | `toLocaleString` everywhere | `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` cached in `format.ts` | Centralizes the formatter; consistent tabular alignment. |
| Optimistic update | Hand-rolled state merge + rollback on failure | Pattern 3 above: server returns post-trade state, refresh from server | Server is authoritative; trying to maintain local-canonical state invites drift. |

**Key insight:** This app's complexity is in **real-time data flow** (SSE + state) and **visual polish** (Tailwind + Recharts), not in novel algorithms. Every "custom" solution would be a worse version of a battle-tested library.

## Runtime State Inventory

> SKIPPED. This phase is greenfield (no existing `frontend/` directory; no runtime state exists in any external service that contains "FinAlly" / Phase 3 strings). The only state that exists is the backend (read-only consumer) and dev environment (not yet configured).

The only state that exists at the start of Phase 3:
- **Backend**: SQLite at `db/finally.db` (Phase 1), FastAPI on `:8000` (Phase 1 + 2). Read-only consumer.
- **Frontend**: Does not exist. Greenfield `frontend/` directory to be created.
- **Docker**: Phase 4 will introduce. Phase 3 only needs to ensure `next build` produces `out/` that the Phase 4 Dockerfile will COPY into `backend/static/`.

## Common Pitfalls

### Pitfall 1: Recharts Hydration Warning in Static Export

**What goes wrong:** `ResponsiveContainer` reads `window.innerWidth` on mount. During `next build`, the static prerender runs without `window`, so the first render may throw `ReferenceError: window is not defined`.

**Why it happens:** Recharts uses `ResizeObserver` / window dimension APIs internally.

**How to avoid:** Mark every file that imports from `recharts` (or that transitively imports a chart) with `'use client'` at the top. Additionally, defer rendering of Recharts components behind a `mounted` flag:

```tsx
'use client';
import { useEffect, useState } from 'react';

export function MainChart({ data }: { data: PricePoint[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-[600px] h-[400px] bg-surface-raised animate-pulse" />;
  return (
    <ResponsiveContainer width="100%" height={400}>
      <AreaChart data={data}>...</AreaChart>
    </ResponsiveContainer>
  );
}
```

**Warning signs:** Build error `window is not defined` or hydration mismatch warnings in browser console. `npm run build` exits non-zero.

### Pitfall 2: SSE Connection Errors Block UI Rendering

**What goes wrong:** The `useSse` hook starts the connection immediately on `AppShell` mount. If the backend is not yet ready (cold start) or the URL is wrong, EventSource fires `onerror`, but the React tree keeps rendering with stale state.

**Why it happens:** EventSource swallows errors silently unless you attach `onerror`. The dot will turn red, but the rest of the UI must still render.

**How to avoid:** D-03 mandates skeleton-first-load state. The `ConnectionDot` starts yellow and reflects `EventSource.readyState`. Other panels render their locked `EmptyState` components until `/api/portfolio` + `/api/watchlist` resolve. Never gate UI rendering on SSE connection status — it's a one-way data feed, not a handshake.

**Warning signs:** Console shows `EventSource` errors; panels are blank; the dot is red/yellow but never goes green.

### Pitfall 3: Stale Sparkline Buffer After Watchlist Re-add

**What goes wrong:** User removes ticker AAPL (UI-10), then re-adds it. The sparkline ring buffer in `PriceContext` still holds AAPL's old history, so the sparkline appears to show old data.

**Why it happens:** Ring buffer lives in module-level `useRef`, surviving across add/remove cycles within a session.

**How to avoid:** Clear the ring buffer entry on `remove_ticker` in the local state. Use `selectedTicker` or the latest `direction` from the latest SSE message — don't trust the historical ring buffer for tickers not currently in `watchlist`.

**Warning signs:** Sparkline for re-added ticker shows a "history" with no time gap at the removal boundary; visual discontinuity.

### Pitfall 4: Tailwind v4 Breaking Changes

**What goes wrong:** Executor runs `npm install tailwindcss` (gets v4.3.1). The v4 config is CSS-first (`@theme { --color-... }` in CSS, not in `tailwind.config.ts`). The locked palette stops working.

**Why it happens:** Tailwind v4 (released Q1 2025) redesigned configuration. UI-SPEC assumes Tailwind 3.4.x syntax with `theme.extend.colors` in JS config.

**How to avoid:** Pin `tailwindcss@3.4.x` in `package.json`. Run `npm install tailwindcss@3.4 postcss@8 autoprefixer@10`. Run `npx tailwindcss init -p` to generate `tailwind.config.{js,ts}` and `postcss.config.js`.

**Warning signs:** Build output is unstyled (no CSS) or `theme.extend.colors is not a valid config key` warning.

### Pitfall 5: Re-render Storm in PositionsTable

**What goes wrong:** PositionsTable subscribes to `PortfolioContext` for positions AND `PriceContext` for currentPrice. Every SSE tick (~10/sec across 10 tickers) triggers a `PositionsTable` re-render, even when none of the table's own data changed.

**Why it happens:** Context providers re-render all consumers when their value changes. PriceContext's `prices` map changes every ~500ms.

**How to avoid:** Two options:
1. **Read prices inside a memoized selector inside PositionsTable** so the table re-renders only when its specific columns' data changes:
   ```tsx
   const currentPrice = usePrices().prices[ticker]?.price ?? avg_cost;
   const change = useMemo(() => currentPrice - avg_cost, [currentPrice, avg_cost]);
   ```
2. **Split PriceContext further** into a per-ticker atom (overkill for v1).

For v1, option 1 (selector pattern) is sufficient — D-05's split (Price vs Portfolio) keeps the bulk of churn away from PositionsTable's structural columns.

**Warning signs:** DevTools Performance shows PositionsTable rendering at ~2Hz even when only prices update; noticeable lag.

### Pitfall 6: Chat Panel Polling on Every Keypress

**What goes wrong:** Executor wires `useEffect` to refetch chat history when input changes. Refetches fire on every keystroke.

**Why it happens:** Misunderstanding of when to refetch.

**How to avoid:** ChatPanel fetches history **once on mount**. New messages are appended to local state when the user sends or receives. No polling. The server has no `/api/chat/history` endpoint anyway — so don't build one. (Confirmed: only `POST /api/chat` exists in `backend/app/routes/chat.py`.)

**Warning signs:** Network tab shows repeated `/api/chat` GETs; typing latency increases.

### Pitfall 7: CORS Not Actually Configured in Dev

**What goes wrong:** D-02 adds `CORSMiddleware` to `backend/app/main.py:create_app()`, but only reads `CORS_ORIGINS` env var. The dev executor never sets the var, so CORS is inert, and `fetch` from `localhost:3000` to `localhost:8000` fails in dev.

**Why it happens:** D-02 defers env-var name to Claude's discretion.

**How to avoid:** In `backend/.env` (or `.env.example`):
```
CORS_ORIGINS=http://localhost:3000
```
And the backend `main.py` change:
```python
cors_origins = os.environ.get("CORS_ORIGINS", "")
if cors_origins:
    from fastapi.middleware.cors import CORSMiddleware
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cors_origins.split(",")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
```

**Warning signs:** Browser console shows `CORS policy: No 'Access-Control-Allow-Origin' header`; `/api/portfolio` returns network error in `next dev` only.

## Code Examples

Verified patterns from official sources (Next.js 14 docs, Recharts 3.x docs, MDN):

### SSE Payload Parsing

```ts
// Source: backend/app/market/stream.py:80-83 verified
// Event body shape: {"AAPL": {"ticker":"AAPL","price":190.50,...}, "GOOGL": {...}}
const payload: Record<string, PriceUpdate> = JSON.parse(ev.data);
for (const [ticker, update] of Object.entries(payload)) {
  // ring buffer append + flash detection
}
```

### EventSource Auto-Reconnect (MDN spec)

```ts
// Source: html.spec.whatwg.org/multipage/server-sent-events.html
// "The retry field sets the reconnection time in milliseconds"
// Server sends "retry: 1000\n\n" on connect (verified stream.py:62)
// Browser waits 1000ms after disconnect, then reconnects automatically.
// No custom backoff needed.
```

### Next.js `output: 'export'` Required Config (Next.js docs)

```js
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true }, // OR custom loader; default loader unsupported
  // trailingSlash: false (default), so /api calls land at /api/* correctly
};
module.exports = nextConfig;
```

### Recharts Treemap for Portfolio Heatmap

```tsx
// Source: recharts.org/api/Treemap (verified name in Recharts 3.x)
'use client';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';

interface Position { name: string; size: number; pnl: number; }

function PortfolioHeatmap({ positions }: { positions: Position[] }) {
  // size = market value (for treemap sizing), color derived from pnl
  return (
    <ResponsiveContainer width="100%" height={300}>
      <Treemap
        data={positions}
        dataKey="size"
        stroke="#0d1117"
        content={(props: any) => {
          const { x, y, width, height, pnl } = props;
          const fill = pnl >= 0 ? '#22c55e' : '#ef4444';
          return <rect x={x} y={y} width={width} height={height} fill={fill} />;
        }}
      >
        <Tooltip />
      </Treemap>
    </ResponsiveContainer>
  );
}
```

### Tailwind Config with Locked Palette

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { base: '#0d1117', panel: '#1a1a2e', raised: '#161b22' },
        accent: { yellow: '#ecad0a', blue: '#209dd7', purple: '#753991' },
        profit: '#22c55e',
        loss: '#ef4444',
        text: { primary: '#e6edf3', muted: '#7d8590' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
```

## Backend Contract Mapping (UI-01..UI-12 → Endpoints)

Each UI requirement is mapped to its exact backend endpoint and response shape, verified against `backend/app/routes/*.py` and `backend/app/market/stream.py`:

| UI Req | Endpoint | Method | Response Shape (verified) | Notes |
|--------|----------|--------|---------------------------|-------|
| UI-01 (flash) | `/api/stream/prices` | GET (SSE) | `data: { "AAPL": {ticker, price, previous_price, timestamp, change, change_percent, direction}, ... }` | `direction: "up"\|"down"\|"flat"` drives flash color |
| UI-02 (sparkline) | `/api/stream/prices` | GET (SSE) | Same as UI-01 | Ring buffer of last 60 prices per ticker |
| UI-03 (main chart) | `/api/stream/prices` | GET (SSE) | Same — filter by `selectedTicker` | No separate endpoint; reuse SSE |
| UI-04 (treemap) | `/api/portfolio` | GET | `{cash_balance, total_value, positions: [{ticker, quantity, avg_cost, current_price, market_value, unrealized_pnl, change_percent}]}` | Cells sized by `market_value`, colored by `unrealized_pnl` |
| UI-05 (P&L chart) | `/api/portfolio/history` | GET | `[{total_value, recorded_at}]` ascending time | Background task records every 30s + after each trade |
| UI-06 (positions table) | `/api/portfolio` | GET | Same as UI-04 | Columns from `positions[]` |
| UI-07 (trade bar) | `/api/portfolio/trade` | POST | Body `{ticker, quantity, side}`; 200 → `{ticker, side, quantity, price, cash_balance}`; 400 → `{detail: "<TradeError message>"}` | Optimistic update on 200; map `detail` strings to UI-SPEC copy |
| UI-08 (chat) | `/api/chat` | POST | Body `{message}`; 200 → `{message, actions: {trades: [{ticker, side, quantity, status, detail}], watchlist_changes: [{ticker, action, status, detail}]}}`; 400 → `{detail: "message must not be empty"}` | LLM is `LLM_MOCK=true` for dev/test; `OPENROUTER_API_KEY` for prod |
| UI-09 (header) | `/api/portfolio` (initial + 10s poll) + `/api/stream/prices` (live currentPrice) | GET + SSE | `total_value` is `cash + Σ(qty × currentPrice)` — derive in Header (D-06) | Cash from PortfolioContext; currentPrice from PriceContext |
| UI-10 (add/remove watchlist) | `/api/watchlist` POST/DELETE | POST `{ticker}` → `{status: "ok", ticker}`; DELETE `/{ticker}` → `{status: "ok", ticker}` | 400 if `ticker` not alphanumeric | Optimistic remove; revert on DELETE error |
| UI-11 (aesthetic) | n/a (CSS only) | — | Tailwind tokens locked in UI-SPEC | All panels use `bg-surface-panel`, borders `border-white/5` |
| UI-12 (SSE reconnect) | `/api/stream/prices` | GET (SSE) | Server sends `retry: 1000\n\n` (verified stream.py:62) | Browser auto-reconnects per spec |

**Gap analysis: zero gaps.** Every UI requirement maps to an existing endpoint. No new backend routes are needed (only D-02's CORS middleware).

### Trade Error → UI Copy Mapping (UI-07)

Backend `TradeError` messages verified against `backend/app/portfolio_service.py:80-145`:

| Backend `detail` (substring) | UI-SPEC Copy |
|------------------------------|--------------|
| `Insufficient cash:` | `Insufficient cash for this order.` |
| `Insufficient shares of` | `You don't own that many shares of {ticker}.` |
| `No price available for ticker` | `No live price for {ticker}. Try again in a moment.` |
| `Quantity must be positive` | `Quantity must be positive.` |
| `Unknown side` | `Invalid trade side.` |

### Chat Actions Shape (UI-08)

Verified against `backend/app/chat_service.py:220-296`:

```ts
type ChatAction =
  | { ticker: string; side: 'buy'|'sell'; quantity: number; status: 'executed'|'error'; detail: string }
  | { ticker: string; action: 'add'|'remove'; status: 'ok'|'error'; detail?: string };

type ChatResponse = {
  message: string;        // assistant text
  actions: {
    trades: ChatAction[];           // subset with side/quantity
    watchlist_changes: ChatAction[]; // subset with action
  };
};
```

UI-SPEC's inline confirmation chips use `✓ Bought {qty} {ticker} @ ${price}` (executed) or `✗ Trade failed: {detail}` (error). Map directly from `actions.trades[].status` + `actions.trades[].detail` + the post-trade `price` (need a second fetch to get the price from `/api/portfolio` after the chat auto-executes trades — or extract from `detail` string like `Executed at $190.50`).

**Refinement for v1:** Parse the price out of `detail` with a regex (`Executed at \$([\d.]+)`). This avoids a redundant `/api/portfolio` fetch on every chat response. Alternative: trigger `refreshPortfolio()` after the chat response resolves; the price will be on the updated position row.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next export` CLI | `output: 'export'` in `next.config.js` | Next 13.4 / 14.0 | `next export` deprecated then removed in v14. Must use config. |
| `Pages Router` with `getStaticProps` | `App Router` with Server/Client Components | Next 13.4 stable | All UI-SPEC components are `'use client'` (browser-only); no RSC needed. |
| Recharts 2.x (`Cell` component, `activeShape`/`inactiveShape`) | Recharts 3.x (`shape` prop, `isActive` callback) | Recharts 3.0 (early 2024); 3.7 added TypeScript strict | For Treemap `content` callback, still works as in 2.x — UI-SPEC's pattern unchanged. |
| `EventSource` polyfills (`eventsource` npm) | Native `EventSource` | Always | Polyfills only needed for old IE/Edge; modern browsers ship it. |
| Tailwind 3.x JS config | Tailwind 4.x CSS-first `@theme` config | Tailwind 4.0 (early 2025) | **DO NOT upgrade to 4.x** — UI-SPEC's `theme.extend.colors` syntax is v3-only. Pin 3.4.x. |
| WebSockets for one-way streaming | Server-Sent Events | Always preferred for one-way | SSE = simpler, no bidirectional overhead, native browser, auto-reconnect. UI-SPEC explicitly chose SSE. |

**Deprecated/outdated:**
- `next export` CLI command — removed in v14.
- Recharts `<Cell>` component — deprecated in 3.7.0, use `<Xxx shape={...}>` instead. Not used by UI-SPEC's pattern.
- Recharts `<Pie activeShape/inactiveShape>` — deprecated in 3.5.0, use `isActive` in shape callback. Not used.
- `<input type="image">` inside form — not a concern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recharts 3.9.0 works with `output: 'export'` without manual dynamic-import wrangling | Standard Stack | If Recharts 3.x SSR-rendering fails, executor must wrap chart components in `next/dynamic` with `ssr: false`. Mitigation: `'use client'` directive + `mounted` flag pattern in Pitfall 1. |
| A2 | React 18 is preferable to React 19 for this app | Standard Stack | If executor prefers React 19 (which Recharts 3.x officially supports), the app still works but may surface hydration warnings. The UI-SPEC does NOT pin a React major, so this is a soft preference. |
| A3 | Next 14.2.x is the right pin (UI-SPEC says "Next 14") | Standard Stack | If executor pins Next 15 or 16, behavior may differ (Next 16 deprecated several export-related configs in canary). 14.2.x is the safest UI-SPEC-compliant choice. |
| A4 | Backend CORS env var is `CORS_ORIGINS` (D-02 leaves name to Claude's discretion) | Common Pitfall 7 | If executor picks a different name, dev cross-origin fails silently. Recommendation in Pitfall 7. |
| A5 | SSE payload is a flat `{ticker: {...}}` map (verified against stream.py:80-83) | Backend Contract Mapping | Verified by reading the source. If backend changes to wrapper format (`{type: "prices", data: {...}}`), the parser breaks. Low risk — backend is locked from Phase 1. |
| A6 | `output: 'export'` produces `out/` which is copied to `backend/static/` by Phase 4 Dockerfile | Architecture Diagram | Phase 4 concern, not Phase 3. Phase 3 must just ensure `next build` exits 0 and `out/` is generated. |
| A7 | `OPENROUTER_API_KEY` is the env var name for chat enablement | UI-08 | Verified in `backend/app/llm.py` (read `OPENROUTER_API_KEY` env var). If backend changes name, frontend check breaks. Low risk. |

**If this table is empty:** No — 7 assumptions flagged. The high-risk items (A1, A6) are well-mitigated; medium-risk items (A2, A3) are version-pin recommendations the planner should explicitly call out in tasks.

## Open Questions

1. **Should the UI be dark-forced or dark-by-default?**
   - What we know: UI-SPEC says `darkMode: 'class'` "forced-dark (no toggle)". The `<html>` element gets `class="dark"`. No light-mode toggle exists.
   - What's unclear: Should there be a `prefers-color-scheme: light` fallback for users who want light? UI-SPEC says no — forced dark always.
   - Recommendation: Forced dark per UI-SPEC. If user requests light mode in v2, it's a v2 task.

2. **Should the `selectedTicker` persist across page reloads?**
   - What we know: UI-SPEC says "No URL routing for ticker selection in v1 — terminal is a single dashboard." So selectedTicker lives in AppShell state and resets on reload.
   - What's unclear: If the user selects AAPL and refreshes, do they expect AAPL to still be selected?
   - Recommendation: Per UI-SPEC, no persistence in v1. (Could be added with `localStorage` in v2 if requested.)

3. **What does the treemap look like for a single position or zero positions?**
   - What we know: Recharts `<Treemap>` with 1 or 0 nodes renders an empty SVG or a single full-size cell.
   - What's unclear: Visual treatment.
   - Recommendation: When `positions.length === 0`, show `<EmptyState>` instead of treemap (UI-SPEC's "No open positions" empty state). When `positions.length === 1`, the treemap is a single full-width cell — acceptable.

4. **How to handle `OPENROUTER_API_KEY` unset in the browser?**
   - What we know: `backend/app/llm.py:is_llm_enabled()` reads the env var server-side. If unset, the server likely returns an error or 503.
   - What's unclear: Whether the server gracefully reports "AI Assistant unavailable" or just returns 500.
   - Recommendation: UI-SPEC defines a "Chat disabled" empty state. Plan executor should probe the server with a test POST and check the response code; if 500/503, render the disabled state on initial render via a small `GET /api/health` probe OR a dedicated `GET /api/chat/status` endpoint. **Flag as a minor risk — Phase 2 may need a small `is_chat_enabled` probe.** If unavailable, fall back to always showing the "AI Assistant unavailable" empty state and blocking the send button.

## Environment Availability

> Phase 3 needs Node.js for `next build` and `next dev`. The backend Python deps are already installed in `backend/.venv`.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `next dev`, `next build` | ✓ | 24.16.0 (verified `node --version`) | — |
| npm | Package install | ✓ | 11.13.0 (verified `npm --version`) | — |
| uv (Python) | Backend running | ✓ | 0.11.16 (verified `uv --version`) | — |
| Backend FastAPI | Dev cross-origin testing | ✓ (in `backend/.venv`) | FastAPI 0.115+ (locked in pyproject) | — |
| `OPENROUTER_API_KEY` | Real LLM chat | optional | n/a | `LLM_MOCK=true` for dev/test |
| `MASSIVE_API_KEY` | Real market data | optional | n/a | Defaults to GBM simulator |

**Missing dependencies with no fallback:** none. Node + npm are present.
**Missing dependencies with fallback:** none. `OPENROUTER_API_KEY` and `MASSIVE_API_KEY` are optional and have mock/simulator fallbacks.

## Validation Architecture

> Workflow `nyquist_validation: true` is enabled in `.planning/config.json` (line 24). Include this section.

### Test Framework

> Phase 3 explicitly defers frontend tests to Phase 4 (per CONTEXT.md "Deferred Ideas"). Playwright E2E tests live in Phase 4. **No frontend test framework introduced in Phase 3.**

| Property | Value |
|----------|-------|
| Framework | None introduced this phase |
| Config file | n/a |
| Quick run command | n/a |
| Full suite command | n/a |

### Manual Verification (Phase 3 Baseline)

Since no test framework is added in Phase 3, validation is **manual smoke testing against `next dev` + backend**:

| Behavior | Test Type | Manual Command | Acceptance |
|----------|-----------|----------------|------------|
| SSE live prices update | manual smoke | `cd frontend && npm run dev` then open `http://localhost:3000`, watch prices change every ~500ms | ConnectionDot turns green; prices tick |
| Watchlist flash | manual smoke | Add a high-volatility ticker (or use default NVDA/TSLA) | Row bg flashes green/red for 500ms on each tick |
| Sparkline accumulates | manual smoke | Watch any row for 30s | Sparkline grows right; chart shape matches recent direction |
| Click ticker → main chart | manual smoke | Click AAPL row | MainChart shows AAPL price history |
| Trade bar fills instantly | manual smoke | Type "AAPL", qty 1, click Buy | Toast "Bought 1 AAPL @ $X"; positions table updates within ~200ms |
| Chat with `LLM_MOCK=true` | manual smoke | Set `LLM_MOCK=true` in backend `.env`, send "Buy 1 AAPL" | Mock response renders; inline chip `✓ Bought 1 AAPL @ $X` |
| Header total updates live | manual smoke | Watch header "Total Value" while prices tick | Number updates every ~500ms |
| Build succeeds | manual | `npm run build` | Exit 0, `out/` directory generated |

### Sampling Rate (Phase 3)

- **Per task commit:** Manual smoke test the relevant panel in `next dev`.
- **Per plan completion:** Full manual smoke + `npm run build` exit 0.
- **Phase gate:** Phase 3's `/gsd-verify-work` requires all 8 manual smoke checks passing.

### Phase 4 Validation (Forward-Looking)

When Phase 4 introduces Playwright E2E tests (TEST-05..TEST-08), they will cover:
- TEST-05: Fresh start shows default watchlist ($10k, 10 tickers, prices streaming) — maps to UI-01, UI-02, UI-09.
- TEST-06: Buy shares → cash decreases, position appears, heatmap updates — maps to UI-04, UI-06, UI-07.
- TEST-07: Sell shares → cash increases, position updates or disappears — maps to UI-07.
- TEST-08: AI chat with mock LLM → response + inline trade confirmation — maps to UI-08.

These are Phase 4 concerns. Phase 3 only needs to ensure the manual smoke tests pass.

### Wave 0 Gaps

- [ ] No test framework install needed.
- [ ] No fixture data needed (backend already seeds).
- [ ] Manual smoke checklist above serves as the Wave 0 deliverable.

*(If gaps: "None — Phase 3 defers all test framework installation to Phase 4")*

## Security Domain

> `security_enforcement: true` in `.planning/config.json` (line 46). ASVS level 1. Include this section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Single-user app (hardcoded `DEFAULT_USER_ID="default"`). No login, no sessions. Future v2 INFRA-03. |
| V3 Session Management | no | No sessions — no cookies, no JWT, no token. |
| V4 Access Control | no | Single-user. All data owned by "default". |
| V5 Input Validation | yes | Trade bar validates `quantity > 0`; add-ticker validates alphanumeric. Backend re-validates (`backend/app/routes/watchlist.py:83`, `backend/app/portfolio_service.py:80-83`). Defense-in-depth — frontend validation is UX, backend is security. |
| V6 Cryptography | no | No secrets stored client-side. `NEXT_PUBLIC_API_BASE_URL` is the only public env var (not sensitive). `OPENROUTER_API_KEY` is server-side only. |
| V7 Error Handling | yes | Error toasts don't leak stack traces. UI-SPEC copy contract: "Never use technical stack traces in user-facing copy." |
| V8 Data Protection | no | All data is non-sensitive simulated trading data. |
| V9 Communications | yes (partial) | Same-origin in prod (D-01). In dev, CORS middleware (D-02) restricted to `localhost:3000` via `CORS_ORIGINS` env var. No wildcards. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via ticker symbol rendered in chat/positions | Tampering | React's default JSX escaping. All ticker strings rendered via `{ticker}` (auto-escaped). No `dangerouslySetInnerHTML`. |
| CSRF on trade/watchlist mutations | Tampering | Stateless same-origin POSTs; no cookies used; same-origin policy + CORS gate. **Risk:** if future dev sets `allow_credentials=True` with wildcard origin — must explicitly set allowed origins. |
| Open redirect via SSE | Information Disclosure | SSE endpoint doesn't redirect. Static mount serves from `STATIC_DIR` (configured path). |
| Price-flash DOS via flood | Denial of Service | SSE is server-driven (500ms cadence); client cannot increase frequency. Browser handles connection limit (6 per origin, per MDN). |
| Chat prompt injection via crafted LLM response | Tampering | Backend `handle_chat` re-validates every trade against `TradeError` rules (insufficient cash, etc.) before executing. Defense-in-depth. Frontend just renders. |

### Security Implementation Checklist for Phase 3

- [ ] All `fetch` calls use the `apiUrl()` helper — no string concatenation of user input into URLs.
- [ ] All ticker rendering uses `{ticker}` — no `dangerouslySetInnerHTML`.
- [ ] All error toasts map backend `detail` strings to UI-SPEC copy — never render raw `detail`.
- [ ] No secrets in `NEXT_PUBLIC_*` env vars.
- [ ] `OPENROUTER_API_KEY` is read server-side only.
- [ ] CORS middleware (D-02) sets `allow_origins` to a comma-separated list, never `*`.
- [ ] EventSource URL is `apiUrl('/api/stream/prices')` — relative in prod, absolute in dev via D-01.

## Sources

### Primary (HIGH confidence)

- Next.js docs `https://nextjs.org/docs/app/guides/static-exports` (verified 2026-06-27): static export config, supported features, unsupported features, deploy pattern.
- Next.js docs `https://nextjs.org/docs/app/api-reference/config/next-config-js` (verified 2026-06-27): full config reference.
- MDN `https://developer.mozilla.org/en-US/docs/Web/API/EventSource` (verified 2026-06-27): readyState values, onerror behavior.
- HTML Living Standard `https://html.spec.whatwg.org/multipage/server-sent-events.html` (verified 2026-06-27): `retry:` directive semantics.
- npm registry `npm view recharts version` → 3.9.0, peer deps `{react: ^16.8 || ^17 || ^18 || ^19}` (verified 2026-06-27).
- npm registry `npm view lucide-react version` → 1.21.0, peer deps `{react: ^16.5.1 || ^17 || ^18 || ^19}` (verified 2026-06-27).
- GitHub `https://github.com/recharts/recharts/releases` (verified 2026-06-27): v3.9.0 release notes, v3.7.0 Cell deprecation, v3.5.0 Pie activeShape deprecation.
- Backend source `backend/app/market/stream.py` (read in full): SSE payload shape, retry directive, interval.
- Backend source `backend/app/market/models.py` (read in full): `PriceUpdate.to_dict()` shape with `direction`.
- Backend source `backend/app/routes/portfolio.py`, `watchlist.py`, `chat.py` (read in full): request/response shapes.
- Backend source `backend/app/portfolio_service.py` (read in full): `TradeError` messages for error mapping.
- Backend source `backend/app/chat_service.py` (read in full): chat actions shape.
- Backend source `backend/app/main.py` (read in full): CORS integration point (D-02), StaticFiles mount.
- UI-SPEC `03-UI-SPEC.md` (read in full): locked palette, component inventory, interaction contract, API contract table.
- CONTEXT `03-CONTEXT.md` (read in full): D-01..D-06 locked decisions.

### Secondary (MEDIUM confidence)

- Tailwind v4 release announcement (Q1 2025): CSS-first config breaking change — confirmed via Next.js community discussion.
- React 19 release notes (Dec 2024): Server Components stable, `use()` hook, Actions — none used by this app.

### Tertiary (LOW confidence)

- None — all critical claims either verified against source code (backend) or primary docs (Next.js, MDN, HTML spec, npm registry).

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — npm registry versions verified 2026-06-27; Recharts 3.9.0 peer deps confirm React 18/19 compatibility; all locked by UI-SPEC.
- Architecture: **HIGH** — backend source read in full; every endpoint shape verified; every SSE payload shape verified; CONTEXT.md D-01..D-06 explicit.
- Pitfalls: **MEDIUM** — some pitfalls (Recharts hydration, Tailwind v4 breaking) are based on training-data knowledge of common Next.js + Recharts + Tailwind interactions; not formally tested in this session.
- Backend contract mapping: **HIGH** — every endpoint read directly from `backend/app/routes/*.py`.

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (30 days — stable libraries; new Recharts major unlikely within 30 days)