---
phase: 03-frontend
plan: 01
subsystem: frontend-scaffold
tags: [nextjs, typescript, tailwind, cors, frontend-foundation]
dependency_graph:
  requires: []
  provides: [UI-11, UI-12-foundation, D-01, D-02]
  affects: [03-02, 03-03]
tech-stack:
  added:
    - next@14.2.32 (static export, App Router)
    - react@18.3.1 + react-dom@18.3.1
    - recharts@3.0.2 (sparkline/AreaChart/Treemap/LineChart)
    - lucide-react@1.21.0 (icons)
    - tailwindcss@3.4.17 (NOT 4.x — theme.extend.colors compat)
    - typescript@5.5.4 (strict mode)
    - postcss@8.4.49, autoprefixer@10.4.20
    - eslint@8.57.0, eslint-config-next@14.2.32
  patterns:
    - D-01 apiUrl() single URL chokepoint reading NEXT_PUBLIC_API_BASE_URL
    - D-02 dev-gated CORSMiddleware (default off, explicit allow_origins list, never '*')
    - Tailwind locked palette in theme.extend.colors (UI-11)
    - TS strict mode + '@/*' path alias to src/*
    - output:'export' + images.unoptimized:true (Phase 4 Dockerfile target)
key-files:
  created:
    - frontend/package.json
    - frontend/package-lock.json
    - frontend/next.config.js
    - frontend/tsconfig.json
    - frontend/tailwind.config.ts
    - frontend/postcss.config.js
    - frontend/.eslintrc.json
    - frontend/.gitignore
    - frontend/.env.example
    - frontend/public/favicon.ico
    - frontend/src/app/layout.tsx
    - frontend/src/app/page.tsx
    - frontend/src/app/globals.css
    - frontend/src/lib/api.ts
    - frontend/src/lib/types.ts
    - frontend/src/lib/format.ts
    - backend/.env.example
  modified:
    - backend/app/main.py (D-02 CORS middleware added inside create_app())
    - .gitignore (anchored /lib/ and /lib64/ to project root)
decisions:
  - next@14.2.32 chosen per UI-SPEC pinning (latest 14.2.x; Next 16 deprecated several export-related configs)
  - react@18.3.1 chosen over React 19 per RESEARCH A2 — Next 14 + React 18 is the most-tested combo for output:'export'
  - tailwindcss@3.4.17 pinned to 3.x (NOT 4.x) per UI-SPEC/Pitfall 4 — v4 CSS-first config breaks theme.extend.colors
  - lucide-react pinned to 1.21.0 (1.x line per UI-SPEC; the originally written 1.0.4 does not exist on npm — auto-fixed)
  - recharts@3.0.2 chosen (3.x peer dep supports React 18; the locked UI-SPEC charting library covers all four chart types)
  - apiUrl() is the single URL chokepoint — no string concatenation of user input into URLs anywhere else
  - CORSMiddleware uses a parsed comma-list of origins, never '*'; only added when CORS_ORIGINS is non-empty
metrics:
  duration: ~12 minutes
  completed_date: 2026-06-27
  tasks: 3
  files_created: 16
  files_modified: 2
  commits: 3
  tests_passing: 173
status: complete
---

# Phase 3 Plan 1: Frontend Scaffold + Backend CORS — Summary

One-liner: Greenfield Next.js 14 static-export scaffold with locked dark palette, single apiUrl() chokepoint, backend-mirroring TS types, shared formatters, and dev-gated CORS middleware that keeps the existing 173-test suite green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold frontend project with locked stack + config files | `901e662` | 13 frontend config/source files + favicon + lockfile |
| 2 | Create lib helpers — apiUrl (D-01), types, formatters | `9d9a588` | frontend/src/lib/{api,types,format}.ts (+ .gitignore anchor fix) |
| 3 | Add D-02 dev-gated CORS middleware + backend .env.example | `a458a41` | backend/app/main.py, backend/.env.example |

## Verification Results

| Check | Result |
|-------|--------|
| `cd frontend && npm run build` | exit 0, `frontend/out/` generated |
| `cd frontend && npx tsc --noEmit` | exit 0 (strict mode) |
| `cd backend && uv run --extra dev pytest` | 173 passed (full suite stays green) |
| `frontend/package.json` pins next 14.2.32 + tailwindcss 3.4.17 | confirmed |
| `frontend/next.config.js` sets `output: 'export'` and `images.unoptimized: true` | confirmed |
| `frontend/tailwind.config.ts` palette tokens (`#0d1117`, `#ecad0a`, `#22c55e`, `#ef4444`) | confirmed |
| `frontend/src/app/layout.tsx` renders `<html className="dark">` with metadata title "FinAlly" | confirmed |
| `apiUrl()` reads `NEXT_PUBLIC_API_BASE_URL` | confirmed |
| `backend/app/main.py` reads `CORS_ORIGINS`, never passes `"*"` | confirmed |
| `backend/.env.example` documents `CORS_ORIGINS` (default empty; `http://localhost:3000` for dev) | confirmed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Anchored `lib/` and `lib64/` patterns in root `.gitignore`**
- **Found during:** Task 2 — `git add frontend/src/lib/api.ts` failed with "The following paths are ignored by one of your .gitignore files: frontend/src/lib"
- **Issue:** The root `.gitignore` had bare `lib/` and `lib64/` patterns (Python distribution defaults), which matched the new `frontend/src/lib/` directory by basename. This would have silently kept all frontend lib helpers out of git.
- **Fix:** Changed `lib/` → `/lib/` and `lib64/` → `/lib64/` in `.gitignore` so the rules only match project-root Python packaging directories. Frontend's own `frontend/.gitignore` handles its node_modules / `.next` / `out` patterns.
- **Files modified:** `.gitignore`
- **Commit:** `9d9a588` (bundled with task 2 commit)

**2. [Rule 3 - Blocking] `lucide-react@1.0.4` does not exist on npm**
- **Found during:** Task 1 — `npm install` failed with `ETARGET No matching version found for lucide-react@1.0.4`
- **Issue:** I initially wrote `lucide-react@1.0.4` based on a typo/version confusion. The 1.x line starts at 1.2.0; the actual verified version per RESEARCH is 1.21.0.
- **Fix:** Updated `frontend/package.json` to pin `lucide-react@1.21.0` (matches the RESEARCH package audit table exactly).
- **Files modified:** `frontend/package.json`
- **Commit:** `901e662` (bundled with task 1 commit)

## Auth Gates

None.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `frontend/src/app/page.tsx` renders only a placeholder line | `frontend/src/app/page.tsx` | Plan 03-02 wires AppShell into the page; the scaffold plan intentionally leaves the body minimal. |

This is the expected scaffold placeholder, not an unintentional stub. Plan 03-02 replaces it.

## Threat Flags

None — no new endpoints, no new auth paths, no new file access. The threat surface from this plan is exactly what the plan's `<threat_model>` covers: apiUrl() URL construction (T-03-03), CORS allow_origins (T-03-02), and NEXT_PUBLIC_* secrets (T-03-01). All three mitigations are in place:

- `NEXT_PUBLIC_*` vars: only `NEXT_PUBLIC_API_BASE_URL` (non-sensitive URL) is public; `OPENROUTER_API_KEY` / `MASSIVE_API_KEY` remain backend-only.
- CORS: `allow_origins` is always an explicit parsed list from `CORS_ORIGINS`; wildcard + credentials combination is structurally impossible.
- apiUrl(): single chokepoint; no user input concatenation.

## Output

- `frontend/` static-export project compiles to `out/` (Phase 4 Dockerfile copies this into `backend/static/`).
- `backend/app/main.py:create_app()` adds CORS only when `CORS_ORIGINS` is set; default-empty keeps prod same-origin and the test suite green.
- Every downstream phase-3 plan (03-02, 03-03, ...) consumes the `apiUrl()` helper, the TS types, the formatters, and the Tailwind palette as their foundation.

## Self-Check

```
[pass] frontend/out/ exists
[pass] frontend/out/index.html exists
[pass] commit 901e662 present (task 1)
[pass] commit 9d9a588 present (task 2)
[pass] commit a458a41 present (task 3)
[pass] frontend/src/lib/{api,types,format}.ts exist
[pass] backend/.env.example exists with CORS_ORIGINS
[pass] backend/app/main.py reads CORS_ORIGINS, no '*' literal in allow_origins
```

Self-Check: PASSED