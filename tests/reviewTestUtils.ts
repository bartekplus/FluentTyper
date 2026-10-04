import { jest } from "bun:test";
import {
  ReviewController,
  type ReviewControllerDependencies,
} from "../src/adapters/chrome/content-script/review/ReviewController";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";

export function createReviewController(
  overrides: Partial<ReviewControllerDependencies> = {},
): ReviewController {
  return new ReviewController({
    createEngine: () => new LocalReviewEngine(),
    getOptions: () => ({
      lang: "en_US",
      enabledRules: GRAMMAR_RULE_IDS,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    }),
    suspend: jest.fn(),
    resume: jest.fn(),
    addToDictionary: async () => true,
    getDocsSurface: () => null,
    uiLanguage: () => "en",
    ...overrides,
  });
}
