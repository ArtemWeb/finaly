/**
 * TypeScript interfaces mirroring the verified backend response shapes.
 *
 * Sources (verified against source):
 *   - PriceUpdate.to_dict() → backend/app/market/models.py:39-49
 *   - /api/watchlist → backend/app/routes/watchlist.py:46-71
 *   - /api/portfolio → backend/app/portfolio_service.py:get_portfolio
 *   - /api/portfolio/trade → backend/app/routes/portfolio.py:67-79
 *   - /api/portfolio/history → backend/app/routes/portfolio.py:81-84
 *   - /api/chat → backend/app/chat_service.py:handle_chat
 *   - /api/stream/prices (SSE) → backend/app/market/stream.py:80-83
 */

export type PriceDirection = 'up' | 'down' | 'flat';

export interface PriceUpdate {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: number;
  change: number;
  change_percent: number;
  direction: PriceDirection;
}

/**
 * WatchlistEntry mirrors /api/watchlist GET response.
 * `price` may be null when no live price is cached for that ticker yet.
 */
export interface WatchlistEntry {
  ticker: string;
  added_at: string;
  price: number | null;
  previous_price?: number;
  timestamp?: number;
  change?: number;
  change_percent?: number;
  direction?: PriceDirection;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  change_percent: number;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  positions: Position[];
}

export type TradeSide = 'buy' | 'sell';

export interface TradeRequest {
  ticker: string;
  quantity: number;
  side: TradeSide;
}

export interface TradeResponse {
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  cash_balance: number;
}

export interface TradeErrorResponse {
  detail: string;
}

export interface HistoryPoint {
  recorded_at: string;
  total_value: number;
}

export type ChatTradeStatus = 'executed' | 'error';

export interface ChatTradeAction {
  ticker: string;
  side: TradeSide;
  quantity: number;
  status: ChatTradeStatus;
  detail: string;
}

export type ChatWatchlistStatus = 'ok' | 'error';
export type ChatWatchlistActionType = 'add' | 'remove';

export interface ChatWatchlistAction {
  ticker: string;
  action: ChatWatchlistActionType;
  status: ChatWatchlistStatus;
  detail?: string;
}

export interface ChatActions {
  trades: ChatTradeAction[];
  watchlist_changes: ChatWatchlistAction[];
}

export interface ChatResponse {
  message: string;
  actions: ChatActions;
}

export interface ChatRequest {
  message: string;
}

/**
 * SSE payload shape — a flat map keyed by ticker.
 * Each value is the full PriceUpdate for that ticker.
 */
export type SsePayload = Record<string, PriceUpdate>;

export interface WatchlistAddResponse {
  status: 'ok';
  ticker: string;
}