import { expect, test } from "bun:test";
import { GERMAN_WORST_CASES } from "./germanWorstCase.fixture";
import { QUOTES_WORST_CASES } from "./quotesWorstCase.fixture";
import { chunkTimes, chunkTimesWithoutJit, languageRules, type TimingCase } from "./reviewHarness";

// Adversarial Arabic, Greek and Swedish inputs: frame-opening words around long runs of
// spaces and tabs.
const gap = (n = 3_000) => "\t ".repeat(n);

const AR_EL_SV: TimingCase[] = [
  ["ar_SA", `لم ${gap()}يذهب. كلما${gap()}كلما ${gap()}قرأ`],
  ["ar_SA", `إلا ${gap()}كلمة${gap()}فقط. بين ${gap()}البيت${gap()}وبين المدرسة`],
  ["ar_SA", `هذا ${gap()}الكتب في ${gap()}31 ${gap()}مارس${gap()}2022`],
  ["ar_SA", `الرسالة${gap()}الذي ${gap()}كتبتها. قام${gap()}بالعمل${gap()}بشكل${gap()}مناسب`],
  [
    "ar_SA",
    `لا ${gap()}يخافوا. ثلاثة${gap()}وثلاثون${gap()}صفحات. ما ${gap()}زال${gap()}يعمل${gap()}كمدير`,
  ],
  ["ar_SA", "و ".repeat(6_000) + "لم يذهبوا"],
  [
    "ar_SA",
    `ما ${gap()}قال إلا ${gap()}وقال. بين ما${gap()}كان. يتناسب${gap()}ورأيه. الأرقام${gap()}الأكبر من${gap()}10`,
  ],
  [
    "ar_SA",
    `في ${gap()}الغرفة${gap()}الكبير. كتاب${gap()}في${gap()}بيت${gap()}الولد. هذا${gap()}قميص${gap()}قديمة. ثلاث${gap()}اجتماعات`,
  ],
  ["el_GR", `τη ${gap()}μέρα. Αυτό${gap()}που ${gap()}λες. δεν${gap()}θα${gap()}έχω${gap()}πάει`],
  ["el_GR", `κι ${gap()}έτσι. Που ${gap()}είσαι${gap()};  πιο ${gap()}καλύτερος!!${gap()}…`],
  ["el_GR", "και ".repeat(5_000) + "πως"],
  ["sv_SE", `Mellan ${gap()}två${gap()}till${gap()}fyra. En${gap()}till${gap()}kaka.`],
  ["sv_SE", `Dem ${gap()}är. med${gap()}de${gap()}. Det var bra${gap()}sa${gap()}Johan.`],
  ["sv_SE", `ett${gap()}mörk${gap()}kväll. 2a${gap()}APIs ${gap()}Måndag${gap()}den 3e.`],
  ["sv_SE", "och ".repeat(5_000) + "sa hon."],
];

test("no Arabic, Greek or Swedish chunk stalls on long space runs", () => {
  for (const ms of chunkTimes(AR_EL_SV)) expect(ms).toBeLessThan(100);
});

// Adversarial pt_BR inputs.
const PORTUGUESE = [
  `Espero que ${" ".repeat(3_000)}a sonda chega`,
  `\n${" ".repeat(3_000)}Atenciosamente${" ".repeat(500)}\n`,
  `Prezado${" ".repeat(3_000)}Senhor`,
  `O que é que ${" ".repeat(3_000)}houve.`,
  `que ${" ".repeat(3_000)}ate o fim`,
  `${"\n ".repeat(1_500)}Por exemplo hoje`,
  "1 999 349.56 ".repeat(300),
  "21,349.56 4.5 kg ".repeat(250),
  "vai fala pode come vão dormi em China ".repeat(100),
  `e,${" ".repeat(3_000)}no fundo ficou e ${" ".repeat(500)}além disso,`,
  "A arvore e, no fundo ficou e além disso, e, em geral ".repeat(80),
  "eu e a Rita viajam as crianças da escola brinca vende-se casas ".repeat(60),
  "devido a quanto a vou na praia a razão pelo qual ".repeat(80),
  `${" ".repeat(3_900)}x`.repeat(2),
  `devemos${" ".repeat(3_000)}sim${" ".repeat(500)}lutar`,
  `Ele${" ".repeat(3_000)}não${" ".repeat(500)}cópia os dados`,
  "bem mas, sim senhor! eu cálculo que Prática-se pagou o pato de forma rápida ".repeat(60),
  `foi${" ".repeat(3_000)}a${" ".repeat(500)}dois anos.`,
  "foram corrigido o já si que agente vai á tira-mos as vão fazerem tem acontecido erros ".repeat(
    60,
  ),
  `foram${" ".repeat(3_000)}corrigido${" ".repeat(500)}o valor`,
  `Isso.${" ".repeat(3_000)}Por que${" ".repeat(500)}saiu.`,
  `no${" ".repeat(3_000)}1ª lugar, ${" ".repeat(500)}mais não`,
  "Serviço continuo. Este gatos estão mais bom de que tem direito na termos ".repeat(60),
  `É caro${" ".repeat(3_000)}mas${" ".repeat(500)}é bom. Se${" ".repeat(500)}comprá-las`,
  "Quando vendê-los, e se comprá-las que deve-lhe Farei-lhe quero está. Por favor faça ".repeat(60),
  "traduzir o a os isso em a se mesmo ser tanto rico como duas milhões muitos poucos segue anexo a minha ora ".repeat(
    50,
  ),
  `traduzir${" ".repeat(3_000)}o${" ".repeat(500)}em inglês`,
  // Opt-in style frames: an action noun, "tornar" + adjective, a figure that opens a sentence.
  `fez${" ".repeat(3_000)}a análise${" ".repeat(500)}do texto`,
  `Fim.${" ".repeat(3_000)}12${" ".repeat(500)}casas caíram`,
  "fez a análise do se torna possível o. 12 casas 3 x 1 abc torna mais fácil ".repeat(80),
];

// English clause frames on a long run of spaces and tabs.
const ENGLISH_CLAUSES: TimingCase = [
  "en_US",
  "x." +
    "\t ".repeat(6000) +
    " However it works. On going work. We left and I. " +
    "x.  and ".repeat(1500) +
    "he see's it I' m they 're ".repeat(300),
  [
    "styleIntroductoryComma",
    "styleClauseComma",
    "englishTypography",
    "englishContextualCompounds",
    "englishContractionNormalization",
    "englishApostrophes",
  ],
];

const SPANISH: TimingCase = [
  "es_ES",
  "el." + "\t ".repeat(6000) + " el 32 de enero. Vino a las 5 hrs. y el 2do. Son casas rojos.",
  languageRules("es_ES", [
    "capitalizeSentenceStart",
    "capitalizeAfterLineBreak",
    "styleLongSentence",
  ]),
];

const POLISH = [
  "\t ".repeat(6000),
  "\u00a0 ".repeat(6000),
  ("lata" + " ".repeat(300)).repeat(40),
  (". " + " ".repeat(300)).repeat(40),
  ("w szkole" + " ".repeat(300)).repeat(40),
  ("zarówno dom i" + " ".repeat(300)).repeat(40),
  ("Im więcej, o tyle" + " ".repeat(300)).repeat(40),
  ("lepszy jak" + " ".repeat(300) + "on" + " ".repeat(300) + "został").repeat(20),
  "jakiś zostało on poszła większy jak stary ".repeat(400),
  "że te dzieci byli studenci przyszły kobiety bawili się ".repeat(300),
  ("Dzieci" + " ".repeat(300) + "byli").repeat(20),
  ("byli bardzo zadowolone" + " ".repeat(300) + "półtorej roku trzydzieści trzej").repeat(20),
  ("będzie się" + " ".repeat(300) + "zrobić zaczął zrobił").repeat(20),
  ("nigdy tego" + " ".repeat(300) + "byłem tysiące ludzie").repeat(20),
  (", że mi" + " ".repeat(300) + "daj. Czy" + " ".repeat(300) + "napisz").repeat(10),
];

// The date checks that read the Review clock (a weekday next to a date with no year, a verb
// tense against a dated year), on long runs of blanks and on many dates.
const dateGap = (a: string, b: string, n = 40) => (a + " ".repeat(300) + b + " ").repeat(n);
const DATES: Record<string, string[]> = {
  en_US: [
    dateGap("Monday,", "12 October"),
    dateGap("On", "12 March 2026, we will"),
    "We will visit them on 12 March 2026 and ".repeat(150),
    "Monday, 31/10 Tuesday, 12 October ".repeat(150),
  ],
  de_DE: [
    dateGap("am", "12.03.2028 haben wir"),
    dateGap("Sonntag,", "12.10."),
    "Wir haben am 12.03.2028 den Vertrag abgeschickt. ".repeat(100),
  ],
  fr_FR: [
    dateGap("le", "12 mars 2028 nous avons"),
    "Nous avons envoyé le contrat le 12 mars 2028. ".repeat(100),
  ],
  es_ES: [
    dateGap("el", "12 de marzo de 2028"),
    "Hemos enviado el contrato el 12 de marzo de 2028. ".repeat(100),
  ],
  pt_BR: [
    dateGap("em", "12 de março de 2028"),
    dateGap("Segunda,", "31/10"),
    "Visitei o cliente em 12 de março de 2028. ".repeat(100),
  ],
  pl_PL: [dateGap("dnia", "12 marca 2028 r."), "Podpisaliśmy umowę 12 marca 2028 r. ".repeat(100)],
  ar_SA: [dateGap("في", "12 مارس 2028"), "لقد زرنا العميل في 12 مارس 2028. ".repeat(100)],
};

// Each 4,000-character chunk must stay linear: a quadratic frame takes seconds per chunk.
// The limits allow for the slower scans without the JIT.
test.each<[string, TimingCase[], number]>([
  ["Arabic, Greek and Swedish", AR_EL_SV, 250],
  ["German", GERMAN_WORST_CASES.map((text): TimingCase => ["de_DE", text]), 400],
  ["Portuguese", PORTUGUESE.map((text): TimingCase => ["pt_BR", text]), 1_000],
  ["typographic quote", QUOTES_WORST_CASES, 250],
  ["English clause", [ENGLISH_CLAUSES], 60],
  ["Spanish", [SPANISH], 100],
  ["Polish", POLISH.map((text): TimingCase => ["pl_PL", text, languageRules("pl_PL")]), 1_500],
  [
    "date",
    Object.entries(DATES).flatMap(([lang, texts]) =>
      texts.map((text): TimingCase => [lang, text, languageRules(lang)]),
    ),
    1_500,
  ],
])(
  "%s frames stay linear with the regex JIT off",
  (_, cases, limit) => {
    expect(Math.max(...chunkTimesWithoutJit(cases))).toBeLessThan(limit);
  },
  120_000,
);
