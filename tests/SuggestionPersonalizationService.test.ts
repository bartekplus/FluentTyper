import { jest } from "bun:test";
import { SuggestionPersonalizationService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPersonalizationService";
import { CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT } from "../src/core/domain/constants";

describe("SuggestionPersonalizationService", () => {
  test("emits minimal accepted and reverted events with the same event ID", () => {
    const sendMessage = jest.fn((_, callback: () => void) => callback());
    const service = new SuggestionPersonalizationService({
      sendMessage,
      readLastError: () => undefined,
    });

    const eventId = service.recordSuggestionAccepted({
      suggestion: "hello",
      triggerText: "hel",
      language: "en_US",
    });
    service.recordSuggestionReverted(eventId);

    expect(eventId).toMatch(/^accept-./);
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        command: CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
        context: {
          eventType: "suggestion_accepted",
          eventId,
          suggestion: "hello",
          triggerText: "hel",
          language: "en_US",
        },
      },
      {
        command: CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
        context: {
          eventType: "suggestion_reverted",
          eventId,
        },
      },
    ]);
  });

  test("never breaks acceptance when runtime messaging is unavailable", () => {
    const service = new SuggestionPersonalizationService({
      sendMessage: () => {
        throw new Error("runtime unavailable");
      },
    });

    expect(() =>
      service.recordSuggestionAccepted({
        suggestion: "hello",
        triggerText: "hel",
        language: "en_US",
      }),
    ).not.toThrow();
  });
});
