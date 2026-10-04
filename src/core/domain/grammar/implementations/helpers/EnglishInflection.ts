import { englishLexiconInflect, englishWordInfo } from "./EnglishLexicon";
import { ENGLISH_VERB_FORMS, englishVerbForms } from "./EnglishVerbForms";

/** -s, -ed (past and participle) and -ing. */
export type EnglishInflection = "third" | "past" | "ing";

type Restore = "e" | "" | null;

const BY_LEMMA = new Map(ENGLISH_VERB_FORMS.map((entry) => [entry.lemma, entry]));
const TABLE_FORMS = new Set(
  ENGLISH_VERB_FORMS.flatMap((e) => [e.lemma, e.third, e.past, e.participle]),
);

// "be" has no table row: was/were depend on the subject, so its past is never generated.
const BE_FORMS: Readonly<Record<EnglishInflection, readonly string[]>> = {
  third: ["is"],
  past: ["was", "were", "been"],
  ing: ["being"],
};
const BE_INFLECT: Readonly<Record<EnglishInflection, string | null>> = {
  third: "is",
  past: null,
  ing: "being",
};

// Spelled like an inflection of a word the lexicon knows or leaves out (sometime, toward and
// beside are S-only entries; even and rag are verbs), but not one.
const NOT_INFLECTED = new Set([
  "sometimes",
  "towards",
  "afterwards",
  "besides",
  "ragged",
  "evening",
]);

// Tested in order on the folded stem left after -ed/-ing/-es, once doubled consonants are handled.
// "e" restores a silent e, "" keeps the stem, null abstains.
const STEM_RULES: readonly (readonly [RegExp, Restore])[] = [
  // watched, reached, pushed, laughed, showed, played, fixed, waltzed
  [/(?:[^aeiouY]|[aeiouY]{2})ch$|[aeiouY](?:sh|[wy])$|[gp]h$|x$|tz$/, ""],
  // bathed/berthed, cached/attached, bloodshed, synced, bobsled, tasted/lasted, cochleated, panicked
  [
    /h$|Ync$|[^s]sl$|(?:^|[^aeiouY])ast$|[aeiouY][^aeiouY]*[^hstrwfp]eat$|[aeiouY][^aeiouY]+ick$/,
    null,
  ],
  // changed, ranged, challenged, plunged, created, negotiated, evaluated, persuaded
  [/(?:ch|r)ang$|[eu]ng$|creat$|[iu]at$|uad$/, "e"],
  [/[ao]ng$/, ""], // banged, longed
  [/ng$/, null], // winged/hinged
  // danced, merged, solved, sized, handled; s after n/r/l/p/w or a vowel that spells -se
  // (parsed, used, caused, raised, closed, pleased, accused) but not -us/-as nouns (focused, biased)
  [/[cgvz]$|[^aeiouYrwl]l$|(?:[nrlpwioY]|[ehrbc]a|(?:^|[aeofm]|ab|[xc]c)u)s$/, "e"],
  [/s$/, null],
  // cleaned, failed; clusters that end words: climbed, walked, turned, helped, wanted
  [
    /[aeiouY]{2}[^aeiouY]$|(?:[mrl]b|[nrlw]d|[rl]f|[nrlscw]k|[rl]m|[rgwm]n|[mlsr]p|[nrlscpfxhb]t)$/,
    "",
  ],
  [/[^aeiouY]{2}$/, null], // hotbed, unwed, lightning, hundred
];

// One vowel letter + one consonant in a longer word: stress decides, so only reliable endings.
// ponytail: for words the dictionary lexicon does not know, combated-, skied- and duckling-like
// spellings can still round-trip to a wrong lemma.
const MULTI_STEM_RULES: readonly (readonly [RegExp, Restore])[] = [
  [/(?:adh|coh|interf|persev|rev)er$|[^aeiouY]ven$/, "e"], // closed -ere/-ene sets: adhered, intervened
  [/(?:en|er|[^es]lop|velop)$/, ""], // opened, offered, developed, galloped (not eloped, unsloped)
  // decided, updated, computed, consoled, compiled, declared, required, secured, determined,
  // assumed, escaped, prototyped, described, invoked
  [/(?:[aeiouY]d|at|ut|[ou]l|[pfx]il|[aiu]r|in|un|um|[aY]p|ib|[iou]k)$/, "e"],
];

// Doubling in a longer word (one vowel + one consonant) follows final stress.
const DOUBLE = /(?:[^f]fer|cur|trol|pel|gret|^(?:e|o|re)mit|[^aeiou]mit)$/; // prefer, occur, control, compel, regret, commit
const ABSTAIN = /(?:eter|fit|wit|quit|bet|set)$/; // deter/meter, benefit, acquit, abet, closet
const KEEP = /(?:en|er|op|on|om|or|et|it)$/; // open, offer, develop, abandon, monitor, target, visit

// qu, and gu before a vowel, spell consonants (squat, guide); y after a consonant is a vowel (try, type).
function fold(word: string): string {
  return word
    .replace(/qu/g, "q")
    .replace(/gu(?=[aeiouy])/g, "g")
    .replace(/(?<=[^aeiou])y/g, "Y");
}

function syllables(key: string): number {
  return key.match(/[aeiouY]+/g)?.length ?? 0;
}

const SHORT = /(?:^|[^aeiouY])[aeiouY][^aeiouY]$/;

function apply(rules: readonly (readonly [RegExp, Restore])[], key: string): Restore | undefined {
  return rules.find(([pattern]) => pattern.test(key))?.[1];
}

function withRestore(stem: string, restore: Restore | undefined): string | null {
  return restore === undefined || restore === null ? null : stem + restore;
}

/** The base behind a stem stripped of -ed, -ing or -es. */
function stemLemma(stem: string, form: EnglishInflection): string | null {
  const key = fold(stem);
  if (!/[aeiouY]/.test(key)) return null;
  const last = key.at(-1)!;
  if (last === "u") return `${stem}e`; // argued, queued
  if (last === "Y") return form === "past" ? `${stem}e` : stem; // dyed, trying
  if ("aeio".includes(last)) {
    if (form === "ing") return stem; // seeing, going, skiing
    return /[aeiouY]o$/.test(key) ? stem : null; // booed, radioed; echoed vs toed
  }
  if (stem.length === 2 && SHORT.test(key)) return `${stem}e`; // used, aged, owed, eyed
  if (key.at(-2) === last) {
    if (last === "s" || last === "f") return stem; // missed, stuffed
    if (last === "l") return syllables(key) === 1 ? stem : stem.slice(0, -1); // called, controlled
    if (!"bdgkmnprtv".includes(last)) return null; // buzzed/quizzed
    const base = stem.slice(0, -1);
    return /^[aeiou][bdgr]$/.test(base) ? stem : base; // added, erred vs stopped
  }
  const restore = apply(STEM_RULES, key);
  if (restore !== undefined) return withRestore(stem, restore);
  // One vowel + one consonant: a short single syllable would have doubled, so it had a silent e.
  return syllables(key) === 1 ? `${stem}e` : withRestore(stem, apply(MULTI_STEM_RULES, key));
}

function thirdLemma(word: string): string | null {
  if (word.endsWith("ies")) return word.length === 4 ? word.slice(0, -1) : `${word.slice(0, -3)}y`;
  if (/(?:[sxz]|[cs]h)es$/.test(word)) return stemLemma(word.slice(0, -2), "third");
  return /(?:[aiosu]s|oes)$/.test(word) ? null : word.slice(0, -1);
}

function regularLemma(word: string, form: EnglishInflection): string | null {
  if (form === "third") return word.endsWith("s") && word.length >= 4 ? thirdLemma(word) : null;
  const suffix = form === "past" ? "ed" : "ing";
  if (!word.endsWith(suffix) || word.length < suffix.length + 2) return null;
  const stem = word.slice(0, -suffix.length);
  if (form === "past") {
    if (word.endsWith("eed")) return null; // need, speed, proceed: bases, not agree+d
    if (word.endsWith("ied"))
      return word.length === 4 ? word.slice(0, -1) : `${stem.slice(0, -1)}y`;
  } else {
    // Irregular verbs inflect -ing regularly: singing, writing, running.
    const irregular = [stem, `${stem}e`, stem.slice(0, -1)].find(
      (candidate) => BY_LEMMA.has(candidate) && englishInflect(candidate, "ing") === word,
    );
    if (irregular) return irregular;
    if (/^[^aeiouy]y$/.test(stem)) return `${stem[0]}ie`; // dying, tying
  }
  return stemLemma(stem, form);
}

/**
 * Base form of an English verb form, or null when it is not one or cannot be told. Irregular
 * table first, then the dictionary lexicon (exact: deleted -> delete, such -> null, and two
 * lemmas -> null); spelling rules only for words the lexicon does not know, and a spelled answer
 * must inflect back to `word`. Lowercase result.
 */
export function englishLemma(word: string, form: EnglishInflection): string | null {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w) || NOT_INFLECTED.has(w)) return null;
  if (BE_FORMS[form].includes(w)) return "be";
  const irregular = englishVerbForms(w);
  if (TABLE_FORMS.has(w)) {
    if (!irregular) return null; // lay: a lemma and lie's past
    const slot =
      form === "third"
        ? w === irregular.third
        : form === "past" && (w === irregular.past || w === irregular.participle);
    return slot && !irregular.ambiguous.includes(w) ? irregular.lemma : null;
  }
  const info = englishWordInfo(w);
  const kinds = form === "past" ? ["past", "participle"] : [form];
  const lemmas = [
    ...new Set(info?.verbs.filter((v) => kinds.includes(v.form)).map((v) => v.lemma)),
  ];
  const lemma = regularLemma(w, form);
  if (lemmas.length > 1) {
    // putting: put or putt; the table holds the common verbs, which inflect -ing regularly.
    // passed: pass or passe, which the dictionary spells alike; spelling breaks the tie.
    const common = lemmas.filter((l) => form === "ing" && BY_LEMMA.has(l));
    if (common.length === 1) return common[0];
    if (lemma && lemmas.includes(lemma)) return lemma;
    // attached: attach, not the noun attache that the dictionary also gives verb forms
    // (bathed stays open: bath and bathe are both verbs).
    const plain = lemmas.filter(
      (l) => /ch$/.test(l) && lemmas.includes(`${l}e`) && englishWordInfo(`${l}e`)?.noun,
    );
    return lemmas.length === 2 && plain.length === 1 ? plain[0] : null;
  }
  if (lemmas.length) return lemmas[0];
  // A known word needs a known verb whose form the dictionary omits (undo: undoing).
  const verb = !info || englishWordInfo(lemma ?? "")?.verbs.some((v) => v.form === "base");
  return lemma && verb && englishInflect(lemma, form) === w ? lemma : null;
}

function doubles(lemma: string, key: string): boolean | null {
  if (!SHORT.test(key) || /[hwxy]$/.test(key)) return false;
  // Irregular verbs stress their root: forgetting, beginning, upsetting.
  if (syllables(key) === 1 || BY_LEMMA.has(lemma) || DOUBLE.test(lemma)) return true;
  if (ABSTAIN.test(lemma)) return null;
  return KEEP.test(lemma) ? false : null;
}

function suffixed(lemma: string, key: string, suffix: string): string | null {
  if (/[aeiou]c$/.test(lemma)) return `${lemma}k${suffix}`; // panicked, mimicking
  const double = doubles(lemma, key);
  return double === null ? null : lemma + (double ? lemma.at(-1) : "") + suffix;
}

/**
 * The -s, past (-ed or irregular) or -ing form of a base verb, or null when it is not a verb or
 * cannot be told. The dictionary lexicon answers for words it knows (travel -> traveled, such ->
 * null); spelling rules cover the rest. Lowercase result.
 */
export function englishInflect(lemma: string, form: EnglishInflection): string | null {
  const l = lemma.toLowerCase();
  if (l === "be") return BE_INFLECT[form];
  if (!/^[a-z]*[aeiouy][a-z]*$/.test(l)) return null;
  const irregular = BY_LEMMA.get(l);
  if (irregular && form !== "ing") return irregular[form];
  // Another verb's form (went, made) is not a base; an ambiguous one (found, saw) can be.
  const other = !irregular && englishVerbForms(l);
  if (other && !other.ambiguous.includes(l)) return null;
  const known = englishLexiconInflect(l, form);
  if (known !== undefined) return known;
  const key = fold(l);
  if (form === "third") {
    if (key.endsWith("Y")) return `${l.slice(0, -1)}ies`;
    // quizzes vs gases, echoes vs demos
    if ((syllables(key) === 1 && SHORT.test(key) && /[sz]$/.test(key)) || /[^aeiouY]o$/.test(key))
      return null;
    return /(?:[sxz]|[cs]h)$/.test(l) ? `${l}es` : `${l}s`;
  }
  if (form === "past") {
    if (l.endsWith("e")) return `${l}d`;
    if (key.endsWith("Y")) return `${l.slice(0, -1)}ied`;
    return suffixed(l, key, "ed");
  }
  if (l.endsWith("ie")) return `${l.slice(0, -2)}ying`;
  if (l.endsWith("inge")) return null; // singeing vs hinging
  if (/[eoy]e$/.test(l)) return `${l}ing`; // seeing, hoeing, dyeing
  if (l.endsWith("e")) return `${l.slice(0, -1)}ing`;
  return suffixed(l, key, "ing");
}
