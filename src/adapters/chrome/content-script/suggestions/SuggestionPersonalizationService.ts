import { CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT } from "@core/domain/constants";
import type { ContentScriptPersonalizationEventMessage } from "@core/domain/messageTypes";
import type { SuggestionPersonalization } from "./types";

interface SuggestionPersonalizationServiceOptions {
  sendMessage?: (message: ContentScriptPersonalizationEventMessage, callback: () => void) => void;
  readLastError?: () => unknown;
  createEventId?: () => string;
}

export class SuggestionPersonalizationService implements SuggestionPersonalization {
  private readonly sendMessage: NonNullable<SuggestionPersonalizationServiceOptions["sendMessage"]>;
  private readonly readLastError: NonNullable<
    SuggestionPersonalizationServiceOptions["readLastError"]
  >;
  private readonly createEventId: NonNullable<
    SuggestionPersonalizationServiceOptions["createEventId"]
  >;

  constructor(options: SuggestionPersonalizationServiceOptions = {}) {
    this.sendMessage =
      options.sendMessage ??
      ((message, callback) => {
        chrome.runtime.sendMessage(message, callback);
      });
    this.readLastError = options.readLastError ?? (() => chrome.runtime.lastError);
    this.createEventId = options.createEventId ?? generateEventId;
  }

  recordSuggestionAccepted(args: {
    suggestion: string;
    triggerText: string;
    language: string;
  }): string {
    const eventId = this.createEventId();
    this.emit({
      command: CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
      context: {
        eventType: "suggestion_accepted",
        eventId,
        suggestion: args.suggestion,
        triggerText: args.triggerText,
        language: args.language,
      },
    });
    return eventId;
  }

  recordSuggestionReverted(eventId: string): void {
    this.emit({
      command: CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
      context: {
        eventType: "suggestion_reverted",
        eventId,
      },
    });
  }

  private emit(message: ContentScriptPersonalizationEventMessage): void {
    try {
      this.sendMessage(message, () => {
        try {
          void this.readLastError();
        } catch {
          // Ignore runtime teardown.
        }
      });
    } catch {
      // A suspended or reloading background must never break suggestion acceptance.
    }
  }
}

function generateEventId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `accept-${value}`;
}
