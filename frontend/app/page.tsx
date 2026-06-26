"use client";

import React, { useState, useEffect, useCallback } from "react";
import Header from "@/app/components/Header";
import WatchlistPanel from "@/app/components/WatchlistPanel";
import MainChart from "@/app/components/MainChart";
import PortfolioHeatmap from "@/app/components/PortfolioHeatmap";
import PnLChart from "@/app/components/PnLChart";
import PositionsTable from "@/app/components/PositionsTable";
import TradeBar from "@/app/components/TradeBar";
import ChatPanel from "@/app/components/ChatPanel";
import { usePriceStream } from "@/app/hooks/usePriceStream";
import { api } from "@/app/lib/api";
import type {
  WatchlistItem,
  Portfolio,
  PortfolioHistoryPoint,
  ChatMessage,
} from "@/app/types";

const PORTFOLIO_REFRESH_INTERVAL = 10000; // 10s
const HISTORY_REFRESH_INTERVAL = 30000; // 30s

export default function TradingTerminal() {
  // SSE price stream
  const { prices, sparklines, flashMap, connectionStatus } = usePriceStream();

  // State
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  // Data loading
  const loadWatchlist = useCallback(async () => {
    try {
      const data = await api.getWatchlist();
      setWatchlist(data);
    } catch (err) {
      console.error("Failed to load watchlist:", err);
    }
  }, []);

  const loadPortfolio = useCallback(async () => {
    try {
      const data = await api.getPortfolio();
      setPortfolio(data);
    } catch (err) {
      console.error("Failed to load portfolio:", err);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getPortfolioHistory();
      setHistory(data);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadWatchlist();
    loadPortfolio();
    loadHistory();
  }, [loadWatchlist, loadPortfolio, loadHistory]);

  // Periodic refresh
  useEffect(() => {
    const portfolioTimer = setInterval(loadPortfolio, PORTFOLIO_REFRESH_INTERVAL);
    const historyTimer = setInterval(loadHistory, HISTORY_REFRESH_INTERVAL);
    return () => {
      clearInterval(portfolioTimer);
      clearInterval(historyTimer);
    };
  }, [loadPortfolio, loadHistory]);

  // Watchlist handlers
  const handleAddTicker = useCallback(
    async (ticker: string) => {
      try {
        await api.addToWatchlist(ticker);
        await loadWatchlist();
      } catch (err) {
        console.error("Failed to add ticker:", err);
      }
    },
    [loadWatchlist]
  );

  const handleRemoveTicker = useCallback(
    async (ticker: string) => {
      try {
        await api.removeFromWatchlist(ticker);
        setWatchlist((prev) => prev.filter((w) => w.ticker !== ticker));
        if (selectedTicker === ticker) {
          setSelectedTicker(null);
        }
      } catch (err) {
        console.error("Failed to remove ticker:", err);
      }
    },
    [selectedTicker]
  );

  // Trade handler
  const handleTrade = useCallback(
    async (
      ticker: string,
      quantity: number,
      side: "buy" | "sell"
    ): Promise<{ success: boolean; message?: string }> => {
      try {
        const result = await api.executeTrade(ticker, quantity, side);
        if (result.success) {
          await loadPortfolio();
          await loadHistory();
        }
        return result;
      } catch (err) {
        return { success: false, message: String(err) };
      }
    },
    [loadPortfolio, loadHistory]
  );

  // Chat handler
  const handleSendMessage = useCallback(async (message: string) => {
    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, tempUserMsg]);
    setChatLoading(true);

    try {
      const response = await api.sendChatMessage(message);

      // Build assistant message with actions
      const assistantMsg: ChatMessage = {
        id: response.chat_message?.id || `ai-${Date.now()}`,
        role: "assistant",
        content: response.message,
        actions: {
          trades: response.trades?.map((t) => ({
            ...t,
            status: "success" as const,
          })),
          watchlist_changes: response.watchlist_changes?.map((w) => ({
            ...w,
            status: "success" as const,
          })),
        },
        created_at: new Date().toISOString(),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);

      // Refresh data after AI actions
      if (response.trades && response.trades.length > 0) {
        await loadPortfolio();
        await loadHistory();
      }
      if (response.watchlist_changes && response.watchlist_changes.length > 0) {
        await loadWatchlist();
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Error: ${String(err)}`,
        created_at: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
    }
  }, [loadPortfolio, loadHistory, loadWatchlist]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Header portfolio={portfolio} connectionStatus={connectionStatus} />

      {/* Trade Bar */}
      <TradeBar
        prices={prices}
        cashBalance={portfolio?.cash_balance ?? 0}
        selectedTicker={selectedTicker}
        onTrade={handleTrade}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: "1px" }}>
        {/* Left column - Watchlist */}
        <div
          style={{
            width: "280px",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            padding: "4px",
            gap: "4px",
          }}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <WatchlistPanel
              watchlist={watchlist}
              prices={prices}
              sparklines={sparklines}
              flashMap={flashMap}
              selectedTicker={selectedTicker}
              onSelectTicker={setSelectedTicker}
              onRemoveTicker={handleRemoveTicker}
              onAddTicker={handleAddTicker}
            />
          </div>
        </div>

        {/* Center column */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "4px",
            gap: "4px",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Top row: Main chart + Heatmap */}
          <div
            style={{
              flex: "0 0 55%",
              display: "flex",
              gap: "4px",
              minHeight: 0,
            }}
          >
            {/* Main chart */}
            <div style={{ flex: "1 1 60%", minWidth: 0, minHeight: 0 }}>
              <MainChart
                ticker={selectedTicker}
                prices={prices}
                sparklines={sparklines}
              />
            </div>

            {/* Heatmap */}
            <div style={{ flex: "0 0 35%", minWidth: 0, minHeight: 0 }}>
              <PortfolioHeatmap
                positions={portfolio?.positions ?? []}
                prices={prices}
              />
            </div>
          </div>

          {/* Bottom row: P&L Chart + Positions */}
          <div
            style={{
              flex: "0 0 44%",
              display: "flex",
              gap: "4px",
              minHeight: 0,
            }}
          >
            {/* P&L chart */}
            <div style={{ flex: "0 0 40%", minWidth: 0, minHeight: 0 }}>
              <PnLChart history={history} initialValue={10000} />
            </div>

            {/* Positions table */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <PositionsTable
                positions={portfolio?.positions ?? []}
                prices={prices}
                onSelectTicker={setSelectedTicker}
              />
            </div>
          </div>
        </div>

        {/* Right column - AI Chat */}
        <ChatPanel
          messages={chatMessages}
          isLoading={chatLoading}
          isCollapsed={chatCollapsed}
          onToggleCollapse={() => setChatCollapsed((c) => !c)}
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
}
