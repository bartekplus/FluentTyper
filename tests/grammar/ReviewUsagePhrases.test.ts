import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const rule = "englishUsagePhrases";
function all(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    {
      id: "phrases",
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: [],
      ...extra,
    },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  ).diagnostics;
}
const scan = (text: string) => all(text).filter((d) => d.ruleId === rule);
const repairs: [string, string][] = [
  [
    "For all intensive purposes, the test is complete.",
    "For all intents and purposes, the test is complete.",
  ],
  [
    "For all intensive purposes, this project is finished.",
    "For all intents and purposes, this project is finished.",
  ],
  [
    "For all intensive purposes, that work was ready.",
    "For all intents and purposes, that work was ready.",
  ],
  [
    "For all intensive purposes, the task is done.",
    "For all intents and purposes, the task is done.",
  ],
  [
    "For all intensive purposes, the report was final.",
    "For all intents and purposes, the report was final.",
  ],
  [
    "For all intensive purposes, this plan is successful.",
    "For all intents and purposes, this plan is successful.",
  ],
  [
    "For all intensive purposes, the design is complete.",
    "For all intents and purposes, the design is complete.",
  ],
  [
    "For all intensive purposes, the review was finished.",
    "For all intents and purposes, the review was finished.",
  ],
  [
    "For all intensive purposes, this process is ready.",
    "For all intents and purposes, this process is ready.",
  ],
  [
    "For all intensive purposes, that document is done.",
    "For all intents and purposes, that document is done.",
  ],
  [
    "For all intensive purposes, the proposal is final.",
    "For all intents and purposes, the proposal is final.",
  ],
  [
    "For all intensive purposes, the update was successful.",
    "For all intents and purposes, the update was successful.",
  ],
  ["They are one in the same.", "They are one and the same."],
  ["We were one in the same.", "We were one and the same."],
  ["These are one in the same.", "These are one and the same."],
  ["Those were one in the same.", "Those were one and the same."],
  ["The two things are one in the same.", "The two things are one and the same."],
  ["These two people were one in the same.", "These two people were one and the same."],
  ["Those two files are one in the same.", "Those two files are one and the same."],
  ["The two documents were one in the same.", "The two documents were one and the same."],
  ["These two reports are one in the same.", "These two reports are one and the same."],
  ["Those two plans were one in the same.", "Those two plans were one and the same."],
  ["The two ideas are one in the same.", "The two ideas are one and the same."],
  ["These two options were one in the same.", "These two options were one and the same."],
  ["That feature peaked my interest.", "That feature piqued my interest."],
  ["This idea peaks your interest.", "This idea piques your interest."],
  ["The story can peak his interest.", "The story can pique his interest."],
  ["That proposal is peaking her interest.", "That proposal is piquing her interest."],
  ["The question peaked our interest.", "The question piqued our interest."],
  ["This book peaks their interest.", "This book piques their interest."],
  ["The article will peak my interest.", "The article will pique my interest."],
  ["The design was peaking your interest.", "The design was piquing your interest."],
  ["The project could peak his interest.", "The project could pique his interest."],
  ["That topic should peak her interest.", "That topic should pique her interest."],
  ["It may peak our interest.", "It may pique our interest."],
  ["The new feature might peak their interest.", "The new feature might pique their interest."],
];
test.each(repairs)("usage phrases repair %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
const valid = [
  "For all intents and purposes, the test is complete.",
  'The phrase "for all intensive purposes" is incorrect.',
  "For all intensive purposes in the clinic, use this room.",
  "The drug is suitable for all intensive purposes.",
  "For all intensive purposes, use the equipment.",
  "For all intensive purposes",
  "For all intensive purposes, the test",
  "For all intensive purposes, an unknownword is ready.",
  "For all intensive purposes; the test is complete.",
  "For all intensive purposes, the test is completeMode.",
  "For all intensive purposes, the test is complete.example",
  "For all intensive purposes, the test is completé.",
  "For all intensive purposes,\nthe test is complete.",
  "For all\nintensive purposes, the test is complete.",
  "For all intensive_purposes, the test is complete.",
  "For all inTensive purposes, the test is complete.",
  "For all `intensive` purposes, the test is complete.",
  "`For all intensive purposes, the test is complete.`",
  'Write "For all intensive purposes, the test is complete." exactly.',
  'The heading "For all intensive purposes, the test is complete." is reproduced.',
  'The label is "For all intensive purposes, the test is complete."',
  "This is a deliberate metaphor: for all intensive purposes, the test is complete.",
  "It is a deliberately invented metaphor.",
  "The phrase for all intensive purposes is being discussed.",
  "They are one and the same.",
  "There was one in the same room.",
  "I found one in the same box.",
  "We placed one in the same folder.",
  "There is one in the same category.",
  "They are one in the same room.",
  "They are one in the same group.",
  "We were one in the same class.",
  "One in the same",
  "The one in the same room is mine.",
  "They are one in the sameThing.",
  "They are one in the same.example",
  "They are one in the samé.",
  "They are one in\nthe same.",
  "They are one in the `same`.",
  "They are one iN the same.",
  'Write "They are one in the same." exactly.',
  'The term "They are one in the same." is quoted.',
  'The title is "They are one in the same."',
  'The dialect uses "They are one in the same."',
  "A creative description: they are one in the same.",
  "They may be one in the same room.",
  "One was in the same room as the other.",
  "These things are one in the same category.",
  "Demand peaked in May.",
  "My interest peaked last year.",
  "Her interest peaks every spring.",
  "Their interest is peaking now.",
  "That feature piqued my interest.",
  "This idea piques your interest.",
  "The design was piquing our interest.",
  "This book can pique his interest.",
  "The mountain peaked above the clouds.",
  "The graph peaked at ten.",
  "The word peaked describes a maximum.",
  "The peak of my interest was last year.",
  "That feature peaked",
  "That feature peaked my",
  "That feature peaked my interest rate.",
  "That feature peaked my interestIndex.",
  "That feature peaked my interest.example",
  "That feature peaked my interest́.",
  "That feature peaKed my interest.",
  "That feature peaked\nmy interest.",
  "That feature `peaked` my interest.",
  'The example "That feature peaked my interest." is incorrect.',
  'The label is "That feature peaked my interest."',
  "A poetic metaphor: that feature peaked my interest.",
];
test.each(valid)("usage phrases preserve %s", (text) => expect(scan(text)).toEqual([]));
test("usage phrases preserve case, tense, possessives and protected evidence", () => {
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
  for (const [text] of [repairs[0], repairs[12], repairs[24]]) {
    const d = scan(text)[0];
    const only = (extra: Partial<ReviewSourceSnapshot>, options: Partial<ReviewOptions> = {}) =>
      all(text, extra, { enabledRules: [rule], ...options });
    expect(only({}, { lang: "fr_FR" })).toEqual([]);
    expect(only({}, { userDictionary: [d.original] })).toEqual([]);
    expect(only({ protectedRanges: [{ ...d.range, reason: "structure" }] })).toEqual([]);
    expect(only({ scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
    expect(only({ scope: d.range })).toHaveLength(1);
    const upper = text.toUpperCase();
    const ud = scan(upper)[0];
    expect(applyEdits(upper, ud.alternatives[0].edits)).toBe(
      repairs.find(([s]) => s === text)![1].toUpperCase(),
    );
  }
  expect(scan("They are one\uFFFC in the same.")).toEqual([]);
  const text = "They are one\t in\u00a0the same.";
  const d = scan(text)[0];
  expect(applyEdits(text, d.alternatives[0].edits)).toBe("They are one\t and\u00a0the same.");
});
test("usage phrase offsets belong to one chunk in ordinary quoted Unicode prose", () => {
  const text = '😀 Café.\r\nShe said, "They are one in the same." That feature peaked my interest.';
  const prepared = prepareReview(
    { id: "chunks", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules: [rule], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  const expected = scan(text);
  expect(expected).toHaveLength(2);
  for (let cut = 1; cut < text.length; cut++) {
    const raw = [
      ...scanReviewChunk(prepared, { start: 0, end: cut }).findings,
      ...scanReviewChunk(prepared, { start: cut, end: text.length }).findings,
    ].sort((a, b) => a.range.start - b.range.start);
    expect(raw.map((d) => [d.range, text.slice(d.range.start, d.range.end)])).toEqual(
      expected.map((d) => [d.range, d.original]),
    );
  }
});

test.each([
  ["I updated it few hours ago.", "I updated it a few hours ago."],
  ["Few weeks ago, it broke.", "A few weeks ago, it broke."],
  ["It worked just few days ago.", "It worked just a few days ago."],
])("few + time + ago gains its article: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
test.each([
  "It happened a few days ago.",
  "Only few days ago did it work.",
  "Very few years ago was it common.",
  "The last few weeks ago were busy.",
  "Few people came.",
])("few + time preserves %s", (text) => expect(scan(text)).toEqual([]));

test.each([
  ["I didn't have no idea.", "I didn't have any idea."],
  ["She doesn't need no help from us.", "She doesn't need any help from us."],
  ["We did not see no signs of it.", "We did not see any signs of it."],
])("a negated verb takes any, not no: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
test.each([
  "We didn't take no for an answer.",
  "I can't say no to her.",
  "It doesn't make no sense-less claims.",
  "I don't have no-code tools.",
  "They don't have no one to ask.",
  "It doesn't matter.",
  "I have no idea.",
])("double negatives preserve %s", (text) => expect(scan(text)).toEqual([]));

test.each([
  ["I new it was true.", "I knew it was true."],
  ["She new that already.", "She knew that already."],
  ["Done. They new what to do.", "Done. They knew what to do."],
  ["We new about the delay.", "We knew about the delay."],
  ["He new better.", "He knew better."],
  ["Then I new it.", "Then I knew it."],
  ["I new you were right.", "I knew you were right."],
  ["He always new the way.", "He always knew the way."],
  ["Things I new were wrong.", "Things I knew were wrong."],
  ["She new trouble followed us.", "She knew trouble followed us."],
  ["It new nothing.", "It knew nothing."],
])("a clause-initial pronoun + new + clause means knew: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
test.each([
  "Am I new here?",
  "I'm new.",
  "I, new to this, asked.",
  "We new hires start Monday.",
  "Is she new to the team?",
  "He was old and she new.",
  "Was he new?",
  "Make it new.",
  "Aren't they new here?",
  "We met them and they New Yorkers loved it.",
  "Do you think they new hires are ready?",
  "It is new to me.",
  "They are new that way.",
  "You new users can sign in.",
])("new as an adjective preserves %s", (text) => expect(scan(text)).toEqual([]));
