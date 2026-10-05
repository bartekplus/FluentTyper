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

/** Waits until `predicate` is true. A React test passes a `wait` that runs in act(). */
export async function until(
  predicate: () => boolean,
  timeoutMs = 1000,
  wait: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<void> {
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += 5) {
    if (predicate()) return;
    await wait(5);
  }
  if (!predicate()) throw new Error("condition not reached");
}
