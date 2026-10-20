import { wordSet as words } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";
import { table } from "./tables";

// Names written the way their owners do not: brands split, joined or cased wrongly ("You Tube",
// "Power Point"), misspelled famous names, and nationality or language adjectives in lowercase
// ("french", "the dutch government").

/**
 * Names in their owners' spelling, for englishCanonicalCasing: each row's typed forms (any
 * case) become the name exactly. Only forms that are never ordinary English words.
 */
export const NAMES = table("properNames.names");

type Finding = RawFinding;
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

const VERBS = words("excel google kindle react");

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

// Places whose names are also ordinary words ("china", "turkey", "long island"): only where a
// place goes, after "born in", "from", "a trip to"…, and before the clause ends.
const PLACE_WORDS: Record<string, string> = {
  china: "China",
  japan: "Japan",
  turkey: "Turkey",
  shanghai: "Shanghai",
  queens: "Queens",
  "long island": "Long Island",
  "long beach": "Long Beach",
};

const roman = (n: number) =>
  ["", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC"][Math.floor(n / 10)] +
  ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][n % 10];

/** The capitalized name for the `w` group; a capitalized first word is already a name. */
function placeName(
  ctx: DetectContext,
  m: RegExpExecArray,
  name: string,
  messageKey: Finding["messageKey"],
): Finding | null {
  const [start, end] = m.indices!.groups!.w;
  const typed = m.groups!.w;
  // Lowercase only; a capitalized first word is already a name or the writer's choice.
  if (typed !== typed.toLowerCase() || ctx.dictionary.has(typed)) return null;
  return finding("englishProperNounCapitalization", messageKey, start, end, [name], {
    context: context(ctx, m.index, end),
  });
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  namesProduct: (m, ctx) => {
    const { w, n } = m.groups!;
    const product = PRODUCT_NOUNS.get(w);
    // Lowercase only: "WORD DOCUMENT" is emphasis, "Word document" is already right.
    if (
      !product ||
      w !== w.toLowerCase() ||
      !product.nouns.has(n.toLowerCase()) ||
      ctx.dictionary.has(w)
    )
      return null;
    // "to excel", "to react": the verb.
    if (
      VERBS.has(w) &&
      /(?:^|[^\p{L}])to[ \t ]+$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      return null;
    // "Microsoft Word", "MS Excel": the whole name is matched by NAMES.
    if (
      /(?:microsoft|ms|google|apple)[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      return null;
    const start = m.index;
    return {
      ruleId: "englishCanonicalCasing",
      messageKey: "review_msg_canonical_casing",
      range: { start, end: start + w.length },
      alternatives: [product.name],
      context: context(ctx, start, m.index + m[0].length),
    };
  },
  namesNationality: (m, ctx) => {
    const w = m.groups!.w;
    if (!PEOPLES.has(w) || ctx.dictionary.has(w)) return null;
    const end = m.index + w.length;
    const after = /^[ \t ]+([A-Za-z]+)/.exec(ctx.text.slice(end, end + 24))?.[1].toLowerCase();
    const before = /([A-Za-z]+)[ \t ]+$/
      .exec(ctx.text.slice(Math.max(0, m.index - 24), m.index))?.[1]
      .toLowerCase();
    if (after && LOWERCASE_AFTER[w]?.has(after)) return null;
    if (before && LOWERCASE_BEFORE[w]?.has(before)) return null;
    if (w === "polish") {
      const closes = /^[ \t ]*(?:[.!?,;:)]|$|and\b|or\b)/.test(ctx.text.slice(end, end + 8));
      if (!(after && POLISH_NOUNS.has(after)) && !(before && POLISH_VERBS.has(before) && closes))
        return null;
    }
    return {
      ruleId: "englishProperNounCapitalization",
      messageKey: "review_msg_nationality_capital",
      range: { start: m.index, end },
      alternatives: [w[0].toUpperCase() + w.slice(1)],
      context: context(ctx, m.index, end),
    };
  },
  namesPlace: (m, ctx) => {
    return placeName(
      ctx,
      m,
      PLACE_WORDS[m.groups!.w.toLowerCase().replace(/\s+/g, " ")],
      "review_msg_name_casing",
    );
  },
  namesSea: (m, ctx) => {
    return placeName(
      ctx,
      m,
      m.groups!.w.replace(/\b\w/g, (c) => c.toUpperCase()),
      "review_msg_name_casing",
    );
  },
  namesThanksgiving: (m, ctx) => {
    return placeName(ctx, m, "Thanksgiving", "review_msg_proper_noun");
  },
  namesSuperBowl: (m, ctx) => {
    const n = Number(m.groups!.n);
    if (n === 50) return null;
    const [start, end] = m.indices!.groups!.n;
    return finding(
      "englishCanonicalCasing",
      "review_msg_roman_numeral_name",
      start,
      end,
      [roman(n)],
      {
        context: context(ctx, m.index, end),
      },
    );
  },
} satisfies Record<string, MatchFixer>;
