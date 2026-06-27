---
phase: 03-frontend
reviewed: 2026-06-27T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - backend/app/main.py
  - frontend/src/app/page.tsx
  - frontend/src/app/layout.tsx
  - frontend/src/components/chart/MainChart.tsx
  - frontend/src/components/chat/ChatMessage.tsx
  - frontend/src/components/chat/ChatPanel.tsx
  - frontend/src/components/layout/AppShell.tsx
  - frontend/src/components/layout/ConnectionDot.tsx
  - frontend/src/components/layout/Header.tsx
  - frontend/src/components/portfolio/PnLChart.tsx
  - frontend/src/components/portfolio/PortfolioHeatmap.tsx
  - frontend/src/components/portfolio/PositionsTable.tsx
  - frontend/src/components/trade/TradeBar.tsx
  - frontend/src/components/ui/EmptyState.tsx
  - frontend/src/components/ui/Toast.tsx
  - frontend/src/components/watchlist/PriceFlash.tsx
  - frontend/src/components/watchlist/Sparkline.tsx
  - frontend/src/components/watchlist/WatchlistPanel.tsx
  - frontend/src/components/watchlist/WatchlistRow.tsx
  - frontend/src/context/PortfolioContext.tsx
  - frontend/src/context/PriceContext.tsx
  - frontend/src/hooks/useSse.ts
  - frontend/src/lib/api.ts
  - frontend/src/lib/format.ts
  - frontend/src/lib/types.ts
findings:
  critical: 3
  warning: 8
  info: 6
  total: 17
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-27
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Reviewed the Next.js 14 static-export frontend (TypeScript strict, Recharts, dual React contexts, native SSE) plus the dev-gated CORS change in `backend/app/main.py`. The architecture is sound — high-churn/low-churn context split, rAF coalescing, optimistic mutations with revert, and consistent use of `{value}` JSX (no `dangerouslySetInnerHTML`) so the XSS surface is genuinely small.

However, the review surfaced three BLOCKER-class defects:

1. The ChatPanel "disabled" probe sends a real `__probe__` message through the full chat pipeline on every mount — calling the LLM, allowing auto-execution of trades/watchlist changes, and persisting a junk turn into `chat_messages` that contaminates subsequent conversation history.
2. The dev-gated CORS middleware combines `allow_credentials=True` with `allow_methods/allow_headers=["*"]`, and is keyed only on `CORS_ORIGINS` being non-empty — a misconfiguration footgun that can ship to production.
3. Runtime-interpolated Tailwind arbitrary classes (`min-h-[${height - 32}px]`, `min-h-[${HEIGHT}px]`) are never emitted by the JIT compiler because Tailwind statically scans source — the min-height constraints silently do nothing.

Several WARNING-level React-correctness issues (effect-dependency and ref-mutation hazards, a non-reverted optimistic clear, an `aria-label` mismatch) and a handful of INFO items round out the report.

## Critical Issues

### CR-01: Chat "disabled" probe sends a real LLM turn on every mount — side effects, cost, and history contamination

**File:** `frontend/src/components/chat/ChatPanel.tsx:87-112`
**Issue:**
The mount effect POSTs `{ message: '__probe__' }` to `/api/chat` to detect whether chat is enabled. But `/api/chat` is not a cheap liveness check — `backend/app/routes/chat.py:85-89` forwards any non-empty message straight into `handle_chat()`, which (`backend/app/chat_service.py:175-334`):

- Calls the real LLM via `complete_chat()` (cost + latency on *every page load / reconnect / remount*).
- Auto-executes any `trades` / `watchlist_changes` the model returns in reply to `__probe__` (`chat_service.py:219-296`). There is no server-side allowlist that exempts the probe, so a model that hallucinates an action on the literal string `__probe__` will mutate the portfolio with zero user intent.
- Persists both a `user` row (`content="__probe__"`) and an `assistant` row into `chat_messages` (`chat_service.py:305-326`). `_load_history()` (`chat_service.py:147-167`) then injects that junk turn into the prompt context of the user's *real* first message, degrading every later reply.

The client discards the probe *response*, but the server-side side effects (LLM spend, possible trades, DB pollution) are already permanent. This also contradicts UI-SPEC line 233 ("POST is blocked client-side") — the probe does the opposite of blocking.

**Fix:**
Do not probe by sending a chat message. Detect chat availability with a dedicated, side-effect-free signal. Either add a backend capability flag to `/api/health` (e.g. `{"status":"ok","chat_enabled":true}`) and read it, or add a `GET /api/chat/status` that only inspects env config:

```ts
// ChatPanel mount effect
useEffect(() => {
  let cancelled = false;
  void (async () => {
    try {
      const res = await fetch(apiUrl('/api/health'));
      const data = (await res.json()) as { chat_enabled?: boolean };
      if (!cancelled) setDisabled(data.chat_enabled === false);
    } catch {
      if (!cancelled) setDisabled(true);
    }
  })();
  return () => { cancelled = true; };
}, []);
```
```python
# backend: expose capability without invoking the LLM
@application.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "chat_enabled": bool(os.environ.get("OPENROUTER_API_KEY")) or os.environ.get("LLM_MOCK") == "true"}
```

### CR-02: Dev-gated CORS allows credentials with wildcard methods/headers and is gated only on a non-empty origins var

**File:** `backend/app/main.py:155-165`
**Issue:**
The middleware is enabled whenever `CORS_ORIGINS` is non-empty and sets `allow_credentials=True` together with `allow_methods=["*"]` and `allow_headers=["*"]`. Two concrete risks:

1. **Production footgun:** The only gate is "is `CORS_ORIGINS` set?". There is no environment/`DEBUG` check, so if `CORS_ORIGINS` is ever present in a production `.env` (copy-paste from a dev template, container env inheritance), the backend that serves the static export will *also* accept cross-origin credentialed requests. The comment claims production "stays inert," but nothing enforces that — it relies entirely on an env var being absent.
2. **Credentialed wildcard surface:** With `allow_credentials=True`, the response echoes the caller's `Origin` (per the configured list) and permits all methods and all request headers. If `CORS_ORIGINS` is set loosely (e.g. includes a broad or attacker-controllable origin), this enables credentialed cross-site calls to the trade/chat mutation endpoints. Since trades execute with no confirmation, a permissive origin entry is directly exploitable.

**Fix:**
Gate on an explicit dev flag in addition to the origins list, and scope methods/headers to what the frontend actually uses:

```python
cors_origins = os.environ.get("CORS_ORIGINS", "")
allow_cors = os.environ.get("ENABLE_CORS", "").lower() == "true"
if cors_origins and allow_cors:
    from fastapi.middleware.cors import CORSMiddleware
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
```
At minimum, document that `CORS_ORIGINS` must never be set in production and add a startup `logger.warning` when it is enabled.

### CR-03: Runtime-interpolated Tailwind arbitrary classes are never generated — min-height constraints silently fail

**File:** `frontend/src/components/chart/MainChart.tsx:78`; `frontend/src/components/portfolio/PortfolioHeatmap.tsx:127`
**Issue:**
Both sites build a Tailwind arbitrary-value class from a runtime expression:

```tsx
minHeightClass={`min-h-[${height - 32}px]`}        // MainChart → "min-h-[368px]"
minHeightClass={`min-h-[${HEIGHT}px]`}             // PortfolioHeatmap → "min-h-[240px]"
```

Tailwind's JIT compiler discovers classes by **statically scanning source text** (`content: ['./src/**/*.{ts,tsx}']` in `tailwind.config.ts`). It cannot evaluate template interpolation, so `min-h-[368px]` and `min-h-[240px]` are never present as literal tokens anywhere in the codebase and are therefore **omitted from the generated CSS**. The empty states render with `EmptyState`'s default `min-h-[200px]` only (that literal exists), and the intended taller min-heights are silently dropped. In `next build` (static export) there is no JIT-on-demand fallback, so this fails in production.

**Fix:**
Use a static class (which Tailwind can see) or an inline style for the dynamic value:

```tsx
// MainChart — pass an inline style instead of a dynamic class
<EmptyState heading="Select a ticker" body="…" style={{ minHeight: height - 32 }} />
// (add `style?: CSSProperties` to EmptyStateProps and apply it on the root div)
```
```tsx
// PortfolioHeatmap — HEIGHT is a constant; use a literal class so JIT sees it
minHeightClass="min-h-[240px]"
```
For PortfolioHeatmap the value is the compile-time constant `HEIGHT = 240`, so hardcoding `min-h-[240px]` as a literal string is the minimal correct fix. For MainChart, prefer an inline `style` since `height` is a prop.

## Warnings

### WR-01: PriceContext exposes a mutable ref as the `history` context value — memo never sees the mutation

**File:** `frontend/src/context/PriceContext.tsx:62, 91, 117-127`
**Issue:**
`history: historyRef.current` is placed in the memoized context value, but `historyRef.current` is the *same object reference* across renders — `handleMessage` mutates the buffers in place (`buf.push(...)`, `historyRef.current[ticker] = buf`). The `useMemo` dependency array (line 126) does **not** include anything that changes when buffers update; re-render is driven separately by `forceHistoryTick`. This works today only because `forceHistoryTick` triggers a render and consumers re-read `history[ticker]` by reference. It is fragile: any consumer that memoizes on the `history` *object identity* (it never changes) will never recompute. `WatchlistRow`'s `sparkData` memo (line 47-50) depends on `[history, ticker]` — `history` identity is stable, so the only reason it recomputes is that the whole row re-renders from the tick; the dependency is misleading.

**Fix:**
Make the buffer update produce a new top-level object so identity-based memoization is correct, or document loudly that `history` identity is intentionally stable and consumers must depend on a tick counter:

```ts
// in handleMessage, after updating buffers:
historyRef.current = { ...historyRef.current };
```
Then include a version/tick in the memo deps so `value.history` identity changes per flush.

### WR-02: `clearTicker` is called twice on remove and the ring buffer is never restored on failed remove

**File:** `frontend/src/components/watchlist/WatchlistRow.tsx:57` and `frontend/src/context/PortfolioContext.tsx:187`
**Issue:**
`handleRemove` calls `clearTicker(ticker)` (WatchlistRow line 57), and `removeTicker` in `PortfolioContext` calls `clearTicker(ticker)` again (line 187) — the buffer is wiped twice. More importantly, on a **failed** DELETE both code paths revert the watchlist row (so the ticker reappears) but neither restores the wiped sparkline buffer (PortfolioContext line 193-198 explicitly chooses not to). The user sees the row come back with an empty sparkline and a phantom time gap until enough new ticks accumulate — the exact "Pitfall 3" the design claims to prevent, just inverted.

**Fix:**
Remove the duplicate `clearTicker` call in `WatchlistRow.handleRemove` (let `removeTicker` own it), and snapshot/restore the buffer on failure:

```ts
// PortfolioContext.removeTicker
const prevBuffer = /* capture via a getter on PriceContext */;
// on !res.ok or catch:
setWatchlist(previous);
restoreTicker(ticker, prevBuffer); // add a restore action, or simply refetch
```
Simplest: only `clearTicker` *after* a confirmed-successful DELETE, not optimistically.

### WR-03: `addTicker` / `removeTicker` capture stale `watchlist` via closure dependency, racing the optimistic update

**File:** `frontend/src/context/PortfolioContext.tsx:143-180, 182-207`
**Issue:**
Both mutators close over `watchlist` and store `const previous = watchlist` for revert, with `watchlist` in the `useCallback` deps. Because the optimistic `setWatchlist` uses a functional updater but `previous` is the *render-time* snapshot, rapid successive operations (add A, then remove B before A's request resolves) revert to a stale list on failure, dropping the other in-flight change. The functional-updater optimism and the snapshot-based revert are inconsistent.

**Fix:**
Revert with a functional updater that surgically undoes only this operation, instead of replacing the whole array with a stale snapshot:

```ts
// revert an add:
setWatchlist((curr) => curr.filter((w) => w.ticker !== ticker));
// revert a remove:
setWatchlist((curr) => curr.some((w) => w.ticker === ticker) ? curr : [...curr, removedEntry]);
```

### WR-04: `WatchlistRow` remove control nests an interactive `role="button"` inside a `<button>` — invalid DOM and keyboard duplication

**File:** `frontend/src/components/watchlist/WatchlistRow.tsx:68-116`
**Issue:**
The row is a `<button>` (line 68) and the remove control is a `<span role="button" tabIndex={0" onClick onKeyDown>` (lines 101-112) nested inside it. Nested interactive controls are invalid HTML — browsers may hoist the inner span out of the button, and screen readers announce a button-inside-button. `event.stopPropagation()` prevents the row click, but Enter/Space on the inner span will also be interpreted by the outer button in some AT/browser combinations. Using a real nested `<button>` would be equally invalid.

**Fix:**
Restructure so the row is a `<div role="button" tabIndex={0">` (or a clickable region) with a real `<button>` for remove as a sibling, not nested interactive-in-interactive. Keep the `aria-label="Remove {ticker} from watchlist"` on the real button.

### WR-05: ChatPanel renders a perpetual pulse skeleton if the availability probe never resolves to a boolean

**File:** `frontend/src/components/chat/ChatPanel.tsx:185-219`
**Issue:**
`disabled` starts `null` and the empty-state branch shows an `animate-pulse` skeleton while `!isReady` (i.e. while `disabled === null`). If the probe request hangs (no timeout on the `fetch`) — e.g. backend slow or a proxy holding the connection — the panel is stuck in the skeleton state indefinitely and the user can never type (the input is only enabled once `disabled === false`... actually the input is gated on `isDisabled`, but the *empty state* hides the input region behind the skeleton). There is no `AbortController` timeout.

**Fix:**
Add a timeout/abort to the probe so it resolves to a definite state, and default to *enabled* on timeout (fail-open for UX, since the real submit still surfaces errors):

```ts
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 4000);
const res = await fetch(apiUrl('/api/health'), { signal: ctrl.signal });
// ...
finally: clearTimeout(t);
// on abort/catch: setDisabled(false)  // fail-open
```

### WR-06: `useSse` reopens nothing but loses pending rAF callbacks on unmount — rAF handles never cancelled

**File:** `frontend/src/context/PriceContext.tsx:71-108` (and unmount path)
**Issue:**
`scheduleHistoryRender` and `handleMessage` call `requestAnimationFrame` and store the id in `rafRef`, but the `PriceProvider` never cancels these on unmount. When the provider unmounts (route change / fast-refresh / test teardown) a queued rAF can fire after unmount and call `setPrices` / `forceHistoryTick` on an unmounted component, producing the "state update on unmounted component" warning and a wasted render. `useSse` cleans up the EventSource, but the rAF scheduled by the last message is orphaned.

**Fix:**
Add a cleanup effect in `PriceProvider`:

```ts
useEffect(() => () => {
  if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
}, []);
```
and guard the rAF callbacks against running after unmount with a `mountedRef`.

### WR-07: `safeJson` reads `res.json()` twice in `addTicker` success path

**File:** `frontend/src/context/PortfolioContext.tsx:170-173`
**Issue:**
On a successful POST, the code first `await refreshWatchlist()` (line 171) then `await safeJson<WatchlistAddResponse>(res)` (line 172) to read `res.json()`. The `Response` body is a one-shot stream; if anything earlier consumed it this throws, and reading it *after* an awaited refresh is an ordering smell. More concretely, `body?.status === 'ok'` is the return value, but the watchlist UI has already been reconciled by `refreshWatchlist()` — so the boolean is only used by callers for a toast. If `res.json()` fails (empty 200 body), `safeJson` returns `null` and the function reports failure (`false`) even though the add succeeded, triggering a misleading "Couldn't add" toast.

**Fix:**
Read the body once, before the refresh, and treat a 2xx as success regardless of body parseability:

```ts
const body = await safeJson<WatchlistAddResponse>(res);
await refreshWatchlist();
return true; // 2xx already means success; body is advisory
```

### WR-08: `ConnectionDot` open state uses `bg-accent-blue` (blue), but spec/comments describe green for "open"

**File:** `frontend/src/components/layout/ConnectionDot.tsx:24-28` vs comment lines 5-8
**Issue:**
The component docstring states "open → green" (lines 5-8) and the design language elsewhere uses `profit` (#22c55e) for "live/up". But `DOT_CLASS.open` maps to `bg-accent-blue` (#209dd7, blue). Either the comment is wrong or the class is — they contradict. If the intended "Live" signal is green, the dot is the wrong colour; if blue is intended, the comment misleads future maintainers. This is a correctness/consistency defect, not pure style, because the comment is an explicit contract.

**Fix:**
Reconcile the two. If green is intended: `open: 'bg-profit'`. Otherwise update the docstring to say "open → blue (accent-blue)".

## Info

### IN-01: `formatPercent` "-" sign duplicates the value's own minus, but `abs` strips it correctly — verify zero/negative-zero

**File:** `frontend/src/lib/format.ts:36-41`
**Issue:** `formatPercent(-0)` → `value < 0` is false and `value > 0` is false, so sign is `''` and result is `"0.00%"` — correct. No bug, but the triple-branch sign logic is worth a unit test for `-0`, `Infinity`, and very small negatives that round to `0.00`.
**Fix:** Add explicit test cases; consider `Math.abs(value) < 0.005` to avoid `"-0.00%"`-style artifacts if `toFixed` ever rounds a tiny negative to zero with a retained sign elsewhere.

### IN-02: `nextLocalId` and Toast `nextId` are module-level mutable counters — fine for a single client, but not reset across fast-refresh

**File:** `frontend/src/components/chat/ChatPanel.tsx:71`; `frontend/src/components/ui/Toast.tsx:38`
**Issue:** Module-level `let nextLocalId = 1` / `let nextId = 1` persist across component remounts and React fast-refresh, so keys keep incrementing (harmless) but the counters never reset. Acceptable for this app; noted for awareness.
**Fix:** None required; could use `useRef`/`crypto.randomUUID()` for keys if strict isolation is ever needed.

### IN-03: `apiUrl` does not normalize double slashes or validate `path`

**File:** `frontend/src/lib/api.ts:11-14`
**Issue:** `apiUrl` concatenates `base + path` with no normalization. If `NEXT_PUBLIC_API_BASE_URL` ever ends with `/` and `path` starts with `/`, the result has `//`. All call sites pass leading-slash paths and the base has no trailing slash today, so it works — but it is brittle.
**Fix:** Trim a trailing slash from `base` defensively: `const b = base.replace(/\/$/, '')`.

### IN-04: `MainChart` `latestPrice as number` cast after `Number.isFinite` guard is safe but the cast hides intent

**File:** `frontend/src/components/chart/MainChart.tsx:84-96`
**Issue:** `latestPrice` is `number | undefined`; `Number.isFinite(latestPrice)` returns false for `undefined`, so the `as number` cast inside the guarded branch is sound. The `as` cast is a minor type-safety smell.
**Fix:** Narrow without a cast: `const latestPrice = prices[selectedTicker]?.price; ... {typeof latestPrice === 'number' && Number.isFinite(latestPrice) ? <…>{formatPrice(latestPrice)}</…> : null}`.

### IN-05: ChatMessage price regex `/Executed at \$([\d.]+)/` is brittle against backend detail-format drift

**File:** `frontend/src/components/chat/ChatMessage.tsx:33-38`
**Issue:** The chip price is scraped from the free-text `detail` string produced in `chat_service.py:232-234`. If that format ever changes, the chip silently shows `@ $?`. The coupling between a UI regex and a backend f-string is fragile.
**Fix:** Add a structured `price` field to the trade action payload (`chat_service.py` trade_records) and read it directly instead of regex-scraping `detail`.

### IN-06: `_snapshot_loop` swallows all exceptions including `CancelledError` risk via broad `except Exception`

**File:** `backend/app/main.py:49-56`
**Issue:** The loop catches `except Exception` which (correctly) does not catch `asyncio.CancelledError` (that derives from `BaseException` in 3.8+), so cancellation still works. This is fine on 3.12; noting only that a broad `except Exception` around an `await` that includes external I/O is intentional here per the T-04-02 comment.
**Fix:** None required; already correct for the stated mitigation. Consider logging at a throttled rate if `record_snapshot` fails persistently.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
