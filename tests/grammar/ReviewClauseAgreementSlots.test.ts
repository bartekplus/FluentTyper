import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

function scan(text: string) {
  return reviewScan(text).filter((d) => d.ruleId === "englishSubjectVerbAgreement");
}

test.each([
  // After a relative clause with its own subject, verb and complements.
  ["The laptop that she bought last week run very hot.", "runs"],
  ["The printers that our office uses jams every day.", "jam"],
  ["The chef who cooked at my wedding own a bakery now.", "owns"],
  ["The keys that I left on the table belongs to Sam.", "belong"],
  ["The singer that the critics praised tour Europe every summer.", "tours"],
  ["The parcel that was sent to the office contain books.", "contains"],
  ["The engineer who might join us really want a laptop.", "wants"],
  ["The painting that I didn't sell hang in my hall.", "hangs"],
  ["The tenants who moved in last month complains about noise.", "complain"],
  ["The lamp that he repairs flicker at night.", "flickers"],
  ["The one that my brother fixed break again.", "breaks"],
  // After a comma-closed aside.
  ["My sister, for example, live in Paris.", "lives"],
  ["The kittens, for instance, sleeps all day.", "sleep"],
  ["Our neighbor, who owns two dogs, walk them twice a day.", "walks"],
  ["The printer, which jams every week, need a new roller.", "needs"],
  ["Gardening, for instance, take a lot of patience.", "takes"],
  ["Lisa, whose brother plays drums, sing in a choir.", "sings"],
  ["The old bridges, mostly built of stone, needs repair.", "need"],
  ["The kids in my class, for example, likes pizza.", "like"],
  // A subject wh-word, an inverted auxiliary, "like this" between subject and verb.
  ["Who send the invoices to finance?", "sends"],
  ["What cause the delays at the airport?", "causes"],
  ["Who own the red car?", "owns"],
  ["How does the teams do it?", "do"],
  ["When has the designers ever been clear?", "have"],
  ["Where were the book I lent you?", "was"],
  ["A recipe like this one need fresh herbs.", "needs"],
  ["Phones such as these often breaks easily.", "break"],
  ["Anything like that annoy me.", "annoys"],
  // Prepositional phrases, comma openings and list bullets before the subject's verb.
  ["The houses near the lake has a dock.", "have"],
  ["All files in Dropbox gets synced.", "get"],
  ["As such, each page include a footer.", "includes"],
  ["- The report indicate a problem.", "indicates"],
  ["After the storm, the roads was closed.", "were"],
])("the verb after the clause agrees with its subject: %s", (input, fix) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  const fixed = applyEdits(input, found[0].alternatives[0].edits);
  expect(fixed).toMatch(new RegExp(`\\b${fix}\\b`));
  expect(scan(fixed)).toEqual([]);
});

test.each([
  "The man who saw the dogs run away left.",
  "The book that I gave the kids sits on the shelf.",
  "The tool that we use to build apps works well.",
  "The people that he helps pay their taxes.",
  "The car that she made run again is red.",
  "The house that they built stone by stone stands.",
  "The cat that I watched chase the mice is mine.",
  "The ideas that we discussed at the meeting sound good.",
  "The report that the team wrote in March shows growth.",
  "The program that the kids watch every morning airs at nine.",
  "The issue that people report most often concerns login.",
  "The papers that the board signed last week cover the merger.",
  "The door that the wind slammed shut stays closed.",
  "The idea that people change scares him.",
  "The fact that prices rise worries us.",
  "A test that finds no bugs will still pass.",
  "The cat, the dog, and the bird are fed.",
  "The teacher, who hired them, and the students are here.",
  "Mark, who you met, will call.",
  "The sheep, for example, graze all day.",
  "The fish, for instance, swim fast.",
  "The plan, of course, needs work.",
  "His work, in particular, stands out.",
  "Who put the cat out?",
  "What time the shop opens is unclear.",
  "Who else knows the answer?",
  "A study like this research shows growth.",
  "Plans like these rarely work.",
  "Anything like this exist?",
  "Looks like this is live already!",
  "Sounds like that works.",
  "The man with the dogs walks fast.",
  "The plans for Monday include a hike.",
  "When we left, the doors were open.",
  "The oceans, our wealth, our military power have made us strong.",
  "Right now the city and, especially, the state are the obstacles.",
  "In the book, the word ares is used for battle.",
  "All people from Jersey do is complain.",
])("correct clauses stay silent: %s", (text) => {
  expect(scan(text)).toEqual([]);
});
