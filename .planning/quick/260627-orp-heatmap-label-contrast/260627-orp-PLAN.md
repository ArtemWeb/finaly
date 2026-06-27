---
quick_id: 260627-orp
slug: heatmap-label-contrast
description: "Fix Allocation heatmap label contrast — change ticker + pct text fill from #0d1117 to white for readability on red/green cells"
created: 2026-06-27
status: ready
plan_count: 1
must_haves:
  truths:
    - "Both in-cell <text> labels (ticker and pct) in TreemapContent use a white fill so they are legible on the green (#22c55e) and red (#ef4444) cell backgrounds."
    - "The <rect> separator stroke (#0d1117) is unchanged — it is not text."
    - "The fill color logic (pnl >= 0 ? green : red) and the pct label value are unchanged."
    - "tsc --noEmit and npm run build both exit 0."
  artifacts:
    - "frontend/src/components/portfolio/PortfolioHeatmap.tsx"
  key_links:
    - "frontend/src/components/portfolio/PortfolioHeatmap.tsx:74 (ticker text fill)"
    - "frontend/src/components/portfolio/PortfolioHeatmap.tsx:86 (pct text fill)"
---

# Quick Task 260627-orp: Fix Allocation heatmap label contrast

## Objective

In `PortfolioHeatmap.tsx`, the two in-cell `<text>` labels (ticker on line 74,
pct on line 86) use `fill="#0d1117"` — near-black. The cells are filled solid
green (`#22c55e`) or red (`#ef4444`), so near-black text is low-contrast and hard
to read. Change both text fills to white (`#ffffff`), which reads cleanly on both
the green and red backgrounds.

## Context (verified in source)

- Line 67 `<rect ... stroke="#0d1117">` is the cell SEPARATOR stroke, NOT text —
  it must stay `#0d1117` (the dark separator against the panel is intentional).
- Only the two `<text fill="#0d1117">` occurrences (lines 74 and 86) change to white.
- No change to fill-color logic, label values, sizing, or font.

## Tasks

### Task 1 — White text fill on heatmap cell labels

**files:** `frontend/src/components/portfolio/PortfolioHeatmap.tsx`

**action:** Change the `fill` attribute on both in-cell `<text>` elements (the
ticker label, line ~74, and the pct label, line ~86) from `"#0d1117"` to
`"#ffffff"`. Leave the `<rect>` `stroke="#0d1117"` (line ~67) untouched.

**verify:**
- `cd frontend && npx tsc --noEmit` exits 0
- `cd frontend && npm run build` exits 0
- Confirm exactly two `<text>` fills changed to white and the `<rect>` stroke is still `#0d1117`.

**done:** Both cell text labels render white; separator stroke unchanged; gates pass.

## Out of scope

- No change to the rect stroke, fill color logic, label content, tooltip, or any other component.
