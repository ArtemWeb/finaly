#!/usr/bin/env bash
# verify_persistence.sh — DOCK-02 acceptance smoke test.
#
# Proves that data written to SQLite inside the container survives a
# docker stop / docker start cycle via the named volume mounted at /app/db.
#
# Dedicated names (must NEVER collide with the real prod resources):
#   IMAGE_NAME   = finally:latest
#   CONTAINER    = finally-persist-test
#   VOLUME       = finally-persist-data
#   PORT         = 18000 (avoids colliding with anything on :8000)
#
# Threat model references:
#   T-04-02 — use `docker stop` (SIGTERM -> lifespan shutdown). Never kill -9.
#   T-04-02 — never `docker volume rm` the data volume BEFORE the assertion
#             runs. The volume is removed only after the assertion passes
#             (in the tear-down section).
#
# Requires: docker, curl, python (for JSON parsing — avoids jq dep).
# Python launcher resolution: try python3 first (Linux/macOS/WSL), then
# python (Windows). Abort with a clear message if neither is usable.

set -euo pipefail

if command -v python3 >/dev/null 2>&1 && python3 -c 'pass' >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1 && python -c 'pass' >/dev/null 2>&1; then
    PYTHON=python
else
    echo "ERROR: neither 'python3' nor 'python' is runnable on this host." >&2
    echo "       Install Python 3 (https://python.org) and retry." >&2
    exit 1
fi

IMAGE_NAME="finally:latest"
CONTAINER="finally-persist-test"
VOLUME="finally-persist-data"
PORT="${PERSIST_TEST_PORT:-18000}"
HEALTH_TIMEOUT=30
STARTUP_TIMEOUT=30
TEST_TICKER="${PERSIST_TEST_TICKER:-AAPL}"
TEST_QTY="${PERSIST_TEST_QTY:-1}"

# Portable JSON field extractor (works on bash 4+ on macOS, Linux, WSL).
json_get() {
    # usage: json_get '<json>' '<python-expression-on-_d>'
    # e.g.   json_get "$body" '_d["cash_balance"]'
    "$PYTHON" -c '
import json, sys
data = json.loads(sys.argv[1])
expr = sys.argv[2]
print(eval(expr, {"_d": data}))
' "$1" "$2"
}

cleanup() {
    # Best-effort cleanup of the test container; the test volume is only
    # removed AFTER the assertion passes (see bottom of script).
    if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

echo "== verify_persistence.sh =="
echo "image=$IMAGE_NAME  container=$CONTAINER  volume=$VOLUME  port=$PORT"

# 1. Build the image if it's missing locally.
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "[1/7] Building $IMAGE_NAME..."
    docker build -t "$IMAGE_NAME" .
else
    echo "[1/7] $IMAGE_NAME already built — skipping rebuild."
fi

# 2. Make sure no stale container is around (clean slate).
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "[2/7] Removing stale $CONTAINER..."
    docker rm -f "$CONTAINER" >/dev/null
fi

# 3. Run the container detached with the named volume mounted at /app/db.
echo "[3/7] Starting $CONTAINER..."
docker run -d \
    --name "$CONTAINER" \
    -p "$PORT:8000" \
    -v "$VOLUME:/app/db" \
    "$IMAGE_NAME" >/dev/null

# 4. Poll /api/health until 200 (timeout: ${HEALTH_TIMEOUT}s).
echo "[4/7] Waiting for /api/health on :$PORT (timeout ${HEALTH_TIMEOUT}s)..."
ready=0
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        echo "    healthy after ${i}s"
        ready=1
        break
    fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "FAIL: container did not become healthy within ${HEALTH_TIMEOUT}s"
    echo "--- recent logs ---"
    docker logs --tail=50 "$CONTAINER"
    exit 1
fi

# 5. POST a small buy of a seeded ticker, then capture portfolio state.
echo "[5/7] Executing $TEST_QTY $TEST_TICKER buy..."
trade_body=$(printf '{"ticker":"%s","quantity":%s,"side":"buy"}' \
    "$TEST_TICKER" "$TEST_QTY")
trade_resp=$(curl -sf -X POST \
    -H 'Content-Type: application/json' \
    -d "$trade_body" \
    "http://localhost:$PORT/api/portfolio/trade") \
    || { echo "FAIL: trade POST failed"; docker logs --tail=50 "$CONTAINER"; exit 1; }
echo "    trade response: $trade_resp"

before_body=$(curl -sf "http://localhost:$PORT/api/portfolio") \
    || { echo "FAIL: GET /api/portfolio before restart failed"; exit 1; }
before_cash=$(json_get "$before_body" '_d["cash_balance"]')
echo "    cash before: $before_cash"

# Find this ticker's position (quantity + avg_cost) so we can compare.
# python expression on _d['positions'] list of dicts.
before_pos=$("$PYTHON" -c '
import json, sys
d = json.loads(sys.argv[1])
ticker = sys.argv[2]
for p in d.get("positions", []):
    if p.get("ticker") == ticker:
        print(f"{p[\"quantity\"]}|{p[\"avg_cost\"]}")
        break
else:
    print("NONE")
' "$before_body" "$TEST_TICKER")
echo "    position before: $before_pos"

# 6. Graceful stop, then start; volume must remain untouched.
echo "[6/7] docker stop -> docker start (volume preserved)..."
docker stop "$CONTAINER" >/dev/null
# Re-start the SAME container (volume stays mounted, DB file stays put).
docker start "$CONTAINER" >/dev/null

# Poll health again (startup may take a few seconds).
echo "    waiting for /api/health after restart (timeout ${STARTUP_TIMEOUT}s)..."
ready=0
for i in $(seq 1 "$STARTUP_TIMEOUT"); do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        echo "    healthy after ${i}s"
        ready=1
        break
    fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "FAIL: container did not come back healthy after restart"
    echo "--- recent logs ---"
    docker logs --tail=50 "$CONTAINER"
    exit 1
fi

# 7. Assert portfolio state survived the stop/start cycle.
echo "[7/7] Verifying portfolio state survived..."
after_body=$(curl -sf "http://localhost:$PORT/api/portfolio") \
    || { echo "FAIL: GET /api/portfolio after restart failed"; exit 1; }
after_cash=$(json_get "$after_body" '_d["cash_balance"]')
echo "    cash after:  $after_cash"

after_pos=$("$PYTHON" -c '
import json, sys
d = json.loads(sys.argv[1])
ticker = sys.argv[2]
for p in d.get("positions", []):
    if p.get("ticker") == ticker:
        print(f"{p[\"quantity\"]}|{p[\"avg_cost\"]}")
        break
else:
    print("NONE")
' "$after_body" "$TEST_TICKER")
echo "    position after:  $after_pos"

# Acceptance: cash and position match the pre-restart snapshot exactly.
if [ "$before_cash" != "$after_cash" ]; then
    echo "FAIL: cash_balance changed across restart"
    echo "  before: $before_cash"
    echo "  after:  $after_cash"
    exit 1
fi
if [ "$before_pos" != "$after_pos" ]; then
    echo "FAIL: $TEST_TICKER position changed across restart"
    echo "  before: $before_pos"
    echo "  after:  $after_pos"
    exit 1
fi

echo "PASS: DOCK-02 persistence verified via named volume $VOLUME"

# Tear-down: now that the assertion has passed, the test volume can be
# safely removed (it never contained anything but ephemeral test data).
docker stop "$CONTAINER" >/dev/null 2>&1 || true
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    docker volume rm "$VOLUME" >/dev/null
fi
echo "Tear-down complete (container + test volume removed)."
