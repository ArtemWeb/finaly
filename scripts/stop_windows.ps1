# FinAlly stopper (Windows PowerShell 5.1).
# Stops the container WITHOUT removing the finally-data named volume so the
# SQLite database persists across stop/start cycles.

$ErrorActionPreference = 'Stop'

$Container = 'finally-app'
$Volume    = 'finally-data'

$exists = docker container inspect "$Container" 2>$null
if ($exists) {
    docker stop "$Container" | Out-Null
    Write-Host "Stopped $Container. Data preserved in volume '$Volume'."
} else {
    Write-Host "Container $Container is not running."
}