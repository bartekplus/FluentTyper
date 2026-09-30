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
const rule = "englishPerfectParticiples";
function all(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    {
      id: "participles",
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
const errors: [string, string][] = [
  ["I have went through the report.", "I have gone through the report."],
  ["She has wrote the summary.", "She has written the summary."],
  ["We had took the wrong turn.", "We had taken the wrong turn."],
  ["They have knew the answer.", "They have known the answer."],
  ["He has came home.", "He has come home."],
  ["You have ate the meal.", "You have eaten the meal."],
  ["I had gave the answer.", "I had given the answer."],
  ["She has spoke to the team.", "She has spoken to the team."],
  ["We have ran the tests.", "We have run the tests."],
  ["They had did the work.", "They had done the work."],
  ["I have saw the results.", "I have seen the results."],
  ["He has chose the option.", "He has chosen the option."],
  ["We have began the project.", "We have begun the project."],
  ["I've already went home.", "I've already gone home."],
  ["We’ve just wrote the report.", "We’ve just written the report."],
  ["She hasn't took a break.", "She hasn't taken a break."],
  ["I have never saw the movie.", "I have never seen the movie."],
  ["We had not already ate the meal.", "We had not already eaten the meal."],
  ["You hadn't really spoke to the team.", "You hadn't really spoken to the team."],
  ["They have still not began the project.", "They have still not begun the project."],
  // Unambiguous past-only forms need no listed argument.
  ["I have wrote.", "I have written."],
  ["We have drove past it twice.", "We have driven past it twice."],
  ["She has forgot her badge again.", "She has forgotten her badge again."],
  ["They had flew to Oslo before the storm.", "They had flown to Oslo before the storm."],
  ["It has became slower since Monday.", "It has become slower since Monday."],
  ["i have went unknownword.", "i have gone unknownword."],
  ["I have went\nhome.", "I have gone\nhome."],
  ["I have went home.page", "I have gone home.page"],
  ["I HAVE WENT HOME.", "I HAVE GONE HOME."],
  ["He has fell asleep.", "He has fallen asleep."],
  // A modal before have.
  ["I could have went home.", "I could have gone home."],
  ["She might have broke the lamp.", "She might have broken the lamp."],
  ["They couldn’t have knew.", "They couldn’t have known."],
  ["She would not have took it.", "She would not have taken it."],
  ["You could've wrote more.", "You could've written more."],
  ["😀 We’ve shook hands, then left.", "😀 We’ve shaken hands, then left."],
];
test.each(errors)("perfect participles repair %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives[0].edits).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThan(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
  for (const e of d.alternatives[0].edits) {
    expect(e.start).toBeGreaterThanOrEqual(d.range.start);
    expect(e.end).toBeLessThanOrEqual(d.range.end);
  }
});
const valid = [
  "I have read the report.",
  "We have cut the cable.",
  "I have saw blades in the toolbox.",
  "They had the work done.",
  "The file has been updated.",
  "They have learned the rule.",
  "They have learnt the rule.",
  "She has already put it away.",
  "I have set the table.",
  "We have found the answer.",
  "She has brought the file.",
  "They have bought the office.",
  "He has made the change.",
  "We have sent the report.",
  "I have understood the answer.",
  "I have got the message.",
  "I have gotten the message.",
  "They have snuck home.",
  "They have sneaked home.",
  "She has dreamed about it.",
  "She has dreamt about it.",
  "We have burnt the meal.",
  "We have burned the meal.",
  "I have saw dust on the floor.",
  "I have saw teeth in the box.",
  "We have cut flowers.",
  "I have read receipts enabled.",
  "We had the report written.",
  "She has the meal prepared.",
  "They have him run the tests.",
  "We had her write the report.",
  "She's wrote the summary.",
  "She’s wrote the summary.",
  "I'd took the wrong turn.",
  "They’d went home.",
  "She is gone.",
  "I've gone home.",
  "We’ve written the report.",
  "He has been writing the report.",
  "They haven’t yetunknown the project.",
  "I have unknownword the report.",
  "I have\nwent home.",
  "I have `went` home.",
  'Type "I have went home." exactly.',
  'The example "She has wrote the summary." is wrong.',
  "`We had took the wrong turn.`",
  "They has went home.",
  "She have wrote the summary.",
  "He’ve went home.",
  "I have never really actually went home.",
  "Have went home",
  "I have my saw repaired.",
  "They have the saw blades sharpened.",
  // Noun or other-verb readings of ambiguous past forms.
  "We have rose bushes in the yard.",
  "I have bit rates to check.",
  "They have stole designs on display.",
  "They have saw it coming.",
  "He has fell running on Sundays.",
  // Shared lemma/past, names, would/had and has/is contractions, missing have.
  "I have beat the game.",
  "We have come home.",
  "I have Drew on the line.",
  "I’d did the setup already.",
  "We'd chose the blue one.",
  "It's broke again.",
  "Your order id came through.",
  "The session ID went stale.",
  "It could has went.",
  "They could haven't went.",
  "I have went\uFFFC home.",
  "I have went.example.com",
];
test.each(valid)("perfect participles preserve %s", (text) => expect(scan(text)).toEqual([]));
test("agreement owns a wrong auxiliary, then the participle recheck only changes the verb", () => {
  const source = "They has went home.";
  expect(scan(source)).toEqual([]);
  const agreement = all(source).filter((d) => d.ruleId === "englishPronounVerbWhitelistAgreement");
  expect(agreement).toHaveLength(1);
  const next = applyEdits(source, agreement[0].alternatives[0].edits);
  expect(next).toBe("They have went home.");
  const d = scan(next);
  expect(d).toHaveLength(1);
  expect(d[0].original).toBe("went");
  expect(applyEdits(next, d[0].alternatives[0].edits)).toBe("They have gone home.");
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("perfect participles preserve dictionary, language, scope and protected evidence", () => {
  const text = "I have went through the report.";
  const d = scan(text)[0];
  const only = (extra: Partial<ReviewSourceSnapshot>, options: Partial<ReviewOptions> = {}) =>
    all(text, extra, { enabledRules: [rule], ...options });
  expect(only({}, { lang: "fr_FR" })).toEqual([]);
  expect(only({}, { userDictionary: ["went"] })).toEqual([]);
  expect(only({ protectedRanges: [{ ...d.range, reason: "code" }] })).toEqual([]);
  expect(only({ scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
  expect(only({ scope: d.range })).toHaveLength(1);
  expect(only({ id: "new" })[0].id).not.toBe(d.id);
  expect(scan("I have saw\uFFFC the results.")).toEqual([]);
});
test("perfect participles own one chunk and retain UTF-16 offsets through quoted mixed prose", () => {
  const text = '😀 Café.\r\nShe said, "I have went home." We have ran the tests.';
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

const progressive: [string, string, string][] = [
  ["I've looking at the logs.", "I'm looking at the logs.", "I've been looking at the logs."],
  ["We have fixing it now.", "We are fixing it now.", "We have been fixing it now."],
  [
    "She has cleaning the kitchen.",
    "She is cleaning the kitchen.",
    "She has been cleaning the kitchen.",
  ],
  ["They’ve waiting for us.", "They’re waiting for us.", "They’ve been waiting for us."],
  [
    "😀 You've reading it again.",
    "😀 You're reading it again.",
    "😀 You've been reading it again.",
  ],
  ["WE HAVE SENDING THEM.", "WE ARE SENDING THEM.", "WE HAVE BEEN SENDING THEM."],
];
test.each(progressive)("progressive after have offers be or have been: %s", (source, be, been) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.requiresChoice).toBe(true);
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([be, been]);
  expect(scan(be)).toEqual([]);
  expect(scan(been)).toEqual([]);
});
test.each([
  "We have training on the new tools.",
  "We have running water in the cabin.",
  "I have reading to do tonight.",
  "They have meeting notes for us.",
  "I have nothing for you.",
  "Why have you looking at it?",
  "He have waiting for us.",
  "I've been looking at the logs.",
  "I have looked at the logs.",
  "I have Looking Glass on my shelf.",
  'Type "I have looking at it" to see.',
])("progressive after have preserves %s", (text) => expect(scan(text)).toEqual([]));
