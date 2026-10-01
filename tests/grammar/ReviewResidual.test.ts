import { expect, test } from "bun:test";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/types";

// The residual pass of english/remaining.ts (plus its rows in dialects.ts, lexical.ts and
// styleAdvice.ts). All sentences are our own.
function review(text: string, enabledRules: readonly string[] = REVIEW_SUPPORTED_RULE_IDS) {
  return detectReviewDiagnostics(
    { id: "residual", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: [...enabledRules],
      lang: "en_US",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
}

const positives: [CatalogRuleId, string, string][] = [
  // Fixed phrases behind scare quotes, quoted speech, a closed named example or a soft wrap.
  [
    "englishPhraseCorrections",
    'Her "tongue and cheek" remarks amused us.',
    'Her "tongue in cheek" remarks amused us.',
  ],
  [
    "englishClosedCompounds",
    'Sailors who settle abroad are "ex pats" to some.',
    'Sailors who settle abroad are "expats" to some.',
  ],
  [
    "englishPhraseCorrections",
    'She replied, "once a twice" at most.',
    'She replied, "once or twice" at most.',
  ],
  [
    "englishPhraseCorrections",
    'The title "Nova" is inspired from an old song.',
    'The title "Nova" is inspired by an old song.',
  ],
  ["englishClosedCompounds", "Please double\nclick the icon.", "Please double-click the icon."],
  ["stylePhrasing", "I would argue\nthat the plan works.", "the plan works."],
  // Names: shouted ones are optional advice.
  ["stylePhrasing", "WELCOME TO NEW YORK", "WELCOME TO New York"],
  [
    "englishCanonicalCasing",
    "Add the chrome extension to your browser.",
    "Add the Chrome extension to your browser.",
  ],
  [
    "englishCanonicalCasing",
    "I write in day one, my favourite journal app.",
    "I write in Day One, my favourite journal app.",
  ],
  ["englishCanonicalCasing", "MacOS updates arrive in autumn.", "macOS updates arrive in autumn."],
  [
    "englishCanonicalCasing",
    "Our blog runs on wordpress.com today.",
    "Our blog runs on WordPress.com today.",
  ],
  // Words on the left of a slash.
  [
    "englishClosedCompounds",
    "Is the dialog infront/behind the page?",
    "Is the dialog in front/behind the page?",
  ],
  ["englishConfusedWords", "We were bias/unfair at first.", "We were biased/unfair at first."],
  ["styleWordChoice", "List the dirs/subdirs first.", "List the directories/subdirs first."],
  ["styleWordChoice", "A deref/load pair is cheap.", "A dereference/load pair is cheap."],
  ["styleWordChoice", "Create two dirs first.", "Create two directories first."],
  [
    "englishPhraseCorrections",
    "Learn to assemble/dissemble an engine.",
    "Learn to assemble/disassemble an engine.",
  ],
  ["stylePhrasing", "It is a chicken/egg problem.", "It is a chicken-and-egg problem."],
  // Context checks.
  ["englishTheirThereTheyAre", "Was that there cat?", "Was that their cat?"],
  [
    "englishTheirThereTheyAre",
    "We saw their walking across the bridge.",
    "We saw them walking across the bridge.",
  ],
  ["englishArticleAnCorrection", "Publish it as a npm package.", "Publish it as an npm package."],
  ["englishIrregularForms", "The plugin was broke in 2.1.0.", "The plugin was broken in 2.1.0."],
  ["englishConfusedWords", "That rule effects team spirit.", "That rule affects team spirit."],
  ["englishPhraseCorrections", "My WebScrapper collects prices.", "My WebScraper collects prices."],
  [
    "englishPhraseCorrections",
    "The Python crawler is scrapping several websites nightly.",
    "The Python crawler is scraping several websites nightly.",
  ],
  ["englishClosedCompounds", "Each guest (s) must sign.", "Each guest(s) must sign."],
  ["englishClosedCompounds", "List the file(ss) here.", "List the file(s) here."],
  ["englishVerbComplements", "We agreed meet at noon.", "We agreed to meet at noon."],
  ["englishPossibleErrors", "We waited on the trainplatform.", "We waited on the train platform."],
  ["englishPossibleErrors", "She drank applejuice.", "She drank apple juice."],
  // Optional style and dialect advice.
  ["stylePhrasing", "Can you find out the cause?", "Can you find the cause?"],
  ["stylePhrasing", "We talked a while, then left.", "We talked awhile, then left."],
  ["stylePhrasing", "Our CYBERSEC budget grew.", "Our CYBERSECURITY budget grew."],
  [
    "stylePhrasing",
    "We built an infrastructure for testing.",
    "We built infrastructure for testing.",
  ],
  [
    "stylePhrasing",
    "This could be constituted as a breach.",
    "This could be construed as a breach.",
  ],
  [
    "englishAmericanSpelling",
    "The plan is benefitting everyone.",
    "The plan is benefiting everyone.",
  ],
  ["styleRedundancy", "Old ATM machines break.", "Old ATMs break."],
  ["styleRedundancy", "OLD VIN NUMBERS", "OLD VINs"],
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
  // Quotations that name their words.
  ["englishPhraseCorrections", 'The phrase "tongue and cheek" is a common slip.'],
  ["englishPhraseCorrections", 'Fix "tongue and cheek" → "tongue in cheek" in the draft.'],
  ["englishClosedCompounds", "Double\n\nclick here."],
  // Capitals, names and their look-alikes.
  ["stylePhrasing", "NASA LAUNCHED IT"],
  ["englishCanonicalCasing", "WELCOME TO NEW YORK"],
  ["englishCanonicalCasing", "The Chrome extension is ready."],
  ["englishCanonicalCasing", "On day one we met the team."],
  ["englishCanonicalCasing", "See https://wordpress.com/start for details."],
  ["englishConfusedWords", "Check the bias/variance tradeoff."],
  ["englishTheirThereTheyAre", "Is that there now?"],
  ["englishTheirThereTheyAre", "We admired their singing in the hall."],
  ["englishArticleAnCorrection", "Run an npm script."],
  ["englishIrregularForms", "We were broke in 2010."],
  ["englishConfusedWords", "This policy effects change."],
  ["englishPhraseCorrections", "We are scrapping several websites and starting over."],
  ["englishClosedCompounds", "Choose option (b) now."],
  ["englishVerbComplements", "They agreed long ago."],
  ["englishVerbComplements", "We decided work was fun."],
  ["englishAlotCorrection", "The webhooks fired after the codebase grew."],
  ["englishAlotCorrection", "Stop quarrelling about the gaspumps."],
  ["stylePhrasing", "Find out what happened."],
  ["stylePhrasing", "It took a while."],
];

test.each(negatives)("%s leaves %s", (rule, text) => {
  expect(review(text).filter((d) => d.ruleId === rule)).toEqual([]);
});

test("optional advice stays out of the default rules", () => {
  const defaults = reviewRuleIds({ codeMode: false });
  for (const text of [
    "WELCOME TO NEW YORK",
    "Can you find out the cause?",
    "Old ATM machines break.",
    "We talked a while, then left.",
  ])
    expect(review(text, defaults)).toEqual([]);
});
