import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveForm, adjectiveOf, cases, inflect, nounTags, onlyNoun, VIRILE } from "./lexicon";
import { caseLike, findingAt, isPl, owned, S, userOrNamed } from "./shared";

/*
 * Pleonasms and wordy officialese (optional `stylePhrasing`), in the inflected
 * forms people type, and garbled idioms (`englishPhraseCorrections`): a set
 * phrase with a wrong word or preposition.
 */

const words = (list: string) => list.split(" ");
/** One row per form: `${form}${tail}` -> `${form}${kept}`. */
const drop = (forms: string, tail: string, kept = ""): PhraseRow[] =>
  words(forms).map((form): PhraseRow => [`${form}${tail}`, `${form}${kept}`]);

const MONTHS_LOCATIVE = words(
  "styczniu lutym marcu kwietniu maju czerwcu lipcu sierpniu wrześniu październiku listopadzie grudniu",
);

export const STYLE: readonly PhraseRow[] = [
  // Moving back is already "cofać się"; returning is already "wracać".
  ...drop(
    "cofam cofasz cofa cofamy cofacie cofają cofał cofała cofało cofali cofały cofaj cofajcie cofnę cofniesz cofnie cofniemy cofną cofnął cofnęła cofnęli cofnij cofnijcie",
    " się do tyłu",
    " się",
  ),
  ...words("cofanie cofaniu cofania cofaniem").map((noun): PhraseRow => [
    `${noun} się do tyłu`,
    `${noun} się`,
  ]),
  ...drop(
    "wracam wracasz wraca wracamy wracają wracał wracała wracali wracaj wrócę wrócisz wróci wrócimy wrócą wrócił wróciła wrócili wróćmy wróć",
    " z powrotem",
  ),
  ...drop(
    "kontynuować kontynuuję kontynuuje kontynuujemy kontynuują kontynuował kontynuowała kontynuowali kontynuuj",
    " dalej",
  ),
  ...drop(
    "spadać spada spadają spadał spadała spadało spadały spadali spadnie spadł spadła",
    " w dół",
  ),
  ...drop(
    "podnieść podnosić podnosi podnoszą podniósł podniosła podnieśli podnieś podnieście",
    " do góry",
  ),
  ...drop(
    "zdążyć zdążę zdążysz zdąży zdążymy zdążą zdążył zdążyła zdążyli zdążyłem zdążyłam zdążyliśmy",
    " na czas",
  ),
  ...drop(
    "poprawić poprawi poprawiło poprawił poprawiła poprawia poprawiają",
    " się na lepsze",
    " się",
  ),
  ...drop("wydaje wydają wydawał wydawała wydawało wydawali wydawały", " się być", " się"),
  ...words("ma masz mam mamy macie mają miał miała mieli miałem miałam mieć").map(
    (verb): PhraseRow => [`${verb} słuszną rację`, `${verb} rację`],
  ),
  ...words("tydzień miesiąc rok lata lat dni tygodnie miesiące").map((span): PhraseRow => [
    `${span} temu wstecz`,
    `${span} temu`,
  ]),
  ...MONTHS_LOCATIVE.map((month): PhraseRow => [`w miesiącu ${month}`, `w ${month}`]),
  ["wspólnie razem", ["wspólnie", "razem"]],
  ["razem wspólnie", ["razem", "wspólnie"]],
  ["nowe nowiny", "nowiny"],
  ["nowych nowin", "nowin"],
  // Paired noun and adjective forms: "okres czasu" -> "okres".
  ...([
    ["faktu autentycznego", "faktu"],
    ["faktem autentycznym", "faktem"],
    ["fakcie autentycznym", "fakcie"],
    ["fakty autentyczne", "fakty"],
    ["faktów autentycznych", "faktów"],
    ["faktach autentycznych", "faktach"],
    ["faktami autentycznymi", "faktami"],
    ["autentycznych faktach", "faktach"],
    ["autentycznych faktów", "faktów"],
    ["autentyczne fakty", "fakty"],
    ["okres czasu", "okres"],
    ["okresu czasu", "okresu"],
    ["okresie czasu", "okresie"],
    ["okresem czasu", "okresem"],
    ["okresy czasu", "okresy"],
    ["okresów czasu", "okresów"],
    ["potencjalna możliwość", "możliwość"],
    ["potencjalnej możliwości", "możliwości"],
    ["potencjalną możliwość", "możliwość"],
    ["potencjalne możliwości", "możliwości"],
    ["potencjalnych możliwości", "możliwości"],
    ["całkowite fiasko", "fiasko"],
    ["całkowitym fiaskiem", "fiaskiem"],
    ["całkowitego fiaska", "fiaska"],
    ["pełny komplet", "komplet"],
    ["pełnego kompletu", "kompletu"],
    ["pełnym kompletem", "kompletem"],
    ["wolny wakat", "wakat"],
    ["wolnego wakatu", "wakatu"],
    ["wolne wakaty", "wakaty"],
    ["dobrowolny ochotnik", "ochotnik"],
    ["dobrowolnym ochotnikiem", "ochotnikiem"],
    ["dobrowolni ochotnicy", "ochotnicy"],
    ["aura pogodowa", ["aura", "pogoda"]],
    ["aury pogodowej", ["aury", "pogody"]],
    ["żółtko jaja", "żółtko"],
    ["żółtka jaj", "żółtka"],
    ["żółtko jajka", "żółtko"],
    ["wzajemna współpraca", "współpraca"],
    ["wzajemnej współpracy", "współpracy"],
    ["wzajemną współpracę", "współpracę"],
    ["wzajemne współdziałanie", "współdziałanie"],
    ["wzajemnego współdziałania", "współdziałania"],
    ["wzajemna wymiana", "wymiana"],
    ["wzajemnej wymiany", "wymiany"],
    ["fałszywy miraż", "miraż"],
    ["dobra renoma", "renoma"],
    ["dobrą renomę", "renomę"],
    ["dobrej renomie", "renomie"],
    ["dobrej renomy", "renomy"],
    ["pozytywna akceptacja", "akceptacja"],
    ["pozytywnej akceptacji", "akceptacji"],
    ["efekt końcowy", "efekt"],
    ["efektem końcowym", "efektem"],
    ["kurs nauki", "kurs"],
    ["kursu nauki", "kursu"],
    ["deprawacja moralna", "deprawacja"],
    ["własna autopsja", "autopsja"],
    ["własnej autopsji", "autopsji"],
    ["wzajemne antagonizmy", "antagonizmy"],
    ["moralno-etyczny", "etyczny"],
    ["moralno-etyczne", "etyczne"],
    ["moralno-etycznych", "etycznych"],
  ] as PhraseRow[]),
  // Officialese for "dziś", "obecnie", "brakuje".
  ["na dzień dzisiejszy", ["obecnie", "dzisiaj"]],
  ["do dnia dzisiejszego", ["do dziś", "do dzisiaj"]],
  ["dnia dzisiejszego", ["dzisiaj", "dziś"]],
  ["w dniu jutrzejszym", "jutro"],
  ["w dniu wczorajszym", "wczoraj"],
  ["dnia wczorajszego", "wczoraj"],
  ["dnia jutrzejszego", "jutro"],
  ["w chwili obecnej", ["obecnie", "teraz"]],
  ["występuje brak", "brakuje"],
  ["występował brak", "brakowało"],
  ["wystąpi brak", "zabraknie"],
  ["w razie przypadku", ["w razie", "w przypadku"]],
  ["ja osobiście", ["ja", "osobiście"]],
  // A price "costs" more or less, it is not "cheaper": "kosztował mniej".
  ...words(
    "kosztuje kosztują kosztował kosztowała kosztowało kosztowały kosztować kosztowałby płaci płacą płacił płacić",
  ).flatMap((verb): PhraseRow[] =>
    (
      [
        ["taniej", "mniej"],
        ["drożej", "więcej"],
        ["tanio", "mało"],
        ["drogo", "dużo"],
      ] as const
    ).flatMap(([typed, plain]): PhraseRow[] => [
      [`${verb} ${typed}`, `${verb} ${plain}`],
      [`${typed} ${verb}`, `${plain} ${verb}`],
    ]),
  ),
  // Moving back "w tył" or "wstecz" is already "cofać się".
  ...words(
    "cofam cofa cofają cofał cofała cofali cofaj cofnij cofnijcie cofnął cofnęła cofnęli cofnie cofną",
  ).flatMap((verb): PhraseRow[] => [
    [`${verb} się w tył`, `${verb} się`],
    [`${verb} się wstecz`, `${verb} się`],
  ]),
  ...words("cofanie cofaniu cofania cofaniem").flatMap((noun): PhraseRow[] => [
    [`${noun} do tyłu`, noun],
    [`${noun} w tył`, noun],
    [`${noun} wstecz`, noun],
  ]),
  // "dalej kontynuował", "czynnie uprawia sport": the verb says it already.
  ...words(
    "kontynuuję kontynuuje kontynuujemy kontynuują kontynuował kontynuowała kontynuowali kontynuować",
  ).map((verb): PhraseRow => [`dalej ${verb}`, verb]),
  ...words(
    "uprawiam uprawia uprawiają uprawiał uprawiała uprawiali uprawiać uprawianie uprawiania",
  ).map((verb): PhraseRow => [`czynnie ${verb}`, verb]),
  // "miesiąc czasu": a span of time is already time.
  ...words("chwilę godzinę dzień tydzień miesiąc rok kwadrans moment").map((span): PhraseRow => [
    `${span} czasu`,
    span,
  ]),
  // "dlatego ponieważ", "gdyż bowiem": two conjunctions for one reason.
  ["dlatego ponieważ", ["dlatego że", "ponieważ"]],
  ["gdyż bowiem", "gdyż"],
  ["ponieważ bowiem", "ponieważ"],
  ["albowiem bowiem", "albowiem"],
  ...words("ktokolwiek cokolwiek jakkolwiek gdziekolwiek kiedykolwiek którykolwiek").map(
    (pronoun): PhraseRow => [`${pronoun} bądź`, pronoun],
  ),
  // "co by się nie stało" negates nothing: "cokolwiek by się stało".
  ["co by się nie stało", "cokolwiek by się stało"],
  ["co by się nie działo", "cokolwiek by się działo"],
  ["kto by nie był", "ktokolwiek by był"],
  ["kto by nie przyszedł", "ktokolwiek by przyszedł"],
  ["gdzie by nie był", "gdziekolwiek by był"],
  ["jak by nie było", ["jakkolwiek by było", "bądź co bądź"]],
  ["co by nie mówić", ["cokolwiek by mówić", "bądź co bądź"]],
  // "każdy jeden" is a calque: "każdy" says it.
  ...([
    ["każdy jeden", "każdy"],
    ["każda jedna", "każda"],
    ["każde jedno", "każde"],
    ["każdego jednego", "każdego"],
    ["każdej jednej", "każdej"],
    ["każdemu jednemu", "każdemu"],
    ["każdą jedną", "każdą"],
    ["każdym jednym", "każdym"],
  ] as PhraseRow[]),
  // "w przeciągu" is a draught; within a time span is "w ciągu".
  ...words(
    "dnia doby tygodnia miesiąca roku godziny minuty kwartału lat dni tygodni miesięcy godzin minut kilku kilkunastu dwóch trzech czterech pięciu ostatnich najbliższych ostatniego najbliższego całego pół",
  ).map((span): PhraseRow => [`w przeciągu ${span}`, `w ciągu ${span}`]),
  // "w temacie" is a calque: "na temat".
  ["w tym temacie", ["na ten temat", "w tej sprawie"]],
  ["w temacie", ["na temat", "w sprawie"]],
  ["kult dla", "kult"],
  ["kultu dla", "kultu"],
  ["lekceważenie dla", "lekceważenie"],
  ["lekceważenia dla", "lekceważenia"],
  // "kliknij podwójnie" is "kliknij dwukrotnie".
  ...words("kliknij kliknąć kliknięcie klikamy klika kliknął kliknęła").flatMap(
    (verb): PhraseRow[] => [
      [`${verb} podwójnie`, `${verb} dwukrotnie`],
      [`podwójnie ${verb}`, `${verb} dwukrotnie`],
    ],
  ),
  // "być w posiadaniu" is officialese for "mieć".
  ...([
    ["jestem w posiadaniu", "mam"],
    ["jesteś w posiadaniu", "masz"],
    ["jest w posiadaniu", "ma"],
    ["jesteśmy w posiadaniu", "mamy"],
    ["są w posiadaniu", "mają"],
    ["byłem w posiadaniu", "miałem"],
    ["byłam w posiadaniu", "miałam"],
    ["był w posiadaniu", "miał"],
    ["była w posiadaniu", "miała"],
    ["byli w posiadaniu", "mieli"],
    ["być w posiadaniu", "mieć"],
  ] as PhraseRow[]),
  // "uczynić szczęśliwym" is "uszczęśliwić".
  ...([
    ["uczynić szczęśliwym", "uszczęśliwić"],
    ["uczyniło mnie szczęśliwym", "uszczęśliwiło mnie"],
    ["uczyniło mnie szczęśliwą", "uszczęśliwiło mnie"],
    ["uczynił ją szczęśliwą", "uszczęśliwił ją"],
    ["uczyniła go szczęśliwym", "uszczęśliwiła go"],
  ] as PhraseRow[]),
  // "mimo tego, że" is wordy for "mimo że".
  ["pomimo tego, że", "mimo że"],
  ["mimo tego, że", "mimo że"],
  ["pomimo tego że", "mimo że"],
  ["mimo tego że", "mimo że"],
  // "w bliskiej odległości" pairs two ideas of near: "w niewielkiej odległości" or "blisko".
  ["w bliskiej odległości od", ["w niewielkiej odległości od", "blisko"]],
  ["w bliskiej odległości", ["w niewielkiej odległości", "blisko"]],
  // "uczynić możliwym" is "umożliwić"; "uczynić niemożliwym" is "uniemożliwić".
  ...(
    [
      ["uczynić", "umożliwić", "uniemożliwić"],
      ["uczyni", "umożliwi", "uniemożliwi"],
      ["uczynił", "umożliwił", "uniemożliwił"],
      ["uczyniła", "umożliwiła", "uniemożliwiła"],
      ["uczyniło", "umożliwiło", "uniemożliwiło"],
      ["uczynili", "umożliwili", "uniemożliwili"],
      ["uczyniły", "umożliwiły", "uniemożliwiły"],
      ["czyni", "umożliwia", "uniemożliwia"],
    ] as const
  ).flatMap(([verb, enable, prevent]): PhraseRow[] => [
    [`${verb} możliwym`, enable],
    [`${verb} niemożliwym`, prevent],
  ]),
  // "poddać w wątpliwość" blends "podać w wątpliwość" and "poddać w wątpliwość" is the error.
  ...(
    [
      ["poddać", "podać"],
      ["poddawać", "podawać"],
      ["poddał", "podał"],
      ["poddała", "podała"],
      ["poddali", "podali"],
      ["poddawał", "podawał"],
      ["poddawała", "podawała"],
      ["poddawali", "podawali"],
      ["poddaje", "podaje"],
      ["poddają", "podają"],
      ["poddam", "podam"],
      ["podda", "poda"],
    ] as const
  ).flatMap(([verb, fixed]): PhraseRow[] => [
    [`${verb} w wątpliwość`, `${fixed} w wątpliwość`],
    ...words("to tego go ją je wyrok decyzję tezę").map((object): PhraseRow => [
      `${verb} ${object} w wątpliwość`,
      `${fixed} ${object} w wątpliwość`,
    ]),
  ]),
  // Prices are low or high, not cheap or dear; turnout is large or small, not high or low.
  ...(
    [
      ["tani", "niski", "cen"],
      ["tańszy", "niższy", "cen"],
      ["najtańszy", "najniższy", "cen"],
      ["drogi", "wysoki", "cen"],
      ["droższy", "wyższy", "cen"],
      ["najdroższy", "najwyższy", "cen"],
      ["wysoki", "duży", "frekwencj"],
      ["niski", "mały", "frekwencj"],
    ] as const
  ).flatMap(([adjective, fixed, noun]): PhraseRow[] => {
    // [adjective ending, noun ending] pairs that agree (feminine singular and plural).
    const pairs =
      noun === "cen"
        ? [
            ["a", "a"],
            ["ej", "y"],
            ["ą", "ę"],
            ["ą", "ą"],
            ["e", "y"],
            ["ych", ""],
            ["ych", "ach"],
            ["ymi", "ami"],
          ]
        : [
            ["a", "a"],
            ["ej", "i"],
            ["ą", "ę"],
            ["ą", "ą"],
          ];
    const form = (lemma: string, ending: string) =>
      /[kg]i$/.test(lemma)
        ? lemma.slice(0, -1) +
          (ending.startsWith("y")
            ? `i${ending.slice(1)}`
            : ending.startsWith("e")
              ? `i${ending}`
              : ending)
        : lemma.endsWith("i")
          ? lemma + (ending.startsWith("y") ? ending.slice(1) : ending)
          : lemma.slice(0, -1) + ending;
    return pairs.map(([a, n]): PhraseRow => [
      `${form(adjective, a)} ${noun}${n}`,
      `${form(fixed, a)} ${noun}${n}`,
    ]);
  }),
  // "ubrać" dresses a person; clothes are put on: "włożyć buty".
  ...(
    [
      ["ubrać", "włożyć"],
      ["ubrał", "włożył"],
      ["ubrała", "włożyła"],
      ["ubrali", "włożyli"],
      ["ubrały", "włożyły"],
      ["ubiorę", "włożę"],
      ["ubierze", "włoży"],
      ["ubieram", "wkładam"],
      ["ubiera", "wkłada"],
      ["ubierać", "wkładać"],
      ["ubrałem", "włożyłem"],
      ["ubrałam", "włożyłam"],
    ] as const
  ).flatMap(([verb, fixed]): PhraseRow[] =>
    words("buty płaszcz kurtkę czapkę sweter spodnie sukienkę koszulę rękawiczki golf szalik").map(
      (garment): PhraseRow => [`${verb} ${garment}`, `${fixed} ${garment}`],
    ),
  ),
  // Officialese and calques with a plainer standard phrase.
  ["za wyjątkiem", "z wyjątkiem"],
  ["pod rząd", "z rzędu"],
  ["w oparciu o", "na podstawie"],
  ["za każdą cenę", "za wszelką cenę"],
  ["przy udziale", "z udziałem"],
  ["w nawiązaniu do", "nawiązując do"],
  ...words(
    "lat wieków miesięcy dekad tygodni dni stuleci roku tygodnia miesiąca ostatnich kilku kilkunastu",
  ).map((span): PhraseRow => [`na przestrzeni ${span}`, `w ciągu ${span}`]),
  // A mistake is made ("popełnić"), not performed ("dokonać").
  ...([
    ["dokonać błędu", "popełnić błąd"],
    ["dokonał błędu", "popełnił błąd"],
    ["dokonała błędu", "popełniła błąd"],
    ["dokonali błędu", "popełnili błąd"],
    ["dokonały błędu", "popełniły błąd"],
  ] as PhraseRow[]),
];

/** Set phrases with a wrong word, preposition or form: never correct as typed. */
export const PHRASES: readonly PhraseRow[] = [
  ["w woli ścisłości", "gwoli ścisłości"],
  ["nie ulega kwestii", ["nie ulega wątpliwości", "nie podlega dyskusji"]],
  ["wszem i wobec", "wszem wobec"],
  ["tak albo inaczej", "tak czy inaczej"],
  ["tak albo owak", "tak czy owak"],
  ["na szczerym polu", "w szczerym polu"],
  ["bogiem a prawda", "Bogiem a prawdą"],
  ...words("stanął stanęła stanęło stanęli stanęły staje stają stanąć stanie").map(
    (verb): PhraseRow => [`${verb} dębem`, `${verb} dęba`],
  ),
  ["puszka z Pandorą", "puszka Pandory"],
  ["puszkę z Pandorą", "puszkę Pandory"],
  ["puszki z Pandorą", "puszki Pandory"],
  ["kropla dziegciu", "łyżka dziegciu"],
  ["kroplą dziegciu", "łyżką dziegciu"],
  ["kroplę dziegciu", "łyżkę dziegciu"],
  ...words("połknąć połknąłem połknęłam połknął połknęła połknęli połknąłeś").map(
    (verb): PhraseRow => [`${verb} bakcyl`, `${verb} bakcyla`],
  ),
  // A role is played, a meaning is had: "odgrywa znaczenie" blends the two.
  ...words(
    "odgrywać odgrywa odgrywają odgrywał odgrywała odgrywało odgrywały odgrywali odegrać odegra odegrają odegrał odegrała odegrało odegrały odegrali",
  ).flatMap((verb): PhraseRow[] => [
    [`${verb} znaczenie`, `${verb} rolę`],
    ...(
      [
        ["duże", "dużą"],
        ["ważne", "ważną"],
        ["istotne", "istotną"],
        ["kluczowe", "kluczową"],
        ["ogromne", "ogromną"],
        ["wielkie", "wielką"],
        ["znaczące", "znaczącą"],
        ["decydujące", "decydującą"],
        ["szczególne", "szczególną"],
      ] as const
    ).map(([adj, fem]): PhraseRow => [`${verb} ${adj} znaczenie`, `${verb} ${fem} rolę`]),
  ]),
  // Latin and French loans in their own spelling.
  ["sensu stricte", "sensu stricto"],
  ["at hoc", "ad hoc"],
  ["ad hock", "ad hoc"],
  ["ex equo", "ex aequo"],
  ["de fakto", "de facto"],
  ["wice wersa", "vice versa"],
  ["a propos", "à propos"],
  ["á propos", "à propos"],
  ["a la carte", "à la carte"],
  // "wiórki" (shavings) is plural: "wiórków kokosowych", not the singular "wiórka".
  ["wiórka kokosowe", "wiórki kokosowe"],
  ["wiórek kokosowych", "wiórków kokosowych"],
  ["języczek uwagi", "języczek u wagi"],
  ["języczkiem uwagi", "języczkiem u wagi"],
  ["języczka uwagi", "języczka u wagi"],
  ["nerwy na postronku", "nerwy na wodzy"],
  ["nerwów na postronku", "nerwów na wodzy"],
  ...words("przyprzeć przyparł przyparła przyparli przyparty przyparta przyparci").map(
    (verb): PhraseRow => [`${verb} do ściany`, `${verb} do muru`],
  ),
  ["mówi samo przez się", "mówi samo za siebie"],
  ["mówią same przez się", "mówią same za siebie"],
  ["inna strona medalu", ["druga strona medalu", "odwrotna strona medalu"]],
  ["innej stronie medalu", ["drugiej stronie medalu", "odwrotnej stronie medalu"]],
  ["inną stronę medalu", ["drugą stronę medalu", "odwrotną stronę medalu"]],
  ["mądrej głowie dość po słowie", "mądrej głowie dość dwie słowie"],
  ["konstrukcja cepu", "konstrukcja cepa"],
  ["konstrukcji cepu", "konstrukcji cepa"],
  ["serce wali jak młot", "serce wali jak młotem"],
  ["serce waliło jak młot", "serce waliło jak młotem"],
  // "rozchodzić się" is to disperse; "it is about" is "chodzi o".
  ...words("rozchodzi rozchodziło rozchodziłoby rozchodzić").flatMap((verb): PhraseRow[] => {
    const plain = verb.slice(3);
    return [
      [`${verb} się o`, `${plain} o`],
      ...words("mi ci mu jej nam wam im").map((pronoun): PhraseRow => [
        `${verb} ${pronoun} się o`,
        `${plain} ${pronoun} o`,
      ]),
    ];
  }),
  ["na wskutek", ["wskutek", "na skutek"]],
  ["do dziś dzień", "po dziś dzień"],
  ["w przeciwnym bądź razie", "w przeciwnym razie"],
  ["sprzed laty", ["przed laty", "sprzed lat"]],
  ["w pośrodku", "pośrodku"],
  ["ilekroć razy", "ilekroć"],
  ["po pierwsze primo", "po pierwsze"],
  ["domyśleć się", "domyślić się"],
  ["się domyśleć", "się domyślić"],
  ["dopatrzeć się", "dopatrzyć się"],
  ["się dopatrzeć", "się dopatrzyć"],
  // One resists by "stawić opór"; "postawić" is to put something somewhere.
  ...words("postawić postawił postawiła postawili postawiły postawi postawią").map(
    (verb): PhraseRow => [`${verb} opór`, `${verb.slice(2)} opór`],
  ),
  // Something borders on ("zakrawa na") a scandal.
  ...words("zakrawa zakrawało zakrawać zakrawają zakrawał zakrawała").map((verb): PhraseRow => [
    `${verb} o`,
    `${verb} na`,
  ]),
];

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
  `(?<![\\p{L}\\p{N}_'’-])(?<numeral>${Object.keys(OR_MORE_CASE).join("|")})[ \\t\\u00a0]{1,8}lub[ \\t\\u00a0]{1,8}więcej(?<words>(?:[ \\t\\u00a0]{1,8}\\p{Ll}+){0,3})(?![\\p{L}\\p{N}_'’-])`,
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

export const DETECTORS = [
  {
    rules: ["stylePhrasing"] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) && (!ctx.rules || ctx.rules.has("stylePhrasing"))
        ? [...orMore(ctx), ...verbChoices(ctx)]
        : [],
  },
];

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
};
const GARMENTS =
  "płaszcz|kurtkę|sweter|golf|koszulę|bluzkę|sukienkę|spodnie|dżinsy|buty|kozaki|czapkę|kapelusz|rękawiczki|szalik|garnitur|marynarkę|spódnicę|skarpetki|piżamę|kamizelkę|koszulkę|płaszczyk|kurtkę|kalosze";
const FEATURES =
  "brodę|wąsy|oczy|włosy|nos|uszy|zęby|wymiary|wzrost|talent|zdolności|poczucie|cierpliwość|odwagę|charakter|temperament|rodzinę|dzieci|rodzeństwo|siostrę|brata|braci|siostry|córkę|syna|przyjaciół|czas|ochotę|pomysł|pomysły|nadzieję|wątpliwości|problem|problemy|wadę|wady|zalety|kota|psa";
/** Words that may stand between the verb and its noun: a pronoun, an adverb, adjectives. */
const FILLER = `(?:${S}(?:on|ona|ono|oni|one|nadal|wciąż|też|także|również|zawsze|często|naprawdę|bardzo|niezwykle|wyjątkowo|szczególnie|dość|coraz|swoją|swój|swoje|jakąś|żadnej|(?:w|we|na|dla|przy|wśród|u)${S}\\p{Ll}+|\\p{Ll}+(?:ną|ową|ską|cką|ką|ą|ej|e|y|ie))){0,3}`;
const ROLE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?:(?<verb>${Object.keys(PLAYS).join("|")})(?<mid>${FILLER})${S}(?<noun>rolę|roli)|(?<before>rolę|roli)${S}(?<after>${Object.keys(PLAYS).join("|")}))(?![\\p{L}\\p{N}_'’-])`,
  "giu",
);
const PUT_ON = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>${Object.keys(PUTS_ON).join("|")})(?<mid>${FILLER})${S}(?<noun>${GARMENTS})(?![\\p{L}\\p{N}_'’-])`,
  "giu",
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
  for (const m of owned(ctx, POSSESS)) {
    const { verb, mid, noun } = m.groups!;
    push(m.index, m.index + m[0].length, [`${HAS[verb.toLowerCase()]}${mid} ${noun}`]);
  }
  return findings;
}
