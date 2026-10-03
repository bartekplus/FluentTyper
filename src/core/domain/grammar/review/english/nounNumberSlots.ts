import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { englishNounForms, hasCountPrefix } from "../../implementations/helpers/EnglishNounNumber";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  ADVERBS,
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  info,
  PREPOSITIONS,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Noun number against its determiner or count, with singular/plural forms read from the
// generated lexicon: "a new issues", "five book", "this errors are", "each children".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// Irregular plurals the dictionary does not link to their singular.
const IRREGULAR = new Map(
  (
    "man men woman women child children person people foot feet tooth teeth mouse mice goose " +
    "geese criterion criteria phenomenon phenomena stimulus stimuli analysis analyses crisis " +
    "crises thesis theses hypothesis hypotheses diagnosis diagnoses parenthesis parentheses " +
    "cactus cacti fungus fungi nucleus nuclei radius radii appendix appendices matrix matrices " +
    "vertex vertices alumnus alumni curriculum curricula bacterium bacteria ox oxen knife knives " +
    "wife wives life lives half halves wolf wolves shelf shelves thief thieves loaf loaves leaf " +
    "leaves freshman freshmen gentleman gentlemen chairman chairmen policeman policemen fireman " +
    "firemen fisherman fishermen salesman salesmen spokesman spokesmen businessman businessmen " +
    "workman workmen postman postmen snowman snowmen grandchild grandchildren"
  )
    .split(" ")
    .flatMap((w, i, all) => (i % 2 ? [] : [[w, all[i + 1]] as const])),
);
const IRREGULAR_PLURALS = new Map([...IRREGULAR].map(([s, p]) => [p, s]));
// Plural-looking nouns that are singular or invariant: "a means", "a series", "a big thanks".
const INVARIANT = new Set(
  (
    "means series species news odds headquarters crossroads barracks gallows whereabouts thanks " +
    "kudos savings sales works premises remains lens bus gas yes congrats outskirts arms goods " +
    "lots data media percent pence head stone fold clogs guys folks sigma"
  ).split(" "),
);
// Words that count or group and never take the number themselves: "a hundred years".
const NUMERAL_NOUNS = new Set(
  "hundred thousand million billion trillion dozen couple few lot lots number pair score handful bunch total majority".split(
    " ",
  ),
);
const NUMBER_WORDS = new Set(
  "two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety".split(
    " ",
  ),
);
// Nouns used uncountably that a/an and many never take: "an advice", "many money".
export const MASS = new Set(
  (
    "information advice equipment furniture luggage baggage feedback homework housework " +
    "software hardware progress traffic music money wisdom garbage rubbish clothing jewelry " +
    "jewellery machinery scenery vocabulary wine knowledge research evidence"
  ).split(" "),
);
const COUNT_LABELS =
  /\b(?:page|step|item|version|level|chapter|section|figure|table|number|no|line|row|column|volume|issue|part|phase|stage|round|game|episode|season|class|grade|room|floor|gate|platform|exit|route|channel|size|model|type|option|question|rule|article|act|scene|week|day|year|top|windows|iphone|ios|android|python|java|v|vol|ch|fig|pp|p)[ \t .#]*$/i;

type Number_ = { singular: string; plural: string; number: "singular" | "plural" };

/** Singular/plural forms of a lowercase noun and which one it is, or null. */
export function nounNumber(word: string): Number_ | null {
  if (
    INVARIANT.has(word) ||
    /(?:ics|wards|doors|stairs|works)$/.test(word) ||
    FUNCTION_WORDS.has(word)
  )
    return null;
  const irregular = IRREGULAR.get(word);
  if (irregular) return { singular: word, plural: irregular, number: "singular" };
  const singular = IRREGULAR_PLURALS.get(word);
  if (singular) return { singular, plural: word, number: "plural" };
  const pair = englishNounPair(word);
  if (pair) return { ...pair, number: word === pair.plural ? "plural" : "singular" };
  // Long nouns the lexicon lists only in its Bloom filter: regular plurals.
  const listed = englishListedNoun(word);
  // "dolphins" may hit the filter too: a listed stem before -s makes it the plural.
  if (
    listed === "singular" &&
    /s$/.test(word) &&
    englishListedNoun(word.slice(0, -1)) === "singular"
  )
    return null;
  if (listed === "singular" && !englishListedWithoutPlural(word) && !englishWordInfo(word))
    return { singular: word, plural: regularPlural(word), number: "singular" };
  if (listed === "plural" && !englishWordInfo(word)) {
    const stem = [word.replace(/ies$/, "y"), word.replace(/es$/, ""), word.slice(0, -1)].find(
      (s) => s !== word && englishListedNoun(s) === "singular" && regularPlural(s) === word,
    );
    if (stem) return { singular: stem, plural: word, number: "plural" };
  }
  // Derived nouns ("hikers" from hike + -er + -s) read as plain plurals only.
  const read = englishWordInfo(word);
  if (read?.plural && !read.verbs.length && !read.adjective && /ers$/.test(word)) {
    const stem = englishWordInfo(word.slice(0, -1));
    if (stem?.noun && !stem.plural && !stem.verbs.length)
      return { singular: word.slice(0, -1), plural: word, number: "plural" };
  }
  return null;
}

function regularPlural(word: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** A word that could head or continue a noun phrase (so the phrase has not ended). */
function nounLike(t: Token | undefined): boolean {
  if (t?.kind !== "word") return t?.kind === "number";
  if (FUNCTION_WORDS.has(t.lower)) return false;
  if (IRREGULAR_PLURALS.has(t.lower) || IRREGULAR.has(t.lower)) return true;
  const read = englishWordInfo(t.lower);
  if (!read) return !!englishListedNoun(t.lower) || t.text !== t.lower;
  return read.noun || read.plural || (read.adjective && !read.adverb);
}

/** An adjective that is no noun: after a noun it starts a predicate ("my friend live…"). */
function adjectiveOnly(t: Token | undefined): boolean {
  const read = t?.kind === "word" ? englishWordInfo(t.lower) : null;
  return !!read && read.adjective && !read.noun && !read.plural;
}

const plain = (ctx: DetectContext, t: Token | undefined) =>
  t?.kind === "word" && t.text === t.lower && !ctx.dictionary.has(t.lower);

/**
 * The head noun after up to three modifiers: adjectives and participles, and with `nouns`
 * also noun modifiers ("a tax problems"). -1 when the phrase holds something else.
 */
function nounAfterModifiers(
  ctx: DetectContext,
  tokens: Token[],
  nouns: boolean,
  extra?: (word: string) => boolean,
): number {
  for (let k = 0; k < 4; k++) {
    const t = tokens[k];
    if (!plain(ctx, t) || NUMERAL_NOUNS.has(t.lower) || NUMBER_WORDS.has(t.lower)) return -1;
    const next = tokens[k + 1];
    if (!plain(ctx, next) || !nounLike(next) || nounNumber(t.lower)?.number === "plural") return k;
    if (adjectiveOnly(next) && nounNumber(t.lower)) return k;
    const read = info(t.lower);
    const adjective =
      !!read &&
      (read.adjective || read.verbs.some((v) => v.form === "participle" || v.form === "ing"));
    const noun = nouns && (read ? read.noun : englishListedNoun(t.lower) === "singular");
    const modifier =
      extra?.(t.lower) ||
      adjective ||
      noun ||
      /^(?:very|really|most|more|new|pretty)$/.test(t.lower);
    if (!modifier) return -1;
  }
  return -1;
}

const COUNTERS = new Set("many several various numerous multiple few these those".split(" "));
// Closed words that end a noun phrase before them.
const ENDERS = new Set(
  "of in on at for with from about by into than that which who whom where when because if as ago though too later now today yesterday tomorrow tonight again here there anyway instead yet but so".split(
    " ",
  ),
);
const FINITE =
  /^(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|do|does|did)$/;
// Nouns used as adverbs, units or currencies after a number: "ten tomorrow", "512 bit", "160 euro".
const NOT_COUNTED = new Set(
  "today tomorrow tonight yesterday now time way kind sort type percent bit byte euro yen yuan won baht rand max min foot".split(
    " ",
  ),
);

/**
 * The noun phrase ends after token k: at punctuation, a comma not followed by another noun
 * ("various oyster, mussel and clam species"), a closed word or, with `finite`, a finite verb.
 */
function phraseEnds(ctx: DetectContext, tokens: Token[], k: number, finite: boolean): boolean {
  // "every players' distance": a possessive.
  if (/^['’]/.test(ctx.text.slice(tokens[k].end, tokens[k].end + 1))) return false;
  const next = tokens[k + 1];
  if (!next || next.kind === "end") return true;
  if (next.kind === "comma") {
    const after = tokens[k + 2];
    return !after || after.kind === "end" || (after.kind === "word" && !nounLike(after));
  }
  if (next.kind !== "word") return false;
  // "plug in devices": a particle compound.
  if (/^(?:in|on)$/.test(next.lower) && nounLike(tokens[k + 2])) return false;
  if (ENDERS.has(next.lower) || (finite && FINITE.test(next.lower))) return true;
  // A past or -s verb that is no noun: "each students got…".
  const read = finite && info(next.lower);
  return (
    !!read &&
    !read.noun &&
    !read.adjective &&
    // A regular -ed form may be a participle compound ("move related items").
    (read.verbs.some((v) => v.form === "third") ||
      (read.verbs.some((v) => v.form === "past") &&
        !read.verbs.some((v) => v.form === "participle")))
  );
}

/** Every frame near the chunk: findings start at the noun, so `english` keeps the chunk's own. */
const frames = (ctx: DetectContext, pattern: string) => frameMatches(ctx, pattern, null);

function finding(
  ctx: DetectContext,
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  from: number,
): RawFinding {
  return {
    ruleId: "englishNounNumber",
    messageKey,
    range: { start, end },
    alternatives,
    context: evidence(ctx, from, end),
  };
}

const TIME_PLURALS =
  /^(?:seconds|minutes|hours|days|weeks|months|years|decades|centuries|moments|generations|tens|dozens|hundreds|thousands|millions|billions)$/;

/** "a new issues", "an examples of": a/an before a plural that ends its phrase. */
function articleWithPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(ctx, `(?<target>an?)${SPACE}(?=[a-z])`)) {
    const article = m.groups!.target;
    if (article !== article.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const k = nounAfterModifiers(ctx, tokens, true);
    if (k < 0) continue;
    const noun = tokens[k];
    const forms = nounNumber(noun.lower);
    if (forms?.number !== "plural" || /(?:wards|doors|stairs)$/.test(noun.lower)) continue;
    // "just a days later": a time plural before later/earlier.
    const later =
      TIME_PLURALS.test(noun.lower) && /^(?:later|earlier)$/.test(tokens[k + 1]?.lower ?? "");
    const modifiers = tokens.slice(0, k);
    // "a criteria we use": an irregular plural before a relative clause's subject.
    const relative =
      k === 0 &&
      IRREGULAR_PLURALS.has(noun.lower) &&
      /^(?:i|we|you|they|he|she)$/.test(tokens[k + 1]?.lower ?? "");
    // "a new elections was held": a singular verb closes the plural's phrase.
    const singularVerb =
      /^(?:is|was|has)$/.test(tokens[k + 1]?.lower ?? "") && noun.lower !== "people";
    if (!later && !relative && !singularVerb && !phraseEnds(ctx, tokens, k, false)) continue;
    // A noun modifier ("a problem humans have", "a stroke days after") may close its phrase
    // before a relative clause or a time phrase: only a following preposition is evidence.
    const nounModifier = modifiers.some((t) => {
      const read = info(t.lower);
      return read ? read.noun && !read.adjective : !!englishListedNoun(t.lower);
    });
    // At the sentence end the plural has no clause of its own: "This is a jelly beans."
    // Only as a predicate after be: "taught a friend harmonies." has two objects.
    const sentenceEnd =
      tokens[k + 1]?.kind === "end" &&
      /^[.!?]/.test(tokens[k + 1].text) &&
      /\b(?:is|are|was|were|am|be|been)(?:[ \t\u00a0]+[a-z]+ly)?[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 32), m.index),
      );
    if (
      nounModifier &&
      (TIME_PLURALS.test(noun.lower) ||
        (!/^(?:of|for|with)$/.test(tokens[k + 1]?.lower ?? "") && !sentenceEnd))
    )
      continue;
    // "a requires b", "lowercase a denotes": the letter a before a verb.
    // "a fish lives", "a pretty blonde looks": a noun subject before an -s verb.
    const read = englishWordInfo(noun.lower);
    // "a questions of time", "not a new issues.": before "of" or the sentence end, an -s word
    // after "a" and adjective-like modifiers is the noun ("a dog barks." keeps its verb).
    const after = tokens[k + 1];
    const closes = !after || after.kind === "end" || /^(?:of|about)$/.test(after.lower);
    const adjectiveLike = modifiers.every((t) => {
      const m = info(t.lower);
      return !!m && (m.adjective || m.verbs.some((v) => v.form === "participle"));
    });
    if (
      read?.verbs.some((v) => v.form === "third") &&
      !(read.noun && closes && adjectiveLike) &&
      !(read.noun && sentenceEnd) &&
      (k === 0 || modifiers.some((t) => info(t.lower)?.noun || !info(t.lower)))
    )
      continue;
    if (
      modifiers.some((t) =>
        /^(?:few|many|lot|several|little|zillion|most|greatest|best)$|est$/.test(t.lower),
      )
    )
      continue;
    findings.push(
      finding(ctx, "review_msg_noun_count", noun.start, noun.end, [forms.singular], m.index),
    );
  }
  return findings;
}

/** "five book.", "many child are", "these error are": a plural count before a singular. */
function countWithSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(
    ctx,
    `(?<target>[0-9]{1,3}(?:,[0-9]{3})*|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|many|several|various|numerous|multiple|few|these|those)${SPACE}(?=[a-z])`,
  )) {
    const count = m.groups!.target.toLowerCase();
    const before = ctx.text.slice(Math.max(0, m.index - 48), m.index);
    const previous = wordBefore(ctx, m.index);
    if (/^[0-9]/.test(count)) {
      const n = Number(count.replace(/,/g, ""));
      // "face 2 face", "how 2 spell", "$5 bill", "12 by 9".
      if (n < 2 || n === 2 || n === 4 || /[.,:/$€£#×x*–—-][ \t ]*$/.test(before)) continue;
      // "force 11 gale", "a single 25 minute": only after a verb or a closed word.
      const read = previous ? info(previous) : null;
      if (previous && !FUNCTION_WORDS.has(previous) && (!read || read.noun || read.adjective))
        continue;
    }
    if (count === "few" && !/\ba[ \t ]+$/i.test(before)) continue;
    if (/\ban?[ \t ]+$/i.test(before) && count !== "few") continue;
    if (hasCountPrefix(before) || COUNT_LABELS.test(before)) continue;
    // "you two look", "the other two chase", "magnitude 6 earthquake": a pronoun, ordinal or
    // label before the count.
    if (previous && !/^(?:these|those|few)$/.test(count)) {
      const read = info(previous);
      if (
        /^(?:we|you|they|us|them|other|first|last|next|final|top|more|by|x|from|between)$/.test(
          previous,
        ) ||
        (read ? read.noun && !read.verbs.length : !!englishListedNoun(previous)) ||
        /[A-Z]/.test(previous.slice(0, 1))
      )
        continue;
    }
    if (/[A-Z]\w*[ \t ]+$/.test(before)) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const k = nounAfterModifiers(ctx, tokens, false, (w) => w === "other");
    if (k < 0) continue;
    if (tokens.slice(0, k).some((t) => /^(?:more|less)$/.test(t.lower))) continue;
    if (/^[0-9]/.test(count) && k > 0) continue;
    const noun = tokens[k];
    const forms = nounNumber(noun.lower);
    if (forms?.number !== "singular" || forms.singular === forms.plural) continue;
    if (/^[0-9]/.test(count) && noun.lower.length < 5) continue;
    // "two bachelor of science degrees": a compound head.
    if (tokens[k + 1]?.lower === "of") continue;
    if (MASS.has(noun.lower) && /^(?:many|several|few)$/.test(count) && k === 0) {
      // "many wine", "several advice", "a few luggage": a mass noun takes much/some/little.
      const fix = count === "many" ? "much" : count === "several" ? "some" : "little";
      const [start] = m.indices!.groups!.target;
      if (phraseEnds(ctx, tokens, k, true))
        findings.push(
          finding(
            ctx,
            "review_msg_noun_count",
            start,
            start + count.length,
            [caseLike(m.groups!.target, fix)],
            m.index,
          ),
        );
      continue;
    }
    if (NOT_COUNTED.has(noun.lower) || MASS.has(noun.lower)) continue;
    // Authored count nouns after a number belong to englishNounNumber's own templates.
    if (englishNounForms(noun.lower) && !COUNTERS.has(count)) continue;
    const read = englishWordInfo(noun.lower);
    if (read?.adjective) continue;
    const verbToo = !!read?.verbs.length;
    const demonstrative = count === "these" || count === "those";
    const next = tokens[k + 1];
    if (demonstrative) {
      // Only a plural verb settles it: "these error are" (not "these help", "those mean").
      if (!verbToo && /^(?:are|were|have)$/.test(next?.lower ?? ""))
        findings.push(
          finding(
            ctx,
            "review_msg_demonstrative_number",
            noun.start,
            noun.end,
            [forms.plural],
            m.index,
          ),
        );
      continue;
    }
    // "Many believe", "416 run on gas": a pronoun count before a verb.
    if (verbToo && k === 0 && next?.kind !== "end") continue;
    if (!phraseEnds(ctx, tokens, k, true)) continue;
    findings.push(
      finding(ctx, "review_msg_noun_count", noun.start, noun.end, [forms.plural], m.index),
    );
  }
  return findings;
}

/**
 * "resolve these issue", "extend those rule", "for these information": an object after these/
 * those whose noun is singular. Count nouns get both repairs; mass nouns take this/that.
 */
function demonstrativeSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<dem>these|those)${SPACE}(?=[a-z])`, "dem")) {
    const dem = m.groups!.dem;
    const previous = wordBefore(ctx, m.index);
    const read = previous ? info(previous) : null;
    const object =
      PREPOSITIONS.has(previous) || (!!read?.verbs.length && !FUNCTION_WORDS.has(previous));
    if (!object) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const k = nounAfterModifiers(ctx, tokens, false);
    if (k < 0) continue;
    const noun = tokens[k];
    if (!phraseEnds(ctx, tokens, k, true) || tokens[k + 1]?.lower === "of") continue;
    // "one of these elephant" belongs to the one-of check; a quote after makes a compound.
    if (previous === "of" || /^[ \t\u00a0]*["“'‘]/.test(ctx.text.slice(noun.end, noun.end + 3)))
      continue;
    if (NOT_COUNTED.has(noun.lower)) continue;
    const single = caseLike(dem, dem.toLowerCase() === "these" ? "this" : "that");
    const [start] = m.indices!.groups!.dem;
    const middle = ctx.source.slice(start + dem.length, noun.start);
    let alternatives: string[];
    if (MASS.has(noun.lower)) alternatives = [`${single}${middle}${noun.text}`];
    else {
      const forms = nounNumber(noun.lower);
      if (forms?.number !== "singular" || forms.singular === forms.plural) continue;
      // "I hope these help", "make those change": a verb reading keeps "these" a pronoun,
      // unless no clause can start there: "resolve these issue.", "for these rule.".
      const nounRead = englishWordInfo(noun.lower);
      if (nounRead?.adjective) continue;
      if (
        nounRead?.verbs.length &&
        (k > 0 ||
          CLAUSE_OPENERS.test(previous) ||
          FUNCTION_WORDS.has(previous) ||
          !/^(?:end|comma)$/.test(tokens[k + 1]?.kind ?? "end"))
      )
        continue;
      alternatives = [`${dem}${middle}${forms.plural}`, `${single}${middle}${noun.text}`];
    }
    findings.push({
      ruleId: "englishNounNumber",
      messageKey: "review_msg_demonstrative_number",
      range: { start, end: noun.end },
      alternatives,
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context: evidence(ctx, m.index, noun.end),
    });
  }
  return findings;
}

// Words after which "these/those" may open a clause: "hope these help", "until those dry".
const CLAUSE_OPENERS =
  /^(?:make|makes|made|let|lets|help|helps|helped|have|has|had|see|saw|seen|watch|watched|hear|heard|feel|felt|notice|noticed|hope|hoped|think|thought|believe|guess|suppose|know|knew|say|said|says|bet|wish|expect|mean|means|until|till|after|before|since|as|than|like|unless|once|because|if|when|while|where|whether|so|and|or|but)$/;

const PRONOUN_POSSESSIVES = new Set("yours hers ours theirs its mine whose".split(" "));

/** "this errors are", "Can it find this errors?": this before a plural noun. */
function thisWithPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(ctx, `(?<target>this)${SPACE}(?<noun>[a-z]+)${WORD_END}`)) {
    const noun = m.groups!.noun;
    if (PRONOUN_POSSESSIVES.has(noun) || ctx.dictionary.has(noun)) continue;
    const forms = nounNumber(noun);
    if (forms?.number !== "plural") continue;
    const read = englishWordInfo(noun);
    if (read && (read.adverb || !read.noun)) continue;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const verb = next?.kind === "word" ? next.lower : "";
    const agree = /^(?:are|were|have|do|aren['’]t|weren['’]t|haven['’]t|don['’]t)$/.test(verb);
    // "This means…", "this works.": this + a verb unless a plural verb follows; "this types of
    // tools" has its plural noun before "of".
    // "this hundreds of times" counts; "This terms of business contains…" names one thing.
    const of =
      verb === "of" &&
      !!read?.plural &&
      !NUMERAL_NOUNS.has(noun.replace(/s$/, "")) &&
      !tokensAfter(ctx, m.index + m[0].length, 6).some(
        (t) =>
          t.kind === "word" && /^(?:is|was|has|contains|includes|applies|covers)$/.test(t.lower),
      );
    if (!agree && !of && (read?.verbs.length || !(next?.kind === "end" || next?.kind === "comma")))
      continue;
    if (/^(?:year|week|month|day|time|morning|evening|season)s$/.test(noun)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding(
        ctx,
        "review_msg_demonstrative_number",
        start,
        end,
        [caseLike(m.groups!.target, "these")],
        m.index,
      ),
    );
  }
  return findings;
}

/** "each children are", "every things went": each/every take a singular noun. */
function eachWithPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(ctx, `(?<target>each|every)${SPACE}(?=[a-z])`)) {
    const tokens = tokensAfter(ctx, m.index + m[0].length, 5);
    if (/^(?:other|one|and|few|single|time|so)$/.test(tokens[0]?.lower ?? "")) continue;
    const k = nounAfterModifiers(ctx, tokens, false);
    if (k < 0) continue;
    const noun = tokens[k];
    const forms = nounNumber(noun.lower);
    if (forms?.number !== "plural" || /(?:wards|doors|stairs)$/.test(noun.lower)) continue;
    // "They each take…": a pronoun "each" before a verb.
    const third = englishWordInfo(noun.lower)?.verbs.some((v) => v.form === "third");
    if (k === 0 && third) continue;
    // "Every body part hurts": a noun head, then its -s verb, unless a plural verb follows.
    if (
      third &&
      info(tokens[k - 1].lower)?.noun &&
      !/^(?:are|were|have|do|aren['’]t|weren['’]t|haven['’]t|don['’]t)$/.test(
        tokens[k + 1]?.lower ?? "",
      )
    )
      continue;
    if (!phraseEnds(ctx, tokens, k, true)) continue;
    findings.push(
      finding(ctx, "review_msg_noun_count", noun.start, noun.end, [forms.singular], m.index),
    );
  }
  return findings;
}

/** "a two questions", "a 150 likes ago": "a" before a count above one. */
function articleBeforeCount(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(
    ctx,
    `(?<target>an?${SPACE})(?<count>[0-9]{1,3}(?:,?[0-9]{3})*|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
  )) {
    const { count, noun } = m.groups!;
    // "worth a 1000 words" reads "a thousand"; "a 7 times the rate" multiplies.
    if (
      /^[0-9]/.test(count) &&
      (Number(count.replace(/,/g, "")) < 2 || /^10+$/.test(count.replace(/,/g, "")))
    )
      continue;
    if (noun === "times" || nounNumber(noun)?.number !== "plural") continue;
    // "a two weeks' wait": a possessive plural modifies the next noun.
    if (/^['’]/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 1))) continue;
    const next = tokensAfter(ctx, m.index + m[0].length, 2);
    const ok =
      !next[0] ||
      next[0].kind === "end" ||
      (next[0].kind === "comma" && !nounLike(next[1])) ||
      /^(?:ago|left|later|before|of|in|for|to|with|on|at|from|i|you|we|they|he|she|that|which|who|last|this|next|per|by|about|after)$/.test(
        next[0].lower,
      );
    if (!ok) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(finding(ctx, "review_msg_noun_count", start, end, [""], m.index));
  }
  return findings;
}

const PLURAL_ONLY =
  /^(?:thanks|kudos|props|damages|earnings|savings|proceeds|funds|means|news|goods|clothes|wages|taxes|sales|congratulations|regards|resources|data|media)$/;

/** "too much cars", "as much foreign languages as": much before a countable plural. */
function muchWithPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(
    ctx,
    `(?:too|so|as|are|were|how|this|that|not|even)${SPACE}(?<target>much)${SPACE}(?=[a-z])`,
  )) {
    // "Thanks so much people!", "love you so much guys": an adverb, then a term of address.
    if (
      !/^(?:are|were)/i.test(m[0]) &&
      /^(?:thanks|thx|you|it|them|him|her|me|us)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 5);
    const k = nounAfterModifiers(ctx, tokens, true);
    if (k < 0) continue;
    const noun = tokens[k];
    if (nounNumber(noun.lower)?.number !== "plural") continue;
    if (tokens.slice(0, k).some((t) => /^(?:more|less|better|worse)$/.test(t.lower))) continue;
    // Plural-only nouns take "much": "much thanks", "how much savings".
    if (PLURAL_ONLY.test(noun.lower)) continue;
    // After the newer leads ("how much", "this much"), the phrase may end before a subject
    // or an adverb too: "how much computers you test", "not much coaches around".
    // There the noun must not read as a verb ("not much changes") and a subject pronoun, a
    // preposition or the clause end must follow ("how much firms know" is a clause).
    const after = tokens[k + 1];
    if (/^(?:how|this|that|not|even)/i.test(m[0])) {
      // An -s verb reading needs the phrase to end: "not much changes around here" is a clause.
      const verbToo = !!englishWordInfo(noun.lower)?.verbs.some((v) => v.form === "third");
      if (
        verbToo &&
        !(!after || after.kind === "end" || after.kind === "comma" || after.lower === "of")
      )
        continue;
      const closed =
        !after ||
        after.kind === "end" ||
        after.kind === "comma" ||
        (after.kind === "word" &&
          (/^(?:i|you|we|they|he|she)$/.test(after.lower) ||
            (PREPOSITIONS.has(after.lower) && !ADVERBS.has(after.lower))));
      if (!closed) continue;
    } else if (!phraseEnds(ctx, tokens, k, false)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding(
        ctx,
        "review_msg_noun_count",
        start,
        end,
        [caseLike(m.groups!.target, "many")],
        m.index,
      ),
    );
  }
  return findings;
}

/** "Two of my friend have", "one of our client decided": a partitive takes a plural noun. */
function partitiveSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(
    ctx,
    `(?<count>two|three|four|five|six|seven|eight|nine|ten|several|many|few|both|[2-9]|[1-9][0-9])${SPACE}of${SPACE}(?:my|your|our|his|her|their|the|these|those)${SPACE}(?=[a-z])`,
  )) {
    const previous = wordBefore(ctx, m.index);
    // "step 4 of my script": a numbered label.
    const read = previous && info(previous);
    if (read && read.noun && !read.verbs.length) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 5);
    const k = nounAfterModifiers(ctx, tokens, false);
    if (k < 0) continue;
    const noun = tokens[k];
    if (noun.start < ctx.from || noun.start >= ctx.to) continue;
    const forms = nounNumber(noun.lower);
    if (forms?.number !== "singular" || MASS.has(noun.lower) || NOT_COUNTED.has(noun.lower))
      continue;
    // "one of the best", "one of my favorite": an adjective head.
    if (
      englishWordInfo(noun.lower)?.adjective ||
      /^(?:best|worst|most|least|last|first|next|latter|former|few|rest)$/.test(noun.lower)
    )
      continue;
    if (
      !phraseEnds(ctx, tokens, k, true) &&
      !(
        tokens[k + 1]?.kind === "word" &&
        /^(?:decided|said|told|asked|went|came|got|had|left|took|made)$/.test(tokens[k + 1].lower)
      )
    )
      continue;
    findings.push(finding(ctx, "review_msg_one_of", noun.start, noun.end, [forms.plural], m.index));
  }
  return findings;
}

/** "Other might benefit", "what other think": the pronoun is "others". */
function otherAsPronoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(ctx, `(?<target>other)${SPACE}(?<next>[a-z]+)${WORD_END}`)) {
    const before = wordBefore(ctx, m.index);
    if (before && !/^(?:and|but|so|what|that|if|when|because|while|how|why|where)$/.test(before))
      continue;
    const next = m.groups!.next.toLowerCase();
    // "What other do you…": an inverted question.
    if (before === "what" && /^(?:do|does|did|will|would|can|could|should|is|are)$/.test(next))
      continue;
    const read = englishWordInfo(next);
    const finite =
      /^(?:are|were|have|had|will|would|can|could|might|may|must|should|do|did|don['’]t)$/.test(
        next,
      ) ||
      (!!read && !read.noun && !read.adjective && read.verbs.some((v) => v.form === "base"));
    if (!finite) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding(
        ctx,
        "review_msg_noun_count",
        start,
        end,
        [caseLike(m.groups!.target, "others")],
        m.index,
      ),
    );
  }
  return findings;
}

const EXISTENTIAL_COUNT =
  "(?:many|several|few|some|no|any(?:[ \\t\\u00a0]+other)?|a[ \\t\\u00a0]+few|a[ \\t\\u00a0]+couple[ \\t\\u00a0]+of|two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9][0-9]+)";
// "Over there is…", "out there are…": a place adverb, not existential there.
const PLACE_BEFORE = /\b(?:over|out|in|up|down|from|back|under|right|around)[ \t\u00a0]+$/i;

/**
 * "There is many problems", "Here is some great alternatives": a plural count after a singular
 * existential verb; "There are many problem", "There are no book here": a singular noun after
 * a plural one.
 */
function existentialCount(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frames(
    ctx,
    `(?<there>there|here)(?:${SPACE}(?<verb>is|was|are|were)|(?<contracted>['’]s))${SPACE}(?:(?:only|still|also|just|really)${SPACE})?(?<count>${EXISTENTIAL_COUNT})${SPACE}(?=[a-z])`,
  )) {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (PLACE_BEFORE.test(before)) continue;
    const { there, verb, contracted, count } = m.groups!;
    const typed = verb ?? contracted;
    const singularVerb = /^(?:is|was|['’]s)$/i.test(typed);
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const k = nounAfterModifiers(ctx, tokens, true);
    if (k < 0) continue;
    const noun = tokens[k];
    const forms = nounNumber(noun.lower);
    if (!forms || forms.singular === forms.plural || MASS.has(forms.singular)) continue;
    // "five times as much", "some times ago": a multiplier or a time adverb.
    if (
      NUMERAL_NOUNS.has(noun.lower) ||
      NOT_COUNTED.has(noun.lower) ||
      noun.lower === "times" ||
      /^(?:better|worse|more|less|other)$/.test(noun.lower)
    )
      continue;
    // The noun closes its phrase: punctuation, a preposition, a conjunction or a place word.
    const after = tokens[k + 1];
    const ends =
      !after ||
      after.kind === "end" ||
      after.kind === "comma" ||
      (after.kind === "word" &&
        (ENDERS.has(after.lower) ||
          PREPOSITIONS.has(after.lower) ||
          /^(?:to|and|or|but|after|before|here|there|today|now|yet|anymore|left|sitting|standing|waiting)$/.test(
            after.lower,
          )));
    if (!ends) continue;
    const c = count.toLowerCase().replace(/[ \t\u00a0]+/g, " ");
    // "two errors and one warning", "tariff and non-tariff barriers": a list or shared modifier.
    if (
      after?.kind === "comma" ||
      /^(?:and|or|to)$/.test(after?.kind === "word" ? after.lower : "")
    )
      continue;
    // "two errors in the report and one in the file", a line break after the noun: a list.
    const rest = /^[^.!?;:\n]*/.exec(ctx.text.slice(noun.end, noun.end + 120))![0];
    if (
      /\b(?:and|or)[ \t\u00a0]+(?:a|an|one)\b/i.test(rest) ||
      /^[ \t\u00a0]*\r?\n/.test(ctx.text.slice(noun.end))
    )
      continue;
    if ([typed, noun.lower].some((w) => ctx.dictionary.has(w.toLowerCase()))) continue;
    // Counts the clause-final existential check already reads: "There is two errors."
    const covered =
      /^(?:many|several|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)$/.test(c) &&
      (!after ||
        after.kind === "end" ||
        /^(?:that|which|with)$/.test(after.lower) ||
        /^[ \t\u00a0]+(?:in|on|under|near|inside|outside)[ \t\u00a0]+(?:the|this|that|my|your|our|their)[ \t\u00a0]+(?:[a-z]+[ \t\u00a0]+)?(?:report|folder|file|document|room|box|table|account|list|screen|desk)\b/i.test(
          ctx.text.slice(noun.end, noun.end + 64),
        ));
    if (singularVerb && forms.number === "plural" && !covered) {
      // "There is no doubt", "there is some…": only the plural noun decides.
      const start = verb ? m.indices!.groups!.verb[0] : m.indices!.groups!.contracted[0];
      const end = verb ? m.indices!.groups!.verb[1] : m.indices!.groups!.contracted[1];
      const past = /^was$/i.test(typed);
      const fix = contracted ? `${caseLike(there, there)} are` : past ? "were" : "are";
      findings.push({
        ruleId: "englishExistentialAgreement",
        messageKey: "review_msg_existential_agreement",
        range: contracted ? { start: m.indices!.groups!.there[0], end } : { start, end },
        alternatives: [caseLike(contracted ? there : typed, fix)],
        context: evidence(ctx, m.index, noun.end),
      });
    } else if (
      !singularVerb &&
      forms.number === "singular" &&
      !/^(?:some|any|any other)$/.test(c) &&
      // "There are no doubt many ways": the adverb "no doubt".
      !(c === "no" && noun.lower === "doubt") &&
      !englishWordInfo(noun.lower)?.adjective &&
      tokens.slice(0, k).every((t) => t.lower !== "of")
    )
      findings.push(
        finding(ctx, "review_msg_noun_count", noun.start, noun.end, [forms.plural], m.index),
      );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishExistentialAgreement", "englishNounNumber"],
    detect: english(existentialCount),
  },
  {
    rules: ["englishNounNumber"],
    detect: english(
      articleWithPlural,
      countWithSingular,
      thisWithPlural,
      demonstrativeSingular,
      eachWithPlural,
      articleBeforeCount,
      muchWithPlural,
      partitiveSingular,
      otherAsPronoun,
    ),
  },
];
