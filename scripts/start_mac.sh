#!/bin/bash
set -e

IMAGE_NAME="finally"
CONTAINER_NAME="finally-app"
PORT="8000"
VOLUME_NAME="finally-data"
ENV_FILE=".env"

# Resolve script directory so this script works from any working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Check for .env file
if [ ! -f "$ENV_FILE" ]; then
  echo "Warning: .env file not found. Copying from .env.example..."
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "Created .env from .env.example. Please edit it and set your OPENROUTER_API_KEY."
  else
    echo "Error: .env.example not found either. Cannot start without environment configuration."
    exit 1
  fi
fi

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' is already running."
  echo "Access the app at: http://localhost:${PORT}"
  exit 0
fi

# Remove stopped container with the same name, if any
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Removing stopped container '${CONTAINER_NAME}'..."
  docker rm "$CONTAINER_NAME"
fi

# Build image (pass --build to force a rebuild even if image exists)
BUILD=false
for arg in "$@"; do
  if [ "$arg" = "--build" ]; then
    BUILD=true
  fi
done

if [ "$BUILD" = true ] || ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "Building Docker image '${IMAGE_NAME}'..."
  docker build -t "$IMAGE_NAME" .
else
  echo "Using existing image '${IMAGE_NAME}'. Pass --build to force a rebuild."
fi

# Start container
echo "Starting container '${CONTAINER_NAME}'..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:${PORT}" \
  -v "${VOLUME_NAME}:/app/db" \
  --env-file "$ENV_FILE" \
  "$IMAGE_NAME"

echo ""
echo "FinAlly is running!"
echo "Access the app at: http://localhost:${PORT}"

# Open browser if possible (macOS: open, Linux: xdg-open)
if command -v open &>/dev/null; then
  sleep 1
  open "http://localhost:${PORT}"
elif command -v xdg-open &>/dev/null; then
  sleep 1
  xdg-open "http://localhost:${PORT}"
fi
