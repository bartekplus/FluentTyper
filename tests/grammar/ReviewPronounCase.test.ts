import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

const ruleId = "englishPronounCase";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    { id: "case", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    {
      enabledRules: reviewRuleIds({ codeMode: false }),
      lang: "en_US",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  );
}
const review = (text: string) => scan(text).diagnostics.filter((d) => d.ruleId === ruleId);

const positives = [
  // Object pronouns in a clause-initial coordinated subject; "I" goes last.
  ["Me and Sam went home.", "Sam and I went home."],
  ["Me and my brother were late.", "My brother and I were late."],
  ["Me and the new team finished early.", "The new team and I finished early."],
  ["Me and him reviewed the patch.", "He and I reviewed the patch."],
  ["Me and her saw the film.", "She and I saw the film."],
  ["Me and her cousin drove north.", "Her cousin and I drove north."],
  ["Me and them have met before.", "They and I have met before."],
  ["Me and you can share it.", "You and I can share it."],
  ["My wife and me went shopping.", "My wife and I went shopping."],
  ["Sam and me are ready.", "Sam and I are ready."],
  ["You and me will manage.", "You and I will manage."],
  ["Him and me walked back.", "He and I walked back."],
  ["Him and Sam fixed the sink.", "He and Sam fixed the sink."],
  ["Her and Sam moved away.", "She and Sam moved away."],
  ["Them and their kids stayed late.", "They and their kids stayed late."],
  ["Sam and me both laughed.", "Sam and I both laughed."],
  // A coordinated subject is plural.
  ["Him and me was there.", "He and I were there."],
  ["Me and Ana is going.", "Ana and I are going."],
  ["Me and Tom hasn't eaten.", "Tom and I haven't eaten."],
  ["Me and Tom doesn’t care.", "Tom and I don’t care."],
  // Clause starts and short openers.
  ["It rained. Me and Sam stayed in.", "It rained. Sam and I stayed in."],
  ["yesterday me and john was working.", "yesterday john and I were working."],
  ["Last Monday me and Ola met.", "Last Monday Ola and I met."],
  ["Then, me and Ola left.", "Then, Ola and I left."],
  ["Last week the boss and me met.", "Last week the boss and I met."],
  ['She said, "Me and Ola won."', 'She said, "Ola and I won."'],
  ["ME AND HIM WENT.", "HE AND I WENT."],
  // Whom as the subject of its own verb.
  ["Whom is coming tonight?", "Who is coming tonight?"],
  ["Whom was chosen?", "Who was chosen?"],
  ["Whom will come along?", "Who will come along?"],
  ["Whom has been invited?", "Who has been invited?"],
  ["Whom told you that?", "Who told you that?"],
  ["The man whom was hired left.", "The man who was hired left."],
  ["I wonder whom called.", "I wonder who called."],
  ["Ask them, and whom is going will know.", "Ask them, and who is going will know."],
  ["WHOM IS COMING?", "WHO IS COMING?"],
  ["Whom can really help us?", "Who can really help us?"],
  ["Whom will of course agree?", "Who will of course agree?"],
  ["The prize goes to whom has finished first.", "The prize goes to who has finished first."],
  [
    "We argued about the question of whom is allowed in.",
    "We argued about the question of who is allowed in.",
  ],
  // whoever/whosoever take their case from their own clause, even after a preposition.
  ["Send it to whomever asked for it.", "Send it to whoever asked for it."],
  ["Whomever is speaking, please wait.", "Whoever is speaking, please wait."],
  ["Whomever wants it can take it.", "Whoever wants it can take it."],
  ["Thanks to whomsoever will be reviewing this.", "Thanks to whosoever will be reviewing this."],
  // Subject forms after a preposition, and "us" before a subject noun.
  ["I gave it to he and his team.", "I gave it to him and his team."],
  ["The award went to she and her colleague.", "The award went to her and her colleague."],
  ["Thanks to Sam and I.", "Thanks to Sam and me."],
  ["He spoke with my wife and I.", "He spoke with my wife and me."],
  ["It was sent to he and I.", "It was sent to him and me."],
  ["This is for you and I.", "This is for you and me."],
  ["This matters to we developers.", "This matters to us developers."],
  ["Us developers are tired.", "We developers are tired."],
  ["Us students were late.", "We students were late."],
  // Present base verbs after "me", openers before the pair, "myself" for "I" or "me".
  ["Nadia and me cook on Sundays.", "Nadia and I cook on Sundays."],
  ["Still, Omar and me disagree.", "Still, Omar and I disagree."],
  ["She knows that me and Omar left.", "She knows that Omar and I left."],
  ["Omar and myself were late.", "Omar and I were late."],
  ["The coach thanked Omar and myself.", "The coach thanked Omar and me."],
  ["It stays between you and myself, okay?", "It stays between you and me, okay?"],
  // An object pair before a closed word.
  ["The guide led Omar and I into the cave.", "The guide led Omar and me into the cave."],
  ["She emailed Nadia or I before noon.", "She emailed Nadia or me before noon."],
  ["Write to Omar and I about it.", "Write to Omar and me about it."],
] as const;
test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  expect(finding.original).toBe(source.slice(finding.range.start, finding.range.end));
  expect(finding.context.start).toBeLessThanOrEqual(finding.range.start);
  expect(finding.context.end).toBeGreaterThanOrEqual(finding.range.end);
  expect(finding.alternatives).toHaveLength(1);
  expect(finding.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
  expect(applyEdits(source, finding.alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

const negatives = [
  // Objects and prepositions.
  "Between you and me, it works.",
  "This stays between you and me.",
  "The cake is for Sam and me.",
  "He told Sam and me the news.",
  "She invited Sam and me to dinner.",
  "People like you and me know this.",
  "Let Sam and me handle it.",
  "They gave Ana and me a lift.",
  // No finite verb right after the coordination.
  "Me and my big ideas.",
  "Who went? Me and Sam.",
  "You and me against the world.",
  "Me and Sam, we went home.",
  "Sam and me both.",
  "Me and\nSam went home.",
  "Me and Sam\nwent home.",
  // Correct already, or nothing to change.
  "Sam and I went home.",
  "He and I were late.",
  "I and Sam went home.",
  "Me and I went home.",
  // Possessive "her", object lists and reflexives after "I".
  "Nadia and her father sing.",
  "We met Ana, Omar and me waved.",
  "I asked that Omar and myself sit together.",
  "I paid for Omar and myself.",
  "I think Omar and I about agree.",
  "When Omar and I left, it rained.",
  "Can Omar and I come along?",
  "Us and them fought.",
  // Possessive "her" sharing a noun.
  "Her and my parents met in Lisbon.",
  "Her and his ideas worked well.",
  "Her and her sister moved away.",
  // Mid-clause and question order.
  "Did Sam and me win?",
  "Can me and Sam go?",
  "He said Sam and me were late.",
  // Names, products and dictionary words.
  "Me and iPhone went.",
  "Me and McLeod went.",
  'Never write "Me and him went".',
  "`Me and him went.`",
  // Whom as an object.
  "Whom did you see?",
  "Whom does she trust?",
  "Whom will you invite?",
  "Whom have you met?",
  "Whom is it for?",
  "Whom are these for?",
  "Whom was the prize given to?",
  "Whom was Ted talking to?",
  "To whom it may concern.",
  "To whom was the letter addressed?",
  "With whom were you talking?",
  "Many of whom were late.",
  "Some of whom have left.",
  "The people whom we met were kind.",
  "The friend whom I trust is here.",
  "Whom is something you can lose?",
  // Forms that are also another word or the base form abstain; so do adjectives.
  "Whom saw the light?",
  "Whom put it there?",
  "Whom is responsible?",
  // Partitive "of whom", passives after a preposition and whoever as an object.
  "The guests, most of whom had left, were tired.",
  "The children, the eldest of whom was ten, waited.",
  "Ten players came, the majority of whom were new.",
  "The man to whom was given the prize smiled.",
  "Give it to whomever you like.",
  "Whomever parents choose will win.",
  "I will vote for whomever she picks.",
  // Clauses, inversions, comparisons and the country.
  "For we are many.",
  "Like we developers do, they test.",
  "In they went.",
  "Who's there? Sam and I.",
  "It was Sam and I who went.",
  "He is taller than Sam and I.",
  "To he who waits, all things come.",
  "US developers are busy.",
  "Let us developers decide.",
];
test.each(negatives)("preserves %s", (text) => expect(review(text)).toEqual([]));

test("preserves dictionary, language, scope and protected islands", () => {
  const text = "Me and Sam went home.";
  const only = (result: ReturnType<typeof scan>) =>
    result.diagnostics.filter((d) => d.ruleId === ruleId);
  expect(only(scan(text))).toHaveLength(1);
  expect(only(scan(text, {}, { userDictionary: ["sam"] }))).toEqual([]);
  expect(only(scan(text, {}, { lang: "fr_FR" }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 7, end: text.length } }))).toEqual([]);
  expect(only(scan(text, { protectedRanges: [{ start: 7, end: 10, reason: "code" }] }))).toEqual(
    [],
  );
  expect(
    only(
      scan(
        text,
        {},
        { enabledRules: reviewRuleIds({ codeMode: false }).filter((id) => id !== ruleId) },
      ),
    ),
  ).toEqual([]);
});

test("chunk-edge evidence keeps exact offsets and typing never instantiates the rule", () => {
  const text = "😀 Hi. " + "word ".repeat(795) + ". Me and him went.\r\nWhom is coming?";
  const findings = review(text);
  expect(findings.map((f) => f.original)).toEqual(["Me and him", "Whom"]);
  let corrected = text;
  for (const finding of [...findings].reverse())
    corrected = applyEdits(corrected, finding.alternatives[0].edits)!;
  expect(corrected).toBe(text.replace("Me and him", "He and I").replace("Whom", "Who"));
  expect(
    createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }).map((r) => r.id),
  ).not.toContain(ruleId);
});
