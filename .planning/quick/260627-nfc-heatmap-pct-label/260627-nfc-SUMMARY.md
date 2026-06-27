---
quick_id: 260627-nfc
slug: heatmap-pct-label
description: "Fix Allocation heatmap label — render change_percent with the % sign instead of unrealized_pnl dollars"
status: complete
completed: 2026-06-27
commit: 29fafeb
---

# Quick Task 260627-nfc — Summary

## What was done

Fixed a mislabeled value in the `Allocation` heatmap (`PortfolioHeatmap.tsx`).
The in-cell label suffixed a value with `%` but was rendering `unrealized_pnl`
(a dollar amount), so a position up +$150.00 displayed as `+150.0%`. The fix
renders the position's actual percent change (`change_percent`, already carried
on the data node as `pct`) in the percent label, while leaving the cell fill
color keyed on the dollar P&L sign — unchanged per UI-SPEC.

## Change

`frontend/src/components/portfolio/PortfolioHeatmap.tsx` (commit `29fafeb`, 1 file, +4/-3):

1. Added `pct?: number` to `TreemapContentProps`.
2. Destructured `pct = 0` in `TreemapContent` (kept `pnl = 0` — still used for fill).
3. Switched the `showPnl` text label from `pnl` to `pct`:
   `{pct >= 0 ? '+' : '-'}{Math.abs(pct).toFixed(1)}%`.

The fill on line 56 (`const fill = pnl >= 0 ? '#22c55e' : '#ef4444'`) is unchanged —
green/red still reflects profit/loss in dollars, which is the correct UI-SPEC contract.

## Verification

- `cd frontend && npx tsc --noEmit` → exit 0 (re-run on merged main tree)
- `cd frontend && npm run build` → exit 0, static export `out/` generated
- Confirmed in source: label reads `Math.abs(pct)` (line 91); fill reads `pnl` (line 56)

## Notes / deviations

- **Inline form over `formatPercent`:** the executor kept the inline
  `{pct >= 0 ? '+' : '-'}{Math.abs(pct).toFixed(1)}%` rather than reusing
  `formatPercent` (which emits two decimals and a duplicate sign), to fit the
  10px monospace cell. The plan explicitly permitted either form.
- **Worktree merge recovery:** the worktree's untracked SUMMARY.md initially
  blocked the bounded cleanup-wave merge. The fix commit (`29fafeb`) was a clean
  fast-forward off HEAD and was merged directly via `git merge --ff-only`; the
  temp branch was then deleted and the worktree pruned. The original
  worktree-local SUMMARY.md was not committed and was lost with the worktree —
  this file is an equivalent reconstruction from the executor's reported result
  and a re-inspection of the committed diff.
