import { describe, expect, test } from "bun:test";
import {
  REVIEW_RULE_METADATA,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { chunkTimes, scan } from "./reviewHarness";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { QUOTES_WORST_CASES } from "./quotesWorstCase.fixture";

const RULE = "typographicQuotes";
const NBSP = " ";

function fix(text: string, lang: string, rules: CatalogRuleId[] = [RULE]) {
  const diagnostics = scan(text, { enabledRules: rules, lang }).filter((d) => d.ruleId === RULE);
  return {
    count: diagnostics.length,
    text: applyEdits(
      text,
      diagnostics.flatMap((d) => d.alternatives[0].edits),
    ),
  };
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Record<string, Fixture> = {
  en_US: {
    pos: [
      [
        'My aunt called it "a small miracle" at dinner.',
        "My aunt called it “a small miracle” at dinner.",
      ],
      ["We weren't ready, so we didn't go.", "We weren’t ready, so we didn’t go."],
      ['The sign read "Closed until Monday".', "The sign read “Closed until Monday”."],
      ["He typed 'maybe' and hit send.", "He typed ‘maybe’ and hit send."],
      ["Back in the '80s, few homes had one.", "Back in the ’80s, few homes had one."],
      ["The twins' bikes stood by the gate.", "The twins’ bikes stood by the gate."],
      // Nested: a straight pair inside a straight or a curly pair takes the single marks.
      [
        `She wrote, "The guide said 'turn left' at the bridge."`,
        "She wrote, “The guide said ‘turn left’ at the bridge.”",
      ],
      ['“Mom said "not now" again,” he sighed.', "“Mom said ‘not now’ again,” he sighed."],
      ["“Mom said “not now” again,” he sighed.", "“Mom said ‘not now’ again,” he sighed."],
    ],
    neg: [
      'The panel is 24" wide and 6\'2" tall.',
      'She said "wait and never finished the sentence.',
      "Already “curly” and it’s fine.",
      'Set width="40" on the element.',
      'Run `echo "hi"` in a shell.',
      'The " key sits next to Enter.',
    ],
  },
  fr_FR: {
    pos: [
      [
        'Elle a répondu "pas ce soir" sans sourire.',
        `Elle a répondu «${NBSP}pas ce soir${NBSP}» sans sourire.`,
      ],
      ["Il n'est pas venu aujourd'hui.", "Il n’est pas venu aujourd’hui."],
      ['Le panneau disait "Fermé".', `Le panneau disait «${NBSP}Fermé${NBSP}».`],
      ["Prends l'autre chemin.", "Prends l’autre chemin."],
      [
        'Il a écrit « le guide dit "à gauche" ici ».',
        "Il a écrit « le guide dit “à gauche” ici ».",
      ],
    ],
    neg: [
      "Elle a dit « bonjour » et s’est assise.",
      'Un écran de 27" suffit pour ce travail.',
      'Il a crié "attends et puis plus rien.',
      'La touche " se trouve à gauche.',
    ],
  },
  de_DE: {
    pos: [
      [
        'Sie nannte es "ein kleines Wunder" beim Essen.',
        "Sie nannte es „ein kleines Wunder“ beim Essen.",
      ],
      ["Wie geht's dir heute?", "Wie geht’s dir heute?"],
      ["Er schrieb nur 'vielleicht' zurück.", "Er schrieb nur ‚vielleicht‘ zurück."],
      ["Hast du Thomas' Fahrrad gesehen?", "Hast du Thomas’ Fahrrad gesehen?"],
      [
        `Sie sagte: "Der Schaffner rief 'Einsteigen' laut."`,
        "Sie sagte: „Der Schaffner rief ‚Einsteigen‘ laut.“",
      ],
      ["„Er rief „Halt“ und rannte.“", "„Er rief ‚Halt‘ und rannte.“"],
    ],
    neg: [
      'Der Monitor misst 27" in der Diagonale.',
      "Sie sagte „gut“ und ging.",
      'Er rief "warte und lief dann weg.',
      "Die Position ist 48°08'N.",
    ],
  },
  es_ES: {
    pos: [
      ['Dijo "mañana" sin mirarme.', "Dijo “mañana” sin mirarme."],
      ["O'Donnell llegó tarde otra vez.", "O’Donnell llegó tarde otra vez."],
      [`Escribió: "El cartel decía 'cerrado' hoy."`, "Escribió: “El cartel decía ‘cerrado’ hoy.”"],
    ],
    neg: ['La pantalla mide 32" de ancho.', "Dijo «mañana» y se fue.", 'Dijo "mañana y se fue.'],
  },
  pt_BR: {
    pos: [
      [
        'Ela chamou de "um pequeno milagre" no jantar.',
        "Ela chamou de “um pequeno milagre” no jantar.",
      ],
      ["Um copo d'água, por favor.", "Um copo d’água, por favor."],
      [
        `Ele disse: "O guia falou 'vire à esquerda' na ponte."`,
        "Ele disse: “O guia falou ‘vire à esquerda’ na ponte.”",
      ],
    ],
    neg: ['A tela tem 15" de largura.', "Ela disse “sim” e saiu.", 'Ela disse "sim e saiu.'],
  },
  pl_PL: {
    pos: [
      ['Nazwał to "małym cudem" przy obiedzie.', "Nazwał to „małym cudem” przy obiedzie."],
      [
        'Napisał: „Przewodnik mówi "skręć w lewo" przy moście”.',
        "Napisał: „Przewodnik mówi «skręć w lewo» przy moście”.",
      ],
      ["„Mama powiedziała „nie teraz” znowu”.", "„Mama powiedziała «nie teraz» znowu”."],
    ],
    neg: [
      'Ekran ma 24" przekątnej.',
      "Powiedział „dobrze” i wyszedł.",
      'Krzyknął "czekaj i uciekł.',
    ],
  },
  sv_SE: {
    pos: [
      [
        'Hon kallade det "ett litet under" vid middagen.',
        "Hon kallade det ”ett litet under” vid middagen.",
      ],
      ["Han sa 'kanske' och gick.", "Han sa ’kanske’ och gick."],
      ['Hon sa ”jag kommer "snart" hem”.', "Hon sa ”jag kommer ’snart’ hem”."],
    ],
    neg: ["Hon sa ”ja” och gick.", 'Skärmen är 24" bred.', 'Hon sa "ja och gick.'],
  },
  el_GR: {
    pos: [
      ['Το είπε "μικρό θαύμα" στο τραπέζι.', "Το είπε «μικρό θαύμα» στο τραπέζι."],
      [
        `Έγραψε: "Ο οδηγός λέει 'στρίψε αριστερά' εδώ."`,
        "Έγραψε: «Ο οδηγός λέει “στρίψε αριστερά” εδώ.»",
      ],
      ["«Η μαμά είπε «όχι τώρα» ξανά».", "«Η μαμά είπε “όχι τώρα” ξανά»."],
    ],
    neg: ["Ο Β' Παγκόσμιος Πόλεμος τελείωσε.", "Είπε «ναι» και έφυγε.", 'Είπε "ναι και έφυγε.'],
  },
  ar_SA: {
    pos: [
      ['قال "سأعود غدا" ثم خرج.', "قال “سأعود غدا” ثم خرج."],
      [`كتب: "قال الدليل 'انعطف يسارا' هنا."`, "كتب: “قال الدليل ‘انعطف يسارا’ هنا.”"],
    ],
    neg: ["قال «نعم» ثم خرج.", 'قال "نعم ثم خرج.', 'الشاشة 24" عرضا.'],
  },
  hr_HR: {
    pos: [
      ['Nazvala je to "malim čudom" za večerom.', "Nazvala je to „malim čudom“ za večerom."],
      [
        `Rekao je: "Vodič kaže 'skreni lijevo' ovdje."`,
        "Rekao je: „Vodič kaže ‚skreni lijevo‘ ovdje.“",
      ],
    ],
    neg: ["Rekla je „dobro“ i otišla.", 'Ekran ima 24" dijagonale.', 'Rekla je "dobro i otišla.'],
  },
};

describe("typographicQuotes", () => {
  test("is opt-in and runs in every named language, not in auto-detect", () => {
    const metadata = REVIEW_RULE_METADATA[RULE];
    expect(metadata.review === "supported" && metadata.defaultEnabled).toBe(false);
    for (const lang of Object.keys(FIXTURES)) expect(runsInReviewLanguage(RULE, lang)).toBe(true);
    expect(runsInReviewLanguage(RULE, "auto_detect")).toBe(false);
  });

  for (const [lang, { pos, neg }] of Object.entries(FIXTURES)) {
    test.each(pos)(`${lang} fixes %p`, (input, expected) => {
      expect(fix(input, lang).text).toBe(expected);
      // The fixed text is clean.
      expect(fix(expected, lang).count).toBe(0);
    });
    test.each(neg)(`${lang} leaves %p`, (input) => {
      expect(fix(input, lang).count).toBe(0);
    });
  }

  test("Spanish pairs are left to spanishQuotes when it is on", () => {
    const text = `Dijo "mañana" y l'otro no.`;
    const both = fix(text, "es_ES", [RULE, "spanishQuotes"]);
    expect(both.text).toBe('Dijo "mañana" y l’otro no.');
  });

  test("protected text keeps its marks", () => {
    const text = 'Type "yes" here and don\'t stop.';
    const diagnostics = scan(text, {
      enabledRules: [RULE],
      snapshot: { protectedRanges: [{ start: 5, end: 10, reason: "code" }] },
    }).filter((d) => d.ruleId === RULE);
    expect(diagnostics.map((d) => d.range.start)).toEqual([text.indexOf("'")]);
  });

  test("a long line is read in bounded segments", () => {
    const sentence = 'She said "yes" and left. ';
    const line = sentence.repeat(1_800);
    // A stray mark far away no longer leaves the whole line unpaired.
    const stray = `" ${line}`;
    const fixed = fix(stray, "en_US").text!;
    expect(fixed.slice(-sentence.length)).toBe("She said “yes” and left. ");
    expect(fixed.slice(0, 2 + sentence.length)).toBe(`" ${sentence}`);
    // A line shorter than a segment pairs as one, and a short paragraph is never cut.
    expect(fix(`" ${sentence.repeat(60)}`, "en_US").count).toBe(0);
    expect(fix(`${"Intro.\n".repeat(300)}${sentence.repeat(60)}`, "en_US").text).toBe(
      `${"Intro.\n".repeat(300)}${"She said “yes” and left. ".repeat(60)}`,
    );
  });

  test("no chunk is slow on adversarial quote runs", () => {
    for (const ms of chunkTimes(QUOTES_WORST_CASES)) expect(ms).toBeLessThan(100);
  });
});
