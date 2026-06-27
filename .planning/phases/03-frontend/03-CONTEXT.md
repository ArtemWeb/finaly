# Phase 3: Frontend - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the complete Next.js dark trading terminal as a **static export** (`output: 'export'`), served by the existing FastAPI backend, consuming the already-implemented REST + SSE API. Scope is the 12 UI requirements (UI-01..UI-12): watchlist with 500ms flash + accumulating sparklines, click-to-select main chart, portfolio heatmap (treemap) + positions table + P&L line chart, instant-fill trade bar, AI chat panel with inline confirmations, and a header with live total value + cash + SSE connection dot.

The full visual and interaction contract is **already locked** in `03-UI-SPEC.md` (design system, color palette, spacing, typography, every UI string, the 16-component inventory, and the interaction contract). This discussion did **not** re-decide any of that. It captured only the **integration and architecture decisions the UI-SPEC left open**: how the frontend talks to the backend across dev/prod, and how shared state is wired through the component tree.

Out of scope (owned by Phase 4): Dockerfile, start/stop scripts, Playwright E2E tests, backend unit tests.

</domain>

<decisions>
## Implementation Decisions

### Dev↔Prod API Wiring
- **D-01: Relative paths + env override for base URL.** All `fetch` and `EventSource` URLs default to relative `/api/...` (works same-origin in production where FastAPI serves both the static export and the API — zero config). A single URL-builder helper module reads `NEXT_PUBLIC_API_BASE_URL`: empty/unset in prod, `http://localhost:8000` in dev. Chosen because `output: 'export'` produces pure static files with no runtime Node server, so prod is inherently same-origin; requiring an absolute URL in prod would add a needless build-time env dependency and a failure mode.
- **D-02: Add dev-gated CORS middleware to the backend.** In dev, `next dev` runs on `:3000` and must reach the backend on `:8000`, but `backend/app/main.py` currently has **no CORS middleware**. Add `CORSMiddleware` inside `create_app()` with allowed origins sourced from an env var (e.g. `CORS_ORIGINS`, default empty → effectively off). Prod stays same-origin so CORS is inert there. Chosen over Next dev `rewrites` proxy because rewrites are dropped by `output: 'export'` at build (so they can't help prod) **and** proxying SSE/`EventSource` through the Next dev server risks response buffering that breaks the live stream — adding CORS is the lower-risk path for the real-time requirement. ⚠ This edits Phase 1 code (`main.py`); planner should treat it as a small, isolated backend change.
- **D-03: First-load state = skeleton panels + connecting dot.** Before the initial `/api/portfolio` and `/api/watchlist` fetches resolve and SSE connects, panels render their frame immediately with subtle skeleton placeholders, and the `ConnectionDot` starts yellow ("Reconnecting…"/connecting) and flips green on SSE `onopen`. Chosen over showing the locked per-panel empty states (which would briefly display misleading "No tickers yet"/"No open positions" copy during loading) and over a full-screen loader (which hides the terminal aesthetic on load). Reuses the already-locked `EmptyState` and `ConnectionDot` components.

### Shared State Architecture
- **D-04: Distribute shared state via React Context provider(s), not prop-drilling.** Providers mounted at `AppShell` hold state and expose data + refresh functions through context hooks. Chosen because SSE prices are consumed simultaneously by `Header`, `WatchlistRow`, and `PositionsTable`'s current-price column; threading prices + `refreshPortfolio()`/`refreshWatchlist()` through `AppShell→columns→panels→rows` as props would be verbose and brittle across the 16-component tree. Stays within the UI-SPEC's "`useState` + `useSse`, no Redux/Zustand" mandate — Context is plain React.
- **D-05: Split contexts by update frequency.** Separate **PriceContext** (high-churn SSE price map keyed by ticker + `selectedTicker`, updated every ~500ms) from **PortfolioContext** (portfolio, watchlist, `refreshPortfolio`/`refreshWatchlist`, the 10s safety poll — low churn, changes only on mutation/poll). Components subscribe only to what they need, so a price tick does not re-render the positions table's static columns. Directly supports the UI-SPEC's rAF-debounced 60fps goal with 10 tickers streaming.
- **D-06: Derive the live total portfolio value in the Header consumer.** The header total (`cash + Σ(qty × currentPrice)`) spans both contexts — `cash`/`qty` from PortfolioContext, `currentPrice` from PriceContext. The `Header` subscribes to both and computes the total in a `useMemo`. Chosen over storing `total_value` in PortfolioContext (which would couple high-churn prices back into the low-churn context and reintroduce the re-render problem D-05 avoids). Contexts stay pure data sources; the only component needing the live total owns its derivation. (A `useTotalValue()` selector hook is an acceptable equivalent if reuse emerges, but Header-derived is the v1 baseline.)

### Claude's Discretion
- Exact context module structure, provider nesting order, and hook naming (`usePrices()`, `usePortfolio()`, etc.) are left to the planner/executor, consistent with D-04/D-05.
- The precise `CORS_ORIGINS` env-var name/format and where the URL-builder helper lives in `frontend/src/` are implementation details for planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design & interaction contract (read FIRST)
- `.planning/phases/03-frontend/03-UI-SPEC.md` — **Locked design contract.** Design system (Tailwind-only, Recharts, lucide-react, Next 14 App Router + TS strict, `output: 'export'`), full color palette, spacing scale, typography, the complete copywriting contract (every UI string — use verbatim, no synonyms), the 16-component inventory with file paths under `frontend/src/components/`, the interaction contract (`useSse` behavior, flash, sparkline ring buffer, trade/chat flows), accessibility rules, and the API contract reference table. This file overrides any conflicting assumption.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §UI-01..UI-12 — the 12 frontend requirements this phase satisfies.
- `.planning/ROADMAP.md` §"Phase 3: Frontend" — goal + 5 success criteria (flash/sparkline, click-to-chart, heatmap+table, instant trade update, live header + dark aesthetic).

### Backend API the frontend consumes (verify shapes against source)
- `backend/app/main.py` — `create_app()` factory, static mount at `/`, router registration, `STATIC_DIR` env (default `static`). **This is the file D-02's CORS middleware is added to.**
- `backend/app/routes/portfolio.py` — `GET /api/portfolio`, `POST /api/portfolio/trade`, `GET /api/portfolio/history`.
- `backend/app/routes/watchlist.py` — `GET/POST /api/watchlist`, `DELETE /api/watchlist/{ticker}`.
- `backend/app/routes/chat.py` — `POST /api/chat` (returns `{ message, actions: { trades, watchlist_changes } }`).
- `backend/app/market/stream.py` — `GET /api/stream/prices` SSE endpoint, `retry: 1000` directive, per-tick payload = union of tracked tickers' `PriceUpdate.to_dict()`.
- `backend/app/market/models.py` — `PriceUpdate` shape (`direction: "up"|"down"|"flat"` drives flash + sparkline stroke color).

### Codebase maps (background)
- `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md` — existing backend conventions; the new `frontend/` tree establishes its own TS/Next conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Backend API is fully implemented and stable** — all routes (`portfolio`, `watchlist`, `chat`, `stream`, `health`) exist and match the UI-SPEC API contract table. The frontend is a pure consumer; no backend work beyond D-02's CORS addition.
- **`StaticFiles` mount already wired** in `main.py` at `/` with `html=True`, reading `STATIC_DIR` (default `static`). The frontend's `output: 'export'` build output must land where the Docker build copies it into the backend's `STATIC_DIR` (the exact copy path is a Phase 4 / Dockerfile concern, but the export target should be planned now).
- **`ConnectionDot` / `EmptyState`** are specified in the UI-SPEC inventory and are reused by D-03's first-load state.

### Established Patterns
- Backend uses **async + dependency-injected router factories** (`create_*_router(cache, ...)`); the frontend mirrors this only conceptually (provider injection at `AppShell` per D-04).
- SSE auto-reconnect is **server-driven** (`retry: 1000`) — the UI-SPEC says no custom backoff; the dot just reflects `EventSource.readyState`.

### Integration Points
- **New code lives entirely under `frontend/`** (does not exist yet — greenfield). The single cross-cutting backend touch is `CORSMiddleware` in `backend/app/main.py:create_app()` (D-02).
- The URL-builder helper (D-01) is the single chokepoint between every frontend network call and the backend; getting it right makes dev/prod parity trivial.

</code_context>

<specifics>
## Specific Ideas

- The UI-SPEC is treated as a hard contract: copy strings verbatim, implement components at their specified paths, follow the locked palette/spacing/typography exactly. The `gsd-ui-checker` will sign off against the 6 dimensions, so deviations are not free.
- Context split mirrors the real data cadence in this app: SSE @ ~500ms × up to 10 tickers (PriceContext) vs mutation/10s-poll (PortfolioContext) — this is the concrete justification for D-05, not a generic "split your contexts" rule.

</specifics>

<deferred>
## Deferred Ideas

- **Scaffolding & build approach** (create-next-app vs hand-rolled, version pinning, export target path) — selected as a discussable area but not deep-dived; left for the planner to handle as a standard setup task, informed by the UI-SPEC's locked stack (Next 14, Tailwind, Recharts, lucide-react). Not a gray area requiring user input.
- **Phase 3 frontend component tests** — considered; Phase 4 owns Playwright E2E and backend unit tests per ROADMAP. Phase 3 stays implementation-focused; verifying the UI this phase is done via `next dev` against a locally-running backend (enabled by D-02's CORS). No new test framework introduced in Phase 3.

</deferred>

---

*Phase: 3-Frontend*
*Context gathered: 2026-06-27*
