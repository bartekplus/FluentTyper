import { namedExampleBefore, OPENING_QUOTES } from "./exampleCues";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const CANONICAL = new Map(
  [
    ...["GitHub", "JavaScript", "TypeScript", "WebRTC", "FluentTyper", "iPhone", "macOS", "eBay"],
    ...["LinkedIn", "WordPress", "iPad", "iPod", "iMac", "iTunes"],
    // Brands that are no ordinary word in any language.
    ...["YouTube", "YouTuber", "PayPal", "WeChat", "WhatsApp", "TikTok", "FaceTime", "Skype"],
    ...["FedEx", "PowerPoint", "ChatGPT", "Netflix", "Spotify", "Wikipedia", "Reddit", "Linux"],
    ...["Ubuntu", "Instagram", "Facebook", "Snapchat", "Airbnb", "Chromebook"],
    ...["SharePoint", "OneDrive", "PowerShell", "PlayStation", "Xbox", "Walmart", "Starbucks"],
  ].map((term) => [term.toLowerCase(), term]),
);
// Acronyms written as a capitalized word ("Nasa", "Cpu"); lowercase "pdf" or "url" is often a
// file extension or a field name and stays. English only: Portuguese and German write "a Nasa",
// "die Nato", and "Hr." (Herr), "Cia." (Companhia) or the name "Ai" are words elsewhere.
const ACRONYMS = new Set(
  // Not IKEA or LEGO (house styles often write "Ikea", "Lego") nor AI ("Ai" is a place and a name).
  "NASA NATO FBI CIA HIV DNA RNA CPU GPU HTML URL FAQ PDF CEO CFO HR UFO".split(" "),
);

// Brands people use as lowercase verbs ("we skype", "je skype", "call or facetime"). A lowercase
// form of these brands gets the brand casing only in a clear English noun context. All other
// contexts and other languages keep the word as typed.
// The inflected forms ("skyped", "facetiming") are not in CANONICAL, so this check never sees them.
// Not "fedex": the NAMES table in english/properNames.ts recases the verb form "fedexed" too.
const VERB_BRANDS = new Set(["skype", "facetime", "whatsapp", "snapchat", "paypal"]);
// Directly before the brand: a determiner or a possessive ("my skype"), a preposition ("on skype"),
// a verb that takes a tool as its object ("use skype"), or "to" after a verb of motion or change
// ("switch to skype"). The infinitive "to" ("want to skype") is not a noun cue.
const NOUN_CUE_BEFORE =
  /(?<![\p{L}'’])(?:a|an|the|my|your|his|her|our|their|its|this|that|on|via|over|through|with|by|in|into|from|of|for|about|using|use|uses|used|prefer|prefers|preferred|(?:switch|switched|switching|move|moved|moving|migrate|migrated|migrating|went|back|welcome|access|log|logged|sign|signed|in|on|up)[ \t]{1,8}to)[ \t]{1,8}$/iu;
// Directly after the brand: a noun that shows noun use ("skype account", "whatsapp groups").
const NOUN_AFTER =
  /^[ \t]{1,8}(?:account|call|chat|meeting|app|link|number|contact|group|message|video)s?(?![\p{L}\p{M}\p{N}_'’-])/iu;

/** The brand at `start`..`end` is an English noun: a noun cue directly before or after it. */
const brandNoun = (lang: string, text: string, start: number, end: number) =>
  lang === "en" &&
  (NOUN_CUE_BEFORE.test(text.slice(Math.max(0, start - 40), start)) ||
    NOUN_AFTER.test(text.slice(end, end + 24)));

/** A word this check spells its own way ("javascript" → "JavaScript"). */
export const hasCanonicalCasing = (word: string) =>
  CANONICAL.has(word.toLowerCase()) || ACRONYMS.has(word.toUpperCase());

/** Explicit names only; uppercase emphasis and identifier-like mixed casing stay untouched. */
export function canonicalCasing(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const words = /(?<![.\p{L}\p{M}\p{N}_'’@/#=$\\-])[A-Za-z]+(?![\p{L}\p{M}\p{N}_'’@/#=$\\-])/gu;
  words.lastIndex = ctx.from;
  for (
    let match = words.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = words.exec(ctx.scanText)
  ) {
    const typed = match[0];
    const acronym = typed.length < 5 && ctx.lang.startsWith("en") ? typed.toUpperCase() : "";
    const canonical =
      CANONICAL.get(typed.toLowerCase()) ??
      (ACRONYMS.has(acronym) &&
      /^[A-Z][a-z]+$/.test(typed) &&
      // "Ai Weiwei" is a name.
      !/^[ \t\u00a0]+[A-Z]/.test(ctx.text.slice(match.index + typed.length))
        ? acronym
        : undefined);
    if (!canonical || canonical === typed || ctx.dictionary.has(typed.toLowerCase())) continue;
    if (!/^[A-Z]?[a-z]+$/.test(typed)) continue;
    const start = match.index;
    const end = start + typed.length;
    if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(end, end + 2))) continue;
    if (
      OPENING_QUOTES.includes(ctx.text[start - 1] || "\n") &&
      /["”'’“‘»«›‹]/.test(ctx.text[end] ?? "")
    )
      continue;
    if (namedExampleBefore(ctx.text, start)) continue;
    if (VERB_BRANDS.has(typed) && !brandNoun(ctx.lang.slice(0, 2), ctx.text, start, end)) continue;
    findings.push({
      ruleId: "englishCanonicalCasing",
      messageKey: "review_msg_canonical_casing",
      range: { start, end },
      alternatives: [canonical],
      context: { start: Math.max(0, start - 128), end: Math.min(ctx.text.length, end + 2) },
    });
  }
  return findings;
}
