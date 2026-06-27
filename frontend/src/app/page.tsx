import { AppShell } from '@/components/layout/AppShell';

/**
 * The single trading-terminal page (Next.js App Router page.tsx).
 *
 * Per Next.js 14 `output: 'export'` rules this is a Server Component shell
 * that delegates to the client-only <AppShell/>. The AppShell mounts the
 * SSE provider, so the actual rendering happens client-side.
 */
export default function Page() {
  return <AppShell />;
}
