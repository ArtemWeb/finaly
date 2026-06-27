# Phase 3: Frontend - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-27
**Phase:** 3-frontend
**Areas discussed:** Dev↔Prod API wiring, Shared state architecture

> Note: `03-UI-SPEC.md` (a `/gsd-ui-phase` design contract) already locked the visual + interaction design, so those gray areas were intentionally NOT re-asked. Discussion focused only on what the UI-SPEC left open.

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Dev↔prod API wiring | fetch/EventSource base URL resolution; backend has no CORS; output:'export' disables Next rewrites at runtime | ✓ |
| Shared state architecture | How prices/portfolio/watchlist/refresh fns reach 16 components — Context vs prop-drilling | ✓ |
| Scaffolding & build | create-next-app vs hand-rolled; export target path; version pinning | |
| Phase 3 test/verify scope | Whether to add frontend tests now (Phase 4 owns E2E); how to verify UI without Docker | |

**User's choice:** Dev↔Prod API wiring, Shared state architecture

---

## Dev↔Prod API Wiring

### Q1 — API base URL resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Relative paths + env override | Default relative `/api/...`; `NEXT_PUBLIC_API_BASE_URL` empty in prod, localhost:8000 in dev; one helper module | ✓ |
| Always absolute from env | Require the env var even in prod | |
| Hardcode relative only | `/api/...` everywhere, no env var | |

**User's choice:** Relative paths + env override
**Notes:** Matches static-export reality (prod is same-origin; no runtime Node server). → D-01

### Q2 — Dev cross-origin access (backend has no CORS)

| Option | Description | Selected |
|--------|-------------|----------|
| Add CORS to backend (dev-gated) | `CORSMiddleware` in `create_app()`, origins from env, inert in prod | ✓ |
| Next dev rewrites proxy | Proxy /api → :8000 in dev only; SSE buffering risk | |
| You decide | Defer to planning | |

**User's choice:** Add CORS to backend (dev-gated)
**Notes:** Lower risk than proxying SSE through next dev; rewrites can't help prod under output:'export' anyway. Touches Phase 1 `main.py`. → D-02

### Q3 — First-load state

| Option | Description | Selected |
|--------|-------------|----------|
| Skeleton + connecting dot | Panel frames with skeletons; dot yellow→green on SSE open | ✓ |
| Plain empty states | Show locked empty-state copy until data arrives | |
| Full-screen loader | Centered spinner until first fetch resolves | |

**User's choice:** Skeleton + connecting dot
**Notes:** Avoids misleading "empty" copy during load; keeps terminal aesthetic visible. Reuses EmptyState/ConnectionDot. → D-03

---

## Shared State Architecture

### Q1 — State distribution topology

| Option | Description | Selected |
|--------|-------------|----------|
| React Context provider(s) | Providers at AppShell expose data + refresh fns via hooks | ✓ |
| Prop-drilling from AppShell | AppShell owns all state, passes props down the tree | |
| You decide | Defer granularity to planning | |

**User's choice:** React Context provider(s)
**Notes:** SSE prices needed by Header + watchlist + positions table simultaneously; prop-drilling across 16 components is brittle. Stays within useState/no-Redux mandate. → D-04

### Q2 — Context granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Split by update frequency | PriceContext (500ms churn) vs PortfolioContext (mutation/10s poll) | ✓ |
| Single app context | One provider holds everything | |
| You decide | Defer to planning | |

**User's choice:** Split by update frequency
**Notes:** Prevents price ticks from re-rendering static portfolio columns; supports rAF-debounced 60fps with 10 tickers. → D-05

### Q3 — Live total-value derivation (spans both contexts)

| Option | Description | Selected |
|--------|-------------|----------|
| Derive in Header (consumer) | Header subscribes to both, computes total in useMemo | ✓ |
| Selector hook | `useTotalValue()` reads both contexts | |
| Store total in context | Recompute total_value in PortfolioContext on every tick | |

**User's choice:** Derive in Header (consumer)
**Notes:** Keeps contexts pure; avoids coupling high-churn prices into portfolio context. Selector hook is acceptable equivalent if reuse emerges. → D-06

---

## Claude's Discretion

- Exact context module structure, provider nesting, hook naming (`usePrices()`, `usePortfolio()`).
- `CORS_ORIGINS` env-var name/format; location of the URL-builder helper in `frontend/src/`.

## Deferred Ideas

- **Scaffolding & build approach** — standard setup task for the planner, informed by the UI-SPEC's locked stack. Not a user-input gray area.
- **Phase 3 frontend component tests** — Phase 4 owns Playwright E2E + backend unit tests; Phase 3 stays implementation-focused. UI verified via `next dev` against local backend (enabled by D-02 CORS).
