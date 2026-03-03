import { describe, expect, jest, test } from "bun:test";
import { CMD_CONTENT_SCRIPT_USAGE_EVENT } from "../src/core/domain/constants";
import { SuggestionTelemetryService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTelemetryService";

describe("SuggestionTelemetryService", () => {
  test("emits suggestion_shown usage event", () => {
    const readLastError = jest.fn(() => undefined);
    const sendMessage = jest.fn((_, callback: () => void) => {
      callback();
    });
    const service = new SuggestionTelemetryService({
      sendMessage,
      readLastError,
    });

    service.recordSuggestionShown({
      suggestionCount: 3,
      language: "en_US",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "suggestion_shown",
          suggestionCount: 3,
          language: "en_US",
        },
      },
      expect.any(Function),
    );
    expect(readLastError).toHaveBeenCalledTimes(1);
  });

  test("emits full accepted telemetry bundle", () => {
    const sendMessage = jest.fn((_, callback: () => void) => {
      callback();
    });
    const service = new SuggestionTelemetryService({
      sendMessage,
      readLastError: () => undefined,
    });

    service.recordSuggestionAccepted({
      triggerText: "fun",
      insertedText: "functionality ",
      language: "en_US",
    });

    expect(sendMessage).toHaveBeenCalledTimes(4);
    const sentMessages = sendMessage.mock.calls.map((call) => call[0]);
    expect(sentMessages).toEqual([
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "suggestion_accepted",
          triggerText: "fun",
          typedTextLength: 3,
          insertedTextLength: 14,
          language: "en_US",
        },
      },
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "snippet_expanded",
          triggerText: "fun",
          typedTextLength: 3,
          insertedTextLength: 14,
          language: "en_US",
        },
      },
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "chars_inserted_from_snippet",
          amount: 14,
          triggerText: "fun",
          language: "en_US",
        },
      },
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "chars_typed_for_trigger",
          amount: 3,
          triggerText: "fun",
          language: "en_US",
        },
      },
    ]);
  });
});
