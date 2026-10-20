import type { Detector, Fixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveOf,
  ambiguousAdjective,
  cases,
  finiteVerb,
  listedVerb,
  nounTags,
  NEUTER,
  onlyNoun,
  pastByShape,
  placeForm,
} from "./lexicon";
import { caseLike, findingAt, isPl, owned, sentenceStartAt, userOrNamed } from "./shared";

/*
 * Real-word slips: a dictionary word typed for its look-alike ("szkody średniej" for
 * "szkoły"), a word cut short ("coraz lepie") or a lost or doubled small word. Each frame
 * names the neighbour that only the intended word fits.
 */

const words = (list: string) => list.split(" ");

const RULE = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
} as const;
/** The typed word starts with a capital: a name or a title, not the slip. */
const lower = (fix: string) => (m: RegExpExecArray) =>
  /^\p{Lu}/u.test(m.groups!.target) ? null : fix;

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  // "prze" alone is only the verb "przeć" (push on), which takes no adjective and no "siebie":
  // "prze piękny" -> "przepiękny", "prze siebie" -> "przed siebie", "prze ze mnie" -> "przeze".
  typosPrze: (m) => {
    const word = m.groups!.word;
    if (word !== word.toLowerCase()) return null;
    if (word === "siebie") return ["przed siebie", "przez siebie"];
    if (word === "zemnie") return "przeze mnie";
    const adjective = adjectiveOf(word);
    return adjective && !ambiguousAdjective(word) && adjective.ending !== "ą"
      ? `prze${word}`
      : null;
  },
  // "wzdłuż polnej drużki" -> "dróżki": a path ("dróżka"), not a bridesmaid ("drużka").
  typosDrużk: (m) => `dróżk${m.groups!.end}`,
  // "Skłam serdeczne życzenia" -> "Składam".
  typosSkłamy: (m) => (m.groups!.target.length === 6 ? "składamy" : "składam"),
  // "podlegać ocenie" (dative); "podlać" waters something.
  typosPodleją: (m) => (m.groups!.target.toLowerCase() === "podleją" ? "podlegają" : "podlega"),
  // "coraz lepie", "jeszcze wyże": a comparative adverb that lost its "-j".
  typosLepie: (m) => `${m.groups!.target}j`,
  // "coraz skutecznej." -> "skuteczniej": after "coraz", a clause-final word is an adverb.
  typosP: (m) => `${m.groups!.target.slice(0, -3)}niej`,
  // "Nagroda Główna", "Dworzec Główny": the capital names the institution.
  typosGówn: (m) => (/^G/u.test(m.groups!.target) ? `Główn${m.groups!.target.slice(4)}` : null),
  // "jedna rzecz": lowercase "jena" is no word ("Jena" is a town).
  typosJena: lower("jedna"),
  // "popełnić literówkę": "litrówka" is a litre bottle.
  typosLitrówk: (m) => `literówk${m.groups!.target.slice(7)}`,
  // A nursery is "żłobek" ("żłobka"); the crib in Bethlehem is "żłóbek".
  typosŻłóbk: (m) => `żłobk${m.groups!.target.slice(5)}`,
  typosŻłobk: (m) => `żłóbk${m.groups!.target.slice(5)}`,
  // "przedstawić zarzuty": "przestawić" moves something.
  typosPrzestawi: (m) => `przed${m.groups!.target.slice(4)}`,
  // "To mój prezent dal niego" -> "dla"; "w dal" is "into the distance".
  typosDal: lower("dla"),
  // "różnych": "rożny" is the corner of a pitch ("rzut rożny").
  typosRożn: (m) => `różn${m.groups!.target.slice(4)}`,
  // "stała się gwiazdą": "stałą" is an adjective form, not the past verb.
  typosStał: (m) => `${m.groups!.target.slice(0, -1)}a`,
  // "Ta strona zawiera informacje": "zwierać" clenches.
  typosZwiera: (m) => `zawiera${m.groups!.target.slice(6)}`,
  // "nadstawiać karku": "nastawiać" sets something.
  typosNastawi: (m) => `nad${m.groups!.target.slice(2)}`,
  // "wysoką rangę": the English "range" after a Polish adjective.
  typosRange: lower("rangę"),
  // "pozwala sobie": "pozawalać" knocks things down.
  typosPozawal: (m) => `pozwal${m.groups!.target.slice(7)}`,
  // "startować w wyborach": "stratować" tramples.
  typosStratow: (m) => `start${m.groups!.target.slice(5)}`,
  // "z naprzeciwka", "z przeciwka": the words exist only after "z".
  typosNaprzeciwka: (m) => `z ${m.groups!.target}`,
  // "odgrywać rolę": "ogrywać" beats someone at a game.
  typosOgrywa: (m) => `od${m.groups!.target.slice(1)}`,
  // "w swoim dorobku": "sowim" is an owl's.
  typosSow: (m) => `swo${m.groups!.target.slice(3)}`,
  // "do zrobienia": a verbal noun after "do", not the virile participle.
  typosP2: (m) => (/^\p{Lu}/u.test(m.groups!.target) ? null : `${m.groups!.target}a`),
  // "w lutym 2015": "lity" means solid.
  typosLit: (m) => `lut${m.groups!.target.slice(3)}`,
  // "policyjne statystyki": "statystki" are film extras.
  typosStatystk: (m) => `statystyk${m.groups!.target.slice(8)}`,
  // "inny niż": "jak" compares like things ("nikt inny jak" keeps it).
  typosInn: (m) => m.groups!.target.replace(/jak$/iu, "niż"),
} satisfies Record<string, Fixer>;

const NO_LETTER_AFTER = "(?![\\p{L}\\p{N}_'’-])";
/** A preposition straight before an infinitive or an adverbial participle. */
const PREPOSITION_VERB = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<prep>na|do|od|dla|bez|przez|przy|u|z|ze|w|we|o)[ \\t\\u00a0]{1,8}(?<verb>\\p{Ll}{3,}(?:ać|eć|ić|yć|ąć|uć|ąc))${NO_LETTER_AFTER}`,
  "gu",
);
/** "cale życie": "cale" (inches) before a neuter noun is "całe". */
const INCHES = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<target>cale)[ \\t\\u00a0]{1,8}(?<noun>\\p{L}{3,20})${NO_LETTER_AFTER}`,
  "giu",
);
/** "bać" is always reflexive: a form with no "się" in its clause. */
const AFRAID = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>bał|bała|bało|bały|bałem|bałam|bałeś|bałaś|baliśmy|bałyśmy|boi|boję|boisz|boimy|boicie|bać)${NO_LETTER_AFTER}`,
  "giu",
);
/** "się bał się": one "się" serves the verb. */
const TWO_SIE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])się[ \\t\\u00a0]{1,8}(?<verb>\\p{L}{2,20})(?<gap>[ \\t\\u00a0]{1,8})się${NO_LETTER_AFTER}`,
  "giu",
);
/** Two prepositions in a row ("mieszkam w z Warszawie"): one of them is a slip. */
const TWO_PREPOSITIONS = new RegExp(
  `(?<![\\p{L}\\p{N}_'’/.-])(?<first>[wW]|[dD]o|[zZ]|[nN]a|[oO]d)[ \\t\\u00a0]{1,8}(?<second>na|z|od|do|w)[ \\t\\u00a0]{1,8}(?<next>\\p{L}+)${NO_LETTER_AFTER}`,
  "gu",
);
/** A second preposition that opens a set adverbial phrase ("do w pełni", "z na wpół"). */
const ADVERBIAL = new Set(
  words(
    "w|pełni w|miarę w|ogóle w|sumie w|całości w|zasadzie w|końcu w|dodatku w|praktyce w|razie w|przybliżeniu w|szczególności w|pół " +
      "na|pewno na|razie na|nowo na|przykład na|wpół na|zawsze na|bieżąco na|tyle na|co na|ogół na|pół na|raz na|przemian " +
      "z|grubsza z|daleka z|bliska z|osobna z|powrotem z|góry z|dołu z|przodu z|tyłu z|boku z|rzędu z|zewnątrz z|wewnątrz " +
      "od|razu od|nowa od|dawna od|zaraz od|teraz od|dziś od|zawsze od|czasu od|tyłu od|przodu od|środka " +
      "do|końca do|dziś do|tyłu do|przodu do|góry do|dołu do|środka do|teraz do|zobaczenia do|widzenia do|niedawna",
  ),
);
const NEGATION =
  /(?:^|[^\p{L}])(?:nie\p{L}*|ani|nikt|nic|niczego|nikogo|żaden|żadna|żadne|żadnego|żadnej|nigdy|nigdzie|bez)(?![\p{L}])/iu;
/** "bynajmniej" strengthens a denial; with none in its sentence "przynajmniej" was meant. */
const AT_LEAST = /(?<![\p{L}])bynajmniej(?=[ \t\u00a0]{1,8}\p{L})/giu;
const NOT_A_VERB = new Set(
  words("to nie tak już teraz tu tam i a że by jak gdy co też tylko bardzo trochę wtedy znowu"),
);

function slips(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, fix: string) => {
    const typed = ctx.source.slice(start, end);
    if (userOrNamed(ctx, typed)) return;
    findings.push(findingAt(ctx, start, end, [caseLike(typed, fix)], RULE.ruleId, RULE.messageKey));
  };
  for (const m of owned(ctx, PREPOSITION_VERB)) {
    const { verb } = m.groups!;
    if (nounTags(verb) || /(?:siąc|zając)$/u.test(verb)) continue;
    push(m.index, m.index + m[0].length, verb);
  }
  for (const m of owned(ctx, INCHES)) {
    const tags = nounTags(m.groups!.noun);
    if (!onlyNoun(tags) || !(tags & NEUTER) || !(tags & cases("Ns As"))) continue;
    if (/^\p{Lu}/u.test(m.groups!.target) && !sentenceStartAt(ctx.text, m.index)) continue;
    push(m.index, m.index + 4, "całe");
  }
  for (const m of owned(ctx, AFRAID)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = ctx.text.slice(Math.max(0, start - 48), start);
    const after = ctx.text.slice(end, end + 40);
    const clauseBefore = before.slice(before.search(/[^.!?;:,\n]*$/u));
    const clauseAfter = after.slice(0, (after.search(/[.!?;:,\n]/u) + 1 || after.length + 1) - 1);
    if (/(?:^|[^\p{L}])się(?![\p{L}])/iu.test(`${clauseBefore} ${clauseAfter}`)) continue;
    // "za boją", "o boi": the noun "boja".
    if (/(?:^|[^\p{L}])(?:z|za|przed|nad|pod|między|o|na|przy|po|w|we)[ \t\u00a0]+$/iu.test(before))
      continue;
    push(start, end, `${m.groups!.verb} się`);
  }
  for (const m of owned(ctx, TWO_SIE)) {
    const verb = m.groups!.verb;
    const lowerVerb = verb.toLowerCase();
    if (NOT_A_VERB.has(lowerVerb)) continue;
    if (!finiteVerb(lowerVerb) && !listedVerb(lowerVerb) && !pastByShape(lowerVerb)) continue;
    const start = m.index + m[0].indexOf(verb, 3);
    push(start, m.index + m[0].length, verb);
  }
  for (const m of owned(ctx, TWO_PREPOSITIONS)) {
    const { first, second, next } = m.groups!;
    if (first.toLowerCase() === second || ADVERBIAL.has(`${second}|${next}`)) continue;
    // "w od lat zamkniętym domu": the second preposition opens a phrase inside a noun phrase.
    const tail = m.index + m[0].length;
    const after = /^[ \t\u00a0]+(\p{L}+)/u.exec(ctx.text.slice(tail, tail + 40))?.[1] ?? "";
    const noun = next.toLowerCase();
    if (!(onlyNoun(nounTags(noun)) || placeForm(noun)) || adjectiveOf(after.toLowerCase()))
      continue;
    const end = m.index + m[0].length - next.length;
    const typed = ctx.source.slice(m.index, end).trimEnd();
    if (userOrNamed(ctx, typed)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + typed.length,
        [first, caseLike(first, second)],
        RULE.ruleId,
        RULE.messageKey,
      ),
    );
  }
  for (const m of owned(ctx, AT_LEAST)) {
    const before = ctx.text.slice(Math.max(0, m.index - 160), m.index);
    const after = ctx.text.slice(m.index, m.index + 160);
    const sentence = `${before.slice(before.search(/[^.!?\n]*$/u))}${after.split(/[.!?\n]/u)[0]}`;
    if (NEGATION.test(sentence)) continue;
    push(m.index, m.index + m[0].length, "przynajmniej");
  }
  return findings;
}

export const PREDICATES = {
  typos: (ctx: DetectContext) =>
    isPl(ctx) && (!ctx.rules || ctx.rules.has(RULE.ruleId)) ? slips(ctx) : [],
} satisfies Record<string, Detector>;
