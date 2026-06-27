---
quick_id: 260627-orp
slug: heatmap-label-contrast
description: "Fix Allocation heatmap label contrast — change ticker + pct text fill from #0d1117 to white"
status: complete
completed: 2026-06-27
commit: 3379b9d
---

# Quick Task 260627-orp — Summary

## What was done

The two in-cell `<text>` labels in `PortfolioHeatmap.tsx`'s `TreemapContent`
(the ticker and the pct value) used `fill="#0d1117"` — near-black — which was
low-contrast and hard to read against the solid green (`#22c55e`) and red
(`#ef4444`) cell backgrounds. Changed both text fills to white (`#ffffff`), which
reads cleanly on both colors.

## Change

`frontend/src/components/portfolio/PortfolioHeatmap.tsx` (commit `3379b9d`, +2/-2):

- Line 74 (ticker label): `fill="#0d1117"` → `fill="#ffffff"`
- Line 86 (pct label): `fill="#0d1117"` → `fill="#ffffff"`

The `<rect>` separator `stroke="#0d1117"` (lines 67, 144) was left untouched —
it is the intentional dark cell separator, not text.

## Verification

- `cd frontend && npx tsc --noEmit` → exit 0
- `cd frontend && npm run build` → exit 0, static export `out/` generated
- Confirmed via grep: exactly two `<text fill="#ffffff">`; `#0d1117` remains only
  on the two rect strokes and the docstring.

## Notes / deviations

- **Executed inline on the main tree** (no worktree-isolated subagent). The change
  is a fully-specified 2-line color swap; an isolated executor would have added a
  multi-minute `npm install` into a fresh worktree plus a worktree-merge step
  (which is what blocked the previous quick task 260627-nfc). Inline edit + the
  same tsc/build gates gives identical guarantees with no merge risk. PLAN.md,
  SUMMARY.md, STATE.md tracking, and the atomic code commit are all still produced.
