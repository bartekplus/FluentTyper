import { adverb } from "./english/slotWords";
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

// Brands people use as lowercase verbs ("we skype", "je skype", "I'll facetime you"). In a verb
// context they stay lowercase; as a noun ("my skype account", "on skype") they get the brand casing.
// The inflected forms ("skyped", "facetiming") are not in CANONICAL, so this check never sees them.
// Not "fedex": the NAMES table in english/properNames.ts recases the verb form "fedexed" too.
const VERB_BRANDS = new Set(["skype", "facetime", "whatsapp", "snapchat", "paypal"]);
const SUBJECT_BEFORE: Record<string, RegExp> = {
  en: /(?<![\p{L}'’])(?:I|you|we|they|he|she|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
  fr: /(?<![\p{L}'’])(?:je|tu|il|elle|on|nous|vous|ils|elles|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
  de: /(?<![\p{L}'’])(?:ich|du|er|sie|wir|ihr|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
};
// English only. A modal or an auxiliary ("will", "can't", "I'll", "you'd") or the infinitive "to"
// directly before the brand.
const AUXILIARY_BEFORE =
  /(?<![\p{L}'’])(?:will|would|can|could|shall|should|may|might|must|do|does|did|cannot|won['’]t|can['’]t|don['’]t|doesn['’]t|didn['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t|\p{L}{1,30}['’](?:ll|d)|to)[ \t]{1,8}$/iu;
// "switch to skype", "move to whatsapp": here "to" is a preposition and the brand is a noun.
const PREPOSITION_TO_BEFORE =
  /(?<![\p{L}'’])(?:switch|switched|switching|move|moved|moving|migrate|migrated|migrating|went|back|welcome|access|log|logged|sign|signed|in|on|up)[ \t]{1,8}to[ \t]{1,8}$/iu;
// A determiner or a preposition directly before the brand makes it a noun ("a facetime call").
const NOUN_CUE_BEFORE =
  /(?<![\p{L}'’])(?:a|an|the|my|your|his|her|our|their|its|this|that|on|via|over|through|with|by|in|into|from|of|for|about|using|use|uses|used)[ \t]{1,8}$/iu;
// An object pronoun directly after the brand ("skype me", "facetime them").
const OBJECT_AFTER = /^[ \t]{1,8}(?:me|you|him|her|us|them|it)(?![\p{L}\p{M}\p{N}_'’-])/u;
// In English, adverbs can go between the subject or the auxiliary and the verb ("we often skype",
// "I'll not skype"). The guard skips a maximum of two of them.
const WORD_BEFORE = /(?<![\p{L}'’])(\p{Ll}{2,30})[ \t]{1,8}$/u;
const FREQUENCY_ADVERBS = new Set(
  "often always never sometimes usually still also just rarely not".split(" "),
);
const subjectAdverb = (word: string) =>
  FREQUENCY_ADVERBS.has(word) || /ly$/.test(word) || adverb(word);

/** The verb context directly before a brand: a subject, a modal or auxiliary, or infinitive "to". */
function verbCueBefore(lang: string, before: string): boolean {
  if (SUBJECT_BEFORE[lang]?.test(before)) return true;
  return lang === "en" && AUXILIARY_BEFORE.test(before) && !PREPOSITION_TO_BEFORE.test(before);
}

/**
 * The brand at `start`..`end` is used as a verb: a verb cue before it (after a maximum of two
 * English adverbs), or an English object pronoun after it. A determiner or a preposition directly
 * before it makes it a noun.
 */
function brandVerb(lang: string, text: string, start: number, end: number): boolean {
  let before = text.slice(Math.max(0, start - 120), start);
  if (lang === "en" && NOUN_CUE_BEFORE.test(before)) return false;
  if (lang === "en" && OBJECT_AFTER.test(text.slice(end, end + 16))) return true;
  for (let skipped = 0; !verbCueBefore(lang, before); skipped++) {
    if (lang !== "en" || skipped === 2) return false;
    const word = WORD_BEFORE.exec(before);
    if (!word || !subjectAdverb(word[1])) return false;
    before = before.slice(0, word.index);
  }
  return true;
}

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
    if (VERB_BRANDS.has(typed) && brandVerb(ctx.lang.slice(0, 2), ctx.text, start, end)) continue;
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
