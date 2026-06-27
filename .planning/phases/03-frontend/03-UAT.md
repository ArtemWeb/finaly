---
status: testing
phase: 03-frontend
source: [03-VERIFICATION.md, 03-VALIDATION.md]
started: 2026-06-27T00:00:00Z
updated: 2026-06-27T00:00:00Z
---

## Current Test

number: 1
name: SSE live prices update + connection dot
expected: |
  With `npm run dev` (:3000) and backend on :8000 (CORS_ORIGINS=http://localhost:3000),
  opening the terminal shows watchlist prices changing ~every 500ms and the
  ConnectionDot turning blue (open) after an initial yellow (connecting).
awaiting: user response

## Tests

### 1. SSE live prices update + connection dot (UI-12, UI-01)
expected: Open :3000 (or :8000). Prices change ~500ms; ConnectionDot goes yellow→blue (open). On backend kill it goes red (error).
result: pending

### 2. Watchlist flash on tick (UI-01)
expected: A default ticker's row background flashes green on uptick / red on downtick, fading over ~500ms (`transition-colors duration-500`).
result: pending

### 3. Sparkline accumulates (UI-02)
expected: Watch a row ~30s — the per-ticker sparkline mini-chart grows from the SSE stream; stroke color follows price direction.
result: pending

### 4. Click ticker → main chart (UI-03)
expected: Click a watchlist row → MainChart renders an AreaChart for that ticker in the center column.
result: pending

### 5. Portfolio heatmap + positions table (UI-04, UI-06)
expected: Buy a position → treemap cell sized by market_value, colored by unrealized_pnl (green profit / red loss); table shows ticker, qty, avg cost, current price, unrealized P&L, % change (signed text + color, not color alone).
result: pending

### 6. P&L chart over time (UI-05)
expected: After a trade, PnLChart line reflects the new `/api/portfolio/history` snapshot; Y-axis uses compact $Xk/$XM formatting.
result: pending

### 7. Trade bar instant fill — no reload (UI-07)
expected: Enter "AAPL", qty 1, Buy → success toast "Bought 1 AAPL @ $X"; cash + positions + heatmap update within ~200ms with NO page reload (optimistic).
result: pending

### 8. Trade error copy mapped, not raw (UI-07)
expected: Buy with insufficient cash → toast reads "Insufficient cash for this order." (mapped UI copy, NOT the raw backend `detail` string).
result: pending

### 9. Chat with mock LLM + inline chip (UI-08)
expected: Backend `LLM_MOCK=true`, send "Buy 1 AAPL" → "Thinking…" then assistant bubble + inline confirmation chip "✓ Bought 1 AAPL @ $X"; positions update.
result: pending

### 10. Chat disabled state (UI-08) — KNOWN DEFECT (CR-01)
expected (per UI-SPEC): With no `OPENROUTER_API_KEY` and `LLM_MOCK` off, the panel should show "AI Assistant unavailable" / "Set OPENROUTER_API_KEY to enable chat." with send blocked.
note: 03-REVIEW CR-01 found the mount `__probe__` POST goes through the real LLM pipeline and the backend swallows errors as HTTP 200, so this disabled state is currently UNREACHABLE — the panel appears enabled and the first real message returns an error reply. Verify actual behavior and record whether this is acceptable for the demo or needs a gap-closure fix.
result: pending

### 11. Header total updates live (UI-09)
expected: Watch the Header "Total Value" while prices tick — it updates each tick (cash + Σ qty×price), derived live via useMemo (D-06). Cash balance and connection dot also shown.
result: pending

### 12. Add / remove ticker — optimistic (UI-10)
expected: Add "PYPL" → row appears immediately and starts streaming; remove (×) → row disappears optimistically and reverts on backend failure.
result: pending

### 13. Dark terminal aesthetic (UI-11)
expected: All panels use the dark surface (`#0d1117` / `#1a1a2e`); accents yellow `#ecad0a`, blue `#209dd7`, purple `#753991` buttons, green `#22c55e` / red `#ef4444` for P&L — consistent across every panel per UI-SPEC.
result: pending

### 14. Static export builds (UI-01..UI-12)
expected: `cd frontend && npm run build` exits 0 and generates `frontend/out/` (proves `output: 'export'`). [Already confirmed green by orchestrator post-merge gate.]
result: pending

## Summary

total: 14
passed: 0
issues: 0
pending: 14
skipped: 0
blocked: 0

## Gaps
