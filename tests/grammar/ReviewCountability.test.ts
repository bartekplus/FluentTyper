import { expect, test } from "bun:test";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import {
  expectChunkSplitParity,
  expectOneRepair,
  expectReviewGuards,
  prepared,
  review,
} from "./grammarTestUtils";
const rule = "englishCountability";
const scan = (text: string) => review(text).diagnostics.filter((d) => d.ruleId === rule);
const repairs: [string, string][] = [
  ["The page contains useful informations.", "The page contains useful information."],
  ["This guide provides helpful informations.", "This guide provides helpful information."],
  ["The report includes important informations.", "The report includes important information."],
  ["This document contains relevant informations.", "This document contains relevant information."],
  ["The guide includes detailed informations.", "The guide includes detailed information."],
  ["This page provides additional informations.", "This page provides additional information."],
  ["The report contains useful informations.", "The report contains useful information."],
  ["This guide includes relevant informations.", "This guide includes relevant information."],
  ["The document provides detailed informations.", "The document provides detailed information."],
  ["The page includes important informations.", "The page includes important information."],
  ["This report provides additional informations.", "This report provides additional information."],
  ["The document contains helpful informations.", "The document contains helpful information."],
  ["Thanks for the helpful advices.", "Thanks for the helpful advice."],
  ["Thank you for your useful advices.", "Thank you for your useful advice."],
  ["We appreciate the practical advices.", "We appreciate the practical advice."],
  ["I appreciate your valuable advices.", "I appreciate your valuable advice."],
  ["Thanks for your thoughtful advices.", "Thanks for your thoughtful advice."],
  ["Thank you for the excellent advices.", "Thank you for the excellent advice."],
  ["We appreciate your helpful advices.", "We appreciate your helpful advice."],
  ["I appreciate the useful advices.", "I appreciate the useful advice."],
  ["Thanks for the practical advices.", "Thanks for the practical advice."],
  ["Thank you for your valuable advices.", "Thank you for your valuable advice."],
  ["We appreciate the thoughtful advices.", "We appreciate the thoughtful advice."],
  ["I appreciate your excellent advices.", "I appreciate your excellent advice."],
  ["We need the new equipments.", "We need the new equipment."],
  ["They use our old equipments.", "They use our old equipment."],
  ["You bought your necessary equipments.", "You bought your necessary equipment."],
  ["We ordered the available equipments.", "We ordered the available equipment."],
  ["They checked our basic equipments.", "They checked our basic equipment."],
  ["You tested the standard equipments.", "You tested the standard equipment."],
  ["We use your necessary equipments.", "We use your necessary equipment."],
  ["They bought the available equipments.", "They bought the available equipment."],
  ["You ordered our new equipments.", "You ordered our new equipment."],
  ["We checked the old equipments.", "We checked the old equipment."],
  ["They tested your basic equipments.", "They tested your basic equipment."],
  ["You need the standard equipments.", "You need the standard equipment."],
  ["This is one important criteria.", "This is one important criterion."],
  ["We observed one unusual phenomena.", "We observed one unusual phenomenon."],
  ["There is 1 essential criteria.", "There is 1 essential criterion."],
  ["I recorded 1 observable phenomena.", "I recorded 1 observable phenomenon."],
  ["We selected two criterion.", "We selected two criteria."],
  ["They identified three useful criterion.", "They identified three useful criteria."],
  ["The report lists four essential criterion.", "The report lists four essential criteria."],
  ["We measured five natural phenomenon.", "We measured five natural phenomena."],
  ["They recorded six unusual phenomenon.", "They recorded six unusual phenomena."],
  ["We observed seven phenomenon.", "We observed seven phenomena."],
  ["The list includes 8 criterion.", "The list includes 8 criteria."],
  ["I observed 9 phenomenon.", "I observed 9 phenomena."],
];
test.each(repairs)("countability repair %s", (source, expected) => {
  const d = expectOneRepair(scan(source), source, expected, scan);
  expect(d.alternatives).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
});
const valid = [
  'The term "one criteria." is quoted.',
  'The heading "We need the new equipments." is reproduced.',
  'The label is "The page contains useful informations."',

  "The page contains useful information.",
  "The guide provides information about two devices.",
  "Several legal informations were filed.",
  "The court accepted the informations.",
  "The prosecution filed two informations.",
  "The page contains useful legal informations.",
  "In legal terminology, the page contains useful informations.",
  "The page contains useful informations; these are legal filings.",
  "The report includes informations about the indictment.",
  "An informations table was created.",
  "The word informations has twelve letters.",
  "The label reads informations.",
  "The page contains useful Informations.",
  "The page contains useful informations_id.",
  "The page contains useful informations.example",
  "The page contains useful informationś.",
  "The page contains useful informations about patents.",
  "The page contains three informations.",
  "The page contains many informations.",
  "The page contains these informations.",
  "The page contains useful informations technology.",
  "The page contains useful `informations`.",
  'Type "The page contains useful informations." exactly.',
  "Thanks for the helpful advice.",
  "We received two pieces of advice.",
  "The bank sent remittance advices.",
  "Shipping advices arrived today.",
  "The commercial advices were recorded.",
  "In banking, thanks for the helpful advices.",
  "Thanks for the helpful advices; these are remittance notices.",
  "The advices from abroad reached the trader.",
  "The word advices is plural.",
  "The message says advices.",
  "Thanks for three helpful advices.",
  "Thanks for several advices.",
  "Thanks for these advices.",
  "Thanks for your advices on trade.",
  "Thanks for the helpful Advices.",
  "Thanks for the helpful advicesMode.",
  "Thanks for the helpful advices.example",
  "Thanks for the helpful adviceś.",
  "Thanks for the helpful advices column.",
  "Thanks for the helpful\nadvices.",
  "Thanks for the helpful `advices`.",
  'The example "Thanks for the helpful advices." is incorrect.',
  "Thank you for",
  "We need three pieces of equipment.",
  "We need the new equipment.",
  "The technician bought two coffees.",
  "She described several experiences.",
  "The gallery contains three works.",
  "These data are incomplete.",
  "This data is incomplete.",
  "We ordered three papers.",
  "There is less water today.",
  "We have fewer devices now.",
  "We need three equipments.",
  "We need several equipments.",
  "We need these equipments.",
  "We need the new Equipments.",
  "We need the new equipments_id.",
  "We need the new equipments.example",
  "We need the new equipmentś.",
  "We need the new equipments catalogue.",
  "In regional terminology, we need the new equipments.",
  "We need the new equipments; this is patent terminology.",
  'Type "We need the new equipments." exactly.',
  "We need the new `equipments`.",
  "We need the new\nequipments.",
  "This is one important criterion.",
  "We observed one phenomenon.",
  "We selected two criteria.",
  "They recorded three phenomena.",
  "We selected a criteria.",
  "The criteria is unclear.",
  "We observed a phenomena.",
  "There are many criterion.",
  "We recorded twenty one phenomena.",
  "We selected one hundred one criteria.",
  "We recorded 1,001 phenomena.",
  "We recorded 1 001 phenomena.",
  "We recorded 1.1 phenomena.",
  "We recorded 11 phenomena.",
  "We selected one or two criterion.",
  "We selected two to three criterion.",
  "This is model 1 criteria.",
  "See section one criteria.",
  'The term "one criteria" appears here.',
  'Write "one criteria" exactly.',
  "We selected 1 Criteria.",
  "We observed one phenomena_id.",
  "We observed one phenomena.example",
  "We observed one phenomená.",
];
test.each(valid)("countability preserves %s", (text) => expect(scan(text)).toEqual([]));
test("countability preserves quantities, protected evidence and independent controls", () => {
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
  for (const [text] of [repairs[0], repairs[12], repairs[24], repairs[36]]) {
    expectReviewGuards(
      (text, extra, options) =>
        review(text, extra, { enabledRules: [rule], ...options }).diagnostics,
      text,
      scan(text)[0],
      { protectedReason: "structure" },
    );
    expect(review(text, {}, { enabledRules: [] }).diagnostics).toEqual([]);
  }
  expect(scan("The page contains useful\uFFFC informations.")).toEqual([]);
  expect(scan("Thanks for the\tuseful advices.")).toHaveLength(1);
  expect(scan("We need the\u00a0new equipments.")).toHaveLength(1);
});
test("countability owns one chunk and exposes all specialist evidence", () => {
  const text =
    '😀 Café.\r\nShe said, "Thanks for the helpful advices." This is one important criteria.';
  const expected = scan(text);
  expect(expected).toHaveLength(2);
  expectChunkSplitParity(prepared(text, {}, { enabledRules: [rule] }), text, expected);
  const base = "The page contains useful informations; ordinary prose.";
  const d = scan(base)[0];
  expect(d.context.end).toBe(base.length);
  expect(scan(base.replace("ordinary prose", "legal terminology"))).toEqual([]);
});
