import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// Names written the way their owners do not: brands split, joined or cased wrongly ("You Tube",
// "Power Point"), misspelled famous names, and nationality or language adjectives in lowercase
// ("french", "the dutch government").

const S = SPACE;
const E = WORD_END;

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  [["bon appetite", "bon apetit", "bon appetit", "bon apetite"], "bon appétit"],
  ["cote d'azur", "Côte d'Azur"],
  ["societe generale", "Société Générale"],
  [["sao paulo", "sao paolo", "são paolo"], "São Paulo"],
  ["dunkin donuts", "Dunkin' Donuts"],
  [["societe general", "societé general", "société general"], "Société Générale"],
  ...["joke", "jokes", "prank", "pranks"].map((thing): PhraseRow => [
    `april fools ${thing}`,
    `April Fools' ${thing}`,
  ]),
  [
    ["traveler check", "traveller check"],
    ["traveler's check", "traveller's check"],
  ],
];
export const COMPOUNDS: readonly PhraseRow[] = [
  ["pre covid", "pre-COVID"],
  [["pre covid19", "pre covid-19", "pre covid 19"], "pre-COVID-19"],
  ["pre corona", "pre-corona"],
  ["lithium ion", "lithium-ion"],
  ["lithiumion", "lithium-ion"],
];
export const STYLE: readonly PhraseRow[] = [];

/**
 * Names in their owners' spelling, for englishCanonicalCasing: each row's typed forms (any
 * case) become the name exactly. Only forms that are never ordinary English words.
 */
export const NAMES: readonly PhraseRow[] = [
  // Brands and products written as one word, or with a hyphen. Not "call of duty" (the idiom)
  // or "Barca" (a surname and a place).
  ...(
    [
      ["you tube", "YouTube"],
      ["pay pal", "PayPal"],
      ["git hub", "GitHub"],
      ["java script", "JavaScript"],
      ["type script", "TypeScript"],
      ["power shell", "PowerShell"],
      ["share point", "SharePoint"],
      ["one drive", "OneDrive"],
      ["face book", "Facebook"],
      ["snap chat", "Snapchat"],
      ["whats app", "WhatsApp"],
      ["tik tok", "TikTok"],
      ["fed ex", "FedEx"],
      ["air bnb", "Airbnb"],
      ["chat gpt", "ChatGPT"],
      ["open ai", "OpenAI"],
      ["net flix", "Netflix"],
      ["star bucks", "Starbucks"],
      ["wal mart", "Walmart"],
      [["mac book", "macbook"], "MacBook"],
      ["chrome book", "Chromebook"],
      ["air pods", "AirPods"],
      ["play station", "PlayStation"],
      ["game boy", "Game Boy"],
      ["word press", "WordPress"],
      ["drop box", "Dropbox"],
      ["linked in profile", "LinkedIn profile"],
      ["linked in account", "LinkedIn account"],
      ["linked in page", "LinkedIn page"],
      ["linked in post", "LinkedIn post"],
      ["e bay", "eBay"],
      ["coca cola", "Coca-Cola"],
      ["rolls royce", "Rolls-Royce"],
      ["mercedes benz", "Mercedes-Benz"],
      ["harley davidson", "Harley-Davidson"],
      ["hewlett packard", "Hewlett-Packard"],
      ["merriam webster", "Merriam-Webster"],
      ["alka seltzer", "Alka-Seltzer"],
      ["jay z", "Jay-Z"],
      ["objective c", "Objective-C"],
      ["mar a lago", "Mar-a-Lago"],
      ["z wave", "Z-Wave"],
      ["zwave", "Z-Wave"],
      ["wi fi", "Wi-Fi"],
      ["7 eleven", "7-Eleven"],
      [["node js", "nodejs"], "Node.js"],
      ["space x", "SpaceX"],
      ["g mail", "Gmail"],
      ["bit coin", "Bitcoin"],
      ["cold play", "Coldplay"],
      ["libre office", "LibreOffice"],
      ["mac os x", "Mac OS X"],
      ["mac os", "macOS"],
      [["black lifes matter", "black lifes matters", "black lives matters"], "Black Lives Matter"],
      [["karma sutra", "karmasutra"], "Kama Sutra"],
      ["mercedes amg", "Mercedes-AMG"],
      [["saint tropez", "st tropez", "st. tropez"], "Saint-Tropez"],
      ["delta airlines", "Delta Air Lines"],
      [["jack daniels", "jack daniel"], "Jack Daniel's"],
      ["kings college", "King's College"],
      ["wendys", "Wendy's"],
      ["earl gray tea", "Earl Grey tea"],
      [["fed xed", "fed-exed", "fedexed"], "FedExed"],
      ["cap coral", "Cape Coral"],
      ["los angels", "Los Angeles"],
      [["jong un", "jongun"], "Jong-un"],
      [
        ["red nose reindeer", "red nose raindeer", "red nosed raindeer", "red nosed reindeer"],
        "Red-Nosed Reindeer",
      ],
      ["jesus chris", "Jesus Christ"],
      [["long island ice tea", "long island iced tea"], "Long Island iced tea"],
      ["queens gambit", "Queen's Gambit"],
      ["donald trump", "Donald Trump"],
      ["donald trumps", "Donald Trump's"],
      ["astra zeneca", "AstraZeneca"],
      [["ipad os", "ipados"], "iPadOS"],
      [["watch os", "watchos"], "watchOS"],
      [["covid 19", "covid19", "covid-19"], "COVID-19"],
      [["corona virus", "corona-virus"], "coronavirus"],
      ["sars cov 2", "SARS-CoV-2"],
      [["office365", "office 365"], "Office 365"],
      [["microsoft365", "microsoft 365"], "Microsoft 365"],
      [["pokemon", "pokémon"], "Pokémon"],
      ["pokemon go", "Pokémon Go"],
      ["schrodinger", "Schrödinger"],
      [["loreal", "l'oreal"], "L'Oréal"],
    ] as const
  ).map(([typed, name]): PhraseRow => [typed, name]),
  // Famous names with a letter missing or swapped.
  ...(
    [
      ["barrack obama", "Barack Obama"],
      ["ronald regan", "Ronald Reagan"],
      ["ringo star", "Ringo Starr"],
      ["jimmy hendrix", "Jimi Hendrix"],
      ["edgar allen poe", "Edgar Allan Poe"],
      ["forest gump", "Forrest Gump"],
      ["jenifer aniston", "Jennifer Aniston"],
      ["carnegie melon", "Carnegie Mellon"],
      [["eifel tower", "eiffel tower"], "Eiffel Tower"],
      ["new zeeland", "New Zealand"],
      [["rubiks cube", "rubic's cube", "rubics cube"], "Rubik's Cube"],
      [["mcdonalds", "mc donalds", "mcdonald's"], "McDonald's"],
      [["kelloggs", "kellogs"], "Kellogg's"],
      ["sainsburys", "Sainsbury's"],
      ["macys", "Macy's"],
      ["trader joes", "Trader Joe's"],
      ["sams club", "Sam's Club"],
      ["victorias secret", "Victoria's Secret"],
      ["schitts creek", "Schitt's Creek"],
      ["greys anatomy", "Grey's Anatomy"],
      ["assassins creed", "Assassin's Creed"],
      ["uncle bens", "Uncle Ben's"],
    ] as const
  ).map(([typed, name]): PhraseRow => [typed, name]),
  // Proper names spelled in their ordinary words. Not "black sea" or "long island": "a black
  // sea", "a long island chain"; not "power point": a socket in British English.
  ...[
    "Google Analytics",
    "Google Play",
    "Google Play Store",
    "Google Meet",
    "Google Ads",
    "Google Cloud",
    "Google Photos",
    "Google Translate",
    "Google Calendar",
    "Google Search",
    "Google Slides",
    "Google Forms",
    "Apple TV",
    "Apple ID",
    "Apple Pay",
    "Apple Watch",
    "Apple Music",
    "Internet Explorer",
    "MS Word",
    "MS Excel",
    "MS Office",
    "MS Teams",
    "Nintendo Switch",
    "Black Lives Matter",
    "Super Bowl",
    "Super Tuesday",
    "World War I",
    "World War II",
    "World War One",
    "World War Two",
    "Middle Ages",
    "Caspian Sea",
    "Cape Cod",
    "Cape of Good Hope",
    "Papua New Guinea",
    "New Guinea",
    "Union Jack",
    "Royal Mail",
    "Royal Air Force",
    "Royal Navy",
    "Geiger counter",
    "Ponzi scheme",
    "Oxford comma",
    "Omicron variant",
    "Delta variant",
    "U-turn",
    "T-bone",
    "T-shirt",
    "V-neck",
    "Unicode",
    "Euclidean",
    "Celsius",
    "Fahrenheit",
    "Pilates",
  ].map((name): PhraseRow => [name.toLowerCase(), name]),
];

type Finding = RawFinding;
const words = (list: string) => new Set(list.split(" "));
const context = (ctx: DetectContext, start: number, end: number) => ({
  start: Math.max(0, start - 96),
  end: Math.min(ctx.text.length, end + 40),
});

// Brand names that are also ordinary words ("excel", "word", "chrome"): only before a noun that
// only the product has.
const PRODUCT_FRAMES: readonly (readonly [typed: string, name: string, nouns: string])[] = [
  [
    "excel",
    "Excel",
    "file files sheet sheets spreadsheet spreadsheets workbook workbooks document documents " +
      "formula formulas table tables macro macros chart charts skills",
  ],
  ["word", "Word", "document documents doc docs docx file files template templates"],
  [
    "outlook",
    "Outlook",
    "mail mails email emails inbox calendar invite invites account app client",
  ],
  ["chrome", "Chrome", "browser devtools tab tabs"],
  ["opera", "Opera", "browser"],
  [
    "google",
    "Google",
    // Products named in NAMES ("Google Docs") are matched there.
    "doc account accounts assistant scholar earth workspace trends traffic results ranking " +
      "rankings",
  ],
  ["twitter", "Twitter", "account accounts feed handle post posts followers thread threads"],
  ["slack", "Slack", "channel channels workspace workspaces app bot"],
  ["kindle", "Kindle", "app device tablet edition store paperwhite unlimited reader"],
  ["react", "React", "app apps component components hook hooks native router developer plugin"],
  ["mac", "Mac", "app apps user users computer computers laptop laptops version keyboard"],
  [
    "windows",
    "Windows",
    "10 11 7 8 xp vista server update updates pc pcs laptop laptops machine machines user " +
      "users computer computers version defender explorer store",
  ],
  [
    "apple",
    "Apple",
    "inc employee employees stock shares products device devices account store stores " +
      "silicon pencil",
  ],
];
const PRODUCT_NOUNS = new Map(
  PRODUCT_FRAMES.map(([typed, name, nouns]) => [typed, { name, nouns: words(nouns) }]),
);
const PRODUCT = `(?<w>${PRODUCT_FRAMES.map(([typed]) => typed).join("|")})${S}(?<n>[a-z0-9]+)${E}`;

const VERBS = words("excel google kindle react");

function productNames(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PRODUCT, "w")) {
    const { w, n } = m.groups!;
    const product = PRODUCT_NOUNS.get(w);
    // Lowercase only: "WORD DOCUMENT" is emphasis, "Word document" is already right.
    if (
      !product ||
      w !== w.toLowerCase() ||
      !product.nouns.has(n.toLowerCase()) ||
      ctx.dictionary.has(w)
    )
      continue;
    // "to excel", "to react": the verb.
    if (
      VERBS.has(w) &&
      /(?:^|[^\p{L}])to[ \t ]+$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      continue;
    // "Microsoft Word", "MS Excel": the whole name is matched by NAMES.
    if (
      /(?:microsoft|ms|google|apple)[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      continue;
    const start = m.index;
    findings.push({
      ruleId: "englishCanonicalCasing",
      messageKey: "review_msg_canonical_casing",
      range: { start, end: start + w.length },
      alternatives: [product.name],
      context: context(ctx, start, m.index + m[0].length),
    });
  }
  return findings;
}

// Nationalities, languages and religions are proper adjectives in English.
const PEOPLES = words(
  "english french german spanish italian portuguese russian chinese japanese korean arabic " +
    "hindi hebrew greek swedish norwegian finnish icelandic irish scottish welsh british " +
    "american canadian mexican brazilian argentinian australian european african asian indian " +
    "pakistani egyptian israeli iranian iraqi turkish ukrainian hungarian romanian bulgarian " +
    "serbian croatian czech slovak vietnamese indonesian filipino nigerian kenyan belgian " +
    "austrian latin christian muslim jewish buddhist hindu islamic protestant dutch polish",
);
// Lowercase in set phrases: "french fries", "go dutch", "nail polish".
const LOWERCASE_AFTER: Record<string, Set<string>> = {
  french: words("fries fry toast door doors window windows horn press braid braids kiss manicure"),
};
const LOWERCASE_BEFORE: Record<string, Set<string>> = {
  dutch: words("go goes going went double"),
};
// "polish" is mostly the verb and the noun: only as a language or a people.
const POLISH_NOUNS = words(
  "people language government citizen citizens nationality president army border history " +
    "culture cuisine food city cities town national translation version lessons lesson class " +
    "teacher speaker speakers word words name names origin descent family friend friends",
);
const POLISH_VERBS = words(
  "speak speaks speaking spoke learn learns learning learned learnt study studies studying " +
    "translate translated into from am is are was were",
);
// One case-sensitive alternation of the lowercase forms, not a scan of every word.
const PEOPLE = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])(?<w>${[...PEOPLES].join("|")})(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])`,
  "gdu",
);

function nationalities(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PEOPLE, "w")) {
    const w = m.groups!.w;
    if (!PEOPLES.has(w) || ctx.dictionary.has(w)) continue;
    const end = m.index + w.length;
    const after = /^[ \t ]+([A-Za-z]+)/.exec(ctx.text.slice(end, end + 24))?.[1].toLowerCase();
    const before = /([A-Za-z]+)[ \t ]+$/
      .exec(ctx.text.slice(Math.max(0, m.index - 24), m.index))?.[1]
      .toLowerCase();
    if (after && LOWERCASE_AFTER[w]?.has(after)) continue;
    if (before && LOWERCASE_BEFORE[w]?.has(before)) continue;
    if (w === "polish") {
      const closes = /^[ \t ]*(?:[.!?,;:)]|$|and\b|or\b)/.test(ctx.text.slice(end, end + 8));
      if (!(after && POLISH_NOUNS.has(after)) && !(before && POLISH_VERBS.has(before) && closes))
        continue;
    }
    findings.push({
      ruleId: "englishProperNounCapitalization",
      messageKey: "review_msg_nationality_capital",
      range: { start: m.index, end },
      alternatives: [w[0].toUpperCase() + w.slice(1)],
      context: context(ctx, m.index, end),
    });
  }
  return findings;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (...detectors: ((ctx: DetectContext) => Finding[])[]) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US"
      ? []
      : detectors.flatMap((detect) => detect(ctx)).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishCanonicalCasing"], detect: english(productNames) },
  { rules: ["englishProperNounCapitalization"], detect: english(nationalities) },
];
