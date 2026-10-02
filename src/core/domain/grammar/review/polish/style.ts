import type { PhraseRow } from "../englishPhraseTables";

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
  // "pełnić" goes with a function; a role is played ("odgrywać rolę").
  ...(
    [
      ["pełni", "odgrywa"],
      ["pełnią", "odgrywają"],
      ["pełnił", "odgrywał"],
      ["pełniła", "odgrywała"],
      ["pełniło", "odgrywało"],
      ["pełnili", "odgrywali"],
      ["pełniły", "odgrywały"],
      ["pełnić", "odgrywać"],
      ["pełniący", "odgrywający"],
      ["pełniąca", "odgrywająca"],
      ["pełniące", "odgrywające"],
      ["spełnia", "odgrywa"],
      ["spełniać", "odgrywać"],
      ["spełniając", "odgrywając"],
    ] as const
  ).flatMap(([verb, plays]): PhraseRow[] => [
    [`${verb} rolę`, [`${verb} funkcję`, `${plays} rolę`]],
    [`${verb} ważną rolę`, [`${verb} ważną funkcję`, `${plays} ważną rolę`]],
    [`${verb} istotną rolę`, [`${verb} istotną funkcję`, `${plays} istotną rolę`]],
    [`${verb} swoją rolę`, [`${verb} swoją funkcję`, `${plays} swoją rolę`]],
  ]),
  // "dwie lub więcej godzin" mixes two governments: "co najmniej dwie".
  ...words(
    "dwa dwie dwóch dwom dwóm dwoma trzy trzech trzem trzema cztery czterech czterem czterema pięć pięciu",
  ).map((numeral): PhraseRow => [`${numeral} lub więcej`, `co najmniej ${numeral}`]),
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
];
