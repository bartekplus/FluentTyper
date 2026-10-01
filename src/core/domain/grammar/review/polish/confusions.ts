import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  caseLike,
  CLAUSE_START,
  findingAt,
  type Frame,
  isPl,
  owned,
  PREPOSITIONS,
  runFrames,
  S,
  userOrNamed,
} from "./shared";

/*
 * Real words typed for their look-alike: a missing diacritic ("boje" for "boję"),
 * a near-homograph ("rządny" for "żądny") or a misheard word inside a set phrase.
 * Each frame names a neighbour that only the intended word fits.
 */

/** "dam radę": every common form of "dać radę" with the nominative "rade". */
const DAC_RADE = [
  ..."dam dasz da damy dacie dadzą dać dał dała dało dali dały dałem dałam dałeś dałaś daliśmy dałyśmy".split(
    " ",
  ),
  ..."daję dajesz daje dajemy dajecie dają dawać dawał dawała dawali".split(" "),
];

export const WORDS: readonly PhraseRow[] = [
  ["instruktarz", "instruktaż"],
  ["instruktarzu", "instruktażu"],
  ["palcówka", "placówka"],
  ["palcówki", "placówki"],
  ["palcówce", "placówce"],
  ["jago", "jego"],
  ["pastwo", "państwo"],
];

export const PHRASES: readonly PhraseRow[] = [
  ...DAC_RADE.map((verb): PhraseRow => [`${verb} rade`, `${verb} radę`]),
  ["chcę mi się", "chce mi się"],
  ["nie chcę mi się", "nie chce mi się"],
  ["zdaję się, że", "zdaje się, że"],
  ["wydaję się, że", "wydaje się, że"],
  ["wydaję mi się", "wydaje mi się"],
  ["zdaję mi się", "zdaje mi się"],
  ["nie boje się", "nie boję się"],
  ["ja się boje", "ja się boję"],
  ["nie boja się", "nie boją się"],
  ["oni się boja", "oni się boją"],
  ["mnie lub bardziej", "mniej lub bardziej"],
  ["ni mnie, ni więcej", "ni mniej, ni więcej"],
  ["nie mnie niż", "nie mniej niż"],
  ["a wiec", "a więc"],
  ["nic wiec", "nic więc"],
  ["czy tez", "czy też"],
  ["jak tez", "jak też"],
  ["ja tez", "ja też"],
  ["mnie tez", "mnie też"],
  ["zobacz tez", "zobacz też"],
  ["a nóż się", "a nuż się"],
  ["a nóż widelec", "a nuż widelec"],
  ["szlak by to trafił", "szlag by to trafił"],
  ["niech to szlak", "niech to szlag"],
  ["szlak mnie trafi", "szlag mnie trafi"],
  ["szlak mnie trafia", "szlag mnie trafia"],
  ["trafi mnie szlak", "trafi mnie szlag"],
  ["trafia mnie szlak", "trafia mnie szlag"],
  ["trafił mnie szlak", "trafił mnie szlag"],
  ["tuz tuz", "tuż, tuż"],
  ["tuz, tuz", "tuż, tuż"],
  ["tuż tuz", "tuż, tuż"],
  ["tuż, tuz", "tuż, tuż"],
  ["tuz tuż", "tuż, tuż"],
  ["tuz, tuż", "tuż, tuż"],
  ["rzec w tym", "rzecz w tym"],
  ["nie kłuć się", "nie kłóć się"],
  ["nie pomorze", "nie pomoże"],
  ["nie morze być", "nie może być"],
  ["morze być", "może być"],
  ["Pomoże Gdańskie", "Pomorze Gdańskie"],
  ["Pomoże Zachodnie", "Pomorze Zachodnie"],
  ["Pomoże Środkowe", "Pomorze Środkowe"],
  ["chart ducha", "hart ducha"],
  ["chartu ducha", "hartu ducha"],
  ["chartem ducha", "hartem ducha"],
  ["charcie ducha", "harcie ducha"],
  ["pod kontem", "pod kątem"],
  ["pod katem", "pod kątem"],
  ["jak magnez", "jak magnes"],
  ["równe tratowanie", "równe traktowanie"],
  ["równego tratowania", "równego traktowania"],
  ["nauk prawych", "nauk prawnych"],
  ["padł deszcz", "padał deszcz"],
  ["deszcz padł", "deszcz padał"],
  ["w ty samym", "w tym samym"],
  ["działało się to", "działo się to"],
  ["w porównania do", "w porównaniu do"],
  ["w porównania z", "w porównaniu z"],
  ["w odróżnieniu do", "w odróżnieniu od"],
  ["w przeciwieństwie od", "w przeciwieństwie do"],
  ["w przepadku", "w przypadku"],
  ["co się stały", "co się stało"],
  ["ogólnie rzecz biorą", "ogólnie rzecz biorąc"],
  ["jako widać", "jak widać"],
  ["po uwagę", "pod uwagę"],
  ["staje benzynowe", "stacje benzynowe"],
  ["staji benzynowej", "stacji benzynowej"],
  ["wzrost gospodarzy", "wzrost gospodarczy"],
  ["wzrostu gospodarzego", "wzrostu gospodarczego"],
  ["z co za tym idzie", "a co za tym idzie"],
  ["a co z tym idzie", "a co za tym idzie"],
  ["nie nogą", "nie mogą"],
  ["rzucie gumy", "żucie gumy"],
  ["tum razem", "tym razem"],
  ["w tum", "w tym"],
  ["twierdza, że", "twierdzą, że"],
  ["twierdza że", "twierdzą że"],
  ["kupki smakowe", "kubki smakowe"],
  ["kupek smakowych", "kubków smakowych"],
  ["kupkach smakowych", "kubkach smakowych"],
  ["kupkom smakowym", "kubkom smakowym"],
  ["kupkami smakowymi", "kubkami smakowymi"],
];

const CONFUSION = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
} as const;

const PRONOUN_OBJECT = "mi|ci|mu|jej|nam|wam|im|go|ją|je|ich|nas|was|mnie|cię|ciebie";
const NOT_LETTER = "(?![\\p{L}])";

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
  // "mówić po polsku": the language adverbs.
  ...Object.fromEntries(
    "polsku angielsku niemiecku francusku rosyjsku hiszpańsku włosku czesku słowacku ukraińsku chińsku japońsku szwedzku grecku arabsku portugalsku holendersku węgiersku fińsku duńsku norwesku chamsku swojsku góralsku"
      .split(" ")
      .map((word) => [word, "po"]),
  ),
};
const BOUND_WORDS = Object.keys(BOUND).join("|");

export const FRAMES: readonly Frame[] = [
  // Bound words: the preposition is missing; "i angielsku" coordinates with an earlier "po".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:${PREPOSITIONS}|i|oraz|lub|albo|czy|a|ani|bądź|ze|od|aż)${S})(?<!,${S}|,)(?<target>(?:${BOUND_WORDS}))${NOT_LETTER}`,
    fix: (m) => `${BOUND[m.groups!.target.toLowerCase()]} ${m.groups!.target.toLowerCase()}`,
    ...CONFUSION,
    lowercase: true,
  },
  // "Zgłupiałeś ze szczętem" is the other bound phrase with "szczętem".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:ze|z)${S})(?<target>szczętem)${NOT_LETTER}`,
    fix: "ze szczętem",
    ...CONFUSION,
  },
  // "za młodu" / "od młodu".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:za|od|z)${S})(?<target>młodu)${NOT_LETTER}`,
    fix: "za młodu",
    ...CONFUSION,
  },
  // "boje" (battles) before "się" after a pronoun or "nie" is "boję".
  {
    pattern: `${CLAUSE_START}(?<target>boje)(?=${S}się(?![\\p{L}])(?!${S}(?:toczy\\p{L}*|toczą|rozpoczęły|zaczęły|skończyły|trwały|odbywały)))`,
    fix: "boję",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:dzisiaj|dziś|bardzo|trochę|strasznie|naprawdę|zawsze|wciąż|nadal|czasem|już|też|tak|i|a|ale|że|bo)${S})(?<target>boje)(?=${S}się${NOT_LETTER})`,
    fix: "boję",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:ja|nie|bardzo|trochę|już|tego|ciebie|go|jej|ich|was|nas)${S}się${S})(?<target>boje)(?=[ \\t\\u00a0]*[.!?,;:…]|${S}(?:o|że|tego|ciebie|go|jej|ich|was|nas|się)${NOT_LETTER})`,
    fix: "boję",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:oni|one|ludzie|wszyscy|dzieci|nie)${S}(?:się${S})?)(?<target>boja)(?=${S}się${NOT_LETTER}|[ \\t\\u00a0]*[.!?,;:…])`,
    fix: "boją",
    ...CONFUSION,
  },
  // "wiec" (a rally) after a comma or "a" opening a clause is "więc".
  {
    pattern: `(?<=,${S}|(?:^|[^\\p{L}])(?:no|tak|i|jest|było)${S})(?<target>wiec)(?!${S}(?:poparcia|wyborczy|protestacyjny|protestu|przeciwko|się${S}odbył|odbył)${NOT_LETTER})${NOT_LETTER}`,
    fix: "więc",
    ...CONFUSION,
    lowercase: true,
  },
  // "tez" (theses) after a pronoun, "czy" or "jak" is "też".
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:ty|on|ona|ono|my|wy|oni|one|ciebie|jego|ją|nas|was|ich|to|tu|tam|teraz|dziś|dzisiaj|był|była|było|miał|miała|jest|są|i|ale|lecz|ponadto)${S})(?<target>tez)${NOT_LETTER}(?!${S}(?:programow\\p{L}*|\\p{L}+ych)${NOT_LETTER})`,
    fix: "też",
    ...CONFUSION,
  },
  // "mnie" for "mniej" before a comparison: "40% mnie niż", "trochę mnie".
  {
    pattern: `(?<=(?:\\d%?|procent|proc\\.|trochę|dużo|znacznie|nieco|jeszcze|coraz|o wiele|nie)${S})(?<target>mnie)(?=${S}(?:niż|więcej|o|od)${NOT_LETTER})`,
    fix: "mniej",
    ...CONFUSION,
  },
  // "mniej" for "mnie" after a preposition, before what no comparative can modify.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:u|dla|do|od|przy|beze|ode|przeze|przede|o|ze|na)${S})(?<target>mniej)(?=[ \\t\\u00a0]*[.!?]|${S}(?:w|na|do|z|ze|się|nie|jest|są|był|była|było|to|żadna|żaden|żadne|nic|tylko|też)${NOT_LETTER})`,
    fix: "mnie",
    ...CONFUSION,
  },
  // "część" (part) and "cześć" (honour, hello).
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:pierwsz|drug|trzeci|czwart|piąt|ostatni|kolejn|następn|dalsz|większ|mniejsz|spor|duż|znaczn|niewielk|integraln|główn|zasadnicz|dolni|górn|przedni|tyln|środkow|północn|południow|wschodni|zachodni|każd|tę|ta)(?:a|ą)?${S})(?<target>cześć)${NOT_LETTER}`,
    fix: "część",
    ...CONFUSION,
  },
  {
    pattern: `(?<target>cześć)(?=${S}z${S}(?:nich|nas|was|tych|nami|wami|nimi)${NOT_LETTER})`,
    fix: "część",
    ...CONFUSION,
  },
  { pattern: `(?<target>część)(?=${S}i${S}chwała${NOT_LETTER})`, fix: "cześć", ...CONFUSION },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:boż|bożą|bożej|Boż)a?${S})(?<target>lask(?<end>a|ę|i))${NOT_LETTER}`,
    fix: (m) => `łask${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  {
    pattern: `(?<target>łask(?<end>a|i|ę|ą))(?=${S}marszałkowsk\\p{L}*${NOT_LETTER})`,
    fix: (m) => `lask${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "znajduję się" (I am) with a subject after it is the third person.
  {
    pattern: `(?<=(?:stronie|tu|tam|gdzie|którym|której|których|obok|poniżej|powyżej|niżej|wyżej|dole|górze)${S}(?:się${S})?)(?<target>znajduję)(?=${S}(?:się${S})?(?!(?:w|we|na|z|ze|pod|nad|przed|za|u|przy|obok|tu|tam|teraz|już|nadal|wciąż|daleko|blisko|po|w|między|sam|sama)${NOT_LETTER})\\p{L}+(?:[ \\t\\u00a0]+\\p{L}+)?[ \\t\\u00a0]*[^\\p{L}\\s])`,
    fix: "znajduje",
    ...CONFUSION,
  },
  // "musze" (to a fly) before an infinitive or after "nie"/"ja" is "muszę".
  {
    pattern: `(?<target>musze)(?=${S}(?:(?:się|już|jeszcze|zaraz|teraz|chyba|to|też|go|ją|je|coś)${S}){0,2}\\p{L}+ć${NOT_LETTER})`,
    fix: "muszę",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:ja|nie|już|też|chyba|naprawdę|jeszcze|zaraz|teraz)${S})(?<target>musze)${NOT_LETTER}`,
    fix: "muszę",
    ...CONFUSION,
  },
  // "maja" (of May) is a date: a day number, a month phrase or a preposition comes before it.
  {
    pattern: `(?<=(?:^|[^\\p{L}\\d])(?:oni|one|ludzie|wszyscy|nie|którzy|które|dzieci|członkowie|\\p{L}+owie|\\p{L}+(?:cy|dzy))${S})(?<target>maja)(?=${S}(?!(?:roku|r|br|bieżącego|tego|przyszłego|ubiegłego|i|oraz|lub|do|włącznie)${NOT_LETTER})\\p{Ll})`,
    fix: "mają",
    ...CONFUSION,
    lowercase: true,
  },
  // "głownie" is "Głowno" or the plural of "głownia"; lowercase before a word it is "głównie".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|we|do|z|ze|pod)${S})(?<target>głownie)(?=${S}\\p{L})`,
    fix: "głównie",
    ...CONFUSION,
    lowercase: true,
  },
  // "miedzy" (balk, genitive) before an instrumental is "między".
  {
    pattern: `(?<target>miedzy)(?=${S}(?:nami|wami|nimi|sobą|innymi|\\p{L}+(?:ami|em|ą|ym|ymi|im|imi|iem))${NOT_LETTER})`,
    fix: "między",
    ...CONFUSION,
  },
  // "nadaj" (imperative "give") before a verb or "nie" is "nadal".
  {
    pattern: `(?<target>nadaj)(?=${S}(?:nie|jest|są|był|była|było|się${S}nie|trwa|trwają|występuje|występują|działa|mieszka|pracuje|\\p{L}+uje)${NOT_LETTER})`,
    fix: "nadal",
    ...CONFUSION,
  },
  // "wieku z nich" (of the age of them) is "wielu".
  {
    pattern: `(?<!\\p{L}(?:ym|im)${S})(?<target>wieku)(?=${S}z${S}(?:nich|nas|was|tych|nami)${NOT_LETTER})`,
    fix: "wielu",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:od|przez|po|dla|bardzo|z|u)${S})(?<target>wieku)(?!${S}lat${S}(?:\\d|\\p{L}+(?:u|ciu|miu|ech|óch)${NOT_LETTER}))(?=${S}(?:lat|osób|ludzi|miesięcy|dni|tygodni|godzin|krajów|miejsc|przypadków|powodów|innych|\\p{L}+ych)${NOT_LETTER})`,
    fix: "wielu",
    ...CONFUSION,
  },
  // "klika" (a clique), "kila" (syphilis): before a counted genitive they are "kilka".
  {
    pattern: `(?<target>klika|kliku|kila|kilu)(?=${S}(?:–${S}\\p{L}+|osób|ludzi|dni|lat|razy|godzin|minut|sekund|tygodni|miesięcy|problemów|miejsc|miejscach|latach|dniach|dolców|złotych|kategoriach|stron|pytań|sztuk|tysięcy|milionów|kilometrów|metrów|centymetrów|kilogramów|procent|miejscach|osobach|godzinach|tygodniach|miesiącach)${NOT_LETTER})`,
    fix: (m) =>
      /[au]$/iu.test(m.groups!.target) && /a$/iu.test(m.groups!.target) ? "kilka" : "kilku",
    ...CONFUSION,
  },
  // "Rządny" (governing) before a desired thing is "żądny".
  {
    pattern: `(?<target>rządn(?<end>y|a|e|i|ego|ej|ym|ych))(?=${S}(?:władzy|krwi|zemsty|przygód|wiedzy|sławy|pieniędzy|zysku|zysków|wrażeń|zwycięstwa|odwetu|zaszczytów|chwały)${NOT_LETTER})`,
    fix: (m) => `żądn${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "rzuć gumę": "żuć" after a verb that takes an infinitive.
  {
    pattern: `(?<=(?:lubię|lubi|lubisz|lubimy|lubią|przestań|przestał|przestała|zaczął|zaczęła|wolno|można|trzeba|nie)${S})(?<target>rzuć)(?=${S}gum\\p{L}*${NOT_LETTER})`,
    fix: "żuć",
    ...CONFUSION,
  },
  // "tępo" (bluntly) and "tempo" (pace).
  {
    pattern: `(?<target>tęp(?<end>o|a|em|ie))(?=${S}(?:pracy|marszu|życia|wzrostu|rozwoju|gry|akcji|zmian|jazdy|wzrostu|nauki|reform)${NOT_LETTER})`,
    fix: (m) => `temp${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:zwiększyć|zwiększył|zwiększyła|zwiększyli|zwiększcie|zwolnić|zwolnił|zwolniła|narzucić|narzucił|narzuciła|przyspieszyć|przyspieszył|utrzymać|utrzymał|utrzymywać|wolne|wolnego|szybkie|szybkiego|zawrotne|zawrotnym|spokojne|równe|mordercze|ślimacze|jego|jej|ich|zbyt)${S})(?<target>tęp(?<end>o|a|em))(?=[ \\t\\u00a0]*[.!?,;:…]|${S}(?:i|oraz|pracy|marszu|gry|jazdy)${NOT_LETTER})`,
    fix: (m) => `temp${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:patrzy\\p{L}*|spogląda\\p{L}*|spojrza\\p{L}*|wpatrywa\\p{L}*|wpatruje\\p{L}*|gapi\\p{L}*|gapić)${S})(?<target>tempo)${NOT_LETTER}`,
    fix: "tępo",
    ...CONFUSION,
  },
  // "karze" (punishes) before an infinitive is "każe" (orders).
  {
    pattern: `(?<target>kar(?<end>ze|zesz|zę|zemy|zecie|żą))(?=${S}(?:(?:${PRONOUN_OBJECT}|to|tego|się)${S}){0,2}\\p{L}+ć${NOT_LETTER})`,
    fix: (m) =>
      `ka${{ ze: "że", zesz: "żesz", zę: "żę", zemy: "żemy", zecie: "żecie", żą: "żą" }[m.groups!.end.toLowerCase()]}`,
    ...CONFUSION,
  },
  // "pokarz" (punish) before a person to show something to is "pokaż".
  {
    pattern: `(?<target>pokarz(?<end>|ę|e|cie|my))(?=${S}(?:${PRONOUN_OBJECT}|że|jak|co|gdzie|swój|swoją|swoje)${NOT_LETTER})`,
    fix: (m) => `pokaż${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  {
    pattern: `(?<target>pomorze)(?=${S}(?:${PRONOUN_OBJECT})${NOT_LETTER})`,
    fix: "pomoże",
    ...CONFUSION,
    lowercase: true,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:nie|ja|już|naprawdę|mocno|święcie|też)${S})(?<target>(?:wierze|wieżę))(?=${S}w${NOT_LETTER}|[ \\t\\u00a0]*[.!?,;:…]|${S}(?:ci|tobie|wam|mu|jej|im|że)${NOT_LETTER})`,
    fix: "wierzę",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:oni|one|nie|ludzie|wszyscy)${S})(?<target>wieżą)(?=${S}w${NOT_LETTER})`,
    fix: "wierzą",
    ...CONFUSION,
  },
  // "tuz" (an ace) before a preposition of place or time is "tuż".
  {
    pattern: `(?<target>tuz)(?=${S}(?:przed|po|obok|za|nad|pod|przy|koło|obok|zaraz|około)${NOT_LETTER})`,
    fix: "tuż",
    ...CONFUSION,
  },
  // "Chodź to może zbyt prosty przykład": the concessive "choć".
  {
    pattern: `${CLAUSE_START}(?<target>chodź)(?=${S}(?:to|był|była|było|byli|były|jest|są)${NOT_LETTER})`,
    fix: "choć",
    ...CONFUSION,
  },
  // "oto" (here is) for "o to" with verbs taking "o".
  {
    pattern: `(?<target>oto)(?=${S}(?:chodzi|chodziło|chodzić|chodzi${S}mi|pytam|pytał|pytała|pytasz|prosi|proszę|prosił|prosiła|dbam|walczę|martwię)${NOT_LETTER})`,
    fix: "o to",
    ...CONFUSION,
    lowercase: true,
  },
  {
    pattern: `(?<=(?:chodzi|chodziło|pytam|prosiłem|prosiłam|proszę|dbam)${S}(?:właśnie${S})?)(?<target>oto)(?=[ \\t\\u00a0]*[.!?])`,
    fix: "o to",
    ...CONFUSION,
  },
  // "moim zadaniem, to bzdura": the opinion "zdaniem" is set off by commas.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:moim|twoim|naszym|waszym|jego|jej|ich)${S})(?<target>zadaniem)(?=[ \\t\\u00a0]*,)`,
    fix: "zdaniem",
    ...CONFUSION,
  },
  // A noun after "w porównaniu", "wraz" and "zgodnie" needs "z".
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?<head>w${S}porównaniu|wraz|zgodnie)${S})(?<target>(?<word>mną|nim|nią|nimi|\\p{L}+(?:ą|em|ami|iem)))${NOT_LETTER}`,
    fix: (m) => {
      const word = m.groups!.word;
      if (/^(?:tym|tą|jest|razem|całą|czasem|zawsze|samą|swą|mą|twą)$/iu.test(word)) return null;
      // "zgodnie twierdzą" (unanimously): a feminine instrumental only after "wraz" or a name.
      if (/ą$/u.test(word) && !/^wraz$/iu.test(m.groups!.head) && !/^\p{Lu}/u.test(word))
        return null;
      return `${/^(?:mną|[sśzźż][^aeiouyąęó]|wsz)/iu.test(word) ? "ze" : "z"} ${word}`;
    },
    ...CONFUSION,
  },
  // A genitive noun after "mimo", "bez", "podczas": "mimo różnić" is "różnic".
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:mimo|pomimo|bez|tych|wielu|kilku|istotnych|dużych|pewnych|żadnych|licznych)${S})(?<target>różnić)${NOT_LETTER}`,
    fix: "różnic",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:podczas|bez|wśród|spośród|w${S}trakcie|w${S}czasie|w${S}ramach)${S}(?:\\p{L}+(?:ych|ich)${S}){0,2})(?<target>(?<stem>\\p{L}{3,}(?:ow|yw|iw)?)ać)${NOT_LETTER}`,
    fix: (m) => `${m.groups!.stem}ań`,
    ...CONFUSION,
  },
  // "skłony" (bends) before "do" + a noun of willingness is "skłonny".
  {
    pattern: `(?<target>skłon(?<end>y|a|e|i))(?=${S}(?:do${S}(?!(?:przodu|tyłu|boku)${NOT_LETTER})\\p{L}+|był|była|było|byli|jest|są)${NOT_LETTER})`,
    fix: (m) => `skłonn${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "Gówna" for "Główna" before an office, prize or role.
  {
    pattern: `(?<target>gówn(?<end>a|ej|ą|y|ego|ym|ych|e))(?=${S}(?:księgow\\p{L}*|nagrod\\p{L}*|wygran\\p{L}*|rol\\p{L}*|siedzib\\p{L}*|przyczyn\\p{L}*|ulic\\p{L}*|bohater\\p{L}*|siedzib\\p{L}*|kwatera|kwatery|kwaterze)${NOT_LETTER})`,
    fix: (m) => `główn${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "sadowy" (of an orchard) for "sądowy" in legal phrases.
  {
    pattern: `(?<target>sadow(?<end>y|a|e|ego|ej|ym|ych|ymi))(?=${S}(?:wyrok\\p{L}*|proces\\p{L}*|koszt\\p{L}*|postępowani\\p{L}*|spraw\\p{L}*|kurator\\p{L}*|komornik\\p{L}*|biegł\\p{L}*|orzeczeni\\p{L}*|nakaz\\p{L}*|spor\\p{L}*|spór)${NOT_LETTER})`,
    fix: (m) => `sądow${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:koszty|kosztów|kosztami)${S})(?<target>sadow(?<end>e|ych|ymi))${NOT_LETTER}`,
    fix: (m) => `sądow${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "lutego" misspelt as "litego" next to a day number.
  {
    pattern: `(?<=\\d{1,2}\\.?${S})(?<target>lit(?<end>ego|y))(?=${S}\\d|[ \\t\\u00a0]*[.,;]|$)`,
    fix: (m) => `lut${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "w lata 70." (into the 70s) for "w latach" (in the 70s) after "dopiero/już/właśnie".
  {
    pattern: `(?<=(?:dopiero|już|właśnie|jeszcze|rozpoczęło${S}się|zaczęło${S}się)${S})(?<target>w${S}lata)(?=${S}(?:\\d0\\.|\\p{L}+dziest\\p{L}+))`,
    fix: "w latach",
    ...CONFUSION,
  },
  // "taktować" for "traktować ... jako".
  {
    pattern: `(?<target>takt(?<end>uje|ują|ujesz|ował|owała|owali|ować))(?=${S}(?:się${S})?(?:${PRONOUN_OBJECT})${S}jako${NOT_LETTER})`,
    fix: (m) => `trakt${m.groups!.end.toLowerCase()}`,
    ...CONFUSION,
  },
  // "Ogromna mnie więcej ilość" — no; "ode mnie więcej" is a pronoun. The approximation precedes a quantity.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:${PREPOSITIONS}|ode|beze|przeze|dla|daj|dajcie|dał|dała|dali|dać)${S})(?<target>mnie)(?=${S}więcej${S}(?:\\d|${"pół|co|tyle|tak|jak|w|o|od|do|na|przez|tydzień|godzinę|rok|miesiąc|dwa|dwie|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|sto|tysiąc|połowa|połowę|połowie|tak"})${NOT_LETTER})`,
    fix: "mniej",
    ...CONFUSION,
  },
  {
    pattern: `(?<=coraz${S})(?<target>mnie)(?!${S}(?:mniej|więcej)${NOT_LETTER})(?=${S}\\p{L})`,
    fix: "mniej",
    ...CONFUSION,
  },
  // "rzec można" (one might say) is set off by commas or opens "że".
  {
    pattern: `(?<target>rzecz)(?=${S}można(?:${S}by)?[ \\t\\u00a0]*(?:,|${S}że${NOT_LETTER}))`,
    fix: "rzec",
    ...CONFUSION,
  },
  {
    pattern: `(?<=(?:można|trzeba|by${S}tak|tak)${S}(?:by${S})?)(?<target>rzecz)(?=[ \\t\\u00a0]*(?:[,–—-]|$)|${S}że${NOT_LETTER})`,
    fix: "rzec",
    ...CONFUSION,
  },
  // "W zależność od potrzeb" opening a clause; "popadł w zależność od" is the noun.
  {
    pattern: `(?:${CLAUSE_START}|(?<=,${S}))(?<target>w${S}zależność)(?=${S}od${NOT_LETTER})`,
    fix: "w zależności",
    ...CONFUSION,
  },
  // "anie" (no word) for "a nie".
  { pattern: `(?<target>anie)(?=${S}\\p{L})`, fix: "a nie", ...CONFUSION, lowercase: true },
];

/*
 * "ze" for "że": the preposition "ze" only stands before "mną" and words opening with
 * two consonants ("ze snu", "ze względu"), or loosely before a number ("ze dwa lata").
 * Before a vowel or a single consonant and a vowel it can only be the conjunction.
 */
const ZE = /(?<![\p{L}\p{N}_'’-])(?<ze>ze)(?<sp>[ \t ]{1,8})(?<next>\p{L}+)/gu;
const DIGRAPH = /^(?:ch|cz|dz|dź|dż|rz|sz)/iu;
const VOWEL = /^[aąeęioóuy]/iu;
const ZE_NOT_CONJUNCTION = new Set(
  "pięć sześć siedem osiem dziewięć dziesięć sto setkę tysiąc kilka kilkanaście kilkadziesiąt parę pół godzinę tydzień miesiąc rok dzień".split(
    " ",
  ),
);

const NEVER_AFTER_PREPOSITION =
  /^(?:z|ze|w|we|na|do|od|nie|się|to|tak|już|jest|są|był|była|było|byli|będzie|źle|dobrze|zawsze|wtedy|teraz|tu|tam|ktoś|coś|ja|ty|on|ona|ono|oni|one|my|wy|mu|mi|go|jej|ich|nic|nikt|wszyscy|wszystko|jeśli|gdy|kiedy|chociaż|jednak)$/iu;

function zeForZe(ctx: DetectContext): RawFinding[] {
  if (!isPl(ctx) || (ctx.rules && !ctx.rules.has(CONFUSION.ruleId))) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, ZE)) {
    const next = m.groups!.next;
    // Names and acronyms ("ze Lwowa", "ze ZUS-u") take the preposition loosely.
    if (/^\p{Lu}/u.test(next) || ZE_NOT_CONJUNCTION.has(next.toLowerCase())) continue;
    // No preposition takes these: "ze z tą", "ze źle", "ze to".
    if (!NEVER_AFTER_PREPOSITION.test(next)) {
      // Sibilant onsets take a nonstandard "ze" preposition more often than a typo.
      if (/^(?:[sśzźż]|rz)/iu.test(next)) continue;
      const rest = next.replace(DIGRAPH, "c");
      if (!VOWEL.test(rest) && !VOWEL.test(rest.slice(1))) continue;
    }
    // "wraz ze", "zgodnie ze": the word before already asks for the preposition.
    const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
    if (
      /(?:^|[^\p{L}])(?:wraz|raz|razem|wspólnie|zgodnie|porównaniu|wspólnego)[ \t\u00a0]+$/iu.test(
        before,
      )
    )
      continue;
    const typed = m.groups!.ze;
    if (userOrNamed(ctx, typed)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + 2,
        [caseLike(typed, "że")],
        CONFUSION.ruleId,
        CONFUSION.messageKey,
      ),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: ["englishPhraseCorrections"] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => [...runFrames(ctx, FRAMES), ...zeForZe(ctx)],
  },
];
