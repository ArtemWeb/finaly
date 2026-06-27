---
quick_id: 260627-nfc
slug: heatmap-pct-label
description: "Fix Allocation heatmap label — render change_percent with the % sign instead of unrealized_pnl dollars"
created: 2026-06-27
status: ready
plan_count: 1
must_haves:
  truths:
    - "The in-cell label in PortfolioHeatmap shows the position's percent change (change_percent) suffixed with %, not the dollar P&L (unrealized_pnl)."
    - "Cell fill color remains driven by P&L sign (green when unrealized_pnl >= 0, red when < 0) per UI-SPEC — unchanged."
    - "tsc --noEmit and npm run build both exit 0."
  artifacts:
    - "frontend/src/components/portfolio/PortfolioHeatmap.tsx"
  key_links:
    - "frontend/src/components/portfolio/PortfolioHeatmap.tsx:81-92 (TreemapContent label render)"
---

# Quick Task 260627-nfc: Fix Allocation heatmap label

## Objective

The `Allocation` heatmap (`PortfolioHeatmap.tsx`) renders an in-cell label that
suffixes a value with `%`, but the value passed is `unrealized_pnl` (a **dollar**
amount), not a percentage. A position up +$150.00 currently displays as
`+150.0%`, which is wrong and misleading. The data node already carries the
correct field — `pct` (sourced from `Position.change_percent`) — so the fix is to
render `pct` in the percent label while keeping the dollar `pnl` purely for the
green/red fill decision (which is correct per UI-SPEC and must not change).

## Context (verified in source before planning)

- `HeatNode` already has both `pnl` (`unrealized_pnl`) and `pct` (`change_percent`)
  populated in the `useMemo` mapper (lines 104-116). No data-layer change needed.
- `TreemapContentProps` (lines 41-48) currently passes only `ticker` and `pnl`
  into the custom cell renderer. To render the percent, the renderer needs `pct`.
  Recharts passes every key of the data node as a prop to the `content` element,
  so adding `pct?: number` to `TreemapContentProps` and reading it is sufficient —
  no change to how `<Treemap content={...}>` is wired.
- The fill (`pnl >= 0 ? green : red`, line 55) must stay keyed on `pnl`. Only the
  text label (lines 89-91) changes from `pnl` to `pct`.
- The sign prefix should follow the percent value being shown (`pct >= 0 ? '+' : '-'`).

## Tasks

### Task 1 — Render change_percent in the heatmap cell label

**files:** `frontend/src/components/portfolio/PortfolioHeatmap.tsx`

**action:**
1. Add `pct?: number;` to the `TreemapContentProps` interface (alongside the
   existing `pnl?: number;`).
2. In `TreemapContent`, destructure `pct = 0` from props (keep `pnl = 0` — still
   used for the fill color on line 55, which must NOT change).
3. In the `showPnl` text block (lines 89-91), change the rendered value from the
   dollar `pnl` to the percentage `pct`: sign prefix from `pct` (`pct >= 0 ? '+' : '-'`)
   and magnitude `Math.abs(pct).toFixed(1)` followed by the literal `%`.
   Prefer reusing the project formatter `formatPercent` from `@/lib/format` if its
   output (already imported in this file) matches the compact in-cell style
   (no leading `+` duplication, fits the 10px monospace cell). If `formatPercent`
   would not fit the tiny cell or double a sign, keep the inline
   `{pct >= 0 ? '+' : '-'}{Math.abs(pct).toFixed(1)}%` form — either is acceptable
   as long as the value shown is the percent, not the dollars.

**verify:**
- `cd frontend && npx tsc --noEmit` exits 0
- `cd frontend && npm run build` exits 0 (static export still generates `out/`)
- Grep the file to confirm the `%`-suffixed label now reads from `pct` and that
  the fill on line ~55 still reads from `pnl`.

**done:** The heatmap cell percent label is sourced from `change_percent`; the
green/red fill is still sourced from `unrealized_pnl`; both type-check and build
gates pass.

## Out of scope

- No change to the tooltip (it already correctly shows `formatCurrency(value)` +
  `formatPercent(node.pct)`).
- No change to the `useMemo` data mapper, the `dataKey="size"` sizing, or the
  EmptyState/mounted-guard logic.
- No change to PositionsTable or any other component.
