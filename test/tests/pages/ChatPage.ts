import { Page, Locator, expect } from '@playwright/test';
import { AppPage } from './AppPage';

/**
 * Page object for the AI chat panel interactions.
 *
 * NOTE FOR FRONTEND DEVS: Required data-testid attributes:
 * - data-testid="chat-panel"             — the chat panel container
 * - data-testid="chat-message-input"     — the text input for typing a message
 * - data-testid="chat-send-button"       — the send button
 * - data-testid="chat-message"           — each message bubble in the conversation (multiple)
 * - data-testid="chat-message-user"      — user message bubble(s)
 * - data-testid="chat-message-assistant" — assistant message bubble(s)
 * - data-testid="chat-loading"           — loading indicator shown while awaiting LLM response
 * - data-testid="chat-action"            — inline trade/watchlist action confirmations (multiple)
 */
export class ChatPage extends AppPage {
  readonly chatPanel: Locator;
  readonly chatMessageInput: Locator;
  readonly chatSendButton: Locator;
  readonly chatLoading: Locator;

  constructor(page: Page) {
    super(page);
    this.chatPanel = page.getByTestId('chat-panel');
    this.chatMessageInput = page.getByTestId('chat-message-input');
    this.chatSendButton = page.getByTestId('chat-send-button');
    this.chatLoading = page.getByTestId('chat-loading');
  }

  /** Returns all message bubbles (both user and assistant). */
  getMessages(): Locator {
    return this.page.getByTestId('chat-message');
  }

  /** Returns only user message bubbles. */
  getUserMessages(): Locator {
    return this.page.getByTestId('chat-message-user');
  }

  /** Returns only assistant message bubbles. */
  getAssistantMessages(): Locator {
    return this.page.getByTestId('chat-message-assistant');
  }

  /** Returns inline action confirmations (e.g., "Bought 10 AAPL"). */
  getChatActions(): Locator {
    return this.page.getByTestId('chat-action');
  }

  /** Types a message into the input and clicks Send. */
  async sendMessage(message: string) {
    await this.chatMessageInput.fill(message);
    await this.chatSendButton.click();
  }

  /**
   * Waits until the loading indicator appears (response in progress),
   * then disappears (response complete).
   */
  async waitForResponse(timeout = 20_000) {
    // Loading indicator should appear shortly after sending
    await expect(this.chatLoading).toBeVisible({ timeout: 5_000 });
    // Then disappear once the response arrives
    await expect(this.chatLoading).not.toBeVisible({ timeout });
  }

  /** Waits until at least one assistant message is visible. */
  async waitForAssistantResponse(timeout = 20_000) {
    await expect(this.getAssistantMessages().first()).toBeVisible({ timeout });
  }

  /** Returns the text content of the last assistant message. */
  async getLastAssistantMessageText(): Promise<string> {
    const messages = this.getAssistantMessages();
    const count = await messages.count();
    if (count === 0) return '';
    return (await messages.nth(count - 1).textContent()) ?? '';
  }
}
