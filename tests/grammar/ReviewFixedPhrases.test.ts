import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import {
  COMPOUNDS,
  PHRASES,
  STYLE,
} from "../../src/core/domain/grammar/review/english/fixedPhrases";
import {
  CLOSED_COMPOUNDS,
  PHRASE_CORRECTIONS,
  STYLE_PHRASES,
  type PhraseRow,
} from "../../src/core/domain/grammar/review/englishPhraseTables";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const OWN: CatalogRuleId[] = [
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "stylePhrasing",
  "englishToToo",
  "englishVerbComplements",
];
function scan(text: string, enabledRules: string[] = OWN): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "fixed", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => OWN.includes(d.ruleId as CatalogRuleId));
}
const previews = (d: ReviewDiagnostic) => d.alternatives.map((a) => a.preview);

const TABLES: [CatalogRuleId, readonly PhraseRow[]][] = [
  ["englishPhraseCorrections", PHRASES],
  ["englishClosedCompounds", COMPOUNDS],
  ["stylePhrasing", STYLE],
];

// Every typed form of every row, in running text, gets exactly its replacements.
test.each(
  TABLES.flatMap(([ruleId, rows]) =>
    rows.flatMap(([typed, replacement]) =>
      [typed].flat().map((form) => [ruleId, form, [replacement].flat()] as const),
    ),
  ),
)("%s corrects %p", (ruleId, form, replacements) => {
  const text = `Later she said ${form} there.`;
  const findings = scan(text).filter((d) => d.ruleId === ruleId);
  expect(findings).toHaveLength(1);
  expect(findings[0].original).toBe(form);
  expect(previews(findings[0])).toEqual(replacements);
});

test("no typed form repeats a core or module row, or equals its replacement", () => {
  const forms = [PHRASE_CORRECTIONS, CLOSED_COMPOUNDS, STYLE_PHRASES, PHRASES, COMPOUNDS, STYLE]
    .flat()
    .flatMap(([typed, replacement]) =>
      [typed].flat().map((form) => {
        expect([replacement].flat()).not.toContain(form);
        return form.toLowerCase();
      }),
    );
  expect(new Set(forms).size).toBe(forms.length);
});

// Realistic sentences, all rules on: applying one alternative gives the repaired text.
const FIXES: [bad: string, good: string][] = [
  ["After much adieu, the release went out.", "After much ado, the release went out."],
  ["There is an argument to be said for waiting.", "There is an argument to be made for waiting."],
  ["She paid me a back-hand compliment.", "She paid me a backhanded compliment."],
  ["Flaky tests are the bain of my existance.", "Flaky tests are the bane of my existence."],
  ["Warm the sauce in a bane-marie.", "Warm the sauce in a bain-marie."],
  ["We value their commitment towards safety.", "We value their commitment to safety."],
  ["The photos are copywritten by the studio.", "The photos are copyrighted by the studio."],
  ["Our records date back from 1990.", "Our records date back to 1990."],
  ["Caching is a double edge sword.", "Caching is a double-edged sword."],
  ["Many expatriots live in this district.", "Many expatriates live in this district."],
  ["We finally got rid off the old build.", "We finally got rid of the old build."],
  ["How do I get ride of this warning?", "How do I get rid of this warning?"],
  ["Tabs versus spaces is a holly war.", "Tabs versus spaces is a holy war."],
  ["They acted in retaliation to the ban.", "They acted in retaliation for the ban."],
  [
    "The engine supports several level of details.",
    "The engine supports several levels of detail.",
  ],
  ["I agree with you in this regards.", "I agree with you in this regard."],
  ["It was a monumentous decision.", "It was a momentous decision."],
  ["No only is it fast, it is cheap.", "Not only is it fast, it is cheap."],
  ["Luck played a factor in the result.", "Luck played a role in the result."],
  ["They reversed engineered the protocol.", "They reverse engineered the protocol."],
  [
    "Taking the whole module would be a bridge to far.",
    "Taking the whole module would be a bridge too far.",
  ],
  ["Life's to short for slow builds.", "Life's too short for slow builds."],
  ["I try not to think to much about it.", "I try not to think too much about it."],
  ["The bank is to big to fail.", "The bank is too big to fail."],
  ["Plan for the worse-case-scenario.", "Plan for the worst-case scenario."],
  ["The weather took a turn for the worst.", "The weather took a turn for the worse."],
  ["We cannot combinate these two filters.", "We cannot combine these two filters."],
  ["The policy compulsed us to upgrade.", "The policy compelled us to upgrade."],
  ["A null value provocates the crash.", "A null value provokes the crash."],
  ["English has one definitive article.", "English has one definite article."],
  ["Fiber helps the digestive track.", "Fiber helps the digestive tract."],
  ["End the line with an explanation mark.", "End the line with an exclamation mark."],
  ["I agree to a certain extend.", "I agree to a certain extent."],
  ["He flaunted the rules every day.", "He flouted the rules every day."],
  ["The dog was foaming out the mouth.", "The dog was foaming at the mouth."],
  ["The sponsor will flip the bill.", "The sponsor will foot the bill."],
  ["You will get used of the shortcuts.", "You will get used to the shortcuts."],
  ["You hit the nail in the head.", "You hit the nail on the head."],
  ["The curve has an infliction point.", "The curve has an inflection point."],
  ["The widget is layouted twice.", "The widget is laid out twice."],
  ["I look forward for your reply.", "I look forward to your reply."],
  ["We made due with one laptop.", "We made do with one laptop."],
  ["That makes senses to me.", "That makes sense to me."],
  ["Since the vote passed, the point is mute.", "Since the vote passed, the point is moot."],
  ["Which operative system do you use?", "Which operating system do you use?"],
  ["The passerbys stopped to watch.", "The passersby stopped to watch."],
  ["Here is a peak behind the curtain.", "Here is a peek behind the curtain."],
  ["Who will take responsibility of the backups?", "Who will take responsibility for the backups?"],
  ["They made him an escape goat.", "They made him a scapegoat."],
  ["Skipping reviews sets up a bad example.", "Skipping reviews sets a bad example."],
  ["I am getting use to the new keyboard.", "I am getting used to the new keyboard."],
  ["You can verse against the computer.", "You can play against the computer."],
  ["She learned the poem by wrote.", "She learned the poem by rote."],
  ["The course avoids wrote-memorization.", "The course avoids rote-memorization."],
  ["They all seam to agree.", "They all seem to agree."],
  ["Everything seams fine now.", "Everything seems fine now."],
  ["Many ex-pats live here.", "Many expats live here."],
  ["Someone tried to high jack the session.", "Someone tried to hijack the session."],
  ["Now a days everyone has a phone.", "Nowadays everyone has a phone."],
  ["The search finds look-a-likes.", "The search finds lookalikes."],
  // Context detectors.
  ["What dose this error mean?", "What does this error mean?"],
  ["It dose not compile.", "It does not compile."],
  ["dose it work offline?", "does it work offline?"],
  ["The lag got worst than before.", "The lag got worse than before."],
  ["The new build is much worst.", "The new build is much worse."],
  ["The patch made it worst.", "The patch made it worse."],
  ["It is slow at best and unsafe at worse.", "It is slow at best and unsafe at worst."],
  ["That was the worse ever release.", "That was the worst ever release."],
  ["This is how it looks like now.", "This is what it looks like now."],
  ["How would it look like on mobile?", "What would it look like on mobile?"],
  ["The banner made it seems urgent.", "The banner made it seem urgent."],
  ["He was a complete nerve wreck.", "He was a complete nervous wreck."],
  ["That plan is utter bullocks.", "That plan is utter bollocks."],
  ["Please conform that the fix works.", "Please confirm that the fix works."],
  ["This constitutes as a breach.", "This constitutes a breach."],
  ["Two weeks have past since then.", "Two weeks have passed since then."],
  ["She payed the invoice.", "She paid the invoice."],
  ["Traffic ground to halt at noon.", "Traffic ground to a halt at noon."],
  ["This rises the question of cost.", "This raises the question of cost."],
  ["Please explain it in more details.", "Please explain it in more detail."],
  ["I want to have my cake and eat it to.", "I want to have my cake and eat it too."],
  ["It looks too good too be true.", "It looks too good to be true."],
  ["We went to far compared to last year.", "We went too far compared to last year."],
  ["The dialog is to big for small screens.", "The dialog is too big for small screens."],
  ["The school encouraged wrote learning.", "The school encouraged rote learning."],
  // Style advice.
  ["Pass the args to the script.", "Pass the arguments to the script."],
  ["The govt. budget grew.", "The government budget grew."],
  ["I wish it was simpler.", "I wish it were simpler."],
  ["It is not uncommon to see delays.", "It is common to see delays."],
  ["Is it more optimal to cache?", "Is it optimal to cache?"],
  ["As a side tangent, I like it.", "As an aside, I like it."],
  ["They are chomping at the bit.", "They are champing at the bit."],
  ["We take control over the queue.", "We take control of the queue."],
];
test.each(FIXES)("repairs %p", (bad, good) => {
  const findings = scan(bad, [...REVIEW_SUPPORTED_RULE_IDS]);
  const repaired = findings.some((d) =>
    d.alternatives.some((alt) => applyEdits(bad, alt.edits) === good),
  );
  expect(repaired).toBe(true);
});

// Correct forms and look-alikes stay silent with every rule on.
const SILENT: string[] = [
  "A herd of bullocks crossed the road.",
  "What dose of the drug is safe?",
  "I do not know what dose it takes to work.",
  "Nurses dose it twice a day.",
  "We studied how dose changes affect the outcome.",
  "I am getting worst accuracy on this model.",
  "This makes them worst case linear.",
  "It is by far the worst release.",
  "Things got worse ever since the update.",
  "It was a nerve-wreck, but we shipped.",
  "So much nerve wreck for one demo.",
  "The case isn't conforming that is supported today.",
  "Startup is constituting as much as a second.",
  "The board was constituted as a court.",
  "She has past experience with Rust.",
  "The sailor payed out the rope.",
  "There arose the question of cost.",
  "We are interested in more details about the plan.",
  "We are now a day behind schedule.",
  "I gave the key to him.",
  "We went to far places last summer.",
  "Set the font to big for headings.",
  "She wrote learning goals for the class.",
  "He likes to flaunt his wealth.",
  "This is the editor I use to write code.",
  "I used to write Java.",
  "It was red versus blue in the finals.",
  "These scripts date back to the nineties.",
  "Make it seem easy.",
  "The person who made it seems happy.",
  "That is how it looks to me.",
  "What it looks like depends on the theme.",
  "I only wish it was.",
  "If only he were here.",
  "The seam to the left is torn.",
  "The level of detail is high.",
  "We discussed it in detail.",
];
test.each(SILENT)("stays silent on %p", (text) => {
  expect(scan(text, [...REVIEW_SUPPORTED_RULE_IDS])).toEqual([]);
});

test("detectors keep the typed casing", () => {
  const [halt] = scan("Systems Grind to Halt");
  expect(previews(halt)).toEqual(["a Halt"]);
  const [dose] = scan("What Dose That Mean");
  expect(previews(dose)).toEqual(["Does"]);
  const [like] = scan("Here's how he looks like.");
  expect(previews(like)).toEqual(["what he looks like", "how he looks"]);
  expect(like.requiresChoice).toBe(true);
});
