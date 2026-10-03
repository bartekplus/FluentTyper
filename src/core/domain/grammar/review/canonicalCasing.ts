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

// Brands people conjugate as lowercase verbs ("we skype", "je skype", "Paul facetime"): after a
// subject pronoun or a name they stay.
const VERB_BRANDS = new Set(["skype", "facetime"]);
const SUBJECT_BEFORE: Record<string, RegExp> = {
  en: /(?<![\p{L}'’])(?:I|you|we|they|he|she|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
  fr: /(?<![\p{L}'’])(?:je|tu|il|elle|on|nous|vous|ils|elles|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
  de: /(?<![\p{L}'’])(?:ich|du|er|sie|wir|ihr|\p{Lu}\p{Ll}{1,30})[ \t]{1,8}$/u,
};
// In English, adverbs can go between the subject and the verb ("we often skype", "Paul regularly
// facetime"). The guard skips a maximum of two of them.
const WORD_BEFORE = /(?<![\p{L}'’])(\p{Ll}{2,30})[ \t]{1,8}$/u;
const FREQUENCY_ADVERBS = new Set(
  "often always never sometimes usually still also just rarely".split(" "),
);
const subjectAdverb = (word: string) =>
  FREQUENCY_ADVERBS.has(word) || /ly$/.test(word) || adverb(word);

/** A subject, and a maximum of two English adverbs, directly before a lowercase brand verb. */
function subjectBefore(lang: string, before: string): boolean {
  const subject = SUBJECT_BEFORE[lang];
  if (!subject) return false;
  for (let skipped = 0; !subject.test(before); skipped++) {
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
    if (
      VERB_BRANDS.has(typed) &&
      subjectBefore(ctx.lang.slice(0, 2), ctx.text.slice(Math.max(0, start - 120), start))
    )
      continue;
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
