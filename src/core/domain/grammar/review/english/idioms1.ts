import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";

const CONDITIONAL = new Set([
  "possible",
  "necessary",
  "needed",
  "required",
  "appropriate",
  "available",
]);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  goAheadAnd: (m) => (hasVerbForm(m.groups!.verb, "base") ? "and" : null),
  causeItIs: (m) => {
    const before = /([a-z]+)\s+$/i.exec(m.input.slice(Math.max(0, m.index - 40), m.index));
    const info = before && englishWordInfo(before[1].toLowerCase());
    return info?.adjective && !info.adverb && !info.noun && !info.verbs.length ? null : "because";
  },
  doNotCan: (m) =>
    hasVerbForm(m.groups!.verb, "base")
      ? m.groups!.aux.toLowerCase() === "did"
        ? "couldn't"
        : "can't"
      : null,
  kindOfOff: (m) => `${m.groups!.word.toLowerCase()} of`,
  kindIf: (m) => {
    const next = m.groups!.next.toLowerCase();
    if (next === "a" || next === "an") return "kind of";
    const info = englishWordInfo(next);
    const adjective = info?.adjective || info?.verbs.some((v) => v.form === "participle");
    return adjective && !CONDITIONAL.has(next) ? "kind of" : null;
  },
  // "arrive Monday" is common American usage; "arrive on Monday" is the neutral form.
  arriveOnDay: (m) => `${m.groups!.verb} on `,
} satisfies Record<string, Fixer>;
