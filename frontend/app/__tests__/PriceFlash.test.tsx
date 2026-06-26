import React from "react";
import { render, screen, act } from "@testing-library/react";
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
];

describe("Price Flash on Update", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies price-flash-up class when direction is up", () => {
    const { getByText } = render(
      <WatchlistPanel
        watchlist={mockWatchlist}
        prices={{}}
        sparklines={{}}
        flashMap={{ AAPL: "up" }}
        selectedTicker={null}
        onSelectTicker={jest.fn()}
        onRemoveTicker={jest.fn()}
        onAddTicker={jest.fn()}
      />
    );

    const priceCells = getByText("$190.50").closest("td");
    expect(priceCells).toHaveClass("price-flash-up");
  });

  it("applies price-flash-down class when direction is down", () => {
    const { getByText } = render(
      <WatchlistPanel
        watchlist={mockWatchlist}
        prices={{}}
        sparklines={{}}
        flashMap={{ AAPL: "down" }}
        selectedTicker={null}
        onSelectTicker={jest.fn()}
        onRemoveTicker={jest.fn()}
        onAddTicker={jest.fn()}
      />
    );

    const priceCells = getByText("$190.50").closest("td");
    expect(priceCells).toHaveClass("price-flash-down");
  });

  it("does not apply flash class when direction is null", () => {
    const { getByText } = render(
      <WatchlistPanel
        watchlist={mockWatchlist}
        prices={{}}
        sparklines={{}}
        flashMap={{ AAPL: null }}
        selectedTicker={null}
        onSelectTicker={jest.fn()}
        onRemoveTicker={jest.fn()}
        onAddTicker={jest.fn()}
      />
    );

    const priceCells = getByText("$190.50").closest("td");
    expect(priceCells).not.toHaveClass("price-flash-up");
    expect(priceCells).not.toHaveClass("price-flash-down");
  });

  it("does not apply flash class when ticker not in flashMap", () => {
    const { getByText } = render(
      <WatchlistPanel
        watchlist={mockWatchlist}
        prices={{}}
        sparklines={{}}
        flashMap={{}}
        selectedTicker={null}
        onSelectTicker={jest.fn()}
        onRemoveTicker={jest.fn()}
        onAddTicker={jest.fn()}
      />
    );

    const priceCells = getByText("$190.50").closest("td");
    expect(priceCells).not.toHaveClass("price-flash-up");
    expect(priceCells).not.toHaveClass("price-flash-down");
  });
});
