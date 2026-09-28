/**
 * The benchmark measures the shipped templates only. The earlier experimental
 * "v2" variant (distinct "original"/"text" keys, a worked example, the task
 * restated in the user turn) was adopted as prompt version review-ai-2 in
 * src/core/domain/grammar/review/ai/prompts.ts.
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
