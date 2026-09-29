import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { englishVerbForms } from "../../src/core/domain/grammar/implementations/helpers/EnglishVerbForms";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

const ruleId = "englishAuxiliaryBaseVerb";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    { id: "aux", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
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
  ["I did not understood the change.", "I did not understand the change."],
  ["Did she went home?", "Did she go home?"],
  ["He can works remotely.", "He can work remotely."],
  ["Does she knows the answer?", "Does she know the answer?"],
  ["We didn't ate the cake.", "We didn't eat the cake."],
  ["They didn’t came yesterday.", "They didn’t come yesterday."],
  ["She should really took a break.", "She should really take a break."],
  ["Would you just gave me a minute?", "Would you just give me a minute?"],
  ["We must not wrote on this page.", "We must not write on this page."],
  ["You might even spoke to them.", "You might even speak to them."],
  ["I do actually knows the route.", "I do actually know the route."],
  ["He doesn't understood the message.", "He doesn't understand the message."],
  ["They won’t brought the parcel.", "They won’t bring the parcel."],
  ["Could she bought it locally?", "Could she buy it locally?"],
  ["They will sent a letter.", "They will send a letter."],
  ["We cannot chose for you.", "We cannot choose for you."],
  ["You may began now.", "You may begin now."],
  ["She can worked.", "She can work."],
  ["I\t did not really understood this.", "I\t did not really understand this."],
  ['He shouted, "I did not understood it!"', 'He shouted, "I did not understand it!"'],
];
test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  expect(finding.original).toBe(source.slice(finding.range.start, finding.range.end));
  expect(finding.context.start).toBeLessThanOrEqual(finding.range.start);
  expect(finding.context.end).toBeGreaterThanOrEqual(finding.range.end);
  expect(finding.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
  expect(applyEdits(source, finding.alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

const negatives = [
  "Did she read the document?",
  "We did cut the cable.",
  "It might work.",
  "How does your work help?",
  "We will record the result.",
  "The can works as a container.",
  "She will present the works tomorrow.",
  "What I did works for us.",
  "Everything he does works.",
  "I do works of charity.",
  "She does runs for charity.",
  "We did reads of the script.",
  "They did takes of the scene.",
  "She does cuts for the salon.",
  "We did sets of exercises.",
  "I can saw wood.",
  "They will found a company.",
  "We did set the table.",
  "Did she know the answer?",
  "I did not understand the change.",
  "He can work remotely.",
  "She should have eaten.",
  "We might have gone.",
  "They could have written.",
  "He is working.",
  "She has worked.",
  "They had understood.",
  "I did.",
  "Did she?",
  "I can",
  "She does not",
  "We could of gone.",
  "He can frobnicated this.",
  "She will xrays the box.",
  "They did unknowned it.",
  "He can Works remotely.",
  "Did her work matter?",
  "Does your work help?",
  "Do the works matter?",
  'Do not write "Did she went home?".',
  'The example "He can works" is wrong.',
  "`I did not understood it`",
  "```\nDid she went home?\n```",
  "I did `not` understood it.",
  "I did\nnot understood it.",
  "He can\n\nworks remotely.",
  "He can works.com",
  "I did understood@example.org",
  "He can works_file",
  "Did she went/go?",
  "He can workś remotely.",
  "He can 42works remotely.",
  "He can works-in-progress.",
];
test.each(negatives)("preserves %s", (text) => expect(review(text)).toEqual([]));

test("preserves dictionary, language, selected scope and code islands", () => {
  const text = "Did she went home?";
  const only = (result: ReturnType<typeof scan>) =>
    result.diagnostics.filter((d) => d.ruleId === ruleId);
  expect(only(scan(text, {}, { userDictionary: ["WENT"] }))).toEqual([]);
  expect(only(scan(text, {}, { lang: "fr_FR" }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 8, end: text.length } }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 0, end: 10 } }))).toEqual([]);
  expect(only(scan(text, { protectedRanges: [{ start: 4, end: 7, reason: "code" }] }))).toEqual([]);
});

test("bounded lookups preserve ambiguous homographs and never guess unknown suffixes", () => {
  expect(englishVerbForms("understood")?.lemma).toBe("understand");
  expect(englishVerbForms("saw")?.ambiguous).toContain("saw");
  expect(englishVerbForms("found")?.ambiguous).toContain("found");
  expect(englishVerbForms("read")?.lemma).toBe("read");
  expect(englishVerbForms("fabricatedUnknowned")).toBeNull();
});

test("chunk-edge evidence, emoji and CRLF keep exact offsets", () => {
  const text = "😀 Café́. " + "word ".repeat(795) + ". Did she went home?\r\nHe can works remotely.";
  const findings = review(text);
  expect(findings).toHaveLength(2);
  expect(findings[0].range.start).toBe(text.indexOf("Did"));
  expect(findings[1].range.start).toBe(text.indexOf("He"));
  let corrected = text;
  for (const finding of [...findings].reverse())
    corrected = applyEdits(corrected, finding.alternatives[0].edits)!;
  expect(corrected).toBe(text.replace("went", "go").replace("works", "work"));
  expect(review(corrected)).toEqual([]);
});

test("native overlap stays distinct and typing never instantiates this rule", () => {
  const findings = scan("We could of gone. You was late. Did she went home?").diagnostics;
  expect(findings.filter((d) => d.ruleId === ruleId)).toHaveLength(1);
  expect(findings.filter((d) => d.ruleId === "englishModalOfCorrection")).toHaveLength(1);
  expect(findings.filter((d) => d.ruleId === "englishPronounVerbWhitelistAgreement")).toHaveLength(
    1,
  );
  expect(
    createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }).map((r) => r.id),
  ).not.toContain(ruleId);
});
