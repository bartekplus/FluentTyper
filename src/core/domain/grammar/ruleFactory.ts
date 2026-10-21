import type { GrammarRule } from "./types";
import { createLiveRules } from "./engine/liveRules";

/** The typing rules of grammar/rules/*.yaml, in priority order. */
export function createGrammarRuleCatalogRuntime(options: {
  insertSpaceAfterAutocomplete: boolean;
}): GrammarRule[] {
  return createLiveRules(options);
}
