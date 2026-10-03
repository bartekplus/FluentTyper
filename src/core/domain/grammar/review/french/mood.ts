import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  conjugate,
  IL,
  ILS,
  isInflectedNoun,
  JE,
  NOUS,
  TU,
  verbReadings,
  VOUS,
  type VerbReading,
} from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

// Mood and tense read from closed triggers: "il faut que", "bien que", "vouloir que" take the
// subjunctive; "si" (if) takes the imperfect, never the conditional; "j'aurai aimé" and "je
// viendrais demain" mix up the conditional and the future, which sound alike in the first person.
// Tense positions in the generated conjugations: 1 present, 2 imperfect, 4 future, 5 conditional.

const RULE = "frenchMood";
const SUBJUNCTIVE = "review_msg_fr_subjunctive";
const CONDITIONAL = "review_msg_fr_conditional";
const PRESENT = 1;
const IMPERFECT = 2;
const FUTURE = 4;
const CONDITIONAL_TENSE = 5;

const PERSON: Record<string, number> = {
  je: JE,
  "j'": JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  ce: IL,
  "c'": IL,
  cela: IL,
  ça: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
const PERSONS = [JE, TU, IL, NOUS, VOUS, ILS];
const DETERMINERS = new Set(
  (
    "le la les l' un une des du ce cet cette ces mon ma mes ton ta tes son sa ses notre nos " +
    "votre vos leur leurs chaque"
  ).split(" "),
);
const NEGATION = new Set(["ne", "n'"]);
// Words after which a noun phrase continues with a complement: the verb is further on.
const COMPLEMENT = new Set("de d' du des qui que qu' dont où à au aux".split(" "));

// Subjunctive forms the regular stems do not give.
const IRREGULAR: Record<string, string[]> = {
  être: ["sois", "sois", "soit", "soyons", "soyez", "soient"],
  avoir: ["aie", "aies", "ait", "ayons", "ayez", "aient"],
  aller: ["aille", "ailles", "aille", "allions", "alliez", "aillent"],
  faire: ["fasse", "fasses", "fasse", "fassions", "fassiez", "fassent"],
  pouvoir: ["puisse", "puisses", "puisse", "puissions", "puissiez", "puissent"],
  savoir: ["sache", "saches", "sache", "sachions", "sachiez", "sachent"],
  vouloir: ["veuille", "veuilles", "veuille", "voulions", "vouliez", "veuillent"],
  valoir: ["vaille", "vailles", "vaille", "valions", "valiez", "vaillent"],
  falloir: ["", "", "faille", "", "", ""],
  pleuvoir: ["", "", "pleuve", "", "", ""],
};

/** The present subjunctive of a verb for one person: "ils prennent" -> "prenne". */
function subjunctive(reading: VerbReading, person: number): string | null {
  const index = PERSONS.indexOf(person);
  const irregular = IRREGULAR[reading.lemma];
  if (irregular) return irregular[index] || null;
  let form: string | undefined;
  if (person === NOUS || person === VOUS)
    form = conjugate({ ...reading, tense: IMPERFECT }, person)[0];
  else {
    const plural = conjugate({ ...reading, tense: PRESENT }, ILS)[0];
    if (!plural?.endsWith("ent")) return null;
    form = plural.slice(0, -3) + ["e", "es", "e", "", "", "ent"][index];
  }
  if (!form || !verbReadings(form).some((r) => r.lemma === reading.lemma)) return null;
  // Variant spellings ("asseoir") upset the tense order: keep only subjunctive endings.
  if (!/(?:e|es|ent|ions|iez)$/.test(form)) return null;
  return form;
}

const lowest = (mask: number) => mask & -mask;
const finiteOf = (word: string, tense: number) =>
  verbReadings(word).filter((r) => typeof r.slot === "number" && r.tense === tense);

// Triggers of the subjunctive just before "que".
const WILL = new Set(
  (
    "vouloir souhaiter exiger ordonner désirer préférer aimer falloir craindre redouter regretter " +
    "douter attendre permettre refuser interdire empêcher suffire demander déplorer"
  ).split(" "),
);
const CONJUNCTIONS = new Set(["pour", "afin", "avant", "sans", "pourvu"]);
const IMPERSONAL = new Set(
  (
    "important nécessaire essentiel indispensable possible impossible normal temps urgent " +
    "préférable souhaitable naturel rare juste inadmissible inacceptable étonnant regrettable " +
    "utile dommage triste logique honteux"
  ).split(" "),
);
const EMOTION =
  /^(?:content|ravi|heureu[sx]|heureuse|surpris|étonné|triste|désolé|fier|fière|furieu[sx]|furieuse|déçu|fâché|soulagé)(?:e?s?)$/;
const DEGREE = new Set(["si", "tellement", "tant", "assez", "trop", "aussi", "plus", "moins"]);
const SKIPPED = new Set(["pas", "plus", "jamais", "vraiment", "absolument", "beaucoup", "bien"]);
const ETRE = new Set(["est", "était", "sera", "serait", "soit", "fut"]);

const participle = (word: string) => verbReadings(word).some((r) => r.slot === "Q");
const isFinite = (word: string) => verbReadings(word).some((r) => typeof r.slot === "number");
// A finite form, or "fallu" ("il a fallu que").
const hasLemma = (word: string, lemmas: Set<string>) =>
  verbReadings(word).some(
    (r) => lemmas.has(r.lemma) && (typeof r.slot === "number" || r.lemma === "falloir"),
  );

function triggersSubjunctive(before: Token[]): boolean {
  const [b0, b1, b2] = before.map((t) => t.w);
  if (!b0) return false;
  if (b0 === "bien") return !b1 || !isFinite(b1);
  if (CONJUNCTIONS.has(b0)) return true;
  if ((b0 === "condition" || b0 === "moins") && b1 === "à") return true;
  if ((b0 === "peur" || b0 === "crainte") && b1 === "de") return true;
  if (b0 === "attendant" && b1 === "en") return true;
  if (b0 === "ce" && b1 === "à" && before[2]?.w === "jusqu'") return true;
  if (b0 === "dommage") return true;
  if (IMPERSONAL.has(b0) || b0 === "probable") {
    if (b0 === "probable" && b1 !== "peu") return false;
    const verb = b0 === "probable" ? b2 : b1;
    return !!verb && ETRE.has(verb);
  }
  if (EMOTION.test(b0)) return !!b1 && !DEGREE.has(b1) && (ETRE.has(b1) || isFinite(b1));
  if (b0 === "mieux") return !!b1 && hasLemma(b1, new Set(["valoir"]));
  if ((b0 === "peut" || b0 === "pourrait") && b1 === "se") return true;
  // "faut-il que": the inverted subject after its verb.
  if (PERSON[b0] && before[1]?.hyphen) return hasLemma(before[1].w, WILL);
  let i = 0;
  while (before[i] && SKIPPED.has(before[i].w)) i++;
  if (!before[i] || !hasLemma(before[i].w, WILL)) return false;
  // "il se doute que" (suspects) takes the indicative.
  const reflexive = before[i + 1]?.w;
  return !(
    verbReadings(before[i].w).some((r) => r.lemma === "douter") &&
    ["se", "me", "te", "nous", "vous", "s'", "m'", "t'"].includes(reflexive ?? "")
  );
}

/** The verb of the clause a "que" opens, with its subject's person when a pronoun gives it. */
function clauseVerb(after: Token[], text: string): { verb: Token; person: number } | null {
  let i: number;
  let person = 0;
  const first = after[0];
  if (!first) return null;
  if (PERSON[first.w] !== undefined) {
    person = PERSON[first.w];
    i = 1;
  } else if (first.w === "chacun" || first.w === "chacune" || first.w === "quelqu'un") {
    person = IL;
    i = 1;
  } else if (DETERMINERS.has(first.w) || (/^tou/.test(first.w) && DETERMINERS.has(after[1]?.w))) {
    // "tout le monde", "toutes ces personnes".
    i = DETERMINERS.has(first.w) ? 2 : 3;
    while (after[i] && !isFinite(after[i].w) && i < 4) {
      if (COMPLEMENT.has(after[i].w)) return null;
      i++;
    }
  } else if (/^\p{Lu}/u.test(text.slice(first.start, first.end))) {
    i = 1;
  } else return null;
  while (after[i] && (NEGATION.has(after[i].w) || CLITICS.has(after[i].w))) i++;
  const verb = after[i];
  return verb ? { verb, person } : null;
}

/** "il faut que tu viens" -> "viennes", "bien qu'il est tard" -> "soit". */
function subjunctiveAfterQue(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const lower = m[0].toLowerCase().replace("’", "'");
  const before = tokensBefore(ctx.text, m.index, 4);
  if (!lower.startsWith("quoiqu") && !triggersSubjunctive(before)) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 8);
  const found = clauseVerb(after, ctx.text);
  if (!found) return null;
  const { verb } = found;
  const typed = ctx.text.slice(verb.start, verb.end);
  if (/\p{Lu}/u.test(typed) || verb.hyphen) return null;
  const readings = verbReadings(verb.w);
  // Only a form that reads as a present or future indicative and as nothing else.
  if (
    !readings.length ||
    !readings.every(
      (r) => typeof r.slot === "number" && (r.tense === PRESENT || r.tense === FUTURE),
    )
  )
    return null;
  // "que la porte ferme": a noun right after its determiner is no verb.
  if (verb === after[1] && DETERMINERS.has(after[0].w)) return null;
  if (isInflectedNoun(verb.w) && !found.person) return null;
  const forms = new Set<string>();
  for (const reading of readings) {
    const mask = found.person ? (reading.slot as number) & found.person : (reading.slot as number);
    if (!mask) continue;
    const form = subjunctive(reading, lowest(mask));
    if (form) forms.add(form);
  }
  if (forms.size !== 1 || forms.has(verb.w)) return null;
  const next = after[after.indexOf(verb) + 1];
  // "que cela va fonctionner": "aller" + infinitive is reworded, not put in the subjunctive.
  if (readings[0].lemma === "aller" && next && verbReadings(next.w).some((r) => r.slot === "I"))
    return null;
  // "qu'il est une médaille": "est" may stand for "ait" as well as "soit".
  if (readings[0].lemma === "être" && next && (DETERMINERS.has(next.w) || participle(next.w))) {
    const had = subjunctive({ ...readings[0], lemma: "avoir" }, lowest(readings[0].slot as number));
    if (had) forms.add(had);
  }
  return wordFinding(ctx, verb.start, typed, [...forms], RULE, SUBJUNCTIVE, {
    start: m.index,
    end: verb.end,
  });
}

const SUBJECT_AFTER_SI = new Set([
  "je",
  "j'",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
]);
const SI_OPENERS = new Set(["et", "mais", "ou", "même", "sauf", "comme", "car", "or", "donc"]);

/** "si j'aurais su" -> "avais", "si tu viendras" -> "viens". */
function afterSi(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const lower = m[0].toLowerCase().replace("’", "'");
  const before = tokensBefore(ctx.text, m.index, 1);
  if (before[0] && !SI_OPENERS.has(before[0].w)) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  const subject = after[0]?.w;
  // "s'il": the elided "si" holds its subject.
  if (lower === "s'") {
    if (subject !== "il" && subject !== "ils") return null;
  } else if (!subject || !SUBJECT_AFTER_SI.has(subject)) return null;
  let i = 1;
  while (after[i] && (NEGATION.has(after[i].w) || CLITICS.has(after[i].w))) i++;
  const verb = after[i];
  if (!verb || verb.hyphen) return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  if (/\p{Lu}/u.test(typed)) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || !readings.every((r) => typeof r.slot === "number")) return null;
  const person = PERSON[subject];
  const conditional = readings.every((r) => r.tense === CONDITIONAL_TENSE);
  const future = readings.every((r) => r.tense === FUTURE);
  if (!conditional && !future) return null;
  const forms = new Set<string>();
  for (const r of readings) {
    if (!((r.slot as number) & person)) continue;
    for (const form of conjugate({ ...r, tense: conditional ? IMPERFECT : PRESENT }, person))
      forms.add(form);
  }
  if (forms.size !== 1) return null;
  return wordFinding(ctx, verb.start, typed, [...forms], RULE, CONDITIONAL, {
    start: m.index,
    end: verb.end,
  });
}

// "j'aurai aimé savoir" -> "aurais": a wish in the past is a conditional.
const WISHED = new Set(["aimé", "souhaité", "préféré", "adoré", "voulu"]);
// "j'aimerais bien venir": a polite wish.
const WISHING = new Set(["aimerai", "voudrai", "préférerai", "souhaiterai"]);
const FUTURE_CUES =
  /\b(?:demain|après-demain|bientôt|plus tard|prochaine?s?|un jour|dans (?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|quelques) (?:minutes?|heures?|jours?|semaines?|mois|ans|années))\b/iu;
const SENTENCE_END = /[.!?…;:\n]/u;

function sentenceBounds(text: string, index: number): [number, number] {
  let start = index;
  while (start > 0 && !SENTENCE_END.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !SENTENCE_END.test(text[end])) end++;
  return [start, end];
}

function sentenceAround(text: string, index: number): string {
  return text.slice(...sentenceBounds(text, index));
}

// ", mais", ", et", ", donc" start a new clause. A plain comma does not: "Si tu venais, je".
const CLAUSE_BREAK =
  /(?:,[\s\u00a0]*(?:et|or|donc|car|puis)|(?<![\p{L}\p{M}\p{N}_'’-])mais)(?![\p{L}\p{M}\p{N}_'’-])/giu;

/** The text of the clause before and after the word at [start, end). */
function clauseAround(text: string, start: number, end: number): [string, string] {
  const [from, to] = sentenceBounds(text, start);
  let head = from;
  let tail = to;
  const sentence = text.slice(from, to);
  for (const b of sentence.matchAll(CLAUSE_BREAK)) {
    const breakStart = from + b.index;
    const breakEnd = breakStart + b[0].length;
    if (breakEnd <= start) head = breakEnd;
    else if (breakStart >= end && breakStart < tail) tail = breakStart;
  }
  return [text.slice(head, start), text.slice(end, tail)];
}

/** "je" or "j'" right before a verb (ne and clitics skipped). */
function firstPersonBefore(before: Token[]): boolean {
  let i = 0;
  while (before[i] && (NEGATION.has(before[i].w) || CLITICS.has(before[i].w))) i++;
  return before[i]?.w === "je" || before[i]?.w === "j'";
}

const MODALS = new Set(
  "pouvoir vouloir devoir aimer préférer souhaiter falloir valoir être avoir savoir".split(" "),
);

function futureOrConditional(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  if (/\p{Lu}/u.test(typed.slice(1)) || ctx.text[m.index + typed.length] === "-") return null;
  const word = typed.toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 4);
  if (!firstPersonBefore(before) && !(word === "aura" && before[0])) return null;
  const after = tokensAfter(ctx.text, m.index + typed.length, 4);
  const sentence = sentenceAround(ctx.text, m.index);
  const fix = (alt: string) =>
    wordFinding(ctx, m.index, typed, [alt], RULE, CONDITIONAL, {
      start: before[0]?.start ?? m.index,
      end: after[1]?.end ?? m.index + typed.length,
    });
  const infinitive = (t?: Token) => !!t && verbReadings(t.w).some((r) => r.slot === "I");
  // "j'aurai aimé savoir", "il aura aimé venir".
  if ((word === "aurai" || word === "aura") && WISHED.has(after[0]?.w ?? "")) {
    const participle = after[0].w;
    if (word === "aura" && (participle === "voulu" || !PERSON[before[0]?.w ?? ""])) return null;
    let j = 1;
    while (after[j] && CLITICS.has(after[j].w)) j++;
    if (!(after[1]?.w === "bien" || infinitive(after[j]))) return null;
    return fix(word === "aurai" ? "aurais" : "aurait");
  }
  // "j'aimerai bien partir" -> "aimerais".
  if (WISHING.has(word)) {
    if (FUTURE_CUES.test(sentence) || /\b(?:quand|lorsque?|si|s'|dès)\b/iu.test(sentence))
      return null;
    let j = 0;
    while (after[j] && ["bien", "beaucoup", "vraiment", "tant", "pas"].includes(after[j].w)) j++;
    while (after[j] && CLITICS.has(after[j].w)) j++;
    if (!infinitive(after[j])) return null;
    return fix(`${word}s`);
  }
  const readings = verbReadings(word).filter((r) => typeof r.slot === "number");
  if (!readings.length) return null;
  // Modals and auxiliaries keep a polite conditional ("je voudrais"); only a "si" clause in the
  // imperfect tells their future is wrong ("si j'avais su, je n'aurai pas" -> "aurais").
  const modal = readings.some((r) => MODALS.has(r.lemma));
  if (modal && !readings.every((r) => r.tense === FUTURE && (r.slot as number) & JE)) return null;
  const tense = readings.every((r) => r.tense === CONDITIONAL_TENSE && (r.slot as number) & JE)
    ? CONDITIONAL_TENSE
    : readings.every((r) => r.tense === FUTURE && (r.slot as number) & JE)
      ? FUTURE
      : 0;
  if (!tense) return null;
  if (tense === CONDITIONAL_TENSE) {
    // "je viendrais demain" -> "viendrai"; "si", reported speech or "mais" keep the conditional.
    if (
      !FUTURE_CUES.test(sentence) ||
      /\b(?:si|s'|que|qu'|mais|sinon|volontiers)\b/iu.test(sentence)
    )
      return null;
    if (/\b(?:place|avis)\b/iu.test(sentence)) return null;
    return fix(word.slice(0, -1));
  }
  // "je mangerai du chocolat si j'aimais ça", "Si l'on me faisait confiance, je parviendrai".
  // The "si" must sit in the clause of the verb: "Je partirai, mais si tu venais, je resterai".
  const [head, tail] = clauseAround(ctx.text, m.index, m.index + typed.length);
  const siImperfect = (part: string) => {
    const si = /(?:^|[\s,])(?:si|s')[\s ]*(?:\p{L}+['’]?[\s ]*){1,4}/iu.exec(part);
    if (!si) return false;
    return si[0].split(/[\s ’']+/u).some((w) => finiteOf(w.toLowerCase(), IMPERFECT).length > 0);
  };
  // "je saurai demain si tu étais là": "si" after savoir asks whether.
  const asks = readings.some((r) => r.lemma === "savoir");
  if (!siImperfect(head) && (asks || !siImperfect(tail))) return null;
  return fix(`${word}s`);
}

const QUE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:(?:que|quoique)(?![\p{L}\p{M}\p{N}_'’])|(?:qu|quoiqu)['’](?=\p{L}))/giu;
const SI = /(?<![\p{L}\p{M}\p{N}_'’-])(?:si(?![\p{L}\p{M}\p{N}_'’])|s['’](?=ils?\b))/giu;
// "j'aurai": the elided subject is glued on.
const FIRST_PERSON_FORMS =
  /(?<![\p{L}\p{M}\p{N}_-])(?:\p{L}+rais?|aura)(?![\p{L}\p{M}\p{N}_'’])/giu;

function moods(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, QUE)) {
    const finding = subjunctiveAfterQue(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, SI)) {
    const finding = afterSi(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, FIRST_PERSON_FORMS)) {
    const finding = futureOrConditional(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: moods }];
