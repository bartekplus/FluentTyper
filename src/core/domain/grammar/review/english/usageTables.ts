import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { table } from "./tables";

// Contractions split by a space, holiday names with their apostrophes, and optional plain-style
// rewrites of wordy phrases.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES = table("usageTables.phrases");

export const STYLE = table("usageTables.style");

// ---------------------------------------------------------------------------- frames

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const STYLE_RULE: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };
const info = (word: string) => englishWordInfo(word.toLowerCase());

/** The -ly adverb of an adjective, when the dictionary lists it: hasty -> hastily. */
function adverbOf(adjective: string): string | null {
  const a = adjective.toLowerCase();
  const form = a.endsWith("ic")
    ? `${a}ally`
    : /[^aeiou]y$/.test(a)
      ? `${a.slice(0, -1)}ily`
      : /[^aeiou]le$/.test(a)
        ? `${a.slice(0, -1)}y`
        : `${a}ly`;
  return info(a)?.adjective && info(form)?.adverb ? form : null;
}

/** A style finding on the `target` group; the alternatives take the typed initial capital. */
const styled =
  (alternatives: (m: RegExpExecArray) => string[] | null): MatchFixer =>
  (m, ctx) => {
    const alts = alternatives(m);
    if (!alts) return null;
    const [start, end] = m.indices!.groups!.target;
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const typed = ctx.text.slice(start, end);
    const cased = alts.map((alt) =>
      /^\p{Lu}/u.test(typed) ? alt[0].toUpperCase() + alt.slice(1) : alt,
    );
    return {
      ...STYLE_RULE,
      range: { start, end },
      alternatives: cased,
      ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    };
  };

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  mannerAdverb: styled((m) => {
    const adverb = adverbOf(m.groups!.adjective);
    return adverb ? [adverb] : null;
  }),
  sendEmail: styled((m) => {
    const { verb, object, mail } = m.groups!;
    const form = { send: "", sends: "s", sent: "ed", sending: "ing" }[verb.toLowerCase()];
    return form === undefined ? null : [`${mail.toLowerCase()}${form} ${object}`];
  }),
  notAdjective: styled((m) => {
    const adjective = m.groups!.adjective.toLowerCase();
    if (!info(adjective)?.adjective) return null;
    const negative = ["un", "in", "im", "ir", "il"]
      .map((prefix) => prefix + adjective)
      .find((word) => {
        const entry = info(word);
        return !!entry?.adjective && !entry.verbs.length;
      });
    return negative ? [negative] : null;
  }),
  contractionCase: (m, ctx) => {
    // The match start owns it.
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const { head, mark, tail } = m.groups!;
    const tailHasUpper = tail !== tail.toLowerCase();
    if (!tailHasUpper || (head === head.toUpperCase() && tail === tail.toUpperCase())) return null;
    if (ctx.dictionary.has(`${head}${mark}${tail}`.toLowerCase())) return null;
    const start = m.index + head.length + mark.length;
    return {
      ruleId: "englishContractionNormalization",
      messageKey: "review_msg_contraction",
      range: { start, end: start + tail.length },
      alternatives: [tail.toLowerCase()],
      context: { start: m.index, end: start + tail.length },
    };
  },
} satisfies Record<string, MatchFixer>;
