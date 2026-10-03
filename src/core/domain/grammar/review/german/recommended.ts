import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { isGerman, WORD_GATE } from "./shared";

// Spellings the Duden recommends where two are allowed (opt-in): -graf-, -fon and Fantasie for
// -graph-, -phon and Phantasie ("Geografie", "Mikrofon"), adverbs joined from a preposition and
// a noun ("aufgrund", "instand"), and "zu Hause", "bekannt geben" written apart.

const re = (source: string) => new RegExp(`${WORD_GATE}(?:${source})${E}`, "gdu");

// "Geographie", "Paragraph", "Photographin", "Mikrophon", "Phantasie", "Delphin": a Greek ph
// German now writes f. "Graph" and "Graphen" (graphene) alone, "Phonetik", "Philosophie" stay.
const PH = re(
  `(?<target>\\p{L}*?(?:[Gg]eo|[Bb]io|[Pp]ara|[Ff]oto|[Pp]hoto|[Oo]rtho|[Kk]rypto|[Cc]horeo|[Tt]ele|[Kk]alli|[Tt]opo|[Ee]thno|[Dd]emo|[Ss]teno|[Ll]itho|[Hh]olo|[Ss]eismo|[Kk]arto|[Tt]ypo)graph\\p{Ll}*|` +
    `\\p{L}*?(?:[Mm]ikro|[Ss]axo|[Xx]ylo|[Mm]ega|[Gg]rammo|[Tt]ele)phon(?:e|en|s|es|ist|istin|istinnen|isten)?|` +
    `\\p{Lu}*?(?:GEO|BIO|PARA|FOTO|PHOTO|ORTHO|KRYPTO|CHOREO|TELE|TOPO|TYPO)GRAPH\\p{Lu}*|` +
    `(?:[Pp]hantas(?:ie|ien|tisch|tische[nmrs]?|ievoll|ievolle[nmrs]?|ielos|t|ten|tin)|PHANTASIE)|[Gg]raphi(?:k|ken|sch|sche|schen|scher|sches|schem|ker|kerin)|[Dd]elphin(?:e|en|s)?|[Pp]hoto(?:s|apparat|album|kopie)?)`,
);
const REPLACE_PH: Array<[RegExp, string]> = [
  [/phantas/g, "fantas"],
  [/Phantas/g, "Fantas"],
  [/PHANTAS/g, "FANTAS"],
  [/PHOTO/g, "FOTO"],
  [/graph/g, "graf"],
  [/Graph/g, "Graf"],
  [/GRAPH/g, "GRAF"],
  [/phon/g, "fon"],
  [/elphin/g, "elfin"],
  [/^Photo/, "Foto"],
  [/^photo/, "foto"],
  [/(?<=\p{L})photo/gu, "foto"],
];

// A preposition and a noun the Duden recommends joining, where the phrase is that adverb
// ("auf Grund des Wetters", "an Hand der Daten"); stylePhrasing has "infrage", "zugunsten"
// and the like.
const JOINED: Array<[string, string, string]> = [
  ["auf Grund", "aufgrund", `(?:des|der|dessen|deren|von|eines|einer|seines|seiner|ihres|ihrer)`],
  ["an Hand", "anhand", `(?:des|der|von|eines|einer|dieser|dieses)`],
  [
    "zu Tage",
    "zutage",
    `(?:treten|tritt|trat|traten|getreten|fördern|fördert|förderte|gefördert|bringen|gebracht)`,
  ],
  ["zu Rande", "zurande", `(?:kommen|kommt|kam|kamen|gekommen)`],
  [
    "in Stand",
    "instand",
    `(?:setzen|setzt|setzte|gesetzt|halten|hält|hielt|gehalten|zu${S}setzen)`,
  ],
];
const JOINED_FRAMES = JOINED.map(([apart, joined, next]): [RegExp, string] => {
  const [first, second] = apart.split(" ");
  return [
    re(
      `(?<target>[${first[0]}${first[0].toUpperCase()}]${first.slice(1)}${S}${second})(?=${S}${next}${E}|[ \\t]*[.!?,;]|${S}(?:\\p{Ll}+${S}){0,3}${next}${E})`,
    ),
    joined,
  ];
});
// "Wir sind zuhause", "bekanntgegeben", "verlorengegangen": written apart.
const APART = re(
  `(?<target>zuhause)|(?<t2>(?<lead>bekannt|verloren)(?<verb>gegeben|gab|gaben|geben|gibt|zugeben|gemacht|machte|machten|machen|macht|zumachen|gegangen|ging|gingen|gehen|geht|zugehen))`,
);

// An adverb and a participle the Duden recommends joining: "ein viel sagender Blick"
// (vielsagender), "hoch begabt", "schwer behindert", "allein erziehend".
const TOGETHER = re(
  `(?<target>(?<lead>[Vv]iel|[Hh]och|[Ss]chwer|[Aa]llein|[Ww]ohl)${S}(?<rest>(?<stem>sagend|begabt|behindert|erziehend|geschätzt|erzogen|temperiert)(?:e|en|er|es|em)?))`,
);
const PAIRS = new Set([
  "viel sagend",
  "hoch begabt",
  "schwer behindert",
  "allein erziehend",
  "hoch geschätzt",
  "wohl erzogen",
  "wohl temperiert",
]);
// An adverb and a participle the Duden recommends writing apart: "tiefbetrübt" (tief
// betrübt), "nichtrostend", "freistehend".
const APART_PAIRS = re(
  `(?<target>(?<lead>[Tt]ief|[Hh]och|[Vv]iel|[Nn]icht|[Ff]rei|[Rr]ot|[Nn]eu)(?<rest>(?:betrübt|hängend|kompliziert|beschäftigt|rostend|stehend|lackiert|bekehrt)(?:e|en|er|es|em)?))`,
);
const APART_SET = new Set([
  "tiefbetrübt",
  "tiefhängend",
  "hochkompliziert",
  "vielbeschäftigt",
  "nichtrostend",
  "freistehend",
  "rotlackiert",
  "neubekehrt",
]);

// "recht haben", "recht geben" (the Duden prefers lowercase over "Recht haben"), and "bis auf
// Weiteres", "ohne Weiteres" (it prefers the capital). "das Recht haben" is the noun.
const RIGHT_VERBS =
  "haben|hat|hatte|hatten|hast|habe|hätte|hätten|geben|gibt|gab|gaben|gegeben|behalten|behielt|bekommen|bekam";
const NOT_AFTER =
  "das|kein|ein|sein|ihr|mein|dein|unser|euer|jedes|volles|vollem|gutes|zum|im|vom|nach|mit|von|auf|zu|dem|des|dieses|jedem|allem";
const RIGHT = re(
  `(?<!(?:${NOT_AFTER})${S})(?<=\\p{Ll}${S})(?<target>Recht)(?=${S}(?:${RIGHT_VERBS})${E})|` +
    `(?<!(?:${NOT_AFTER})${S})(?<=(?:${RIGHT_VERBS})(?:${S}\\p{Ll}+){0,3}${S})(?<t2>Recht)(?=[ \\t]*[.!?,;])|` +
    `(?<=(?:bis${S}auf|[Oo]hne|[Dd]es)${S})(?<t3>weiteres|weiteren)(?=[ \\t]*[.!?,;]|${S}\\p{Ll})`,
);

// The Duden spells "To-do", "To-dos" and "To-do-Liste": "ToDo", "Todos", "TODO", "Todo Liste".
const TODO = re(
  `(?<target>(?:ToDo|Todo|TODO|To-Do|To${S}Do)(?<plural>s)?(?:(?<list>-?Liste|${S}Liste|-?Lists?|liste)(?<lists>n)?)?)`,
);

function finding(start: number, end: number, replacement: string): RawFinding {
  return {
    ruleId: "germanRecommendedSpelling",
    messageKey: "review_msg_german_recommended_spelling",
    range: { start, end },
    alternatives: [replacement],
    context: { start: Math.max(0, start - 30), end: end + 30 },
  };
}

function recommended(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, name: string, replacement: string) => {
    const typed = m.groups![name];
    const [start, end] = m.indices!.groups![name];
    if (replacement === typed || ctx.dictionary.has(typed.toLowerCase())) return;
    if (namedExampleBefore(ctx.text, start)) return;
    findings.push(finding(start, end, replacement));
  };
  for (const m of frameMatches(ctx, PH)) {
    const typed = m.groups!.target;
    // "Graph", "Graphen": the mathematical graph and graphene.
    if (/^(?:graph|graphen|graphs|graphe)$/i.test(typed)) continue;
    // A name in quotes or after "Deutsche": "der „Telegraph“", "Deutsche Grammophon".
    const before = ctx.text.slice(Math.max(0, m.index - 10), m.index);
    if (/["„“”«»'‚‘]$|Deutsche[ \t]+$/.test(before)) continue;
    push(
      m,
      "target",
      REPLACE_PH.reduce((word, [from, to]) => word.replace(from, to), typed),
    );
  }
  for (const [regex, joined] of JOINED_FRAMES) {
    for (const m of frameMatches(ctx, regex)) {
      const typed = m.groups!.target;
      push(
        m,
        "target",
        /^\p{Lu}/u.test(typed) ? joined[0].toUpperCase() + joined.slice(1) : joined,
      );
    }
  }
  for (const m of frameMatches(ctx, TODO)) {
    const { plural, list, lists } = m.groups!;
    const many = !!lists || !!list?.endsWith("s") || (!list && !!plural);
    push(m, "target", list ? `To-do-Liste${many ? "n" : ""}` : `To-do${many ? "s" : ""}`);
  }
  for (const m of frameMatches(ctx, TOGETHER)) {
    const { lead, rest, stem } = m.groups!;
    // "Er ist wohl erzogen worden": "wohl" may mean "probably", so only before a noun.
    if (/^[Ww]ohl$/.test(lead) && rest === stem) continue;
    if (PAIRS.has(`${lead.toLowerCase()} ${stem}`)) push(m, "target", lead + rest);
  }
  const rightOwner = (m: RegExpExecArray) =>
    (m.indices!.groups!.target ?? m.indices!.groups!.t2 ?? m.indices!.groups!.t3)[0];
  for (const m of frameMatches(ctx, RIGHT, rightOwner)) {
    if (m.groups!.t3) push(m, "t3", `W${m.groups!.t3.slice(1)}`);
    else push(m, m.groups!.target ? "target" : "t2", "recht");
  }
  for (const m of frameMatches(ctx, APART_PAIRS)) {
    const { lead, rest } = m.groups!;
    const stem = rest.replace(/(?:e|en|er|es|em)$/, "");
    if (APART_SET.has(lead.toLowerCase() + stem)) push(m, "target", `${lead} ${rest}`);
  }
  const owner = (m: RegExpExecArray) => (m.indices!.groups!.target ?? m.indices!.groups!.t2)[0];
  for (const m of frameMatches(ctx, APART, owner)) {
    if (m.groups!.target) push(m, "target", "zu Hause");
    else {
      // "bekanntzugeben" → "bekannt zu geben".
      const verb = m.groups!.verb.replace(/^zu(?=\p{Ll}{3})/u, "zu ");
      push(m, "t2", `${m.groups!.lead} ${verb}`);
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanRecommendedSpelling"], detect: recommended },
];
