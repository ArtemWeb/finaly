# FinAlly launcher (Windows PowerShell 5.1).
# Idempotent: builds the image if missing, starts the existing container if
# present, otherwise creates and runs it. Waits for /api/health, then opens
# the browser. Data is persisted across runs in the named Docker volume.

$ErrorActionPreference = 'Stop'

$ImageName = 'finally'
$Container = 'finally-app'
# $Volume resolves to finally-data:/app/db at run time - see `docker run` below.
# The named volume is reused across start/stop cycles so the SQLite database
# persists.
$Volume    = 'finally-data'
$Port      = if ($env:PORT) { $env:PORT } else { 8000 }

# Run from the repository root so the Dockerfile, .env, and build context are
# found regardless of where the script is invoked from.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

# 1. Build image if missing.
# Use `docker images -q` (not `image inspect`): inspect writes to stderr when the
# image is absent, which under $ErrorActionPreference='Stop' becomes a terminating
# error even with 2>$null. `images -q` returns an empty string instead - no stderr.
$img = docker images -q "$ImageName`:latest"
if (-not $img) {
    Write-Host "Building $ImageName`:latest..."
    docker build -t "$ImageName`:latest" .
}

# 2. Start container (idempotent - never double-binds the port).
# `docker ps -aq --filter` returns an empty string for a missing container (no
# stderr), unlike `container inspect` which errors to stderr and trips the Stop
# preference. The anchored ^name$ regex avoids matching substrings of other names.
$exists = docker ps -aq --filter "name=^$Container$"
if ($exists) {
    Write-Host "Container $Container exists - starting if stopped..."
    docker start "$Container" | Out-Null
} else {
    Write-Host "Creating and starting $Container..."
    docker run -d `
        --name "$Container" `
        -p "$Port`:8000" `
        --env-file .env `
        -v "$Volume`:/app/db" `
        --restart unless-stopped `
        "$ImageName`:latest"
}

# 3. Wait for /api/health (poll up to ~30s).
Write-Host "Waiting for app to be ready at http://localhost:$Port ..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            Write-Host "App is ready."
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $ready) {
    Write-Error "App did not become ready in 30s. Check 'docker logs $Container'."
    exit 1
}

# 4. Open browser via Start-Process (PowerShell 5.1 compatible).
Start-Process "http://localhost:$Port"