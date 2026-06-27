'use client';

/**
 * AppShell — the 3-column terminal grid (UI-SPEC inventory).
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  Header (h-14, full width)                                     │
 *   ├──────────────┬──────────────────────────────────┬──────────────┤
 *   │  Watchlist   │  MainChart / PositionsTable /    │  Chat        │
 *   │  ~280px      │  PortfolioHeatmap / PnLChart /   │  ~360px      │
 *   │              │  TradeBar                       │              │
 *   └──────────────┴──────────────────────────────────┴──────────────┘
 *
 * Mounts PriceProvider → PortfolioProvider at the root so all panels
 * share state without prop-drilling (D-04). The Provider order matters:
 * PriceProvider must wrap PortfolioProvider because PortfolioContext's
 * removeTicker calls PriceContext.clearTicker (Pitfall 3).
 *
 * Center column order (top to bottom): MainChart → PositionsTable →
 * PortfolioHeatmap → PnLChart → TradeBar (UI-SPEC placement). The chart
 * takes the largest area (flex-1), positions table and heatmap and PnL
 * are fixed-height panels; TradeBar is the compact action bar at the bottom.
 *
 * Right column: ChatPanel.
 */

import { PriceProvider } from '@/context/PriceContext';
import { PortfolioProvider } from '@/context/PortfolioContext';
import { Toast } from '@/components/ui/Toast';
import { Header } from './Header';
import { WatchlistPanel } from '@/components/watchlist/WatchlistPanel';
import { MainChart } from '@/components/chart/MainChart';
import { PositionsTable } from '@/components/portfolio/PositionsTable';
import { PortfolioHeatmap } from '@/components/portfolio/PortfolioHeatmap';
import { PnLChart } from '@/components/portfolio/PnLChart';
import { TradeBar } from '@/components/trade/TradeBar';
import { ChatPanel } from '@/components/chat/ChatPanel';

export function AppShell() {
  return (
    <PriceProvider>
      <PortfolioProvider>
        <div className="h-screen w-screen flex flex-col bg-surface-base text-text-primary overflow-hidden">
          <Header />
          <main className="flex-1 grid grid-cols-[280px_minmax(0,1fr)_360px] gap-4 p-4 overflow-hidden">
            <WatchlistPanel />
            <CenterColumn />
            <ChatPanel />
          </main>
          <Toast />
        </div>
      </PortfolioProvider>
    </PriceProvider>
  );
}

function CenterColumn() {
  return (
    <section className="flex flex-col gap-4 overflow-y-auto min-h-0">
      <div className="flex-shrink-0">
        <MainChart />
      </div>
      <div className="flex-shrink-0">
        <PositionsTable />
      </div>
      <div className="flex-shrink-0">
        <PortfolioHeatmap />
      </div>
      <div className="flex-shrink-0">
        <PnLChart />
      </div>
      <div className="flex-shrink-0">
        <TradeBar />
      </div>
    </section>
  );
}