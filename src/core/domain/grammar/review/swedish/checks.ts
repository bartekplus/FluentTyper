import { namedExampleBefore } from "../exampleCues";
import type { FrameRef, MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import { adjectiveForm, nounGender } from "./lexicon";

type Finding = Omit<RawFinding, "ruleId" | "messageKey">;

const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";

/** The finding of `frame`. */
const as = (frame: FrameRef, f: Finding): RawFinding => ({
  ruleId: frame.ruleId,
  messageKey: frame.messageKey,
  ...f,
});

/** The word before `at`, "" after punctuation or at the start. */
const wordBefore = (text: string, at: number) =>
  /(\p{L}[\p{L}\p{N}:]*)[ \t\u00a0]+$/u.exec(text.slice(Math.max(0, at - 32), at))?.[1] ?? "";
function atSentenceStart(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 8), at);
  return (
    /[.!?:…\n][ \t\u00a0"”»'(–-]*$/u.test(before) ||
    (at <= 8 && /^[ \t\u00a0"”»'(–-]*$/u.test(before))
  );
}
const capitalized = (word: string) => /^\p{Lu}\p{Ll}/u.test(word);

// The YAML comments of grammar/rules/sv.yaml explain each frame.

const ORDINAL_BEFORE = new Set(
  "den det på i för till sin sitt sina min mitt din ditt hans hennes deras dess vår vårt er ert varje kom slutade hamnade".split(
    " ",
  ),
);
const ORDINAL_NOUNS =
  /^[ \t ]+(?:plats(?:en)?|gången|klass(?:en)?|våning(?:en)?|upplaga(?:n)?|århundradet|kvartalet|omgången|försöket|priset|raden|sidan|stycket|hand|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)(?![\p{L}])/u;

// After these the -s is a plural ("två PCs"), before these the word ends its phrase.
const PLURAL_BEFORE = new Set(
  "två tre fyra fem sex flera många alla några olika dessa de inga få fler våra era deras".split(
    " ",
  ),
);
const NOT_NOUNS = new Set(
  "för och som i på med till av är var har hade kan ska skulle eller men från att om under efter inte blir blev finns kommer måste vid mot utan så när då där hos än samt".split(
    " ",
  ),
);

// "Mars" is also the planet and "Maj" a first name: only in a date.
const DATE_ONLY = /^(?:Mars|Maj)$/;
const DATE_BEFORE =
  /(?:\d\.?|(?<!\p{L})(?:i|av|sedan|från|till|under|början|slutet|mitten))[ \t ]+$/u;

const CLAUSE_OPENERS = new Set(
  "att och men när om eftersom då så medan innan tills fast fastän ifall därför hur varför var vad sedan".split(
    " ",
  ),
);
const FINITE =
  "är|var|har|hade|blir|blev|kan|kunde|ska|skall|skulle|vill|ville|måste|får|fick|kommer|kom|gör|gjorde|går|gick|säger|sa|sade|tycker|tyckte|vet|visste|brukar|bor|bodde|verkar|borde";

// "gav en till mamma", "en till varje": till is the preposition before a person,
// a pronoun or a quantifier.
const PERSONS = new Set(
  (
    "mamma pappa mormor morfar farmor farfar bror syster kompis vän chef granne kollega lärare barn " +
    "honom henne dem dom oss er mig dig sig varje alla var varandra"
  ).split(" "),
);

const HAS_FINITE = new RegExp(`(?<!${EDGE})(?:${FINITE}|finns|fanns)(?!${EDGE})`, "iu");

/** The named frame fixes of grammar/rules/sv.yaml (`fixer:`). */
export const FIXERS = {
  ordinal: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const [, digits, suffix] = m;
    const n = Number(digits);
    const expected = n % 100 !== 11 && n % 100 !== 12 && (n % 10 === 1 || n % 10 === 2) ? "a" : "e";
    if (suffix !== expected) return null;
    const before = wordBefore(ctx.text, m.index);
    const end = m.index + m[0].length;
    if (capitalized(before) && !atSentenceStart(ctx.text, m.index - before.length - 1)) return null;
    if (
      !ORDINAL_BEFORE.has(before.toLowerCase()) &&
      !ORDINAL_NOUNS.test(ctx.text.slice(end, end + 24))
    )
      return null;
    return as(frame, {
      range: { start: m.index, end },
      alternatives: [`${digits}:${suffix}`],
      context: { start: m.index, end },
    });
  },
  acronymGenitive: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const end = m.index + m[0].length;
    const next = /^[ \t ]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 32))?.[1];
    if (!next || NOT_NOUNS.has(next)) return null;
    const before = wordBefore(ctx.text, m.index).toLowerCase();
    if (PLURAL_BEFORE.has(before) || /\d[ \t ]+$/u.test(ctx.text.slice(m.index - 4, m.index)))
      return null;
    if (ctx.dictionary.has(m[0].toLowerCase())) return null;
    return as(frame, {
      range: { start: m.index, end },
      alternatives: [`${m[1]}:s`],
      context: { start: m.index, end: end + 1 + next.length },
    });
  },
  lowercaseName: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const word = m[0];
    if (atSentenceStart(ctx.text, m.index)) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (DATE_ONLY.test(word) && !DATE_BEFORE.test(before)) return null;
    // A title or a name around it ("Svarta Fredagen", "Maj Andersson").
    const end = m.index + word.length;
    if (
      /\p{Lu}\p{Ll}*[ \t ]+$/u.test(before) ||
      /^[ \t ]+\p{Lu}/u.test(ctx.text.slice(end, end + 3))
    )
      return null;
    if (ctx.dictionary.has(word.toLowerCase())) return null;
    return as(frame, {
      range: { start: m.index, end: m.index + 1 },
      alternatives: [word[0].toLowerCase()],
      context: { start: m.index, end },
    });
  },
  agreement: (m, ctx, frame) => {
    const { target: article, gap1, adjective, gap2, noun } = m.groups!;
    const form = adjectiveForm(adjective);
    if (!form || form.form === "both" || adjectiveForm(noun)) return null;
    const gender = nounGender(noun);
    if (!gender) return null;
    // The match is the article only: the phrase ends after the noun.
    const end =
      m.index + article.length + gap1.length + adjective.length + gap2.length + noun.length;
    // The noun is itself a modifier when a noun or adjective follows it.
    const next = /^[ \t ]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 40))?.[1];
    if (next && (adjectiveForm(next) || (next.length > 3 && nounGender(next)))) return null;
    if ([adjective, noun].some((word) => ctx.dictionary.has(word))) return null;
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const articleGender = article.toLowerCase() as "en" | "ett";
    const adjectiveGender = form.form === "common" ? "en" : "ett";
    if (articleGender === adjectiveGender) return null;
    const context = { start: m.index, end };
    if (gender === articleGender) {
      const start = m.index + article.length + gap1.length;
      return as(frame, {
        range: { start, end: start + adjective.length },
        alternatives: [form.other],
        context,
      });
    }
    const fixed = gender === "ett" ? "ett" : "en";
    return as(frame, {
      range: { start: m.index, end: m.index + article.length },
      alternatives: [
        article === article.toUpperCase() && article.length > 1
          ? fixed.toUpperCase()
          : article[0] === "E"
            ? "E" + fixed.slice(1)
            : fixed,
      ],
      context,
    });
  },
  mellanTill: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const { target: mellan, till } = m.groups!;
    const start = m.index;
    const [tillStart, end] = m.indices!.groups!.till;
    const between = ctx.text.slice(start + mellan.length, tillStart);
    return as(frame, {
      range: { start, end },
      alternatives: [
        mellan + between + (till === till.toUpperCase() ? "OCH" : "och"),
        (mellan[0] === "M" ? "Från" : "från") + between + till,
      ],
      requiresChoice: true,
      context: { start, end: start + m[0].length },
    });
  },
  demSubject: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const word = m.groups!.target;
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    const opener = wordBefore(ctx.text, m.index).toLowerCase();
    if (!atSentenceStart(ctx.text, m.index) && !/,[ \t ]*$/u.test(before))
      if (!CLAUSE_OPENERS.has(opener)) return null;
    if (ctx.dictionary.has(word.toLowerCase())) return null;
    return as(frame, {
      range: { start: m.index, end: m.index + word.length },
      alternatives: [word === "DEM" ? "DE" : word[0] + "e"],
      context: { start: m.index, end: m.index + m[0].length },
    });
  },
  deObject: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const word = m.groups!.target;
    const start = m.index + m[0].length - word.length;
    return as(frame, {
      range: { start, end: start + word.length },
      alternatives: [word === "DE" ? "DEM" : "dem"],
      context: { start: m.index, end: start + word.length },
    });
  },
  enTill: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const { target: article, gap1, noun } = m.groups!;
    if (PERSONS.has(noun) || adjectiveForm(noun)) return null;
    // A noun of the other gender cannot be "another"; one the dictionary lacks may be.
    const gender = nounGender(noun);
    if (gender ? gender !== article.toLowerCase() : !/a$/u.test(noun) || article !== "en")
      return null;
    if (ctx.dictionary.has(noun)) return null;
    return as(frame, {
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${article}${gap1}${noun} till`],
      context: { start: m.index, end: m.index + m[0].length },
    });
  },
  speechComma: (m, ctx, frame) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const sentence = ctx.text.slice(Math.max(0, m.index - 200), m.index);
    const clause = sentence.slice(sentence.search(/[^.!?:\n]*$/u));
    if (clause.trim().split(/\s+/u).length < 3 || !HAS_FINITE.test(clause)) return null;
    if (/(?<!\p{L})(?:som|vad|vilket|vilken|vilka)(?!\p{L})/iu.test(clause)) return null;
    // A fronted subordinate clause ("När han kom hem frågade hon") is followed by V2.
    if (
      /^[\s"”»'(–-]*(?:när|om|eftersom|innan|medan|sedan|då|fast|fastän|ifall|tills|därför|för att)(?!\p{L})/iu.test(
        clause,
      )
    )
      return null;
    return as(frame, {
      range: { start: m.index, end: m.index + m.groups!.target.length },
      alternatives: [", "],
      context: { start: m.index - Math.min(clause.length, 24), end: m.index + m[0].length },
    });
  },
} satisfies Record<string, MatchFixer>;
