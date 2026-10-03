import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import {
  EnglishPronounVerbWhitelistAgreementRule,
  AGREEMENT_CORRECTIONS,
} from "../../src/core/domain/grammar/implementations/EnglishPronounVerbWhitelistAgreementRule";
import { knownEnglishNounNumber } from "../../src/core/domain/grammar/implementations/helpers/EnglishNounNumber";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

const pronoun = "englishPronounVerbWhitelistAgreement";
const existential = "englishExistentialAgreement";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    { id: "agreement", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  ).diagnostics;
}
const only = (text: string, rule: typeof pronoun | typeof existential) =>
  scan(text).filter((d) => d.ruleId === rule);

const pronounErrors: [string, string][] = [
  ["They has the updated files.", "They have the updated files."],
  ["We was ready.", "We were ready."],
  ["She have a new keyboard.", "She has a new keyboard."],
  ["You has a message.", "You have a message."],
  ["He do the work.", "He does the work."],
  ["It have a key.", "It has a key."],
  ["They does not know.", "They do not know."],
  ["We is not alone.", "We are not alone."],
  ["You does the dishes.", "You do the dishes."],
  ["She were late.", "She was late."],
  ["He have already left.", "He has already left."],
  ["It were broken.", "It was broken."],
  ["They always has time.", "They always have time."],
  ["We never does that.", "We never do that."],
  ["She still have the old file.", "She still has the old file."],
  ["You really was late.", "You really were late."],
  ["He still are here.", "He still is here."],
  ["They was not available.", "They were not available."],
];
const existentialErrors: [string, string][] = [
  ["There is two errors in the report.", "There are two errors in the report."],
  ["There are a problem.", "There is a problem."],
  ["There is three files in the folder.", "There are three files in the folder."],
  ["There are one document on the desk.", "There is one document on the desk."],
  ["There is four missing keys.", "There are four missing keys."],
  ["There are an updated report.", "There is an updated report."],
  ["There is five new accounts.", "There are five new accounts."],
  ["There are 1 answer.", "There is 1 answer."],
  ["There is 12 messages on the screen.", "There are 12 messages on the screen."],
  ["There are a large keyboard.", "There is a large keyboard."],
  ["There is zero options.", "There are zero options."],
  ["There is two children in the room.", "There are two children in the room."],
  ["There is three people near the table.", "There are three people near the table."],
  ["There is not two mice under the desk.", "There are not two mice under the desk."],
];
for (const [rule, cases] of [
  [pronoun, pronounErrors],
  [existential, existentialErrors],
] as const) {
  test.each(cases)(`${rule} repairs %s`, (source, expected) => {
    const findings = only(source, rule);
    expect(findings).toHaveLength(1);
    const d = findings[0];
    expect(d.original).toBe(source.slice(d.range.start, d.range.end));
    expect(d.alternatives[0].edits).toHaveLength(1);
    expect(d.bulk.eligible).toBe(false);
    expect(d.context.start).toBeLessThan(d.range.start);
    expect(d.context.end).toBeGreaterThan(d.range.end);
    expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
    expect(only(expected, rule)).toEqual([]);
  });
}

const pronounValid = [
  "Everything I told you was a lie.",
  "They said that the team was ready.",
  "The news is good.",
  "You and I are ready.",
  "The team are discussing it.",
  'The word "they" has four letters.',
  "She and he have keys.",
  "You or she has the key.",
  "They as well as she have keys.",
  "Meeting you was wonderful.",
  "The present for you was expensive.",
  "Seeing it was a relief.",
  "What we gave you was useful.",
  "They have the updated files.",
  "We were ready.",
  "She has a new keyboard.",
  "He does the work.",
  "It has a key.",
  "They do not know.",
  "We are not alone.",
  "You do the dishes.",
  "She was late.",
  "They always have time.",
  "We never do that.",
  "If she were ready, we would leave.",
  "I suggest she have a break.",
  "It is essential that he do this.",
  "May they have peace.",
  "He might have left.",
  'Do not write "They has the updated files.".',
  'The example "We was ready." is wrong.',
  "They `has` the files.",
  "We\nwas ready.",
  "She have.file access.",
  "They has_items ready.",
  "We waś ready.",
  "We Was Productions made it.",
  "They have and use it.",
];
const existentialValid = [
  "There is a problem and a possible solution.",
  "There are a problem and two solutions.",
  "There are a problem\nand two solutions.",
  "There is two errors and one warning.",
  "There is two errors or one problem.",
  "There are a problem, a file and a key.",
  "There is two errors in the report and one in the file.",
  "There is a team.",
  "There are a team.",
  "There is one sheep.",
  "There are two sheep.",
  "There is one series.",
  "There are two series.",
  "There is news.",
  "There are two police.",
  "There is one staff.",
  "There is a problem.",
  "There are two errors in the report.",
  "There are three files in the folder.",
  "There is one document on the desk.",
  "There are four missing keys.",
  "There is an updated report.",
  "There are five new accounts.",
  "There are two children in the room.",
  "There are not two mice under the desk.",
  "There are two error.",
  "There is one errors.",
  "There are a errors.",
  "There is two unknownwords.",
  "There are a",
  "There is two",
  "There is two errors\nin the report.",
  'Do not write "There is two errors.".',
  'The phrase "There are a problem." is wrong.',
  "There is `two errors`.",
  "There is two errors.txt",
  "There are a problem_name.",
  "There is two errorś.",
  "There are a problem that needs attention.",
  "Over there is two errors.",
];
test.each(pronounValid)("pronoun agreement preserves %s", (text) =>
  expect(only(text, pronoun)).toEqual([]),
);
test.each(existentialValid)("existential agreement preserves %s", (text) =>
  expect(only(text, existential)).toEqual([]),
);

test("existing six typing mappings and their Review ownership stay unchanged", () => {
  expect([...AGREEMENT_CORRECTIONS.entries()]).toEqual([
    ["i is", "i am"],
    ["i has", "i have"],
    ["you was", "you were"],
    ["he are", "he is"],
    ["she are", "she is"],
    ["it are", "it is"],
  ]);
  const typing = new EnglishPronounVerbWhitelistAgreementRule();
  for (const [source] of pronounErrors)
    expect(
      typing.apply({ beforeCursor: source + " ", afterCursor: "", hints: { lang: "en_US" } }),
    ).toBeNull();
  for (const source of ["You was late.", "He are ready.", "She are ready.", "It are ready."]) {
    const findings = only(source, pronoun);
    expect(findings).toHaveLength(1);
    expect(findings[0].bulk.eligible).toBe(true);
    expect(
      typing.apply({ beforeCursor: source + " ", afterCursor: "", hints: { lang: "en_US" } }),
    ).not.toBeNull();
  }
});

test("dictionary, language, protection, selections and new snapshot IDs stay isolated", () => {
  for (const [text, rule] of [
    ["They has the files.", pronoun],
    ["There is two errors.", existential],
  ] as const) {
    const d = only(text, rule)[0];
    expect(scan(text, {}, { enabledRules: [rule], lang: "fr_FR" })).toEqual([]);
    expect(scan(text, {}, { enabledRules: [rule], userDictionary: [d.original] })).toEqual([]);
    expect(
      scan(text, { protectedRanges: [{ ...d.range, reason: "code" }] }, { enabledRules: [rule] }),
    ).toEqual([]);
    expect(
      scan(
        text,
        { scope: { start: d.range.start + 1, end: d.range.end } },
        { enabledRules: [rule] },
      ),
    ).toEqual([]);
    expect(scan(text, { scope: d.range }, { enabledRules: [rule] })).toHaveLength(1);
    expect(scan(text, { id: "next" }, { enabledRules: [rule] })[0].id).not.toBe(d.id);
  }
});

test("verb ownership crosses chunks without changing quantity, noun or Unicode offsets", () => {
  const text = "😀 Café́.\r\nThere is 12 errors in the report.";
  const options = {
    lang: "en_US",
    enabledRules: [existential],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const prepared = prepareReview(
    { id: "edge", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  const start = text.indexOf("is");
  expect(scanReviewChunk(prepared, { start: 0, end: start }).findings).toEqual([]);
  expect(scanReviewChunk(prepared, { start, end: text.length }).findings).toHaveLength(1);
  expect(applyEdits(text, only(text, existential)[0].alternatives[0].edits)).toBe(
    text.replace("is", "are"),
  );
});

test("only explicit countable forms have known number", () => {
  expect(knownEnglishNounNumber("child")).toBe("singular");
  expect(knownEnglishNounNumber("children")).toBe("plural");
  for (const noun of ["news", "series", "team", "staff", "sheep", "unknowns"])
    expect(knownEnglishNounNumber(noun)).toBeNull();
});

test("ordinary quotations and uppercase verbs work, but mixed-case subjects remain identifiers", () => {
  const quote = 'She said, "They has the files."';
  expect(applyEdits(quote, only(quote, pronoun)[0].alternatives[0].edits)).toBe(
    'She said, "They have the files."',
  );
  const upper = "There IS two errors.";
  expect(applyEdits(upper, only(upper, existential)[0].alternatives[0].edits)).toBe(
    "There ARE two errors.",
  );
  expect(only("tHeY has the files.", pronoun)).toEqual([]);
});

test.each([
  ["If there is warnings, stop.", ["If there are warnings, stop."]],
  ["There's bugs in the parser.", ["There are bugs in the parser."]],
  ["I think there was issues with it.", ["I think there were issues with it."]],
  ["Is there examples for this?", ["Are there examples for this?"]],
  ["So, was there tickets left?", ["So, were there tickets left?"]],
  [
    "There are bug in the parser.",
    ["There is a bug in the parser.", "There are bugs in the parser."],
  ],
  [
    "There were issue with the build.",
    ["There was an issue with the build.", "There were issues with the build."],
  ],
  ["Are there solution?", ["Is there a solution?", "Are there solutions?"]],
])("bare existential agreement repairs %s", (source, expected) => {
  const findings = only(source, existential);
  expect(findings).toHaveLength(1);
  expect(findings[0].bulk.eligible).toBe(false);
  expect(findings[0].requiresChoice ?? false).toBe(expected.length > 1);
  expect(findings[0].alternatives.map((a) => applyEdits(source, a.edits))).toEqual(expected);
  for (const text of expected) expect(only(text, existential)).toEqual([]);
});
test.each([
  "Over there is things to see.",
  "Up there are issue trackers.",
  "There are key differences.",
  "There are test cases here.",
  "This is there things.",
  "What is there tickets for?",
  "There's lots of issues.",
  "There's news.",
  "There is an issue.",
  "There are issues.",
  "there's Users",
])("bare existential agreement preserves %s", (text) =>
  expect(only(text, existential)).toEqual([]),
);

test.each([
  ["I are glad you came.", "I am glad you came."],
  ["It was late, so I are staying.", "It was late, so I am staying."],
  ["It don't matter.", "It doesn't matter."],
  ["She do.", "She does."],
  ["He always forget his keys.", "He always forgets his keys."],
  ["She write every morning.", "She writes every morning."],
  ["They goes home at five.", "They go home at five."],
  ["We usually takes the bus.", "We usually take the bus."],
  ["I does the dishes.", "I do the dishes."],
])("pronoun agreement covers I, clause ends and lexical verbs: %s", (source, expected) => {
  const findings = only(source, pronoun);
  expect(findings).toHaveLength(1);
  expect(findings[0].bulk.eligible).toBe(false);
  expect(applyEdits(source, findings[0].alternatives[0].edits)).toBe(expected);
  expect(only(expected, pronoun)).toEqual([]);
});
test.each([
  "He cut the rope.",
  "She put it away.",
  "It hit the wall.",
  "Does he like it?",
  "Why does she go there?",
  "I suggest he go now.",
  "Let it go.",
  "We made it break.",
  "If I were you.",
  "I didn't know.",
  "I had left.",
  "World War I was long.",
  "He Go Fast is a film.",
  "Sam and I are here.",
  "😀 It feel odd.",
])("pronoun agreement preserves %s", (text) => expect(only(text, pronoun)).toEqual([]));
