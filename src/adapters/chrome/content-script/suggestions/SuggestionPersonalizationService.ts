import { CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT } from "@core/domain/constants";
import type { ContentScriptPersonalizationEventMessage } from "@core/domain/messageTypes";
import { randomUUID } from "@core/domain/randomId";
import type { SuggestionPersonalization } from "./types";

interface SuggestionPersonalizationServiceOptions {
  sendMessage?: (message: ContentScriptPersonalizationEventMessage, callback: () => void) => void;
  readLastError?: () => unknown;
  createEventId?: () => string;
}

export class SuggestionPersonalizationService implements SuggestionPersonalization {
  private readonly sendMessage: NonNullable<SuggestionPersonalizationServiceOptions["sendMessage"]>;
  private readonly readLastError: () => unknown;
  private readonly createEventId: () => string;

  constructor(options: SuggestionPersonalizationServiceOptions = {}) {
    this.sendMessage =
      options.sendMessage ??
      ((message, callback) => {
        chrome.runtime.sendMessage(message, callback);
      });
    this.readLastError = options.readLastError ?? (() => chrome.runtime.lastError);
    this.createEventId = options.createEventId ?? (() => `accept-${randomUUID()}`);
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
