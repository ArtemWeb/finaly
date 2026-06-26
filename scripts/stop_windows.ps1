# FinAlly - Stop Script (Windows PowerShell)
$ErrorActionPreference = "Stop"

$ContainerName = "finally-app"

# Check if container is running
$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($running) {
    Write-Host "Stopping container '$ContainerName'..."
    docker stop $ContainerName
    Write-Host "Container stopped."
} else {
    Write-Host "Container '$ContainerName' is not running."
}

# Remove stopped container (but NOT the volume)
$exists = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($exists) {
    Write-Host "Removing container '$ContainerName'..."
    docker rm $ContainerName
    Write-Host "Container removed. Data volume preserved."
}
