import { CMD_CONTENT_SCRIPT_USAGE_EVENT } from "@core/domain/constants";
import type {
  ContentScriptUsageEventContext,
  ContentScriptUsageEventMessage,
} from "@core/domain/messageTypes";
import type { SuggestionTelemetry } from "./types";

interface SuggestionTelemetryServiceOptions {
  sendMessage?: (message: ContentScriptUsageEventMessage, callback: () => void) => void;
  readLastError?: () => unknown;
}

export class SuggestionTelemetryService implements SuggestionTelemetry {
  private readonly sendMessage: NonNullable<SuggestionTelemetryServiceOptions["sendMessage"]>;
  private readonly readLastError: () => unknown;

  constructor(options: SuggestionTelemetryServiceOptions = {}) {
    this.sendMessage =
      options.sendMessage ??
      ((message, callback) => {
        chrome.runtime.sendMessage(message, callback);
      });
    this.readLastError = options.readLastError ?? (() => chrome.runtime.lastError);
  }

  public recordSuggestionShown(args: { suggestionCount: number; language: string }): void {
    this.emitUsageEvent({
      eventType: "suggestion_shown",
      suggestionCount: args.suggestionCount,
      language: args.language,
    });
  }

  public recordSuggestionAccepted(args: {
    triggerText: string;
    insertedText: string;
    language: string;
  }): void {
    const typedTextLength = args.triggerText.length;
    const insertedTextLength = args.insertedText.length;

    this.emitUsageEvent({
      eventType: "suggestion_accepted",
      triggerText: args.triggerText,
      typedTextLength,
      insertedTextLength,
      language: args.language,
    });
    this.emitUsageEvent({
      eventType: "snippet_expanded",
      triggerText: args.triggerText,
      typedTextLength,
      insertedTextLength,
      language: args.language,
    });
    this.emitUsageEvent({
      eventType: "chars_inserted_from_snippet",
      amount: insertedTextLength,
      triggerText: args.triggerText,
      language: args.language,
    });
    this.emitUsageEvent({
      eventType: "chars_typed_for_trigger",
      amount: typedTextLength,
      triggerText: args.triggerText,
      language: args.language,
    });
  }

  private emitUsageEvent(context: ContentScriptUsageEventContext): void {
    try {
      this.sendMessage({ command: CMD_CONTENT_SCRIPT_USAGE_EVENT, context }, () => {
        try {
          void this.readLastError();
        } catch {
          // Ignore runtime teardown.
        }
      });
    } catch {
      // A suspended or reloading background must never break suggestions.
    }
  }
}
