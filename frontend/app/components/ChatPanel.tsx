"use client";

import React, { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "@/app/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSendMessage: (message: string) => Promise<void>;
}

function TradeActionChip({
  ticker,
  side,
  quantity,
}: {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
}) {
  return (
    <span className={`trade-action ${side === "sell" ? "sell" : ""}`}>
      {side.toUpperCase()} {quantity} {ticker}
    </span>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const trades = msg.actions?.trades || [];
  const watchlistChanges = msg.actions?.watchlist_changes || [];

  return (
    <div className={`chat-message ${msg.role}`}>
      <div className="role">{msg.role === "user" ? "YOU" : "FINALLY AI"}</div>
      <div style={{ lineHeight: 1.5 }}>{msg.content}</div>

      {/* Trade confirmations */}
      {trades.length > 0 && (
        <div style={{ marginTop: "6px" }}>
          <span style={{ fontSize: "9px", color: "#8b949e", textTransform: "uppercase" }}>
            Executed trades:
          </span>
          <div>
            {trades.map((t, i) => (
              <TradeActionChip
                key={i}
                ticker={t.ticker}
                side={t.side}
                quantity={t.quantity}
              />
            ))}
          </div>
        </div>
      )}

      {/* Watchlist changes */}
      {watchlistChanges.length > 0 && (
        <div style={{ marginTop: "6px" }}>
          <span style={{ fontSize: "9px", color: "#8b949e", textTransform: "uppercase" }}>
            Watchlist:
          </span>
          <div>
            {watchlistChanges.map((w, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  margin: "2px",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  background:
                    w.action === "add"
                      ? "rgba(32, 157, 215, 0.2)"
                      : "rgba(234, 57, 67, 0.2)",
                  color:
                    w.action === "add" ? "#209dd7" : "#ea3943",
                  border: `1px solid ${w.action === "add" ? "rgba(32,157,215,0.4)" : "rgba(234,57,67,0.4)"}`,
                }}
              >
                {w.action === "add" ? "+" : "-"} {w.ticker}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-message assistant">
      <div className="role">FINALLY AI</div>
      <div style={{ display: "flex", gap: "4px", alignItems: "center", padding: "4px 0" }}>
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

export default function ChatPanel({
  messages,
  isLoading,
  isCollapsed,
  onToggleCollapse,
  onSendMessage,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messagesEndRef.current?.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      await onSendMessage(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isCollapsed) {
    return (
      <div
        style={{
          width: "40px",
          background: "#161b22",
          borderLeft: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "10px 0",
          cursor: "pointer",
          flexShrink: 0,
        }}
        onClick={onToggleCollapse}
        title="Open AI Chat"
      >
        <span style={{ color: "#753991", fontSize: "18px" }}>💬</span>
        <span
          style={{
            color: "#8b949e",
            fontSize: "9px",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            marginTop: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          AI CHAT
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "300px",
        flexShrink: 0,
        background: "#161b22",
        borderLeft: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid #30363d",
          background: "#21262d",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "#753991",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: "bold",
          }}
        >
          ✦ FINALLY AI
        </span>
        <button
          className="btn btn-ghost"
          onClick={onToggleCollapse}
          style={{ padding: "2px 6px", fontSize: "10px" }}
          title="Collapse"
        >
          ›
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {messages.length === 0 && !isLoading && (
          <div
            style={{
              color: "#8b949e",
              fontSize: "11px",
              padding: "20px 10px",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Ask me about your portfolio, request trade analysis, or tell me to
            buy/sell positions.
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {(isLoading || sending) && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 0 && (
        <div
          style={{
            padding: "6px 8px",
            borderTop: "1px solid #30363d",
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
          }}
        >
          {[
            "Analyze my portfolio",
            "Buy 10 AAPL",
            "What's my biggest risk?",
          ].map((s) => (
            <button
              key={s}
              className="btn btn-ghost"
              style={{ fontSize: "9px", padding: "3px 6px" }}
              onClick={() => {
                setInput(s);
                inputRef.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: "8px",
          borderTop: "1px solid #30363d",
          display: "flex",
          gap: "6px",
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          className="terminal-input"
          style={{ flex: 1 }}
          placeholder="Ask FinAlly AI..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{ padding: "4px 10px", whiteSpace: "nowrap" }}
        >
          {sending ? "..." : "SEND"}
        </button>
      </div>
    </div>
  );
}
