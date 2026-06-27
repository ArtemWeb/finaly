#!/usr/bin/env bash
# FinAlly stopper (macOS / Linux).
# Stops the container WITHOUT removing the finally-data named volume so the
# SQLite database persists across stop/start cycles.

set -euo pipefail

CONTAINER_NAME="finally-app"
VOLUME_NAME="finally-data"

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker stop "$CONTAINER_NAME"
  echo "Stopped $CONTAINER_NAME. Data preserved in volume '$VOLUME_NAME'."
else
  echo "Container $CONTAINER_NAME is not running."
fi