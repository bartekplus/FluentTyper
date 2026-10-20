import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import type { Fixer } from "../../engine/reviewRules";

/** CLAUSE ends at `index`: only spaces or tabs back to a clause mark or the text start. */
function afterClause(text: string, index: number): boolean {
  while (index > 0 && (text[index - 1] === " " || text[index - 1] === "\t")) index--;
  return index === 0 || ".!?,;:(\n".includes(text[index - 1]);
}
// Closed-class words that cannot fill the adjective slot of "on a … basis".
const NOT_BASIS_ADJECTIVE = new Set(
  "a an the this that these those which what whose each every its his her their our my your any some no one such same another either neither whichever whatever".split(
    " ",
  ),
);
const OBJECT = /^(?:him|her|them|us|me|you|it|my|your|his|their|our|its)$/i;
const SUBJECT = /^(?:I|he|she|we|they|you|it|who|then|soon|and|later)$/i;
const EMAIL: Record<string, string> = {
  send: "email",
  sends: "emails",
  sent: "emailed",
  sending: "emailing",
};
const word = (text: string, at: number) =>
  /(\p{L}[\p{L}'’]*)[ \t ]*$/u.exec(text.slice(Math.max(0, at - 32), at))?.[1] ?? "";

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  basisArticle: (m) => {
    const adj = m.groups!.target;
    const known = englishWordInfo(
      adj
        .toLowerCase()
        .replace(/^bi[ \t\u00a0-]*/, "")
        .split("-")[0],
    );
    if (!known || NOT_BASIS_ADJECTIVE.has(adj.toLowerCase())) return null;
    // The lexicon knows the word, thus it is not spelled out ("HOURLY" is "hourly").
    // Use "a" when people say the word with the two articles ("a historic").
    const an = englishInitialSound(adj.toLowerCase()) === "vowel" ? "an" : "a";
    return `${adj === adj.toUpperCase() ? an.toUpperCase() : an} ${adj}`;
  },
  laughAt: (m) => {
    const { verb, next } = m.groups!;
    if (/s$/i.test(verb) && afterClause(m.input, m.index)) return null;
    return OBJECT.test(next) || /^\p{Lu}\p{Ll}+$/u.test(next) ? "at" : null;
  },
  veryMuchSo: (m) => {
    const next = m.groups!.next.toLowerCase();
    if (
      /^(?:that|this|it|i|we|you|he|she|they|in|on|at|for|and|but|or|if|as|too|far|long|much|many|well|good|soon|fast)$/.test(
        next,
      )
    )
      return null;
    return englishWordInfo(next)?.verbs.length ? "" : null;
  },
  leaveTo: (m) => {
    const { verb, next } = m.groups!;
    if (!/^\p{Lu}\p{Ll}+$/u.test(next) || /^(?:I|God|Right|Left|Top|Bottom)$/.test(next))
      return null;
    if (/^left$/i.test(verb) && !SUBJECT.test(word(m.input, m.index))) return null;
    return "for";
  },
  sendEmailTo: (m) => {
    const next = m.groups!.next.toLowerCase();
    const info = englishWordInfo(next);
    // A noun closing the clause is the recipient: "send an email to support."
    const recipient =
      !!info?.noun &&
      /^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(
        m.input.slice(m.index + m[0].length, m.index + m[0].length + 9),
      );
    if (!OBJECT.test(next) && !recipient && info?.verbs.some((v) => v.form === "base")) return null;
    return EMAIL[m.groups!.verb.toLowerCase()];
  },
} satisfies Record<string, Fixer>;
