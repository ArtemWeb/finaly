# Stage 1: Build frontend static export
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output is in frontend/out/

# Stage 2: Python backend
FROM python:3.12-slim AS final
WORKDIR /app

# Install uv
RUN pip install uv

# Copy backend and install dependencies
COPY backend/ ./backend/
WORKDIR /app/backend
RUN uv sync --frozen

# Copy frontend build into static/ directory served by FastAPI
COPY --from=frontend-builder /app/frontend/out ./static/

WORKDIR /app
# Create db directory
RUN mkdir -p db

EXPOSE 8000

CMD ["uv", "--directory", "backend", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
