import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import { scanResult } from "./reviewHarness";

const ruleId = "englishSentenceStructure";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return scanResult(text, { ...options, snapshot: extra });
}
const review = (text: string) => scan(text).diagnostics.filter((d) => d.ruleId === ruleId);
const repaired = (text: string) =>
  review(text).map((finding) =>
    finding.alternatives.map((alternative) => applyEdits(text, alternative.edits)),
  );

// [typed, every offered repair]; several repairs are a choice the writer makes.
const positives: [string, string[]][] = [
  // Two subject pronouns left over from an edit.
  ["I he went home.", ["I went home.", "He went home."]],
  ["We they had left.", ["We had left.", "They had left."]],
  ["She he could see it.", ["She could see it.", "He could see it."]],
  ["It broke. They we fixed it.", ["It broke. They fixed it.", "It broke. We fixed it."]],
  ["WE THEY WON.", ["WE WON.", "THEY WON."]],
  // An article and a possessive on one noun.
  ["I like the my car.", ["I like my car.", "I like the car."]],
  ["The our team won.", ["Our team won.", "The team won."]],
  ["It is a my book.", ["It is my book.", "It is a book."]],
  ["We ate an my apple.", ["We ate my apple.", "We ate an apple."]],
  ["Check a your inbox.", ["Check your inbox.", "Check an inbox."]],
  ["Read the their notes.", ["Read their notes.", "Read the notes."]],
  ["Ask the his teacher.", ["Ask his teacher.", "Ask the teacher."]],
  ["Use the its handle.", ["Use its handle.", "Use the handle."]],
  ["Call the her office.", ["Call her office.", "Call the office."]],
  ["Run the my build-tool.", ["Run my build-tool.", "Run the build-tool."]],
  ["Greet the her Royal guests.", ["Greet her Royal guests.", "Greet the Royal guests."]],
  ["They took the our.", ["They took our.", "They took the."]],
  // The same clash the other way round, "a the", and two possessives.
  ["Read my the notes.", ["Read my notes.", "Read the notes."]],
  ["We sold our the boat.", ["We sold our boat.", "We sold the boat."]],
  ["His the plan worked.", ["His plan worked.", "The plan worked."]],
  ["Fix their the setup.", ["Fix their setup.", "Fix the setup."]],
  ["She took a the bus.", ["She took a bus.", "She took the bus."]],
  ["I like my your idea.", ["I like my idea.", "I like your idea."]],
  [
    "Thanks, your the best.",
    ["Thanks, you're the best.", "Thanks, your best.", "Thanks, the best."],
  ],
  // A preposition takes one object pronoun.
  ["Show it to me them.", ["Show it to me.", "Show it to them."]],
  ["Talk with him us.", ["Talk with him.", "Talk with us."]],
  // Double modals: keep one.
  ["I might could go.", ["I might go.", "I could go."]],
  ["We might can help.", ["We might help.", "We can help."]],
  ["You should can come.", ["You should come.", "You can come."]],
  ["They may can be late.", ["They may be late.", "They can be late."]],
  ["He must can swim.", ["He must swim.", "He can swim."]],
  ["It will can run.", ["It will run.", "It can run."]],
  ["She would could try.", ["She would try.", "She could try."]],
  ["We could might stay.", ["We could stay.", "We might stay."]],
  ["I might would buy it.", ["I might buy it.", "I would buy it."]],
  ["He might should rest.", ["He might rest.", "He should rest."]],
  ["You should ought to call her.", ["You should call her.", "You ought to call her."]],
  ["They Might Could Win.", ["They Might Win.", "They Could Win."]],
  // A modal before a predicative adjective needs "be".
  ["It should possible.", ["It should be possible."]],
  ["That would impossible to fix.", ["That would be impossible to fix."]],
  ["The fix will available soon.", ["The fix will be available soon."]],
  ["We must careful with it.", ["We must be careful with it."]],
  ["You will able to see it.", ["You will be able to see it."]],
  ["It won't necessary now.", ["It won't be necessary now."]],
  ["It should not possible.", ["It should not be possible."]],
  ["This might useful for you.", ["This might be useful for you."]],
  // Any word the lexicon knows only as an adjective.
  ["It would nice to meet.", ["It would be nice to meet."]],
  ["You must aware of the risk.", ["You must be aware of the risk."]],
  ["That would helpful.", ["That would be helpful."]],
  ["The page will accessible tomorrow.", ["The page will be accessible tomorrow."]],
  ["We will glad about the news.", ["We will be glad about the news."]],
  // Predicates the lexicon also reads as verbs: ready, busy, back before a time, best + to.
  ["The rooms will ready by noon.", ["The rooms will be ready by noon."]],
  ["She might busy tomorrow.", ["She might be busy tomorrow."]],
  ["I will back soon.", ["I will be back soon."]],
  ["It would best to wait.", ["It would be best to wait."]],
  // "a couple" before a plural noun takes "of".
  ["A couple people came.", ["A couple of people came."]],
  ["We met a couple days ago.", ["We met a couple of days ago."]],
  ["It took a couple hours.", ["It took a couple of hours."]],
  ["I have a couple ideas.", ["I have a couple of ideas."]],
  ["Wait a couple minutes.", ["Wait a couple of minutes."]],
  ["A couple centuries passed.", ["A couple of centuries passed."]],
  ["We talked to a couple neighbours.", ["We talked to a couple of neighbours."]],
  ["We moved a couple towns ago.", ["We moved a couple of towns ago."]],
  ["We have a lot ideas.", ["We have a lot of ideas."]],
  ["I bought a bunch apples.", ["I bought a bunch of apples."]],
  ["A handful users replied.", ["A handful of users replied."]],
  ["We have plenty examples.", ["We have plenty of examples."]],
  // "of" before a bare plural needs a determiner.
  ["Many of students passed.", ["Many students passed.", "Many of the students passed."]],
  ["Most of developers agree.", ["Most developers agree.", "Most of the developers agree."]],
  ["Both of tests fail.", ["Both tests fail.", "Both of the tests fail."]],
  // Clause-initial "not only" inverts subject and auxiliary.
  ["Not only it is fast, it is cheap.", ["Not only is it fast, it is cheap."]],
  ["Not only they were late, they left early.", ["Not only were they late, they left early."]],
  ["Not only I have seen it, I have used it.", ["Not only have I seen it, I have used it."]],
  ["Not only she can sing, she can dance.", ["Not only can she sing, she can dance."]],
  ["It works. Not only it does run, it flies.", ["It works. Not only does it run, it flies."]],
  // Contractions, linking words and do-support.
  ["Not only it's cheap, it's good.", ["Not only is it cheap, it's good."]],
  ["Not only we're late, we're lost.", ["Not only are we late, we're lost."]],
  ["Not only he's been late, he's been rude.", ["Not only has he been late, he's been rude."]],
  ["Not only it's fast.", ["Not only is it fast."]],
  ["Because not only it was cheap, it was good.", ["Because not only was it cheap, it was good."]],
  ["So not only you are right, you are early.", ["So not only are you right, you are early."]],
  ["Not only it works, it is fast.", ["Not only does it work, it is fast."]],
  ["Not only they went home, they slept.", ["Not only did they go home, they slept."]],
  ["Not only she likes it, she loves it.", ["Not only does she like it, she loves it."]],
  ["Not only I think so, but I also say so.", ["Not only do I think so, but I also say so."]],
];
test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  expect(finding.original).toBe(source.slice(finding.range.start, finding.range.end));
  expect(finding.context.start).toBeLessThanOrEqual(finding.range.start);
  expect(finding.context.end).toBeGreaterThanOrEqual(finding.range.end);
  expect(finding.bulk.eligible).toBe(false);
  expect(repaired(source)).toEqual([expected]);
  for (const result of expected) expect(review(result)).toEqual([]);
});

const negatives = [
  "They will ready the boats at dawn.",
  "He will back the plan.",
  "You could best them all.",
  "It would cool if you left it out.",
  // Pronoun pairs that are ordinary or not at a clause start.
  "I went home.",
  "The one you I mean.",
  "It I like.",
  "You I trust.",
  "Then I he went.",
  "I, he went.",
  "They he said were late.",
  "I I went home.",
  "I he",
  // Possessives that stand alone, exclamations, objects and clauses.
  "It was his the whole time.",
  "Oh my the view is great.",
  "My oh my the rain!",
  "My I never thought so.",
  "Use the my keyword in Perl.",
  "I'll give you them tomorrow.",
  "Explain to them you need time.",
  "For you I would do anything.",
  "To me he was a hero.",
  "I hope your the winner.",
  "I know its the end.",
  // Determiners that can stack, names and labels.
  "Click the My Account page.",
  "Open the My Documents folder.",
  "It's a his and hers set.",
  "They walked on the its own.",
  "This is a gift for a her.",
  "She is a her fan.",
  "It is the her.",
  "She got all my notes.",
  "Both our cars are red.",
  "That is a his-and-hers towel.",
  // One modal, nouns and canning.
  "I might go.",
  "I can can it.",
  "Your will can be changed.",
  "His might could not be matched.",
  "We must can tomatoes.",
  "We should can the peaches.",
  "We will can them tomorrow.",
  "May can be cold.",
  "I might. Could you?",
  "I might, could you?",
  "I might could.",
  // Adverbs and verbs after modals, inversion and other words.
  "He will likely come.",
  "That will sure help.",
  "We must ready the ship.",
  "They will fine you.",
  "Will able students attend?",
  "When will available seats open?",
  "Should necessary repairs be made?",
  "In May possible changes start.",
  "Free will important? Yes.",
  "It should be possible.",
  "I can able to do it.",
  "You could kind of see it.",
  "We should all go.",
  "They will likely win.",
  "We must first decide.",
  "It will rain today.",
  "I would gladly help.",
  "We will soon know.",
  // "couple" as a noun, or a quantity that already reads well.
  "A couple runs the shop.",
  "A couple dances in the square.",
  "The couple seems happy.",
  "a couple hundred people",
  "a couple more days",
  "a couple of days ago",
  "a couple times",
  "The couple's days are long.",
  "A couple houses the refugees.",
  "A lot changes when you move.",
  "It helps a lot people say.",
  "a couple dozen eggs",
  "Make the most of chances.",
  "Most of them came.",
  "Many of the people left.",
  "Both of my parents came.",
  // "not only" mid-sentence or already inverted.
  "It is not only in the morning.",
  "Not only the price is low.",
  "Not only is it fast, it is cheap.",
  "She was not only it is.",
  "Not only I am, but you are.",
  "Not only he knows, she knows too.",
  "Not only you know it, everyone knows it.",
  "Not only I am tired, but you are tired too.",
  "The problem is not only it is slow.",
  "Not only we developers are tired.",
  "Not only I read the book.",
  // Examples, code and lines.
  'Never write "I might could go".',
  "`It should possible`",
  "I might\ncould go.",
  "the my\ncar",
];
test.each(negatives)("preserves %s", (text) => expect(review(text)).toEqual([]));

test("preserves dictionary, language, scope and protected islands", () => {
  const text = "I might could go.";
  expect(review(text)).toHaveLength(1);
  const only = (result: ReturnType<typeof scan>) =>
    result.diagnostics.filter((d) => d.ruleId === ruleId);
  expect(only(scan(text, {}, { userDictionary: ["might"] }))).toEqual([]);
  expect(only(scan(text, {}, { lang: "de_DE" }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 8, end: text.length } }))).toEqual([]);
  expect(only(scan(text, { protectedRanges: [{ start: 8, end: 13, reason: "code" }] }))).toEqual(
    [],
  );
});

// A possessive before a subject pronoun has no single repair: the writer rewrites it.
test.each([
  ["We talked about my I mean list.", "my I"],
  ["Ask about their we plan.", "their we"],
  ["It is your he said.", "your he"],
])("warns about %s", (text, original) => {
  const findings = review(text);
  expect(findings.map((f) => [f.original, f.warningOnly, f.alternatives])).toEqual([
    [original, true, []],
  ]);
  expect(findings[0].messageKey).toBe("review_msg_pronoun_sequence");
});

test("choices are never batched and typing never instantiates the rule", () => {
  const text = "😀 Hi. " + "word ".repeat(795) + ". I he went.\r\nIt should possible.";
  const findings = review(text);
  expect(findings.map((f) => [f.original, f.alternatives.length])).toEqual([
    ["I he", 2],
    ["possible", 1],
  ]);
  expect(findings[0].requiresChoice).toBe(true);
  expect(
    createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }).map((r) => r.id),
  ).not.toContain(ruleId);
});
