import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { bareGreek, isGreek, keepsFinalNu } from "./phonology";
import { isLang } from "../phraseTemplates";

type Finding = Omit<RawFinding, "ruleId" | "messageKey">;

const GAP = "[ \\t\\u00a0]+";
const BEFORE = "(?<![\\p{L}\\p{M}\\p{N}_'’@#/\\\\-])";
const NEXT = `(?<gap>${GAP})(?<next>\\p{L}[\\p{L}\\p{M}]*)`;

/** Matches of `regex` (flags g, u) whose start lies in the chunk, outside named examples. */
function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = ctx.from;
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (namedExampleBefore(ctx.text, m.index)) continue;
    if (ctx.dictionary.has(m.groups!.word.toLowerCase())) continue;
    yield m;
  }
}

/** The word before `at` in lowercase, "" at a clause boundary. */
function wordBefore(text: string, at: number): string {
  return /(\p{L}+['’]?)[ \t\u00a0]+$/u.exec(text.slice(Math.max(0, at - 24), at))?.[1] ?? "";
}

/** A ν or Ν in the typed word's case. */
const withNu = (word: string) =>
  word + (word.length > 1 && word === word.toUpperCase() ? "Ν" : "ν");

const finding = (m: RegExpExecArray, alternative: string, extra: Partial<Finding> = {}) => {
  const end = m.index + m.groups!.word.length;
  return {
    range: { start: m.index, end },
    alternatives: [alternative],
    context: { start: m.index, end: end + m.groups!.gap.length + m.groups!.next.length },
    ...extra,
  };
};

const ARTICLES = new Set("ο η οι το τα τον την τη του της των τους τις".split(" "));

const MISSING_NU = new RegExp(`${BEFORE}(?<word>τη|στη|δε|μη)${NEXT}`, "giu");
const NEUTER_TO = new RegExp(
  `${BEFORE}(?<word>το|στο|ένα|κάποιο|κανένα|ποιο|τέτοιο|ολόκληρο)${NEXT}`,
  "giu",
);
const KI = new RegExp(`${BEFORE}(?<word>κι)${NEXT}`, "giu");
const CONSONANT = /^[βγδζθκλμνξπρστφχψ]/;
// Negating "δε" cannot stand right before a conjunction: there it is cited or adversative.
const CONJUNCTIONS = new Set(
  "οταν οτι αν εαν η ενω επειδη αφου οπως ωστε οποτε αλλα ομως ουτε ειτε οσο ως".split(" "),
);
/**
 * Masculine accusatives, unaccented: their article is always "τον". Nouns of
 * common gender (ο/η πρόεδρος) and forms that are also neuter words or
 * adjectives ("ήλιο" helium, "φίλο κράτος") are left out.
 */
const MASCULINE = new Set(
  [
    "λογο χρονο δρομο κοσμο νομο ρολο στοχο τροπο τοπο φοβο πονο ουρανο καιρο σκοπο κινδυνο",
    "ανθρωπο ανεμο υπνο θανατο πολεμο λαο θεο γαμο κηπο τοιχο δημο οροφο μισθο χωρο ποταμο",
    "φορο ογκο κυκλο τυπο ορο κλαδο θορυβο στρατο δασκαλο καταλογο διαλογο ελεγχο συλλογο",
    "γιο ανιψιο εχθρο στιχο ηχο λοφο βραχο καμπο λυκο ταυρο σκυλο χορο γυρο ναο ταφο θρονο",
    "στολο φακελο νου βασιλια παππου αιωνα αγωνα αντρα πατερα μηνα αερα κανονα χαρακτηρα",
    "τομεα χειμωνα γειτονα ηρωα πινακα αξονα πυρηνα μαθητη καθηγητη πελατη επιβατη εργατη",
    "χαρτη πολιτη αθλητη ιδιοκτητη δεικτη υπολογιστη διακοπτη ανταγωνιστη",
  ]
    .join(" ")
    .split(" "),
);
// Abstract nouns in -σμός, -γμός, -χμός, -θμός are masculine ("ανταγωνισμό", "αριθμό").
const MASCULINE_SUFFIX = /(?:σμ|γμ|χμ|θμ)ο$/;

/**
 * "τη αστυνομία", "δε ξέρει", "να μη έρθει": the final ν stays before a vowel
 * or a plosive. "κι" stands only before a vowel. Adversative "δε" ("ο δε", "μεν … δε") and the
 * frozen "εν τη" keep their form.
 */
function finalNu(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, MISSING_NU)) {
    const { word, next } = m.groups!;
    if (!keepsFinalNu(next)) continue;
    const lower = bareGreek(word);
    const before = bareGreek(wordBefore(ctx.text, m.index));
    if (lower === "μη" && before !== "να" && before !== "ας") continue;
    if (lower.endsWith("τη") && before === "εν") continue;
    if (lower === "δε") {
      if (ARTICLES.has(before) || CONJUNCTIONS.has(bareGreek(next))) continue;
      const clause = ctx.text.slice(Math.max(0, m.index - 120), m.index);
      if (/(?<!\p{L})μεν(?!\p{L})/iu.test(clause.split(/[.;!\n]/).at(-1)!)) continue;
    }
    findings.push(
      finding(m, withNu(word), lower === "δε" ? { bulkBlock: "context-dependent" } : {}),
    );
  }
  for (const m of owned(ctx, KI)) {
    const { word, next } = m.groups!;
    if (!isGreek(next) || !CONSONANT.test(bareGreek(next))) continue;
    findings.push(finding(m, word === word.toUpperCase() ? "ΚΑΙ" : word[0] + "αι"));
  }
  return findings;
}

const EXTRA_NU = new RegExp(`${BEFORE}(?<word>την|στην|αυτήν|δεν|μην)${NEXT}`, "giu");
const AYTH = new RegExp(`${BEFORE}(?<word>αυτή)${NEXT}`, "giu");
const PREPOSITION =
  /(?<!\p{L})(?:(?:γι|σ|μ|απ|κατ|μετ|παρ)['’][ \t\u00a0]*|(?:για|σε|με|από|προς|χωρίς|κατά|μετά|παρά|ως|μέχρι|έως)[ \t\u00a0]+)$/iu;

/**
 * The strict school rule: the masculine "τον" keeps its ν everywhere ("το
 * ανταγωνισμό" -> "τον", common in speech-like writing), the feminine article
 * drops it before the continuants ("την λειτουργία" -> "τη"), and "αυτή" after
 * a preposition follows the article ("γι' αυτήν ξενιτεύτηκα"). "δεν" and "μην"
 * follow the same school rule ("δε θέλει", "να μη φύγεις"), though current usage
 * often keeps their ν everywhere: this rule is opt-in for that reason. Other
 * masculine determiners keep their ν too: "έναν λόγο", "για ποιον λόγο".
 */
function strictFinalNu(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, EXTRA_NU)) {
    const { word, next } = m.groups!;
    if (keepsFinalNu(next) !== false) continue;
    // "Το δεν γράφεται…": a word cited after an article is not negating anything.
    if (/^(?:δεν|μην)$/iu.test(word) && ARTICLES.has(bareGreek(wordBefore(ctx.text, m.index))))
      continue;
    findings.push(finding(m, word.slice(0, -1)));
  }
  for (const m of owned(ctx, NEUTER_TO)) {
    const { word, next } = m.groups!;
    const noun = bareGreek(next);
    if (!isGreek(next) || !(MASCULINE.has(noun) || MASCULINE_SUFFIX.test(noun))) continue;
    // "ένα" before a masculine noun is the article "έναν", never the neuter numeral.
    // "αυτό το λόγο" -> "αυτόν τον λόγο": the demonstrative agrees too.
    const lead = /(?<!\p{L})(αυτό|εκείνο)([ \t\u00a0]+)$/iu.exec(
      ctx.text.slice(Math.max(0, m.index - 12), m.index),
    );
    const found = finding(m, withNu(word));
    if (lead) {
      found.range.start = m.index - lead[0].length;
      found.context.start = found.range.start;
      found.alternatives = [withNu(lead[1]) + lead[2] + withNu(word)];
    }
    findings.push(found);
  }
  for (const m of owned(ctx, AYTH)) {
    const { word, next } = m.groups!;
    if (!keepsFinalNu(next) || ARTICLES.has(bareGreek(next))) continue;
    if (!PREPOSITION.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) continue;
    findings.push(finding(m, withNu(word)));
  }
  return findings;
}

const QUESTION = /(?<![\p{L}\p{M}])(?<word>που|πως)(?![\p{L}\p{M}'’])/giu;
const LEAD = /(?:(?:από|απ['’]|για|ως|μέχρι|και|κι)[ \t\u00a0]+)?$/iu;
const SENTENCE_START = /[.!;;?…\n][ \t\u00a0"«“‘'(]*$/u;
const AT_START = /^[ \t\u00a0"«“‘'(]*$/u;

/** "Που πας;", "Πως είσαι;": a question opened by where/how accents the word. */
function questionAccent(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  QUESTION.lastIndex = ctx.from;
  for (
    let m = QUESTION.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = QUESTION.exec(ctx.scanText)
  ) {
    const word = m[0];
    if (word.length > 1 && word === word.toUpperCase()) continue;
    if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index)) continue;
    const from = Math.max(0, m.index - 40);
    const before = ctx.text.slice(from, m.index).replace(LEAD, "");
    if (!SENTENCE_START.test(before) && !(from === 0 && AT_START.test(before))) continue;
    const end = m.index + word.length;
    const rest = /[.!;;?…\n]/u.exec(ctx.text.slice(end, end + 300));
    if (!rest || !";;?".includes(rest[0])) continue;
    findings.push({
      range: { start: m.index, end },
      alternatives: [word.replace(/υ$/u, "ύ").replace(/ω(?=ς$)/u, "ώ")],
      context: { start: m.index, end: end + rest.index + 1 },
    });
  }
  return findings;
}

const CONNECTOR = new RegExp(
  `${BEFORE}(?<word>συνεπώς|επομένως|αντιθέτως|αντίθετα|ωστόσο|εντούτοις|παρόλα αυτά|παρ['’] όλα αυτά|για παράδειγμα|επιπλέον|επιπροσθέτως|εξάλλου|κατά συνέπεια|εν κατακλείδι|συμπερασματικά|αφενός|αφετέρου|κι όμως|και όμως|πρώτον|δεύτερον|τρίτον|τέλος|ναι|όχι)${NEXT}`,
  "giu",
);
// Words that can also be an adjective or a noun ("Αντίθετα αποτελέσματα", "Τέλος
// εποχής") need a clause right after them: an article, a pronoun or a particle.
const AMBIGUOUS = new Set(["αντιθετα", "τελος", "ναι", "οχι", "επιπλεον"]);
const CLAUSE_OPENERS = new Set([
  ...ARTICLES,
  ..."θα να δεν δε μην μη ας εγω εσυ αυτος αυτη αυτο εμεις εσεις αυτοι αυτες αυτα καθε ολοι ολα ολες".split(
    " ",
  ),
]);

/** "Συνεπώς ο κανονισμός…": a comma follows a sentence-opening connector. */
function introComma(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, CONNECTOR)) {
    const { word, next } = m.groups!;
    const from = Math.max(0, m.index - 8);
    const before = ctx.text.slice(from, m.index);
    if (!SENTENCE_START.test(before) && !(from === 0 && AT_START.test(before))) continue;
    const bare = bareGreek(word);
    if (AMBIGUOUS.has(bare) && !CLAUSE_OPENERS.has(bareGreek(next))) continue;
    if (bare === "οχι") {
      const end = m.index + word.length;
      const clause = ctx.text.slice(end, end + 200).split(/[.;;!?\n]/)[0];
      if (!/(?<!\p{L})(?:δεν|δε|μην|ούτε)(?!\p{L})/iu.test(clause)) continue;
    }
    findings.push(finding(m, `${word},`));
  }
  return findings;
}

const EXCLAMATIONS = /(?<!!)!{2,}(?![!?])/gu;
const ELLIPSIS_PERIOD = /…\.(?!\.)/gu;

/** "!!" and "…." in Greek prose: one mark. */
function repeatedMarks(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const [regex, mark] of [
    [EXCLAMATIONS, "!"],
    [ELLIPSIS_PERIOD, "…"],
  ] as const) {
    regex.lastIndex = ctx.from;
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      if (namedExampleBefore(ctx.text, m.index)) continue;
      findings.push({
        range: { start: m.index, end: m.index + m[0].length },
        alternatives: [mark],
      });
    }
  }
  return findings;
}

const PERFECT = new RegExp(
  `${BEFORE}(?:έχω|έχεις|έχει|έχουμε|έχομε|έχετε|έχουν|έχουνε|είχα|είχες|είχε|είχαμε|είχατε|είχαν|είχανε)${GAP}(?<word>\\p{L}+(?:ω|ώ))(?![\\p{L}\\p{M}])`,
  "giu",
);
// Words in -ω that are not verbs: adverbs, numerals, pronouns.
const NOT_VERBS = new Set("εδω πισω πανω κατω εξω μεσω ανω οκτω οχτω εγω λογω ηχω".split(" "));

/** "Είχα πάω", "έχει φάω": the perfect takes the -ει form, not the subjunctive. */
function perfectForm(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  PERFECT.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = PERFECT.exec(ctx.scanText); m && m.index < ctx.to; m = PERFECT.exec(ctx.scanText)) {
    const word = m.groups!.word;
    const start = m.index + m[0].length - word.length;
    if (start < ctx.from || start >= ctx.to || NOT_VERBS.has(bareGreek(word))) continue;
    if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index)) continue;
    findings.push({
      range: { start: start + word.length - 1, end: start + word.length },
      alternatives: [word.endsWith("ώ") ? "εί" : "ει"],
      context: { start: m.index, end: start + word.length },
    });
  }
  return findings;
}

const KI_VOWEL = new RegExp(`${BEFORE}(?<word>κι)${NEXT}`, "giu");

/** "κι ενός" -> "και ενός": formal writing spells "και" out before a vowel too. */
function formalKai(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, KI_VOWEL)) {
    const { word, next } = m.groups!;
    // "Κι όμως", "κι αν", "από πού κι ως πού" are fixed in this form.
    if (
      !isGreek(next) ||
      CONSONANT.test(bareGreek(next)) ||
      /^(?:ομως|ως|αν)$/u.test(bareGreek(next))
    )
      continue;
    findings.push(finding(m, word === word.toUpperCase() ? "ΚΑΙ" : word[0] + "αι"));
  }
  return findings;
}

const as =
  (
    ruleId: RawFinding["ruleId"],
    messageKey: RawFinding["messageKey"],
    detect: (ctx: DetectContext) => Finding[],
  ) =>
  (ctx: DetectContext): RawFinding[] =>
    !isLang(ctx, "el") || (ctx.rules && !ctx.rules.has(ruleId))
      ? []
      : detect(ctx).map((f) => ({ ruleId, messageKey, ...f }));

/** Greek checks appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["greekFinalNu"], detect: as("greekFinalNu", "review_msg_greek_final_nu", finalNu) },
  {
    rules: ["greekStrictFinalNu"],
    detect: as("greekStrictFinalNu", "review_msg_greek_strict_final_nu", strictFinalNu),
  },
  {
    rules: ["englishPhraseCorrections"],
    detect: as("englishPhraseCorrections", "review_msg_greek_perfect_form", perfectForm),
  },
  {
    rules: ["greekQuestionAccent"],
    detect: as("greekQuestionAccent", "review_msg_greek_question_accent", questionAccent),
  },
  { rules: ["stylePhrasing"], detect: as("stylePhrasing", "review_msg_style_phrasing", formalKai) },
  {
    rules: ["greekPunctuation"],
    detect: (ctx) => [
      ...as("greekPunctuation", "review_msg_greek_intro_comma", introComma)(ctx),
      ...as("greekPunctuation", "review_msg_greek_repeated_marks", repeatedMarks)(ctx),
    ],
  },
];
