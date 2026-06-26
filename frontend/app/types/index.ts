export interface WatchlistItem {
  ticker: string;
  price: number;
  prev_price: number;
  change_pct: number;
  direction: "up" | "down" | "neutral";
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  unrealized_pnl: number;
  pnl_pct: number;
  market_value: number;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  positions: Position[];
}

export interface PortfolioHistoryPoint {
  recorded_at: string;
  total_value: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: {
    trades?: TradeAction[];
    watchlist_changes?: WatchlistChange[];
  };
  created_at: string;
}

export interface TradeAction {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price?: number;
  status?: "success" | "error";
  message?: string;
}

export interface WatchlistChange {
  ticker: string;
  action: "add" | "remove";
  status?: "success" | "error";
}

export interface PriceUpdate {
  ticker: string;
  price: number;
  prev_price: number;
  timestamp: string;
  direction: "up" | "down" | "neutral";
}

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";
