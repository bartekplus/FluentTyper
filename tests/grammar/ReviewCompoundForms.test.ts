import { expect, test } from "bun:test";
import { COMPOUNDS } from "../../src/core/domain/grammar/review/english/compoundForms";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/compoundForms.ts: compound rows and slot frames. All sentences are our own.
const OWN = new Set(["englishClosedCompounds", "englishContextualCompounds"]);
function scan(text: string): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "compound", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => OWN.has(d.ruleId));
}

test.each(
  COMPOUNDS.flatMap(([typed, replacement]) =>
    [typed].flat().map((form) => [form, [replacement].flat()] as const),
  ),
)("compound row %p", (form, replacements) => {
  const findings = scan(`Later she said ${form} there.`).filter(
    (d) => d.ruleId === "englishClosedCompounds",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0].original).toBe(form);
  expect(findings[0].alternatives.map((a) => a.preview)).toEqual(replacements);
});

const FIXES: [bad: string, good: string][] = [
  // Phrasal verbs used as nouns after an article or possessive.
  [
    "Stretch before the run; a short warm up helps.",
    "Stretch before the run; a short warm-up helps.",
  ],
  ["The kick off moved to noon.", "The kickoff moved to noon."],
  ["After his break up he took a long trip.", "After his breakup he took a long trip."],
  ["We booked two sit ups and three tune ups.", "We booked two sit-ups and three tune-ups."],
  ["Our first informal get together was fun.", "Our first informal get-together was fun."],
  ["The sign up form is broken.", "The sign-up form is broken."],
  ["We keep a back up copy offline.", "We keep a backup copy offline."],
  // Compound verbs in a verb slot.
  ["Could you peer review my slides?", "Could you peer-review my slides?"],
  ["We always fact check our sources.", "We always fact-check our sources."],
  ["She was role playing a customer.", "She was role-playing a customer."],
  ["He guilt tripped his brother again.", "He guilt-tripped his brother again."],
  ["I want to fine tune the model today.", "I want to fine-tune the model today."],
  ["They never baby sit on weekends.", "They never babysit on weekends."],
  // Modifiers before their noun.
  ["We flew with a low cost carrier.", "We flew with a low-cost carrier."],
  ["It was a much needed rest.", "It was a much-needed rest."],
  ["Run an end to end check first.", "Run an end-to-end check first."],
  ["She is my go to editor.", "She is my go-to editor."],
  ["It was a life long friendship.", "It was a lifelong friendship."],
  ["Revenue rose in a year over year comparison.", "Revenue rose in a year-over-year comparison."],
  // Prefixes.
  ["The ruling came from a quasi official body.", "The ruling came from a quasi-official body."],
  ["Prices fell in the mid seventies.", "Prices fell in the mid-seventies."],
  ["Only post 2010 models qualify.", "Only post-2010 models qualify."],
  ["My ex boss called.", "My ex-boss called."],
  // Numbers and units before a noun.
  ["We signed a two month lease.", "We signed a two-month lease."],
  ["Use an 8 digit code.", "Use an 8-digit code."],
  ["They own a 4 door sedan.", "They own a 4-door sedan."],
  ["Our three year old laptop died.", "Our three-year-old laptop died."],
  ["The six year olds sang.", "The six-year-olds sang."],
  ["A ten-year old tree fell.", "A ten-year-old tree fell."],
  ["He managed a chin up.", "He managed a chin-up."],
  ["It became a toss up race.", "It became a toss-up race."],
  ["She is a stand up comic.", "She is a stand-up comic."],
  ["We use an easy to install plugin.", "We use an easy-to-install plugin."],
  ["She is the best all time sprinter.", "She is the best all-time sprinter."],
  ["It was a million dollar question.", "It was a million-dollar question."],
  ["Lyon is the third largest city there.", "Lyon is the third-largest city there."],
  ["He is Ana's go to mechanic.", "He is Ana's go-to mechanic."],
  ["Our coach is very hands on.", "Our coach is very hands-on."],
  ["He was an under cover officer.", "He was an undercover officer."],
  ["A two thirds vote passed it.", "A two-thirds vote passed it."],
  ["She hired French speaking staff.", "She hired French-speaking staff."],
  ["Please sign into the portal.", "Please sign in to the portal."],
  ["We paid (may be) twice.", "We paid (maybe) twice."],
  ["He enabled two factor login.", "He enabled two-factor login."],
  // Small frames.
  ["May be we should wait.", "Maybe we should wait."],
  ["It is may be too late.", "It is maybe too late."],
  ["They found an on going leak.", "They found an ongoing leak."],
  ["Can any one help me?", "Can anyone help me?"],
];

test.each(FIXES)("repairs %p", (bad, good) => {
  const findings = scan(bad);
  expect(findings.length).toBeGreaterThan(0);
  expect(applyEdits(bad, findings.map((d) => d.alternatives[0].edits).flat())).toBe(good);
  expect(scan(good)).toEqual([]);
});

const NEGATIVES = [
  "Let this warm up for a minute.",
  "Warm up the engine first.",
  "I watched the plane take off.",
  "The walk through the woods was long.",
  "Keep your back up straight.",
  "Please read your work out loud.",
  "He pointed to a sign in the window.",
  "A sign up the road warned us.",
  "Did the baby wake up?",
  "The keys may be there.",
  "It may be the best option.",
  "Keep on going until the bridge.",
  "Any one of them could do it.",
  "Any one person can vote.",
  "The role played by teachers matters.",
  "The paper was submitted to peer review.",
  "I read only the first page.",
  "It is so called because of its shape.",
  "Prices rose year over year.",
  "They laid the bricks end to end.",
  "The trip took one hour today.",
  "He is two years old.",
  "The report has 300 pages.",
  "She ran 5 miles yesterday.",
  "We exceeded 20,000 page views.",
  "They visited the Seven Mile Beach.",
  "We will go to Paris next week.",
  "My head aches and my hair cut was bad.",
  "The law suits my taste.",
  "He stayed a fool his whole life long.",
  "We compared our results with the state of the art.",
  "Prime Time Wrestling aired on Mondays.",
  "Two core ideas shaped the plan.",
  "Keep your chin up!",
  "They planned a break out of the camp.",
  "Put your hands on the table.",
  "Raise your right hand high.",
  "Two thirds of the class left.",
  "The bill was signed into law.",
  "Go to the login page.",
  "Paris based its plan on trade.",
  "Have they made progress?",
  "Let's drive through towns.",
  "Put the sign into the hole.",
  "His left hand felt numb.",
];

test.each(NEGATIVES)("stays silent: %p", (text) => {
  expect(scan(text)).toEqual([]);
});

test("a user-dictionary word keeps its compound open", () => {
  const text = "We need a quick warm up today.";
  const findings = detectReviewDiagnostics(
    { id: "compound", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: ["warm"],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => OWN.has(d.ruleId));
  expect(findings).toEqual([]);
});
