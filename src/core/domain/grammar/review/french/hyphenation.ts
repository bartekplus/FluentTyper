import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  IL,
  ILS,
  adjectiveReadings,
  compoundsStartingWith,
  isDictionaryCompound,
  isFrenchWord,
  isNounLemma,
  isVerbHomograph,
  JE,
  NOUS,
  TU,
  verbReadings,
  VOUS,
} from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
} from "./frenchTokens";
import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";

// Hyphens French grammar requires: the inverted subject of a question ("pouvez-vous",
// "a-t-il", "est-ce") and the adverb "peut-être".

const RULE = "frenchHyphenation";
const MESSAGE = "review_msg_fr_hyphen";

const PERSON: Record<string, number> = {
  je: JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
const QUESTION_WORDS = new Set(
  "que qu' où comment pourquoi quand combien quel quelle quels quelles quoi qui".split(" "),
);
const CE_VERBS = new Set(["est", "était", "sera", "serait", "fut"]);
const SENTENCE_START = /(?:^|[.!?…\n])[\s\u00a0]*$/u;
// After an inverted "ce": a clause, a pronoun or a common attribute ("est-ce possible ?").
const CE_FOLLOWERS = new Set(
  (
    "que qu' qui là vrai possible grave normal bien mal juste faux exact sûr clair utile " +
    "nécessaire obligatoire important ça cela vous toi lui moi elle eux nous elles pas " +
    "vraiment encore toujours donc"
  ).split(" "),
);
// "son" is also the noun "sound" ("quel est ce son ?"): left out.
const DETERMINERS = new Set(
  "le la les l' un une des du ce cet cette ces mon ma mes ton ta tes sa ses notre nos votre vos leur leurs".split(
    " ",
  ),
);

/** The finite persons of a word as a verb that is no noun ("porte" is both). */
function persons(word: string): number {
  let mask = 0;
  for (const r of verbReadings(word)) if (typeof r.slot === "number") mask |= r.slot;
  return mask;
}

/** The sentence from `index` on ends with a question mark. */
function inQuestion(text: string, index: number): boolean {
  const end = text.slice(index, index + 300).search(/[.!?…\n]/);
  return end >= 0 && text[index + end] === "?";
}

/** "pouvez vous", "a t il", "est ce que": an inverted subject joined with hyphens. */
function inversion(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const pronoun = m.groups!.pronoun.toLowerCase();
  const verb = m.groups!.verb;
  const lower = verb.toLowerCase();
  const start = m.index;
  const end = start + m[0].length;
  const euphonic = !!m.groups!.t;
  if (namedExampleBefore(ctx.text, start) || ctx.dictionary.has(lower)) return null;
  const before = tokensBefore(ctx.text, start, 6);
  const after = tokensAfter(ctx.text, end, 2);
  let i = 0;
  while (before[i] && (CLITICS.has(before[i].w) || before[i].w === "ne" || before[i].w === "n'"))
    i++;
  // A subject before the verb ("tu viens tu manges ?") leaves nothing to invert.
  if (before.slice(0, i + 1).some((t) => SUBJECT_PRONOUNS.has(t.w) && !CLITICS.has(t.w)))
    return null;
  if (before[i] && ["ça", "cela", "ceci", "qui"].includes(before[i].w)) return null;
  if (pronoun === "ce") {
    if (!CE_VERBS.has(lower)) return null;
    // "le but est ce que tu dis": only a clause start or a question word inverts.
    if (before[i]) {
      if (
        !QUESTION_WORDS.has(before[i].w) &&
        !["et", "mais", "alors", "ou", "donc"].includes(before[i].w)
      )
        return null;
    } else if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, start - 4), start))) return null;
    // "quel est ce bruit ?": "ce" before a noun is its determiner.
    const following = after[0];
    if (following && !CE_FOLLOWERS.has(following.w) && !DETERMINERS.has(following.w)) {
      const participle = verbReadings(following.w).some((r) => r.slot === "Q");
      if (!participle || isVerbHomograph(following.w)) return null;
    }
    const next = after[0]?.w;
    if (!inQuestion(ctx.text, end) && next !== "que" && next !== "qu'" && next !== "qui")
      return null;
  } else {
    if (!euphonic && !inQuestion(ctx.text, end)) return null;
    // "As tu": a verb that is also a noun inverts only at the start or after a question word.
    const opening = !before[i] || QUESTION_WORDS.has(before[i].w);
    if (isVerbHomograph(lower) && !euphonic && !opening) return null;
    if (!(persons(lower) & PERSON[pronoun])) return null;
    // "je" after a verb in -e takes "-é-je": left to the writer.
    if (pronoun === "je" && /e$/.test(lower)) return null;
    // The pronoun is the subject of the next verb: "quand tu viens tu manges".
    const next = after[0];
    if (next && persons(next.w) & PERSON[pronoun] && !isVerbHomograph(next.w)) return null;
  }
  const third = ["il", "elle", "on"].includes(pronoun);
  // The euphonic t only between vowels: "a-t-il", but "est-il", "faut-il".
  const joiner = third && /[aeé]$/i.test(verb) ? "-t-" : "-";
  const typed = ctx.source.slice(start, end);
  const fixed = `${verb}${joiner}${m.groups!.pronoun}`;
  if (fixed === typed) return null;
  return finding(RULE, MESSAGE, start, end, [fixed]);
}

/** "il partira peut être demain", "peu être": the adverb "peut-être". */
function maybe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const start = m.index;
  if (namedExampleBefore(ctx.text, start)) return null;
  const before = tokensBefore(ctx.text, start, 2);
  const previous = before[0];
  const next = tokensAfter(ctx.text, start + m[0].length, 1)[0];
  // "Peut être résilié chaque mois.": a contract-style "can be" + participle.
  const sentenceStart =
    !previous &&
    SENTENCE_START.test(ctx.text.slice(Math.max(0, start - 4), start)) &&
    !(next && verbReadings(next.w).some((r) => r.slot === "Q"));
  // "il peut être tard" is pouvoir + être: only after another verb is it the adverb, and not
  // after a subject clause ("tout ce que vous dites peut être utilisé").
  const clauseSubject = tokensBefore(ctx.text, start, 20).some((t) =>
    ["que", "qu'", "qui", "dont", "où", "ce"].includes(t.w),
  );
  const afterVerb =
    previous &&
    !clauseSubject &&
    /^\p{Ll}/u.test(ctx.text.slice(previous.start, previous.end)) &&
    !isVerbHomograph(previous.w) &&
    verbReadings(previous.w).some((r) => typeof r.slot === "number" && r.lemma !== "pouvoir");
  // "peu être" is a slip wherever "peu" modifies nothing ("un peu être seul", "il peu" for
  // "il peut" are left alone).
  const peu =
    /^peu[ \t]/i.test(m[0]) &&
    !(previous && (PEU_BEFORE.has(previous.w) || SUBJECT_PRONOUNS.has(previous.w)));
  // "il n'est peut être pas", "il aura peut être": être and avoir also spell nouns ("est",
  // "aura") but are verbs after a subject.
  const afterAuxiliary =
    previous &&
    !clauseSubject &&
    verbReadings(previous.w).some(
      (r) => typeof r.slot === "number" && (r.lemma === "être" || r.lemma === "avoir"),
    ) &&
    !!before[1] &&
    (SUBJECT_PRONOUNS.has(before[1].w) || ["c'", "n'", "ne"].includes(before[1].w));
  // "peut être que", "bientôt peut être ?", "et peut être même plus": no verb phrase follows.
  const rest = ctx.text.slice(start + m[0].length);
  const adverbial =
    (next && ["que", "qu'", "même", "parce"].includes(next.w)) ||
    /^[\s  ]*[?!,.…]/u.test(rest) ||
    (previous && ["avec", "ainsi", "bientôt", "voire", "ou"].includes(previous.w));
  if (!sentenceStart && !afterVerb && !peu && !afterAuxiliary && !adverbial) return null;
  return finding(RULE, MESSAGE, start, start + m[0].length, [carryCase(m[0], "peut-être")]);
}

/** "il peut-être têtu" -> "peut être": pouvoir + être after a subject pronoun. */
function verbalMaybe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  let i = 0;
  if (before[0] && (before[0].w === "ne" || before[0].w === "n'")) i = 1;
  if (!before[i] || !["il", "elle", "on", "ce", "cela", "ça"].includes(before[i].w)) return null;
  // "peut*on peut-être": the pronoun of another verb.
  if (/[^\s  ]$/u.test(ctx.text.slice(0, before[i].start))) return null;
  // "il est peut-être", "il a peut-être": an auxiliary before it makes the adverb.
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (!next || verbReadings(next.w).some((r) => typeof r.slot === "number")) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return finding(RULE, MESSAGE, m.index, m.index + m[0].length, [carryCase(m[0], "peut être")], {
    context: { start: before[i].start, end: next.end },
  });
}

// Prefixes that never stand alone: "anti inflation" -> "anti-inflation", "néo-rural" ->
// "néorural"; the dictionary says which spelling exists.
const PREFIXES =
  "anti auto néo géo méga mini ultra hyper multi psycho franco afro vice vidéo micro macro post " +
  "co cyber extra inter intra semi pseudo quasi poly télé bio éco rétro zig anglo germano italo " +
  "hispano gréco judéo sino russo austro euro";
// Prefixes the dictionary may not list with a given word, which then take a hyphen: always for a
// nationality ("franco-allemandes"), before a vowel for the others ("anti-inflation").
const NATIONALITY_PREFIXES = new Set(
  "franco afro anglo germano italo hispano gréco judéo sino russo austro euro".split(" "),
);
const VOWEL_HYPHEN_PREFIXES = new Set(["anti", "ultra", "néo", "semi", "cyber", "co"]);
const CLOSING_PREFIXES = new Set(["néo", "géo", "méga", "psycho", "post", "micro", "macro"]);
// "sur", "sous" and "contre" are prepositions too: only before a participle or an infinitive.
const PREPOSITION_PREFIXES = new Set(["sur", "sous", "contre"]);

function prefixCompound(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const prefix = m.groups!.prefix;
  const word = m.groups!.word;
  const lowerPrefix = prefix.toLowerCase();
  const lowerWord = word.toLowerCase();
  if (
    /^\p{Lu}/u.test(word) ||
    ctx.dictionary.has(lowerWord) ||
    namedExampleBefore(ctx.text, m.index)
  )
    return null;
  const hyphen = typed.includes("-");
  if (PREPOSITION_PREFIXES.has(lowerPrefix)) {
    if (hyphen) return null;
    const readings = verbReadings(lowerWord);
    if (isNounLemma(lowerWord) || !readings.some((r) => r.slot === "Q" || r.slot === "I"))
      return null;
  }
  const joined = `${lowerPrefix}${lowerWord}`;
  const hyphenated = `${lowerPrefix}-${lowerWord}`;
  let fixed: string | null = null;
  if (hyphen) {
    // "anti-reflets", "auto-bronzant": many hyphenated forms are accepted spellings; only
    // learned prefixes that always close up lose the hyphen.
    if (!CLOSING_PREFIXES.has(lowerPrefix)) return null;
    if (!isFrenchWord(hyphenated) && isFrenchWord(joined) && isFrenchWord(lowerWord))
      fixed = joined;
  } else if (lowerPrefix === "sous" || lowerPrefix === "contre" || lowerPrefix === "vice") {
    if (isFrenchWord(hyphenated)) fixed = hyphenated;
  } else if (isFrenchWord(joined)) fixed = joined;
  else if (isFrenchWord(hyphenated)) fixed = hyphenated;
  // "co incidences" -> "coïncidences": a vowel after "co" takes a diaeresis when joined.
  else if (lowerPrefix === "co" && /^[ie]/.test(lowerWord)) {
    const diaeresis = `co${lowerWord[0] === "i" ? "ï" : "ë"}${lowerWord.slice(1)}`;
    if (isFrenchWord(diaeresis)) fixed = diaeresis;
  }
  // A capitalized prefix may be a name ("Nous and Co accompagne").
  if (
    !fixed &&
    !hyphen &&
    prefix === lowerPrefix &&
    (isFrenchWord(lowerWord) || adjectiveReadings(lowerWord).length > 0) &&
    (NATIONALITY_PREFIXES.has(lowerPrefix) ||
      (VOWEL_HYPHEN_PREFIXES.has(lowerPrefix) && /^[aeiouyéèêâîôûh]/.test(lowerWord)))
  )
    fixed = hyphenated;
  if (!fixed) return null;
  return finding(RULE, "review_msg_closed_compound", m.index, m.index + typed.length, [
    carryCase(typed, fixed),
  ]);
}
const PREFIX_COMPOUND = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<prefix>${PREFIXES.split(" ").join("|")}|sur|sous|contre)(?:[ \\t]+|-)(?<word>\\p{L}{3,})(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "giu",
);
const VERBAL_MAYBE = /(?<![\p{L}\p{M}\p{N}_'’-])peut-être(?![\p{L}\p{M}\p{N}_'’-])/giu;

// The pronoun after an imperative joins it: "dis-lui", "regarde-la", "prends-en".
// Verbs whose object pronoun stays with them before an infinitive ("laisse-moi faire",
// "faites-les entrer"); with others it belongs to the infinitive ("viens le voir").
const CAUSATIVE = new Set("laisser faire regarder écouter voir sentir entendre".split(" "));
// What may follow an object pronoun (never a noun, which would make "la" an article).
const AFTER_PRONOUN = new Set(
  (
    "à au aux dans sur sous avec pour en par chez vers de d' du des un une ici là bien vite " +
    "maintenant encore demain donc alors moi toi lui nous leur y"
  ).split(" "),
);
// "prends-en un", "parlez-en à ta sœur": what follows a pronoun "en" or "y".
const EN_FOLLOWERS = new Set(
  "un une des deux trois à au aux plus moins encore autant beaucoup assez davantage".split(" "),
);
const CLAUSE_OPENERS = new Set(["et", "puis", "alors", "mais", "sinon", "donc", "ou"]);

/** "Dis lui bonjour" -> "Dis-lui", "Regarde la." -> "Regarde-la". */
function imperative(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const verbTyped = m.groups!.verb;
  const verb = verbTyped.toLowerCase();
  const pronoun = m.groups!.pronoun.toLowerCase().replaceAll("’", "'");
  const start = m.index;
  const end = start + m[0].length;
  if (namedExampleBefore(ctx.text, start) || ctx.dictionary.has(verb)) return null;
  if (/\p{Lu}/u.test(verbTyped.slice(1))) return null;
  const before = tokensBefore(ctx.text, start, 1);
  if (
    before[0]
      ? !CLAUSE_OPENERS.has(before[0].w)
      : /[\p{L}\p{N}][\s  ]*$/u.test(ctx.text.slice(Math.max(0, start - 3), start))
  )
    return null;
  const readings = verbReadings(verb);
  // "Puis vous", "et complètes vous concernant": a conjunction or an adjective.
  if (verb === "puis" || adjectiveReadings(verb).length) return null;
  const imperativeForm = readings.some(
    (r) =>
      typeof r.slot === "number" &&
      r.tense === 1 &&
      (r.slot & (TU | NOUS | VOUS) || (r.slot & JE && verb.endsWith("e"))),
  );
  if (!imperativeForm) return null;
  // A capital or a question mark ahead: an inverted question, handled with the subject.
  if (
    /^[^.!\n]*\?/u.test(ctx.text.slice(end, end + 80)) &&
    (pronoun === "nous" || pronoun === "vous")
  )
    return null;
  const rest = ctx.text.slice(end);
  const next = tokensAfter(ctx.text, end, 1)[0];
  const closes = /^[\s  ]*(?:$|[.!,;:)…])/u.test(rest);
  if (!closes) {
    if (!next) return null;
    // "toi et moi", "vous aussi", "en quelques secondes", "en or": not an object pronoun.
    if (["et", "ou", "aussi", "même", "mêmes", "tous", "deux"].includes(next.w)) return null;
    if (verbReadings(next.w).some((r) => r.slot === "G")) return null;
    if ((pronoun === "en" || pronoun === "y") && !EN_FOLLOWERS.has(next.w)) return null;
    const infinitive = verbReadings(next.w).some((r) => r.slot === "I");
    if (infinitive) {
      if (!readings.some((r) => CAUSATIVE.has(r.lemma))) return null;
    } else if (!AFTER_PRONOUN.has(next.w)) {
      // "lui", "leur", "moi" are pronouns before anything but a verb; "la", "les", "le" are
      // articles before a noun.
      if (["le", "la", "les", "leur"].includes(pronoun)) return null;
      if (verbReadings(next.w).some((r) => typeof r.slot === "number")) return null;
    }
  }
  const typedPronoun = m.groups!.pronoun;
  return finding(RULE, "review_msg_closed_compound", start, end, [`${verbTyped}-${typedPronoun}`]);
}
const IMPERATIVE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<verb>\p{L}+)[ \t]+(?<pronoun>moi|toi|lui|nous|vous|leur|le|la|les|en|y|m['’]en|t['’]en)(?![\p{L}\p{M}\p{N}_'’-])/giu;

const INVERSION =
  /(?<![\p{L}\p{M}\p{N}_-])(?<verb>\p{L}+)(?:[ \t]*-[ \t]+|[ \t]+-[ \t]*|[ \t]+(?<t>t['’]|t[ \t]+|-t-|t-)[ \t]*|[ \t]+)(?<pronoun>je|tu|il|elle|on|nous|vous|ils|elles|ce)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const PEU_BEFORE = new Set(
  "à un très trop si assez bien pour de le ce tout aussi ne n' qui ça cela ici sous avant".split(
    " ",
  ),
);
const MAYBE = /(?<![\p{L}\p{M}\p{N}_'’-])peut?[ \t]+être(?![\p{L}\p{M}\p{N}_'’-])/giu;

function hyphenation(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, INVERSION)) {
    const finding = inversion(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, MAYBE)) {
    const finding = maybe(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, IMPERATIVE)) {
    const finding = imperative(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, VERBAL_MAYBE)) {
    const finding = verbalMaybe(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, PREFIX_COMPOUND)) {
    const finding = prefixCompound(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, WORD_PAIR)) {
    const finding = spacedCompound(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, LONG_FIRST)) {
    const finding = longCompound(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

const LONG_FIRST = /(?<![\p{L}\p{M}\p{N}_'’-])\p{L}+(?:['’]\p{L}+)?(?=[ \t]{1,8}\p{L}|-\p{L})/gu;
const compoundPatterns = new Map<string, RegExp>();
// Compounds that are no noun, so no determiner comes before them.
const BARE_COMPOUNDS = new Set(["c'est-à-dire"]);

/** "Aix en Provence", "Jean Marc", "le rez de chaussée": a name the dictionary hyphenates (its
 * case as listed) or a compound noun of three parts or more after a determiner. */
function longCompound(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  // "Tout Paris est à la fête": a capitalized common word opening a sentence.
  const lower = m[0].toLowerCase();
  const opening = !/[\p{L},;(]\s{0,8}$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index));
  if (lower !== m[0] && opening && isFrenchWord(lower)) return null;
  for (const compound of compoundsStartingWith(m[0].replaceAll("’", "'"))) {
    let pattern = compoundPatterns.get(compound);
    if (!pattern) {
      const parts = compound.split("-").map((p) => p.replaceAll("'", "['’]"));
      pattern = new RegExp(`${parts.join("(?:[ \\t]{1,8}|-)")}(?![\\p{L}\\p{M}\\p{N}_'’-])`, "uy");
      compoundPatterns.set(compound, pattern);
    }
    pattern.lastIndex = m.index;
    const hit = pattern.exec(ctx.text);
    if (!hit || !/[ \t]/.test(hit[0])) continue;
    if (/^\p{Ll}/u.test(compound) && !BARE_COMPOUNDS.has(compound)) {
      const previous = tokensBefore(ctx.text, m.index, 1)[0];
      if (!previous || !NOUN_PHRASE_OPENERS.has(previous.w)) return null;
    }
    if (namedExampleBefore(ctx.text, m.index) || ctx.dictionary.has(compound.toLowerCase()))
      return null;
    const apostrophe = /’/.test(hit[0]) ? "’" : "'";
    return finding(RULE, MESSAGE, m.index, m.index + hit[0].length, [
      compound.replaceAll("'", apostrophe),
    ]);
  }
  return null;
}

// Words before a noun phrase: a compound after them is a noun ("un coffre fort", "en arrière
// plan"), not a verb and its complement ("il se lève tôt").
const NOUN_PHRASE_OPENERS = new Set(
  (
    "le la les l' un une des du au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre " +
    "nos votre vos leur leurs"
  ).split(" "),
);
// "le", "la", "les", "l'" are also object pronouns before a verb ("l'avons", "le sans faute").
const PRONOUN_ARTICLES = new Set(["le", "la", "les", "l'"]);
// Second words that make a clause of the pair ("le nord est froid", "peut être", "chez vous").
const VERB_SECONDS = new Set(
  "est a sont ont fait font être avoir vous nous moi toi lui eux là ci cent".split(" "),
);

/** "un coffre fort", "les non voyants", "l'agro industrie": a compound the dictionary hyphenates,
 * written as two words after a determiner, or with a combining form in -o ("agro", "anglo")
 * that is no word of its own. */
function spacedCompound(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { first, second } = m.groups!;
  const joined = `${first}-${second}`;
  // "non voyants": the dictionary lists the singular.
  const singular = (w: string) => w.replace(/(?<=..)[sx]$/, "");
  if (!isDictionaryCompound(joined) && !isDictionaryCompound(`${first}-${singular(second)}`)) {
    if (!isDictionaryCompound(`${singular(first)}-${singular(second)}`)) return null;
  }
  if (PREFIX_WORDS.has(first) || VERB_SECONDS.has(second)) return null;
  if (verbReadings(second).some((r) => typeof r.slot === "number") && !isVerbHomograph(second))
    return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  const bound = /..o$/.test(first) && !isFrenchWord(first);
  if (!bound) {
    if (!previous || !NOUN_PHRASE_OPENERS.has(previous.w)) return null;
    const finite = verbReadings(first).some((r) => typeof r.slot === "number");
    // "le", "la", "les", "l'" are articles after a preposition or at a clause start; after a
    // verb ("Visez le sans faute") or a subject ("nous l'avons") they are pronouns.
    if (PRONOUN_ARTICLES.has(previous.w)) {
      const before = tokensBefore(ctx.text, previous.start, 1)[0];
      const article = !before || ARTICLE_CONTEXT.has(before.w);
      if (!article && (finite || verbReadings(before.w).length)) return null;
    }
  }
  if (namedExampleBefore(ctx.text, m.index) || ctx.dictionary.has(first)) return null;
  const gapStart = m.index + first.length;
  const secondStart = ctx.text.indexOf(second, gapStart);
  const end = secondStart + second.length;
  return finding(RULE, MESSAGE, gapStart, secondStart, ["-"], { context: { start: m.index, end } });
}
const PREFIX_WORDS = new Set(PREFIXES.split(" "));
const ARTICLE_CONTEXT = new Set(
  (
    "de d' à dans sur sous pour par avec sans chez vers entre après avant contre pendant depuis " +
    "et ou mais que qu' car"
  ).split(" "),
);
const WORD_PAIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?<first>\p{Ll}+)(?=[ \t]{1,3}(?<second>\p{Ll}+)(?![\p{L}\p{M}\p{N}_'’-]))/gu;

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: hyphenation }];
