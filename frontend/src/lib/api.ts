/**
 * Single URL chokepoint for every frontend network call (D-01).
 *
 * Reads NEXT_PUBLIC_API_BASE_URL once at module load:
 *   - empty/unset → relative path (same-origin production: FastAPI serves both)
 *   - http://localhost:8000 → dev (next dev on :3000, backend on :8000)
 *
 * Every fetch and EventSource URL must be built via this helper. Never
 * concatenate user input directly into a URL elsewhere.
 */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  return `${base}${path}`;
}