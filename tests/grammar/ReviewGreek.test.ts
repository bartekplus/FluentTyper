import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

function findings(ruleId: CatalogRuleId, text: string, lang = "el_GR") {
  return detectReviewDiagnostics(
    { id: "el", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, Fixture]> = [
  [
    "greekFinalNu",
    {
      pos: [
        ["Μίλησα με τη αδερφή μου.", "Μίλησα με την αδερφή μου."],
        ["Πήγαμε στη Αθήνα χθες.", "Πήγαμε στην Αθήνα χθες."],
        ["Ο Νίκος δε έρχεται σήμερα.", "Ο Νίκος δεν έρχεται σήμερα."],
        ["Του είπα να μη ανησυχεί.", "Του είπα να μην ανησυχεί."],
        ["Άφησε τη πόρτα ανοιχτή.", "Άφησε την πόρτα ανοιχτή."],
        ["Βάλε τη μπάλα στο κουτί.", "Βάλε την μπάλα στο κουτί."],
        ["Δε καταλαβαίνω τίποτα.", "Δεν καταλαβαίνω τίποτα."],
        ["Ήρθε κι το παιδί.", "Ήρθε και το παιδί."],
      ],
      neg: [
        "Μίλησα με τη μητέρα μου.",
        "Ο Πέτρος δε θέλει να έρθει.",
        "Οι μεν έφυγαν, οι δε έμειναν.",
        "Γράφουμε δε όταν ακολουθεί σύμφωνο.",
        "Η μη εφαρμογή του νόμου είναι πρόβλημα.",
        "Ήρθε κι εκείνος.",
        "Η Μαρία ήρθε στην αγορά.",
      ],
    },
  ],
  [
    "greekStrictFinalNu",
    {
      pos: [
        ["Είδα την γυναίκα του.", "Είδα τη γυναίκα του."],
        ["Πήγε στην θάλασσα.", "Πήγε στη θάλασσα."],
        ["Δεν άντεξε το ανταγωνισμό.", "Δεν άντεξε τον ανταγωνισμό."],
        ["Ρώτησα το δάσκαλο.", "Ρώτησα τον δάσκαλο."],
        ["Πήγε στο σταθμό.", "Πήγε στον σταθμό."],
        ["Ξέχασε αυτό το λόγο.", "Ξέχασε αυτόν τον λόγο."],
        ["Γι' αυτή έφυγα.", "Γι' αυτήν έφυγα."],
        ["Η Μαρία δεν θυμάται τίποτα.", "Η Μαρία δε θυμάται τίποτα."],
        ["Πρόσεξε να μην λερωθείς.", "Πρόσεξε να μη λερωθείς."],
        ["Περπατήσαμε ένα δρόμο.", "Περπατήσαμε έναν δρόμο."],
        ["Για ποιο λόγο γελάς;", "Για ποιον λόγο γελάς;"],
        ["Δε βρήκα κανένα δρόμο.", "Δε βρήκα κανέναν δρόμο."],
      ],
      neg: [
        "Είδα τη γυναίκα του.",
        "Πήγε στην αγορά.",
        "Είδα το παιδί.",
        "Το κωδικό όνομα ήταν μυστικό.",
        "Με αυτή την ιδέα συμφωνώ.",
        "Αυτή είναι η αλήθεια.",
        "Δεν ξέρω τι να πω.",
        "Μην ανησυχείς καθόλου.",
        "Το «δεν» είναι μόριο.",
        "Έφαγα ένα μήλο.",
        "Ποιο βιβλίο διάβασες;",
      ],
    },
  ],
  [
    "stylePhrasing",
    {
      pos: [
        ["Ήρθε κι αυτός στη γιορτή.", "Ήρθε και αυτός στη γιορτή."],
        ["Έφαγε κι έφυγε.", "Έφαγε και έφυγε."],
        ["Γράψε κι ένα σημείωμα.", "Γράψε και ένα σημείωμα."],
        ["Κι εγώ το πιστεύω.", "Και εγώ το πιστεύω."],
        ["Μίλησε κι η Ελένη.", "Μίλησε και η Ελένη."],
      ],
      neg: [
        "Κι όμως, γυρίζει.",
        "Από πού κι ως πού;",
        "Ήρθε και αυτός.",
        "Ήπιε καφέ κι τσάι.",
        "Τα παιδιά και οι γονείς.",
      ],
    },
  ],
  [
    "greekQuestionAccent",
    {
      pos: [
        ["Που πας;", "Πού πας;"],
        ["Πως το έκανες αυτό;", "Πώς το έκανες αυτό;"],
        ["Από που είσαι;", "Από πού είσαι;"],
        ["Καλημέρα. Που είναι το κλειδί;", "Καλημέρα. Πού είναι το κλειδί;"],
        ["Και πως θα πάμε εκεί;", "Και πώς θα πάμε εκεί;"],
      ],
      neg: [
        "Ο άνθρωπος που ήρθε είναι φίλος μου.",
        "Ξέρεις πως θα έρθει;",
        "Που και που περνάει από εδώ.",
        "Πού πας;",
        "Είπε πως θα έρθει.",
        "Γράψε «Που πας;» στον πίνακα.",
      ],
    },
  ],
  [
    "greekPunctuation",
    {
      pos: [
        ["Συνεπώς η πρόταση απορρίπτεται.", "Συνεπώς, η πρόταση απορρίπτεται."],
        ["Ναι θα έρθω αύριο.", "Ναι, θα έρθω αύριο."],
        ["Όχι δεν το είδα.", "Όχι, δεν το είδα."],
        ["Για παράδειγμα οι γάτες κοιμούνται πολύ.", "Για παράδειγμα, οι γάτες κοιμούνται πολύ."],
        ["Τι ωραία!! Ήρθες.", "Τι ωραία! Ήρθες."],
        ["Περίμενε….", "Περίμενε…"],
      ],
      neg: [
        "Αντίθετα αποτελέσματα βρέθηκαν στη μελέτη.",
        "Όχι μόνο ήρθε, αλλά έφερε και δώρα.",
        "Όχι το κόκκινο, το μπλε.",
        "Συνεπώς, η πρόταση απορρίπτεται.",
        "Τέλος εποχής για την ομάδα.",
        "Η ζωή συνεχίζεται…",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    {
      pos: [
        ["Είχα πάω εκεί.", "Είχα πάει εκεί."],
        ["Έχει φάω ήδη.", "Έχει φάει ήδη."],
        ["Έχουμε δω την ταινία.", "Έχουμε δει την ταινία."],
        ["Έχω κρατηθώ πολύ.", "Έχω κρατηθεί πολύ."],
        ["Η εν λόγο απόφαση άλλαξε.", "Η εν λόγω απόφαση άλλαξε."],
        ["Ο μέθοδος αυτή δουλεύει.", "Η μέθοδος αυτή δουλεύει."],
        ["Θα μείνεις η θα φύγεις;", "Θα μείνεις ή θα φύγεις;"],
      ],
      neg: [
        "Έχω εδώ τα κλειδιά.",
        "Έχω να πάω στο γιατρό.",
        "Είχα οκτώ μήλα.",
        "Έχει πάει σπίτι.",
        "Η μέθοδος είναι καλή.",
        "Η εν λόγω απόφαση άλλαξε.",
      ],
    },
  ],
  [
    "englishDoubledDegree",
    {
      pos: [
        ["Είναι πιο ισχυρότερο.", "Είναι ισχυρότερο."],
        ["Η πιο ανώτερη θέση.", "Η ανώτερη θέση."],
        ["Θέλω πιο περισσότερο.", "Θέλω περισσότερο."],
        ["Τρέχει πιο γρηγορότερα.", "Τρέχει γρηγορότερα."],
        ["Ήταν πιο νεότεροι.", "Ήταν νεότεροι."],
      ],
      neg: [
        "Είναι πιο ουδέτερος.",
        "Θα έρθω πιο ύστερα.",
        "Είναι πιο δυνατός.",
        "Έμεινε στη δεύτερη θέση.",
        "Πήγε πιο αριστερά.",
      ],
    },
  ],
];

describe.each(FIXTURES)("%s", (ruleId, { pos, neg }) => {
  test.each(pos)("fixes %p", (input, output) => {
    const found = findings(ruleId, input);
    expect(found.length).toBe(1);
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(output);
    expect(findings(ruleId, output)).toEqual([]);
  });
  test.each(neg)("leaves %p alone", (input) => {
    expect(findings(ruleId, input).map((d) => d.original)).toEqual([]);
  });
  test("stays out of other languages", () => {
    for (const [input] of pos)
      for (const lang of ["en_US", "fr_FR", "sv_SE", "ar_SA"])
        expect(findings(ruleId, input, lang).map((d) => d.original)).toEqual([]);
  });
});

test("a Greek chunk with many candidates scans quickly", () => {
  const options = {
    lang: "el_GR",
    enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options,
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const inputs = [
    "τη δε μη κι το που πως ".repeat(600),
    `Που ${"λέξη ".repeat(900)};`,
    "έχω έχω έχω πάω ".repeat(700),
    "πιο ".repeat(1_500) + "καλύτερος",
    "Συνεπώς ".repeat(1_000),
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
