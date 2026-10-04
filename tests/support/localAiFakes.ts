import { jest } from "bun:test";
import { LOCAL_AI_REVIEW_PORT, type LocalAiStatus } from "../../src/core/domain/contracts/localAi";

export function readyStatus(overrides: Partial<LocalAiStatus> = {}): LocalAiStatus {
  return {
    enabled: true,
    consented: true,
    tier: "standard",
    modelId: "model-a",
    displayName: "Standard",
    downloadBytes: 1,
    install: "complete",
    runtime: "ready",
    offerSetup: false,
    ...overrides,
  };
}

export class FakePort {
  messages: Array<Record<string, unknown>> = [];
  disconnected = false;
  disconnect = jest.fn(() => {
    this.disconnected = true;
  });
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];
  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.messageListeners.push(listener),
  };
  onDisconnect = { addListener: (listener: () => void) => this.disconnectListeners.push(listener) };

  constructor(
    readonly name: string = LOCAL_AI_REVIEW_PORT,
    readonly sender: chrome.runtime.MessageSender = {},
  ) {}

  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>);
  }

  /** A message from the other side. */
  emit(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  /** The other side went away. */
  close(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }

  results(): Array<Record<string, unknown>> {
    return this.messages.filter((message) => message.type === "result");
  }

  lastRequestId(): string {
    return this.messages.filter((message) => message.type === "generate").at(-1)!
      .requestId as string;
  }
}
