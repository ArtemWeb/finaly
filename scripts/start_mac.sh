#!/usr/bin/env bash
# FinAlly launcher (macOS / Linux).
# Idempotent: builds the image if missing, starts the existing container if
# present, otherwise creates and runs it. Waits for /api/health, then opens
# the browser. Data is persisted across runs in the named Docker volume.

set -euo pipefail

IMAGE_NAME="finally"
CONTAINER_NAME="finally-app"
# VOLUME_NAME resolves to finally-data:/app/db at run time — see `docker run`
# below. The named volume is reused across start/stop cycles so the SQLite
# database persists.
VOLUME_NAME="finally-data"
PORT="${PORT:-8000}"

# Run from the repository root so the Dockerfile, .env, and build context are
# found regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 1. Build image if missing.
if ! docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
  echo "Building $IMAGE_NAME:latest..."
  docker build -t "$IMAGE_NAME:latest" .
fi

# 2. Start container (idempotent — never double-binds the port).
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Container $CONTAINER_NAME exists — starting if stopped..."
  docker start "$CONTAINER_NAME" >/dev/null
else
  echo "Creating and starting $CONTAINER_NAME..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:8000" \
    --env-file .env \
    -v "$VOLUME_NAME:/app/db" \
    --restart unless-stopped \
    "$IMAGE_NAME:latest"
fi

# 3. Wait for /api/health (poll up to ~30s).
echo "Waiting for app to be ready at http://localhost:$PORT ..."
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "App is ready."
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "App did not become ready in 30s. Check 'docker logs $CONTAINER_NAME'." >&2
  exit 1
fi

# 4. Open browser (cross-platform: macOS open / Linux xdg-open / fallback URL).
URL="http://localhost:$PORT"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  echo "Open $URL in your browser."
fi