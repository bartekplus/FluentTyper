import { type PhraseRow } from "../englishPhraseTables";
import type { RawFinding } from "../reviewDetectors";
import { table } from "./tables";

// Plain and informal English, all optional: wordy officialese, regional vocabulary under the
// dialect rules. The frames of rule en.plainStyle are in grammar/rules/en.yaml.

/** Optional tables with their own rules, indexed with the phrase corrections. */
export const OPTIONAL: readonly {
  rows: readonly PhraseRow[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}[] = [
  {
    rows: table("plainStyle.wordChoice"),
    ruleId: "styleWordChoice",
    messageKey: "review_msg_word_choice",
  },
  {
    rows: table("plainStyle.british"),
    ruleId: "englishBritishSpelling",
    messageKey: "review_msg_british_spelling",
  },
  {
    rows: table("plainStyle.american"),
    ruleId: "englishAmericanSpelling",
    messageKey: "review_msg_american_spelling",
  },
];
