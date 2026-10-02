import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveOf,
  ALL_CASES,
  ambiguousVerb,
  cases,
  finiteVerb,
  hasAdjective,
  impersonalVerb,
  NEUTER,
  nounTags,
  onlyNoun,
} from "./lexicon";
import { findingAt, isPl, userOrNamed } from "./shared";

/*
 * Clause boundaries read from finite verbs: two clauses run on without a comma or a
 * conjunction ("Kupiłem wino chciałem też wodę"), a relative clause left open ("Partie, które
 * popieram przegrywają"), a contrasting "a" or "więc" between clauses without its comma, and an
 * adverbial participle phrase ("idąc", "zrobiwszy") not set off from its clause.
 */

const RULE = "polishMissingComma" as const;

/** A stretch of one sentence with no punctuation inside (a spaced " - " is a dash). */
const SEGMENT = /(?:[^,;:.!?…()[\]{}"„”“«»‚‘’'—–\n-]|(?<=\S)-|-(?=\S))+/gu;
const WORD = /\p{L}+/gu;

/** Words that join two clauses or open one: verbs with one of these between them are fine. */
const JOINS = new Set(
  (
    "i a oraz lub albo bądź ani czy ale lecz zaś więc bo że iż żeby aby by gdy kiedy jeśli " +
    "jeżeli gdyby choć chociaż jak jakby niż co kto gdzie dokąd skąd dlaczego czemu ile zanim " +
    "dopóki odkąd póki skoro ponieważ albowiem niech to tylko jednak natomiast toteż czyli " +
    "mianowicie ni"
  ).split(" "),
);
const joins = (word: string) =>
  JOINS.has(word) || /^(?:któr|jak|czyj|ilu|(?:gdy|że|a)?by(?:m|ś|śmy|ście)$)/u.test(word);
/** A relative pronoun, after a comma and a preposition or not ("dom, w którym"). */
const RELATIVE = /^któr/u;
/** Conjunctions that join two clauses after a comma ("…, a Jurek pisał", "…, więc poszedł"). */
const CONTRAST = /^(?:a|więc|lecz)$/u;
/** Conjunctions that may also join two parts of one phrase ("ważną i tajemniczą miną"). */
const COORDINATE = /^(?:i|oraz|lub|albo|bądź|ani|ni|a|zaś)$/u;

const FUTURE = /^będ(?:ę|ziesz|zie|ziemy|ziecie|ą)$/u;
const PAST = /(?:ł|ła|ło|li|ły)(?:em|am|eś|aś|śmy|ście|by\p{L}*)?$/u;
const INFINITIVE = /[ćc]$/u;
const MODAL = /^(?:musi|musia|mogł|mógł|mogl|chcia|chcie|mia|mie)/u;

interface Word {
  text: string;
  lower: string;
  start: number;
  end: number;
  /** A clause's finite verb (`verbAt`) and an adverbial participle, set once per segment. */
  verb?: boolean;
  participle?: boolean;
}

/**
 * "będzie (długo) robił", "robił będzie", "powinien był", "byłby zrobił", "wyobrażałem sobie
 * był": one verb in two words. "będą popierać przegrywały" is two.
 */
function compound(list: readonly Word[], a: number, b: number): boolean {
  const [first, second] = [list[a].lower, list[b].lower];
  const pair = [first, second];
  // "trzeba będzie", "można było".
  if (pair.some((w) => /^(?:trzeba|można)$/u.test(w)))
    return pair.some((w) => FUTURE.test(w) || /^był/u.test(w));
  // "będą umrzeć musieli": a modal takes the infinitive between.
  if (FUTURE.test(first) && PAST.test(second))
    return MODAL.test(second) || !list.slice(a + 1, b).some((w) => INFINITIVE.test(w.lower));
  if (PAST.test(first) && FUTURE.test(second)) return b === a + 1;
  if (pair.some((w) => /^powin/u.test(w))) return pair.some((w) => /^był/u.test(w));
  return pair.some((w) => /^był/u.test(w)) && pair.every((w) => PAST.test(w));
}
/** A form no noun or adjective shares: the past, "jest", "będzie", "powinien", "można". */
const CERTAIN =
  /(?:ł|ła|ło|li|ły)(?:em|am|eś|aś|śmy|ście|by\p{L}*)?$|^(?:jest|są|będ|powin|można|trzeba|należ|może$)|(?:ano|iono|[iyuę]to)$/u;

/** The finite verb (or the predicative "można", "trzeba") of a clause stands at `i`. */
function verbAt(list: readonly Word[], i: number): boolean {
  const word = list[i].lower;
  // A capital inside the sentence starts a name ("w Osunie").
  if (i > 0 && /^\p{Lu}/u.test(list[i].text)) return false;
  // "to znaczy", "to jest" (that is) and "na chybił trafił" link; they are no predicate.
  if (list[i - 1]?.lower === "to" && /^(?:znaczy|jest)$/u.test(word)) return false;
  if (/^(?:chybił|trafił)$/u.test(word)) return false;
  // "może" is also "maybe", unless an infinitive follows ("może być").
  if (word === "może") return INFINITIVE.test(list[i + 1]?.lower ?? "");
  if (PREDICATIVE.test(word) || finiteVerb(word) || impersonalVerb(word)) return true;
  // "miał" (also coal dust): a verb before an infinitive or after a personal pronoun.
  if (!ambiguousVerb(word) || joins(word)) return false;
  const next = list[i + 1]?.lower ?? "";
  return (
    (PAST.test(word) && INFINITIVE_FORM.test(next) && !nounTags(next)) ||
    /^(?:ja|ty|on|ona|ono|my|wy|oni|one)$/u.test(list[i - 1]?.lower ?? "")
  );
}
/** Impersonal predicates: "można", "trzeba", "należy zrobić". */
const PREDICATIVE = /^(?:można|trzeba|należy|należało|należałoby|wypada|wypadało)$/u;
/** An infinitive form: "zrobić", "móc", "pomóc", "biec". */
const INFINITIVE_FORM = /(?:ć|móc|biec|wlec|strzec|piec|rzec|tłuc)$/u;

/* -------------------------------------------------------------- participles */

/** Participles that work as prepositions ("począwszy od", "wyłączając") or in "chcąc nie chcąc". */
const FIXED = new Set(
  "począwszy skończywszy zacząwszy wyjąwszy pominąwszy wyłączając włączając wliczając chcąc".split(
    " ",
  ),
);
/** Adverbs that open a parenthetical "mówiąc" or "biorąc" ("krótko mówiąc"). */
const ASIDE =
  /^(?:krótko|szczerze|ściśle|ogólnie|prawdę|inaczej|nawiasem|delikatnie|otwarcie|uczciwie|obiektywnie|generalnie|praktycznie|łagodnie|oględnie|kolokwialnie|potocznie|formalnie)$/u;

/** An adverbial participle: "idąc", "mając"; "zrobiwszy", "przyszedłszy". */
export function adverbialParticiple(word: string): boolean {
  if (FIXED.has(word) || nounTags(word) || adjectiveOf(word)) return false;
  if (/ąc$/u.test(word)) return word.length >= 4;
  // Not a comparative ("nowszy", "ciekawszy") or "pierwszy".
  return (
    /[wł]szy$/u.test(word) &&
    word.length >= 7 &&
    !/^naj|pierwszy$/u.test(word) &&
    !hasAdjective(`${word.slice(0, -3)}y`)
  );
}

function words(segment: string, offset: number): Word[] {
  return [...segment.matchAll(WORD)].map((m) => ({
    text: m[0],
    lower: m[0].toLowerCase(),
    start: offset + m.index,
    end: offset + m.index + m[0].length,
  }));
}

/** Insert ", " in the gap before `word` (a fix of the spaces between it and the word before). */
function commaBefore(
  ctx: DetectContext,
  list: readonly Word[],
  at: number,
  segment: [number, number],
  messageKey: RawFinding["messageKey"],
  choose = false,
): RawFinding {
  return {
    ...findingAt(ctx, list[at - 1].end, list[at].start, [", "], RULE, messageKey),
    ...(choose ? { requiresChoice: true as const } : {}),
    context: { start: segment[0], end: segment[1] },
  };
}

function warning(
  ctx: DetectContext,
  word: Word,
  segment: [number, number],
  messageKey: RawFinding["messageKey"],
): RawFinding {
  return {
    ...findingAt(ctx, word.start, word.end, [], RULE, messageKey),
    context: { start: segment[0], end: segment[1] },
  };
}

const PARTICIPLE = "review_msg_pl_participle_comma" as const;

function participles(ctx: DetectContext, list: Word[], segment: [number, number]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.participle || userOrNamed(ctx, p.text)) continue;
    const prev = list[i - 1];
    const next = list[i + 1];
    // "krótko mówiąc", "szczerze mówiąc": a parenthetical, set off on both sides. At the start
    // ("Szczerze mówiąc nie wiem") the comma frames already ask for its comma.
    if (/^(?:mówiąc|biorąc)$/u.test(p.lower) && prev && ASIDE.test(prev.lower)) {
      const before = list[i - 2];
      if (before && next)
        findings.push({
          ...findingAt(
            ctx,
            before.end,
            next.start,
            [`, ${ctx.source.slice(prev.start, p.end)}, `],
            RULE,
            PARTICIPLE,
          ),
          context: { start: segment[0], end: segment[1] },
        });
      continue;
    }
    // One participle word alone ("jadł stojąc") is left alone.
    if (!next) continue;
    let verbBefore = i - 1;
    while (verbBefore >= 0 && !list[verbBefore].verb) verbBefore--;
    const verbAfter = list.findIndex((w, j) => j > i + 1 && w.verb);
    const opened = prev && joins(prev.lower);
    if (
      verbAfter > 0 &&
      (verbBefore < 0 || opened) &&
      !list.slice(i + 1, verbAfter).some((w) => joins(w.lower) && !COORDINATE.test(w.lower))
    ) {
      // "Zrobiwszy zakupy wróciła", "że mając czas zapomniał": the phrase needs its closing
      // comma before the main clause.
      findings.push(warning(ctx, p, segment, PARTICIPLE));
      continue;
    }
    if (
      verbBefore >= 0 &&
      !opened &&
      !list.slice(verbBefore + 1, i).some((w) => joins(w.lower) && !COORDINATE.test(w.lower))
    ) {
      // "Szedł powoli rozglądając się" -> "Szedł powoli, rozglądając się".
      const start = prev.lower === "nie" && i - 1 > verbBefore ? i - 1 : i;
      findings.push(commaBefore(ctx, list, start, segment, PARTICIPLE));
    }
  }
  return findings;
}

/* ------------------------------------------------------------ purpose openers */

/**
 * "Aby zdać egzamin student musi się uczyć": a purpose phrase opening the sentence ends with a
 * comma before the main clause. Warns at the main clause's verb.
 */
function purposeOpeners(ctx: DetectContext, list: Word[], segment: [number, number]): RawFinding[] {
  const first = /^(?:ale|a|i|lecz|więc|zatem)$/u.test(list[0].lower) ? 1 : 0;
  if (!/^(?:aby|żeby|ażeby|by)$/u.test(list[first]?.lower ?? "")) return [];
  const before = ctx.text.slice(Math.max(0, segment[0] - 8), segment[0]);
  if (segment[0] > 0 && !/(?:^|[.!?…,;:]["”’»)]*|\n)[ \t\u00a0]*$/u.test(before)) return [];
  let at = first + 1;
  while (at < first + 3 && /^(?:się|nie|sobie|to|tego|ją|go|je)$/u.test(list[at]?.lower ?? ""))
    at++;
  const infinitive = list[at];
  if (!infinitive || !INFINITIVE_FORM.test(infinitive.lower) || nounTags(infinitive.lower))
    return [];
  const verb = list.findIndex((w, j) => j > at && w.verb);
  if (verb < 0) return [];
  if (
    list
      .slice(at + 1, verb)
      .some(
        (w) => w.participle || (joins(w.lower) && !COORDINATE.test(w.lower) && w.lower !== "to"),
      )
  )
    return [];
  return [warning(ctx, list[verb], segment, "review_msg_pl_run_on")];
}

/* ------------------------------------------------------------------ run-ons */

const RUN_ON = "review_msg_pl_run_on" as const;

/** Conjunctions opening a clause that a correlative "to" answers. */
const CONDITIONAL =
  /^(?:jeśli|jeżeli|jeśliby|jeżeliby|gdy|gdyby|kiedy|skoro|ponieważ|chociaż|choć)$/u;

/**
 * The "to" at `at` answers a conditional clause opening the segment, not a pronoun: not right
 * after the verb ("Jeśli zrobisz to dobrze") and not before a neuter noun ("to zdjęcie").
 */
function correlativeTo(list: readonly Word[], verb: number, at: number): boolean {
  if (list[at].lower !== "to" || at <= verb + 1) return false;
  const first = /^(?:a|i|ale|lecz)$/u.test(list[0].lower) ? 1 : 0;
  if (!CONDITIONAL.test(list[first].lower) || first >= verb) return false;
  if (list.slice(first + 1, verb).some((w) => joins(w.lower) && !COORDINATE.test(w.lower)))
    return false;
  let k = at + 1;
  while (k < list.length && adjectiveOf(list[k].lower) && !nounTags(list[k].lower)) k++;
  const tags = list[k] ? nounTags(list[k].lower) : 0;
  return !(onlyNoun(tags) && tags & NEUTER && tags & cases("Ns As"));
}

function runOns(
  ctx: DetectContext,
  list: Word[],
  segment: [number, number],
  afterComma: boolean,
): RawFinding[] {
  const verbs = list.flatMap((w, i) => (w.verb ? [i] : []));
  for (let k = 1; k < verbs.length; k++) {
    const [a, b] = [verbs[k - 1], verbs[k]];
    if (compound(list, a, b)) continue;
    // "Jak się okazało pociąg odjechał": the aside's own comma frame asks for it.
    if (
      /^jak (?:się )?(?:okazało|widać|wiadomo)$/u.test(
        list
          .slice(0, a + 1)
          .map((w) => w.lower)
          .join(" "),
      )
    )
      continue;
    if (list.slice(0, b).some((w) => w.participle)) return [];
    const between = list.slice(a + 1, b).flatMap((w, j) => (joins(w.lower) ? [a + 1 + j] : []));
    // "Jeżeli pada deszcz to rano są kałuże": "to" answering a conditional opener.
    const linking = between.filter((j) => !COORDINATE.test(list[j].lower));
    if (linking.length === 1 && correlativeTo(list, a, linking[0]))
      return [commaBefore(ctx, list, linking[0], segment, RUN_ON, true)];
    // Two present forms may hide a noun or an adjective ("bawię się muszą nóżką").
    if (!CERTAIN.test(list[a].lower) && !CERTAIN.test(list[b].lower)) continue;
    if (between.length === 1 && CONTRAST.test(list[between[0]].lower)) {
      // "Marek czytał a Jurek pisał": a contrasting "a" between clauses takes a comma; not
      // "między domem a szkołą".
      if (list.slice(0, between[0]).some((w) => /^(?:po)?między$/u.test(w.lower))) continue;
      return [commaBefore(ctx, list, between[0], segment, RUN_ON)];
    }
    if (between.length) continue;
    // "…, który popieram przegrywają": the relative clause closes before the second verb.
    const relative =
      afterComma &&
      list.slice(0, Math.min(2, a)).some((w) => RELATIVE.test(w.lower)) &&
      !list.slice(0, a).some((w) => joins(w.lower) && !RELATIVE.test(w.lower));
    // The comma goes before the second verb (or its "nie") where the word before ends the
    // relative clause for sure: its verb, an infinitive, a noun or an adjective.
    const start = list[b - 1].lower === "nie" && b - 1 > a ? b - 1 : b;
    const last = list[start - 1].lower;
    if (
      relative &&
      (start - 1 === a ||
        INFINITIVE.test(last) ||
        nounTags(last) & ALL_CASES ||
        adjectiveOf(last) !== null)
    )
      return [commaBefore(ctx, list, start, segment, RUN_ON, true)];
    return [warning(ctx, list[b], segment, RUN_ON)];
  }
  return [];
}

function clauses(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  SEGMENT.lastIndex = Math.max(0, ctx.from - 400);
  for (let m = SEGMENT.exec(ctx.scanText); m && m.index < ctx.to; m = SEGMENT.exec(ctx.scanText)) {
    const end = m.index + m[0].length;
    if (end <= ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    const list = words(m[0], m.index);
    for (const [i, w] of list.entries()) {
      w.verb = verbAt(list, i);
      w.participle = adverbialParticiple(w.lower);
    }
    if (list.length < 3) continue;
    const segment: [number, number] = [m.index, end];
    const afterComma = ctx.text[m.index - 1] === ",";
    for (const finding of [
      ...participles(ctx, list, segment),
      ...purposeOpeners(ctx, list, segment),
      ...runOns(ctx, list, segment, afterComma),
    ])
      if (finding.range.start >= ctx.from && finding.range.start < ctx.to) findings.push(finding);
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? clauses(ctx) : []),
  },
];
