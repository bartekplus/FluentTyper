import { describe, expect, test } from "bun:test";
import {
  finiteVerb,
  impersonalVerb,
  pastByShape,
} from "../../src/core/domain/grammar/review/polish/lexicon";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULE = "polishMissingComma";
const KEYS = ["review_msg_pl_run_on", "review_msg_pl_participle_comma"];

function findings(text: string) {
  return detectReviewDiagnostics(
    { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: [RULE] as never,
      lang: "pl_PL",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => KEYS.includes(d.messageKey));
}

describe("Polish clause boundaries", () => {
  test.each([
    // An adverbial participle phrase after its clause.
    ["Szedł powoli rozglądając się na boki.", "Szedł powoli, rozglądając się na boki."],
    ["Wyszła z pokoju nie zamykając drzwi.", "Wyszła z pokoju, nie zamykając drzwi."],
    // A past form the lexicon does not list still closes the clause before the participle.
    ["Rozbawił gości zabawiając ich anegdotami.", "Rozbawił gości, zabawiając ich anegdotami."],
    ["Pracował całą noc pijąc mocną kawę.", "Pracował całą noc, pijąc mocną kawę."],
    // A parenthetical "krótko mówiąc" inside the sentence.
    ["Wynik był krótko mówiąc fatalny.", "Wynik był, krótko mówiąc, fatalny."],
    // A contrasting "a" between two clauses.
    [
      "Marek gotował obiad a Ola nakrywała do stołu.",
      "Marek gotował obiad, a Ola nakrywała do stołu.",
    ],
    // A relative clause left open before the main verb.
    [
      "Książki, które chciałem przeczytać leżały na półce.",
      "Książki, które chciałem przeczytać, leżały na półce.",
    ],
    [
      "Pies, którego wczoraj znalazłem nie ma obroży.",
      "Pies, którego wczoraj znalazłem, nie ma obroży.",
    ],
    // A contrasting "a" after "miał" + infinitive ("miał" is also a noun).
    ["Ojciec miał naprawić kran a mama gotowała.", "Ojciec miał naprawić kran, a mama gotowała."],
    // "to" answering a conditional clause.
    [
      "Jeśli w sklepie nie będzie chleba i mleka to kupimy je jutro.",
      "Jeśli w sklepie nie będzie chleba i mleka, to kupimy je jutro.",
    ],
  ])("fixes %p", (text, fixed) => {
    const found = findings(text);
    expect(found).toHaveLength(1);
    expect(applyEdits(text, found[0].alternatives[0].edits)).toBe(fixed);
  });

  test.each([
    // Two clauses with no comma or conjunction between them.
    ["Kupiłem chleb zapomniałem o mleku.", "zapomniałem"],
    ["Wczoraj padało dzisiaj świeciło słońce.", "świeciło"],
    // A participle phrase opening the sentence without its closing comma.
    ["Zrobiwszy zakupy wróciła do domu.", "Zrobiwszy"],
    ["Wracając z pracy spotkałem sąsiada.", "Wracając"],
    ["Mówiła, że mając wolne pojedzie nad morze.", "mając"],
    // A purpose phrase opening the sentence without its closing comma.
    ["Aby zdać egzamin student musi się uczyć.", "musi"],
    ["Żeby zrozumieć ten wiersz musimy znać epokę.", "musimy"],
  ])("warns about %p", (text, word) => {
    expect(findings(text).map((d) => d.original)).toEqual([word]);
  });

  test.each([
    "Wracając z pracy, spotkałem sąsiada.",
    "Jadł stojąc.",
    "Będzie długo pracował nad tym.",
    "Robił będzie wszystko po swojemu.",
    "Powinien był to zrobić wcześniej.",
    "Trzeba będzie to zrobić jutro.",
    "Można było przyjść wcześniej.",
    "Kupiłem chleb i zapomniałem o mleku.",
    "Jechaliśmy między Krakowem a Warszawą.",
    "Począwszy od jutra pracujemy krócej.",
    "Chcąc nie chcąc musiał iść.",
    "Wyjechał, to znaczy zerwał kontakt.",
    "Szukali na chybił trafił.",
    "Mieszkał w Osunie, a pracował w mieście.",
    "Był to nowszy model.",
    "Pierwszy przyszedł Marek.",
    "Bawię się muszą nóżką.",
    "Gdyby wiedział, toby przyszedł.",
    "Aby zdać egzamin, student musi się uczyć.",
    "Żeby był szczęśliwy, kupił mu psa.",
    "Jeśli zrobisz to dobrze, dostaniesz nagrodę.",
    "Gdy zobaczył to zdjęcie poczuł radość.",
    "Skoro kupiłeś to wino wypijmy je.",
    "On będzie w stanie przywołać pomoc.",
    "Wolała zostać niż wrócić.",
    "Siano leżało w stodole.",
  ])("leaves %p", (text) => {
    expect(findings(text)).toEqual([]);
  });

  test("finite verbs are told from nouns and adjectives", () => {
    expect(finiteVerb("kupiłem")).toBe(true);
    expect(finiteVerb("jest")).toBe(true);
    expect(finiteVerb("szkoła")).toBe(false);
    expect(finiteVerb("mały")).toBe(false);
    expect(finiteVerb("stanie")).toBe(false); // also "w stanie"
    expect(pastByShape("rozbawił")).toBe(true);
    expect(pastByShape("rzekł")).toBe(true);
    expect(pastByShape("mili")).toBe(false);
    expect(pastByShape("kanał")).toBe(false);
    expect(impersonalVerb("szorowano")).toBe(true);
    expect(impersonalVerb("zrobiono")).toBe(true);
    expect(impersonalVerb("zaczęto")).toBe(true);
    expect(impersonalVerb("wypito")).toBe(true);
    expect(impersonalVerb("siano")).toBe(false);
    expect(impersonalVerb("rano")).toBe(false);
    expect(impersonalVerb("zielono")).toBe(false);
  });

  test("no chunk stalls on long comma-free runs", () => {
    const slowest = (text: string) => {
      const prepared = prepareReview(
        { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
        {
          lang: "pl_PL",
          enabledRules: [RULE] as never,
          userDictionary: [],
          insertSpaceAfterAutocomplete: true,
        },
      );
      let max = 0;
      for (const chunk of reviewChunks(prepared)) {
        const start = performance.now();
        scanReviewChunk(prepared, chunk);
        max = Math.max(max, performance.now() - start);
      }
      return max;
    };
    slowest("kupiłem idąc był ".repeat(50));
    for (const text of [
      "kupiłem idąc był ".repeat(600),
      "zrobiwszy który powiedział a mając ".repeat(300),
      "słowo ".repeat(3_000),
    ])
      expect(slowest(text)).toBeLessThan(100);
  });
});
