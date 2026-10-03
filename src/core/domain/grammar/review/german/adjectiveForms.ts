import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  germanAdjective,
  germanGender,
  germanInfinitive,
  germanListedNoun,
  germanNounReading,
} from "./germanLexicon";
import { ARTICLES, DEMONSTRATIVES, PREPOSITIONS } from "./nounCasing";
import { salutationEndings } from "./salutations";
import { isGerman, tokensAfter, tokensBefore, VERB_GOVERNORS, wordSet, WORD_GATE } from "./shared";
import { finding } from "../finding";

// An adjective before a noun without its ending: "eine lang Reise" (lange), "ein edel Kraut"
// (edler/edles); or a compound written apart: "in echt Zeit" (Echtzeit). And the strong
// ending after an article that already shows the case: "im mentalem Lexikon" (mentalen).

const NOUN = "\\p{Lu}[\\p{L}\\p{M}]*(?:-[\\p{L}\\p{M}]+)*";
// A degree word may stand between the article and the adjective ("eine sehr schön Frau").
const DEGREE =
  "sehr|ziemlich|recht|ganz|besonders|wirklich|unglaublich|äußerst|echt|so|relativ|extrem";
const BARE = new RegExp(
  `${WORD_GATE}(?<det>\\p{L}+)(?:${SPACE}(?:${DEGREE}))?${SPACE}(?<target>(?<adj>\\p{Ll}+)${SPACE}(?<noun>${NOUN}))${WORD_END}`,
  "gdu",
);
const STRONG_AFTER_ARTICLE = new RegExp(
  `${WORD_GATE}(?<det>${[
    "dem im zum vom beim am einem meinem deinem seinem ihrem unserem eurem diesem jedem keinem",
    "des eines meines deines seines ihres unseres eures dieses jedes keines",
  ]
    .join(" ")
    .split(" ")
    .map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`)
    .join("|")})${SPACE}(?<target>\\p{Ll}+(?:em|es))(?=${SPACE}${NOUN}${WORD_END})`,
  "gdu",
);
// Adjective lemmas that also work as adverbs before a noun phrase ("ein völlig Fremder",
// "die erst Mitte der 1920er erschienene"), and invariable ones.
const ADVERBIAL = wordSet(
  "erst ganz gleich sehr recht fast viel wenig mehr weniger genug eben allein halb besonders " +
    "ziemlich völlig ausgerechnet lila rosa prima super klasse sexy beige orange extra " +
    "genügend maximal minimal hauptsächlich",
);
// Adjectives that often open a compound noun ("Rotwein", "Süßwasser", "Neuwagen"), and
// superlative stems that only stand in one ("Mindestlohn", "Höchstform"): written apart before
// a noun, the compound is offered too. The colour, taste and texture ones and the stems are
// no adverbs either, so they are checked with no article before them ("trinkt rot Wein").
const COMPOUND_FIRST = wordSet(
  "rot blau grün gelb schwarz grau braun bunt süß sauer bitter mager trocken weich hart " +
    "frisch alt neu falsch klein groß hoch tief kurz voll leer fein echt mehrfach doppelt " +
    "universal exklusiv alternativ brachial schwarzweiß best mindest höchst kleinst größt " +
    "national zentral parallel rund warm kalt schwer frei direkt dunkel hell privat fertig " +
    "nackt geheim negativ positiv komplett original gesamt total extrem flüssig fest eigen " +
    "digital fremd passiv aktiv primär spezial normal initiativ pauschal regional",
);
const COMPOUND_ALONE = wordSet(
  "rot blau grün gelb schwarz grau braun bunt süß sauer bitter mager trocken weich " +
    "brachial universal schwarzweiß best mindest höchst kleinst größt digital fremd gesamt " +
    "flüssig passiv initiativ spezial",
);
// Adjectives that are also clause adverbs ("hat das sicher Potenzial").
const CLAUSE_ADVERBS = wordSet(
  "sicher bestimmt wirklich echt total ganz voll komplett extrem direkt einfach gern oft " +
    "selten gleich sofort kaum natürlich klar leicht schwer genau eigentlich ziemlich richtig " +
    "absolut fast wahrscheinlich vielleicht tatsächlich ernsthaft ständig häufig frei",
);
// Determiners and pronouns the adjective filter accepts ("bei ihr Rat", "für ihr Werk").
const PRONOUN_LIKE = /^(?:k?ein|[dms]ein|ihr|unser|euer|dies|jen|jed|welch|manch|solch|all|viel)$/;
// Words the adjective filter accepts that are articles, prepositions or fixed in idioms.
const NOT_ADJECTIVES = wordSet(
  "ein eine einer unter ober laut eigen inner äußer hinter vorder mittler weiß weiss",
);
// Determiner → the ending its adjective takes when the noun is singular.
const ENDINGS: Readonly<Record<string, string>> = {
  der: "e",
  die: "e",
  das: "e",
  den: "en",
  dem: "en",
  des: "en",
  im: "en",
  am: "en",
  zum: "en",
  zur: "en",
  vom: "en",
  beim: "en",
  ins: "e",
  ans: "e",
  aufs: "e",
  fürs: "e",
  ums: "e",
  durchs: "e",
};

/** The determiner's ending for its adjective, two for "ein" (edler / edles), or null. */
function endingAfter(det: string, prior: string, word: string): string[] | null {
  const low = det.toLowerCase();
  // "die blau Augen": a plural noun.
  const plural = /(?:[^i]n|s)$/.test(word);
  if (Object.hasOwn(ENDINGS, low)) {
    if (low === "der" && PREPOSITIONS.has(prior.toLowerCase())) return ["en"];
    if (low === "die" && plural) return ["en"];
    return [ENDINGS[low]];
  }
  const m = /^(ein|kein|mein|dein|sein|ihr|unser|euer|dies|jed|welch)(e|en|em|er|es|)$/.exec(low);
  if (!m || (m[1] === "ihr" && m[2] === "")) return null;
  const [, stem, end] = m;
  const einWord = !["dies", "jed", "welch"].includes(stem);
  if (end === "") return einWord ? ["er", "es"] : null;
  if (end === "e") return plural && stem !== "ein" ? ["en"] : ["e"];
  if (end === "er" || end === "es") {
    if (einWord) return ["en"];
    return PREPOSITIONS.has(prior.toLowerCase()) ? ["en"] : ["e"];
  }
  return ["en"];
}

/** "edel" + "es" → "edles", "teuer" + "e" → "teure", "hoch" + "e" → "hohe", "müde" + "e". */
function inflect(lemma: string, ending: string): string {
  let stem = lemma;
  if (stem === "hoch") stem = "hoh";
  // "edel" → "edle", "teuer" → "teure"; "parallel" keeps its stressed -el.
  else if (/[^aeioul]el$/.test(stem) || /(?:eu|au)er$/.test(stem))
    stem = stem.slice(0, -2) + stem.at(-1);
  if (stem.endsWith("e")) return stem + ending.slice(1);
  return stem + ending;
}

// "Vorstellung" is no dictionary word but a noun of a known gender.
const nounKnown = (word: string) =>
  germanNounReading(word.toLowerCase()) !== null || germanGender(word) !== null;
/** "Fremder", "Kranken": a noun made from an adjective. */
const nominalized = (word: string) => {
  const m = /^(.+?)(?:e|er|en|es|em)$/.exec(word.toLowerCase());
  return !!m && germanAdjective(m[1]);
};

// Strong endings by gender, in the order nominative, accusative, dative, genitive.
const STRONG: Readonly<Record<string, readonly string[]>> = {
  m: ["er", "en", "em", "en"],
  f: ["e", "e", "er", "er"],
  n: ["es", "es", "em", "en"],
  pl: ["e", "e", "en", "er"],
};
// The cases (indexes into STRONG) a preposition governs; two-way ones take two.
const PREPOSITION_CASES = new Map<string, number[]>([
  ...wordSetList("mit von bei aus nach seit samt nebst außer", [2]),
  ...wordSetList("für gegen durch ohne um wider", [1]),
  ...wordSetList("in an auf über unter vor hinter neben zwischen", [1, 2]),
  ...wordSetList("wegen trotz während statt anstatt", [3]),
]);
function wordSetList(words: string, cases: number[]): Array<[string, number[]]> {
  return words.split(" ").map((w) => [w, cases]);
}

/** The strong endings an adjective takes after a preposition before this noun, or null. */
function strongEndings(preposition: string, noun: string): string[] | null {
  const cases = PREPOSITION_CASES.get(preposition);
  const head = noun.split("-").at(-1)!;
  const reading = germanGender(head);
  if (!cases) return null;
  let genders: string[];
  if (reading) {
    genders = reading.gender === "x" ? ["m", "n"] : [reading.gender];
    if (reading.plural) genders.push("pl");
  } else if (
    [head.slice(0, -1), head.slice(0, -2)].some(
      (singular) => /n$/.test(head) && singular.length >= 3 && nounKnown(singular),
    )
  ) {
    // "Anlagen", "Regeln", "Preisen": a plural in -n or -en of a known noun.
    genders = ["pl"];
  } else return null;
  // Only a plural: before a singular the word is as often an adverb ("mit maximal Tempo").
  if (!genders.includes("pl") || genders.length > 1) return null;
  const endings = new Set(cases.flatMap((c) => genders.map((g) => STRONG[g][c])));
  return endings.size <= 2 ? [...endings] : null;
}

/** The strong endings of a compound-opening adjective before a singular after a preposition. */
function compoundSingular(preposition: string, adj: string, noun: string): string[] | null {
  const cases = PREPOSITION_CASES.get(preposition);
  const reading = germanGender(noun.split("-").at(-1)!);
  if (!cases || !reading || reading.plural || !COMPOUND_FIRST.has(adj) || ADVERBIAL.has(adj))
    return null;
  const genders = reading.gender === "x" ? ["m", "n"] : [reading.gender];
  const endings = new Set(cases.flatMap((c) => genders.map((g) => STRONG[g][c])));
  return endings.size <= 2 ? [...endings] : null;
}

function bareAdjectives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BARE)) {
    const { det, adj, noun } = m.groups!;
    const low = det.toLowerCase();
    const isDeterminer =
      (ARTICLES.has(low) ||
        DEMONSTRATIVES.has(low) ||
        /^(?:ein|kein|mein|dein|sein|unser|euer)$/.test(low) ||
        /^(?:k?ein|[dms]ein|ihr|unser|eur|jed)(?:er|es)$/.test(low)) &&
      !(
        det !== low &&
        m.index > 0 &&
        !/[.!?:\n„"]\s*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
      );
    const isPreposition = PREPOSITIONS.has(low) && det === low;
    const [start, end] = m.indices!.groups!.target;
    const glued = adj[0].toUpperCase() + adj.slice(1) + noun.toLowerCase();
    // "Echtzeit", "Weißgold": the joined word is a known noun.
    const joinedNoun = !adj.endsWith("e") && germanNounReading(adj + noun.toLowerCase()) !== null;
    // "Sie trinken lieber rot Wein", "kauft alt Gold": no article, a word that is no adverb.
    if (!(isDeterminer || isPreposition)) {
      const known =
        joinedNoun &&
        germanAdjective(adj) &&
        ![ADVERBIAL, CLAUSE_ADVERBS, NOT_ADJECTIVES, ARTICLES].some((set) => set.has(adj));
      if (
        (COMPOUND_ALONE.has(adj) || known) &&
        // "schwarz sehen", "rot sehen": a colour after the verb.
        !/^(?:seh|sieh|sah)/.test(low) &&
        !noun.includes("-") &&
        /^\p{Ll}/u.test(det) &&
        !ctx.dictionary.has(adj) &&
        !ctx.dictionary.has(noun.toLowerCase())
      ) {
        findings.push(
          finding("germanAdjectiveForms", "review_msg_closed_compound", start, end, [glued], {
            context: { start: m.index, end },
          }),
        );
      }
      continue;
    }
    if (
      !(germanAdjective(adj) || COMPOUND_FIRST.has(adj)) ||
      // "aus weiß Gold": "weiß" (knows) only where it joins the noun.
      (NOT_ADJECTIVES.has(adj) && !(joinedNoun && /^wei(?:ß|ss)$/.test(adj))) ||
      ARTICLES.has(adj)
    )
      continue;
    // "letzte", "erster": already inflected.
    const inflected = /^(.+?)(?:e|en|er|es|em)$/.exec(adj);
    if (inflected && germanAdjective(inflected[1])) continue;
    const after = tokensAfter(ctx.text, m.indices!.groups!.noun[1], 1)[0] ?? "";
    // "im scherzhaft Gedankenstrich-Krieg genannten Diskurs": an extended attribute.
    if (/^\p{Ll}+(?:te|ten|ter|tes|tem|nde|nden|nder|ndes|ndem|ene|enen|ener|enes)$/u.test(after)) {
      continue;
    }
    if (ctx.dictionary.has(adj) || ctx.dictionary.has(noun.toLowerCase())) continue;
    const compound = adj + noun.toLowerCase();
    // "Echtzeit": a bare adjective glued to the noun ("die letzte Bahn" stays).
    // "in best Form", "aus rot Gold": a superlative stem, or a word that is no adverb after a
    // preposition.
    const stemOnly =
      /^(?:best|mindest|höchst|kleinst|größt)$/.test(adj) ||
      (isPreposition && COMPOUND_ALONE.has(adj));
    // A compound the dictionary lists is the fix; one only the n-gram counts show is offered
    // beside the ending ("das klein Kind": "kleine Kind" or "Kleinkind").
    const listedJoin = joinedNoun && germanListedNoun(compound) !== null;
    if ((listedJoin || (stemOnly && !adj.endsWith("e"))) && !noun.includes("-")) {
      findings.push({
        ruleId: "germanAdjectiveForms",
        messageKey: "review_msg_closed_compound",
        range: { start, end },
        alternatives: [adj[0].toUpperCase() + compound.slice(1)],
        context: { start: m.index, end },
      });
      continue;
    }
    if (ADVERBIAL.has(adj) || nominalized(noun) || !nounKnown(noun) || adj.endsWith("e")) continue;
    if (isPreposition) {
      // "in öffentlich Anlagen": the strong ending the preposition's case calls for, before a
      // plural. "für wichtig halten", "um … zu", "die Jahre über": no preposition there.
      if (/^(?:für|um|über|zu|bis|ab)$/.test(low) || PRONOUN_LIKE.test(adj)) continue;
      // "mit voll Ausstattung", "aus hart Pappe": before a singular, an adjective that opens
      // compounds takes its ending or joins the noun.
      const endings = strongEndings(low, noun) ?? compoundSingular(low, adj, noun);
      if (!endings) continue;
      const fixes = endings.map((e) => `${inflect(adj, e)} ${noun}`);
      if ((COMPOUND_FIRST.has(adj) || joinedNoun) && !noun.includes("-")) fixes.push(glued);
      findings.push(
        finding("germanAdjectiveForms", "review_msg_german_adjective_ending", start, end, fixes, {
          context: { start: m.index, end },
          ...(fixes.length > 1 ? { requiresChoice: true as const } : {}),
        }),
      );
      continue;
    }
    const before = tokensBefore(ctx.text, m.index, 2);
    const prior = before.at(-1) ?? "";
    const comma = before.length > 1 ? before[0] : "";
    // "müde", "letzte": the bare form is already the -e form.
    if (adj.endsWith("e")) continue;
    // ", in dem ständig Soldaten …": a relative pronoun.
    if (comma === "," && /^d(?:er|en|em)$/.test(low)) continue;
    // "der allgemein Anklang fand", "Ich meine wirklich Radio": a pronoun, or the verb.
    const sentenceStart = prior === "" || /^[.!?:\n„"]$/.test(prior);
    // "Sie hatte die original Rechnung": after a finite verb the d-word is an article.
    const stem = /^(\p{Ll}{2,}?)e?(?:te|ten|t)$/u.exec(prior)?.[1];
    // "hat das sicher Potenzial": a pronoun subject and an adverb, not an article.
    const pronounRead = /^d(?:er|ie|as)$/.test(low) && CLAUSE_ADVERBS.has(adj);
    const afterVerb =
      !pronounRead &&
      (VERB_GOVERNORS.has(prior) ||
        (!!stem && !/^ge/.test(prior) && germanInfinitive(`${stem}en`)));
    if (
      /^d(?:er|ie|as|en|em)$/.test(low) &&
      !sentenceStart &&
      !afterVerb &&
      !PREPOSITIONS.has(prior.toLowerCase()) &&
      !COMPOUND_ALONE.has(adj)
    ) {
      continue;
    }
    // "macht einem richtig Lust": the pronoun "one", not an article.
    if (/^ein(?:em|er)$/.test(low) && !PREPOSITIONS.has(prior.toLowerCase())) continue;
    if (/^(?:ich|wir|sie|die)$/i.test(prior) && /^(?:meine|meinen|seine)$/.test(low)) continue;
    let endings = endingAfter(det, prior, noun);
    if (!endings) continue;
    // "ein klein Haus" (kleines), "ein nett Mann" (netter): the noun's gender picks one. The
    // bare form is also an old poetic one ("dein schmiegsam Weib"), rare enough to flag.
    const gender = germanGender(noun.split("-").at(-1)!)?.gender;
    if (endings.length > 1 && (gender === "m" || gender === "n")) {
      endings = [gender === "m" ? "er" : "es"];
    }
    // "ein neu Wagen": "neuer Wagen" or "Neuwagen".
    const fixes = endings.map((e) => `${inflect(adj, e)} ${noun}`);
    if ((COMPOUND_FIRST.has(adj) || joinedNoun) && !noun.includes("-")) fixes.push(glued);
    findings.push(
      finding("germanAdjectiveForms", "review_msg_german_adjective_ending", start, end, fixes, {
        context: { start: m.index, end },
        ...(fixes.length > 1 ? { requiresChoice: true as const } : {}),
      }),
    );
  }
  return findings;
}

// A predicative adjective takes no ending: "Er war schnelle." (schnell), "Die sind schlauen."
const COPULA = "ist|sind|war|waren|bin|bist|seid|wird|werden|wurde|wurden|bleibt|blieb|bleiben";
const DEGREE_ADVERBS =
  "sehr|so|ganz|zu|echt|wirklich|ziemlich|richtig|total|nicht|doch|auch|schon|immer|eher|recht|extrem|einfach|leider|wohl";
const PREDICATIVE = new RegExp(
  `${WORD_GATE}(?:${COPULA})(?:${SPACE}(?:${DEGREE_ADVERBS}))*${SPACE}(?<target>\\p{Ll}{3,}?(?:e|en))(?=[ \\t]*[.!?])`,
  "gdu",
);
// "Er ist schnelle als ich" → schneller: an ending before "als" where the comparative belongs.
const BEFORE_ALS = new RegExp(
  `${WORD_GATE}(?<prior>\\p{L}+)${SPACE}(?<target>\\p{Ll}{3,}?e)(?=${SPACE}als${WORD_END})`,
  "gdu",
);
// Inflected words that are no adjective here: quantifiers, ordinals, pronouns.
const NOT_PREDICATIVE = wordSet(
  "viele vielen wenige wenigen alle allen beide beiden einige einigen andere anderen manche " +
    "erste ersten zweite dritte letzte letzten nächste nächsten meine deine seine ihre unsere " +
    "eure keine gleiche gleichen selbe selben " +
    // Lemmas in -e and colloquial invariable ones: "Das war spitze", "Das ist blöde".
    "spitze klasse blöde irre öde feige träge rege trübe bange lose leise müde böse",
);
/** The lemma of an inflected adjective: "große" → groß, "dunkle" → dunkel, "teure" → teuer. */
function lemmaOf(form: string): string | null {
  const stem = form.replace(/(?:e|en)$/, "");
  if (stem === "hoh") return "hoch";
  const candidates = [
    stem,
    stem.replace(/([bcdfgkpt])l$/, "$1el"),
    stem.replace(/([bcdfgkpt])r$/, "$1er"),
    stem.replace(/(eu|au)r$/, "$1er"),
  ];
  return candidates.find((c) => c.length >= 3 && germanAdjective(c)) ?? null;
}

function predicative(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PREDICATIVE)) {
    const typed = m.groups!.target;
    // "müde", "leise", "böse": the lemma itself ends in -e.
    if (NOT_PREDICATIVE.has(typed) || germanAdjective(typed) || ctx.dictionary.has(typed)) continue;
    if (germanNounReading(typed) !== null) continue;
    const lemma = lemmaOf(typed);
    if (!lemma) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("germanAdjectiveForms", "review_msg_german_predicative", start, end, [lemma], {
        context: { start: m.index, end },
      }),
    );
  }
  for (const m of frameMatches(ctx, BEFORE_ALS)) {
    const { prior, target: typed } = m.groups!;
    // "die rote als Ersatz", "sowohl eine kleine als auch": an elided noun or a pair.
    if (/^(?:k?ein|[dms]ein|ihr|unser|eu|dies|jen|jed|welch|d)\p{Ll}*$/iu.test(prior)) continue;
    if (
      /^(?:sowohl|als|wie)$/i.test(prior) ||
      /^als[ \t]+auch/.test(ctx.text.slice(m.index + m[0].length + 1))
    )
      continue;
    if (NOT_PREDICATIVE.has(typed) || germanAdjective(typed) || ctx.dictionary.has(typed)) continue;
    const lemma = lemmaOf(typed);
    // A vowel that may take an umlaut in the comparative ("größer") is left out.
    if (!lemma || /[aou](?![u])/.test(lemma.replace(/[ae]u/g, ""))) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("germanAdjectiveForms", "review_msg_german_predicative", start, end, [`${lemma}er`], {
        context: { start: m.index, end: end + 4 },
      }),
    );
  }
  return findings;
}

function strongAfterArticle(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, STRONG_AFTER_ARTICLE)) {
    const typed = m.groups!.target;
    const det = m.groups!.det.toLowerCase();
    // "-em" after a dative article, "-es" after a genitive one.
    if (typed.endsWith("es") !== det.endsWith("es")) continue;
    const stem = typed.slice(0, -2);
    // "einem einem Haus", "dem diesem": a determiner, not an adjective.
    if (
      /^(?:ein|kein|mein|dein|sein|ihr|unser|eur|dies|jen|jed|welch|manch|solch|all|d)$/.test(stem)
    )
      continue;
    if (
      !germanAdjective(stem) &&
      !germanAdjective(`${stem}e`) &&
      !germanAdjective(stem.replace(/(.)([lr])$/, "$1e$2"))
    ) {
      continue;
    }
    if (ctx.dictionary.has(typed)) continue;
    const end = m.indices!.groups!.target[1];
    findings.push(
      finding("germanAdjectiveForms", "review_msg_german_adjective_ending", end - 2, end, ["en"], {
        context: { start: m.index, end },
      }),
    );
  }
  return findings;
}

// "Beamter" declines like an adjective and has no feminine "die Beamte": "der Beamte", "ein
// Beamter", "den Beamten", "die Beamten" (plural). The determiner sets the ending.
const POSSESSIVE_STEMS = "k?ein|mein|dein|sein|ihr|unser|euer";
const OFFICIAL = new RegExp(
  `${WORD_GATE}(?<det>[Dd](?:er|ie|en|em|es)|[Dd]ies(?:er|e|en|em|es)|[Jj]ede[rnms]|(?:[Kk]?[Ee]in|[Mm]ein|[Dd]ein|[Ss]ein|[Ii]hr|[Uu]nser|[Ee]uer)(?:en|em|es|er)?)(?:${SPACE}\\p{Ll}+(?:e|en|er|es|em))?${SPACE}(?<target>\\p{L}*[Bb]eamte[rn]?)${WORD_END}`,
  "gdu",
);
function officialEndings(det: string): string[] {
  const d = det.toLowerCase();
  if (d === "der" || d === "dieser" || d === "jeder") return ["e", "en"];
  if (new RegExp(`^(?:${POSSESSIVE_STEMS})$`).test(d)) return ["er"];
  return ["en"];
}
function officials(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, OFFICIAL, "target")) {
    const { det, target } = m.groups!;
    // "Beamte", "Beamter", "Beamten": the typed ending after "Beamt".
    const stem = target.replace(/e[rn]?$/, "");
    const endings = officialEndings(det);
    if (endings.includes(target.slice(stem.length)) || ctx.dictionary.has(target.toLowerCase()))
      continue;
    const [start, end] = m.indices!.groups!.target;
    const alternatives = endings.map((e) => stem + e);
    findings.push(
      finding(
        "germanAdjectiveForms",
        "review_msg_german_adjective_ending",
        start,
        end,
        alternatives,
        {
          context: { start: m.index, end },
          ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
        },
      ),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["germanAdjectiveForms"],
    detect: (ctx) =>
      isGerman(ctx)
        ? [
            ...bareAdjectives(ctx),
            ...strongAfterArticle(ctx),
            ...salutationEndings(ctx),
            ...predicative(ctx),
            ...officials(ctx),
          ]
        : [],
  },
];
