import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  genderable,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  JE,
  nounGender,
  TU,
  verbReadings,
} from "./frenchLexicon";
import { sontForSon } from "./homophones";
import { ownedFrenchWords, PREPOSITIONS, tokensAfter, tokensBefore } from "./frenchTokens";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// What follows a determiner is a noun phrase. Two determiners in a row keep one ("nos cette
// langue", "des sa naissance" for "dès"); a verb form or participle after one is a noun spelled
// like it: "le carre" (carré), "sa sortie" written "sa sorti", "un développent" (développement),
// "mon déjeuné" (déjeuner).

const RULE = "frenchNounGender";
const DOUBLE = "review_msg_fr_double_determiner";
const NOUN = "review_msg_fr_determiner_noun";

type Gender = "m" | "f";
const DETERMINERS: Record<string, [Gender | null, "s" | "p"]> = {
  le: ["m", "s"],
  la: ["f", "s"],
  "l'": [null, "s"],
  les: [null, "p"],
  un: ["m", "s"],
  une: ["f", "s"],
  des: [null, "p"],
  du: ["m", "s"],
  au: ["m", "s"],
  aux: [null, "p"],
  ce: ["m", "s"],
  cet: ["m", "s"],
  cette: ["f", "s"],
  ces: [null, "p"],
  mon: ["m", "s"],
  ton: ["m", "s"],
  son: ["m", "s"],
  ma: ["f", "s"],
  ta: ["f", "s"],
  sa: ["f", "s"],
  mes: [null, "p"],
  tes: [null, "p"],
  ses: [null, "p"],
  notre: [null, "s"],
  votre: [null, "s"],
  nos: [null, "p"],
  vos: [null, "p"],
  leur: [null, "s"],
  leurs: [null, "p"],
};
/** Determiners that are never pronouns: a verb form after them is no verb. */
const ONLY_DETERMINERS = new Set(
  "un une des du au aux ce cet cette ces mon ton son ma ta sa mes tes ses notre votre nos vos".split(
    " ",
  ),
);
const OPENERS = new Set([
  ...PREPOSITIONS,
  ..."que qu' et ou mais si quand car donc puis comme lorsque puisque".split(" "),
]);

// Second words that make a pair right: "le leur", "aux leurs" (possessive pronouns), "le son",
// "un ton" (nouns), "le un", "la une" (the number, the front page), "le notre" (le nôtre, an
// accent away).
const KEPT_SECOND = new Set("leur leurs son ton un une notre votre".split(" "));

/** "nos cette langue", "des sa naissance", "du notre site": keep one, or the preposition. */
function doubleDeterminer(
  ctx: DetectContext,
  m: RegExpExecArray,
  first: string,
  second: string,
): RawFinding | null {
  if (first === second || first === "leur" || first === "leurs") return null;
  // "le leur", "aux leurs": a possessive pronoun; "le son", "un ton": the nouns; "un des": one
  // of; "la une": the front page.
  const end = m.index + m[0].length;
  // "du notre site" is a double determiner; "la notre soit", "celle du votre." keep "nôtre".
  const next = tokensAfter(ctx.text, end, 1)[0];
  const nounNext = Boolean(
    next &&
    next.start <= end + 8 &&
    isInflectedNoun(next.w) &&
    !verbReadings(next.w).some((r) => typeof r.slot === "number"),
  );
  // "le leurs", "des leur": a possessive pronoun that does not take the article's number.
  const mismatched =
    (second === "leurs" && DETERMINERS[first][1] === "s") ||
    (second === "leur" && ["les", "aux", "des"].includes(first));
  if (
    KEPT_SECOND.has(second) &&
    !mismatched &&
    !(nounNext && (second === "notre" || second === "votre"))
  )
    return null;
  if ((first === "un" || first === "une") && second === "des") return null;
  // "le la du diapason": the note.
  if (second === "la" && first !== "la" && DETERMINERS[first][0] !== "f") return null;
  // "Est-ce la bonne", "ce la" (cela): "ce" before another determiner is seldom an article.
  if (first === "ce" || first === "cet") return null;
  if (ctx.text[m.index - 1] === "-") return null;
  const { first: typedFirst, second: typedSecond } = m.groups!;
  // "les La Fontaine", "le CE": a name or an acronym after the article.
  if (/\p{Lu}/u.test(typedSecond)) return null;
  // "dépose le au courrier": an object pronoun after an imperative.
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  // "c'est le mon livre": être takes no object pronoun.
  if (
    ["le", "la", "les"].includes(first) &&
    previous &&
    verbReadings(previous.w).length &&
    !verbReadings(previous.w).some((r) => r.lemma === "être")
  )
    return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const alternatives = [typedFirst, typedSecond];
  const lower = (word: string) => carryCase(typedFirst, word);
  const space = second.endsWith("'") ? "" : " ";
  if (first === "des" && second === "leur")
    alternatives.unshift(`${lower("dès")} ${typedSecond}`, `${typedFirst} leurs`);
  else if (mismatched && second === "leurs") alternatives.unshift(`${lower("les")} leurs`);
  else if (first === "des")
    alternatives.unshift(`${lower("dès")} ${typedSecond}`, `${lower("de")} ${typedSecond}`);
  if (first === "du") alternatives.unshift(`${lower("de")} ${typedSecond}`);
  if (first === "au" || first === "aux") alternatives.unshift(`${lower("à")} ${typedSecond}`);
  if (first === "sa") alternatives.unshift(`${lower("ça")}${space}${typedSecond}`);
  return finding(RULE, DOUBLE, m.index, end, [...new Set(alternatives)], { requiresChoice: true });
}

const FEMININE_OF: Record<string, string> = {
  le: "la",
  un: "une",
  du: "de la",
  au: "à la",
  mon: "ma",
  ton: "ta",
  son: "sa",
};

/** The masculine noun or adjective a form in -e stands for with its -é: "carre" -> "carré". */
export function accentedNoun(word: string): string | null {
  if (!word.endsWith("e")) return null;
  const accented = `${word.slice(0, -1)}é`;
  if (nounGender(accented) === "f") return null;
  const noun =
    nounGender(accented) === "m" ||
    adjectiveReadings(accented).some((r) => r.slot === "ms") ||
    (isVerbHomograph(accented) && verbReadings(accented).some((r) => r.slot === "Q"));
  return noun ? accented : null;
}

/** A plural verb form in -es only ("députes", "délègues") for the noun in -és or -ées. */
function accentedPlural(word: string): string | null {
  if (!word.endsWith("es") || isVerbHomograph(word) || isInflectedNoun(word)) return null;
  const readings = verbReadings(word);
  if (!readings.length || !readings.every((r) => typeof r.slot === "number")) return null;
  // "délègues" -> "délégués": the stem's grave accent becomes acute before the ending.
  const base = word.slice(0, -2).replace(/è(?=[^aeiouyéèê]*$)/, "é");
  if (nounGender(`${base}ée`) === "f") return `${base}ées`;
  const singular = `${base}é`;
  const noun =
    nounGender(singular) === "m" || (isVerbHomograph(singular) && isInflectedNoun(singular));
  return noun ? `${singular}s` : null;
}

/** The noun a verb form in -e drops it for: "trafique" -> "trafic", "appelle" -> "appel",
 * "gèle" -> "gel", "envoie" -> "envoi"; null when no masculine noun is spelled so. */
function nounStem(form: string): string | null {
  if (!form.endsWith("e")) return null;
  const stem = form.slice(0, -1);
  const candidates = [
    stem.replace(/qu$/, "c"),
    stem.replace(/([lnpt])\1$/, "$1"),
    stem.replace(/è(?=[^aeiouyéèê]+$)/, "e"),
  ];
  return (
    candidates.find(
      (c) => c !== form && isNounLemma(c) && nounGender(c) !== "f" && !verbReadings(c).length,
    ) ?? null
  );
}

const AFTER_VERB = new Set(["pas", "plus", "jamais", "rien"]);
const CLITIC_BEFORE = new Set(["ne", "n'"]);

const vowel = (word: string) => /^[aeiouyâàéèêîïôûœh]/.test(word);

/** A noun written like a verb form or participle after a determiner: the noun's spelling. */
function nounAfter(ctx: DetectContext, m: RegExpExecArray, det: string): RawFinding | null {
  const typed = m.groups!.noun;
  const word = typed.toLowerCase();
  if (typed !== word || word.length < 3 || ctx.dictionary.has(word)) return null;
  const [detGender, number] = DETERMINERS[det];
  // "son issue", "mon amie": a possessive in -on also goes before a feminine vowel.
  const gender = ["mon", "ton", "son"].includes(det) && vowel(word) ? null : detGender;
  // "le", "la", "les" are also pronouns before a verb ("il le coupe"): only after a preposition,
  // a conjunction, a negation or a verb, or at a sentence start are they articles; never after
  // a subject or another object pronoun.
  if (!ONLY_DETERMINERS.has(det)) {
    const previous = tokensBefore(ctx.text, m.index, 1)[0];
    const article = previous
      ? OPENERS.has(previous.w) ||
        (AFTER_VERB.has(previous.w) && !CLITIC_BEFORE.has(previous.w)) ||
        (verbReadings(previous.w).length > 0 && !isVerbHomograph(previous.w))
      : /(?:^|[.!?…]\s{0,8})$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index));
    if (!article) return null;
    // "les députes", "les arrives": a verb form in -es for the noun in -és or -ées.
    const accented = number === "p" ? accentedPlural(word) : null;
    if (accented)
      return finding(RULE, NOUN, m.indices!.groups!.noun[0], m.index + m[0].length, [accented], {
        context: { start: m.index, end: m.index + m[0].length },
      });
    // After a verb, only a noun spelled like a verb form or participle is read here.
    const finiteWord = verbReadings(word).some((r) => typeof r.slot === "number");
    if (previous && !OPENERS.has(previous.w) && finiteWord && !/it(?:e|ée)$/.test(word))
      return null;
  }
  const readings = verbReadings(word);
  if (!readings.length) return null;
  const end = m.index + m[0].length;
  if (/^[-'’]/.test(ctx.text.slice(end, end + 1))) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const nounFinding = (alternatives: string[]): RawFinding =>
    finding(RULE, NOUN, m.indices!.groups!.noun[0], end, alternatives, {
      context: { start: m.index, end },
    });
  const finite = readings.filter((r) => typeof r.slot === "number");
  const participle = readings.some((r) => r.slot === "Q");
  // "un développent", "le maintient": a verb form for the noun in -ment or the bare stem.
  // "la facilite", "la citée": the feminine noun in -ité.
  if (
    gender !== "m" &&
    /it(?:e|ée)$/.test(word) &&
    !isInflectedNoun(word) &&
    !isVerbHomograph(word)
  ) {
    const noun = word.replace(/it(?:e|ée)$/, "ité");
    if (nounGender(noun) === "f" && isVerbHomograph(noun)) return nounFinding([noun]);
  }
  if (finite.length === readings.length && !isVerbHomograph(word)) {
    // "demandaient": an imperfect ending spells no noun in -ement.
    const ment = /aient$/.test(word) ? word : word.replace(/ent$/, "ement");
    for (const noun of [ment, word.replace(/t$/, "")]) {
      if (noun !== word && nounGender(noun) && (!gender || nounGender(noun) === gender))
        return nounFinding([noun]);
    }
    // "un trafique", "au travaille", "des appelles": a verb form in -e(s) for the noun without it.
    // After "et le", "le" is the pronoun ("il le prend et le travaille").
    const previous = tokensBefore(ctx.text, m.index, 1)[0];
    if (!ONLY_DETERMINERS.has(det) && previous && !PREPOSITIONS.has(previous.w)) return null;
    const stem = nounStem(number === "p" ? word.replace(/s$/, "") : word);
    if (!stem || gender === "f") return null;
    // "aux mures": with no gender in the determiner, "mûres" is as likely as "murs".
    if (!gender && isInflectedNoun(word.replace(/u(?=[^u]*$)/, "û"))) return null;
    return nounFinding([number === "p" ? `${stem}s` : stem]);
  }
  // "son ressentie", "mes démêlées": a feminine participle for the masculine noun it comes from.
  const lemma = word.replace(/es?$/, "");
  if (
    participle &&
    gender !== "f" &&
    lemma !== word &&
    /[éiu]$/.test(lemma) &&
    !isInflectedNoun(word) &&
    !isVerbHomograph(word) &&
    isVerbHomograph(lemma) &&
    isInflectedNoun(lemma) &&
    nounGender(lemma) !== "f"
  )
    return nounFinding([number === "p" ? `${lemma}s` : lemma]);
  // "les sortis": a simple past that is also a participle reads as the participle here.
  const pastOnly = finite.every((r) => (r.slot as number) & (JE | TU));
  if (!participle || (finite.length && !(number === "p" && pastOnly))) {
    // "le carre", "au marche", "du cure": a masculine determiner and a form in -e whose -é
    // spelling is the noun.
    if (gender !== "m" || !word.endsWith("e") || nounGender(word) === "m") return null;
    // "un double sens", "le suicide": an adjective, or a noun of either gender.
    if (adjectiveReadings(word).length || !genderable(word)) return null;
    // "un double sens", "son indigne frère": an adjective before its noun.
    const following = tokensAfter(ctx.text, end, 1)[0];
    if (following && (isInflectedNoun(following.w) || nounGender(following.w))) return null;
    const accented = accentedNoun(word);
    if (!accented) return null;
    // "le cure": "le curé" or "la cure", the determiner's other gender.
    const swapped = FEMININE_OF[det];
    if (nounGender(word) === "f" && swapped) {
      const typedDet = m.groups!.det;
      return {
        ...nounFinding([`${typedDet} ${accented}`, `${carryCase(typedDet, swapped)} ${word}`]),
        range: { start: m.index, end },
        requiresChoice: true,
      };
    }
    return nounFinding([accented]);
  }
  // Only a participle from here: "sa sorti", "des traversé", "mes pensés", "l'arrivé", "un
  // musé", "mon déjeuné".
  const plural = number === "p";
  if (gender === "m" && !plural && word.endsWith("é") && !isVerbHomograph(word)) {
    // "un musé": a masculine noun in -ée.
    if (nounGender(`${word}e`) === "m" && isVerbHomograph(`${word}e`))
      return nounFinding([`${word}e`]);
    // "mon déjeuné": the infinitive used as a noun.
    const infinitive = `${word.slice(0, -1)}er`;
    if (!isInflectedNoun(word) && isVerbHomograph(infinitive) && isInflectedNoun(infinitive))
      return nounFinding([infinitive]);
    return null;
  }
  if (gender === "m") return null;
  const base = plural && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
  if (/e$/.test(base) || (plural && base === word && /[sx]$/.test(word))) return null;
  const noun = `${base}e`;
  // "la duré", "une entré": a feminine noun in -ée; "des musés": after a determiner of either
  // gender, a masculine one too.
  const nounIs = nounGender(noun);
  if (!(nounIs === "f" || isVerbHomograph(noun)) || (nounIs === "m" && gender)) return null;
  // "l'invité", "leur vécu", "les élus": the participle is a noun of its own.
  if (adjectiveReadings(base).length || isVerbHomograph(base)) return null;
  if (!gender && isInflectedNoun(base)) return null;
  return nounFinding([plural ? `${noun}s` : noun]);
}

const NAMES = Object.keys(DETERMINERS)
  .filter((w) => !w.endsWith("'"))
  .join("|");
const PAIR = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<first>${NAMES})[ \\t]{1,8}(?<second>(?:${NAMES})(?![\\p{L}\\p{M}\\p{N}_-])|l['’](?=\\p{L}))`,
  "giu",
);
const NOUN_AFTER = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<det>(?:${NAMES})(?=[ \\t])|l['’])[ \\t]{0,8}(?<noun>\\p{L}[\\p{L}\\p{M}]*)(?![\\p{L}\\p{M}\\p{N}_])`,
  "dgiu",
);

// Quantifiers and prepositions that never follow these words: "des plusieurs pays", "les
// certaines règles", "de des enfants", "à aux enfants", "des toutes les catégories".
const QUANTIFIERS = new Set(["plusieurs", "certains", "certaines"]);
const QUANTIFIER_PAIR =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<first>des|les|ces|mes|tes|ses|nos|vos|de|du|à)[ \t]{1,8}(?<second>plusieurs|certains|certaines|toutes|tous|des|de|aux|entre)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const PLURAL_DETERMINERS = new Set(["les", "ces", "mes", "tes", "ses", "nos", "vos"]);

/** "des plusieurs" -> "de plusieurs", "de des" -> "de" or "des", "à aux" -> "aux" or "à". */
function quantifierPair(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { first: typedFirst, second: typedSecond } = m.groups!;
  const first = typedFirst.toLowerCase();
  const second = typedSecond.toLowerCase();
  const end = m.index + m[0].length;
  if (ctx.text[m.index - 1] === "-" || namedExampleBefore(ctx.text, m.index)) return null;
  const lower = (word: string) => carryCase(typedFirst, word);
  let alternatives: string[];
  if (QUANTIFIERS.has(second)) {
    // "ces plusieurs jours" is literary; only "des plusieurs" and "les certaines" are slips.
    if (first !== "des" && !(first === "les" && second !== "plusieurs")) return null;
    alternatives = first === "des" ? [`${lower("de")} ${typedSecond}`, typedSecond] : [typedSecond];
  } else if (second === "toutes" || second === "tous") {
    // "des toutes petites": "toutes" is the adverb before an adjective; only "des toutes les".
    const next = tokensAfter(ctx.text, end, 1)[0];
    if (first !== "des" || !next || !PLURAL_DETERMINERS.has(next.w)) return null;
    alternatives = [`${lower("de")} ${typedSecond}`];
  } else if (first === "de" && second === "des") {
    // "la Source de des Trois Caños": a name.
    const next = tokensAfter(ctx.text, end, 1)[0];
    if (next && /^\p{Lu}/u.test(ctx.text[next.start])) return null;
    alternatives = [typedFirst, typedSecond];
  } else if (first === "du" && second === "de") alternatives = [typedFirst, typedSecond];
  else if (first === "à" && (second === "aux" || second === "entre"))
    alternatives = [typedSecond, typedFirst];
  else return null;
  return finding(RULE, DOUBLE, m.index, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

function determiners(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, PAIR)) {
    const first = m.groups!.first.toLowerCase();
    const second = m.groups!.second.toLowerCase().replaceAll("’", "'");
    const finding = doubleDeterminer(ctx, m, first, second);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, QUANTIFIER_PAIR)) {
    const finding = quantifierPair(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, NOUN_AFTER)) {
    const det = m.groups!.det.toLowerCase().replaceAll("’", "'");
    if (vowel(m.groups!.noun.toLowerCase()) && (det === "le" || det === "la")) continue;
    // "ce sont", "ce fut": the pronoun before être.
    if (det === "ce") continue;
    // "les filles son arrivé": "sont" misspelt.
    if (det === "son" && sontForSon(ctx.text, m.index)) continue;
    const finding = nounAfter(ctx, m, det);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: determiners }];
