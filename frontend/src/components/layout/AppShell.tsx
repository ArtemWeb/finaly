'use client';

/**
 * AppShell — the 3-column terminal grid (UI-SPEC inventory).
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  Header (h-14, full width)                                     │
 *   ├──────────────┬──────────────────────────────────┬──────────────┤
 *   │  Watchlist   │  MainChart / Portfolio / Trade    │  Chat       │
 *   │  ~280px      │  flex                            │  ~360px     │
 *   └──────────────┴──────────────────────────────────┴──────────────┘
 *
 * Mounts PriceProvider → PortfolioProvider at the root so all panels
 * share state without prop-drilling (D-04). The Provider order matters:
 * PriceProvider must wrap PortfolioProvider because PortfolioContext's
 * removeTicker calls PriceContext.clearTicker (Pitfall 3).
 *
 * 03-03 fills the center and right columns with MainChart, PortfolioPanel,
 * TradeBar, ChatPanel. This plan deliberately leaves them as a labeled
 * placeholder so the watchlist + header can be visually verified in
 * isolation before the rest of the panels are wired.
 */

import type { ReactNode } from 'react';
import { PriceProvider } from '@/context/PriceContext';
import { PortfolioProvider } from '@/context/PortfolioContext';
import { Toast } from '@/components/ui/Toast';
import { Header } from './Header';
import { WatchlistPanel } from '@/components/watchlist/WatchlistPanel';

export function AppShell() {
  return (
    <PriceProvider>
      <PortfolioProvider>
        <div className="h-screen w-screen flex flex-col bg-surface-base text-text-primary overflow-hidden">
          <Header />
          <main className="flex-1 grid grid-cols-[280px_minmax(0,1fr)_360px] gap-4 p-4 overflow-hidden">
            <WatchlistPanel />
            <CenterColumn />
            <RightColumn />
          </main>
          <Toast />
        </div>
      </PortfolioProvider>
    </PriceProvider>
  );
}

function CenterColumn() {
  return (
    <section className="flex flex-col gap-4 overflow-hidden">
      <PlaceholderPanel label="Main chart" />
      <PlaceholderPanel label="Portfolio" />
      <PlaceholderPanel label="Trade bar" />
    </section>
  );
}

function RightColumn() {
  return (
    <section className="flex flex-col gap-4 overflow-hidden">
      <PlaceholderPanel label="AI Assistant" />
    </section>
  );
}

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="bg-surface-panel border border-white/5 flex items-center justify-center text-text-muted text-xs tracking-wider uppercase">
      {label}
    </div>
  );
}
