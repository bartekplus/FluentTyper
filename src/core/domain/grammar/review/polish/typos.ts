import type { PhraseRow } from "../englishPhraseTables";
import { rows } from "../phraseTemplates";
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
import {
  adjectiveRows,
  caseLike,
  CLAUSE_START,
  END,
  findingAt,
  type Frame,
  isPl,
  owned,
  runFrames,
  S,
  sentenceStartAt,
  userOrNamed,
} from "./shared";

/*
 * Real-word slips: a dictionary word typed for its look-alike ("szkody średniej" for
 * "szkoły"), a word cut short ("coraz lepie") or a lost or doubled small word. Each frame
 * names the neighbour that only the intended word fits.
 */

const words = (list: string) => list.split(" ");

/** Forms that are no Polish words, whatever their neighbours. */
export const WORDS: readonly PhraseRow[] = [
  ["struj", "strój"],
  ["pryz", "przy"],
  ["koniczność", "konieczność"],
  ...adjectiveRows("koniczn", "konieczn"),
  ...words("drzem drzemu drzemem drzemy drzemów").map((form): PhraseRow => [
    form,
    `dżem${form.slice(5)}`,
  ]),
  ...words("sytem sytemu sytemie sytemy sytemów").map((form): PhraseRow => [
    form,
    `system${form.slice(5)}`,
  ]),
  // "rozpatrzać" is no verb: "rozpatrywać" (or the perfective "rozpatrzyć").
  ["rozpatrzać", "rozpatrywać"],
  ["rozpatrza", "rozpatruje"],
  ["rozpatrzają", "rozpatrują"],
  ["rozpatrzał", ["rozpatrywał", "rozpatrzył"]],
  ...adjectiveRows("spóln", "wspóln"),
  ["rozpatrzała", ["rozpatrywała", "rozpatrzyła"]],
];

/** Word pairs where the typed form is never right. */
export const PHRASES: readonly PhraseRow[] = [
  ["półwieku temu", "pół wieku temu"],
  // "byłoby" split into "był" and the wish "oby" or the letters "o by".
  ...rows(`
był oby = byłoby
był o by = byłoby
nie jetem = nie jestem
od dawana = od dawna
do niedawana = do niedawna
od niedawana = od niedawna
ku ucieszy = ku uciesze
w razie pytać = w razie pytań
na papieże = na papierze
w tak sposób = w taki sposób
po prost = po prostu
po kątem = pod kątem
tan naprawdę = tak naprawdę
nie wolo = nie wolno
w zgodnie z = zgodnie z; w zgodzie z
za maż = za mąż
z dania na dzień = z dnia na dzień
że względu na = ze względu na
sadzę, że = sądzę, że
sadzę że = sądzę że
nie sadzę = nie sądzę
wydaja się = wydają się
ja się okazuje = jak się okazuje
ja się wydaje = jak się wydaje
wszech rzeczy = wszechrzeczy
dla czemu = dlaczego
dlaczego czy = dlaczego; czy
co by się stały = co by się stało
obroną ręką = obronną ręką
dopóty, dopóty = dopóty, dopóki
w odróżnieniu, do = w odróżnieniu od
blade pojecie = blade pojęcie
mgliste pojecie = mgliste pojęcie
składa członkowska = składka członkowska
składę członkowską = składkę członkowską
na wzdłuż = wzdłuż
w pośród = pośród
na całym świcie = na całym świecie
po całym świcie = po całym świecie
`),
  ...([
    ...rows(`
jazda kona = jazda konna
jazdy konej = jazdy konnej
jazdę koną = jazdę konną
jazdą koną = jazdą konną
jeździe konej = jeździe konnej
błąd litrowy = błąd literowy
błędu litrowego = błędu literowego
błędy litrowe = błędy literowe
błędów litrowych = błędów literowych
pozycji lezącej = pozycji leżącej
pozycja leząca = pozycja leżąca
pozycję lezącą = pozycję leżącą
miejsce zamieszania = miejsce zamieszkania
miejsca zamieszania = miejsca zamieszkania
miejscu zamieszania = miejscu zamieszkania
adres zamieszania = adres zamieszkania
wiórki koksowe = wiórki kokosowe
wiórków koksowych = wiórków kokosowych
wiórkami koksowymi = wiórkami kokosowymi
mleko koksowe = mleko kokosowe
mleczko koksowe = mleczko kokosowe
`),
  ] satisfies PhraseRow[]),
  ...words("tyle mało dużo więcej mniej trochę brak").map((amount): PhraseRow => [
    `${amount} czasy`,
    `${amount} czasu`,
  ]),
  ...([
    ...rows(`
strona internatowa = strona internetowa
strony internatowej = strony internetowej
stronę internatową = stronę internetową
stronie internatowej = stronie internetowej
mas media = mass media
mas mediów = mass mediów
mas mediami = mass mediami
mas mediach = mass mediach
`),
  ] satisfies PhraseRow[]),
  // "pół godziny": "pól" is the genitive plural of "pole" (fields).
  ...words("godziny roku litra kilo minuty miesiąca dnia wieku metra tony etatu").map(
    (span): PhraseRow => [`pól ${span}`, `pół ${span}`],
  ),
  ...words("golfowych ryżowych minowych bitewnych naftowych").map((kind): PhraseRow => [
    `pół ${kind}`,
    `pól ${kind}`,
  ]),
  // "szkoła średnia": "szkoda" is damage.
  ...(
    [
      ["szkoda", "szkoła", "a"],
      ["szkody", "szkoły", "ej"],
      ["szkodę", "szkołę", "ą"],
      ["szkodzie", "szkole", "ej"],
      ["szkodą", "szkołą", "ą"],
    ] as const
  ).flatMap(([typed, fixed, ending]) =>
    ["średni", "podstawow"].map((kind): PhraseRow => {
      const adj = `${kind}${ending}`;
      return [`${typed} ${adj}`, `${fixed} ${adj}`];
    }),
  ),
  // "z tego powodu": "powody" is the plural.
  ...["", "tego ", "jakiego ", "innego ", "tego samego ", "jakiegoś ", "żadnego "].map(
    (det): PhraseRow => [`z ${det}powody`, `z ${det}powodu`],
  ),
  ...words("tego tamtego całego danego ostatniego").map((det): PhraseRow => [
    `${det} okresy`,
    `${det} okresu`,
  ]),
  // A cookie cutter cuts ("wykrawacz"); a metal detector detects ("wykrywacz").
  ...words("wykrywacz wykrywacza wykrywacze wykrywaczem wykrywaczy").flatMap((tool) =>
    ["do ciastek", "do ciasta"].map((use): PhraseRow => [
      `${tool} ${use}`,
      `wykrawacz${tool.slice(9)} ${use}`,
    ]),
  ),
  ...words("wykrawacz wykrawacza wykrawacze wykrawaczem").flatMap((tool) =>
    ["metali", "min"].map((use): PhraseRow => [
      `${tool} ${use}`,
      `wykrywacz${tool.slice(9)} ${use}`,
    ]),
  ),
];

const RULE = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
} as const;
/** The typed word starts with a capital: a name or a title, not the slip. */
const lower = (fix: string) => (m: RegExpExecArray) =>
  /^\p{Lu}/u.test(m.groups!.target) ? null : fix;
const NEXT_WORD = `(?=${S}\\p{L})`;
const CLAUSE_END = "(?=[ \\t\\u00a0]*(?:[.!?,;]|$))";

const FRAMES: readonly Frame[] = [
  // "prze" alone is only the verb "przeć" (push on), which takes no adjective and no "siebie":
  // "prze piękny" -> "przepiękny", "prze siebie" -> "przed siebie", "prze ze mnie" -> "przeze".
  {
    pattern: `(?<target>prze${S}(?<word>\\p{L}{3,}))${END}`,
    fix: (m) => {
      const word = m.groups!.word;
      if (word !== word.toLowerCase()) return null;
      if (word === "siebie") return ["przed siebie", "przez siebie"];
      if (word === "zemnie") return "przeze mnie";
      const adjective = adjectiveOf(word);
      return adjective && !ambiguousAdjective(word) && adjective.ending !== "ą"
        ? `prze${word}`
        : null;
    },
    ...RULE,
  },
  {
    pattern: `(?<target>prze${S}ze)(?=${S}mnie${END})`,
    fix: "przeze",
    ...RULE,
  },
  // "wzdłuż polnej drużki" -> "dróżki": a path ("dróżka"), not a bridesmaid ("drużka").
  {
    pattern: `(?=drużk)(?<=(?:^|[^\\p{L}])(?:wzdłuż|poln|leśn|wąsk|błotnist|kamienist|kręt|piaszczyst|wydeptan|górsk)\\p{L}{0,3}${S})(?<target>drużk(?<end>a|i|ę|ą|ce|ami|om|ach))${END}`,
    fix: (m) => `dróżk${m.groups!.end}`,
    ...RULE,
  },
  // "dwóch wierz", "oprócz wierz" -> "wież": the genitive plural of "wieża", not "wierz" (believe).
  {
    pattern: `(?=wierz)(?<=(?:^|[^\\p{L}])(?:dwóch|dwu|trzech|czterech|pięciu|sześciu|kilku|kilkunastu|kilkudziesięciu|wielu|paru|oprócz|spośród|wśród)${S})(?<target>wierz)${END}`,
    fix: "wież",
    ...RULE,
  },
  // "kity do podług" -> "podłóg" (floors): no preposition stands after "do".
  {
    pattern: `(?=podług)(?<=(?:^|[^\\p{L}])(?:do|dla|kilku|wielu|dwóch|trzech|czterech|pięciu)${S})(?<target>podług)${END}`,
    fix: "podłóg",
    ...RULE,
  },
  // "ciszej nisz przednie" -> "niż": a comparison ("-ej", "-szy"), not niches.
  {
    pattern: `(?=nisz)(?<=(?:^|[^\\p{L}])(?:\\p{L}{2,16}ej|\\p{L}{1,14}sz[yae])${S})(?<target>nisz)${END}`,
    fix: "niż",
    ...RULE,
  },
  // "Skłam serdeczne życzenia" -> "Składam".
  {
    pattern: `(?<target>skłamy?)(?=(?:${S}\\p{L}{3,20}(?:e|ie)){1,2}${S}życzenia${END})`,
    fix: (m) => (m.groups!.target.length === 6 ? "składamy" : "składam"),
    ...RULE,
  },
  // "tam i z potworem" -> "tam i z powrotem".
  {
    pattern: `(?<target>potworem)(?<=(?:^|[^\\p{L}])(?:tam|tu|do${S}\\p{L}{2,20}(?:${S}\\p{L}{2,20})?)${S}i${S}z${S}potworem)${CLAUSE_END}`,
    fix: "powrotem",
    ...RULE,
  },
  // "podlegać ocenie" (dative); "podlać" waters something.
  {
    pattern: `(?<target>podleją|podleje)(?=${S}(?:ocenie|kontroli|opodatkowaniu|zmianie|zmianom|karze|regulacji|ochronie|przepisom|ustawie|weryfikacji|likwidacji|wymianie)${END})|(?<=(?:^|[^\\p{L}])(?:temu|czemu)${S})(?<target>podleją|podleje)${END}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "podleją" ? "podlegają" : "podlega"),
    ...RULE,
  },
  // "nie mieć nic wspólnego": "noc" (night) is a slip.
  {
    pattern: `(?<target>noc)(?=${S}wspólnego(?:${S}z${END}|[ \\t\\u00a0]*[.!?,;]))`,
    fix: "nic",
    ...RULE,
  },
  // "pół szklanki wody": "szklani" are glass men.
  {
    pattern: `(?<target>szklani)(?=${S}(?:wody|wrzątku|mleka|soku|herbaty|cukru|mąki|wina|piwa|kawy|kefiru|śmietany|oleju|ryżu|kaszy)${END})`,
    fix: "szklanki",
    ...RULE,
  },
  // "bardziej" cut short after a degree word or before an adverb; "o bardzie" is a bard.
  {
    pattern: `(?<target>bardzie)${END}(?:(?<=(?:^|[^\\p{L}])(?:im|a|coraz|jeszcze|dużo|znacznie|nieco|trochę|wiele|zdecydowanie)${S}bardzie)|(?=${S}(?:\\p{L}{3,20}(?:nie|wo|ko)|niż)${END}))`,
    fix: "bardziej",
    ...RULE,
  },
  // "u stóp góry": "stup" is the plural genitive of "stupa".
  {
    pattern: `(?<target>stup)(?=${S}(?:góry|gór|wzgórza|zapory|schodów|łóżka|ołtarza|tronu|pomnika|zamku)${END})`,
    fix: "stóp",
    ...RULE,
  },
  // "coraz lepie", "jeszcze wyże": a comparative adverb that lost its "-j".
  {
    pattern: `(?<target>lepie|wyże|niże|gorze|bliże|częście|szybcie|dłuże)${END}(?<=(?:^|[^\\p{L}])(?:coraz|jeszcze|znacznie|dużo|nieco|trochę|zdecydowanie|wiele|daleko)${S}\\p{L}{4,7})`,
    fix: (m) => `${m.groups!.target}j`,
    ...RULE,
  },
  // "coraz skutecznej." -> "skuteczniej": after "coraz", a clause-final word is an adverb.
  {
    pattern: `(?<target>\\p{L}{2,20}nej)${CLAUSE_END}(?<=(?:^|[^\\p{L}])coraz${S}\\p{L}{5,23})`,
    fix: (m) => `${m.groups!.target.slice(0, -3)}niej`,
    ...RULE,
  },
  // "w przededniu wyborów" is the only use of "przededniu" (with a genitive after it).
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|jej|jego|ich|tego|tym|swoim|owym)${S})(?<target>przededniu)(?=${S}(?:\\p{L}{1,20}(?:ów|ych|ich|ego|ej|y|i|a|u)|świąt)${END})`,
    fix: "w przededniu",
    ...RULE,
  },
  // "na podstawie danych": the preposition is part of the phrase.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:na|o|w|przy|po|ku|się|tej|jej|tylko|samej|solidnej|mocnej)${S})(?<target>podstawie)(?=${S}(?:danych|informacji|umowy|ustawy|art|artykułu|przepisów|wyników|badań|analizy|decyzji|dokumentów|faktury|wniosku|opinii|zaświadczenia|orzeczenia|uchwały|porozumienia)${END})`,
    fix: "na podstawie",
    ...RULE,
  },
  // "niezbyt dobrze": "niebyt" is nonexistence.
  {
    pattern: `(?<target>niebyt)(?=${S}(?:dobrze|dobry|dobra|dobre|dużo|duży|duża|duże|wiele|często|długo|chętnie|mądrze|mądry|ładnie|jasno|jasne|pewnie|pewny|daleko|blisko|szybko|wysoko|wysoki|zadowolony|zadowolona|zadowoleni|zdrowy|zdrowo|udany|udana|udane|miło|miły|wygodnie|wygodny|łatwo|łatwy|łatwe|trudny|trudno|ciekawy|ciekawe|ciekawie)${END})`,
    fix: "niezbyt",
    ...RULE,
  },
  // "Nagroda Główna", "Dworzec Główny": the capital names the institution.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:Nagroda|Nagrodę|Nagrody|Nagrodą|Komenda|Komendy|Komendzie|Komendę|Biblioteka|Biblioteki|Bibliotece|Księgowa|Księgowej|Kwatera|Kwatery|Rada|Rady|Radzie|Poczta|Poczty|Poczcie|Dworzec|Dworca|Dworcu|Urząd|Urzędu|Urzędzie|Inspektorat|Inspektoratu|Sztab|Sztabu|Rynek|Rynku)${S})(?<target>Gówn(?:a|ej|ą|ę|y|ego|ym|emu))${END}`,
    fix: (m) => (/^G/u.test(m.groups!.target) ? `Główn${m.groups!.target.slice(4)}` : null),
    ...RULE,
    verbatim: true,
  },
  // "ogólne informacje": "w ogóle" keeps "ogóle".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|we)${S})(?<target>ogóle)(?=${S}(?:informacje|zasady|warunki|przepisy|uwagi|wiadomości|pojęcia|wytyczne|założenia|dane|kryteria|cechy|wymagania|postanowienia)${END})`,
    fix: "ogólne",
    ...RULE,
  },
  // "jedna rzecz": lowercase "jena" is no word ("Jena" is a town).
  {
    pattern: `(?<target>jena)(?=${S}(?:rzecz|osoba|sprawa|strona|część|kobieta|noc|chwila|godzina|minuta|książka|odpowiedź|myśl|droga|szansa|z)${END})`,
    fix: lower("jedna"),
    ...RULE,
  },
  // "o tej porze": "potrze" is a verb ("rub").
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:o|tej|każdej|dowolnej|późnej|wczesnej|nocnej|samej|innej|jakiej)${S})(?<target>potrze)${END}`,
    fix: "porze",
    ...RULE,
  },
  // "popełnić literówkę": "litrówka" is a litre bottle.
  {
    pattern: `(?<target>litrówk\\p{L}{0,3})(?<=(?:^|[^\\p{L}])popełni\\p{L}{0,6}${S}(?:\\p{L}{2,12}${S})?litrówk\\p{L}{0,3})${END}`,
    fix: (m) => `literówk${m.groups!.target.slice(7)}`,
    ...RULE,
  },
  // "boja się o" (a buoy) -> "boję się", "boją się".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:nie|się)${S})(?<target>boja)(?=${S}się(?:${S}(?:o|że|tego|go|jej|ich|mnie|ciebie|was|nas|ją|ludzi)${END}|,${S}że${END}))`,
    fix: ["boję", "boją"],
    ...RULE,
  },
  // "ludzie lubią": "lubą" is the instrumental of "luba" (sweetheart).
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:nie|oni|one|ludzie|wszyscy|dzieci|którzy|które)${S})(?<target>lubą)${END}`,
    fix: "lubią",
    ...RULE,
  },
  // A nursery is "żłobek" ("żłobka"); the crib in Bethlehem is "żłóbek".
  {
    pattern: `(?<target>żłóbk(?:a|u|iem|i|ach|ów))(?=${S}(?:przyzakładow|miejsk|publiczn|prywatn|gminn|integracyjn|państwow)\\p{L}{1,4}${END})`,
    fix: (m) => `żłobk${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  {
    pattern: `(?<target>żłobk(?:a|u|iem|ach))(?=${S}betlejemsk\\p{L}{1,4}${END})`,
    fix: (m) => `żłóbk${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  // "zmysł wzroku": "wzorek" is a pattern.
  {
    pattern: `(?<target>wzorku)${END}(?<=(?:^|[^\\p{L}])(?:zmysł\\p{L}{0,3}|narząd\\p{L}{0,3}|ostrość|ostrości|utrat\\p{L}{1,2}|zaburzeni\\p{L}{1,3}|badani\\p{L}{1,3}|kontakt\\p{L}{0,3})${S}wzorku)`,
    fix: "wzroku",
    ...RULE,
  },
  // "przedstawić zarzuty": "przestawić" moves something.
  {
    pattern: `(?<target>przestawi(?:ono|ł|ła|li|ć|a|ają|any|ane|one))(?=(?:${S}\\p{L}{2,15}){0,2}${S}zarzut\\p{L}{0,3}${END})|(?<target>przestawi(?:ono|ł|ła|li))${END}(?<=(?:^|[^\\p{L}])zarzut\\p{L}{0,3}(?:${S}\\p{L}{2,15})?${S}przestawi\\p{L}{1,3})`,
    fix: (m) => `przed${m.groups!.target.slice(4)}`,
    ...RULE,
  },
  // "podrapał si po głowie" -> "się" after a past form or an infinitive.
  {
    pattern: `(?<target>si)(?=${S}(?!(?:bemol|dur|moll|krzyżyk)${END})\\p{L}|[ \\t\\u00a0]*[.,!?;])(?<=(?:^|[^\\p{L}])\\p{L}{2,20}(?:ł|ła|ło|li|ły|ać|ić|yć|eć|ąć)${S}si)`,
    fix: "się",
    ...RULE,
  },
  // "mamy naprawdę wiele": "naprawę" (a repair) before an intensified word.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:mamy|jest|są|to|był|była|było|byli|ale|bo|czy)${S})(?<target>naprawę)(?=${S}(?:wiele|dużo|bardzo|mało|super|świetn\\p{L}{1,3}|fajn\\p{L}{1,3}|dobr\\p{L}{1,3}|ciekaw\\p{L}{1,3}|trudn\\p{L}{1,3}|ważn\\p{L}{1,3}|nie)${END})`,
    fix: "naprawdę",
    ...RULE,
  },
  // "To mój prezent dal niego" -> "dla"; "w dal" is "into the distance".
  {
    pattern: `(?<!(?:^|[^\\p{L}])w${S})(?<target>dal)(?=${S}(?:niego|niej|nich|ciebie|siebie|nas|was|mnie|mamy|taty|dzieci)${END})`,
    fix: lower("dla"),
    ...RULE,
  },
  // "ściśle określone": the adverb, not the adjective "ścisły".
  {
    pattern: `(?<target>ścisł(?:e|y|a|ą|ym|ego|ej|i))(?=${S}(?:określon|związan|ustalon|zdefiniowan|wyznaczon|ograniczon|przestrzegan|regulowan|kontrolowan|tajn)\\p{L}{1,3}${END})`,
    fix: "ściśle",
    ...RULE,
  },
  // "różnych": "rożny" is the corner of a pitch ("rzut rożny").
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:rzut\\p{L}{0,3}|róg|rogu|kąt\\p{L}{0,3}|chorągiew\\p{L}{0,3}|chorągiewk\\p{L}{0,3})${S})(?<target>rożn(?:ych|ymi|ego|ej|ym))(?=${S}(?!rzut)\\p{L})`,
    fix: (m) => `różn${m.groups!.target.slice(4)}`,
    ...RULE,
  },
  // "stała się gwiazdą": "stałą" is an adjective form, not the past verb.
  {
    pattern: `(?<target>(?:stał|okazał|wydawał|zdawał)ą)(?=${S}się${S}\\p{L}{2,20}(?:ą|em|ym|im|ami)${END})`,
    fix: (m) => `${m.groups!.target.slice(0, -1)}a`,
    ...RULE,
  },
  // "Wiśniewski, alei" after "nie tylko": "ale i".
  {
    pattern: `(?<target>alei)(?<=nie${S}tylko[^.!?]{1,80},${S}alei)${NEXT_WORD}`,
    fix: "ale i",
    ...RULE,
  },
  // "Ta strona zawiera informacje": "zwierać" clenches.
  {
    pattern: `(?<target>zwiera(?:ją|ł|ła|ło|ły)?)(?=(?:${S}\\p{L}{2,15})?${S}(?:informacj\\p{L}{1,3}|dane|danych|treść|treści|tekst|opis|opisy|listę|wykaz|zbiór|instrukcj\\p{L}{1,3}|przepisy|zapisy)${END})`,
    fix: (m) => `zawiera${m.groups!.target.slice(6)}`,
    ...RULE,
  },
  // "miał zamiar": "miął" crumples.
  {
    pattern: `(?<target>miął)(?=${S}(?:zamiar|ochotę|nadzieję|rację|okazję|czas|problem|pecha|szczęście|być)${END})`,
    fix: "miał",
    ...RULE,
  },
  // "nadstawiać karku": "nastawiać" sets something.
  {
    pattern: `(?<target>nastawi\\p{L}{0,5})(?=(?:${S}\\p{L}{2,12}){0,3}${S}(?:karku|głowy|ucha|uszu)${END})`,
    fix: (m) => `nad${m.groups!.target.slice(2)}`,
    ...RULE,
  },
  // "wysoką rangę": the English "range" after a Polish adjective.
  {
    pattern: `(?<target>range)${END}(?<=\\p{L}{2,20}ą${S}range)`,
    fix: lower("rangę"),
    ...RULE,
  },
  // "znaczną część": "znaczą" is a verb ("they mean").
  {
    pattern: `(?<target>znaczą)(?=${S}(?:część|ilość|większość|liczbę|kwotę|sumę|poprawę|przewagę)${END})`,
    fix: "znaczną",
    ...RULE,
  },
  // "Nie oznacza to, że": "oznacz" is the imperative.
  {
    pattern: `(?<target>oznacz)(?=${S}to(?:${S}(?:jednak|wcale|jeszcze))?,?${S}że${END})`,
    fix: "oznacza",
    ...RULE,
  },
  // "Ministerstwo Zdrowia": "zdrowa" is the adjective.
  {
    pattern: `(?<target>zdrowa)${END}(?<=(?:^|[^\\p{L}])(?:ministerstw\\p{L}{0,3}|ministr\\p{L}{0,3}|ochron\\p{L}{0,2}|służb\\p{L}{0,2}|poradni\\p{L}{0,2}|ośrod\\p{L}{0,4}|centrum|fundusz\\p{L}{0,2})${S}zdrowa)`,
    fix: "zdrowia",
    ...RULE,
  },
  // "Powstanie Warszawskie": "postanie" means "will stand".
  {
    pattern: `(?<target>postanie)(?=${S}(?:warszawski|styczniow|listopadow|wielkopolski|śląski|kościuszkowski)\\p{L}{1,3}${END})`,
    fix: "powstanie",
    ...RULE,
  },
  // "do nich": the particle "niech" never follows a preposition.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:do|od|z|u|dla|bez|przez|na|o|po|za|przy|wśród|między|przed|nad|pod)${S})(?<target>niech)${END}`,
    fix: "nich",
    ...RULE,
  },
  // "pozwala sobie": "pozawalać" knocks things down.
  {
    pattern: `(?<target>pozawal\\p{L}{1,5})(?=${S}(?:sobie|mu|jej|im|nam|wam|mi|ci|na|to${S}na)${END})`,
    fix: (m) => `pozwal${m.groups!.target.slice(7)}`,
    ...RULE,
  },
  // "startować w wyborach": "stratować" tramples.
  {
    pattern: `(?<target>stratow\\p{L}{1,5})(?=${S}w${S}(?:wyborach|igrzyskach|zawodach|konkursie|maratonie|wyścigu|turnieju|mistrzostwach|olimpiadzie|plebiscycie)${END})`,
    fix: (m) => `start${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  // "ponieść straty": "starty" are starts.
  {
    pattern: `(?<target>starty)${END}(?<=(?:^|[^\\p{L}])(?:poni\\p{L}{1,5}|ponosi\\p{L}{0,3}|odrabia\\p{L}{0,3}|odrobi\\p{L}{0,3}|wyrówna\\p{L}{0,3})(?:${S}\\p{L}{2,15})?${S}starty)`,
    fix: "straty",
    ...RULE,
  },
  // "z naprzeciwka", "z przeciwka": the words exist only after "z".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:z|na|zna)${S})(?<target>naprzeciwka|przeciwka)${END}`,
    fix: (m) => `z ${m.groups!.target}`,
    ...RULE,
  },
  // "na czele": "czele" lives only in the phrase.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:na|w)(?:${S}\\p{L}{1,15}){0,2}${S})(?<target>czele)${END}`,
    fix: "na czele",
    ...RULE,
  },
  // "wespół z kimś", "wespół w zespół".
  {
    pattern: `(?<target>wespół)(?=${S}(?!(?:z|ze|w)${END})\\p{L}{0,20}(?:ą|em|iem|ami|mi|ymi|imi|kimś|nim|nią)${END})`,
    fix: "wespół z",
    ...RULE,
  },
  {
    pattern: `(?<target>wespół${S}w)(?=${S}\\p{L}{2,20}(?:ami|mi|ymi|imi)${END})`,
    fix: "wespół z",
    ...RULE,
  },
  {
    pattern: `(?<target>wespół${S}zespół)${END}`,
    fix: "wespół w zespół",
    ...RULE,
  },
  // "a w związku z tym": the phrase needs its "w".
  {
    pattern: `(?<=(?:(?:^|[^\\p{L}])(?:a|i|ale|lecz|więc|oraz)|[,;])${S})(?<target>związku)(?=${S}z${S}(?:tym|powyższym|czym)${END})`,
    fix: "w związku",
    ...RULE,
  },
  // "Ona dała mi": "z dala" (far off) is the only "dala".
  {
    pattern: `(?<!(?:^|[^\\p{L}])z${S})(?<target>dala)(?=${S}(?:mi|ci|mu|jej|nam|wam|im|go|ją|to|sobie)${END})`,
    fix: "dała",
    ...RULE,
  },
  // "odgrywać rolę": "ogrywać" beats someone at a game.
  {
    pattern: `(?<target>ogrywa\\p{L}{0,4})(?=(?:${S}\\p{L}{2,12}){0,2}${S}rol(?:ę|i)${END})`,
    fix: (m) => `od${m.groups!.target.slice(1)}`,
    ...RULE,
  },
  // "w swoim dorobku": "sowim" is an owl's.
  {
    pattern: `(?<target>sow(?:im|ich|imi|ej|ą|ego))(?=${S}(?:dorobku|książkach|książce|życiu|domu|pokoju|mieszkaniu|pracy|kraju|imieniu|zdaniu|rodzinie|dzieciach|rodzicach)${END})`,
    fix: (m) => `swo${m.groups!.target.slice(3)}`,
    ...RULE,
  },
  // "do zrobienia": a verbal noun after "do", not the virile participle.
  {
    pattern: `(?<=(?:^|[^\\p{L}])do${S})(?<target>\\p{L}{3,20}(?:eni|ani|ęci))${CLAUSE_END}`,
    fix: (m) => (/^\p{Lu}/u.test(m.groups!.target) ? null : `${m.groups!.target}a`),
    ...RULE,
  },
  // "w lutym 2015": "lity" means solid.
  {
    pattern: `(?<target>lit(?:y|ego|ym))(?=${S}\\d{4}${END})`,
    fix: (m) => `lut${m.groups!.target.slice(3)}`,
    ...RULE,
  },
  // "policyjne statystyki": "statystki" are film extras.
  {
    pattern: `(?<target>statystk(?:i|ach|ami|om)?)${END}(?<=(?:(?:policyjn|oficjaln|najnowsz|rządow|szpitaln|medyczn|demograficzn|krajow|światow|unijn)\\p{L}{1,3}|według)${S}statystk\\p{L}{0,3})`,
    fix: (m) => `statystyk${m.groups!.target.slice(8)}`,
    ...RULE,
  },
  // "Chodzi o to, że": "ty" after "o" before a clause.
  {
    pattern: `(?<=(?:^|[^\\p{L}])o${S})(?<target>ty)(?=,${S}(?:że|żeby|aby|by)${END})`,
    fix: ["to", "tym"],
    ...RULE,
  },
  // "o tym i o owym": "wym" is no word ("wym." abbreviates).
  {
    pattern: `(?<=(?:^|[^\\p{L}])o${S})(?<target>wym)(?![\\p{L}\\p{N}]|\\.[ \\t\\u00a0]*\\p{L})`,
    fix: "owym",
    ...RULE,
  },
  // "stał na przodzie": "przedzie" needs its preposition.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|na)${S})(?<target>przedzie)${END}`,
    fix: ["na przodzie", "w przodzie"],
    ...RULE,
  },
  // "W lato" -> "Latem", "W lecie".
  {
    pattern: `${CLAUSE_START}(?<target>W${S}lato)${NEXT_WORD}`,
    fix: ["Latem", "W lecie"],
    ...RULE,
    verbatim: true,
  },
  // "inny niż": "jak" compares like things ("nikt inny jak" keeps it).
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:nikt|nic|ktoś|coś|kto|co|któż|cóż|nikogo|niczego|nikomu|niczym|nikim)${S})(?<target>inn(?:y|a|e|i|ego|ej|emu|ą|ym|ych|ymi)${S}jak)(?=${S}(?!nie${END})\\p{L})`,
    fix: (m) => m.groups!.target.replace(/jak$/iu, "niż"),
    ...RULE,
  },
];

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

export const DETECTORS = [
  {
    rules: [RULE.ruleId] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) && (!ctx.rules || ctx.rules.has(RULE.ruleId))
        ? [...runFrames(ctx, FRAMES), ...slips(ctx)]
        : [],
  },
];
