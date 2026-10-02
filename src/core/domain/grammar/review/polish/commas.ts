import type { DetectContext, RawFinding } from "../reviewDetectors";
import { nounTags, onlyNoun } from "./lexicon";
import { findingAt, isPl, owned, PREPOSITIONS, sentenceStartAt, userOrNamed } from "./shared";

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
};
const INSIDE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?<prev>\\p{L}+)(?<gap>[ \\t\\u00a0]+))?(?<head>${Object.keys(COMPOUNDS)
    .map((head) => head.replace(" ", "[ \\t\\u00a0]+"))
    .join(
      "|",
    )})[ \\t\\u00a0]*,[ \\t\\u00a0]*(?<tail>${[...new Set(Object.values(COMPOUNDS).join("|").split("|"))].join("|")})(?![\\p{L}])`,
  "giu",
);
/** Words after which no comma opens the clause: conjunctions, and the sentence's start. */
const NO_COMMA_AFTER = new Set(
  "i a oraz lub albo bądź ani czy bo ale lecz niż jak jakby że iż żeby aby by gdy kiedy jeśli jeżeli gdyby który która które którego której którym których którzy to".split(
    " ",
  ),
);

function commaInsideConjunction(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, INSIDE)) {
    const { prev, gap, head, tail } = m.groups!;
    const headKey = head.toLowerCase().replace(/\s+/g, " ");
    if (!new RegExp(`^(?:${COMPOUNDS[headKey]})$`, "iu").test(tail)) continue;
    // "O, ile tu ludzi!" is the interjection "o".
    if (
      headKey === "o" &&
      /^O$/.test(head) &&
      sentenceStartAt(ctx.text, m.index + (prev ? prev.length + gap.length : 0))
    )
      continue;
    const headStart = m.index + (prev ? prev.length + gap.length : 0);
    // "wtedy nawet, gdy" (even then, when) and "czy tak, czy owak" keep their comma.
    if (prev && /^(?:wtedy|wówczas|tylko|właśnie|tam|tu|czy)$/iu.test(prev)) continue;
    const joined = `${head} ${tail}`;
    if (prev && !NO_COMMA_AFTER.has(prev.toLowerCase()) && !userOrNamed(ctx, prev)) {
      // "tam mimo, że" -> "tam, mimo że": the comma moves before the conjunction.
      findings.push(
        findingAt(
          ctx,
          m.index,
          m.index + m[0].length,
          [`${prev},${gap}${joined}`],
          MISPLACED,
          "review_msg_pl_misplaced_comma",
        ),
      );
    } else {
      findings.push(
        findingAt(
          ctx,
          headStart,
          m.index + m[0].length,
          [joined],
          MISPLACED,
          "review_msg_pl_misplaced_comma",
        ),
      );
    }
  }
  return findings;
}

/** Set phrases written without a comma, and no comma before "itd."/"itp.". */
const SET_PHRASES = new RegExp(
  `(?<![\\p{L}])(?<phrase>(?<a>tak|chcąc|bądź|byle|chybił|wypisz)[ \\t\\u00a0]*,[ \\t\\u00a0]*(?<b>czy[ \\t\\u00a0]+(?:siak|owak|inaczej)|nie[ \\t\\u00a0]+chcąc|co[ \\t\\u00a0]+bądź|jak|trafił|wymaluj))(?![\\p{L}])`,
  "giu",
);
const BEFORE_ETC = /(?<comma>[ \t ]*,)(?=[ \t ]*(?:itd|itp|etc)\.)/gu;
const PAIRS: Record<string, RegExp> = {
  tak: /^czy\s/iu,
  chcąc: /^nie\s+chcąc$/iu,
  bądź: /^co\s+bądź$/iu,
  byle: /^jak$/iu,
  chybił: /^trafił$/iu,
  wypisz: /^wymaluj$/iu,
};

function extraCommas(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, SET_PHRASES)) {
    const { phrase, a, b } = m.groups!;
    if (/(?:^|[^\p{L}])czy[ \t\u00a0]+$/iu.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)))
      continue;
    if (!PAIRS[a.toLowerCase()]?.test(b)) continue;
    // "Tak, czy inaczej?" can answer a question; only mid-sentence or before more text.
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + phrase.length,
        [`${a} ${b}`],
        MISPLACED,
        "review_msg_pl_misplaced_comma",
      ),
    );
  }
  for (const m of owned(ctx, BEFORE_ETC)) {
    // "itp., itd.": a list of abbreviations.
    if (ctx.text[m.index - 1] === ".") continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m.groups!.comma.length,
        [""],
        MISPLACED,
        "review_msg_pl_misplaced_comma",
      ),
    );
  }
  return findings;
}

/* ------------------------------------------------------ missing comma before */

const RELATIVE = "który|która|które|którego|której|któremu|którą|którym|których|którymi|którzy";
/** Question words that open an indirect question or a clause of place: "nie wiem, gdzie". */
const QUESTION_WORDS = "dlaczego|gdzie|kiedy";
const JAKI = "jaki|jaka|jakie|jakiego|jakiej|jakiemu|jaką|jakim|jakich|jakimi";
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
const MISSING_BEFORE = new RegExp(
  `(?<prev>\\p{L}+)(?<gap>[ \\t\\u00a0]+)(?:(?<prep>${PREPOSITIONS})[ \\t\\u00a0]+)?(?<sub>${SUBORDINATORS})(?![\\p{L}\\p{N}_'’-])`,
  "gu",
);

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

function missingCommas(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, MISSING_BEFORE)) {
    const { prev, gap, prep, sub } = m.groups!;
    if (/\p{Lu}/u.test(sub[0])) continue;
    const lowerPrev = prev.toLowerCase();
    // The word must start where the match starts (no letters glued before it).
    if (/[\p{L}\p{N}_'’-]/u.test(ctx.text[m.index - 1] ?? "")) continue;
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
        findings.push(
          findingAt(
            ctx,
            m.index,
            m.index + prev.length + gap.length,
            [`${prev},${gap}`],
            MISSING,
            "review_msg_pl_missing_comma",
          ),
        );
      }
      continue;
    }
    // A preposition only goes with the relative pronoun: "dom w którym".
    if (prep && !relative) continue;
    if (OPENS_COMPOUND.has(lowerPrev) || PREPOSITION_SET.has(lowerPrev)) continue;
    // "ale" before punctuation is the noun ("bez żadnych ale"); "ale" opening an exclamation.
    if (sub === "ale" || sub === "lecz") {
      const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (!/^[ \t ]+\p{L}/u.test(after)) continue;
    }
    if (userOrNamed(ctx, prev) || /^\p{Lu}+$/u.test(prev)) continue;
    const end = m.index + m[0].length;
    const next = /^[ \t\u00a0]+(\p{L}+)/u.exec(ctx.text.slice(end, end + 40))?.[1] ?? "";
    if (SET_AFTER[sub]?.test(next)) continue;
    // A bare question word ends the sentence without a comma: "Nie powie dlaczego."
    if (!next && new RegExp(`^(?:${QUESTION_WORDS})$`).test(sub)) continue;
    // "by" opens a clause of purpose before an infinitive ("wstąpił do domu, by się przebrać");
    // "można by zrobić", "mógł by zrobić" (split "mógłby") keep the conditional particle.
    if (sub === "by") {
      const verb =
        next === "się"
          ? (/^[ \t ]+się[ \t ]+(\p{L}+)/u.exec(ctx.text.slice(end, end + 60))?.[1] ?? "")
          : next;
      if (
        !/(?:ć|móc|biec|wlec|strzec|piec|rzec|tłuc)$/u.test(verb) ||
        nounTags(verb.toLowerCase()) ||
        /^(?:można|trzeba|warto|wolno|lepiej|dobrze|trudno|łatwo|należy|należało|wypada|wypadało|opłacało|coś|nic)$/iu.test(
          prev,
        ) ||
        /^(?:mógł|mogł|mogl|chcia|chcie|musia|musie|miał|miel|umiał|umiel|potrafi|wola|wole|zdoła|powin)/iu.test(
          prev,
        )
      )
        continue;
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
        /^[^.!\n]*[?!]/u.test(ctx.text.slice(end, end + 200)))
    )
      continue;
    // "zamiast" opens a clause only before an infinitive ("zamiast pracować"), not a noun.
    if (sub === "zamiast" && !/(?:ć|c)$/u.test(next)) continue;
    // A direct question keeps its question word: "A ty gdzie idziesz?".
    if (
      new RegExp(`^(?:${QUESTION_WORDS}|${RELATIVE})$`).test(sub) &&
      /^[^.!\n]*\?/u.test(ctx.text.slice(end, end + 200))
    )
      continue;
    // "złapać którego ptaka": after an infinitive "który" is the indefinite pronoun.
    if (relative && (/ć$/u.test(prev) || !relativeClause(ctx, m.index, m.index + m[0].length)))
      continue;
    // A comma is already there in some other form ("prev — że"), or the clause ends a quotation.
    const commaAt = m.index + prev.length;
    findings.push(
      findingAt(
        ctx,
        m.index,
        commaAt + gap.length,
        [`${prev},${gap}`],
        MISSING,
        "review_msg_pl_missing_comma",
      ),
    );
  }
  return findings;
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
const COMPOUND_BEFORE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<prev>\\p{L}+)(?<gap>[ \\t\\u00a0]+)(?<head>mimo|pomimo|nawet|dopiero|zwłaszcza|szczególnie|tym[ \\t\\u00a0]+bardziej|pod[ \\t\\u00a0]+warunkiem|podczas)[ \\t\\u00a0]+(?<tail>\\p{Ll}+)(?![\\p{L}\\p{N}_'’-])`,
  "gu",
);
/** "nie dość że" -> "nie dość, że". */
const NOT_ENOUGH = /(?<![\p{L}])[Nn]ie[ \t\u00a0]+dość(?=[ \t\u00a0]+że(?![\p{L}]))/gu;

function missingCompoundCommas(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, COMPOUND_BEFORE)) {
    const { prev, gap, head, tail } = m.groups!;
    if (!COMPOUND_TAILS[head.replace(/\s+/gu, " ")]?.test(tail)) continue;
    const lowerPrev = prev.toLowerCase();
    if (OPENS_COMPOUND.has(lowerPrev) || PREPOSITION_SET.has(lowerPrev)) continue;
    if (userOrNamed(ctx, prev) || /^\p{Lu}+$/u.test(prev)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + prev.length + gap.length,
        [`${prev},${gap}`],
        MISSING,
        "review_msg_pl_missing_comma",
      ),
    );
  }
  for (const m of owned(ctx, NOT_ENOUGH))
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${m[0]},`],
        MISSING,
        "review_msg_pl_missing_comma",
      ),
    );
  return findings;
}

export const DETECTORS = [
  {
    rules: [MISPLACED] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) ? [...commaInsideConjunction(ctx), ...extraCommas(ctx)] : [],
  },
  {
    rules: [MISSING] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) ? [...missingCommas(ctx), ...missingCompoundCommas(ctx)] : [],
  },
];
