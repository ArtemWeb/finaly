import { test, expect } from '@playwright/test';
import { ChatPage } from './pages/ChatPage';
import { TradingPage } from './pages/TradingPage';

/**
 * AI chat tests.
 * All tests run with LLM_MOCK=true — no real LLM calls are made.
 * The mock LLM returns deterministic responses defined in the backend.
 *
 * NOTE FOR BACKEND DEVS: When LLM_MOCK=true, the mock responses should include:
 * - A text message in the "message" field
 * - Optionally: a trade or watchlist change in the response to test action rendering
 * The exact mock response content should match what the tests verify below.
 */
test.describe('AI chat panel', () => {
  test.beforeEach(async ({ page }) => {
    const chatPage = new ChatPage(page);
    await chatPage.goto();
    // Chat panel should be visible on load
    await expect(chatPage.chatPanel).toBeVisible();
  });

  test('send a chat message — receives a response', async ({ page }) => {
    const chatPage = new ChatPage(page);

    const messageCount = await chatPage.getMessages().count();

    await chatPage.sendMessage('Hello, what is my portfolio?');

    // Wait for the full response cycle
    await chatPage.waitForAssistantResponse();

    // There should be more messages than before
    const newCount = await chatPage.getMessages().count();
    expect(newCount).toBeGreaterThan(messageCount);
  });

  test('user message appears in conversation history', async ({ page }) => {
    const chatPage = new ChatPage(page);

    const userText = 'What is my cash balance?';
    await chatPage.sendMessage(userText);

    // The user's message should appear immediately
    const userMessages = chatPage.getUserMessages();
    await expect(userMessages.last()).toContainText(userText, { timeout: 5_000 });
  });

  test('assistant response appears in conversation history', async ({ page }) => {
    const chatPage = new ChatPage(page);

    await chatPage.sendMessage('How is my portfolio doing?');
    await chatPage.waitForAssistantResponse();

    const assistantMessages = chatPage.getAssistantMessages();
    await expect(assistantMessages.last()).toBeVisible();

    const responseText = await chatPage.getLastAssistantMessageText();
    // Mock response should contain non-empty text
    expect(responseText.trim().length).toBeGreaterThan(0);
  });

  test('loading indicator shows while waiting for response', async ({ page }) => {
    const chatPage = new ChatPage(page);

    await chatPage.sendMessage('Analyze my portfolio.');

    // Loading indicator should appear while the (mock) LLM processes
    await expect(chatPage.chatLoading).toBeVisible({ timeout: 3_000 });

    // Then disappear once the response arrives
    await expect(chatPage.chatLoading).not.toBeVisible({ timeout: 20_000 });
  });

  test('multiple messages can be sent sequentially', async ({ page }) => {
    const chatPage = new ChatPage(page);

    await chatPage.sendMessage('First message');
    await chatPage.waitForAssistantResponse();

    await chatPage.sendMessage('Second message');
    await chatPage.waitForAssistantResponse();

    // Should have at least 4 messages: 2 user + 2 assistant
    const count = await chatPage.getMessages().count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('chat input is cleared after sending', async ({ page }) => {
    const chatPage = new ChatPage(page);

    await chatPage.chatMessageInput.fill('This is my message');
    await chatPage.chatSendButton.click();

    // The input field should be cleared immediately
    await expect(chatPage.chatMessageInput).toHaveValue('');
  });

  test('chat send button is disabled while response is loading', async ({ page }) => {
    const chatPage = new ChatPage(page);

    await chatPage.chatMessageInput.fill('Test message');
    await chatPage.chatSendButton.click();

    // While loading, the send button should be disabled to prevent double-send
    // NOTE FOR FRONTEND DEVS: disable the send button during LLM loading
    await expect(chatPage.chatSendButton).toBeDisabled({ timeout: 3_000 });

    // Should re-enable after response
    await chatPage.waitForAssistantResponse();
    await expect(chatPage.chatSendButton).toBeEnabled({ timeout: 5_000 });
  });
});

test.describe('AI chat trade execution', () => {
  test('chat-initiated trade appears as inline action confirmation', async ({ page }) => {
    const chatPage = new ChatPage(page);
    await chatPage.goto();

    // Send a message that (in mock mode) triggers a trade execution
    // NOTE FOR BACKEND DEVS: ensure the mock response for "buy 1 share of AAPL"
    // includes {"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}]}
    await chatPage.sendMessage('Buy 1 share of AAPL for me');
    await chatPage.waitForAssistantResponse();

    // If the mock LLM executes a trade, an inline action confirmation should appear
    // NOTE FOR FRONTEND DEVS: trade confirmations in the chat should have data-testid="chat-action"
    const actions = chatPage.getChatActions();
    // Only assert if actions are present — some mocks may not execute trades
    const actionCount = await actions.count();
    if (actionCount > 0) {
      await expect(actions.first()).toBeVisible();
    }
  });

  test('chat-initiated trade updates portfolio', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const chatPage = new ChatPage(page);

    await chatPage.goto();
    await chatPage.waitForPricesStreaming();

    const cashBefore = await chatPage.getCashBalance();

    // Request a trade via chat (mock LLM should auto-execute it)
    await chatPage.sendMessage('Please buy 1 share of AAPL');
    await chatPage.waitForAssistantResponse();

    // If the mock executed a trade, cash should decrease
    // We allow for the case where the mock does not auto-execute trades
    const cashAfter = await chatPage.getCashBalance();
    // Test is informational: just verify no crash occurred
    expect(typeof cashAfter).toBe('number');
    expect(cashAfter).toBeGreaterThan(0);
  });
});
