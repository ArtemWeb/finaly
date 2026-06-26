import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import WatchlistPanel from "@/app/components/WatchlistPanel";
import type { WatchlistItem } from "@/app/types";

const mockWatchlist: WatchlistItem[] = [
  {
    ticker: "AAPL",
    price: 190.5,
    prev_price: 188.0,
    change_pct: 1.33,
    direction: "up",
  },
  {
    ticker: "GOOGL",
    price: 175.2,
    prev_price: 177.0,
    change_pct: -1.02,
    direction: "down",
  },
  {
    ticker: "MSFT",
    price: 420.0,
    prev_price: 420.0,
    change_pct: 0.0,
    direction: "neutral",
  },
];

const defaultProps = {
  watchlist: mockWatchlist,
  prices: {},
  sparklines: {},
  flashMap: {},
  selectedTicker: null,
  onSelectTicker: jest.fn(),
  onRemoveTicker: jest.fn(),
  onAddTicker: jest.fn(),
};

describe("WatchlistPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all tickers from watchlist", () => {
    render(<WatchlistPanel {...defaultProps} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("GOOGL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("displays ticker count in header", () => {
    render(<WatchlistPanel {...defaultProps} />);
    expect(screen.getByText("3 tickers")).toBeInTheDocument();
  });

  it("shows prices for each ticker", () => {
    render(<WatchlistPanel {...defaultProps} />);
    expect(screen.getByText("$190.50")).toBeInTheDocument();
    expect(screen.getByText("$175.20")).toBeInTheDocument();
    expect(screen.getByText("$420.00")).toBeInTheDocument();
  });

  it("calls onSelectTicker when a row is clicked", () => {
    render(<WatchlistPanel {...defaultProps} />);
    const aaplRow = screen.getByText("AAPL").closest("tr");
    fireEvent.click(aaplRow!);
    expect(defaultProps.onSelectTicker).toHaveBeenCalledWith("AAPL");
  });

  it("highlights the selected ticker", () => {
    render(<WatchlistPanel {...defaultProps} selectedTicker="AAPL" />);
    const aaplChip = screen.getByText("AAPL");
    expect(aaplChip).toHaveStyle({ color: "rgb(32, 157, 215)" });
  });

  it("shows empty message when watchlist is empty", () => {
    render(<WatchlistPanel {...defaultProps} watchlist={[]} />);
    expect(screen.getByText("No tickers in watchlist")).toBeInTheDocument();
  });

  it("calls onRemoveTicker when remove button is clicked", () => {
    render(<WatchlistPanel {...defaultProps} />);
    const removeButtons = screen.getAllByTitle("Remove");
    fireEvent.click(removeButtons[0]);
    expect(defaultProps.onRemoveTicker).toHaveBeenCalledWith("AAPL");
  });

  it("calls onAddTicker when add button is clicked with valid input", async () => {
    defaultProps.onAddTicker.mockResolvedValue(undefined);
    render(<WatchlistPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Add ticker...");
    fireEvent.change(input, { target: { value: "TSLA" } });
    const addButton = screen.getByText("+");
    await act(async () => {
      fireEvent.click(addButton);
    });
    expect(defaultProps.onAddTicker).toHaveBeenCalledWith("TSLA");
  });

  it("calls onAddTicker when Enter is pressed in input", async () => {
    defaultProps.onAddTicker.mockResolvedValue(undefined);
    render(<WatchlistPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Add ticker...");
    fireEvent.change(input, { target: { value: "NVDA" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(defaultProps.onAddTicker).toHaveBeenCalledWith("NVDA");
  });

  it("uses live prices from priceMap when available", () => {
    const prices = {
      AAPL: {
        ticker: "AAPL",
        price: 200.0,
        prev_price: 190.5,
        timestamp: new Date().toISOString(),
        direction: "up" as const,
      },
    };
    render(<WatchlistPanel {...defaultProps} prices={prices} />);
    expect(screen.getByText("$200.00")).toBeInTheDocument();
  });
});
