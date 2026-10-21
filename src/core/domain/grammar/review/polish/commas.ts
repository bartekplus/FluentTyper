import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { ambiguousVerb, finiteVerb, impersonalVerb, nounTags, onlyNoun } from "./lexicon";
import { findingAt, PREPOSITIONS, sentenceStartAt, userOrNamed } from "./shared";

/*
 * Polish commas: a subordinate clause is set off by a comma before its conjunction
 * or relative pronoun ("Wiem, że…", "dom, w którym…"), and a compound conjunction
 * takes the comma before it as a whole ("…, mimo że", not "mimo, że").
 */

const MISPLACED = "polishMisplacedComma" as const;
const MISSING = "polishMissingComma" as const;

/* ------------------------------------------------ comma inside a conjunction */

/** First word of a compound conjunction -> the words that may follow it. */
const COMPOUNDS: Record<string, string> = {
  mimo: "że|iż",
  pomimo: "że|iż",
  podczas: "gdy",
  chyba: "że|żeby|by",
  nawet: "jeśli|jeżeli|gdy|gdyby|kiedy",
  jeszcze: "zanim",
  a: "więc",
  o: "ile",
  "pod warunkiem": "że|iż",
  // Only after a comma or at the sentence start: "Zjadł tyle, że pękł" (so much that).
  tyle: "że",
};
/** Words after which no comma opens the clause: conjunctions, and the sentence's start. */
const NO_COMMA_AFTER = new Set(
  "i a oraz lub albo bądź ani czy bo ale lecz niż jak jakby że iż żeby aby by gdy kiedy jeśli jeżeli gdyby który która które którego której którym których którzy to".split(
    " ",
  ),
);

function commaInsideConjunction(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, head, tail } = m.groups!;
  const headKey = head.toLowerCase().replace(/\s+/g, " ");
  if (!new RegExp(`^(?:${COMPOUNDS[headKey]})$`, "iu").test(tail)) return null;
  // "O, ile tu ludzi!" is the interjection "o".
  if (
    headKey === "o" &&
    /^O$/.test(head) &&
    sentenceStartAt(ctx.text, m.index + (prev ? prev.length + gap.length : 0))
  )
    return null;
  const headStart = m.index + (prev ? prev.length + gap.length : 0);
  // "wtedy nawet, gdy" (even then, when) and "czy tak, czy owak" keep their comma; "mimo",
  // "podczas" and "pod warunkiem" are never read apart ("tam mimo, że" -> "tam, mimo że").
  if (
    prev &&
    !/^(?:mimo|pomimo|podczas|pod)/iu.test(headKey) &&
    /^(?:wtedy|wówczas|tylko|właśnie|tam|tu|czy)$/iu.test(prev)
  )
    return null;
  if (
    headKey === "tyle" &&
    (prev ||
      !/(?:^|[,.!?…]\s*|\n\s*)$/u.test(ctx.text.slice(Math.max(0, headStart - 8), headStart)))
  )
    return null;
  const joined = `${head} ${tail}`;
  if (prev && !NO_COMMA_AFTER.has(prev.toLowerCase()) && !userOrNamed(ctx, prev)) {
    // "tam mimo, że" -> "tam, mimo że": the comma moves before the conjunction.
    return findingAt(
      ctx,
      m.index,
      m.index + m[0].length,
      [`${prev},${gap}${joined}`],
      MISPLACED,
      "review_msg_pl_misplaced_comma",
    );
  } else {
    return findingAt(
      ctx,
      headStart,
      m.index + m[0].length,
      [joined],
      MISPLACED,
      "review_msg_pl_misplaced_comma",
    );
  }
  return null;
}

const RELATIVE = "który|która|które|którego|której|któremu|którą|którym|których|którymi|którzy";
const JAKI = "jaki|jaka|jakie|jakiego|jakiej|jakiemu|jaką|jakim|jakich|jakimi";

function commaAfterPreposition(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, prep, pronoun } = m.groups!;
  const prepStart = m.index + (prev ? prev.length + gap.length : 0);
  // "O, kogo widzę!": the interjection "o" opens the sentence.
  if (/^o$/iu.test(prep) && (!prev || NO_COMMA_AFTER.has(prev.toLowerCase()))) return null;
  // "bez, co gorsza, kurtki": an aside opens after the preposition.
  const end = m.index + m[0].length;
  if (/^[ \t\u00a0]*\p{L}+[ \t\u00a0]*,/u.test(ctx.text.slice(end, end + 30))) return null;
  const joined = `${prep} ${pronoun}`;
  const moved =
    prev && !NO_COMMA_AFTER.has(prev.toLowerCase()) && !sentenceStartAt(ctx.text, prepStart);
  return findingAt(
    ctx,
    moved ? m.index : prepStart,
    end,
    [moved ? `${prev},${gap}${joined}` : joined],
    MISPLACED,
    "review_msg_pl_misplaced_comma",
  );
}

const PAIRS: Record<string, RegExp> = {
  tak: /^czy\s/iu,
  chcąc: /^nie\s+chcąc$/iu,
  bądź: /^co\s+bądź$/iu,
  byle: /^jak$/iu,
  chybił: /^trafił$/iu,
  wypisz: /^wymaluj$/iu,
};

function setPhraseCommas(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { phrase, a, b } = m.groups!;
  if (/(?:^|[^\p{L}])czy[ \t\u00a0]+$/iu.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)))
    return null;
  if (!PAIRS[a.toLowerCase()]?.test(b)) return null;
  // "Tak, czy inaczej?" can answer a question; only mid-sentence or before more text.
  return findingAt(
    ctx,
    m.index,
    m.index + phrase.length,
    [`${a} ${b}`],
    MISPLACED,
    "review_msg_pl_misplaced_comma",
  );
}

function commaBeforeEtc(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  // "itp., itd.": a list of abbreviations.
  if (ctx.text[m.index - 1] === ".") return null;
  return findingAt(
    ctx,
    m.index,
    m.index + m.groups!.comma.length,
    [""],
    MISPLACED,
    "review_msg_pl_misplaced_comma",
  );
}

/* ------------------------------------------------------ missing comma before */

/** Question words that open an indirect question or a clause of place: "nie wiem, gdzie". */
const QUESTION_WORDS = "dlaczego|gdzie|kiedy";
const SUBORDINATORS = `że|iż|żeby|ażeby|aby|by|ponieważ|gdyż|jeśli|jeżeli|gdyby|zanim|dopóki|gdy|zamiast|ale|lecz|${QUESTION_WORDS}|${RELATIVE}|${JAKI}`;
/** What makes the word after a subordinator part of a set phrase: "kiedy indziej", "póki co". */
const SET_AFTER: Record<string, RegExp> = {
  kiedy: /^(?:indziej|niekiedy|bądź)$/iu,
  gdzie: /^(?:indziej|niegdzie|bądź)$/iu,
  dlaczego: /^(?:innego|innym)$/iu,
};
/** Words after which the conjunction belongs to what comes before (compounds, coordination). */
const OPENS_COMPOUND = new Set([
  ..."i a oraz lub albo bądź ani czy bo ale lecz niż jak jakby aż tylko właśnie nawet zwłaszcza szczególnie zaś dlatego mimo pomimo chyba tyle tak również także jednak jednakże przecież no pewnie jasne choć chociaż nie to wtedy wówczas raz co byle lada wiadomo potem zaraz dopiero jeszcze przy może omal nieomal prawie niemal więc zatem przeto przynajmniej dość jako tym bardziej daj mało rzadko warunkiem razie miarę chwili momencie czasie zamiast podczas dzięki wobec wie diabli licho oto".split(
    " ",
  ),
  ...SUBORDINATORS.split("|"),
]);
// ponytail: "który" after a preposition moves the comma before it; a fuller clause parser would also
// handle "na gruzach którego"-type inversions.
const PREPOSITION_SET = new Set(PREPOSITIONS.split("|"));

/**
 * "który" opens a relative clause here: not a question ("o której?"), not the indefinite
 * "którego z" or "zaniemógł który", and no comma a few words back already opens the clause
 * ("w trakcie którego", "za pomocą którego", "uzwojenie którego").
 */
function relativeClause(ctx: DetectContext, start: number, end: number): boolean {
  const after = ctx.text.slice(end, end + 200);
  if (/^[ \t\u00a0]*(?:[.!?,;:…)"”»]|z[ \t\u00a0])/u.test(after)) return false;
  if (/^[^.!?\n]*\?/u.test(after)) return false;
  const before = ctx.text.slice(Math.max(0, start - 60), start);
  const clause = before.split(/[,;:—–(]/u).at(-1) ?? "";
  const words = clause.match(/\p{L}+/gu) ?? [];
  // "i w czasie której": coordinated with an earlier relative; "złapać którego ptaka": indefinite.
  if (words.slice(-4).some((word) => /^(?:i|oraz|a|lub|albo)$/iu.test(word))) return false;
  if (/ć$/u.test(words.at(-1) ?? "")) return false;
  return words.length > 3 || !/[,;:—–(]/u.test(before);
}

function missingCommas(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, prep, sub } = m.groups!;
  if (/\p{Lu}/u.test(sub[0])) return null;
  const lowerPrev = prev.toLowerCase();
  // The word must start where the match starts (no letters glued before it).
  if (/[\p{L}\p{N}_'’-]/u.test(ctx.text[m.index - 1] ?? "")) return null;
  const relative = new RegExp(`^(?:${RELATIVE})$`).test(sub);
  // "to że" -> "to, że" ("Chodzi o to, że…"), but not the particle in "no to że".
  if (lowerPrev === "to" && /^(?:że|iż)$/.test(sub)) {
    const before = /(\p{L}+)[ \t\u00a0]+$/u.exec(
      ctx.text.slice(Math.max(0, m.index - 24), m.index),
    )?.[1];
    if (
      before &&
      !/^(?:no|i|a|ale|bo|lecz|tylko|właśnie|nawet|tak|jak|mimo|pomimo)$/iu.test(before) &&
      !userOrNamed(ctx, before)
    ) {
      return findingAt(
        ctx,
        m.index,
        m.index + prev.length + gap.length,
        [`${prev},${gap}`],
        MISSING,
        "review_msg_pl_missing_comma",
      );
    }
    return null;
  }
  // A preposition only goes with the relative pronoun: "dom w którym".
  if (prep && !relative) return null;
  if (OPENS_COMPOUND.has(lowerPrev) || PREPOSITION_SET.has(lowerPrev)) return null;
  // "ale" before punctuation is the noun ("bez żadnych ale"); "ale" opening an exclamation.
  if (sub === "ale" || sub === "lecz") {
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (!/^[ \t ]+\p{L}/u.test(after)) return null;
  }
  if (userOrNamed(ctx, prev) || /^\p{Lu}+$/u.test(prev)) return null;
  const end = m.index + m[0].length;
  const next = /^[ \t\u00a0]+(\p{L}+)/u.exec(ctx.text.slice(end, end + 40))?.[1] ?? "";
  if (SET_AFTER[sub]?.test(next)) return null;
  // A bare question word ends the sentence without a comma: "Nie powie dlaczego."
  if (!next && new RegExp(`^(?:${QUESTION_WORDS})$`).test(sub)) return null;
  // "by" opens a clause of purpose before an infinitive ("wstąpił do domu, by się przebrać");
  // "można by zrobić", "mógł by zrobić" (split "mógłby") keep the conditional particle.
  if (sub === "by") {
    const verb =
      next === "się"
        ? (/^[ \t ]+się[ \t ]+(\p{L}+)/u.exec(ctx.text.slice(end, end + 60))?.[1] ?? "")
        : next;
    // "Pokład szorowano by nie zostały ślady", "Pracuję by dzieci miały co jeść": after an
    // impersonal or present verb, "by" with a past form opens a clause of purpose too.
    const clause = /^[ \t ]+(?:\p{L}+[ \t ]+){0,2}?(\p{Ll}+(?:ł|ła|ło|li|ły))(?![\p{L}])/u.exec(
      ctx.text.slice(end, end + 60),
    )?.[1];
    const purpose =
      clause !== undefined &&
      (finiteVerb(clause) || ambiguousVerb(clause)) &&
      (impersonalVerb(lowerPrev) ||
        (finiteVerb(lowerPrev) && !/(?:ł|ła|ło|li|ły)$/u.test(lowerPrev)));
    if (
      !purpose &&
      (!/(?:ć|móc|biec|wlec|strzec|piec|rzec|tłuc)$/u.test(verb) ||
        nounTags(verb.toLowerCase()) ||
        /^(?:można|trzeba|warto|wolno|lepiej|dobrze|trudno|łatwo|należy|należało|wypada|wypadało|opłacało|coś|nic)$/iu.test(
          prev,
        ) ||
        /^(?:mógł|mogł|mogl|chcia|chcie|musia|musie|miał|miel|umiał|umiel|potrafi|wola|wole|zdoła|powin)/iu.test(
          prev,
        ))
    )
      return null;
  }
  // "jaki" opens a clause after a noun or an infinitive ("założeń, jakie mamy", "wyobrazić,
  // jakie to było"), not as a question or an exclamation ("Jaki piękny dzień!").
  if (
    new RegExp(`^(?:${JAKI})$`).test(sub) &&
    (!(/ć$/u.test(prev) || onlyNoun(nounTags(prev.toLowerCase()))) ||
      !next ||
      // "jakich trzydziestu tysięcy", "jakiej pół godziny": "some", before a number.
      /^(?:\d|pół|półtor|jed|dw|trz|czter|pięć|pięci|sześ|siedem|siedmi|osiem|ośmi|dziewię|dziesię|kilk|par|set|stu|sto|tysi)/iu.test(
        next,
      ) ||
      /^[^.!\n]*[?!]/u.test(ctx.text.slice(end, end + 200)) ||
      // "jak bałwan jaki": after a comparison "jaki" is the particle "some", not a relative.
      /(?:^|[^\p{L}])(?:jak|niczym|jakby)[ \t\u00a0]+$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      ))
  )
    return null;
  // "zamiast" opens a clause only before an infinitive ("zamiast pracować"), not a noun.
  if (sub === "zamiast" && !/(?:ć|c)$/u.test(next)) return null;
  // A direct question keeps its question word: "A ty gdzie idziesz?".
  if (
    new RegExp(`^(?:${QUESTION_WORDS}|${RELATIVE})$`).test(sub) &&
    /^[^.!\n]*\?/u.test(ctx.text.slice(end, end + 200))
  )
    return null;
  // "złapać którego ptaka": after an infinitive "który" is the indefinite pronoun.
  if (relative && (/ć$/u.test(prev) || !relativeClause(ctx, m.index, m.index + m[0].length)))
    return null;
  // A comma is already there in some other form ("prev — że"), or the clause ends a quotation.
  const commaAt = m.index + prev.length;
  return findingAt(
    ctx,
    m.index,
    commaAt + gap.length,
    [`${prev},${gap}`],
    MISSING,
    "review_msg_pl_missing_comma",
  );
}

/** Adverbs that also open the conjunction ("tylko że", "tak żeby"): the comma goes either side. */
const EITHER_SIDE = /^(?:tylko|tak|właśnie|z[ \t\u00a0]+tym)$/u;
/** Which conjunctions each adverb may stand before. */
const ADVERB_SUBS: Record<string, RegExp> = {
  tylko: /^(?:że|żeby|aby|by|gdy|kiedy)$/u,
  tak: /^(?:żeby|ażeby|aby|by)$/u,
  właśnie: /^(?:że|gdy|kiedy)$/u,
  "z tym": /^(?:że|iż)$/u,
};

function adverbBeforeClause(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, adverb, gap2, sub, next } = m.groups!;
  const lower = prev.toLowerCase();
  if (OPENS_COMPOUND.has(lower) || PREPOSITION_SET.has(lower) || userOrNamed(ctx, prev))
    return null;
  // A capital inside the sentence names something.
  if (prev !== lower && !sentenceStartAt(ctx.text, m.index)) return null;
  const key = adverb.replace(/[ \t\u00a0]+/gu, " ");
  if (!(ADVERB_SUBS[key] ?? /^(?:że|iż|żeby|ażeby|aby|by)$/u).test(sub)) return null;
  // "tak by było lepiej": the conditional "by" goes with a finite verb, not an infinitive.
  if (sub === "by" && (!/(?:ć|móc|biec|wlec|strzec|piec|rzec|tłuc)$/u.test(next) || nounTags(next)))
    return null;
  const alternatives = EITHER_SIDE.test(adverb)
    ? [`${prev},${gap}${adverb}${gap2}${sub}`, `${prev}${gap}${adverb},${gap2}${sub}`]
    : [`${prev}${gap}${adverb},${gap2}${sub}`];
  const end = m.index + prev.length + gap.length + adverb.length + gap2.length + sub.length;
  return findingAt(ctx, m.index, end, alternatives, MISSING, "review_msg_pl_missing_comma");
}

const SUBJECT_OR_OBJECT =
  /^(?:nie|ja|ty|on|ona|ono|my|wy|oni|one|go|ją|je|mu|mi|ci|się|to|mnie|cię|nas|was|ich|jej|im|nam|wam)$/u;

function clauseOpeners(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, sub, next } = m.groups!;
  const lower = prev.toLowerCase();
  if (OPENS_COMPOUND.has(lower) || PREPOSITION_SET.has(lower) || userOrNamed(ctx, prev))
    return null;
  if (prev !== lower && !sentenceStartAt(ctx.text, m.index)) return null;
  const nextLower = next.toLowerCase();
  if (sub === "dopóty") {
    // "Dopóki …, dopóty …": the correlative of a clause that opened the sentence.
    const sentence = ctx.text
      .slice(Math.max(0, m.index - 200), m.index)
      .split(/[.!?\n]/u)
      .at(-1)!;
    if (!/^[\s„"(]*dopóki(?![\p{L}])/iu.test(sentence)) return null;
  } else if (!SUBJECT_OR_OBJECT.test(nextLower) && !finiteVerb(nextLower)) return null;
  // A question keeps "o ile" whole: "O ile wzrosła cena?".
  if (/^[^.!\n]*\?/u.test(ctx.text.slice(m.index, m.index + 200))) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + prev.length + gap.length,
    [`${prev},${gap}`],
    MISSING,
    "review_msg_pl_missing_comma",
  );
}

/** A compound conjunction takes the comma before it as a whole: "zdradził, mimo że". */
const COMPOUND_TAILS: Record<string, RegExp> = {
  mimo: /^(?:że|iż)$/u,
  pomimo: /^(?:że|iż)$/u,
  nawet: /^(?:jeśli|jeżeli|gdy|kiedy|gdyby\p{L}{0,5})$/u,
  dopiero: /^(?:gdy|kiedy|jak)$/u,
  zwłaszcza: /^(?:że|gdy|kiedy|jeśli|jeżeli)$/u,
  szczególnie: /^(?:że|gdy|kiedy|jeśli|jeżeli)$/u,
  "tym bardziej": /^(?:że|iż)$/u,
  "pod warunkiem": /^(?:że|iż)$/u,
  podczas: /^gdy$/u,
};

function missingCompoundCommas(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prev, gap, head, tail } = m.groups!;
  if (!COMPOUND_TAILS[head.replace(/\s+/gu, " ")]?.test(tail)) return null;
  const lowerPrev = prev.toLowerCase();
  // "Zrobię to pod warunkiem że": "to" is the verb's object here, not "to że".
  const object =
    lowerPrev === "to" &&
    finiteVerb(
      /(\p{L}+)[ \t\u00a0]+$/u
        .exec(ctx.text.slice(Math.max(0, m.index - 30), m.index))?.[1]
        ?.toLowerCase() ?? "",
    );
  if (!object && (OPENS_COMPOUND.has(lowerPrev) || PREPOSITION_SET.has(lowerPrev))) return null;
  if (userOrNamed(ctx, prev) || /^\p{Lu}+$/u.test(prev)) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + prev.length + gap.length,
    [`${prev},${gap}`],
    MISSING,
    "review_msg_pl_missing_comma",
  );
}

function notEnoughComma(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [`${m[0]},`],
    MISSING,
    "review_msg_pl_missing_comma",
  );
}

/** The named frame fixes of the comma rules of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  commaInsideConjunction,
  setPhraseCommas,
  commaBeforeEtc,
  commaAfterPreposition,
  missingCommas,
  missingCompoundCommas,
  notEnoughComma,
  adverbBeforeClause,
  clauseOpeners,
} satisfies Record<string, MatchFixer>;
