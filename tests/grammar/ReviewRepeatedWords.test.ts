import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { normalizeGrammarRuleSelection } from "../../src/core/domain/grammar/ruleCatalog";
import { resolveGrammarRuleSelection } from "../../src/core/domain/grammar/GrammarRuleSettings";
import type { ReviewSourceSnapshot } from "../../src/core/domain/grammar/review/types";

const ruleId = "englishRepeatedWords";
function review(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  dictionary: string[] = [],
  lang = "en_US",
) {
  return detectReviewDiagnostics(
    { id: "repeat", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    {
      enabledRules: reviewRuleIds({ codeMode: false }),
      lang,
      userDictionary: dictionary,
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

const positives = [
  ["I opened the the report.", "I opened the report."],
  ["This is is the new version.", "This is the new version."],
  ["Please save it in in the folder.", "Please save it in the folder."],
  ["We are are ready.", "We are ready."],
  ["It was was late.", "It was late."],
  ["They were were tired.", "They were tired."],
  ["Leave it on on my desk.", "Leave it on my desk."],
  ["Meet us at at noon.", "Meet us at noon."],
  ["This is for for you.", "This is for you."],
  ["Come with with me.", "Come with me."],
  ["A letter from from home.", "A letter from home."],
  ["A cup of of tea.", "A cup of tea."],
  ["I saw an an owl.", "I saw an owl."],
  ["She has a a bike.", "She has a bike."],
  ["The the report is here.", "The report is here."],
  ["😀 Café́: the\t the report.\r\nDone.", "😀 Café́: the report.\r\nDone."],
  ['He shouted, "The the door is open!"', 'He shouted, "The door is open!"'],
  ["I have to to go home.", "I have to go home."],
  ["Please send it to to the team.", "Please send it to the team."],
];
test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.context.start).toBeLessThanOrEqual(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(d.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
  expect(d.alternatives[0].edits).toHaveLength(1);
  expect(d.alternatives[0].edits[0].replacement).toBe("");
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

const negatives = [
  "I had had enough.",
  "I know that that works.",
  "We need to record record profits.",
  "It is very very important.",
  "Ha ha, that was funny.",
  "Please opt-in in settings.",
  'Do not write "the the".',
  "The phrase “is is” is wrong.",
  'Type "in in" to reproduce it.',
  "The report is ready.",
  "We are ready.",
  "An owl flew by.",
  "Is this the report?",
  "The, the report.",
  "The—the report.",
  "The-the report.",
  "the\nthe report",
  "the\r\nthe report",
  "the\n\nthe report",
  "the `code` the report",
  "`the the` report",
  "```\nthe the\n```",
  "https://the.the/the the report",
  "@the the report",
  "the the@example.org",
  "src/the the report",
  "the thé report",
  "thé the report",
  "other other words",
  "the_the the report",
  "the the2 report",
  "go go now",
  "bye bye",
  "so so tired",
  "can can dancers",
  "that that",
  "the-the the report",
  // A stranded preposition or an elided infinitive before "to".
  "Here is the club I wrote to to complain.",
  "Do whatever you have to to win.",
  "Adjust it as you need to to finish.",
  "This is the form we refer to to check totals.",
  "The file being pointed to to load is missing.",
];
test.each(negatives)("preserves %s", (text) => expect(review(text)).toEqual([]));

test("one bounded repair per run, rechecking after each deletion", () => {
  let text = "the the the the report";
  for (let i = 0; i < 3; i++) {
    const findings = review(text);
    expect(findings).toHaveLength(1);
    text = applyEdits(text, findings[0].alternatives[0].edits)!;
  }
  expect(text).toBe("the report");
  expect(review(text)).toEqual([]);
});

test("protects dictionary, scope, language and editor islands", () => {
  const text = "Read the the report.";
  expect(review(text, {}, ["THE"])).toEqual([]);
  expect(review(text, {}, [], "fr_FR")).toEqual([]);
  expect(review(text, { scope: { start: 9, end: text.length } })).toEqual([]);
  expect(review(text, { scope: { start: 0, end: 10 } })).toEqual([]);
  expect(review(text, { protectedRanges: [{ start: 9, end: 12, reason: "code" }] })).toEqual([]);
  expect(review(text, { scope: { start: 5, end: 12 } })).toHaveLength(1);
});

test("chunk ownership and emoji offsets stay exact", () => {
  const text = "😀 " + "word ".repeat(799) + "the the the the report";
  const findings = review(text);
  expect(findings).toHaveLength(1);
  expect(findings[0].range.start).toBe(text.indexOf("the"));
  expect(applyEdits(text, findings[0].alternatives[0].edits)).toBe(text.replace("the the", "the"));
});

test("Review-only rules cannot enter typing runtime or stored typing choices", () => {
  expect(reviewRuleIds({ codeMode: false })).toContain(ruleId);
  expect(reviewRuleIds({ codeMode: true })).not.toContain(ruleId);
  expect(normalizeGrammarRuleSelection([ruleId])).toEqual([]);
  expect(resolveGrammarRuleSelection({ [ruleId]: true })).not.toContain(ruleId);
  expect(
    createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }).map((r) => r.id),
  ).not.toContain(ruleId);
});

test.each([
  ["de_DE", "Ich wohne in einem einem Haus.", "Ich wohne in einem Haus."],
  ["fr_FR", "Il est dans dans la maison.", "Il est dans la maison."],
  ["es_ES", "Vivo en en Madrid.", "Vivo en Madrid."],
  ["pt_BR", "Moro em em São Paulo.", "Moro em São Paulo."],
  ["pl_PL", "Cieszę się się bardzo.", "Cieszę się bardzo."],
  ["sv_SE", "Jag vill att att du kommer.", "Jag vill att du kommer."],
  ["hr_HR", "Idem na na posao.", "Idem na posao."],
  ["el_GR", "Πάω στο στο σπίτι.", "Πάω στο σπίτι."],
  ["ar_SA", "ذهبت إلى إلى المدرسة.", "ذهبت إلى المدرسة."],
])("%s repairs %s", (lang, source, expected) => {
  const findings = review(source, {}, [], lang);
  expect(findings).toHaveLength(1);
  expect(applyEdits(source, findings[0].alternatives[0].edits)).toBe(expected);
  expect(review(expected, {}, [], lang)).toEqual([]);
});

test.each([
  // Relative pronoun + article, reflexive pronouns, verb + preposition, verb + clitic.
  ["de_DE", "Die Frau die die Blumen kauft."],
  ["de_DE", "Ich weiß, dass das das Beste ist."],
  ["fr_FR", "Nous nous levons tôt."],
  ["fr_FR", "Vous vous trompez."],
  ["es_ES", "Ella para para descansar."],
  ["pt_BR", "Ele para para pensar."],
  ["pl_PL", "To to jest problem."],
  ["hr_HR", "Pitao je je jučer."],
  ["el_GR", "Άσε με με την ησυχία μου."],
  // Another language's list does not apply.
  ["de_DE", "Read the the report."],
  ["auto_detect", "Read the the report."],
])("%s keeps %s", (lang, text) => {
  expect(review(text, {}, [], lang)).toEqual([]);
});
