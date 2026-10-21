import type { Fixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { caseLike, findingAt, PREPOSITIONS, userOrNamed } from "./shared";
import { adjectiveOf, finiteVerb, nounTags } from "./lexicon";

/*
 * Words Polish spelling writes as one, typed apart. The rows are in grammar/rules/pl.yaml;
 * split forms that also read as a preposition and a noun ("na prawdę" as "for the truth")
 * are guarded frames below.
 */

/** Words written as one that Polish spells apart. */
export const SPLIT_WORDS: Readonly<Record<string, string>> = {
  wgłąb: "w głąb",
  wcelu: "w celu",
  wczasie: "w czasie",
  wtrakcie: "w trakcie",
  wzwiązku: "w związku",
  wogóle: "w ogóle",
  bezprzerwy: "bez przerwy",
  bezwątpienia: "bez wątpienia",
  napewno: "na pewno",
  naprzykład: "na przykład",
  napoczątku: "na początku",
  nakoniec: "na koniec",
  naszczęście: "na szczęście",
  natyle: "na tyle",
  naco: "na co",
  conajmniej: "co najmniej",
  conajwyżej: "co najwyżej",
  codo: "co do",
  dozobaczenia: "do zobaczenia",
  dowidzenia: "do widzenia",
  dziendobry: "dzień dobry",
  pokolei: "po kolei",
  pocichu: "po cichu",
  potrochu: "po trochu",
  przedewszystkim: "przede wszystkim",
  odrazu: "od razu",
  odzawsze: "od zawsze",
  narazie: "na razie",
  poprostu: "po prostu",
  wkońcu: "w końcu",
  // "nie" stays apart from finite verbs.
  niewiesz: "nie wiesz",
  niewie: "nie wie",
  niewiemy: "nie wiemy",
  niewiedzą: "nie wiedzą",
  niemasz: "nie masz",
  niemamy: "nie mamy",
  niemają: "nie mają",
  niemogę: "nie mogę",
  niemożesz: "nie możesz",
  niemoże: "nie może",
  niemożemy: "nie możemy",
  niemogą: "nie mogą",
  niechcę: "nie chcę",
  niechcesz: "nie chcesz",
  niechce: "nie chce",
  niechcemy: "nie chcemy",
  niechcą: "nie chcą",
  nielubię: "nie lubię",
  nielubisz: "nie lubisz",
  nielubi: "nie lubi",
  nielubimy: "nie lubimy",
  nielubią: "nie lubią",
  niejest: "nie jest",
  niesą: "nie są",
  niebył: "nie był",
  niebyła: "nie była",
  niebyło: "nie było",
  niebyli: "nie byli",
  niebędzie: "nie będzie",
  niebędę: "nie będę",
  nieumiem: "nie umiem",
  nieumie: "nie umie",
  nierozumiem: "nie rozumiem",
  nierozumie: "nie rozumie",
  nieznam: "nie znam",
  niezna: "nie zna",
  niewolno: "nie wolno",
  nietrzeba: "nie trzeba",
  niedziała: "nie działa",
  niepamiętam: "nie pamiętam",
  niemusisz: "nie musisz",
  niemuszę: "nie muszę",
  niemusi: "nie musi",
};

const COMPOUND = {
  ruleId: "englishClosedCompounds",
  messageKey: "review_msg_closed_compound",
} as const;

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  conditionalBy,
  personEndings,
  nieJoined,
  // "naj" is no word of its own: "naj lepszy", "naj częściej" -> the superlative.
  compoundsNaj: (m) => `naj${m.groups!.word}`,
  // "po woli dotarcia" (by the will to) and the Warsaw district "Wola" keep the noun.
  compoundsPo: (m) => (/^po\s+Woli$/u.test(m.groups!.target) ? null : "powoli"),
  // A preposition takes no "tam": "na tam to dziecko" is the demonstrative "tamto".
  compoundsTam: (m) => `tam${m.groups!.pron.toLowerCase()}`,
  // "w ogóle" written as one is handled by SPLIT_WORDS; "popołudniu" after no preposition is "po południu".
  compoundsPopołudniu: (m) => (m.groups!.target.startsWith("P") ? null : "po południu"),
  // "na około 300 zł", "w około połowie": "około" is the approximation, not the adverb.
  compoundsPrep: (m) => `${m.groups!.prep.toLowerCase()}około`,
  // "kary godny" (worthy of a penalty) after an adjective keeps the genitive: "najwyższej kary godne".
  compoundsKary: (m) => `karygodn${m.groups!.end.toLowerCase()}`,
  // "za co miesięcznie płacą" is the pronoun "co"; otherwise the adverbs and adjectives are one word.
  compoundsCo: (m) => {
    const end = m.groups!.end.toLowerCase();
    const word = m.groups!.word.toLowerCase();
    // "codziennie" and "cotygodniowo": the adverb ending follows the adjective stem.
    if ((end === "o") !== /ow$/.test(word) && (end === "o" || end === "ie")) return null;
    return `co${word}${end}`;
  },
  // "się do czekać", "od stresować": a verb prefix typed apart (a preposition never takes a
  // verb). Not a noun or a numeral in -ć ("do miłość", "od pięć"), nor "wy" (you).
  compoundsPrefix: (m) => {
    const { prefix, verb } = m.groups!;
    if (
      nounTags(verb) ||
      adjectiveOf(verb) ||
      /(?:ść|ęć)$|^(?:pięć|sześć|siedem|osiem|mać|chęć|płeć|nić|sieć)$/u.test(verb)
    )
      return null;
    const infinitive = /(?:ać|eć|ić|yć|uć|ąć)$/u.test(verb);
    if (!infinitive && !finiteVerb(verb)) return null;
    // "za był", "do jest": a verb that takes no prefix stays apart (and stays wrong).
    if (/^(?:był\p{L}*|jest|są|będ\p{L}*|ma|mam|mieć|może)$/u.test(verb)) return null;
    return `${prefix.toLowerCase()}${verb}`;
  },
  // "eks-mąż", "mini-spódniczka", "quasi-nauka": a prefix joins the word it opens.
  compoundsPrefix2: (m) =>
    /^\p{Ll}/u.test(m.groups!.word) ? `${m.groups!.prefix}${m.groups!.word}` : null,
  // "v-ce prezes" -> "wiceprezes".
  compoundsV: (m) => `wice${m.groups!.word}`,
} satisfies Record<string, Fixer>;

/*
 * The conditional "by" and the personal endings attach to a past-tense verb:
 * "zrobił by" -> "zrobiłby". "by" before an infinitive or a past form is the
 * conjunction ("przyszedł by pomóc"), and after a noun it may stand apart ("Szkoła by zyskała").
 */
// ponytail: hand-listed nouns and adjectives ending like past tenses; a POS lexicon would replace it.
const NOT_PAST = new Set(
  "siła siły skała skały ciało ciała działo działa mogiła mogiły chwała chwały żyła żyły nawała chwili sali fali stali soli roli woli cali dali wali brali pała pały pali śmiały biały mały cały stały dały wały zapał zapały upał upały kanał kanały szał szały bali dział działy materiał materiały ideał ideały rytuał rytuały okazały spały".split(
    " ",
  ),
);
const NOUN_PHRASE_BEFORE = new RegExp(
  `(?:^|[^\\p{L}])(?:${PREPOSITIONS}|tej|tym|tego|ta|to|te|ten|swojej|mojej|jego|jej)[ \\t\\u00a0]+$`,
  "iu",
);
/** An infinitive ("pomóc", "zrobić"), not a noun in -ść or a numeral in -ęć. */
const isInfinitive = (word: string) =>
  (/ć$/u.test(word) &&
    !/(?:ść|ęć|sieć|płeć|nić|mać|śmierć|łokieć|paznokieć|kmieć|śmieć)$/u.test(word)) ||
  /(?:^|[^\p{L}])(?:\p{L}*(?:móc|biec|piec|rzec|strzec|wlec|tłuc|ciec)|jeść|nieść|wieść|kraść|prząść|gnieść|paść|siąść|usiąść)$/u.test(
    word,
  );

const MODAL =
  /^(?:mógł|mogła|mogło|mogli|mogły|chciał|chciała|chciało|chcieli|chciały|musiał|musiała|musiało|musieli|musiały|miał|miała|miało|mieli|miały|umiał|umiała|umieli|potrafił|potrafiła|potrafili|wolał|wolała|woleli|zdołał|zdołała|zdołali|powinien|powinna|powinno|powinni)$/iu;

function conditionalBy(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { verb, by } = m.groups!;
  if (NOT_PAST.has(verb.toLowerCase()) || verb.length < 3) return null;
  const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
  // "w tej chwili by", "na fali by": a noun phrase, not a verb.
  if (NOUN_PHRASE_BEFORE.test(before)) return null;
  // The conjunction: an infinitive or a past form follows within a few words
  // ("przyszedł by go zobaczyć", "chciał bym przyszedł").
  const end = m.index + m[0].length;
  const next = (ctx.text.slice(end, end + 60).match(/\p{L}+/gu) ?? []).slice(0, 4);
  // A person ending ("bym") or a modal ("mógł by zrobić") makes it the conditional.
  if (by.length === 2 && !MODAL.test(verb) && next.some((word) => isInfinitive(word.toLowerCase())))
    return null;
  if (/^\p{L}*(?:ł|ła|ło|li|ły)$/u.test(next[0] ?? "")) return null;
  const typed = m[0];
  if (userOrNamed(ctx, typed)) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + typed.length,
    [caseLike(typed, verb + by.toLowerCase())],
    COMPOUND.ruleId,
    COMPOUND.messageKey,
  );
}

function personEndings(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { word, ending } = m.groups!;
  if (!/(?:li|ły|by|ło|ła)$/iu.test(word)) return null;
  const typed = m[0];
  if (userOrNamed(ctx, typed)) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + typed.length,
    [caseLike(typed, word + ending.toLowerCase())],
    COMPOUND.ruleId,
    COMPOUND.messageKey,
  );
}

/*
 * "nie" is written together with adjectives, adjectival participles, comparatives,
 * adjective-based adverbs and nouns in -ość/-anie (the 2026 rules: "niedobry",
 * "niepalący", "nielepszy", "nietrudno", "niepalenie"). It stays apart in a
 * contrast ("nie dobry, lecz zły"), in a question and after "to" ("To nie zły pomysł").
 */
/** Forms that are verbs, pronouns, ordinals or nouns despite the ending. */
const NIE_APART =
  /(?:zna|^można|stanie|staniu|^inn\p{L}*|^jedyn\p{L}*|^setn\p{L}*|tysięczn\p{L}*|^sam\p{L}*|głow[aeyąę]|mow[aeyąę]|słow[aeoyąę]|budow[aeyąę]|połow[aeyąę]|krow[aeyąę]|^ścian\p{L}*|^zmian\p{L}*|^cen[aeyąę]|^win[aeyąę]|^stron\p{L}*|^scen\p{L}*|^więcej|^mniej|^bardziej)$/iu;

function nieJoined(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { nie, word } = m.groups!;
  if (NIE_APART.test(word) || /^\p{Lu}/u.test(word)) return null;
  const end = m.index + m[0].length;
  const sentenceBefore =
    ctx.text
      .slice(Math.max(0, m.index - 200), m.index)
      .split(/[.!?…\n]/u)
      .at(-1) ?? "";
  const sentenceAfter = ctx.text.slice(end, end + 200).split(/[.!…\n]/u)[0] ?? "";
  // A question, or "to nie …" / "czy nie …": the negation is the sentence's, not the word's.
  if (sentenceAfter.includes("?")) return null;
  if (
    /(?:^|[^\p{L}])(?:to|czy|czyż|że|żeby|gdyby|jakby|by|a|ale|lecz|ani)[ \t ]+$/iu.test(
      sentenceBefore,
    )
  )
    return null;
  // A comparison keeps the contrastive "nie": "nie lepszy od poprzednika".
  if (/^[ \t ]+(?:od|niż)(?!\p{L})/iu.test(sentenceAfter)) return null;
  // A contrast: "nie dobry, lecz zły", "nie tyle X, ile Y".
  if (
    /^[^;:]{0,60}?(?:,[ \t ]*(?:ale|lecz|tylko|a|jednak)|[ \t ]lecz)(?!\p{L})/iu.test(sentenceAfter)
  )
    return null;
  if (userOrNamed(ctx, m[0])) return null;
  return findingAt(
    ctx,
    m.index,
    end,
    [caseLike(nie, "nie") + word.toLowerCase()],
    COMPOUND.ruleId,
    COMPOUND.messageKey,
  );
}
