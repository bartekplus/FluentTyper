import { expect, test } from "bun:test";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview, reviewOptions } from "./grammarTestUtils";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";

// Checks of english/remaining.ts and the leftovers it closed in other detectors. All sentences are our own.
const review = (text: string) =>
  runReview(text, {}, { enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics;

const positives: [CatalogRuleId, string, string][] = [
  // The end of the field closes the sentence in a full Review.
  [
    "englishPronounVerbWhitelistAgreement",
    "Mia left early. He forget",
    "Mia left early. He forgets",
  ],
  ["englishPronounVerbWhitelistAgreement", "We waited. They was", "We waited. They were"],
  ["englishModalOfCorrection", "I know we should of", "I know we should have"],
  ["englishModalOfCorrection", "They wouldn't of.", "They wouldn't have."],
  ["englishDoubledDegree", "Ours is the most best", "Ours is the best"],
  [
    "englishDoubledDegree",
    "My new bike is most better for hills.",
    "My new bike is better for hills.",
  ],
  ["englishDoubledDegree", "She ordered a most best seat.", "She ordered a best seat."],
  ["englishNounNumber", "She is one of the nurse", "She is one of the nurses"],
  [
    "englishNounNumber",
    "When one of the cable fails, call me.",
    "When one of the cables fails, call me.",
  ],
  // Soft line wraps inside a paragraph.
  ["englishRepeatedWords", "We fixed the\nthe gate.", "We fixed the gate."],
  [
    "englishPerfectParticiples",
    "They have\nplanning it all week.",
    "They're\nplanning it all week.",
  ],
  ["englishPerfectParticiples", "I wonder what you've doing.", "I wonder what you're doing."],
  // Detectors widened elsewhere.
  ["englishAuxiliaryBaseVerb", "I did tried open the jar.", "I did try open the jar."],
  ["englishConfusedWords", "Everyday is a struggle", "Every day is a struggle"],
  ["englishConfusedWords", "She finished later then us.", "She finished later than us."],
  [
    "englishTheirThereTheyAre",
    "We visited the farmers and there orchards.",
    "We visited the farmers and their orchards.",
  ],
  ["englishExistentialAgreement", "Were there explanation?", "Was there an explanation?"],
  [
    "englishFixedPrepositions",
    "Nothing moved since three days.",
    "Nothing moved since three days ago.",
  ],
  ["englishFixedPrepositions", "Nothing moved since three days.", "Nothing moved for three days."],
  ["englishPhraseCorrections", "Two rule-of-thumbs help here.", "Two rules-of-thumb help here."],
  ["stylePhrasing", "Please send an email to sales.", "Please email sales."],
  // remaining.ts
  ["englishFixedPrepositions", "Beware on the icy bridge.", "Beware of the icy bridge."],
  [
    "englishPhraseCorrections",
    "The staff resigned in mass last week.",
    "The staff resigned en masse last week.",
  ],
  [
    "englishPhraseCorrections",
    "Link lists store each node with a pointer.",
    "Linked lists store each node with a pointer.",
  ],
  [
    "englishPhraseCorrections",
    "Learn the part of speeches like nouns and verbs.",
    "Learn the parts of speech like nouns and verbs.",
  ],
  [
    "englishPhraseCorrections",
    "The bot scraps prices from shop pages.",
    "The bot scrapes prices from shop pages.",
  ],
  [
    "englishPhraseCorrections",
    "We scrapped the site's HTML overnight.",
    "We scraped the site's HTML overnight.",
  ],
  [
    "englishPhraseCorrections",
    "Open the dissemble window first.",
    "Open the disassembly window first.",
  ],
  [
    "stylePhrasing",
    "Kids imitate the accent from their parents.",
    "Kids imitate the accent of their parents.",
  ],
  ["stylePhrasing", "We must find out ways to save time.", "We must find ways to save time."],
];

test.each(positives)("%s repairs %s", (rule, source, expected) => {
  const findings = review(source).filter((d) => d.ruleId === rule);
  expect(findings.flatMap((d) => d.alternatives.map((a) => applyEdits(source, a.edits)))).toContain(
    expected,
  );
  expect(review(expected).filter((d) => d.ruleId === rule)).toEqual([]);
});

// [rule, text that is right, or that the rule leaves to the writer]
const negatives: [CatalogRuleId, string][] = [
  ["englishPronounVerbWhitelistAgreement", "Sam and I are"],
  ["englishPronounVerbWhitelistAgreement", "Hey you fools"],
  ["englishModalOfCorrection", "We felt the great might of."],
  ["englishModalOfCorrection", "She would of course."],
  ["englishDoubledDegree", "Most older readers liked it."],
  ["englishNounNumber", "Ask one of the people"],
  ["englishNounNumber", "Feed one of the sheep"],
  ["englishAuxiliaryBaseVerb", "They did needed repairs."],
  ["englishConfusedWords", "The everyday is often overlooked."],
  ["englishConfusedWords", "I met her earlier then him."],
  ["englishTheirThereTheyAre", "Go left and there you are."],
  ["englishExistentialAgreement", "Is there documentation?"],
  ["englishRepeatedWords", "the\nthe report"],
  ["englishPerfectParticiples", "That's what I have going on."],
  ["englishPerfectParticiples", "They have writing today."],
  ["englishFixedPrepositions", "Since three trains were late, we walked."],
  ["stylePhrasing", "Send an email to confirm."],
  ["englishFixedPrepositions", "Beware of the dog."],
  ["englishPhraseCorrections", "Gold differs in mass from lead."],
  ["englishPhraseCorrections", "They moved in mass transit."],
  ["englishPhraseCorrections", "The page has two link lists in its footer."],
  ["englishPhraseCorrections", "Parts of speeches were cut for time."],
  ["englishPhraseCorrections", "We scrapped the old website and started over."],
  ["englishPhraseCorrections", "They scrapped the data plan."],
  ["englishPhraseCorrections", "Do not dissemble about the delay."],
  ["stylePhrasing", "She imitates birds from the porch."],
  ["stylePhrasing", "We must find out what happened."],
  ["stylePhrasing", "You will find out the hard way."],
];

test.each(negatives)("%s leaves %s", (rule, text) => {
  expect(review(text).filter((d) => d.ruleId === rule)).toEqual([]);
});

// Typing-time proposals never judge the word at the caret, so the end-of-field
// findings above stay out of them until the writer moves on.
test.each(["Mia left early. He forget", "I know we should of", "She is one of the nurse"])(
  "live proposals wait at the caret: %s",
  (beforeCursor) => {
    expect(
      findLiveGrammarProposals(beforeCursor, {
        ...reviewOptions(),
        liveRules: DEFAULT_CURRENT_GRAMMAR_RULES,
      }),
    ).toEqual([]);
  },
);
