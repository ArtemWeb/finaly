---
phase: 3
slug: frontend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Phase 3 is intentionally test-framework-free.** Per `03-CONTEXT.md` "Deferred Ideas" and the ROADMAP, Phase 4 owns Playwright E2E + frontend component tests. Phase 3 validation is **manual smoke testing against `next dev` + the running backend**, plus a hard `npm run build` exit-0 gate (proves `output: 'export'` produces `out/`). Automated frontend verification is a Phase 4 deliverable, not a Phase 3 gap.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None introduced this phase (Playwright E2E deferred to Phase 4) |
| **Config file** | none — Phase 3 adds no test runner |
| **Quick run command** | `cd frontend && npm run build` (TypeScript strict compile + static export; exit 0 = green) |
| **Full suite command** | `cd frontend && npm run build` + manual smoke checklist (below) against `npm run dev` + backend on `:8000` |
| **Estimated runtime** | ~30–60 seconds for `npm run build`; ~5 min manual smoke |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npx tsc --noEmit` (fast type check — proves the component compiles under strict mode) and manually smoke the affected panel in `next dev`.
- **After every plan wave:** Run `cd frontend && npm run build` (must exit 0 — the static-export gate) + smoke the wave's panels.
- **Before `/gsd-verify-work`:** `npm run build` exits 0 AND all manual smoke checks below pass.
- **Max feedback latency:** ~60 seconds (build) — type errors surface within the `tsc` run.

---

## Per-Task Verification Map

> Phase 3 has no automated test commands. The "Automated Command" column is the **build/type-check** that proves the task's code compiles and exports; behavioral proof is the manual smoke check. This map is the planner's reference — exact task IDs are assigned by the planner in PLAN.md frontmatter.

| Task Group | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Manual Smoke |
|------------|------|------|-------------|------------|-----------------|-----------|-------------------|--------------|
| Scaffold + config + Tailwind palette | 01 | 1 | UI-11 | — | No secrets in `NEXT_PUBLIC_*` | build | `npm run build` exits 0; `out/` generated | Page renders dark `#0d1117`; build emits `out/` |
| URL helper + types + format lib | 01 | 1 | UI-01..UI-12 | T-9 (V9) | `apiUrl()` is the only URL builder; no user input concatenated into URLs | type | `npx tsc --noEmit` exit 0 | n/a (pure lib) |
| Backend CORS middleware (D-02) | 01 | 1 | UI-12 | T-9 (V9) | `allow_origins` from `CORS_ORIGINS` env, never `*` | unit | `cd backend && uv run --extra dev pytest` stays green | `next dev` (:3000) reaches `:8000` without CORS error |
| `useSse` hook + PriceContext | 02 | 2 | UI-01, UI-02, UI-12 | — | Native EventSource, relative URL | type | `npx tsc --noEmit` exit 0 | Dot turns green; prices tick ~500ms |
| WatchlistPanel/Row + flash + sparkline | 02 | 2 | UI-01, UI-02, UI-10 | T-5 (V5) | Add-ticker validated alphanumeric (UX layer) | build | `npm run build` exit 0 | Row flashes green/red 500ms; sparkline accumulates; add/remove works |
| PortfolioContext + PositionsTable + heatmap + P&L | 02/03 | 2/3 | UI-04, UI-05, UI-06 | T-7 (V7) | P&L cells colored + signed text (color never sole signal) | build | `npm run build` exit 0 | Table columns correct; treemap sized by weight; P&L line renders |
| MainChart (click-to-select) | 03 | 3 | UI-03 | — | `'use client'` + mounted flag (no `window` SSR throw) | build | `npm run build` exit 0 | Click ticker → AreaChart renders for that ticker |
| TradeBar (optimistic) | 03 | 3 | UI-07 | T-5/T-7 | Backend re-validates; error `detail` mapped to UI copy, never rendered raw | build | `npm run build` exit 0 | Buy/Sell → toast + positions/cash update, no reload |
| ChatPanel + ChatMessage | 03 | 3 | UI-08 | T-7 (V7) | No `dangerouslySetInnerHTML`; disabled state when key unset | build | `npm run build` exit 0 | Mock chat (`LLM_MOCK=true`) returns message + inline chip |
| Header + ConnectionDot (live total) | 03 | 3 | UI-09 | — | Derived total via `useMemo` (D-06) | build | `npm run build` exit 0 | Header "Total Value" ticks live; dot reflects readyState |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] No test framework install needed — Phase 3 adds no runner (Phase 4 owns Playwright).
- [ ] No fixture data needed — the backend already seeds `db/finally.db` ($10k cash, default watchlist).
- [ ] The manual smoke checklist (below) IS the Wave 0 deliverable — it must be written into the final plan's verification section.

*Existing backend infrastructure (FastAPI on `:8000`, seeded SQLite) covers all data needs for manual validation.*

---

## Manual-Only Verifications

> Every Phase 3 behavior is verified manually against `cd frontend && npm run dev` with the backend running on `:8000` (`CORS_ORIGINS=http://localhost:3000` set). This is by design — automated coverage arrives in Phase 4.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE live prices update | UI-12, UI-01 | No test framework this phase | `npm run dev`, open `:3000`; prices change ~500ms; ConnectionDot green |
| Watchlist flash | UI-01 | Visual/timing behavior | Watch a default ticker; row bg flashes green/red ~500ms per tick, fades via `transition-colors duration-500` |
| Sparkline accumulates | UI-02 | Visual, session-scoped buffer | Watch a row ~30s; sparkline grows; stroke color follows `direction` |
| Click ticker → main chart | UI-03 | Visual interaction | Click a watchlist row; MainChart `<AreaChart>` shows that ticker |
| Portfolio heatmap + table | UI-04, UI-06 | Visual | Buy a position; treemap cell sized by `market_value`, colored by `unrealized_pnl`; table shows ticker/qty/avg cost/price/P&L/%change |
| P&L chart over time | UI-05 | Visual | After a trade, PnLChart line reflects new `/api/portfolio/history` snapshot |
| Trade bar instant fill | UI-07 | No-reload behavior | "AAPL", qty 1, Buy → toast "Bought 1 AAPL @ $X"; cash + positions update <~200ms, no page reload |
| Trade error copy | UI-07 | Error-mapping | Buy with insufficient cash → toast "Insufficient cash for this order." (mapped, not raw `detail`) |
| Chat with mock LLM | UI-08 | No test framework | Backend `LLM_MOCK=true`, send "Buy 1 AAPL" → assistant bubble + inline chip `✓ Bought 1 AAPL @ $X` |
| Chat disabled state | UI-08 | Env-gated | No `OPENROUTER_API_KEY` and `LLM_MOCK` off → "AI Assistant unavailable" empty state, send blocked |
| Header total updates live | UI-09 | Derived live value | Watch "Total Value" while prices tick; updates each tick (cash + Σ qty×price) |
| Add/remove ticker | UI-10 | Optimistic UI | Add "PYPL" → row appears + streams; remove (×) → row gone optimistically, reverts on failure |
| Dark terminal aesthetic | UI-11 | Visual consistency | All panels `bg-surface-panel`; accents yellow/blue/purple per reservation; matches UI-SPEC |
| Static export builds | UI-01..UI-12 | Build-time gate | `npm run build` exits 0; `out/` directory generated (proves `output: 'export'`) |

---

## Validation Sign-Off

- [ ] Every task has either an `<automated>` build/type-check verify OR an explicit manual-smoke entry above (no task is unverifiable)
- [ ] Sampling continuity: `npm run build` runs at every wave boundary; `npx tsc --noEmit` at every task commit — no 3 consecutive tasks without a compile-level check
- [ ] Wave 0 covers all data needs (backend seed) — confirmed, no install required
- [ ] No watch-mode flags in any verify command (`tsc --noEmit`, `npm run build` are one-shot)
- [ ] Feedback latency < 60s (build/type-check)
- [ ] Manual smoke checklist is embedded in the final plan's `<verification>` so the executor and `/gsd-verify-work` run it
- [ ] `nyquist_compliant: true` set in frontmatter once the planner confirms every task maps to a row above

**Approval:** pending
