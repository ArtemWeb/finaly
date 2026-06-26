# FinAlly - Start Script (Windows PowerShell)
param(
    [switch]$Build
)

$ErrorActionPreference = "Stop"

$ImageName     = "finally"
$ContainerName = "finally-app"
$Port          = "8000"
$VolumeName    = "finally-data"
$EnvFile       = ".env"

# Resolve project root relative to this script
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $ProjectDir

# Check for .env file
if (-not (Test-Path $EnvFile)) {
    Write-Host "Warning: .env file not found. Copying from .env.example..."
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example. Please edit it and set your OPENROUTER_API_KEY."
    } else {
        Write-Error "Error: .env.example not found either. Cannot start without environment configuration."
        exit 1
    }
}

# Check if container is already running
$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($running) {
    Write-Host "Container '$ContainerName' is already running."
    Write-Host "Access the app at: http://localhost:$Port"
    exit 0
}

# Remove stopped container with the same name, if any
$exists = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
if ($exists) {
    Write-Host "Removing stopped container '$ContainerName'..."
    docker rm $ContainerName
}

# Build image if --Build flag passed or image does not exist
$imageExists = docker image inspect $ImageName 2>$null
if ($Build -or -not $imageExists) {
    Write-Host "Building Docker image '$ImageName'..."
    docker build -t $ImageName .
} else {
    Write-Host "Using existing image '$ImageName'. Pass -Build to force a rebuild."
}

# Start container
Write-Host "Starting container '$ContainerName'..."
docker run -d `
    --name $ContainerName `
    -p "${Port}:${Port}" `
    -v "${VolumeName}:/app/db" `
    --env-file $EnvFile `
    $ImageName

Write-Host ""
Write-Host "FinAlly is running!"
Write-Host "Access the app at: http://localhost:$Port"

# Open browser
Start-Sleep -Seconds 1
Start-Process "http://localhost:$Port"
