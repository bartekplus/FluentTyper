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
  ["They have saw it coming.", "They have seen it coming."],
  ["Have went home", "Have gone home"],
  // Any subject, mid-sentence: nouns, names, gerund and infinitive have.
  ["The library has went through three rewrites.", "The library has gone through three rewrites."],
  ["Most users have wrote to support.", "Most users have written to support."],
  ["The invoice has came back unpaid.", "The invoice has come back unpaid."],
  ["Grandma had went to bed early.", "Grandma had gone to bed early."],
  ["I think Priya had went home.", "I think Priya had gone home."],
  ["Having went over the logs, we found it.", "Having gone over the logs, we found it."],
  ["I expected it to have took less time.", "I expected it to have taken less time."],
  ["It would have took weeks.", "It would have taken weeks."],
  ["Our budget has shrank twice.", "Our budget has shrunk twice."],
  ["Time has flew since the launch.", "Time has flown since the launch."],
  ["I hope you have went to bed.", "I hope you have gone to bed."],
  ["People we had went with stayed.", "People we had gone with stayed."],
  // Ambiguous pasts read as verbs when no noun follows.
  ["The cache has fell out of sync.", "The cache has fallen out of sync."],
  ["I have saw that error before.", "I have seen that error before."],
  ["Prices have rose again.", "Prices have risen again."],
  ["The dog has bit him twice.", "The dog has bitten him twice."],
  ["Disaster has stole our weekend.", "Disaster has stolen our weekend."],
  ["They have broke something again.", "They have broken something again."],
  // Adverbs, contractions and dropped apostrophes.
  ["The team has recently went remote.", "The team has recently gone remote."],
  ["We have all went home.", "We have all gone home."],
  ["We've went with plan B.", "We've gone with plan B."],
  ["You’ve wrote a great summary.", "You’ve written a great summary."],
  ["youve ran it twice.", "youve run it twice."],
  ["It hasnt came yet.", "It hasnt come yet."],
  ["They shouldve took the bus.", "They shouldve taken the bus."],
  // Questions: the auxiliary opens the clause.
  ["Have you ate yet?", "Have you eaten yet?"],
  ["Had they went home already?", "Had they gone home already?"],
  ["Hasn't it came yet?", "Hasn't it come yet?"],
  ["Why have you went there?", "Why have you gone there?"],
  ["Has the build came back?", "Has the build come back?"],
  // Prefixed irregulars borrow their stem's participle.
  ["They have outgrew the office.", "They have outgrown the office."],
  ["She had foresaw the risk.", "She had foreseen the risk."],
  ["The river has overran its banks.", "The river has overrun its banks."],
  ["I have drank the coffee.", "I have drunk the coffee."],
  ["The bell has rang.", "The bell has rung."],
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
  "I have my saw repaired.",
  "They have the saw blades sharpened.",
  // Noun or other-verb readings of ambiguous past forms.
  "We have rose bushes in the yard.",
  "I have bit rates to check.",
  "They have stole designs on display.",
  "He has fell running on Sundays.",
  // Shared lemma/past, names, would/had and has/is contractions, missing have.
  "I have beat the game.",
  "We have come home.",
  "I have Drew on the line.",
  "Your order id came through.",
  "The session ID went stale.",
  "It could has went.",
  "They could haven't went.",
  "I have went\uFFFC home.",
  "I have went.example.com",
  // Object gaps: have is the main verb and the past starts the next clause.
  "Everything we had went into the launch.",
  "All the money they have went to rent.",
  "The cat I had ran off.",
  "The money that we had went to rent.",
  "Things we had went missing.",
  "Any money he had went to his kids.",
  "All that I have came from my father.",
  // Noun compounds after an ambiguous past, causative have.
  "Having saw blades in stock helps.",
  "She has bore holes in the wall.",
  "I had him ran the tests.",
  "Its rose garden is lovely.",
];
test.each(valid)("perfect participles preserve %s", (text) => expect(scan(text)).toEqual([]));
const hadOrWould: [string, string, string][] = [
  ["I'd took the wrong turn.", "I'd taken the wrong turn.", "I'd take the wrong turn."],
  ["They’d went home.", "They’d gone home.", "They’d go home."],
  ["I’d did the setup already.", "I’d done the setup already.", "I’d do the setup already."],
  ["We'd chose the blue one.", "We'd chosen the blue one.", "We'd choose the blue one."],
  ["She'd never wrote back.", "She'd never written back.", "She'd never write back."],
  ["They’d forgot the keys.", "They’d forgotten the keys.", "They’d forget the keys."],
];
test.each(hadOrWould)("'d is had or would: %s", (source, had, would) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.requiresChoice).toBe(true);
  expect(d.messageKey).toBe("review_msg_had_or_would");
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([had, would]);
  expect(scan(had)).toEqual([]);
  expect(scan(would)).toEqual([]);
});
test.each([
  ["They’d came home.", "They’d come home."],
  ["He'd ran out.", "He'd run out."],
])("'d with a shared base and participle offers one repair: %s", (source, expected) => {
  const [d] = scan(source);
  expect(d.requiresChoice).toBeUndefined();
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([expected]);
});
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
test.each([
  '😀 Café.\r\nShe said, "I have went home." We have ran the tests.',
  "😀 Ok. The car was stole. I'm work on it now; she is write a letter.",
])("participle frames own one chunk and keep UTF-16 offsets: %s", (text) => {
  const prepared = prepareReview(
    { id: "chunks", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules: [rule], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  const expected = scan(text);
  expect(expected).toHaveLength(text.includes("stole") ? 3 : 2);
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
  // A full "have" also offers the contracted be between the two ("We're fixing it now.").
  const offered = d.alternatives.map((a) => applyEdits(source, a.edits));
  expect([offered[0], offered.at(-1)]).toEqual([be, been]);
  expect(offered.length).toBe(/['’]ve/.test(source) ? 2 : 3);
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

const afterBe: [string, string][] = [
  ["He was took away.", "He was taken away."],
  ["The car was stole.", "The car was stolen."],
  ["It was wrote in 2019.", "It was written in 2019."],
  ["They were gave a prize.", "They were given a prize."],
  ["I was saw at the park.", "I was seen at the park."],
  ["This code was wrote by hand.", "This code was written by hand."],
  ["My bike was took last night.", "My bike was taken last night."],
  ["The song was sang twice.", "The song was sung twice."],
  ["The test was ran twice.", "The test was run twice."],
  ["That was took from me.", "That was taken from me."],
  ["We were never gave a choice.", "We were never given a choice."],
  ["The report wasn't wrote yet.", "The report wasn't written yet."],
  ["It will be wrote tomorrow.", "It will be written tomorrow."],
  ["It has been took care of.", "It has been taken care of."],
  ["It is being wrote now.", "It is being written now."],
  ["They said it was wrote well.", "They said it was written well."],
  // Any subject, embedded clauses, modal + be and being.
  ["The devices were gave away.", "The devices were given away."],
  ["When v2 was began, we had no tests.", "When v2 was begun, we had no tests."],
  ["The feature can be saw in the sidebar.", "The feature can be seen in the sidebar."],
  ["Nothing can be began until Monday.", "Nothing can be begun until Monday."],
  ["Both samples are took from the suite.", "Both samples are taken from the suite."],
  ["The flag kept being took into account.", "The flag kept being taken into account."],
  ["The wallet was being stole.", "The wallet was being stolen."],
  ["It was spoke about at length.", "It was spoken about at length."],
  ["The ships were sank.", "The ships were sunk."],
  ["Was it took by someone?", "Was it taken by someone?"],
  ["Were they gave a choice?", "Were they given a choice?"],
  // "broke" of a thing, and adjective pasts with a particle.
  ["It's broke again.", "It's broken again."],
  ["It's broke for me too.", "It's broken for me too."],
  ["Now its broke and won't start.", "Now its broken and won't start."],
  ["Is it broke?", "Is it broken?"],
  ["The house was broke into.", "The house was broken into."],
  ["I was woke up at five.", "I was woken up at five."],
  // 's on other pronouns.
  ["Who's went first?", "Who's gone first?"],
  ["Everyone's went home.", "Everyone's gone home."],
  ["It's became clear.", "It's become clear."],
  ["He's did it again.", "He's done it again."],
  // A participle only: "was begun" keeps the passive the writer chose.
  ["It was began in 2019.", "It was begun in 2019."],
  // 's is has or is; the participle fits both.
  ["He's went home.", "He's gone home."],
  ["She's wrote the summary.", "She's written the summary."],
  ["It’s took ages.", "It’s taken ages."],
  ["She's became a manager.", "She's become a manager."],
  ["IT WAS WROTE IN 2019.", "IT WAS WRITTEN IN 2019."],
];
test.each(afterBe)("be takes the participle: %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.requiresChoice).toBeUndefined();
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

const baseAfterBe: [string, string, string][] = [
  ["I am go to the store.", "I am going to the store.", "I go to the store."],
  ["She is write a letter.", "She is writing a letter.", "She writes a letter."],
  ["We are fix the bug.", "We are fixing the bug.", "We fix the bug."],
  ["I'm work on it now.", "I'm working on it now.", "I work on it now."],
  ["They are play the game.", "They are playing the game.", "They play the game."],
  ["He is do the dishes.", "He is doing the dishes.", "He does the dishes."],
  ["She's write a letter.", "She's writing a letter.", "She writes a letter."],
  ["They’re fix the build.", "They’re fixing the build.", "They fix the build."],
  ["I am also build the API.", "I am also building the API.", "I also build the API."],
  ["He is update the docs.", "He is updating the docs.", "He updates the docs."],
  ["She is verify the result.", "She is verifying the result.", "She verifies the result."],
  ["I am implement the feature.", "I am implementing the feature.", "I implement the feature."],
  ["We are push them upstream.", "We are pushing them upstream.", "We push them upstream."],
  ["You are have a meeting.", "You are having a meeting.", "You have a meeting."],
  // Negation needs do-support in the simple present.
  ["I am not go to the party.", "I am not going to the party.", "I do not go to the party."],
  ["He isn't write the docs.", "He isn't writing the docs.", "He doesn't write the docs."],
  ["I'm not work on it.", "I'm not working on it.", "I do not work on it."],
  ["WE ARE FIX THE BUG.", "WE ARE FIXING THE BUG.", "WE FIX THE BUG."],
];
test.each(baseAfterBe)("be before a bare verb offers both repairs: %s", (source, ing, present) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.requiresChoice).toBe(true);
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([ing, present]);
  expect(scan(ing)).toEqual([]);
  expect(scan(present)).toEqual([]);
});

test.each([
  // Adjectives, nouns and prepositions after be.
  "I am fine with it.",
  "It is set the night before.",
  "They are home the whole week.",
  "We are free the whole day.",
  "It is worth the effort.",
  "You are right the first time.",
  "I am sure the build works.",
  "It is like the old one.",
  "It is open the whole weekend.",
  "He is back the next day.",
  "She is out the door.",
  "It is cut the same way.",
  "The data is spread the same way.",
  "It is time the team met.",
  "I am busy the whole day.",
  "I am sick the whole week.",
  "He is sick this week.",
  "I am sad the team lost.",
  "I am glad the tests pass.",
  "I am afraid the server is down.",
  "I'm sorry the build broke.",
  "She is proud the team shipped.",
  "I am aware the docs are stale.",
  "You are wrong the data is fine.",
  "I am happy the release went out.",
  "We are lucky the backup worked.",
  "You're correct the build is green.",
  "I'm unsure the fix works.",
  "I am confident the fix works.",
  "I am curious the way it works.",
  "He is mean the whole time.",
  "He is mean to me.",
  "The bag is light the way it is.",
  "I am awake the whole night.",
  "I am sleep deprived the whole week.",
  "I am fly fishing this weekend.",
  "We are go for launch.",
  "I am new this year.",
  "He is late a lot.",
  "I am better the second time.",
  "You are welcome any time.",
  "You are welcome the whole time.",
  "We are near the end.",
  "We are past the deadline.",
  "We are behind the schedule.",
  "They are over the limit.",
  "I am among the winners.",
  "He is like the rest of us.",
  "She is unlike the others.",
  "We are all the same.",
  "They are both the best.",
  "I am still the owner.",
  "She is just the person for it.",
  "He is not the problem.",
  "He is never the problem.",
  "She is simply the best.",
  "He is himself the founder.",
  "We are twice the size.",
  "She is half the age of her brother.",
  "We are kinda the same.",
  "I am only the messenger.",
  "We are now the owners.",
  "I am here the whole day.",
  "You are so the right person.",
  "I am ready the moment you are.",
  "I am open to ideas.",
  "I am present the whole week.",
  "I'm online the whole day.",
  "We are live the whole day.",
  "I am close to the station.",
  "I am used to the noise.",
  "I am through the worst.",
  "He is down the hall.",
  "We are around the corner.",
  "I am okay the way it is.",
  "He is kind the whole time.",
  "He is smart the way he works.",
  "She is captain this season.",
  "I am host the second year.",
  "I am lead on this project.",
  "She is lead engineer here.",
  "They are swing voters.",
  "We are build engineers.",
  "They are test engineers.",
  "I'm in the office.",
  "She's off the clock.",
  "I am Drew.",
  "She is Rose.",
  // Adjective or ambiguous pasts, verbs without a passive, and other owners of the subject.
  "I am broke this month.",
  "He was broke after the trip.",
  "We were broke the whole year.",
  "It was found in the attic.",
  "It was left on the table.",
  "It was bit by a dog.",
  "The sky was rose at dusk.",
  "He was came home.",
  "He was went to school.",
  "What it was took a while.",
  "The man he was became a legend.",
  "The way it was did not matter.",
  "The question is did he go.",
  "The human being stole the car.",
  "A being came out of the cave.",
  "The class at 8 am took ages.",
  "She's broke again.",
  "Being broke is no fun.",
  "If it ain't broke, don't fix it.",
  "The company's broke after the crash.",
  "The movie is woke.",
  "Its rose garden is in bloom.",
  "Whoever it was took my pen.",
  "They is took away.",
  "I is go to the store.",
  "We are Drew the team.",
  'Type "It was wrote in 2019." exactly.',
  "I am go.",
  "They are play outside.",
])("be frames preserve %s", (text) => expect(scan(text)).toEqual([]));
