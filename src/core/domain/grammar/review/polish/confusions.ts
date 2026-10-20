import type { Fixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { cases, finiteVerb, inflect, nounTags, onlyNoun } from "./lexicon";
import { caseLike, findingAt, userOrNamed } from "./shared";

/*
 * Real words typed for their look-alike: a missing diacritic ("boje" for "boję"),
 * a near-homograph ("rządny" for "żądny") or a misheard word inside a set phrase.
 * Each frame names a neighbour that only the intended word fits.
 */

const CONFUSION = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
} as const;

/** Bound words used without their preposition: "kupiłem to bezcen" for "za bezcen". */
const BOUND: Record<string, string> = {
  bezcen: "za",
  bezdurno: "za",
  trymiga: "w",
  czambuł: "w",
  dwójnasób: "w",
  trójnasób: "w",
  czwórnasób: "w",
  kilkanasób: "w",
  dyrdy: "w",
  zanadrzu: "w",
  szczętu: "do",
  imentu: "do",
  zabój: "na",
  kretesem: "z",
  pantałyku: "z",
  manowce: "na",
  oścież: "na",
  wznak: "na",
  odczepnego: "na",
  przekór: "na",
  czczo: "na",
  wyrywki: "na",
  chybcika: "na",
  auspicjami: "pod",
  omacku: "po",
  ciemku: "po",
  macoszemu: "po",
  cichutku: "po",
  kryjomu: "po",
  prostu: "po",
  trosze: "po",
  cichu: "po",
  rozpuku: "do",
  cna: "do",
  poprzek: "w",
  pojedynkę: "w",
  międzyczasie: "w",
  ustanku: "bez",
  liku: "bez",
  pardonu: "bez",
  ledwością: "z",
  nienacka: "z",
  wyprzódki: "na",
  poczekaniu: "na",
  wyrost: "na",
  przestrzał: "na",
  bakier: "na",
  opak: "na",
  "łapu-capu": "na",
  niemiara: "co",
  // "mówić po polsku": the language adverbs.
  ...Object.fromEntries(
    "polsku angielsku niemiecku francusku rosyjsku hiszpańsku włosku czesku słowacku ukraińsku chińsku japońsku szwedzku grecku arabsku portugalsku holendersku węgiersku fińsku duńsku norwesku chamsku swojsku góralsku"
      .split(" ")
      .map((word) => [word, "po"]),
  ),
};

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  zeForZe,
  // A clitic pronoun cannot open a sentence: "Mi się wydaje" -> "Mnie", "Go kocham" -> "Jego".
  confusionsMi: (m) =>
    ({ Mi: "Mnie", Mu: "Jemu", Go: "Jego", Cię: "Ciebie" })[m.groups!.target] ?? null,
  // "nic mogę" drops the "nie" every verb after "nic" needs: "nic nie mogę".
  confusionsMogę: (m) => `nie ${m.groups!.target}`,
  // "Ja się tego właśnie boje", "się, proszę pana, nie boje" -> "boję", "boją".
  confusionsBoje: (m) => (m.groups!.target.toLowerCase() === "boje" ? "boję" : "boją"),
  // "moja zona" (a zone) -> "moja żona".
  confusionsZon: (m) => `ż${m.groups!.target.slice(1)}`,
  // Bound words: the preposition is missing; "i angielsku" coordinates with an earlier "po".
  confusionsBezcen: (m) =>
    `${BOUND[m.groups!.target.toLowerCase()]} ${m.groups!.target.toLowerCase()}`,
  confusionsLask: (m) => `łask${m.groups!.end.toLowerCase()}`,
  confusionsŁask: (m) => `lask${m.groups!.end.toLowerCase()}`,
  // "klika" (a clique), "kila" (syphilis): before a counted genitive they are "kilka".
  confusionsKlika: (m) =>
    /[au]$/iu.test(m.groups!.target) && /a$/iu.test(m.groups!.target) ? "kilka" : "kilku",
  // "Rządny" (governing) before a desired thing is "żądny".
  confusionsRządn: (m) => `żądn${m.groups!.end.toLowerCase()}`,
  // "tępo" (bluntly) and "tempo" (pace).
  confusionsTęp: (m) => `temp${m.groups!.end.toLowerCase()}`,
  confusionsTęp2: (m) => `temp${m.groups!.end.toLowerCase()}`,
  // "karze" (punishes) before an infinitive is "każe" (orders).
  confusionsKar: (m) =>
    `ka${{ ze: "że", zesz: "żesz", zę: "żę", zemy: "żemy", zecie: "żecie", żą: "żą" }[m.groups!.end.toLowerCase()]}`,
  // "pokarz" (punish) before a person to show something to (a dative: "pokarzę ci") or a
  // clause ("pokarzę, że") is "pokaż"; "pokarzę cię" (I will punish you) takes an accusative.
  confusionsPokarz: (m) => `pokaż${m.groups!.end.toLowerCase()}`,
  // A noun after "w porównaniu", "wraz" and "zgodnie" needs "z".
  confusionsWord: (m) => {
    const word = m.groups!.word;
    if (/^(?:tym|tą|jest|razem|całą|czasem|zawsze|samą|swą|mą|twą)$/iu.test(word)) return null;
    // "zgodnie twierdzą" (unanimously): a feminine instrumental only after "wraz" or a name.
    if (/ą$/u.test(word) && !/^wraz$/iu.test(m.groups!.head) && !/^\p{Lu}/u.test(word)) return null;
    return `${/^(?:mną|[sśzźż][^aeiouyąęó]|wsz)/iu.test(word) ? "ze" : "z"} ${word}`;
  },
  confusionsStem: (m) => `${m.groups!.stem}ań`,
  // "skłony" (bends) before "do" + a noun of willingness is "skłonny".
  confusionsSkłon: (m) => `skłonn${m.groups!.end.toLowerCase()}`,
  // "Gówna" for "Główna" before an office, prize or role.
  confusionsGówn: (m) => `główn${m.groups!.end.toLowerCase()}`,
  // "sadowy" (of an orchard) for "sądowy" in legal phrases.
  confusionsSadow: (m) => `sądow${m.groups!.end.toLowerCase()}`,
  confusionsSadow2: (m) => `sądow${m.groups!.end.toLowerCase()}`,
  // "lutego" misspelt as "litego" next to a day number.
  confusionsLit: (m) => `lut${m.groups!.end.toLowerCase()}`,
  // "taktować" for "traktować ... jako".
  confusionsTakt: (m) => `trakt${m.groups!.end.toLowerCase()}`,
  // A preposition takes the long pronoun: "do cię" -> "do ciebie", "dla mi" -> "dla mnie",
  // "przeciw mu" -> "przeciwko niemu" ("do mi" is also a pair of notes; "dzięki ci" thanks).
  confusionsCię: (m) => {
    const pronoun = m.groups!.target.toLowerCase();
    const preposition = /(\p{L}+)[ \t ]+$/u.exec(m.input.slice(0, m.index))![1].toLowerCase();
    if (pronoun === "mi" && (preposition === "do" || preposition === "za")) return null;
    return { cię: "ciebie", go: "niego", mi: "mnie" }[pronoun]!;
  },
  confusionsMi2: (m) => ({ mi: "mnie", ci: "tobie", mu: "niemu" })[m.groups!.target.toLowerCase()]!,
  // "zarówno zyski i straty" -> ", jak i" when no "jak" follows in the sentence.
  confusionsWord2: (m) => `${m.groups!.word}, jak i`,
  // "opatrzył w podpis" -> "zaopatrzył w" (supply with); "opatrzyć" takes the instrumental
  // ("opatrzył podpisem"). Not "opatrzono w szpitalu", a place.
  confusionsOpatrz: (m) => {
    const tags = nounTags(m.groups!.noun);
    if (!onlyNoun(tags) || !(tags & cases("As Ap")) || tags & cases("Ls Lp")) return null;
    return `za${m.groups!.target.toLowerCase()}`;
  },
  // "w szeregu przypadkach" -> "w szeregu przypadków": "szereg" (a number of) takes the genitive.
  confusionsP: (m) => {
    const forms = inflect(m.groups!.target, cases("Gp"));
    return onlyNoun(nounTags(m.groups!.target)) && forms.length === 1 ? forms[0] : null;
  },
  // "roku dwutysięcznego drugiego" -> "dwa tysiące drugiego": only the last word is ordinal.
  confusionsDwutysięczn: (m) => `dwa tysiące ${m.groups!.last}`,
  // "Możliwym jest" -> "Możliwe jest": the predicate adjective takes the neuter nominative.
  confusionsStem2: (m) => `${m.groups!.stem}e`,
  // "na początku XX" -> "na początku XX wieku": a century in Roman numerals needs its noun.
  confusionsIvx: (m) => (/^[IVX]+$/u.test(m.groups!.target) ? `${m.groups!.target} wieku` : null),
  // "hyperłącze" -> "hiperłącze": Polish spells the Greek prefix with "i".
  confusionsHyper: (m) => (/^\p{Ll}/u.test(m.groups!.target) ? `hiper${m.groups!.rest}` : null),
  // Abbreviations written with a slash: "d/s" (do spraw) -> "ds.", "w/w" (wyżej wymieniony)
  // -> "ww.", "w/g" (według) -> "wg".
  confusionsWord3: (m) => {
    const word = m.groups!.word.toLowerCase();
    // "wg" takes no dot of its own; a dot after it ends the sentence.
    return word === "w/g" ? `wg${m.groups!.target.slice(3)}` : word === "d/s" ? "ds." : "ww.";
  },
  // "Ile warzy ten monitor?", "warzy 2 kilo" -> "waży" ("warzyć" is to brew).
  confusionsWarzy: (m) => m.groups!.target.replace("rz", "ż"),
  confusionsWarzy2: (m) => m.groups!.target.replace("rz", "ż"),
  // "odbywają się zagranicą" -> "za granicą" after a verb; "z zagranicą", "bliską zagranicą"
  // are the noun.
  confusionsZagranicą: (m) => {
    const verb = m.groups!.verb.toLowerCase();
    return verb === "się" || finiteVerb(verb) ? "za granicą" : null;
  },
  // "naważyli sobie piwa" -> "nawarzyli": one brews ("warzy") the beer of the idiom.
  confusionsNaważ: (m) => m.groups!.target.replace("naważ", "nawarz"),
  confusionsNaważ2: (m) => m.groups!.target.replace("naważ", "nawarz"),
  // "cześć druga", "Cześć IV" -> "część": an ordinal after the noun counts parts too.
  confusionsCześć: (m) =>
    !m.groups!.numeral || /^[IVX]+$/u.test(m.groups!.numeral) ? "część" : null,
} satisfies Record<string, Fixer>;

/*
 * "ze" for "że": the preposition "ze" only stands before "mną" and words opening with
 * two consonants ("ze snu", "ze względu"), or loosely before a number ("ze dwa lata").
 * Before a vowel or a single consonant and a vowel it can only be the conjunction.
 */
const DIGRAPH = /^(?:ch|cz|dz|dź|dż|rz|sz)/iu;
const VOWEL = /^[aąeęioóuy]/iu;
const ZE_NOT_CONJUNCTION = new Set(
  "pięć sześć siedem osiem dziewięć dziesięć sto setkę tysiąc kilka kilkanaście kilkadziesiąt parę pół godzinę tydzień miesiąc rok dzień".split(
    " ",
  ),
);

const NEVER_AFTER_PREPOSITION =
  /^(?:z|ze|w|we|na|do|od|za|po|pod|nad|przed|przez|przy|dla|bez|nie|się|to|trzeba|chc(?:ę|e|esz|emy|ecie|ą|iał\p{L}*|ieli\p{L}*|ieć)|tak|już|jest|są|był|była|było|byli|będzie|źle|dobrze|zawsze|wtedy|teraz|tu|tam|ktoś|coś|ja|ty|on|ona|ono|oni|one|my|wy|mu|mi|go|jej|ich|nic|nikt|wszyscy|wszystko|jeśli|gdy|kiedy|chociaż|jednak)$/iu;

function zeForZe(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const next = m.groups!.next;
  // Names and acronyms ("ze Lwowa", "ze ZUS-u") take the preposition loosely.
  if (/^\p{Lu}/u.test(next) || ZE_NOT_CONJUNCTION.has(next.toLowerCase())) return null;
  // No preposition takes these: "ze z tą", "ze źle", "ze to", nor a noun in a case "ze"
  // does not govern ("ze grupa").
  const tags = nounTags(next.toLowerCase());
  const clash = onlyNoun(tags) && !(tags & cases("Gs Is As Gp Ip Ap"));
  if (!NEVER_AFTER_PREPOSITION.test(next) && !clash) {
    // Sibilant onsets take a nonstandard "ze" preposition more often than a typo.
    if (/^(?:[sśzźż]|rz)/iu.test(next)) return null;
    const rest = next.replace(DIGRAPH, "c");
    if (!VOWEL.test(rest) && !VOWEL.test(rest.slice(1))) return null;
  }
  // "wraz ze", "zgodnie ze": the word before already asks for the preposition.
  const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
  if (
    /(?:^|[^\p{L}])(?:wraz|raz|razem|wspólnie|zgodnie|porównaniu|wspólnego)[ \t\u00a0]+$/iu.test(
      before,
    )
  )
    return null;
  const typed = m.groups!.ze;
  if (userOrNamed(ctx, typed)) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + 2,
    [caseLike(typed, "że")],
    CONFUSION.ruleId,
    CONFUSION.messageKey,
  );
}
