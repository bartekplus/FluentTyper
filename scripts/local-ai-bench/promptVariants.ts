/**
 * The benchmark measures the shipped templates only
 * (src/core/domain/grammar/review/ai/prompts.ts). Earlier experiments were
 * adopted there: "v2" as review-ai-2, "fixall" as the Correct prompt of review-ai-3.
 */
import {
  buildAiMessages,
  type AiChatMessage,
} from "../../src/core/domain/grammar/review/ai/prompts";
import type { AiGenerationRequest } from "../../src/core/domain/grammar/review/ai/types";

export type PromptVariant = "product";

export function variantMessages(
  _variant: PromptVariant,
  request: AiGenerationRequest,
): AiChatMessage[] {
  return buildAiMessages(request);
}
