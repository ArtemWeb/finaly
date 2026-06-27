---
phase: quick-260627-w8k
plan: 01
type: execute
subsystem: launch-scripts
tags: [windows, powershell, docker, dock-04, encoding, stderr, idempotent]
status: complete
dependency_graph:
  requires: []
  provides: [working-windows-launcher]
  affects: [scripts/start_windows.ps1]
tech-stack:
  added: []
  patterns:
    - "PowerShell 5.1 without a BOM decodes a UTF-8 file in the system ANSI codepage (cp1251 on this host) - any multi-byte char (em dash) corrupts the parse. Keep launch scripts pure ASCII."
    - "Under $ErrorActionPreference='Stop', a native command writing to stderr becomes a terminating error even with 2>$null. Existence checks must use `docker images -q` / `docker ps -aq --filter` (empty string, no stderr) instead of `inspect` (errors to stderr on miss)."
key-files:
  created: []
  modified:
    - scripts/start_windows.ps1
decisions:
  - "Bug 1 (encoding): replaced 3 em-dashes with ASCII hyphen so the script is pure ASCII - cannot be mis-decoded in any locale, BOM or not. Empirically proven: PSParser.Tokenize gives 0 errors as UTF-8 but 2 errors as cp1251 ('missing terminator at line 67'), matching the live failure exactly."
  - "Bug 2 (stderr trap): `docker image inspect`/`docker container inspect` on a missing target write to stderr; under Stop preference this throws despite 2>$null and breaks the first-run (create) path. Replaced both with filter forms (`docker images -q`, `docker ps -aq --filter name=^finally-app$`) that return an empty string on miss with no stderr. Empirically proven under $ErrorActionPreference='Stop': inspect THREW, the filter forms returned cleanly."
  - "Did NOT change any logic, port handling, volume, healthcheck poll, or browser launch - only the existence checks and the dash characters in comments/strings."
metrics:
  duration: "~15m (diagnose encoding + stderr, fix, full+idempotent run, persistence gate)"
  completed_date: 2026-06-27
  tasks_completed: 1
  tasks_total: 1
  code_files_changed: 1
---

# Quick 260627-w8k: Fix start_windows.ps1 (encoding + stderr trap)

## Outcome

**Status: COMPLETE.** `scripts/start_windows.ps1` now runs end-to-end on a live
Windows host (PowerShell 5.1). This unblocked the DOCK-04 manual gate, which had
never actually been executed before (prior Phase 4 verification only syntax-checked
the script, noting "PowerShell scripts cannot be executed on the Windows host
running this verifier").

## Two bugs, both real, both fixed

### Bug 1 - UTF-8 em-dash + no BOM = parse failure in cp1251 locale
The script contained 3 em-dash (`—`, bytes `E2 80 94`) characters in comments
(offsets 409, 1103, 1252) and was saved as UTF-8 **without a BOM**. PowerShell 5.1
without a BOM decodes using the system ANSI codepage - cp1251 on this host (the
repo path itself is Cyrillic, `Сourses`). The 3-byte em-dash decoded as garbage and
the parser failed with `missing terminator at line 67` / `missing closing } at
line 31`.

**Proof (not a guess):** `[PSParser]::Tokenize` returned **0 errors** when the file
was read as UTF-8, but **2 errors** when read as cp1251 - the first being exactly
`The string is missing the terminator: ". at line 67`, matching the live crash.

**Fix:** replaced all 3 em-dashes with ASCII hyphen. File is now pure ASCII
(verified: 0 bytes > 127), so it cannot be mis-decoded in any locale.

### Bug 2 - `docker ... inspect` on missing target trips $ErrorActionPreference='Stop'
After the encoding fix the script got further but died on line 30:
`docker container inspect finally-app 2>$null` threw
`NativeCommandError: No such container: finally-app`. Under the script's
`$ErrorActionPreference = 'Stop'` (line 6), a native command writing to stderr is
promoted to a terminating error **even with `2>$null`**. `inspect` always writes to
stderr when the target is absent - i.e. exactly the first-run path.

**Proof:** under `$ErrorActionPreference='Stop'`, `docker container inspect
finally-app` THREW, while `docker ps -aq --filter "name=^finally-app$"` returned an
empty string with no error, and `docker images -q finally:latest` returned the
image hash with no error.

**Fix:** replaced both existence checks with filter forms:
- `docker image inspect "$ImageName:latest"` -> `docker images -q "$ImageName:latest"`
- `docker container inspect "$Container"` -> `docker ps -aq --filter "name=^$Container$"`

The anchored `^...$` regex avoids matching substrings of other container names.

## Verification (genuinely observed on the live host)

All runs used `$env:PORT=8001` to avoid the user's local uvicorn dev-server already
bound to 8000 (the script honors `$env:PORT`, line 14). `LLM_MOCK=true`.

1. **Full first run** (create path): `Creating and starting finally-app...` ->
   `App is ready.` -> **exit 0**, container `Up ... 0.0.0.0:8001->8000/tcp`.
2. **Idempotent second run** (start path): `Container finally-app exists - starting
   if stopped...` -> `App is ready.` -> **exit 0**. Both fixed branches exercised.
3. **DOCK-04 persistence gate** (the actual phase success criterion): bought 1 GOOGL
   @ 175.09 (cash 362.06 -> 186.97, positions 3 -> 4), ran `docker restart
   finally-app`, re-read portfolio after health came back: cash **186.97230999999758**,
   GOOGL qty **1.0**, positions **4** - byte-identical across the restart.
   **PERSISTENCE PASS.** (A first "FAIL" print was a flaw in the check itself - exact
   `-eq` on an IEEE-754 float; re-checked with tolerance, all three identical.)
4. **stop_windows.ps1**: `Stopped finally-app. Data preserved in volume
   'finally-data'.` exit 0; container `Exited`, volume preserved, port 8001 freed.
5. User's local uvicorn on 8000 confirmed alive and untouched throughout
   (`{"status":"ok","chat_enabled":true}`).

## Constraint compliance

- Only `scripts/start_windows.ps1` changed (1 file, +11 -5). No app code, no other
  scripts, no docker-compose, no specs.
- `stop_windows.ps1` already parsed clean (0 non-ASCII, 0 errors) - not touched.
- Logic, port/volume/healthcheck/browser-launch behavior unchanged - only the two
  existence checks and the comment/string dashes.
- Production `finally-data` volume never deleted; test ran on alternate port 8001 so
  the user's 8000 dev-server was never disturbed.

## Self-Check
- [x] `scripts/start_windows.ps1` is pure ASCII (0 bytes > 127) and `[PSParser]::Tokenize` returns 0 errors.
- [x] Full create run exits 0; idempotent start run exits 0.
- [x] DOCK-04 persistence verified across `docker restart` (cash/qty/positions identical).
- [x] stop script stops container and preserves volume.
- [x] Only one file changed; user's local 8000 server untouched.
