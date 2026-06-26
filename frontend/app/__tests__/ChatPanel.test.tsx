import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChatPanel from "@/app/components/ChatPanel";
import type { ChatMessage } from "@/app/types";

const mockMessages: ChatMessage[] = [
  {
    id: "1",
    role: "user",
    content: "What is my portfolio worth?",
    created_at: "2024-01-01T10:00:00Z",
  },
  {
    id: "2",
    role: "assistant",
    content: "Your portfolio is worth $10,500.",
    actions: {
      trades: [],
      watchlist_changes: [],
    },
    created_at: "2024-01-01T10:00:01Z",
  },
];

const defaultProps = {
  messages: [],
  isLoading: false,
  isCollapsed: false,
  onToggleCollapse: jest.fn(),
  onSendMessage: jest.fn(),
};

describe("ChatPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the chat header", () => {
    render(<ChatPanel {...defaultProps} />);
    expect(screen.getByText(/FINALLY AI/i)).toBeInTheDocument();
  });

  it("shows empty state message when no messages", () => {
    render(<ChatPanel {...defaultProps} />);
    expect(screen.getByText(/Ask me about your portfolio/i)).toBeInTheDocument();
  });

  it("renders user and assistant messages", () => {
    render(<ChatPanel {...defaultProps} messages={mockMessages} />);
    expect(screen.getByText("What is my portfolio worth?")).toBeInTheDocument();
    expect(screen.getByText("Your portfolio is worth $10,500.")).toBeInTheDocument();
  });

  it("shows YOU label for user messages and FINALLY AI label for assistant messages", () => {
    render(<ChatPanel {...defaultProps} messages={mockMessages} />);
    expect(screen.getByText("YOU")).toBeInTheDocument();
    expect(screen.getByText("FINALLY AI")).toBeInTheDocument();
  });

  it("shows typing indicator when loading", () => {
    render(<ChatPanel {...defaultProps} isLoading={true} />);
    // Typing indicator is rendered via TypingIndicator component with dots
    const dots = document.querySelectorAll(".typing-dot");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("calls onSendMessage when send button is clicked", async () => {
    defaultProps.onSendMessage.mockResolvedValue(undefined);
    render(<ChatPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Ask FinAlly AI...");
    fireEvent.change(input, { target: { value: "Analyze my portfolio" } });
    const sendButton = screen.getByText("SEND");
    await act(async () => {
      fireEvent.click(sendButton);
    });
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith("Analyze my portfolio");
  });

  it("calls onSendMessage when Enter key is pressed", async () => {
    defaultProps.onSendMessage.mockResolvedValue(undefined);
    render(<ChatPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Ask FinAlly AI...");
    fireEvent.change(input, { target: { value: "Buy 10 AAPL" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith("Buy 10 AAPL");
  });

  it("clears input after sending", async () => {
    defaultProps.onSendMessage.mockResolvedValue(undefined);
    render(<ChatPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Ask FinAlly AI...");
    fireEvent.change(input, { target: { value: "Test message" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("send button is disabled when input is empty", () => {
    render(<ChatPanel {...defaultProps} />);
    const sendButton = screen.getByText("SEND");
    expect(sendButton).toBeDisabled();
  });

  it("send button is enabled when input has text", () => {
    render(<ChatPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Ask FinAlly AI...");
    fireEvent.change(input, { target: { value: "hello" } });
    const sendButton = screen.getByText("SEND");
    expect(sendButton).not.toBeDisabled();
  });

  it("renders collapsed state with chat icon", () => {
    render(<ChatPanel {...defaultProps} isCollapsed={true} />);
    expect(screen.getByText("💬")).toBeInTheDocument();
    expect(screen.getByTitle("Open AI Chat")).toBeInTheDocument();
  });

  it("calls onToggleCollapse when collapse button is clicked", () => {
    render(<ChatPanel {...defaultProps} />);
    const collapseBtn = screen.getByTitle("Collapse");
    fireEvent.click(collapseBtn);
    expect(defaultProps.onToggleCollapse).toHaveBeenCalled();
  });

  it("renders trade actions inline", () => {
    const messagesWithTrades: ChatMessage[] = [
      {
        id: "1",
        role: "assistant",
        content: "I bought 10 shares of AAPL for you.",
        actions: {
          trades: [{ ticker: "AAPL", side: "buy", quantity: 10, status: "success" }],
          watchlist_changes: [],
        },
        created_at: "2024-01-01T10:00:00Z",
      },
    ];
    render(<ChatPanel {...defaultProps} messages={messagesWithTrades} />);
    expect(screen.getByText("BUY 10 AAPL")).toBeInTheDocument();
  });

  it("renders watchlist changes inline", () => {
    const messagesWithChanges: ChatMessage[] = [
      {
        id: "1",
        role: "assistant",
        content: "I added TSLA to your watchlist.",
        actions: {
          trades: [],
          watchlist_changes: [{ ticker: "TSLA", action: "add", status: "success" }],
        },
        created_at: "2024-01-01T10:00:00Z",
      },
    ];
    render(<ChatPanel {...defaultProps} messages={messagesWithChanges} />);
    expect(screen.getByText("+ TSLA")).toBeInTheDocument();
  });
});
