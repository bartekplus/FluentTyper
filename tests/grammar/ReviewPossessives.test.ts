import { expect, test } from "bun:test";
import { scanReviewChunk } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import {
  normalizeContractionInContext,
  normalizeContractionToken,
} from "../../src/core/domain/grammar/implementations/EnglishContractionNormalizationRule";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import { expectOneRepair, expectReviewGuards, prepared, review } from "./grammarTestUtils";

const ids = ["englishItsContext", "englishLetsContext", "englishElsePossessive"] as const;
const scan = (
  text: string,
  extra?: Partial<ReviewSourceSnapshot>,
  options?: Partial<ReviewOptions>,
) => review(text, extra, options).diagnostics;
const only = (text: string, rule: (typeof ids)[number]) =>
  scan(text).filter((d) => d.ruleId === rule);
const errors: Array<[(typeof ids)[number], string, string]> = [
  [ids[0], "The router lost it's connection.", "The router lost its connection."],
  [ids[0], "We checked it’s new battery.", "We checked its new battery."],
  [ids[0], "She changed it's password.", "She changed its password."],
  [ids[0], "He fixed it's screen.", "He fixed its screen."],
  [ids[0], "I replaced it's old keyboard.", "I replaced its old keyboard."],
  [ids[0], "It’s cold surface was wet.", "Its cold surface was wet."],
  [ids[0], "Its ready to use.", "It's ready to use."],
  [ids[0], "Its cold outside.", "It's cold outside."],
  [ids[0], "Its working now.", "It's working now."],
  [ids[0], "Its been fixed.", "It's been fixed."],
  [ids[0], "Its already been updated.", "It's already been updated."],
  [ids[0], "Its raining again.", "It's raining again."],
  [ids[0], "Its a sunny morning.", "It's a sunny morning."],
  [ids[0], "I think its not ready.", "I think it's not ready."],
  [ids[0], "Its because the cable broke.", "It's because the cable broke."],
  ...[
    "try again",
    "go home",
    "start now",
    "work together",
    "take a break",
    "check the file",
    "open the folder",
    "read the report",
    "fix the problem",
    "meet tomorrow",
    "wait here",
    "begin with the basics",
  ].map(
    (phrase) =>
      [ids[1], `Lets ${phrase}.`, `Let's ${phrase}.`] as [(typeof ids)[number], string, string],
  ),
  [ids[2], "This is someone elses folder.", "This is someone else's folder."],
  [ids[2], "I opened somebody elses file.", "I opened somebody else's file."],
  [ids[2], "Is this anyone elses password?", "Is this anyone else's password?"],
  [ids[2], "We checked everyone elses settings.", "We checked everyone else's settings."],
  [ids[2], "This is nobody elses keyboard.", "This is nobody else's keyboard."],
  [ids[2], "It was no one elses connection.", "It was no one else's connection."],
  [ids[2], "Is that anybody elses screen?", "Is that anybody else's screen?"],
  [ids[2], "She changed someone elses name.", "She changed someone else's name."],
  [ids[2], "He painted somebody elses door.", "He painted somebody else's door."],
  [ids[2], "This is everyone elses private address.", "This is everyone else's private address."],
  [ids[2], "I repaired someone elses old engine.", "I repaired someone else's old engine."],
  [ids[2], "We found somebody elses blue cover.", "We found somebody else's blue cover."],
];
test.each(errors)("%s repairs %s", (rule, source, expected) => {
  const d = expectOneRepair(only(source, rule), source, expected, (text) => only(text, rule));
  expect(d.context.end).toBeGreaterThan(d.range.end);
  expect(d.alternatives[0].edits).toHaveLength(1);
});
const negatives: Record<(typeof ids)[number], string[]> = {
  englishItsContext: [
    "It's working now.",
    "Its cold surface was wet.",
    "It's cold outside.",
    "The model name is ITS-100.",
    "It's John's connection.",
    "The router lost its connection.",
    "Its battery is new.",
    "Its ready-to-use tools are useful.",
    "Its working hours are long.",
    "Its old owner was kind.",
    "Its name is ITS.",
    "It's a cold surface.",
    "It's blue.",
    "It's been fixed.",
    "Its already updated settings were lost.",
    "The word its means possession.",
    'Do not write "Its ready to use.".',
    'The example "It’s cold surface was wet." is wrong.',
    "`Its ready to use.`",
    "Its\nready to use.",
    "Its ready to use.tools",
    "Its ready to use_items.",
    "ITS ready to use.",
    "iTs ready to use.",
    "Its cold surface.",
    "We checked it's working now.",
    "Its warming temperature was unexpected.",
    "The team and its a-side lineup.",
    "The lamp kept its always-on glow.",
    "Its ready to usé.",
    "It's James's folder.",
    "It's 'cold' outside.",
  ],
  englishLetsContext: [
    "The application lets users export files.",
    "She lets go.",
    "He lets us try again.",
    "It lets me go home.",
    "Let's try again.",
    "Let’s go home.",
    "The agency lets houses.",
    "We discussed holiday lets.",
    "Lets is a label.",
    "LETS try again.",
    "leTs try again.",
    "Lets-try again.",
    "@Lets try again.",
    "Lets/try again.",
    "Lets\ntry again.",
    "Lets try again_file.",
    "Lets try again.example",
    "Lets try agaiń.",
    'Type "Lets try again." exactly.',
    'The example "Lets go home." is wrong.',
    "`Lets take a break.`",
    "The variable lets starts here.",
    "This lets work together in groups.",
    "The method named Lets starts now.",
    "Someone lets the cat out.",
    "Who lets you open the folder?",
    "The word lets has four letters.",
    "She says lets try again in the example.",
  ],
  englishElsePossessive: [
    "This is someone else's folder.",
    "This is someone else’s folder.",
    "The customers left.",
    "The customers' orders arrived.",
    "James's notes are here.",
    "James’ notes are here.",
    "Someone else owns this folder.",
    "Anyone else can open the file.",
    "Everyone else is here.",
    "Nobody else wants this.",
    "The else branch opens a folder.",
    "Elses is a surname.",
    "This is someone Elses folder.",
    "This is someone ELSES folder.",
    "This is someone eLses folder.",
    "This is someone elses.folder",
    "This is someone elses_folder.",
    "This is someone\nelses folder.",
    "This is someone elses\nfolder.",
    "This is someone elses unknownword.",
    "This is someone else's cold surface.",
    'The example "someone elses folder" is wrong.',
    'Type "someone elses folder." exactly.',
    "`someone elses folder`",
    "This is someone elses foldeŕ.",
    "Someone else's is missing.",
    "This belongs to someone else.",
    "Someone's folder is blue.",
  ],
};
for (const rule of ids)
  test.each(negatives[rule])(`${rule} preserves %s`, (text) =>
    expect(only(text, rule)).toEqual([]),
  );

test("contextual apostrophes preserve pipeline protections, dictionary, scope and language", () => {
  for (const [rule, text] of [errors[0], errors[6], errors[12], errors[24]]) {
    const d = only(text, rule)[0];
    expectReviewGuards((t, e, o) => scan(t, e, { enabledRules: [rule], ...o }), text, d, {
      protectedReason: "code",
    });
  }
});
test("mixed corpus preserves UTF-16 ownership across chunks, CRLF and normal quoted prose", () => {
  const text = '😀 Café.\r\n"Its ready to use."\r\nLets try again. This is someone elses folder.';
  const options = { enabledRules: [...ids] };
  const prep = prepared(text, {}, options);
  const expected = scan(text, {}, options);
  expect(expected).toHaveLength(3);
  for (let boundary = 1; boundary < text.length; boundary++) {
    const chunks = [
      ...scanReviewChunk(prep, { start: 0, end: boundary }).findings,
      ...scanReviewChunk(prep, { start: boundary, end: text.length }).findings,
    ];
    expect(
      chunks.map((d) => [d.ruleId, d.range, text.slice(d.range.start, d.range.end)]).sort(),
    ).toEqual(expected.map((d) => [d.ruleId, d.range, d.original]).sort());
  }
});
test("new identities stay out of typing and do not duplicate existing contraction corrections", () => {
  for (const id of ids) expect(TYPING_RULE_IDS as readonly string[]).not.toContain(id);
  for (const token of ["its", "lets", "elses"]) {
    expect(normalizeContractionToken(token, "")).toBeNull();
    expect(normalizeContractionInContext(token, "", " try again.")).toBeNull();
  }
  const text = "I dont know. Its ready to use.";
  expect(scan(text).filter((d) => d.ruleId === "englishContractionNormalization")).toHaveLength(1);
  expect(only(text, ids[0])).toHaveLength(1);
});

test("normal nested quotations run while quoted instructions and protected evidence abstain", () => {
  const text = 'She said, "‘Lets try again.’"';
  const d = only(text, ids[1]);
  expect(d).toHaveLength(1);
  expect(applyEdits(text, d[0].alternatives[0].edits)).toBe('She said, "‘Let’s try again.’"');
  for (const source of [
    'Type "‘Lets try again.’" exactly.',
    'The literal "‘Its ready to use.’" is wrong.',
  ])
    expect(scan(source).filter((d) => ids.includes(d.ruleId as (typeof ids)[number]))).toEqual([]);
  const evidence = "Its ready to use.";
  expect(
    scan(
      evidence,
      { protectedRanges: [{ start: 4, end: 9, reason: "code" }] },
      { enabledRules: [ids[0]] },
    ),
  ).toEqual([]);
  for (const source of [
    "<code>Lets try again.</code>",
    "https://example.test/Its",
    "someone\uFFFCelses folder.",
    "Its ready\uFFFCto use.",
  ])
    expect(scan(source).filter((d) => ids.includes(d.ruleId as (typeof ids)[number]))).toEqual([]);
});

test.each([
  ["Its been a busy month.", "It's been a busy month."],
  ["I think its got a loose wire.", "I think it's got a loose wire."],
  ["Its a quiet street.", "It's a quiet street."],
  ["Honestly, its not my call.", "Honestly, it's not my call."],
  ["Its so late already.", "It's so late already."],
  ["Its important to back up first.", "It's important to back up first."],
  ["Maybe it works, but its hard for beginners.", "Maybe it works, but it's hard for beginners."],
  ["We think its Priya.", "We think it's Priya."],
  ["The kettle has it's own switch.", "The kettle has its own switch."],
  ["Each app runs in it's sandbox.", "Each app runs in its sandbox."],
  ["The club marked it's 25th season.", "The club marked its 25th season."],
  ["It\u2019s wheels are loose.", "Its wheels are loose."],
  ["\uD83D\uDE00 Its time to go.", "\uD83D\uDE00 It's time to go."],
])("its/it's frames repair %s", (source, expected) => {
  expectOneRepair(only(source, "englishItsContext"), source, expected, (text) =>
    only(text, "englishItsContext"),
  );
});
test.each([
  "The team celebrated its victory.",
  "The tool and its important files.",
  "Its hard drive failed.",
  "Its time complexity is linear.",
  "We hope its accuracy improves.",
  "I think its Google product launch.",
  "Its Google Pixel lineup is impressive.",
  "What about it's color?",
  "It's what we need.",
  "It's kind of slow.",
  "It's hard to tell.",
  "Curiosity was at its highest.",
  "The value comes from its measuring of output.",
  "It's 5th in the rankings.",
  "The company revised its policies.",
])("its/it's frames preserve %s", (text) => expect(only(text, "englishItsContext")).toEqual([]));
