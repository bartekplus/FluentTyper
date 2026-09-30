import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import {
  CLOSED_COMPOUNDS,
  NAME_CASING,
  PHRASE_CORRECTIONS,
  STYLE_PHRASES,
  type PhraseRow,
} from "../../src/core/domain/grammar/review/englishPhraseTables";
import type { ProtectedRange, ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const IDS: CatalogRuleId[] = [
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "stylePhrasing",
  "englishCanonicalCasing",
];
function scan(
  text: string,
  {
    lang = "en_US",
    enabledRules = IDS,
    userDictionary = [] as string[],
    protectedRanges = [] as ProtectedRange[],
  } = {},
): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "phrases", text, scope: { start: 0, end: text.length }, protectedRanges },
    { lang, enabledRules, userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => IDS.includes(d.ruleId as CatalogRuleId));
}
const previews = (d: ReviewDiagnostic) => d.alternatives.map((a) => a.preview);

const TABLES: [CatalogRuleId, readonly PhraseRow[], (form: string) => string][] = [
  ["englishPhraseCorrections", PHRASE_CORRECTIONS, (form) => `Later she said ${form} there.`],
  ["englishClosedCompounds", CLOSED_COMPOUNDS, (form) => `Later she said ${form} there.`],
  ["stylePhrasing", STYLE_PHRASES, (form) => `Later she said ${form} there.`],
  [
    "englishCanonicalCasing",
    NAME_CASING.map((name) => [name.toLowerCase(), name]),
    (form) => `We flew to ${form} last spring.`,
  ],
];

// Every typed form of every row, in running text, gets exactly its replacements.
test.each(
  TABLES.flatMap(([ruleId, rows, frame]) =>
    rows.flatMap(([typed, replacement]) =>
      [typed].flat().map((form) => [ruleId, form, [replacement].flat(), frame(form)] as const),
    ),
  ),
)("%s corrects %p", (ruleId, form, replacements, text) => {
  const findings = scan(text);
  expect(findings).toHaveLength(1);
  const [d] = findings;
  expect(d.ruleId).toBe(ruleId);
  expect(d.original).toBe(form);
  expect(previews(d)).toEqual(replacements);
  expect(d.requiresChoice ?? false).toBe(replacements.length > 1);
  expect(d.bulk.eligible).toBe(false);
  for (const [index, alternative] of d.alternatives.entries()) {
    const fixed = applyEdits(text, alternative.edits)!;
    expect(fixed).toBe(text.replace(form, replacements[index]));
    expect(scan(fixed).filter((f) => f.ruleId === ruleId)).toEqual([]);
  }
});

test("no typed form is listed twice or equals its own replacement", () => {
  const forms = TABLES.flatMap(([, rows]) =>
    rows.flatMap(([typed, replacement]) =>
      [typed].flat().map((form) => {
        expect([replacement].flat()).not.toContain(form);
        return form.toLowerCase();
      }),
    ),
  );
  expect(new Set(forms).size).toBe(forms.length);
});

// Realistic sentences; the fixed text must come out exactly.
const EXAMPLES: [bad: string, good: string][] = [
  [
    "The power went out all of the sudden, so we lost the draft.",
    "The power went out all of a sudden, so we lost the draft.",
  ],
  ["Without further adieu, here is the agenda.", "Without further ado, here is the agenda."],
  [
    "We should nip it in the butt before the next release.",
    "We should nip it in the bud before the next release.",
  ],
  [
    "Everyone is expected to tow the line on security.",
    "Everyone is expected to toe the line on security.",
  ],
  ["We waited with baited breath for the results.", "We waited with bated breath for the results."],
  ["The outage last week is a case and point.", "The outage last week is a case in point."],
  [
    "Whether it ships on Friday is a mute point now.",
    "Whether it ships on Friday is a moot point now.",
  ],
  ["Here is a sneak peak of the new dashboard.", "Here is a sneak peek of the new dashboard."],
  [
    "The contractors had free reign over the design.",
    "The contractors had free rein over the design.",
  ],
  ["It is a deep seeded fear of change.", "It is a deep-seated fear of change."],
  ["The storm will wreck havoc on the schedule.", "The storm will wreak havoc on the schedule."],
  [
    "This teaser should wet your appetite for the launch.",
    "This teaser should whet your appetite for the launch.",
  ],
  ["Backups give us piece of mind.", "Backups give us peace of mind."],
  ["The review was written tongue and cheek.", "The review was written tongue in cheek."],
  ["They removed every test in one foul swoop.", "They removed every test in one fell swoop."],
  [
    "For all intensive purposes the migration is done.",
    "For all intents and purposes the migration is done.",
  ],
  ["That is a whole nother problem.", "That is a whole other problem."],
  ["Please bare with me while I share my screen.", "Please bear with me while I share my screen."],
  [
    "Please bare in mind that the office is closed.",
    "Please bear in mind that the office is closed.",
  ],
  ["By in large, the pilot went well.", "By and large, the pilot went well."],
  ["The draft does not pass mustard yet.", "The draft does not pass muster yet."],
  ["Several features fell by the waste side.", "Several features fell by the wayside."],
  [
    "The rollout is nerve wrecking for the whole team.",
    "The rollout is nerve-racking for the whole team.",
  ],
  ["Everyone was on tender hooks during the demo.", "Everyone was on tenterhooks during the demo."],
  ["The tool is not slow per say, just heavy.", "The tool is not slow per se, just heavy."],
  ["She is a shoe-in for the award.", "She is a shoo-in for the award."],
  ["In the worse case scenario we roll back.", "In the worst-case scenario we roll back."],
  ["Irregardless of the budget, we need testing.", "Regardless of the budget, we need testing."],
  ["Copy the file to the server and visa versa.", "Copy the file to the server and vice versa."],
  ["The new policy will take affect next month.", "The new policy will take effect next month."],
  ["The rules went into affect in January.", "The rules went into effect in January."],
  [
    "For arguments sake, assume the cache is warm.",
    "For argument's sake, assume the cache is warm.",
  ],
  ["We use rows as oppose to columns here.", "We use rows as opposed to columns here."],
  ["I have a question in regards to the invoice.", "I have a question regarding the invoice."],
  ["There are a couple of more steps to finish.", "There are a couple more steps to finish."],
  ["In the end of the day, the users decide.", "At the end of the day, the users decide."],
  [
    "Every since the update, the app starts faster.",
    "Ever since the update, the app starts faster.",
  ],
  ["We keep the pedal to the medal until Friday.", "We keep the pedal to the metal until Friday."],
  ["The files were sorted half hazard.", "The files were sorted haphazard."],
  ["It is more that likely to rain.", "It is more than likely to rain."],
  ["The finale was jar dropping.", "The finale was jaw-dropping."],
  ["He is our leader, sort of speak.", "He is our leader, so to speak."],
  ["Low and behold, the build passed.", "Lo and behold, the build passed."],
  ["The new feature really peaked my interest.", "The new feature really piqued my interest."],
  ["The report is chalk full of errors.", "The report is chock-full of errors."],
  ["I ordered an expresso and a scone.", "I ordered an espresso and a scone."],
  ["We were lead to believe the bug was fixed.", "We were led to believe the bug was fixed."],
  ["I am trying to loose weight before summer.", "I am trying to lose weight before summer."],
  [
    "Let us take a breathe before the next session.",
    "Let us take a breath before the next session.",
  ],
  ["Let us play it by year this weekend.", "Let us play it by ear this weekend."],
  [
    "Losing that client was a blessing in the skies.",
    "Losing that client was a blessing in disguise.",
  ],
  ["I only got the jist of the talk.", "I only got the gist of the talk."],
  ["They repeated the warning ad nauseum.", "They repeated the warning ad nauseam."],
  ["Staff left the building en mass at five.", "Staff left the building en masse at five."],
  ["The board gave her carte blanc on hiring.", "The board gave her carte blanche on hiring."],
  ["An another option is to wait.", "Another option is to wait."],
  ["Sorry, I am in hurry today.", "Sorry, I am in a hurry today."],
  ["Keep this between you and I, please.", "Keep this between you and me, please."],
  ["Our guide emphasizes on clear writing.", "Our guide emphasizes clear writing."],
  ["The team learned to cope up with the pressure.", "The team learned to cope with the pressure."],
  ["Everyone can do a mistake sometimes.", "Everyone can make a mistake sometimes."],
  ["Each and everyone of you helped.", "Each and every one of you helped."],
  ["We are awaiting for approval.", "We are awaiting approval."],
  ["The data base grows every night.", "The database grows every night."],
  ["Our code base is ten years old.", "Our codebase is ten years old."],
  ["Please down load the latest build.", "Please download the latest build."],
  ["I looked every where for the charger.", "I looked everywhere for the charger."],
  ["It is in so far as the law allows.", "It is insofar as the law allows."],
  ["Use the stairs in stead of the lift.", "Use the stairs instead of the lift."],
  ["The seal remained in tact after shipping.", "The seal remained intact after shipping."],
  ["The design it self is simple.", "The design itself is simple."],
  ["He fixed it him self.", "He fixed it himself."],
  ["They wrote the tests them selves.", "They wrote the tests themselves."],
  ["Save your work on the lap top.", "Save your work on the laptop."],
  ["Mean while, the server restarted.", "Meanwhile, the server restarted."],
  ["I think you miss understood the request.", "I think you misunderstood the request."],
  [
    "The results were mixed; none the less, we shipped.",
    "The results were mixed; nonetheless, we shipped.",
  ],
  ["We will post pone the meeting.", "We will postpone the meeting."],
  ["Please proof read the contract.", "Please proofread the contract."],
  ["Some how the tests still pass.", "Somehow the tests still pass."],
  ["The fix is pretty straight forward.", "The fix is pretty straightforward."],
  ["Errors appeared through out the report.", "Errors appeared throughout the report."],
  ["You can call me when ever you like.", "You can call me whenever you like."],
  ["We left with out a map.", "We left without a map."],
  ["It was worth while to wait.", "It was worthwhile to wait."],
  ["Our web site loads in one second.", "Our website loads in one second."],
  ["Attach a screen shot of the error.", "Attach a screenshot of the error."],
  ["We meet every week end.", "We meet every weekend."],
  ["The work flow needs one more review.", "The workflow needs one more review."],
  ["Update the check list before launch.", "Update the checklist before launch."],
  ["We need atleast two reviewers.", "We need at least two reviewers."],
  ["Infact, the build is green.", "In fact, the build is green."],
  ["Bring an umbrella incase it rains.", "Bring an umbrella in case it rains."],
  ["They help eachother a lot.", "They help each other a lot."],
  ["Noone answered the phone.", "No one answered the phone."],
  ["Everytime I open it, it crashes.", "Every time I open it, it crashes."],
  ["Wait upto ten minutes.", "Wait up to ten minutes."],
  ["Ofcourse we will help.", "Of course we will help."],
  ["It worked, eventhough it was late.", "It worked, even though it was late."],
  ["My mother in law visits in May.", "My mother-in-law visits in May."],
  ["He got off scot free.", "He got off scot-free."],
  ["It was clear from the get go.", "It was clear from the get-go."],
  ["We live in new york now.", "We live in New York now."],
  ["The Office moved to San francisco.", "The Office moved to San Francisco."],
  ["Share the file in google docs, please.", "Share the file in Google Docs, please."],
  ["She studied in the united kingdom.", "She studied in the United Kingdom."],
  ["The conference is in rio de janeiro.", "The conference is in Rio de Janeiro."],
];
test.each(EXAMPLES)("example: %s", (bad, good) => {
  const findings = scan(bad);
  expect(findings).toHaveLength(1);
  const fixed = findings[0].alternatives.map((a) => applyEdits(bad, a.edits));
  expect(fixed).toContain(good);
  expect(scan(good).filter((d) => d.ruleId !== "stylePhrasing")).toEqual([]);
});

const STYLE_EXAMPLES: [bad: string, good: string][] = [
  ["Thanks, and btw the deploy finished.", "Thanks, and by the way the deploy finished."],
  ["BTW, the deploy finished.", "By the way, the deploy finished."],
  ["The deploy finished BTW.", "The deploy finished by the way."],
  ["IN ORDER TO WIN, PRACTICE.", "TO WIN, PRACTICE."],
  ["Imo the second option is cleaner.", "In my opinion the second option is cleaner."],
  ["Idk why it failed.", "I don't know why it failed."],
  ["Send it asap, please.", "Send it as soon as possible, please."],
  ["We added tests in order to catch regressions.", "We added tests to catch regressions."],
  [
    "It was late due to the fact that the server crashed.",
    "It was late because the server crashed.",
  ],
  ["The end result was better.", "The result was better."],
  ["Please revert back the change.", "Please revert the change."],
  ["Check the logs prior to the release.", "Check the logs before the release."],
  ["We back up the data on a daily basis.", "We back up the data daily."],
];
test.each(STYLE_EXAMPLES)("optional style example: %s", (bad, good) => {
  const [d] = scan(bad);
  expect(d.ruleId).toBe("stylePhrasing");
  expect(d.alternatives.map((a) => applyEdits(bad, a.edits))).toContain(good);
  // Style advice stays off unless the user turns it on.
  expect(
    scan(bad, { enabledRules: reviewRuleIds({ codeMode: false }) as CatalogRuleId[] }).filter(
      (f) => f.ruleId === "stylePhrasing",
    ),
  ).toEqual([]);
});

// Lookalikes that are ordinary English, names, mentions and technical text.
const ALLOWED = [
  "Put one in the same folder as the report.",
  "Keep on going until the end of the road.",
  "Walk straight forward and turn left at the bakery.",
  "Give her a piece of my mind.",
  "Every one of the tests passed.",
  "In the other hand she held a coffee cup.",
  "We are all ready for the demo.",
  "The shoe in the hallway is wet.",
  "The padding side affects the layout.",
  "She is lacking in tact and patience.",
  "Even though process mining is slow, it helps.",
  "They wrote a report on research into affect regulation.",
  "The plane sailing over the hills was tiny.",
  "We ordered just desserts after the meal.",
  "The two drafts are similar with respect to cost.",
  "The house where as a child I lived is gone.",
  "Some one hundred people attended.",
  "The desk top was covered in paper.",
  "Two key board members resigned.",
  "She spread sheets over the furniture.",
  "Please pass word to the team that we are done.",
  "I miss understanding friends from school.",
  "The tree uses an inorder traversal.",
  "We need further more detailed data.",
  "It was another vain attempt, in the same vain effort as before.",
  "It is time to take a breather.",
  "Loose weight plates rattled in the van.",
  "The prostrate figure lay still.",
  "They fell by the wayside.",
  "A statue of Liberty replica stands outside.",
  "The United States Postal Service delivered it.",
  "We moved to New York in May.",
  "NEW YORK IS LOUD.",
  "The team used a non-code base layer.",
  "Set config.code base to true.",
  "Open https://example.com/code base notes.",
  "The label reads “all the sudden” in the mockup.",
  'The "code base" label stays as it is.',
  'Write "irregardless" to see the warning.',
  "My self-esteem improved.",
  "It self-destructs after one use.",
  "Tout le monde est là.",
];
test.each(ALLOWED)("no finding: %s", (text) => {
  expect(scan(text)).toEqual([]);
});

test("casing follows the typed phrase", () => {
  const first = (text: string) => previews(scan(text)[0]);
  expect(first("All the sudden it rained.")).toEqual(["All of a sudden"]);
  expect(first("IT STOPPED ALL THE SUDDEN.")).toEqual(["ALL OF A SUDDEN"]);
  expect(first("An Eagle Eyed Reviewer.")).toEqual(["Eagle-Eyed"]);
  expect(first("Code base notes.")).toEqual(["Codebase"]);
  expect(first("ATLEAST two.")).toEqual(["AT LEAST"]);
  // Names keep their canonical form; shouted names stay as typed.
  expect(first("We met in New york.")).toEqual(["New York"]);
  expect(scan("WE MET IN NEW YORK.")).toEqual([]);
});

test("apostrophes follow the typed text", () => {
  expect(previews(scan("It’s for arguments sake.")[0])).toEqual(["for argument’s sake"]);
  expect(previews(scan("It's for arguments sake.")[0])).toEqual(["for argument's sake"]);
  expect(previews(scan("An old wive’s tale.")[0])).toEqual(["old wives’ tale"]);
  expect(previews(scan("An old wive's tale.")[0])).toEqual(["old wives' tale"]);
});

test("several conventional forms are offered as a choice", () => {
  const [d] = scan("It moved as if though nothing happened.");
  expect(previews(d)).toEqual(["as if", "as though"]);
  expect(d.requiresChoice).toBe(true);
  expect(d.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
});

test("findings are individual only and never part of Fix all", () => {
  const text = "We use the code base all the sudden in new york.";
  const findings = scan(text);
  expect(findings.map((d) => d.ruleId)).toEqual([
    "englishClosedCompounds",
    "englishPhraseCorrections",
    "englishCanonicalCasing",
  ]);
  expect(findings.every((d) => !d.bulk.eligible)).toBe(true);
  expect(planBulkFix(text, findings).edits).toEqual([]);
});

test("user dictionary words, protected code and other languages abstain", () => {
  expect(scan("That is irregardless.", { userDictionary: ["irregardless"] })).toEqual([]);
  const text = "Run code base now.";
  expect(scan(text, { protectedRanges: [{ start: 4, end: 13, reason: "code" }] })).toEqual([]);
  expect(scan("We live in new york, all the sudden.", { lang: "fr_FR" })).toEqual([]);
  expect(
    scan("All the sudden.", { enabledRules: ["englishClosedCompounds", "stylePhrasing"] }),
  ).toEqual([]);
});

test("ranges stay on grapheme boundaries after emoji and line breaks", () => {
  const text = "😀 Café.\n\nall the sudden the 👩‍💻 code base grew.";
  const findings = scan(text);
  expect(findings.map((d) => d.original)).toEqual(["all the sudden", "code base"]);
  const fixed = findings.reduceRight(
    (current, d) => applyEdits(current, d.alternatives[0].edits)!,
    text,
  );
  expect(fixed).toBe("😀 Café.\n\nall of a sudden the 👩‍💻 codebase grew.");
});

test("each occurrence in a long text is reported once, in any chunk", () => {
  const sentence = "The code base grew all the sudden. ";
  const text = sentence.repeat(400);
  const findings = scan(text);
  expect(findings).toHaveLength(800);
  expect(new Set(findings.map((d) => d.range.start)).size).toBe(800);
});

test("a more specific rule explains a duplicate fix", () => {
  const findings = detectReviewDiagnostics(
    {
      id: "dupe",
      text: "For all intensive purposes, the test is complete.",
      scope: { start: 0, end: 49 },
      protectedRanges: [],
    },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(findings.map((d) => d.ruleId)).toEqual(["englishUsagePhrases"]);
});

test("fixed phrases and compounds are on by default, wording advice is optional", () => {
  const defaults = reviewRuleIds({ codeMode: false });
  expect(defaults).toContain("englishPhraseCorrections");
  expect(defaults).toContain("englishClosedCompounds");
  expect(defaults).not.toContain("stylePhrasing");
});
