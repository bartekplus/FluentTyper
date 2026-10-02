import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { IL, isVerbHomograph, JE, TU, verbReadings, type VerbReading } from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

// Small words that sound alike (a/à, ou/où, ce/se, sa/ça, sûr/sur, son/sont, du/dû, on/ont, ma/m'a)
// told apart by the words around them. Fixed frames that need no context are phrase rows
// (phrases.ts); these frames read a subject, a verb form or a clause boundary.

const RULE = "frenchHomophones";
const MESSAGE = "review_msg_fr_homophone";

const ADVERBS = new Set(
  "pas plus jamais bien déjà encore toujours souvent beaucoup vraiment aussi même enfin tout".split(
    " ",
  ),
);
const CONJUNCTIONS = new Set(
  "et mais ou donc or car que qu' quand si puis alors comme lorsque lorsqu' puisque puisqu' où ainsi".split(
    " ",
  ),
);
const DETERMINERS = new Set(
  (
    "le la les l' un une des du au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre nos " +
    "votre vos leur leurs"
  ).split(" "),
);
// Words that open a relative or completive clause: "ce qu'il a fait a surpris" keeps its "a".
const CLAUSE_SUBJECTS = new Set(["que", "qu'", "qui", "dont", "où", "ce", "quoi"]);

const isFinite = (r: VerbReading) => typeof r.slot === "number";
const readingsOf = (word: string) => verbReadings(word);
const isAuxiliary = (word: string) =>
  readingsOf(word).some((r) => isFinite(r) && (r.lemma === "avoir" || r.lemma === "être"));
/** A verb form only: no noun or adjective spelled the same. */
const plainVerb = (word: string, test: (r: VerbReading) => boolean) =>
  !isVerbHomograph(word) && readingsOf(word).some(test);
const isParticiple = (word: string) => plainVerb(word, (r) => r.slot === "Q");
const isInfinitive = (word: string) => plainVerb(word, (r) => r.slot === "I");

/** Nothing before the token in its clause but a conjunction: it starts a clause. */
function clauseStart(tokens: Token[], i: number): boolean {
  return !tokens[i] || CONJUNCTIONS.has(tokens[i].w);
}

/** A sentence starts right before `index` (start, end mark, line break, opening quote). */
function sentenceStart(text: string, index: number): boolean {
  return /(?:^|[.!?…]|\n|[«"“(—–-])[\s  ]*$/u.test(text.slice(Math.max(0, index - 6), index));
}

/** "il à mangé", "Paul à travaillé", "ça à l'air": the verb "a" written as the preposition. */
function graveToA(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  const i = before.findIndex((t) => !CLITICS.has(t.w) || t.w === "nous" || t.w === "vous");
  const subject = before[i];
  const clitics = before.slice(0, Math.max(i, 0));
  let j = 0;
  while (after[j] && ADVERBS.has(after[j].w)) j++;
  const next = after[j];
  const fix = (alt: string) =>
    wordFinding(ctx, m.index, m[0], [alt], RULE, MESSAGE, {
      start: subject?.start ?? m.index,
      end: (next ?? after[0])?.end ?? m.index + m[0].length,
    });
  if (after[0]?.w === "été") return fix("a");
  if (!subject) return null;
  // "va-t-il à", "suffit t'il à": an inverted subject.
  const inverted =
    ctx.text[subject.start - 1] === "-" || ["t", "t'"].includes(before[i + 1]?.w ?? "");
  if (!inverted && (subject.w === "il" || subject.w === "on")) return fix("a");
  if (!inverted && subject.w === "tu" && clauseStart(before, i + 1)) return fix("as");
  if (
    !inverted &&
    ["elle", "ça", "cela"].includes(subject.w) &&
    clauseStart(before, i + 1) &&
    next &&
    (DETERMINERS.has(next.w) || isParticiple(next.w))
  )
    return fix("a");
  // A name or "qui", then a participle. A noun + "à" + participle is as often an infinitive
  // misspelt ("une eau à captée"), and "à tout" a locution ("réponse à tout").
  if (!after[0] || !isParticiple(after[0].w) || clitics.length) return null;
  const name =
    /^\p{Lu}/u.test(ctx.text.slice(subject.start, subject.end)) &&
    !sentenceStart(ctx.text, subject.start);
  return name || subject.w === "qui" ? fix("a") : null;
}

const RELATIVES = new Set(["laquelle", "lequel", "lesquels", "lesquelles"]);
// "a priori", "a cappella": Latin and Italian locutions keep their plain "a".
const LATIN = new Set(
  "priori posteriori minima maxima cappella capella contrario fortiori giorno".split(" "),
);
const STRESSED = new Set(
  "moi toi lui elle eux elles nous vous soi quoi qui ça cela ceci tout tous toutes chaque chacun plusieurs".split(
    " ",
  ),
);

/** The word after a preposition: a determiner, a stressed pronoun, a name, a number or an
 * infinitive. */
function startsNounPhrase(text: string, token: Token): boolean {
  return (
    DETERMINERS.has(token.w) ||
    STRESSED.has(token.w) ||
    /^[\p{Lu}\d]/u.test(text.slice(token.start, token.end)) ||
    readingsOf(token.w).some((r) => r.slot === "I" && r.lemma === token.w)
  );
}
const QUANTIFIERS = new Set(["rien", "beaucoup", "peu", "trop", "tant", "assez", "chose"]);

/** "je pense a toi", "j'ai répondu a ta lettre", "A la fin": the preposition missing its accent. */
function aToGrave(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (ctx.text[m.index + 1] === "-" || ctx.text[m.index - 1] === "-") return null;
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const next = after[0];
  if (!next || next.hyphen) return null;
  const fix = (context: Token | undefined) =>
    wordFinding(ctx, m.index, m[0], ["à"], RULE, MESSAGE, {
      start: context?.start ?? m.index,
      end: next.end,
    });
  // A capital "A" without its accent is tolerated typography: left alone.
  if (m[0] === "A" || LATIN.has(next.w) || next.w === "t" || next.w === "t'") return null;
  if (RELATIVES.has(next.w)) return fix(undefined);
  const previous = before[0];
  if (!previous) return null;
  // "de 6 a 10": between numbers.
  if (
    /\d$/.test(ctx.text.slice(0, m.index).trimEnd()) &&
    /^\s*\d/.test(ctx.text.slice(m.index + 1))
  )
    return fix(undefined);
  // "rien a faire", "beaucoup a apprendre".
  if (QUANTIFIERS.has(previous.w) && isInfinitive(next.w)) return fix(previous);
  // Past the clause's own subject clause ("ce qu'il pense a de l'importance") it may be the verb.
  if (tokensBefore(ctx.text, m.index, 30).some((t) => CLAUSE_SUBJECTS.has(t.w))) return null;
  if (SUBJECT_PRONOUNS.has(previous.w) || CLITICS.has(previous.w)) return null;
  // A name before it is the subject ("Maria a"), and only a noun phrase may follow the
  // preposition ("a et b", "a donc refusé" are the letter and the verb).
  if (/^\p{Lu}/u.test(ctx.text.slice(previous.start, previous.end))) return null;
  if (!startsNounPhrase(ctx.text, next)) return null;
  // A finite verb with its subject: "il pense a sa mère".
  if (
    plainVerb(previous.w, (r) => isFinite(r) && r.lemma !== "avoir" && r.lemma !== "être") &&
    !isParticiple(next.w)
  )
    return fix(previous);
  // A participle after its auxiliary: "j'ai répondu a ta lettre", "elle est partie a la poste".
  if (readingsOf(previous.w).some((r) => r.slot === "Q")) {
    let k = 1;
    while (before[k] && ADVERBS.has(before[k].w)) k++;
    const auxiliary = before[k];
    if (auxiliary && /^\p{Ll}/u.test(ctx.text[auxiliary.start]) && isAuxiliary(auxiliary.w))
      return fix(previous);
  }
  // An infinitive governed by a finite verb: "il faut parler a ta mère". After a preposition
  // the infinitive may close a subject ("le droit de voter a le droit").
  if (readingsOf(previous.w).some((r) => r.slot === "I" && r.lemma === previous.w)) {
    let k = 1;
    while (before[k] && (CLITICS.has(before[k].w) || ADVERBS.has(before[k].w))) k++;
    const head = before[k];
    if (head && plainVerb(head.w, isFinite)) return fix(previous);
  }
  return null;
}

const PLACE_TIME_NOUNS = new Set(
  (
    "jour jours fois moment moments instant endroit endroits lieu lieux pays ville villes époque " +
    "année années mois semaine soir matin période cas heure maison région monde situation " +
    "hypothèse point état temps nuit soirée journée an siècle âge quartier village pièce chambre " +
    "site page"
  ).split(" "),
);
const ASKING_VERBS = new Set(["savoir", "demander", "indiquer", "montrer", "ignorer", "expliquer"]);
const DEFINITE = new Set("le la l' les ce cet cette ces".split(" "));
const NUMBERS =
  /^(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|cent|mille)$/;

/** "le jour ou il", "je sais ou aller", "Ou sont-ils ?": "where", not "or". */
function ouToOu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 3);
  const rest = ctx.text.slice(m.index + m[0].length);
  const fix = () =>
    wordFinding(ctx, m.index, m[0], ["où"], RULE, MESSAGE, {
      start: before[0]?.start ?? m.index,
      end: after[0]?.end ?? m.index + m[0].length,
    });
  const next = after[0];
  const startsClause = (t: Token | undefined) =>
    !!t && (SUBJECT_PRONOUNS.has(t.w) || t.w === "c'" || (t.w === "l'" && after[1]?.w === "on"));
  if (m[0] === "Ou") {
    // "Ou sont mes clés ?": a question opened by "Ou" and a verb.
    const sentence = rest.split(/[.!…\n]/)[0];
    // "Ou serait-ce l'inverse ?": an inversion right after it is "or".
    if (!sentenceStart(ctx.text, m.index) || !sentence.includes("?") || !next || next.hyphen)
      return null;
    return plainVerb(next.w, isFinite) || next.w === "est" ? fix() : null;
  }
  const previous = before[0];
  if (!previous) return null;
  if (PLACE_TIME_NOUNS.has(previous.w) && startsClause(next)) {
    // "le jour ou la nuit" is "or"; a determiner before the noun keeps it a noun.
    // "un mois ou je m'abonne": only a definite noun is a time or place being named.
    if (before[1] && DEFINITE.has(before[1].w)) return fix();
  }
  let k = 0;
  while (before[k] && ["pas", "jamais", "ne", "n'"].includes(before[k].w)) k++;
  // "je ne sais pas ou aller", "dis-moi ou tu vas".
  // "dire" only with its object ("dis-moi ou"): "on dit ou on écrit" is "or".
  const imperative = before[k]?.w === "moi" && ctx.text[before[k].start - 1] === "-";
  const asking = imperative ? before[k + 1] : before[k];
  if (
    asking &&
    readingsOf(asking.w).some(
      (r) => ASKING_VERBS.has(r.lemma) || (imperative && r.lemma === "dire"),
    ) &&
    next &&
    (startsClause(next) ||
      readingsOf(next.w).some((r) => r.slot === "I") ||
      next.w === "se" ||
      next.w === "s'")
  )
    return fix();
  // "Tu vas ou ?", "Ils partent ou demain ?".
  if (/^[\s  ]*\?/u.test(rest) && readingsOf(previous.w).some(isFinite)) return fix();
  return null;
}

/** "deux où trois", "tu viens où pas ?": "or". */
function ouGraveToOu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const previousNumber =
    NUMBERS.test(before[0]?.w ?? "") || /\d\s*$/.test(ctx.text.slice(0, m.index));
  const nextNumber =
    NUMBERS.test(after[0]?.w ?? "") || /^\s*\d/.test(ctx.text.slice(m.index + m[0].length));
  const negation =
    (after[0]?.w === "pas" || after[0]?.w === "non") &&
    /^[\s  ]*[?!.]/u.test(ctx.text.slice(after[0].end));
  if (!(previousNumber && nextNumber) && !negation) return null;
  return wordFinding(ctx, m.index, m[0], ["ou"], RULE, MESSAGE);
}

/** "se renseigner sûr les prix": the preposition. */
function surGraveToSur(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (!next || !DETERMINERS.has(next.w) || next.w === "du" || next.w === "des") return null;
  const previous = before[0];
  if (
    !previous ||
    ["coup", "bien", "pas", "si", "très", "trop", "assez", "aussi", "plus", "tout"].includes(
      previous.w,
    )
  )
    return null;
  if (
    isAuxiliary(previous.w) ||
    readingsOf(previous.w).some((r) =>
      ["sembler", "paraître", "rester", "devenir", "sentir"].includes(r.lemma),
    )
  )
    return null;
  if (!plainVerb(previous.w, () => true)) return null;
  return wordFinding(ctx, m.index, m[0], ["sur"], RULE, MESSAGE, {
    start: previous.start,
    end: next.end,
  });
}

/** "il est sur d'arriver", "bien sur.": certain. */
function surToSur(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const rest = ctx.text.slice(m.index + m[0].length);
  const fix = () => wordFinding(ctx, m.index, m[0], [m[0].replace("u", "û")], RULE, MESSAGE);
  // "Bien sur." / "bien sur !": nothing for the preposition to govern.
  if (before[0]?.w === "bien" && /^[\s  ]*(?:[.!?…]|$)/u.test(rest)) return fix();
  // "il est sur d'arriver": être + sur + de + infinitive.
  if (
    before[0] &&
    isAuxiliary(before[0].w) &&
    readingsOf(before[0].w).some((r) => r.lemma === "être") &&
    (after[0]?.w === "de" || after[0]?.w === "d'") &&
    after[1] &&
    isInfinitive(after[1].w)
  )
    return fix();
  return null;
}

/** "il ce lève": the reflexive pronoun after a subject. */
function ceToSe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  let i = 0;
  if (before[0]?.w === "ne" || before[0]?.w === "n'") i = 1;
  const subject = before[i];
  if (!subject || !["il", "elle", "on", "ils", "elles"].includes(subject.w)) return null;
  if (ctx.text[subject.start - 1] === "-") return null;
  if (!next || !plainVerb(next.w, isFinite)) return null;
  return wordFinding(ctx, m.index, m[0], ["se"], RULE, MESSAGE, {
    start: subject.start,
    end: next.end,
  });
}

const ETRE_THIRD = new Set(["sont", "sera", "serait", "seront", "seraient", "fut", "furent"]);

/** "Se sont des histoires", "car se sera difficile": "ce" with no subject before. */
function seToCe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const [next, complement] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (!next || !ETRE_THIRD.has(next.w) || next.hyphen) return null;
  // A sentence start (or "car"): after a comma or "mais" the subject may be left out
  // ("les musiciens se séparent, mais se sont réunis").
  if (before.length ? before[0].w !== "car" : !sentenceStart(ctx.text, m.index)) return null;
  // "ce sont des", "ce sera une": a noun phrase follows; "se serait un jour exclamé" is not.
  if (!complement || !DETERMINERS.has(complement.w)) return null;
  const rest = tokensAfter(ctx.text, complement.end, 3);
  if (rest.some((t) => readingsOf(t.w).some((r) => r.slot === "Q") && !isVerbHomograph(t.w)))
    return null;
  return wordFinding(ctx, m.index, m[0], ["ce"], RULE, MESSAGE, {
    start: m.index,
    end: next.end,
  });
}

/** "S'est bien de venir", "Dépêche-toi, s'est urgent": "c'est" with no subject before. */
function sEstToCEst(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  // "ce que s'est dit Leo" inverts the subject: only a sentence start has none.
  if (before.length || !sentenceStart(ctx.text, m.index)) return null;
  if (/^[-–]/.test(ctx.text.slice(m.index + m[0].length))) return null;
  const elided = m[0].slice(0, 2);
  return wordFinding(ctx, m.index, elided, [`c${elided[1]}`], RULE, MESSAGE, {
    start: m.index,
    end: m.index + m[0].length,
  });
}

// "sa" is a possessive: it never stands before these, or at a clause end.
const NOT_AFTER_POSSESSIVE = new Set(
  "pour que qu' à avec comme et ou mais alors donc quand si là ici aussi encore non oui pas".split(
    " ",
  ),
);

/** "il a dit sa pour rire", "comme sa.": the pronoun "ça". */
function saToCa(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const final = /^[\s  ]*(?:[.!?…,;:)]|$)/u.test(rest);
  if (!final && !(next && !next.hyphen && NOT_AFTER_POSSESSIVE.has(next.w))) return null;
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (!before && !final) return null;
  return wordFinding(ctx, m.index, m[0], ["ça"], RULE, MESSAGE);
}

/** "il ma dit", "je la vu", "tu ta trompé": the pronoun and the auxiliary run together. */
function elidedAuxiliary(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const subject = before[0];
  if (!subject || !next || ctx.text[subject.start - 1] === "-") return null;
  const word = m[0].toLowerCase();
  const person =
    subject.w === "je"
      ? JE
      : subject.w === "tu"
        ? TU
        : ["il", "elle", "on", "qui", "ça", "cela"].includes(subject.w)
          ? IL
          : 0;
  if (!person) return null;
  const readings = readingsOf(next.w);
  if (!readings.some((r) => r.slot === "Q")) return null;
  // "il la dit", "elle la fait": a finite verb after the object pronoun.
  if (word === "la" && readings.some((r) => isFinite(r) && (r.slot as number) & person))
    return null;
  const auxiliary = person === JE ? "ai" : person === TU ? "as" : "a";
  if (word === "ma" && person === JE) return null;
  const fixed = `${word[0]}'${auxiliary}`;
  return wordFinding(ctx, m.index, m[0], [fixed], RULE, MESSAGE, {
    start: subject.start,
    end: next.end,
  });
}

const PREPOSITIONS = new Set(
  "de à avec pour dans par sur sous chez sans selon depuis pendant malgré".split(" "),
);

/** "avec sont frère": the possessive "son". */
function sontToSon(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (
    !previous ||
    !PREPOSITIONS.has(previous.w) ||
    !next ||
    ctx.text[m.index + m[0].length] === "-" ||
    ADVERBS.has(next.w)
  )
    return null;
  return wordFinding(ctx, m.index, m[0], ["son"], RULE, MESSAGE, {
    start: previous.start,
    end: next.end,
  });
}

// Infinitives that are also common nouns after "du": "il a du pouvoir", "du savoir".
const NOUN_INFINITIVES = new Set([
  "pouvoir",
  "savoir",
  "devoir",
  "vouloir",
  "dîner",
  "déjeuner",
  "goûter",
  "souper",
  "rire",
  "sourire",
  "être",
  "avoir",
  "plaisir",
]);

/** "il a du partir": the participle of devoir. */
function duToDu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  let i = 0;
  while (before[i] && ADVERBS.has(before[i].w)) i++;
  if (!before[i] || !readingsOf(before[i].w).some((r) => isFinite(r) && r.lemma === "avoir"))
    return null;
  if (!next || NOUN_INFINITIVES.has(next.w)) return null;
  if (!readingsOf(next.w).some((r) => r.slot === "I" && r.lemma === next.w)) return null;
  return wordFinding(ctx, m.index, m[0], ["dû"], RULE, MESSAGE, {
    start: before[i].start,
    end: next.end,
  });
}

/** "Ont dit que…": the pronoun "on" opening a sentence. */
function ontToOn(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (!sentenceStart(ctx.text, m.index) || ctx.text[m.index + m[0].length] === "-") return null;
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (!next) return null;
  const third = readingsOf(next.w).some((r) => isFinite(r) && ((r.slot as number) & IL) > 0);
  if (!third && !["ne", "n'", "se", "s'", "y", "en"].includes(next.w)) return null;
  return wordFinding(ctx, m.index, m[0], ["on"], RULE, MESSAGE);
}

const CANDIDATE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:à|a|A|ou|Ou|où|sûre?s?|sure?s?|[cC]e|[sS]e|[sS]['’](?:est|était)|[sS]a|ma|ta|la|sont|du|[oO]nt)(?![\p{L}\p{M}\p{N}_'’])/gu;

function homophones(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    const word = m[0];
    const lower = word.toLowerCase().replace("’", "'");
    let finding: RawFinding | null = null;
    if (lower === "à") finding = graveToA(ctx, m);
    else if (lower === "a") finding = aToGrave(ctx, m);
    else if (lower === "ou") finding = ouToOu(ctx, m);
    else if (lower === "où") finding = ouGraveToOu(ctx, m);
    else if (lower.startsWith("sû")) finding = surGraveToSur(ctx, m);
    else if (lower.startsWith("sur") || lower === "sure" || lower === "sures")
      finding = surToSur(ctx, m);
    else if (lower === "ce") finding = ceToSe(ctx, m);
    else if (lower === "se") finding = seToCe(ctx, m);
    else if (lower.startsWith("s'")) finding = sEstToCEst(ctx, m);
    else if (lower === "sa") finding = saToCa(ctx, m);
    else if (lower === "ma" || lower === "ta" || lower === "la") finding = elidedAuxiliary(ctx, m);
    else if (lower === "sont") finding = sontToSon(ctx, m);
    else if (lower === "du") finding = duToDu(ctx, m);
    else if (lower === "ont") finding = ontToOn(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: homophones }];
