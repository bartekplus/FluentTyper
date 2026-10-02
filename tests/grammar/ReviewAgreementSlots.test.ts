import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "agreement", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishSubjectVerbAgreement");
}

test("a noun-phrase subject agrees with its verb", () => {
  for (const [input, expected] of [
    ["The kids is outside.", "The kids are outside."],
    ["My parents was here yesterday.", "My parents were here yesterday."],
    ["The dog are hungry.", "The dog is hungry."],
    ["The leaves of the tree is yellow.", "The leaves of the tree are yellow."],
    ["Some people thinks so.", "Some people think so."],
    ["These includes a manual.", "These include a manual."],
    ["This are my notes.", "These are my notes."],
    ["Has your parents called?", "Have your parents called?"],
    ["Where is your keys?", "Where are your keys?"],
    ["Does you like it?", "Do you like it?"],
    ["Does anyone knows the answer?", "Does anyone know the answer?"],
    ["The geese honks every morning.", "The geese honk every morning."],
    ["The pale lamps burns all night.", "The pale lamps burn all night."],
    ["The rules of chess seems simple.", "The rules of chess seem simple."],
    ["Most hikers in Norway carries a map.", "Most hikers in Norway carry a map."],
    ["The kettles whistles loudly.", "The kettles whistle loudly."],
    ["This puppy have soft ears.", "This puppy has soft ears."],
    ["My neighbor don't mow the lawn.", "My neighbor doesn't mow the lawn."],
    // After a relative clause.
    [
      "The tourists who arrive late usually misses the bus.",
      "The tourists who arrive late usually miss the bus.",
    ],
    [
      "The cooks that she hired yesterday prepares lunch.",
      "The cooks that she hired yesterday prepare lunch.",
    ],
    [
      "The clerk who answers calls rarely forget a name.",
      "The clerk who answers calls rarely forgets a name.",
    ],
    ["Anyone who tries hard succeed in the end.", "Anyone who tries hard succeeds in the end."],
    // A singular head and a verb-only bare form.
    ["My uncle arrive.", "My uncle arrives."],
    ["The outcome depend on the weather.", "The outcome depends on the weather."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("collectives, objects, subjunctives and compound nouns stay silent", () => {
  for (const text of [
    "This week do you want to rest?",
    "We ask that the tenant have a key.",
    "The team have won again.",
    "The dog barks at night.",
    "The man who saw the dogs run away left.",
    "Your ticket please.",
    "We ask that the user restart the app.",
    "The bus stop at the corner.",
    "The man let us in.",
    "The nurse who helped clean the ward left.",
    "The girls who play sports.",
    "A clerk that can not find it.",
    "A new WHO report found gaps.",
    "The config files still listed the old host.",
    "The public demands answers.",
    "The pale lamps burn all night.",
    "The team are winning.",
    "The news is good.",
    "The users settings page loads.",
    "A people that loses its past suffers.",
    "This means trouble.",
    "Do your homework.",
    "The police are here.",
    "Meeting new people is fun.",
    "How many people does it take?",
    "If the county were to build it, we would go.",
    "The rich are not always happy.",
    "The solvents present in the glue are toxic.",
    "My three cats are asleep.",
    "The public demands answers.",
    "Those flips you did were great.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});

test("he/she/it before a bare verb takes the -s form where the pronoun opens its clause", () => {
  const pronounVerb = (text: string) =>
    detectReviewDiagnostics(
      { id: "he", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: ["englishPronounVerbWhitelistAgreement"],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics;
  for (const [input, expected] of [
    ["I hope she arrive soon.", "I hope she arrives soon."],
    [
      "It only cost us a dollar and it work every time.",
      "It only cost us a dollar and it works every time.",
    ],
    ["The door opened and it squeak loudly.", "The door opened and it squeaks loudly."],
  ]) {
    const found = pronounVerb(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  }
  for (const text of [
    "Let it go.",
    "We saw it happen.",
    "It need not matter.",
    "She hand stitched it.",
    "After Sam and he meet, we start.",
    "It time to go.",
  ])
    expect({ text, found: pronounVerb(text).length }).toEqual({ text, found: 0 });
});
