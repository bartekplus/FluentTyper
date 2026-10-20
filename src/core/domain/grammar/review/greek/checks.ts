import { namedExampleBefore } from "../exampleCues";
import type { FrameRef, MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { bareGreek, isGreek, keepsFinalNu } from "./phonology";

type Finding = Omit<RawFinding, "ruleId" | "messageKey">;

/** A match outside named examples whose `target` word is not in the user dictionary. */
const typed = (m: RegExpExecArray, ctx: DetectContext) =>
  !namedExampleBefore(ctx.text, m.index) && !ctx.dictionary.has(m.groups!.target.toLowerCase());

/** The finding of `frame`. */
const as = (frame: FrameRef, f: Finding): RawFinding => ({
  ruleId: frame.ruleId,
  messageKey: frame.messageKey,
  ...f,
});

/** The word before `at` in lowercase, "" at a clause boundary. */
function wordBefore(text: string, at: number): string {
  return /(\p{L}+['’]?)[ \t ]+$/u.exec(text.slice(Math.max(0, at - 24), at))?.[1] ?? "";
}

/** A ν or Ν in the typed word's case. */
const withNu = (word: string) =>
  word + (word.length > 1 && word === word.toUpperCase() ? "Ν" : "ν");

const finding = (m: RegExpExecArray, alternative: string, extra: Partial<Finding> = {}) => {
  const end = m.index + m.groups!.target.length;
  return {
    range: { start: m.index, end },
    alternatives: [alternative],
    context: { start: m.index, end: end + m.groups!.gap.length + m.groups!.next.length },
    ...extra,
  };
};

const ARTICLES = new Set("ο η οι το τα τον την τη του της των τους τις".split(" "));

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

const PREPOSITION =
  /(?<!\p{L})(?:(?:γι|σ|μ|απ|κατ|μετ|παρ)['’][ \t ]*|(?:για|σε|με|από|προς|χωρίς|κατά|μετά|παρά|ως|μέχρι|έως)[ \t ]+)$/iu;

const LEAD = /(?:(?:από|απ['’]|για|ως|μέχρι|και|κι)[ \t ]+)?$/iu;
const SENTENCE_START = /[.!;;?…\n][ \t "«“‘'(]*$/u;
const AT_START = /^[ \t "«“‘'(]*$/u;

// Words that can also be an adjective or a noun ("Αντίθετα αποτελέσματα", "Τέλος
// εποχής") need a clause right after them: an article, a pronoun or a particle.
const AMBIGUOUS = new Set(["αντιθετα", "τελος", "ναι", "οχι", "επιπλεον"]);
const CLAUSE_OPENERS = new Set([
  ...ARTICLES,
  ..."θα να δεν δε μην μη ας εγω εσυ αυτος αυτη αυτο εμεις εσεις αυτοι αυτες αυτα καθε ολοι ολα ολες".split(
    " ",
  ),
]);

// Words in -ω that are not verbs: adverbs, numerals, pronouns.
const NOT_VERBS = new Set("εδω πισω πανω κατω εξω μεσω ανω οκτω οχτω εγω λογω ηχω".split(" "));

/** "κι" spelled out as "και" in the typed word's case. */
const kai = (word: string) => (word === word.toUpperCase() ? "ΚΑΙ" : word[0] + "αι");

/** The named frame fixes of grammar/rules/el.yaml (`fixer:`). */
export const FIXERS = {
  missingNu: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    if (!keepsFinalNu(next)) return null;
    const lower = bareGreek(word);
    const before = bareGreek(wordBefore(ctx.text, m.index));
    if (lower === "μη" && before !== "να" && before !== "ας") return null;
    if (lower.endsWith("τη") && before === "εν") return null;
    if (lower === "δε") {
      if (ARTICLES.has(before) || CONJUNCTIONS.has(bareGreek(next))) return null;
      const clause = ctx.text.slice(Math.max(0, m.index - 120), m.index);
      if (/(?<!\p{L})μεν(?!\p{L})/iu.test(clause.split(/[.;!\n]/).at(-1)!)) return null;
    }
    return as(
      frame,
      finding(m, withNu(word), lower === "δε" ? { bulkBlock: "context-dependent" } : {}),
    );
  },
  kiConsonant: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    if (!isGreek(next) || !CONSONANT.test(bareGreek(next))) return null;
    return as(frame, finding(m, kai(word)));
  },
  extraNu: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    if (keepsFinalNu(next) !== false) return null;
    // "Το δεν γράφεται…": a word cited after an article is not negating anything.
    if (/^(?:δεν|μην)$/iu.test(word) && ARTICLES.has(bareGreek(wordBefore(ctx.text, m.index))))
      return null;
    return as(frame, finding(m, word.slice(0, -1)));
  },
  masculineTon: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    const noun = bareGreek(next);
    if (!isGreek(next) || !(MASCULINE.has(noun) || MASCULINE_SUFFIX.test(noun))) return null;
    // "ένα" before a masculine noun is the article "έναν", never the neuter numeral.
    // "αυτό το λόγο" -> "αυτόν τον λόγο": the demonstrative agrees too.
    const lead = /(?<!\p{L})(αυτό|εκείνο)([ \t ]+)$/iu.exec(
      ctx.text.slice(Math.max(0, m.index - 12), m.index),
    );
    const found = finding(m, withNu(word));
    if (lead) {
      found.range.start = m.index - lead[0].length;
      found.context.start = found.range.start;
      found.alternatives = [withNu(lead[1]) + lead[2] + withNu(word)];
    }
    return as(frame, found);
  },
  aytinAfterPreposition: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    if (!keepsFinalNu(next) || ARTICLES.has(bareGreek(next))) return null;
    if (!PREPOSITION.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) return null;
    return as(frame, finding(m, withNu(word)));
  },
  perfectForm: (m, ctx, frame) => {
    const word = m.groups!.target;
    const start = m.index + m[0].length - word.length;
    if (start < ctx.from || start >= ctx.to || NOT_VERBS.has(bareGreek(word))) return null;
    if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index))
      return null;
    return as(frame, {
      range: { start: start + word.length - 1, end: start + word.length },
      alternatives: [word.endsWith("ώ") ? "εί" : "ει"],
      context: { start: m.index, end: start + word.length },
    });
  },
  questionAccent: (m, ctx, frame) => {
    const word = m[0];
    if (word.length > 1 && word === word.toUpperCase()) return null;
    if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index))
      return null;
    const from = Math.max(0, m.index - 40);
    const before = ctx.text.slice(from, m.index).replace(LEAD, "");
    if (!SENTENCE_START.test(before) && !(from === 0 && AT_START.test(before))) return null;
    const end = m.index + word.length;
    const rest = /[.!;;?…\n]/u.exec(ctx.text.slice(end, end + 300));
    if (!rest || !";;?".includes(rest[0])) return null;
    return as(frame, {
      range: { start: m.index, end },
      alternatives: [word.replace(/υ$/u, "ύ").replace(/ω(?=ς$)/u, "ώ")],
      context: { start: m.index, end: end + rest.index + 1 },
    });
  },
  formalKai: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    // "Κι όμως", "κι αν", "από πού κι ως πού" are fixed in this form.
    if (
      !isGreek(next) ||
      CONSONANT.test(bareGreek(next)) ||
      /^(?:ομως|ως|αν)$/u.test(bareGreek(next))
    )
      return null;
    return as(frame, finding(m, kai(word)));
  },
  introComma: (m, ctx, frame) => {
    if (!typed(m, ctx)) return null;
    const { target: word, next } = m.groups!;
    const from = Math.max(0, m.index - 8);
    const before = ctx.text.slice(from, m.index);
    if (!SENTENCE_START.test(before) && !(from === 0 && AT_START.test(before))) return null;
    const bare = bareGreek(word);
    if (AMBIGUOUS.has(bare) && !CLAUSE_OPENERS.has(bareGreek(next))) return null;
    if (bare === "οχι") {
      const end = m.index + word.length;
      const clause = ctx.text.slice(end, end + 200).split(/[.;;!?\n]/)[0];
      if (!/(?<!\p{L})(?:δεν|δε|μην|ούτε)(?!\p{L})/iu.test(clause)) return null;
    }
    return as(frame, finding(m, `${word},`));
  },
  // The first mark of "!!" or "…." is the one mark to keep.
  oneMark: (m, ctx, frame) =>
    namedExampleBefore(ctx.text, m.index)
      ? null
      : as(frame, {
          range: { start: m.index, end: m.index + m[0].length },
          alternatives: [m[0][0]],
        }),
} satisfies Record<string, MatchFixer>;
