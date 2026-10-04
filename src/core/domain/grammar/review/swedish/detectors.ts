import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { adjectiveForm, nounGender } from "./lexicon";
import { isLang } from "../phraseTemplates";

type Finding = Omit<RawFinding, "ruleId" | "messageKey"> & { messageKey: RawFinding["messageKey"] };

const GAP = "[ \\t\\u00a0]+";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";

/** Matches of `regex` (flags g, u) starting in the chunk, outside named examples. */
function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = ctx.from;
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (!namedExampleBefore(ctx.text, m.index)) yield m;
  }
}

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

// ------------------------------------------------------------- ordinals

const ORDINAL = /(?<![\p{L}\p{N}.,:/-])(\d{1,4})([ae])(?![\p{L}\p{N}:])/gu;
const ORDINAL_BEFORE = new Set(
  "den det på i för till sin sitt sina min mitt din ditt hans hennes deras dess vår vårt er ert varje kom slutade hamnade".split(
    " ",
  ),
);
const ORDINAL_NOUNS =
  /^[ \t\u00a0]+(?:plats(?:en)?|gången|klass(?:en)?|våning(?:en)?|upplaga(?:n)?|århundradet|kvartalet|omgången|försöket|priset|raden|sidan|stycket|hand|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)(?![\p{L}])/u;

/** "på 2a plats", "den 5e maj": an ordinal written in digits takes a colon (2:a, 5:e). */
function ordinals(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, ORDINAL)) {
    const [, digits, suffix] = m;
    const n = Number(digits);
    const expected = n % 100 !== 11 && n % 100 !== 12 && (n % 10 === 1 || n % 10 === 2) ? "a" : "e";
    if (suffix !== expected) continue;
    const before = wordBefore(ctx.text, m.index);
    const end = m.index + m[0].length;
    if (capitalized(before) && !atSentenceStart(ctx.text, m.index - before.length - 1)) continue;
    if (
      !ORDINAL_BEFORE.has(before.toLowerCase()) &&
      !ORDINAL_NOUNS.test(ctx.text.slice(end, end + 24))
    )
      continue;
    findings.push({
      messageKey: "review_msg_swedish_ordinal_colon",
      range: { start: m.index, end },
      alternatives: [`${digits}:${suffix}`],
      context: { start: m.index, end },
    });
  }
  return findings;
}

// ------------------------------------------------------- acronym genitive

const ACRONYM_S = /(?<![\p{L}\p{N}])(\p{Lu}{2,6})s(?![\p{L}\p{N}:'’])/gu;
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

/** "APIs fördelar": an acronym's genitive -s follows a colon (API:s). */
function acronymGenitive(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, ACRONYM_S)) {
    const end = m.index + m[0].length;
    const next = /^[ \t\u00a0]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 32))?.[1];
    if (!next || NOT_NOUNS.has(next)) continue;
    const before = wordBefore(ctx.text, m.index).toLowerCase();
    if (PLURAL_BEFORE.has(before) || /\d[ \t\u00a0]+$/u.test(ctx.text.slice(m.index - 4, m.index)))
      continue;
    if (ctx.dictionary.has(m[0].toLowerCase())) continue;
    findings.push({
      messageKey: "review_msg_swedish_acronym_genitive",
      range: { start: m.index, end },
      alternatives: [`${m[1]}:s`],
      context: { start: m.index, end: end + 1 + next.length },
    });
  }
  return findings;
}

// --------------------------------------------- weekdays and months in lowercase

const NAMES = new RegExp(
  `(?<!${EDGE})(?:Måndag|Tisdag|Onsdag|Torsdag|Fredag|Lördag|Söndag|Januari|Februari|Mars|April|Maj|Juni|Juli|Augusti|September|Oktober|November|December)(?:en|ens|s|ar|arna|ens)?(?!${EDGE})`,
  "gu",
);
// "Mars" is also the planet and "Maj" a first name: only in a date.
const DATE_ONLY = /^(?:Mars|Maj)$/;
const DATE_BEFORE =
  /(?:\d\.?|(?<!\p{L})(?:i|av|sedan|från|till|under|början|slutet|mitten))[ \t\u00a0]+$/u;

/** "idag är det Måndag": Swedish weekdays and months are common nouns. */
function lowercaseNames(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, NAMES)) {
    const word = m[0];
    if (atSentenceStart(ctx.text, m.index)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (DATE_ONLY.test(word) && !DATE_BEFORE.test(before)) continue;
    // A title or a name around it ("Svarta Fredagen", "Maj Andersson").
    const end = m.index + word.length;
    if (
      /\p{Lu}\p{Ll}*[ \t\u00a0]+$/u.test(before) ||
      /^[ \t\u00a0]+\p{Lu}/u.test(ctx.text.slice(end, end + 3))
    )
      continue;
    if (ctx.dictionary.has(word.toLowerCase())) continue;
    findings.push({
      messageKey: "review_msg_swedish_lowercase_names",
      range: { start: m.index, end: m.index + 1 },
      alternatives: [word[0].toLowerCase()],
      context: { start: m.index, end },
    });
  }
  return findings;
}

// -------------------------------------------------------- mellan … till

const NUMBER = "\\d{1,4}(?:[.:]\\d{2})?|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv";
const DAY_MONTH =
  "måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december";
const END = `(?:${NUMBER}|${DAY_MONTH}|\\p{Lu}\\p{Ll}+)`;
const MELLAN = new RegExp(
  `(?<!${EDGE})(?<mellan>[Mm]ellan)(?<middle>${GAP}(?:(?:klockan|kl\\.|år|åren)${GAP})?${END})${GAP}(?<till>till)(?<rest>${GAP}${END})(?!${EDGE})`,
  "gdu",
);

/** "mellan två till fyra": a range is "mellan … och …" or "från … till …". */
function mellanTill(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, MELLAN)) {
    const { mellan, till } = m.groups!;
    const start = m.index;
    const [tillStart, end] = m.indices!.groups!.till;
    const between = ctx.text.slice(start + mellan.length, tillStart);
    findings.push({
      messageKey: "review_msg_swedish_mellan_till",
      range: { start, end },
      alternatives: [
        mellan + between + (till === till.toUpperCase() ? "OCH" : "och"),
        (mellan[0] === "M" ? "Från" : "från") + between + till,
      ],
      requiresChoice: true,
      context: { start, end: start + m[0].length },
    });
  }
  return findings;
}

// ------------------------------------------------------ en/ett agreement

const ARTICLE_PHRASE = new RegExp(
  `(?<!${EDGE})(?<article>[Ee]tt|[Ee]n|ETT|EN)(?<gap1>${GAP})(?<adjective>\\p{Ll}+)${GAP}(?<noun>\\p{Ll}+)(?!${EDGE}|\\.\\p{L})`,
  "gu",
);

/**
 * "ett mörk kväll", "en urholkat sten": of the article, the adjective's -t form
 * and the noun's gender, the odd one out is fixed when the other two agree.
 * When article and adjective agree against the noun, nothing is said: the noun
 * may have both genders or a gender the dictionary does not know.
 */
function agreement(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  ARTICLE_PHRASE.lastIndex = ctx.from;
  for (
    let m = ARTICLE_PHRASE.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = ARTICLE_PHRASE.exec(ctx.scanText)
  ) {
    const { article, gap1, adjective, noun } = m.groups!;
    // Overlapping phrases: the noun of one may open the next.
    ARTICLE_PHRASE.lastIndex = m.index + article.length;
    const form = adjectiveForm(adjective);
    if (!form || form.form === "both" || adjectiveForm(noun)) continue;
    const gender = nounGender(noun);
    if (!gender) continue;
    const end = m.index + m[0].length;
    // The noun is itself a modifier when a noun or adjective follows it.
    const next = /^[ \t\u00a0]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 40))?.[1];
    if (next && (adjectiveForm(next) || (next.length > 3 && nounGender(next)))) continue;
    if ([adjective, noun].some((word) => ctx.dictionary.has(word))) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    const articleGender = article.toLowerCase() as "en" | "ett";
    const adjectiveGender = form.form === "common" ? "en" : "ett";
    if (articleGender === adjectiveGender) continue;
    const context = { start: m.index, end };
    if (gender === articleGender) {
      const start = m.index + article.length + gap1.length;
      findings.push({
        messageKey: "review_msg_swedish_agreement",
        range: { start, end: start + adjective.length },
        alternatives: [form.other],
        context,
      });
    } else {
      const fixed = gender === "ett" ? "ett" : "en";
      findings.push({
        messageKey: "review_msg_swedish_agreement",
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
    }
  }
  return findings;
}

// ------------------------------------------------------------ de / dem

const CLAUSE_OPENERS = new Set(
  "att och men när om eftersom då så medan innan tills fast fastän ifall därför hur varför var vad sedan".split(
    " ",
  ),
);
const FINITE =
  "är|var|har|hade|blir|blev|kan|kunde|ska|skall|skulle|vill|ville|måste|får|fick|kommer|kom|gör|gjorde|går|gick|säger|sa|sade|tycker|tyckte|vet|visste|brukar|bor|bodde|verkar|borde";
const DEM_SUBJECT = new RegExp(
  `(?<!${EDGE})(?<word>[Dd]em|DEM)${GAP}(?:${FINITE})(?!${EDGE})`,
  "gu",
);
const DE_OBJECT = new RegExp(
  `(?<!${EDGE})(?:med|till|för|av|hos|åt|om|från|på|mot|utan|efter|bredvid|framför|bakom|över|genom|mellan|kring)${GAP}(?<word>de|DE)(?=[ \t\u00a0]*(?:[.,!?;:)]|$))`,
  "giu",
);

/**
 * "dem är här" -> "de är här": the subject form is "de"; "med de." -> "med
 * dem.": after a preposition the object form is "dem". Only where the role is
 * plain: "dem" opening a clause before its verb, "de" ending a clause after a
 * preposition ("med de andra" is the article).
 */
function deDem(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, DEM_SUBJECT)) {
    const word = m.groups!.word;
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    const opener = wordBefore(ctx.text, m.index).toLowerCase();
    if (!atSentenceStart(ctx.text, m.index) && !/,[ \t\u00a0]*$/u.test(before))
      if (!CLAUSE_OPENERS.has(opener)) continue;
    if (ctx.dictionary.has(word.toLowerCase())) continue;
    findings.push({
      messageKey: "review_msg_swedish_de_dem",
      range: { start: m.index, end: m.index + word.length },
      alternatives: [word === "DEM" ? "DE" : word[0] + "e"],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  for (const m of owned(ctx, DE_OBJECT)) {
    const word = m.groups!.word;
    const start = m.index + m[0].length - word.length;
    findings.push({
      messageKey: "review_msg_swedish_de_dem",
      range: { start, end: start + word.length },
      alternatives: [word === "DE" ? "DEM" : "dem"],
      context: { start: m.index, end: start + word.length },
    });
  }
  return findings;
}

// -------------------------------------------------- "en till" + noun

const EN_TILL = new RegExp(
  `(?<!${EDGE})(?<article>[Ee]n|[Ee]tt)(?<gap1>${GAP})(?<till>till)(?<gap2>${GAP})(?<noun>\\p{Ll}{3,})(?=[ \t\u00a0]*(?:[.,!?;:]|$))`,
  "gu",
);
// "gav en till mamma": till is the preposition before a person.
// "gav en till mamma", "en till varje": till is the preposition before a person,
// a pronoun or a quantifier.
const PERSONS = new Set(
  (
    "mamma pappa mormor morfar farmor farfar bror syster kompis vän chef granne kollega lärare barn " +
    "honom henne dem dom oss er mig dig sig varje alla var varandra"
  ).split(" "),
);

/** "en till klubba" -> "en klubba till": "another" puts till after the noun. */
function enTill(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, EN_TILL)) {
    const { article, gap1, noun } = m.groups!;
    if (PERSONS.has(noun) || adjectiveForm(noun)) continue;
    // A noun of the other gender cannot be "another"; one the dictionary lacks may be.
    const gender = nounGender(noun);
    if (gender ? gender !== article.toLowerCase() : !/a$/u.test(noun) || article !== "en") continue;
    if (ctx.dictionary.has(noun)) continue;
    findings.push({
      messageKey: "review_msg_style_phrasing",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${article}${gap1}${noun} till`],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

// ------------------------------------------ comma before a speech verb

const SPEECH = new RegExp(
  `(?<=\\p{L})(?<gap>${GAP})(?<verb>sa|sade|svarade|frågade|ropade|skrek|viskade|utbrast|förklarade|menade|tänkte)${GAP}(?:han|hon|hen|jag|vi|de|du|ni|\\p{Lu}\\p{Ll}+)(?=[.!?])`,
  "gu",
);
const HAS_FINITE = new RegExp(`(?<!${EDGE})(?:${FINITE}|finns|fanns)(?!${EDGE})`, "iu");

/**
 * "Det var finfint sade Johan." -> "finfint, sade Johan": quoted speech is
 * set off from the speech verb that follows it. Only when the words before
 * already hold a finite verb, so they cannot be a fronted object ("Det sa Johan").
 */
function speechComma(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, SPEECH)) {
    const sentence = ctx.text.slice(Math.max(0, m.index - 200), m.index);
    const clause = sentence.slice(sentence.search(/[^.!?:\n]*$/u));
    if (clause.trim().split(/\s+/u).length < 3 || !HAS_FINITE.test(clause)) continue;
    if (/(?<!\p{L})(?:som|vad|vilket|vilken|vilka)(?!\p{L})/iu.test(clause)) continue;
    // A fronted subordinate clause ("När han kom hem frågade hon") is followed by V2.
    if (
      /^[\s"”»'(–-]*(?:när|om|eftersom|innan|medan|sedan|då|fast|fastän|ifall|tills|därför|för att)(?!\p{L})/iu.test(
        clause,
      )
    )
      continue;
    findings.push({
      messageKey: "review_msg_swedish_speech_comma",
      range: { start: m.index, end: m.index + m.groups!.gap.length },
      alternatives: [", "],
      context: { start: m.index - Math.min(clause.length, 24), end: m.index + m[0].length },
    });
  }
  return findings;
}

const as =
  (ruleId: RawFinding["ruleId"], ...detectors: Array<(ctx: DetectContext) => Finding[]>) =>
  (ctx: DetectContext): RawFinding[] =>
    !isLang(ctx, "sv") || (ctx.rules && !ctx.rules.has(ruleId))
      ? []
      : detectors.flatMap((detect) => detect(ctx).map((f) => ({ ruleId, ...f })));

/** Swedish checks appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["swedishTypography"],
    detect: as("swedishTypography", ordinals, acronymGenitive, lowercaseNames),
  },
  { rules: ["swedishAgreement"], detect: as("swedishAgreement", agreement) },
  {
    rules: ["englishPhraseCorrections"],
    detect: as("englishPhraseCorrections", mellanTill, deDem),
  },
  { rules: ["stylePhrasing"], detect: as("stylePhrasing", enTill, speechComma) },
];
