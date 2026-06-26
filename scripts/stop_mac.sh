#!/bin/bash
set -e

CONTAINER_NAME="finally-app"

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping container '${CONTAINER_NAME}'..."
  docker stop "$CONTAINER_NAME"
  echo "Container stopped."
else
  echo "Container '${CONTAINER_NAME}' is not running."
fi

# Remove stopped container (but NOT the volume)
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Removing container '${CONTAINER_NAME}'..."
  docker rm "$CONTAINER_NAME"
  echo "Container removed. Data volume preserved."
fi
