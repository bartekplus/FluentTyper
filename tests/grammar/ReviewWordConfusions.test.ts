import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

const ids = [
  "englishThenThan",
  "englishYourYouAre",
  "englishTheirThereTheyAre",
  "englishToToo",
  "englishWereWhere",
] as const;
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    {
      id: "confusions",
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
const only = (text: string, rule: CatalogRuleId) => scan(text).filter((d) => d.ruleId === rule);

const positives: Record<(typeof ids)[number], [string, string][]> = {
  englishThenThan: [
    [
      "This version is faster then the old version.",
      "This version is faster than the old version.",
    ],
    ["The results are better then our results.", "The results are better than our results."],
    ["It was cheaper then the previous model.", "It was cheaper than the previous model."],
    ["They were slower then us.", "They were slower than us."],
    ["The file is much larger then my file.", "The file is much larger than my file."],
    [
      "The report was even worse then their report.",
      "The report was even worse than their report.",
    ],
    ["The account is newer then your account.", "The account is newer than your account."],
    ["The plan is safer then the other plan.", "The plan is safer than the other plan."],
    ["The key is smaller then her.", "The key is smaller than her."],
    ["The model was far older then him.", "The model was far older than him."],
    [
      "The files are slightly larger then the documents.",
      "The files are slightly larger than the documents.",
    ],
    ["The result is better then the answer.", "The result is better than the answer."],
    ["This is faster then the old.", "This is faster than the old."],
    ["One rope was stronger then the other.", "One rope was stronger than the other."],
    ["I sleep less then you.", "I sleep less than you."],
    ["More then ever, we need rest.", "More than ever, we need rest."],
    ["She was more careful then him at chess.", "She was more careful than him at chess."],
    ["Nobody other then us came.", "Nobody other than us came."],
    ["It costs more then 5 dollars.", "It costs more than 5 dollars."],
    ["Let us wait until than.", "Let us wait until then."],
    ["It happens every now and than, sadly.", "It happens every now and then, sadly."],
    ["She is taller then me.", "She is taller than me."],
    ["We paid more then them.", "We paid more than them."],
    ["The station is busier then ever.", "The station is busier than ever."],
    ["Use tea rather then coffee.", "Use tea rather than coffee."],
    ["Easier said then done.", "Easier said than done."],
  ],
  englishYourYouAre: [
    ["Your going to like this.", "You're going to like this."],
    ["Your going to enjoy it.", "You're going to enjoy it."],
    ["Your going to need them.", "You're going to need them."],
    ["Your going to want that.", "You're going to want that."],
    ["Your going to understand us.", "You're going to understand us."],
    ["Your going to remember me.", "You're going to remember me."],
    ["Please check you're own password.", "Please check your own password."],
    ["You forgot you’re own address.", "You forgot your own address."],
    ["Please save you're own files.", "Please save your own files."],
    ["You changed you're own name.", "You changed your own name."],
    ["You entered you're own answers.", "You entered your own answers."],
    ["You found you're own keys.", "You found your own keys."],
  ],
  englishTheirThereTheyAre: [
    ["They forgot there own password.", "They forgot their own password."],
    ["They used they're own accounts.", "They used their own accounts."],
    ["They saved they’re own documents.", "They saved their own documents."],
    ["They changed there own names.", "They changed their own names."],
    ["They reset there own keys.", "They reset their own keys."],
    ["They lost they're own reports.", "They lost their own reports."],
    ["Their going to like it.", "They're going to like it."],
    ["There going to enjoy this.", "They're going to enjoy this."],
    ["Their going to need us.", "They're going to need us."],
    ["There going to want them.", "They're going to want them."],
    ["Their going to understand that.", "They're going to understand that."],
    ["There going to remember me.", "They're going to remember me."],
    ["Their going to be late again.", "They're going to be late again."],
    ["I think their already at the station.", "I think they're already at the station."],
    ["Their not ready for the demo.", "They're not ready for the demo."],
    ["Their probably fixing it now.", "They're probably fixing it now."],
    ["Their in the garage, I think.", "They're in the garage, I think."],
    ["Tell them their invited to lunch.", "Tell them they're invited to lunch."],
    ["We know their the strongest pair.", "We know they're the strongest pair."],
    ["Their could be a simpler fix.", "There could be a simpler fix."],
    ["Their won't be another chance.", "There won't be another chance."],
    ["Their hasn't been any news.", "There hasn't been any news."],
    ["I'm sure their's a spare key.", "I'm sure there's a spare key."],
    ["Leave the boxes their by the gate.", "Leave the boxes there by the gate."],
    ["We waited their until noon.", "We waited there until noon."],
    ["I've never lived their.", "I've never lived there."],
    ["It all depends on they're budget.", "It all depends on their budget."],
    ["They're tickets were never printed.", "Their tickets were never printed."],
    ["Teams can pick there own tools.", "Teams can pick their own tools."],
    ["They are building theyre own tools.", "They are building their own tools."],
    ["There own staff disagreed 😀.", "Their own staff disagreed 😀."],
  ],
  englishToToo: [
    ["The box is to heavy to lift.", "The box is too heavy to lift."],
    ["The drink was to hot to drink.", "The drink was too hot to drink."],
    ["The bag is to large to carry.", "The bag is too large to carry."],
    ["The meal is to cold to eat.", "The meal is too cold to eat."],
    ["It is to late to start.", "It is too late to start."],
    ["It seems to early to leave.", "It seems too early to leave."],
    ["The seats are to small to use.", "The seats are too small to use."],
    ["The procedure is to expensive to use.", "The procedure is too expensive to use."],
    [
      "The passage looks to difficult to understand.",
      "The passage looks too difficult to understand.",
    ],
    ["She was to tired to finish.", "She was too tired to finish."],
    ["The task is to hard to finish.", "The task is too hard to finish."],
    ["They were to tired to move.", "They were too tired to move."],
    ["It is to heavy.", "It is too heavy."],
    ["Life is to short for bad coffee.", "Life is too short for bad coffee."],
    ["The fee felt way to much.", "The fee felt way too much."],
    ["That trip took way to long.", "That trip took way too long."],
    ["I think we went to far this time.", "I think we went too far this time."],
    ["Maybe I spoke to soon.", "Maybe I spoke too soon."],
    ["We need too leave now.", "We need to leave now."],
    ["Send it too them tomorrow.", "Send it to them tomorrow."],
    ["I walked too the station.", "I walked to the station."],
  ],
  englishWereWhere: [
    ["They where late again.", "They were late again."],
    ["We where almost finished.", "We were almost finished."],
    ["You where right about it.", "You were right about it."],
    ["Do you know were they parked?", "Do you know where they parked?"],
    ["I forgot were I left it.", "I forgot where I left it."],
    ["Check were the log is.", "Check where the log is."],
  ],
};
for (const rule of ids) {
  test.each(positives[rule])(`${rule} repairs %s`, (source, expected) => {
    const findings = only(source, rule);
    expect(findings).toHaveLength(1);
    const d = findings[0];
    expect(d.original).toBe(source.slice(d.range.start, d.range.end));
    expect(d.context.start).toBeLessThanOrEqual(d.range.start);
    expect(d.context.end).toBeGreaterThan(d.range.end);
    expect(d.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
    expect(d.alternatives[0].edits).toHaveLength(1);
    expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
    expect(only(expected, rule)).toEqual([]);
  });
}

const negatives: Record<(typeof ids)[number], string[]> = {
  englishThenThan: [
    "Back then, this was faster.",
    "We worked faster then.",
    "It was faster then.",
    "It was faster then the old version failed.",
    "It was better then the reports started arriving.",
    "This version is faster than the old version.",
    "The results are better than our results.",
    "The plan is safer now than before.",
    "It is faster, then slower.",
    "She is older then?",
    "We finished the old version then the new version.",
    "It became faster then slowed down.",
    "The word then is temporal.",
    'Do not replace "then" everywhere.',
    'The example "This version is faster then the old version." is wrong.',
    "This is faster then the.",
    "This is faster then a.",
    "This is faster then unknownword.",
    "This is faster then the old versionName.",
    "This is faster `then` the old version.",
    "This is faster then\nthe old version.",
    "This is faster then the old version.js",
    "If it is better then we ship it.",
    "It was faster then the old version failed.",
    "We saw each other then left.",
    "Wait a bit and then you can go.",
    // A sequence or a new clause after "then".
    "I met her earlier then him.",
    "I would rather then wait.",
    "I'd rather then go home.",
    "If the box is bigger then you should wait.",
    "It got colder then it snowed.",
    "We checked the printer then them.",
    "This is faster then the old versions_are_ready.",
  ],
  englishYourYouAre: [
    "Your going away upset the team.",
    "Your going to work upset us.",
    "I dislike your going to enjoy this.",
    "We discussed your going to like it.",
    "Your going to school is important.",
    "Your going to like this is unlikely.",
    "Your going to remember me surprised them.",
    "You're going to like this.",
    "Your team is ready.",
    "Your welcome email arrived.",
    "We appreciate your welcome.",
    "Please check your own password.",
    "You entered your own answers.",
    "You're your own boss.",
    "You're owning this moment.",
    "You're on your own.",
    "Your liking this surprises me.",
    "Your going to enjoy is incomplete.",
    'Do not write "Your going to like this.".',
    'The phrase "check you\'re own password" is wrong.',
    "Your `going` to like this.",
    "Your going to\nlike this.",
    "Your going to like this_file.",
    "Please check you're own password.com",
    "You found you're own keys_backup.",
  ],
  englishTheirThereTheyAre: [
    "Put it over there.",
    "Their team is ready.",
    "They are going to work.",
    "They're going to like it.",
    "Their going away upset us.",
    "I dislike their going to enjoy this.",
    "We discussed their going to like it.",
    "Their going to work surprised me.",
    "Their going to enjoy this was inevitable.",
    "There is a password.",
    "There are accounts.",
    "They forgot their own password.",
    "They used their own accounts.",
    "They saved their own documents.",
    "They lost their own reports.",
    "They're their own worst critics.",
    "There, own your mistake.",
    "Their going to like is incomplete.",
    "There going to work is unusual.",
    "They forgot there own.",
    "They're owners of the shop.",
    'Do not write "Their going to like it.".',
    'The example "They forgot there own password." is wrong.',
    "They forgot `there` own password.",
    "They forgot there\nown password.",
    "They forgot there own password.txt",
    "People there own nice cars.",
    "Farmers there own the land.",
    "Their not wanting to go was odd.",
    "Their going to school took an hour.",
    "I like their coming over.",
    "Make sure their names are right.",
    "Their late father was a baker.",
    "Their right to vote matters.",
    "Their already strained budget broke.",
    "Their in-laws arrived.",
    "The choice is their.",
    "They got their.",
    "They're what was promised.",
    "They're not what was promised.",
    "We need their and our approval.",
    "Their will is strong.",
    "They're sure it was fine.",
  ],
  englishToToo: [
    "The box is too heavy to lift.",
    "The drink is too hot to drink.",
    "It was too late to start.",
    "She was too tired to finish.",
    "The key to heavy lifting is practice.",
    "They are to fast to prepare for the ceremony.",
    "They are to slow to conserve fuel.",
    "She is to light to read the inscription.",
    "This is to help them finish.",
    "The way to use it is simple.",
    "We move to fit the schedule.",
    "To lift it, bend your knees.",
    "Too much work is tiring.",
    "It is heavy to lift.",
    "It is to heavy to.",
    "It is to strange to frobnicate.",
    'The example "The box is to heavy to lift." is wrong.',
    'Do not write "is to hot to eat".',
    "The box is `to` heavy to lift.",
    "The box is to\nheavy to lift.",
    "The box is to heavy to lift.js",
    "The box is to heavy to lift_now.",
    "They are to fast to prepare.",
    "The plan is to short the stock.",
    "We go to far away places.",
    "She showed the way to much better results.",
    "Me too.",
    "I have too much work.",
    "We were going too fast.",
    "It was to be expected.",
  ],
  englishWereWhere: [
    "I'll show you where the exit is.",
    "Tell them where we are.",
    "Where were you?",
    "Where you going?",
    "The people I know were happy.",
    "The ones I found were the best.",
    "They were late.",
    "We know where it is.",
    'The phrase "they where late" is common.',
  ],
};
for (const rule of ids)
  test.each(negatives[rule])(`${rule} preserves %s`, (text) =>
    expect(only(text, rule)).toEqual([]),
  );

test("each family has independent selection, language and dictionary guards", () => {
  for (const rule of ids) {
    const text = positives[rule][0][0];
    expect(scan(text, {}, { enabledRules: [rule] })).toHaveLength(1);
    expect(scan(text, {}, { enabledRules: [] })).toEqual([]);
    expect(scan(text, {}, { enabledRules: [rule], lang: "fr_FR" })).toEqual([]);
    const d = only(text, rule)[0];
    expect(
      scan(text, {}, { enabledRules: [rule], userDictionary: [d.original.toUpperCase()] }),
    ).toEqual([]);
    expect(
      scan(text, { protectedRanges: [{ ...d.range, reason: "code" }] }, { enabledRules: [rule] }),
    ).toEqual([]);
    expect(
      scan(
        text,
        { scope: { start: d.range.start + 1, end: text.length } },
        { enabledRules: [rule] },
      ),
    ).toEqual([]);
    expect(scan(text, { scope: d.range }, { enabledRules: [rule] })).toHaveLength(1);
  }
});

test("evidence across a chunk edge belongs to the corrected word, with Unicode offsets", () => {
  const text =
    "😀 Café́. " +
    "word ".repeat(795) +
    ". This is faster then the old version.\r\nYour going to like this.";
  const findings = scan(text, {}, { enabledRules: [...ids] });
  expect(findings).toHaveLength(2);
  expect(findings[0].original).toBe("then");
  expect(findings[0].range.start).toBe(text.indexOf("then"));
  expect(findings[0].context.end).toBeGreaterThan(text.indexOf("version"));
  let corrected = text;
  for (const d of [...findings].reverse())
    corrected = applyEdits(corrected, d.alternatives[0].edits)!;
  expect(corrected).toBe(text.replace("then", "than").replace("Your", "You're"));
});

test("quoted prose, casing and combining marks preserve source boundaries", () => {
  expect(only('He said, "Your going to like this."', "englishYourYouAre")).toHaveLength(1);
  expect(only("yOuR going to like this.", "englishYourYouAre")).toEqual([]);
  const source = "YOUR GOING TO LIKE THIS.";
  expect(applyEdits(source, only(source, "englishYourYouAre")[0].alternatives[0].edits)).toBe(
    "YOU'RE GOING TO LIKE THIS.",
  );
  expect(only("Youŕ going to like this.", "englishYourYouAre")).toEqual([]);
  expect(only("The box is tó heavy to lift.", "englishToToo")).toEqual([]);
});

test("existing your-welcome and their-is checks retain sole ownership; typing is unchanged", () => {
  const findings = scan("Your welcome. Their is a problem.");
  expect(findings.filter((d) => (ids as readonly string[]).includes(d.ruleId))).toEqual([]);
  expect(findings.filter((d) => d.ruleId === "englishYourWelcomeCorrection")).toHaveLength(1);
  expect(findings.filter((d) => d.ruleId === "englishTheirThereBeVerb")).toHaveLength(1);
  const runtime = createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: true,
    userDictionaryList: [],
  });
  for (const rule of ids) expect(runtime.map((r) => r.id)).not.toContain(rule);
});

test("chunk ownership follows the corrected word even when its evidence starts earlier", () => {
  const text = "This version is faster then the old version.";
  const prepared = prepareReview(
    { id: "edge", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: ["englishThenThan"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  );
  const cut = text.indexOf("then");
  expect(scanReviewChunk(prepared, { start: 0, end: cut }).findings).toEqual([]);
  const owned = scanReviewChunk(prepared, { start: cut, end: text.length }).findings;
  expect(owned).toHaveLength(1);
  expect(owned[0].range.start).toBe(cut);
});

test.each([
  ["I hope your safe there.", "I hope you're safe there."],
  ["Your very patient.", "You're very patient."],
  ["Ping me when your out of the meeting.", "Ping me when you're out of the meeting."],
  ["Your going to play this.", "You're going to play this."],
])("you're frames repair %s", (source, expected) => {
  const findings = only(source, "englishYourYouAre");
  expect(findings).toHaveLength(1);
  expect(applyEdits(source, findings[0].alternatives[0].edits)).toBe(expected);
  expect(only(expected, "englishYourYouAre")).toEqual([]);
});
test.each([
  ["Did you every fix that?", "Did you ever fix that?"],
  ["Why would I every do that?", "Why would I ever do that?"],
  ["Have they every met?", "Have they ever met?"],
])("ever after an auxiliary + subject: %s", (source, expected) => {
  const findings = only(source, "englishToToo");
  expect(findings).toHaveLength(1);
  expect(applyEdits(source, findings[0].alternatives[0].edits)).toBe(expected);
});
test.each([
  "Is it your very own?",
  "I hope your team wins.",
  "As your manager, I agree.",
  "Your late father was kind.",
  "Did you every day go there?",
  "Do they every time fail?",
  "I check every file.",
])("you're/ever frames preserve %s", (text) =>
  expect(
    scan(text).filter((d) => d.ruleId === "englishYourYouAre" || d.ruleId === "englishToToo"),
  ).toEqual([]),
);
