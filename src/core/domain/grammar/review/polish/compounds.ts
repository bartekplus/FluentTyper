import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveRows,
  CLAUSE_START,
  caseLike,
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
 * Words Polish spelling writes as one, typed apart. A row is here only when its
 * split form is no correct Polish phrase; split forms that also read as a
 * preposition and a noun ("na prawdę" as "for the truth") are guarded frames below.
 */

const COLORS = [
  "zielon",
  "niebiesk",
  "czerwon",
  "żółt",
  "brązow",
  "szar",
  "różow",
  "fioletow",
  "granatow",
  "pomarańczow",
  "popielat",
  "błękitn",
  "beżow",
  "zielonkaw",
  "siw",
  "rud",
  "kremow",
  "turkusow",
];

export const COMPOUNDS: readonly PhraseRow[] = [
  // Preposition + adverb, conjunction or particle.
  ["na przeciw", "naprzeciw"],
  ["w tedy", "wtedy"],
  ["w ówczas", "wówczas"],
  ["w niwecz", "wniwecz"],
  ["w pław", "wpław"],
  ["w brew", "wbrew"],
  ["w raz z", "wraz z"],
  ["w raz ze", "wraz ze"],
  ["w skutek", "wskutek"],
  ["w ciąż", "wciąż"],
  ["w cale", "wcale"],
  ["w okół", "wokół"],
  ["w zdłuż", "wzdłuż"],
  ["w szerz", "wszerz"],
  ["w zwyż", "wzwyż"],
  ["w spak", "wspak"],
  ["w skroś", "wskroś"],
  ["w pół do", "wpół do"],
  ["na w pół", "na wpół"],
  ["w między czasie", "w międzyczasie"],
  ["w oka mgnieniu", "w okamgnieniu"],
  ["w niebo głosy", "wniebogłosy"],
  ["w niebo wzięty", "wniebowzięty"],
  ["w niebo wzięta", "wniebowzięta"],
  ["w niebo wzięte", "wniebowzięte"],
  ["w niebo wzięci", "wniebowzięci"],
  ["po śród", "pośród"],
  ["za nadto", "zanadto"],
  ["za nad to", "zanadto"],
  ["za dość", "zadość"],
  ["za równo", "zarówno"],
  ["za miast", "zamiast"],
  ["za wsze", "zawsze"],
  ["za wczasu", "zawczasu"],
  ["za w czasu", "zawczasu"],
  ["za tem", "zatem"],
  ["z goła", "zgoła"],
  ["z nów", "znów"],
  ["z nowu", "znowu"],
  ["z pomiędzy", "spomiędzy"],
  ["z po między", "spomiędzy"],
  ["po między", "pomiędzy"],
  ["z poza", "spoza"],
  ["z ponad", "sponad"],
  ["do tąd", "dotąd"],
  ["od tąd", "odtąd"],
  ["do kąd", "dokąd"],
  ["do póki", "dopóki"],
  ["do puki", "dopóki"],
  ["do póty", "dopóty"],
  ["do puty", "dopóty"],
  ["do tych czas", "dotychczas"],
  ["do piero", "dopiero"],
  ["do nie dawna", "do niedawna"],
  ["do okoła", "dookoła"],
  ["na okół", "naokół"],
  ["tak na prawdę", "tak naprawdę"],
  ["na wzajem", "nawzajem"],
  ["na umyślnie", "naumyślnie"],
  ["na daremnie", "nadaremnie"],
  ["na tychmiast", "natychmiast"],
  ["na to miast", "natomiast"],
  ["na prędce", "naprędce"],
  ["po nad", "ponad"],
  ["po nadto", "ponadto"],
  ["po nad to", "ponadto"],
  ["po przez", "poprzez"],
  ["po za", "poza"],
  ["po tem", "potem"],
  ["po niewczasie", "poniewczasie"],
  ["po jutrze", "pojutrze"],
  ["po porostu", "po prostu"],
  ["po protu", "po prostu"],
  ["przed wczoraj", "przedwczoraj"],
  ["przede dniu", "przededniu"],
  ["w przed dzień", "w przeddzień"],
  ["w przed dniu", "w przededniu"],
  ["nad zwyczaj", "nadzwyczaj"],
  ["aż nad to", "aż nadto"],
  ["a nad to", "a nadto"],
  ["o prócz", "oprócz"],
  ["przy najmniej", "przynajmniej"],
  ["co nie co", "co nieco"],
  ["co nie miara", "co niemiara"],
  ["gdzie nie gdzie", "gdzieniegdzie"],
  ["skąd inąd", "skądinąd"],
  ["tam tędy", "tamtędy"],
  ["mimo chodem", "mimochodem"],
  ["tu dzież", "tudzież"],
  ["dwa kroć", "dwakroć"],
  ["trzy kroć", "trzykroć"],
  ["sto kroć", "stokroć"],
  ["pół tora", "półtora"],
  ["pół torej", "półtorej"],
  // "nie" with adverbs and pronouns that have no separate reading.
  ["nie opodal", "nieopodal"],
  ["nie omal", "nieomal"],
  ["nie bawem", "niebawem"],
  ["nie spełna", "niespełna"],
  ["nie zbyt", "niezbyt"],
  ["nie stety", "niestety"],
  ["nie zmiernie", "niezmiernie"],
  ["nie którzy", "niektórzy"],
  ["nie których", "niektórych"],
  ["nie które", "niektóre"],
  ["nie którym", "niektórym"],
  ["nie którymi", "niektórymi"],
  // The personal ending belongs to the conjunction ("żebyś my" for "żebyśmy").
  ...["żebyś", "abyś", "gdybyś"].map((c): PhraseRow => [`${c} my`, `${c.slice(0, -1)}śmy`]),
  // Nouns and adjectives that are one word.
  ["za mąż pójście", "zamążpójście"],
  ["za mąż pójścia", "zamążpójścia"],
  ["za mąż pójściu", "zamążpójściu"],
  ["za mąż pójściem", "zamążpójściem"],
  ["przed pokój", "przedpokój"],
  ["Hong Kong", "Hongkong"],
  ["Hong Kongu", "Hongkongu"],
  ["Hong Kongiem", "Hongkongiem"],
  ...["", "u", "em", "ie", "y", "ów"].map((e): PhraseRow => [`biznes plan${e}`, `biznesplan${e}`]),
  // "krótko trwały" and "trwała" are also the verb: "radości krótko trwały".
  ...adjectiveRows("krótko trwał", "krótkotrwał").slice(2),
  ...adjectiveRows("długo trwał", "długotrwał").slice(2),
  ...adjectiveRows("mało soln", "małosoln"),
  ...adjectiveRows("wszech obecn", "wszechobecn"),
  ...adjectiveRows("bez wypadkow", "bezwypadkow"),
  ...adjectiveRows("bez przewodow", "bezprzewodow"),
  ...adjectiveRows("bez płatn", "bezpłatn"),
  ...adjectiveRows("nowo roczn", "noworoczn"),
  ...adjectiveRows("święto krzysk", "świętokrzysk"),
  ...adjectiveRows("popularno naukow", "popularnonaukow"),
  ...adjectiveRows("popularno-naukow", "popularnonaukow"),
  ...adjectiveRows("północno amerykańsk", "północnoamerykańsk"),
  ...adjectiveRows("południowo amerykańsk", "południowoamerykańsk"),
  ...adjectiveRows("anglo języczn", "anglojęzyczn"),
  ...adjectiveRows("anglo-języczn", "anglojęzyczn"),
  ...adjectiveRows("polsko języczn", "polskojęzyczn"),
  ...["jasno", "ciemno", "blado"].flatMap((shade) =>
    COLORS.flatMap((color) => adjectiveRows(`${shade} ${color}`, `${shade}${color}`)),
  ),
];

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

/** Cardinal numerals, for "na około pięć" (about five). */
const NUMERALS =
  "pół|półtora|jeden|jedna|jedno|dwa|dwie|dwóch|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|\\p{L}+naście|\\p{L}+dzieści|\\p{L}+dziesiąt|sto|\\p{L}+set|\\p{L}+sta|tysiąc|tysiące|tysięcy|milion\\p{L}*|miliard\\p{L}*|kilka|kilkanaście|kilkadziesiąt|kilkuset|kilku|kilkunastu|setki|tysiące|połowy|połowie|połowę|stu|dwustu|trzystu|czterystu|pięciu|sześciu|siedmiu|ośmiu|dziewięciu|dziesięciu|dwudziestu|trzydziestu|czterdziestu|pięćdziesięciu|stu";

const COMPOUND = {
  ruleId: "englishClosedCompounds",
  messageKey: "review_msg_closed_compound",
} as const;

export const FRAMES: readonly Frame[] = [
  // "niema" (mute, feminine) before a genitive object, or after one at the clause end, is "nie ma".
  {
    pattern: `(?<target>niema)(?=${S}(?:pojęcia|czasu|sensu|go|jej|ich|nic|nikogo|niczego|już|tu|tam|potrzeby|mowy|problemu|racji|prawa|wątpliwości|szans|znaczenia|co|kto|gdzie|jak|czego|kogo|nas|was|mnie|ciebie|tego|takiej|takiego|żadnego|żadnej|żadnych|sprawy|szansy|dokąd|kiedy)(?![\\p{L}]))`,
    fix: "nie ma",
    ruleId: "englishAlotCorrection",
    messageKey: "review_msg_split_words",
  },
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:ich|go|jej|nas|was|tu|tam|już|nic|nikogo|mnie|ciebie|kogo|czego|nigdzie|teraz)${S})(?<target>niema)(?=[ \\t\\u00a0]*[.!?,;…])`,
    fix: "nie ma",
    ruleId: "englishAlotCorrection",
    messageKey: "review_msg_split_words",
  },
  // "Czas na prawdę" (time for the truth) is a noun; a verb, an adverb or the end follows the adverb.
  {
    pattern: `(?<!(?:dowód|dowody|dowodu|dowodem|czas|miejsce|liczyć|liczy|liczę|czekać|czeka|czekam|zasługuje|zasługiwać|szansę|szansa|ochotę|wpływ|prawo|gotowość|otwarty|otwarta|otwarci)${S})(?<target>na${S}prawdę)(?!${S}(?:o|i|historyczną|naukową|absolutną|obiektywną|objawioną|ostateczną|jedyną|tego|jego|jej|ich|\\p{L}+ego|\\p{L}+ych)(?![\\p{L}]))(?![ \\t\\u00a0]*[.!?;:…)"”»])`,
    fix: "naprawdę",
    ...COMPOUND,
  },
  // "przód" is the front: "na przód statku"; the adverb ends its phrase or goes "ku" something.
  {
    pattern: `(?<target>na${S}przód)(?=[ \\t\\u00a0]*(?:[.!?,;:…)"”»]|$)|${S}(?:ku|i|a)(?![\\p{L}]))`,
    fix: "naprzód",
    ...COMPOUND,
  },
  // "raz za razem" is a phrase of its own.
  {
    pattern: `(?<!raz${S})(?<target>za${S}razem)(?![\\p{L}])`,
    fix: "zarazem",
    ...COMPOUND,
  },
  // "uznać za pewne" (take for granted) and "za pewne kwoty" keep the adjective;
  // the adverb goes before a verb, a numeral or the end of the clause.
  {
    pattern: `(?<!(?:uzna\\p{L}*|uważa\\p{L}*|uważ\\p{L}*|się|mie\\p{L}*|ma|mam|masz|mamy|macie|mają|wzi\\p{L}*|bra\\p{L}*|bior\\p{L}*|przyj\\p{L}*|poczyt\\p{L}*|uchodz\\p{L}*)(?:${S}\\p{L}+)?${S})(?<target>za${S}pewne)(?=[ \\t\\u00a0]*[.!?,;:…]|${S}(?:nie|już|to|jest|był|była|było|są|będzie|będą|się|kilka|kilku|wiele|wielu|tak|tylko|też|także|ktoś|coś|jutro|dziś|dzisiaj|wkrótce|niedługo|później|wtedy|teraz|znowu|jeszcze|wszyscy|wszystko|on|ona|oni|ono|ty|wy|my|ja||\\p{L}+(?:ł|ła|ło|li|ły|je|ją|ie|isz|esz|my|cie))(?![\\p{L}]))`,
    fix: "zapewne",
    ...COMPOUND,
  },
  // "po środku" is also "after a remedy" (po środku nasennym).
  {
    pattern: `(?<target>po${S}środku)(?!${S}\\p{L}*(?:ym|im)(?![\\p{L}]))(?![\\p{L}])`,
    fix: "pośrodku",
    ...COMPOUND,
  },
  // "po woli dotarcia" (by the will to) and the Warsaw district "Wola" keep the noun.
  {
    pattern: `(?<target>po${S}woli)(?=[ \\t\\u00a0]*(?:[.!?,;:…)]|$)|${S}(?:się|nie|ale|i|a|\\p{L}+(?:ł|ła|ło|li|ły|je|ją|ie|isz|esz|my|cie|ąc))(?![\\p{L}]))`,
    fix: (m) => (/^po\s+Woli$/u.test(m.groups!.target) ? null : "powoli"),
    ...COMPOUND,
  },
  // "ponad to, co" (beyond what) is two words.
  {
    pattern: `(?<target>ponad${S}to)(?![\\p{L}])(?![ \\t\\u00a0]*,?[ \\t\\u00a0]*(?:co|czego|czym)(?![\\p{L}]))`,
    fix: "ponadto",
    ...COMPOUND,
  },
  // "z resztą" (with the rest) takes a genitive; the adverb is followed by a clause.
  {
    pattern: `(?<target>z${S}resztą)(?=[ \\t\\u00a0]*,|${S}(?:nikogo|nic|niczego|nie|to|tego|jest|był|była|było|są|ja|ty|on|ona|ono|my|wy|oni|one|już|zawsze|też|chyba|wiadomo|sam|sama|samo|sami|jak|co|kto|każdy|wszyscy|wszystko|mnie|ciebie|go|jej|ich|się|bardzo|dobrze|i)(?![\\p{L}]))`,
    fix: "zresztą",
    ...COMPOUND,
  },
  // "co raz" (every so often) is rare; before a comparative it is "coraz".
  {
    pattern: `(?<target>co${S}raz)(?=${S}(?:\\p{L}+(?:iej|ej|szy|sza|sze|szego|szej|szym|szych|szą|si)|więcej|mniej|bardziej|lepiej|gorzej|częściej|rzadziej|bliżej|dalej|wyżej|niżej|dłużej|krócej|głośniej|ciszej|szybciej|wolniej|mocniej|trudniej|łatwiej|później|wcześniej|wyraźniej)(?![\\p{L}]))`,
    fix: "coraz",
    ...COMPOUND,
  },
  // "dla tego" is fine before a noun ("dla tego człowieka"); a conjunction makes it "dlatego".
  {
    pattern: `(?<target>dla${S}tego)(?=[ \\t\\u00a0]*(?:,[ \\t\\u00a0]*)?(?:że|iż|żeby|by|aby|też|właśnie|ponieważ|bo)(?![\\p{L}]))`,
    fix: "dlatego",
    ...COMPOUND,
  },
  // "dla czego" stays in "dla czego innego"; before a finite verb it asks why.
  {
    pattern: `(?<target>dla${S}czego)(?=${S}(?:nie|się|\\p{L}+(?:esz|isz|ysz|asz|cie|ją|łeś|łaś|liście|łyście|łem|łam))(?![\\p{L}]))`,
    fix: "dlaczego",
    ...COMPOUND,
  },
  // "a tym czasem" opens a contrast; "tym czasem się nie przejmuj" is the instrumental.
  {
    pattern: `(?<=(?:^|[.!?]\\s+|(?:^|[^\\p{L}])a${S}))(?<target>tym${S}czasem)(?!${S}(?:się|nie|przejm\\p{L}*|zajm\\p{L}*|martw\\p{L}*)(?![\\p{L}]))(?![\\p{L}])`,
    fix: "tymczasem",
    ...COMPOUND,
  },
  // "w prawdzie" (in truth) is a noun; the concession pairs with "ale"/"lecz" later.
  {
    pattern: `(?<target>w${S}prawdzie)(?=[^.!?;\\n]{1,120}?,[ \\t\\u00a0]*(?:ale|lecz|jednak|to|a)(?![\\p{L}]))`,
    fix: "wprawdzie",
    ...COMPOUND,
  },
  // A preposition takes no "tam": "na tam to dziecko" is the demonstrative "tamto".
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:${PREPOSITIONS})${S})(?<target>tam${S}(?<pron>ten|ta|to|te|ci|tego|tej|temu|tą|tę|tym|tych|tymi))(?![\\p{L}])`,
    fix: (m) => `tam${m.groups!.pron.toLowerCase()}`,
    ...COMPOUND,
  },
  // The noun "widzimisię" after a preposition or a possessive.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:od|z|na|dla|według|czyjegoś|czyjeś|czyjś|jego|jej|ich|swojego|swoje|swoim|własnego|własne)${S})(?<target>widzi${S}mi${S}się)(?![\\p{L}])`,
    fix: "widzimisię",
    ...COMPOUND,
  },
  // "o jej" before an exclamation mark is the interjection.
  { pattern: `(?<target>o${S}jej)(?=[ \\t\\u00a0]*!)`, fix: "ojej", ...COMPOUND },
  // "wyjechać zagranicę" is the noun used for the adverbial "za granicę".
  {
    pattern: `(?<=(?:jecha\\p{L}*|jeżdż\\p{L}*|jeździ\\p{L}*|wyjecha\\p{L}*|wyjeżdża\\p{L}*|wyjedzie\\p{L}*|lecie\\p{L}*|wylecia\\p{L}*|wyemigrowa\\p{L}*|wysła\\p{L}*|wysyła\\p{L}*|pojecha\\p{L}*|pojedzie\\p{L}*|uciek\\p{L}*|uciec)${S})(?<target>zagranicę)(?![\\p{L}])`,
    fix: "za granicę",
    ...COMPOUND,
  },
  {
    pattern: `(?<=(?:by\\p{L}*|mieszka\\p{L}*|pracowa\\p{L}*|pracuj\\p{L}*|studiowa\\p{L}*|studiuj\\p{L}*|przebywa\\p{L}*|żyj\\p{L}*|żył\\p{L}*|odbywa\\p{L}*|zosta\\p{L}*|leczy\\p{L}*)${S})(?<target>zagranicą)(?![\\p{L}])`,
    fix: "za granicą",
    ...COMPOUND,
  },
  // "w stanie" (able) is two words after "być".
  {
    pattern: `(?<=(?:jest|są|był|była|było|byli|były|będzie|będą|jestem|jesteś|jesteśmy|jesteście|byłem|byłam|byłeś|byłaś|nie)${S})(?<target>wstanie)(?=${S}\\p{L}+(?:ć|c)(?![\\p{L}]))`,
    fix: "w stanie",
    ...COMPOUND,
  },
  // "w ogóle" written as one is handled by SPLIT_WORDS; "popołudniu" after no preposition is "po południu".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:${PREPOSITIONS}|\\p{L}*ym|\\p{L}*im|tego|tamtego|to|tamto|jakimś)${S})(?<!["„“”«])(?<target>popołudniu)(?![\\p{L}])`,
    fix: (m) => (m.groups!.target.startsWith("P") ? null : "po południu"),
    ...COMPOUND,
  },
  // "na około 300 zł", "w około połowie": "około" is the approximation, not the adverb.
  {
    pattern: `(?<target>(?<prep>na|w)${S}około)(?!${S}(?:\\d|${NUMERALS})(?![\\p{L}])|[ \\t\\u00a0]*\\d)(?![\\p{L}])`,
    fix: (m) => `${m.groups!.prep.toLowerCase()}około`,
    ...COMPOUND,
  },
  // "kary godny" (worthy of a penalty) after an adjective keeps the genitive: "najwyższej kary godne".
  {
    pattern: `(?<!\\p{L}(?:ej|szej)${S})(?<target>kary${S}godn(?<end>y|a|e|ego|ej|emu|ą|ym|ych|ymi|i))(?![\\p{L}])`,
    fix: (m) => `karygodn${m.groups!.end.toLowerCase()}`,
    ...COMPOUND,
  },
  // "nie mniej niż" (not less than) stays apart; "w tym nie mniej" is "including at least".
  {
    pattern: `(?<target>nie${S}mniej)(?=${S}jednak(?![\\p{L}]))(?!${S}jednak${S}niż)`,
    fix: "niemniej",
    ...COMPOUND,
  },
  {
    pattern: `(?<!(?:^|[^\\p{L}])w${S})(?<target>tym${S}nie${S}mniej)(?![\\p{L}])(?!${S}(?:niż|od)(?![\\p{L}]))`,
    fix: ["tym niemniej", "niemniej"],
    ...COMPOUND,
  },
  // "by najmniej zaszkodzić" is the conjunction and the superlative.
  {
    pattern: `(?<target>by${S}najmniej)(?![\\p{L}])(?!${S}\\p{L}+ć(?![\\p{L}]))`,
    fix: "bynajmniej",
    ...COMPOUND,
  },
  // "uważać coś za zwyczaj" takes the noun.
  {
    pattern: `(?<!(?:uważ|uzna|przyj|uchodz|poczyt|wzię|bierz|bior|bra)\\p{L}*[^.!?;\\n]{0,40})(?<target>za${S}zwyczaj)(?![\\p{L}])`,
    fix: "zazwyczaj",
    ...COMPOUND,
  },
  // "za co miesięcznie płacą" is the pronoun "co"; otherwise the adverbs and adjectives are one word.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:za|po|na|o|przez|w)${S})(?<target>co${S}(?<word>tygodniow|miesięczn|roczn|dzienn|godzinn)(?<end>ie|o|y|a|e|ego|ej|emu|ą|ym|ych|ymi|i))(?![\\p{L}])`,
    fix: (m) => {
      const end = m.groups!.end.toLowerCase();
      const word = m.groups!.word.toLowerCase();
      // "codziennie" and "cotygodniowo": the adverb ending follows the adjective stem.
      if ((end === "o") !== /ow$/.test(word) && (end === "o" || end === "ie")) return null;
      return `co${word}${end}`;
    },
    ...COMPOUND,
  },
  // "wciągu" is also the hoist ("wciąg"); before a span of time it is "w ciągu".
  {
    pattern: `(?<target>wciągu)(?=${S}(?:\\d|ostatni\\p{L}*|następn\\p{L}*|najbliższ\\p{L}*|kilk\\p{L}*|roku|lat|dnia|dni|tygodnia|tygodni|miesiąca|miesięcy|godziny|godzin|minuty|minut|sekund\\p{L}*|jednego|jednej|dwóch|trzech|całego|całej|pierwsz\\p{L}*|ubiegł\\p{L}*|tego|tej|życia|doby)(?![\\p{L}]))`,
    fix: "w ciągu",
    ...COMPOUND,
  },
  // The noun "bezsens" has a genitive "bezsensu"; after "to"/"jest" or alone it is "bez sensu".
  {
    pattern: `(?:(?<=(?:^|[^\\p{L}])(?:to|jest|był|była|było|są|byłoby|totalnie|zupełnie|kompletnie|całkiem|trochę)${S})|${CLAUSE_START})(?<target>bezsensu)(?![\\p{L}])(?!${S}(?:istnienia|życia|tego|wojny|świata)(?![\\p{L}]))`,
    fix: "bez sensu",
    ...COMPOUND,
  },
];

/*
 * The conditional "by" and the personal endings attach to a past-tense verb:
 * "zrobił by" -> "zrobiłby". "by" before an infinitive or a past form is the
 * conjunction ("przyszedł by pomóc"), and after a noun it may stand apart ("Szkoła by zyskała").
 */
const PAST_VERB =
  "\\p{L}{1,20}?(?:ał|ała|ało|ali|ały|ił|iła|iło|ili|iły|ył|yła|yło|yli|yły|ął|ęła|ęło|ęli|ęły|ógł|ogła|ogło|ogli|ogły|eł|szedł|szła|szło|szli|szły)";
// ponytail: hand-listed nouns and adjectives ending like past tenses; a POS lexicon would replace it.
const NOT_PAST = new Set(
  "siła siły skała skały ciało ciała działo działa mogiła mogiły chwała chwały żyła żyły nawała chwili sali fali stali soli roli woli cali dali wali brali pała pały pali śmiały biały mały cały stały dały wały zapał zapały upał upały kanał kanały szał szały bali dział działy materiał materiały ideał ideały rytuał rytuały okazały spały".split(
    " ",
  ),
);
const BY_SPLIT = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>${PAST_VERB})(?<space>[ \\t\\u00a0]{1,8})(?<by>by|bym|byś|byśmy|byście)(?![\\p{L}\\p{N}_'’-])`,
  "giu",
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

function conditionalBy(ctx: DetectContext): RawFinding[] {
  if (!isPl(ctx) || (ctx.rules && !ctx.rules.has(COMPOUND.ruleId))) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, BY_SPLIT)) {
    const { verb, by } = m.groups!;
    if (NOT_PAST.has(verb.toLowerCase()) || verb.length < 3) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    // "w tej chwili by", "na fali by": a noun phrase, not a verb.
    if (NOUN_PHRASE_BEFORE.test(before)) continue;
    // The conjunction: an infinitive or a past form follows within a few words
    // ("przyszedł by go zobaczyć", "chciał bym przyszedł").
    const end = m.index + m[0].length;
    const next = (ctx.text.slice(end, end + 60).match(/\p{L}+/gu) ?? []).slice(0, 4);
    // A person ending ("bym") or a modal ("mógł by zrobić") makes it the conditional.
    if (
      by.length === 2 &&
      !MODAL.test(verb) &&
      next.some((word) => isInfinitive(word.toLowerCase()))
    )
      continue;
    if (/^\p{L}*(?:ł|ła|ło|li|ły)$/u.test(next[0] ?? "")) continue;
    const typed = m[0];
    if (userOrNamed(ctx, typed)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + typed.length,
        [caseLike(typed, verb + by.toLowerCase())],
        COMPOUND.ruleId,
        COMPOUND.messageKey,
      ),
    );
  }
  return findings;
}

/** "zrobili śmy": the personal ending "-śmy"/"-ście" is never a word of its own. */
const PERSON_SPLIT =
  /(?<![\p{L}\p{N}_'’-])(?<word>\p{L}{2,30})(?<space>[ \t ]{1,8})(?<ending>śmy|ście)(?![\p{L}\p{N}_'’-])/giu;

function personEndings(ctx: DetectContext): RawFinding[] {
  if (!isPl(ctx) || (ctx.rules && !ctx.rules.has(COMPOUND.ruleId))) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PERSON_SPLIT)) {
    const { word, ending } = m.groups!;
    if (!/(?:li|ły|by|ło|ła)$/iu.test(word)) continue;
    const typed = m[0];
    if (userOrNamed(ctx, typed)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + typed.length,
        [caseLike(typed, word + ending.toLowerCase())],
        COMPOUND.ruleId,
        COMPOUND.messageKey,
      ),
    );
  }
  return findings;
}

/*
 * "nie" is written together with adjectives, adjectival participles, comparatives,
 * adjective-based adverbs and nouns in -ość/-anie (the 2026 rules: "niedobry",
 * "niepalący", "nielepszy", "nietrudno", "niepalenie"). It stays apart in a
 * contrast ("nie dobry, lecz zły"), in a question and after "to" ("To nie zły pomysł").
 */
/** Adjective endings except "-ą", which a third-person plural verb shares ("giną"). */
const ADJ = "(?:y|a|e|ego|ej|emu|ym|ych|ymi)";
const NIE_FORMS = [
  // Active and passive participles.
  `\\p{L}{2,}(?:ąc|on|an|ęt)${ADJ}`,
  // Comparatives and superlatives (a closed list: "-szy" is also a verb ending, "cieszy").
  `(?:naj)?(?:lepsz|gorsz|większ|wyższ|niższ|starsz|młodsz|dłuższ|krótsz|bliższ|dalsz|tańsz|droższ|szybsz|łatwiejsz|trudniejsz|ważniejsz|ciekawsz|lżejsz|cięższ|ładniejsz|prostsz|mądrzejsz|silniejsz|słabsz|bogatsz|nowsz|zdrowsz|piękniejsz|gorętsz|zimniejsz)${ADJ}`,
  "(?:naj)?(?:lepiej|gorzej)",
  // Adjectives in -owy, -ny, -ski and a few common bare ones.
  `\\p{L}{2,}(?:ow|n|sk|ck)${ADJ}`,
  `(?:dobr|zł|duż|wielk|mał|łatw|ciekaw|zdrow|chor|pewn|zdoln|grzeczn|uprzejm|wesoł|gotow|świadom|szczęśliw)(?:${ADJ.slice(3, -1)}|zy|i)`,
  // Adverbs from adjectives, nouns in -ość and verbal nouns in -anie/-enie.
  "(?:trudno|łatwo|dobrze|źle|daleko|wysoko|nisko|drogo|tanio|długo|dużo|mało|często|rzadko|chętnie|grzecznie|uprzejmie|ważne)",
  "\\p{L}{2,}ość",
  "\\p{L}{2,}(?:anie|enie|eniu|aniu)",
].join("|");
const NIE_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<nie>nie)(?<sp>[ \\t\\u00a0]+)(?<word>${NIE_FORMS})(?![\\p{L}\\p{N}_-])`,
  "giu",
);
/** Forms that are verbs, pronouns, ordinals or nouns despite the ending. */
const NIE_APART =
  /(?:zna|^można|stanie|staniu|^inn\p{L}*|^jedyn\p{L}*|^setn\p{L}*|tysięczn\p{L}*|^sam\p{L}*|głow[aeyąę]|mow[aeyąę]|słow[aeoyąę]|budow[aeyąę]|połow[aeyąę]|krow[aeyąę]|^ścian\p{L}*|^zmian\p{L}*|^cen[aeyąę]|^win[aeyąę]|^stron\p{L}*|^scen\p{L}*|^więcej|^mniej|^bardziej)$/iu;

function nieJoined(ctx: DetectContext): RawFinding[] {
  if (!isPl(ctx) || (ctx.rules && !ctx.rules.has(COMPOUND.ruleId))) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NIE_WORD)) {
    const { nie, word } = m.groups!;
    if (NIE_APART.test(word) || /^\p{Lu}/u.test(word)) continue;
    const end = m.index + m[0].length;
    const sentenceBefore =
      ctx.text
        .slice(Math.max(0, m.index - 200), m.index)
        .split(/[.!?…\n]/u)
        .at(-1) ?? "";
    const sentenceAfter = ctx.text.slice(end, end + 200).split(/[.!…\n]/u)[0] ?? "";
    // A question, or "to nie …" / "czy nie …": the negation is the sentence's, not the word's.
    if (sentenceAfter.includes("?")) continue;
    if (
      /(?:^|[^\p{L}])(?:to|czy|czyż|że|żeby|gdyby|jakby|by|a|ale|lecz|ani)[ \t ]+$/iu.test(
        sentenceBefore,
      )
    )
      continue;
    // A comparison keeps the contrastive "nie": "nie lepszy od poprzednika".
    if (/^[ \t ]+(?:od|niż)(?!\p{L})/iu.test(sentenceAfter)) continue;
    // A contrast: "nie dobry, lecz zły", "nie tyle X, ile Y".
    if (
      /^[^;:]{0,60}?(?:,[ \t ]*(?:ale|lecz|tylko|a|jednak)|[ \t ]lecz)(?!\p{L})/iu.test(
        sentenceAfter,
      )
    )
      continue;
    if (userOrNamed(ctx, m[0])) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        end,
        [caseLike(nie, "nie") + word.toLowerCase()],
        COMPOUND.ruleId,
        COMPOUND.messageKey,
      ),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: ["englishClosedCompounds", "englishAlotCorrection"] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => [
      ...runFrames(ctx, FRAMES),
      ...conditionalBy(ctx),
      ...personEndings(ctx),
      ...nieJoined(ctx),
    ],
  },
];
