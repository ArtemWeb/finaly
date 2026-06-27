# FinAlly single-container build.
#
# Three stages:
#   1. frontend-build  - Node 20 slim; produces /build/out (Next.js static export)
#   2. backend-build   - Python 3.12 slim with the official uv binary; produces
#                        /app/.venv (deps only) + /app/app (package copy)
#   3. runtime         - Python 3.12 slim; only the venv + app + static export
#
# Key invariants (validated by 04-01 acceptance criteria):
#   - STATIC_DIR default in backend/app/main.py is "static" -> the export
#     MUST land at /app/static (relative to WORKDIR /app).
#   - DB_PATH default in backend/app/db.py is "db/finally.db" (relative) ->
#     we set DB_PATH=/app/db/finally.db and pre-create /app/db so the volume
#     mount point is durable.
#   - uv sync --frozen is used (NOT --locked, NOT --extra dev, NOT pip) so
#     httpx / pytest stay out of the runtime image (RESEARCH Pitfall 9).
#   - NEXT_PUBLIC_API_BASE_URL is intentionally NEVER set so the static
#     export uses relative URLs (RESEARCH Pitfall 10).
#   - No ARG or ENV holds a secret value (OPENROUTER_API_KEY only ever
#     arrives at runtime via --env-file). See threat model T-04-01.

# ----- Stage 1: build frontend -----
FROM node:20-slim AS frontend-build
WORKDIR /build

# Pin to lockfile; `npm ci` is deterministic and refuses drift
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# `output: 'export'` in next.config.js writes the static site to ./out
RUN npm run build


# ----- Stage 2: install backend deps (uses uv from the official image) -----
FROM python:3.12-slim AS backend-build

# Official uv binary; pinned to the latest tag at build time
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Use the system Python (we are FROM python:3.12-slim already) — no download
ENV UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Install deps only first (no project copy yet) for layer caching
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-editable

# Now copy the project and install it editable=false (we COPY app/ in stage 3)
COPY backend/ /app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-editable


# ----- Stage 3: runtime -----
FROM python:3.12-slim
WORKDIR /app

# Activate the venv; keep .pyc off; unbuffered for live logs
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Backend: venv + app package
COPY --from=backend-build /app/.venv /app/.venv
COPY --from=backend-build /app/app /app/app

# Frontend static export -> /app/static (must match STATIC_DIR default)
COPY --from=frontend-build /build/out /app/static

# Pre-create the DB mount point so the named volume binds cleanly even before
# the first request. DB_PATH below must match backend/app/db.py default shape
# resolved against WORKDIR /app.
RUN mkdir -p /app/db
ENV DB_PATH=/app/db/finally.db

EXPOSE 8000

# Liveness probe: poll /api/health via stdlib urllib (RESEARCH Open Question 3).
# The endpoint is defined in backend/app/main.py:create_app() and returns 200
# with {"status": "ok", "chat_enabled": <bool>}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health').read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
