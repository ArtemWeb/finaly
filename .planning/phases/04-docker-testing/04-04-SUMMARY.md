---
phase: 04-docker-testing
plan: 04-04
subsystem: frontend-testid-hooks
tags: [playwright, e2e, data-testid, refactor]
requires: []
provides:
  - "Stable data-testid hooks on 7 frontend components"
  - "Copy-proof selectors for TEST-05..08 wave-3 E2E specs"
affects: ["frontend-test-selection"]
tech-stack:
  added: []
  patterns: ["data-testid attribute hooks", "wrapper-span for non-forwarding child components"]
key-files:
  created: []
  modified:
    - frontend/src/components/layout/Header.tsx
    - frontend/src/components/layout/ConnectionDot.tsx
    - frontend/src/components/watchlist/WatchlistRow.tsx
    - frontend/src/components/trade/TradeBar.tsx
    - frontend/src/components/portfolio/PositionsTable.tsx
    - frontend/src/components/chat/ChatPanel.tsx
    - frontend/src/components/chat/ChatMessage.tsx
decisions:
  - "PriceFlash component does not forward data-testid through its props API; added a wrapper <span data-testid='price'> around the PriceFlash element instead of expanding PriceFlash's API (Rule 2 avoidance: minimal-surface additive edit)"
  - "Placed data-testid='chat-message' on the OUTER flex wrapper in both user and assistant branches so getByTestId('chat-message').last() resolves to the most recent message regardless of role"
  - "Placed data-testid='trade-chip' on the executed-trade div only (not the failed-trade div) since TEST-08 asserts an executed 'Bought ...' chip"
metrics:
  duration: "37m"
  task-count: 3
  file-count: 7
  completed-date: 2026-06-27
status: complete
---

# Phase 4 Plan 4: Frontend data-testid hooks for Playwright E2E specs

## One-liner

Added 14 stable data-testid hooks across 7 frontend components (Header, ConnectionDot, WatchlistRow, TradeBar, PositionsTable, ChatPanel, ChatMessage) so the wave-3 Playwright specs have copy-proof selectors; all edits are pure attribute additions and `npm run build` still succeeds.

## Commits

| Task | Files | Commit | Message |
|------|-------|--------|---------|
| 1 | Header.tsx, ConnectionDot.tsx, WatchlistRow.tsx | `8ad1797` | test(04-04): add data-testid hooks to Header, ConnectionDot, WatchlistRow |
| 2 | TradeBar.tsx, PositionsTable.tsx | `31825d5` | test(04-04): add data-testid hooks to TradeBar and PositionsTable |
| 3 | ChatPanel.tsx, ChatMessage.tsx | `5e3d1b5` | test(04-04): add data-testid hooks to ChatPanel and ChatMessage |

## Testids delivered

| Testid | File | Element |
|--------|------|---------|
| `header-total` | Header.tsx | Total Value span (rendering formatCurrency(total)) |
| `header-cash` | Header.tsx | Cash span (rendering portfolio.cash_balance) |
| `connection-dot` | ConnectionDot.tsx | Status span (role="status" + aria-label intact) |
| `watchlist-row` | WatchlistRow.tsx | Root row div (role="button") |
| `price` | WatchlistRow.tsx | Wrapper span around PriceFlash (PriceFlash does not forward attrs) |
| `trade-ticker-input` | TradeBar.tsx | Ticker text input |
| `trade-qty-input` | TradeBar.tsx | Quantity number input |
| `trade-buy-button` | TradeBar.tsx | Buy submit button |
| `trade-sell-button` | TradeBar.tsx | Sell button |
| `position-row-${position.ticker}` | PositionsTable.tsx | Row tr (dynamic per ticker, e.g. `position-row-AAPL`) |
| `chat-input` | ChatPanel.tsx | Chat text input |
| `chat-send` | ChatPanel.tsx | Send submit button |
| `chat-message` | ChatMessage.tsx | Outer wrapper in BOTH user + assistant branches |
| `trade-chip` | ChatMessage.tsx | Executed-trade TradeChip outer div |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PriceFlash does not forward data-testid**
- **Found during:** Task 1
- **Issue:** Plan called for adding `data-testid="price"` directly to the `PriceFlash` element, but `PriceFlash`'s `PriceFlashProps` interface does not accept an arbitrary `data-testid` (or any non-`children`-style spread). Passing the prop would have been a TypeScript error and forced either a prop-API expansion or a cast.
- **Fix:** Wrapped the PriceFlash in a sibling `<span data-testid="price">` so the testid sits on the parent that renders the price text, leaving PriceFlash's API and behavior untouched. No copy/className/handler change. The wrapper span has no styling, so the DOM layout is unchanged.
- **Files modified:** frontend/src/components/watchlist/WatchlistRow.tsx
- **Commit:** `8ad1797`

### Notes (not deviations)

- npm install was required inside the worktree (node_modules was not present) to run `npm run build`. This is environment-setup, not a plan deviation.
- A pre-existing ESLint warning in `frontend/src/components/portfolio/PortfolioHeatmap.tsx` (useMemo deps on `positions`) is unrelated to this plan's edits and was left untouched per scope-boundary rule.

## Verification

- **Static grep (Task 1):** all 5 testids (`header-total`, `header-cash`, `connection-dot`, `watchlist-row`, `price`) present in target files
- **Static grep (Task 2):** all 5 testids (`trade-ticker-input`, `trade-qty-input`, `trade-buy-button`, `trade-sell-button`, `position-row-${position.ticker}` template) present in target files
- **Static grep (Task 3):** all 4 testids (`chat-input`, `chat-send`, `chat-message`, `trade-chip`) present in target files
- **Build:** `npm run build` (frontend/) → `Compiled successfully`, all 4 static pages generated. Exit code 0.
- **Behavior preservation:** ConnectionDot.tsx still emits `role="status"` + `aria-label={label}` + `title={label}`; TradeBar still uppercase-onChages; ChatPanel submit handler unchanged; TradeChip copy `Bought {qty} {ticker} @ ${price}` unchanged.
- **Diff size:** 7 files changed, 16 insertions(+), 6 deletions(-) across 3 commits (smallest possible additive diff: each testid = one insertion line).

## Threat Flags

None. `data-testid` attributes are inert DOM hooks used exclusively by Playwright selectors; they carry no auth, business, or sensitive data. The plan's `<threat_model>` already classifies T-04-08 (Tampering) and T-04-09 (Information Disclosure) as `accept` for these changes.

## Self-Check

```
[ -f "frontend/src/components/layout/Header.tsx" ]        && echo FOUND: Header.tsx
[ -f "frontend/src/components/layout/ConnectionDot.tsx" ] && echo FOUND: ConnectionDot.tsx
[ -f "frontend/src/components/watchlist/WatchlistRow.tsx" ] && echo FOUND: WatchlistRow.tsx
[ -f "frontend/src/components/trade/TradeBar.tsx" ]        && echo FOUND: TradeBar.tsx
[ -f "frontend/src/components/portfolio/PositionsTable.tsx" ] && echo FOUND: PositionsTable.tsx
[ -f "frontend/src/components/chat/ChatPanel.tsx" ]        && echo FOUND: ChatPanel.tsx
[ -f "frontend/src/components/chat/ChatMessage.tsx" ]     && echo FOUND: ChatMessage.tsx
git log --oneline | grep -q "8ad1797" && echo FOUND: 8ad1797
git log --oneline | grep -q "31825d5" && echo FOUND: 31825d5
git log --oneline | grep -q "5e3d1b5" && echo FOUND: 5e3d1b5
```

All files and commits present. PASSED.

## Known Stubs

None. All edits are pure attribute additions with no placeholder, mock, or empty data values introduced.
