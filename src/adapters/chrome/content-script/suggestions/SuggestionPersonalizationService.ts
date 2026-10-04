import { CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT } from "@core/domain/constants";
import type { ContentScriptPersonalizationEventMessage } from "@core/domain/messageTypes";
import { randomUUID } from "@core/domain/randomId";
import { sendFireAndForget } from "./sendFireAndForget";
import type { SuggestionPersonalization } from "./types";

interface SuggestionPersonalizationServiceOptions {
  sendMessage?: (message: ContentScriptPersonalizationEventMessage, callback: () => void) => void;
  readLastError?: () => unknown;
}

export class SuggestionPersonalizationService implements SuggestionPersonalization {
  constructor(private readonly options: SuggestionPersonalizationServiceOptions = {}) {}

  recordSuggestionAccepted(args: {
    suggestion: string;
    triggerText: string;
    language: string;
  }): string {
    const eventId = `accept-${randomUUID()}`;
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
    sendFireAndForget(message, this.options.sendMessage, this.options.readLastError);
  }
}
