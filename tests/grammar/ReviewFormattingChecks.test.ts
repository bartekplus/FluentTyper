import { describe, expect, test } from "bun:test";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview } from "./grammarTestUtils";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const review = (text: string, ruleId: CatalogRuleId, lang = "en_US") =>
  runReview(
    text,
    {},
    { lang, enabledRules: [...reviewRuleIds({ codeMode: false }), ruleId] },
  ).diagnostics.filter((d) => d.ruleId === ruleId);

/** The text with every finding's first alternative applied. */
function repaired(text: string, ruleId: CatalogRuleId, lang = "en_US"): string {
  return applyEdits(
    text,
    review(text, ruleId, lang).flatMap((d) => d.alternatives[0].edits),
  );
}

describe("comma fixes (commaPeriodSpacing)", () => {
  const rule = "commaPeriodSpacing";
  test.each([
    ["Pack the tent ,stove and map.", "Pack the tent, stove and map."],
    ["Bring tea ，milk and bread.", "Bring tea, milk and bread."],
    ["Colors: red，green、blue.", "Colors: red, green, blue."],
    ["Call Anna， then leave.", "Call Anna, then leave."],
    ["😀 Done、 thanks.", "😀 Done, thanks."],
    ["Tick 3，4 and 5.", "Tick 3, 4 and 5."],
    ["Ναι，εντάξει.", "Ναι, εντάξει."],
    ["Oui ，merci.", "Oui, merci."],
    ["It ends here，\nthen more.", "It ends here,\nthen more."],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "東京、大阪、京都に行きました。",
    "我们去了北京，然后回家。",
    "Mix ASCII、日本語 here.",
    "Lists use a , b rarely.",
    "Numbers like 1,000 stay.",
  ])("keeps %p", (input) => {
    expect(
      review(input, rule)
        .filter((d) => /[，、]/.test(d.original))
        .map((d) => d.original),
    ).toEqual([]);
  });

  test("a wide comma is batched", () => {
    expect(review("tea，milk", rule)[0].bulk).toEqual({ eligible: true, alternative: 0 });
  });
});

describe("ordinal suffix casing (englishOrdinalSuffix)", () => {
  const rule = "englishOrdinalSuffix";
  test.each([
    ["She finished 2ND in the race.", "She finished 2nd in the race."],
    ["Our 3Rd attempt worked.", "Our 3rd attempt worked."],
    ["It is the 21sT time.", "It is the 21st time."],
    ["😀 the 11TH hour", "😀 the 11th hour"],
    ["(4TH floor)", "(4th floor)"],
    ["We placed 102nD overall.", "We placed 102nd overall."],
  ])("repairs %p", (input, expected) => {
    const findings = review(input, rule);
    expect(findings.map((d) => d.bulk)).toEqual([{ eligible: false, reason: "context-dependent" }]);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "THE 3RD ROUND",
    "Turn left on 42RD today.",
    "Meet at 5TH AVE tonight.",
    "the 2nd round",
    "He is 16rd long.",
    'Never write "2ND" there.',
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });

  test("still fixes a wrong lowercase suffix", () => {
    expect(repaired("the 101nd run", rule)).toBe("the 101st run");
  });
});

describe("apostrophe look-alikes (englishContractionNormalization)", () => {
  const rule = "englishContractionNormalization";
  test.each([
    ["We don´t know yet.", "We don't know yet.", true],
    ["I´m on my way.", "I'm on my way.", true],
    ["The team´s plan works.", "The team's plan works.", true],
    ["THEY´RE LATE.", "THEY'RE LATE.", true],
    ["😀 You´ll see.", "😀 You'll see.", true],
    ["It doesn`t matter.", "It doesn't matter.", false],
    ["Sorry, I can;t come.", "Sorry, I can't come.", false],
    ["Let;s go home.", "Let's go home.", false],
    ["I think we;ve met.", "I think we've met.", false],
    ["She said it’s fine but won´t stay.", "She said it’s fine but won’t stay.", true],
  ])("repairs %p", (input, expected, batched) => {
    const found = review(input, rule);
    expect(found).toHaveLength(1);
    expect(found[0].bulk.eligible).toBe(batched);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "We don't know yet.",
    "Run `git`s help.",
    "Use a;s as a separator.",
    "Values: x;t and y;s.",
    "The sign ´ alone.",
    'Never write "don´t" like that.',
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });
});

describe("kelvin degree sign (measurementUnitFormatting)", () => {
  const rule = "measurementUnitFormatting";
  test.each([
    ["The sample sat at 77°K overnight.", "The sample sat at 77 K overnight."],
    ["Space is about 3 °K cold.", "Space is about 3 K cold."],
    ["😀 Set it to 300°K.", "😀 Set it to 300 K."],
    ["Temperatures (°K) are listed.", "Temperatures (K) are listed."],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each(["It is 300 K now.", "Use °Kelvin rarely.", "Heat to 20 °C.", "Code x°K2 here."])(
    "keeps %p",
    (input) => {
      expect(review(input, rule)).toEqual([]);
    },
  );
});

describe("ellipsis character (ellipsisShortcut, optional)", () => {
  const rule = "ellipsisShortcut";
  test("is off by default", () => {
    expect(reviewRuleIds({ codeMode: false })).not.toContain(rule);
  });

  test.each([
    ["Hold on... I found it.", "Hold on… I found it."],
    ["...and then it rained.", "…and then it rained."],
    ["Really...?", "Really…?"],
    ["He cut it short (...) later.", "He cut it short (…) later."],
    ["«Et puis...» dit-il.", "«Et puis…» dit-il."],
    ["😀 So... yes... fine.", "😀 So… yes… fine."],
  ])("offers %p individually", (input, expected) => {
    expect(review(input, rule).every((d) => !d.bulk.eligible)).toBe(true);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "Hold on… I found it.",
    "Rows 1...5 are empty.",
    "Open ../src first.",
    "Merge [...items] and f(...args).",
    "Too many.... dots.",
    "Two dots.. here.",
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });
});

describe("typed dashes (emdashShortcut, optional)", () => {
  const rule = "emdashShortcut";
  const offered = (text: string, lang = "en_US") =>
    review(text, rule, lang).map((d) => [d.original, d.alternatives.map((a) => a.preview)]);

  test("is off by default", () => {
    expect(reviewRuleIds({ codeMode: false })).not.toContain(rule);
  });

  test.each([
    ["It was late--too late.", "It was late—too late."],
    ["It was late -- too late.", "It was late — too late."],
    ["The answer --- none.", "The answer — none."],
    ["See pages 10--20.", "See pages 10–20."],
    ["😀 Wait--what?", "😀 Wait—what?"],
    ["I was going to--", "I was going to—"],
  ])("offers %p", (input, expected) => {
    expect(review(input, rule).every((d) => !d.bulk.eligible)).toBe(true);
    expect(repaired(input, rule)).toBe(expected);
  });

  test("offers both dashes for a double hyphen, in the language's order", () => {
    expect(offered("late -- too late")).toEqual([["--", ["—", "–"]]]);
    expect(offered("spät -- zu spät", "de_DE")).toEqual([["--", ["–", "—"]]]);
    expect(offered("10--20", "fr_FR")).toEqual([["--", ["–"]]]);
  });

  test.each([
    "Run it with --force now.",
    "---\ntitle: notes",
    "-- a list item",
    "Hide <!-- this --> part.",
    "Go a --> b quickly.",
    "Rules ---- here.",
    "A well-known fact.",
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });
});

describe("space outside quotation marks (quoteSpacing)", () => {
  const rule = "quoteSpacing";
  const offered = (text: string, lang = "en_US") =>
    review(text, rule, lang).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

  test("a straight quote offers both sides, the paragraph's open quotes deciding the order", () => {
    expect(offered('We called it "plan B"because it failed.')).toEqual([
      ['We called it "plan B" because it failed.', 'We called it "plan B "because it failed.'],
    ]);
    expect(offered('We called it"plan B" twice.')).toEqual([
      ['We called it "plan B" twice.', 'We called it" plan B" twice.'],
    ]);
    // A new paragraph starts counting again.
    expect(offered('One "a" two.\n\nThen"b" end.')[0][0]).toBe('One "a" two.\n\nThen "b" end.');
  });

  test.each([
    ["😀 Try “quick”mode.", "😀 Try “quick” mode."],
    ["Try“quick” mode.", "Try “quick” mode."],
    ["Er nannte es „neu“heute.", "Er nannte es „neu“ heute.", "de_DE"],
  ])("a curly quote says its side: %p", (input, expected, lang = "en_US") => {
    expect(offered(input, lang)).toEqual([[expected]]);
    expect(review(input, rule, lang)[0].bulk.eligible).toBe(false);
  });

  test.each([
    'A 5"x7" print.',
    'Set title="Home" here.',
    'He said "stop" and left.',
    "She’s here, isn’t she?",
    "Er sagte »stopp«und ging.",
  ])("keeps %p", (input) => {
    expect(review(input, rule, input.startsWith("Er") ? "de_DE" : "en_US")).toEqual([]);
  });
});

describe("prime marks (primeSymbols, optional)", () => {
  const rule = "primeSymbols";
  test("is off by default", () => {
    expect(reviewRuleIds({ codeMode: false })).not.toContain(rule);
  });

  test.each([
    ["The shelf is 6'2\" tall.", "The shelf is 6′2″ tall."],
    ["My brother is 5’ 9” and fast.", "My brother is 5′ 9″ and fast."],
    ["A lap took 1'05\" today.", "A lap took 1′05″ today."],
    ["😀 Height: 4 ' 10 \" exactly", "😀 Height: 4 ′ 10 ″ exactly"],
    ["Meet at 52°13'N, 21°00'E.", "Meet at 52°13′N, 21°00′E."],
    ["The peak is at 46°34'12\"N.", "The peak is at 46°34′12″N."],
    ["La cima está a 46°34'12\"N.", "La cima está a 46°34′12″N.", "es_ES"],
    ['Er ist 6′1" groß.', "Er ist 6′1″ groß.", "de_DE"],
  ])("offers %p", (input, expected, lang = "en_US") => {
    expect(review(input, rule, lang).every((d) => !d.bulk.eligible)).toBe(true);
    expect(repaired(input, rule, lang)).toBe(expected);
  });

  test.each([
    "The shelf is 6′2″ tall.",
    "Music from the '90s and 80's.",
    "Items '1' and '2\" are odd.",
    "Version v2'3\" build.",
    "Temperature: 20°C now.",
    "Er sagte 5 ”Äpfel” heute.",
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });
});

describe("currency symbol placement (currencySpacing, English)", () => {
  const rule = "currencySpacing";
  test.each([
    ["The ticket cost 40$ at the door.", "The ticket cost $40 at the door."],
    ["Lunch was 12.50 £ each.", "Lunch was £12.50 each."],
    ["It sold for 1,200$.", "It sold for $1,200."],
    ["😀 Only 300¥ today!", "😀 Only ¥300 today!"],
    ["Gum costs ¢50 now.", "Gum costs 50¢ now."],
    ["Prices: 5$, 8$ or 9$.", "Prices: $5, $8 or $9."],
  ])("offers %p individually", (input, expected) => {
    const found = review(input, rule);
    expect(found.every((d) => d.bulk.eligible === false)).toBe(true);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "The ticket cost $40 at the door.",
    "Gum costs 50¢ now.",
    "Solve $x + 5$ first.",
    "Run echo 5$ in a shell with $HOME set.",
    "Use var_5$ as a name.",
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });

  test.each([
    ["Il a payé 40 $ hier.", "fr_FR"],
    ["Pagou R$ 40 ontem.", "pt_BR"],
    ["Er zahlte 40$ gestern.", "de_DE"],
  ])("leaves other languages' placement alone: %p", (input, lang) => {
    expect(
      review(input, rule, lang).filter((d) => d.alternatives[0].preview.includes("$")),
    ).toEqual([]);
  });
});

describe("ellipsis length (duplicatePunctuationCollapse)", () => {
  const rule = "duplicatePunctuationCollapse";
  test.each([
    ["So..... anyway, we left.", "So... anyway, we left."],
    ["The line went dead......", "The line went dead..."],
    ["Well.... maybe tomorrow.", "Well... maybe tomorrow."],
    ["😀 Hmm..... fine.", "😀 Hmm... fine."],
    ["“Later.....” she said.", "“Later...” she said."],
    ["Alors..... on y va ?", "Alors... on y va ?"],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test("five or more dots are batched; four dots stay individual", () => {
    expect(review("It stopped..... then", rule)[0].bulk).toEqual({
      eligible: true,
      alternative: 0,
    });
    expect(review("It stopped.... then", rule)[0].bulk).toEqual({
      eligible: false,
      reason: "context-dependent",
    });
  });

  // "word.." is one period too many, not a short ellipsis.
  test.each([
    "It went quiet... then loud.",
    "Intro .......... 3",
    "Rows 2....7 are empty.",
    "Open ..../cache first.",
    "It ended ….",
  ])("keeps %p", (input) => {
    expect(review(input, rule).filter((d) => d.original.length > 2)).toEqual([]);
  });
});
