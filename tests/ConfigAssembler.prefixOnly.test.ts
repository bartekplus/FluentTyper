import { ConfigAssembler } from "../src/adapters/chrome/background/config/ConfigAssembler";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    set: async () => undefined,
  } as unknown as SettingsManager;
}

describe("ConfigAssembler.assemblePredictionRuntimeConfig prefixOnlyMode", () => {
  const baseSettings: Record<string, unknown> = {
    language: "en_US",
    enabled_languages: ["en_US"],
    numSuggestions: 5,
    minWordLengthToPredict: 1,
    insertSpaceAfterAutocomplete: true,
    enabledGrammarRules: [],
    textExpansions: [],
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    aiPredictorEnabled: false,
    aiModelId: "",
    aiPredictionTimeoutMs: 120,
    debugPresagePredictorEnabled: true,
    debugAiPredictorEnabled: true,
  };

  test("prefixOnlyMode=false, inlineSuggestion=false → false", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: false,
      inline_suggestion: false,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(false);
  });

  test("prefixOnlyMode=true, inlineSuggestion=false → true", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: true,
      inline_suggestion: false,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(true);
  });

  test("prefixOnlyMode=false, inlineSuggestion=true → true (forced by inline)", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: false,
      inline_suggestion: true,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(true);
  });
});
