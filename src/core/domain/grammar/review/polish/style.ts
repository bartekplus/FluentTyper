import type { Detector, Fixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveForm, adjectiveOf, cases, inflect, nounTags, onlyNoun, VIRILE } from "./lexicon";
import { caseLike, findingAt, isPl, owned, S, userOrNamed } from "./shared";

/*
 * Pleonasms and wordy officialese (optional `stylePhrasing`) that need a guard. The plain
 * rows, and the garbled idioms (`englishPhraseCorrections`), are in grammar/rules/pl.yaml.
 */

/* ----------------------------------------------------------- "dwie lub więcej" */

/** The plural case a numeral puts its noun in, by the numeral's own form. */
const OR_MORE_CASE: Record<string, string> = {
  dwa: "Np",
  dwie: "Np",
  trzy: "Np",
  cztery: "Np",
  dwom: "Dp",
  dwóm: "Dp",
  trzem: "Dp",
  czterem: "Dp",
  dwoma: "Ip",
  trzema: "Ip",
  czterema: "Ip",
  dwóch: "Gp",
  trzech: "Gp",
  czterech: "Gp",
  pięć: "Gp",
  pięciu: "Gp",
};
/** The adjective ending of a non-virile plural in each case. */
const PLURAL_ENDING: Record<string, string> = {
  Np: "e",
  Gp: "ych",
  Dp: "ym",
  Ip: "ymi",
  Lp: "ych",
};
const OR_MORE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<numeral>${Object.keys(OR_MORE_CASE).join("|")})[ \\t\\u00a0]{1,8}lub[ \\t\\u00a0]{1,8}więcej(?<words>(?:[ \\t\\u00a0]{1,8}\\p{L}+){0,3})(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);

/**
 * "dwie lub więcej godzin" mixes two governments: "co najmniej dwie godziny". The noun (and its
 * adjectives) follow the numeral's case; when they cannot be read, only the numeral is fixed.
 */
function orMore(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, OR_MORE)) {
    const numeral = m.groups!.numeral;
    const lower = numeral.toLowerCase();
    let wanted = OR_MORE_CASE[lower];
    // "w dwóch lub więcej krajów": the locative after "w", "o", "na", "przy", "po".
    if (
      wanted === "Gp" &&
      /(?:^|[^\p{L}])(?:w|we|o|na|przy|po)[ \t\u00a0]+$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 8), m.index),
      )
    )
      wanted = "Lp";
    const words = m.groups!.words;
    const wordsStart = m.index + m[0].length - words.length;
    const head = `co najmniej ${numeral}`;
    let fixed = head;
    let end = wordsStart;
    const tokens = [...words.matchAll(/\p{L}+/gu)];
    const plural = (adj: string) => adjectiveForm(adjectiveOf(adj)!.lemma, PLURAL_ENDING[wanted]);
    // Genitive plural adjectives: "wieczornych godzin", "godzin wieczornych".
    const adjectiveAt = (i: number) =>
      i < tokens.length && !nounTags(tokens[i][0]) && adjectiveOf(tokens[i][0])?.ending === "ych";
    let at = 0;
    while (adjectiveAt(at)) at++;
    const noun = tokens[at]?.[0] ?? "";
    const tags = nounTags(noun);
    if (onlyNoun(tags) && tags & cases("Gp") && !(wanted === "Np" && tags & VIRILE)) {
      const forms = tags & cases(wanted) ? [noun] : inflect(noun, cases(wanted));
      let last = at;
      while (adjectiveAt(last + 1)) last++;
      // An unknown "-ych" word after the phrase may be one more adjective: leave the noun alone.
      const unread = /(?:ych|ich)$/u.test(tokens[last + 1]?.[0] ?? "") && !adjectiveAt(last + 1);
      if (forms.length === 1 && !unread) {
        const before = tokens.slice(0, at).map((t) => plural(t[0]));
        const after = tokens.slice(at + 1, last + 1).map((t) => plural(t[0]));
        fixed = [head, ...before, forms[0], ...after].join(" ");
        end = wordsStart + tokens[last].index + tokens[last][0].length;
      }
    }
    const typed = ctx.source.slice(m.index, end);
    if (userOrNamed(ctx, typed)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        end,
        [caseLike(typed, fixed)],
        "stylePhrasing",
        "review_msg_style_phrasing",
      ),
    );
  }
  return findings;
}

export const PREDICATES = {
  style: (ctx: DetectContext) =>
    isPl(ctx) && (!ctx.rules || ctx.rules.has("stylePhrasing"))
      ? [...orMore(ctx), ...verbChoices(ctx)]
      : [],
} satisfies Record<string, Detector>;

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  // "rozumieć pod tym" is a calque: "rozumieć przez to".
  stylePod: (m) => {
    const noun = /\p{L}+$/u.exec(m.groups!.target)![0].toLowerCase();
    const object: Record<string, string> = {
      pojęciem: "pojęcie",
      terminem: "termin",
      słowem: "słowo",
      określeniem: "określenie",
      hasłem: "hasło",
    };
    return noun === "tym" ? "przez to" : `przez to ${object[noun]}`;
  },
  // One clicks a link, not "on" it: "kliknij link".
  styleKliknij: (m) => m.groups!.target.replace(/[ \t ]+na$/iu, ""),
} satisfies Record<string, Fixer>;

/* ------------------------------------------------- "pełnić rolę", "posiadać brodę" */

/** "pełnić" goes with a function; a role is played ("odgrywać rolę"). */
const PLAYS: Record<string, string> = {
  pełni: "odgrywa",
  pełnią: "odgrywają",
  pełnił: "odgrywał",
  pełniła: "odgrywała",
  pełniło: "odgrywało",
  pełnili: "odgrywali",
  pełniły: "odgrywały",
  pełnić: "odgrywać",
  pełniący: "odgrywający",
  pełniąca: "odgrywająca",
  pełniące: "odgrywające",
  pełniąc: "odgrywając",
  spełnia: "odgrywa",
  spełniają: "odgrywają",
  spełniał: "odgrywał",
  spełniała: "odgrywała",
  spełniać: "odgrywać",
  spełniając: "odgrywając",
};
/** "posiadać" is owning; a beard, a talent or a sister one simply has ("ma brodę"). */
const HAS: Record<string, string> = {
  posiadam: "mam",
  posiadasz: "masz",
  posiada: "ma",
  posiadamy: "mamy",
  posiadacie: "macie",
  posiadają: "mają",
  posiadał: "miał",
  posiadała: "miała",
  posiadali: "mieli",
  posiadały: "miały",
  posiadać: "mieć",
  posiadając: "mając",
};
/** "ubrać" dresses someone; a garment one puts on ("włożyć płaszcz"). */
const PUTS_ON: Record<string, string> = {
  ubrać: "włożyć",
  ubrał: "włożył",
  ubrała: "włożyła",
  ubrali: "włożyli",
  ubrały: "włożyły",
  ubrałem: "włożyłem",
  ubrałam: "włożyłam",
  ubiorę: "włożę",
  ubierze: "włoży",
  ubierz: "włóż",
  ubieram: "wkładam",
  ubiera: "wkłada",
  ubierają: "wkładają",
  ubierał: "wkładał",
  ubierała: "wkładała",
  ubierać: "wkładać",
  // "założyć" fastens (glasses, a watch); clothes one puts on ("włożyć buty").
  ...Object.fromEntries(
    [..."yć ył yła yli yły yłem yłam yłeś yłaś yliśmy yłyśmy ę y ysz ymy ycie ą".split(" ")].map(
      (ending) => [`założ${ending}`, `włoż${ending}`],
    ),
  ),
  ...Object.fromEntries(
    ["", ..."ć ł ła li ły m sz ją my cie".split(" ")].map((e) => [`zakłada${e}`, `wkłada${e}`]),
  ),
  załóż: "włóż",
  załóżcie: "włóżcie",
};
const GARMENTS =
  "płaszcz|kurtkę|sweter|golf|koszulę|bluzkę|sukienkę|spodnie|dżinsy|buty|kozaki|czapkę|kapelusz|rękawiczki|szalik|garnitur|marynarkę|spódnicę|skarpetki|piżamę|kamizelkę|koszulkę|płaszczyk|kurtkę|kalosze";
const FEATURES =
  "brodę|wąsy|oczy|włosy|nos|uszy|zęby|wymiary|wzrost|talent|zdolności|poczucie|cierpliwość|odwagę|charakter|temperament|rodzinę|dzieci|rodzeństwo|siostrę|brata|braci|siostry|córkę|syna|przyjaciół|czas|ochotę|pomysł|pomysły|nadzieję|wątpliwości|problem|problemy|wadę|wady|zalety|kota|psa";
/** Words that may stand between the verb and its noun: a pronoun, an adverb, adjectives. */
const FILLER = `(?:${S}(?:on|ona|ono|oni|one|nadal|wciąż|też|także|również|zawsze|często|naprawdę|bardzo|niezwykle|wyjątkowo|szczególnie|dość|coraz|swoją|swój|swoje|jakąś|żadnej|(?:w|we|na|dla|przy|wśród|u)${S}\\p{L}+|\\p{L}+(?:ną|ową|ską|cką|ką|ą|ej|e|y|ie))){0,3}`;
const ROLE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?:(?<verb>${Object.keys(PLAYS).join("|")})(?<mid>${FILLER})${S}(?<noun>rolę|roli)|(?<before>rolę|roli)${S}(?<after>${Object.keys(PLAYS).join("|")}))(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);
const PUT_ON = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>${Object.keys(PUTS_ON).join("|")})(?<mid>${FILLER})${S}(?<noun>${GARMENTS})(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);
const MEETS = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>napot(?:kać|kał\\p{L}*|kali\\p{L}*|ka|kają|kasz|kam|ykać|yka|ykają|ykał\\p{L}*|ykali\\p{L}*))${S}na(?<rest>(?:${S}\\p{L}+(?:e|ie|y|i|ą))?${S}(?:trudności|trudność|problem|problemy|przeszkody|przeszkodę|opór|sprzeciw|kłopoty))(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);
const YEARS_ANNIVERSARY = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<target>(?:\\d+-|\\p{L}+)letni(?:a|ej|ą|ego|emu|m|e|ch|mi)?)${S}(?:rocznic|jubileusz|urodzin)\\p{L}*(?![\\p{L}\\p{N}_'’-])`,
  "giud",
);
const POSSESS = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>${Object.keys(HAS).join("|")})(?<mid>${FILLER})${S}(?<noun>${FEATURES})(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);

/** Opt-in: "pełni istotną rolę" -> "pełni istotną funkcję" or "odgrywa istotną rolę"; "posiada brodę" -> "ma brodę". */
function verbChoices(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, fixes: string[]) => {
    const typed = ctx.source.slice(start, end);
    if (userOrNamed(ctx, typed)) return;
    findings.push(
      findingAt(
        ctx,
        start,
        end,
        fixes.map((fix) => caseLike(typed, fix)),
        "stylePhrasing",
        "review_msg_style_phrasing",
      ),
    );
  };
  for (const m of owned(ctx, ROLE)) {
    const { verb, mid, noun, before, after } = m.groups!;
    const end = m.index + m[0].length;
    if (verb) {
      const fn = noun.toLowerCase() === "rolę" ? "funkcję" : "funkcji";
      const plays = PLAYS[verb.toLowerCase()];
      push(m.index, end, [`${verb}${mid} ${fn}`, `${plays}${mid} ${noun}`]);
    } else {
      const fn = before.toLowerCase() === "rolę" ? "funkcję" : "funkcji";
      push(m.index, end, [`${fn} ${after}`, `${before} ${PLAYS[after.toLowerCase()]}`]);
    }
  }
  for (const m of owned(ctx, PUT_ON)) {
    const { verb, mid, noun } = m.groups!;
    push(m.index, m.index + m[0].length, [`${PUTS_ON[verb.toLowerCase()]}${mid} ${noun}`]);
  }
  // "napotkać na trudności": one meets difficulties without "na" ("na drodze" stays).
  for (const m of owned(ctx, MEETS)) {
    const { verb, rest } = m.groups!;
    push(m.index, m.index + m[0].length, [`${verb}${rest}`]);
  }
  // "pięcioletnia rocznica", "20-letni jubileusz": the noun counts years already ("piąta rocznica").
  for (const m of owned(ctx, YEARS_ANNIVERSARY)) {
    const [start, end] = m.indices!.groups!.target;
    push(start, end, []);
  }
  for (const m of owned(ctx, POSSESS)) {
    const { verb, mid, noun } = m.groups!;
    push(m.index, m.index + m[0].length, [`${HAS[verb.toLowerCase()]}${mid} ${noun}`]);
  }
  return findings;
}
