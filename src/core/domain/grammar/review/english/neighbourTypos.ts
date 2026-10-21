import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { type FixResult } from "./idioms5";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, nounOnly, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);

/** Only at a sentence start. */
const atStart =
  (fix: string) =>
  (m: RegExpExecArray, ctx: DetectContext): FixResult =>
    afterBreak(ctx, m.index) ? fix : null;
/** Not after a determiner ("the pleas", "a whit"). */
const notAfterDeterminer =
  (fix: string) =>
  (m: RegExpExecArray, ctx: DetectContext): FixResult =>
    DETERMINERS.has(wordBefore(ctx, m.index)) ? null : fix;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // pronoun and verb slips
  neighbourTyposThey: (m) => {
    const r = read(m.groups!.verb);
    return r?.verbs.some((v) => v.form === "base" || v.form === "past") && !r.noun && !r.adjective
      ? "them"
      : null;
  },
  neighbourTyposThe: (m) => {
    if (DETERMINERS.has(m.groups!.lead.toLowerCase())) return null;
    return /^(?:far|so|then|now)$/i.test(m.groups!.lead) ? ["they", "to"] : ["to", "they"];
  },
  neighbourTyposOther: (m) => (m.groups!.target === "other" ? "others" : null),
  // "This an all of the above", "in Dutch an already deleted": and. After a preposition or
  // a pronoun, "an already full room" and "to an also inactive unit" keep the article.
  neighbourTyposAn: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    const r = read(before);
    return !before ||
      FUNCTION_WORDS.has(before) ||
      /self$|selves$/.test(before) ||
      (r && !r.noun && !/ing$/.test(before))
      ? null
      : "and";
  },
  neighbourTyposI: atStart("In"),
  neighbourTyposHis: atStart("He's"),
  neighbourTyposPleas: notAfterDeterminer("please"),
  neighbourTyposWhit: notAfterDeterminer("with"),
  // "It will he turned on", "The door will he locked": a subject before the modal, then a
  // participle that cannot follow an inverted "he".
  neighbourTyposWill: (m) => {
    const lead = m.groups!.lead.toLowerCase();
    const after = m.groups!.after;
    const pronoun = /^(?:it|this|that|which|there)$/.test(lead);
    // "When will he…", "Only then will he…": an inverted question or clause.
    const noun =
      !FUNCTION_WORDS.has(lead) &&
      !/^(?:when|where|why|how|what|who|whom|whose|then|only|never|so|nor)$/.test(lead) &&
      !!read(lead)?.noun;
    const r = read(after);
    const participle =
      after === "ready" ||
      (!!r?.verbs.some((v) => v.form === "participle") &&
        !r.verbs.some((v) => v.form === "base" || v.form === "third"));
    // "his garbage can he had there": after a noun, "can he" + a past form may be a
    // relative clause. Only a participle that is no past form is sure.
    const sure = pronoun || (noun && !r?.verbs.some((v) => v.form === "past"));
    return sure && participle ? m.groups!.target.replace(/he$/i, "be") : null;
  },
  // Lowercase only: "Ned" is a name ("Will Ned help?").
  neighbourTyposNed: (m) => (m.groups!.target === "ned" ? "need" : null),
  neighbourTyposThan: atStart("Thank"),
  neighbourTyposA: (m) => m.groups!.target.replace(/precedence$/i, "precedent"),
  neighbourTyposA2: (m, ctx) =>
    /^[ \t ]*-/.test(ctx.text.slice(m.index + m[0].length))
      ? null
      : m.groups!.target.replace(/comma$/i, "coma"),
  neighbourTyposThe2: (m) => m.groups!.target.replace(/flew$/i, "flu"),
  neighbourTyposThat: (m, ctx) => (afterBreak(ctx, m.index) ? "That being said" : null),
  // "He did it in a hastily manner": the adjective before manner.
  neighbourTyposA3: (m) => {
    const word = m.groups!.target.toLowerCase();
    const r = read(word);
    if (!r?.adverb || r.adjective || r.noun) return null;
    const candidates = [
      word.replace(/ily$/, "y"),
      word.replace(/ically$/, "ical"),
      word.replace(/bly$/, "ble"),
      word.slice(0, -2),
    ];
    return candidates.find((c) => c !== word && !!read(c)?.adjective) ?? null;
  },
  neighbourTyposSometime: (m, ctx) =>
    afterBreak(ctx, m.index) &&
    read(m.groups!.verb)?.verbs.some((v) => v.form === "base" || v.form === "third")
      ? "Sometimes"
      : null,
  // "red nut white", "hexagonal nut square": not between two adjectives.
  neighbourTyposNut: (m) => {
    const adjective = (word: string) => !!read(word)?.adjective;
    return adjective(m.groups!.one) && adjective(m.groups!.two) ? "not" : null;
  },
  // "drop by an see what's up": and before a plain verb.
  neighbourTyposAn2: (m) => {
    const next = m.groups!.next;
    const after = m.groups!.after?.toLowerCase();
    const r = read(next);
    if (!r || FUNCTION_WORDS.has(next) || r.adjective) return null;
    // "drop by an see what's up": a plain verb with its object. A plural stays: "an arts
    // and crafts fair", "an innings of fifty".
    const verb =
      r.verbs.some((v) => v.form === "base" && v.lemma === next) &&
      !r.noun &&
      !!after &&
      !/^(?:and|or|with|from)$/.test(after);
    return verb ? "and" : null;
  },
  // "He said he company has", "what he problem is": the (or her) before a noun.
  neighbourTyposHe: (m) => {
    // "he first had to leave", "he alone was": an adverb or a function word after he.
    const noun = m.groups!.noun.toLowerCase();
    if (
      FUNCTION_WORDS.has(noun) ||
      /^(?:first|last|next|alone|himself|once|twice|soon|later)$/.test(noun)
    )
      return null;
    const r = read(noun);
    return m.groups!.target === "he" &&
      r?.noun &&
      !r.plural &&
      !r.verbs.length &&
      !r.adjective &&
      !r.adverb
      ? ["the", "her"]
      : null;
  },
  // "We evaluated out method", "Out time has come": our before a noun.
  neighbourTyposOut: (m, ctx) => {
    const r = read(m.groups!.noun);
    if (!r?.noun || r.verbs.length || r.adjective || FUNCTION_WORDS.has(m.groups!.noun))
      return null;
    if (m.groups!.lead) return "our";
    // At a sentence start the noun must have its verb next: "Out time has come".
    const v = read(m.groups!.next);
    return afterBreak(ctx, m.index) &&
      (/^(?:has|is|was|will|can|had)$/i.test(m.groups!.next) ||
        v?.verbs.some((x) => x.form === "third"))
      ? "our"
      : null;
  },
  // "if you father can help", "Now you current site is live": "your" before a noun subject.
  neighbourTyposYou: (m, ctx) => {
    // Only where a clause opens: "I told you lunch was ready" and "Without you life is
    // cruel" keep "you" as an object.
    const before = wordBefore(ctx, m.index);
    const opener = before
      ? /^(?:if|because|since|unless|once|now|otherwise|but|so)$/.test(before)
      : afterBreak(ctx, m.index);
    if (!opener || /\p{Lu}/u.test(m[0].slice(3))) return null;
    const mods = m
      .groups!.mods.trim()
      .split(/[ \t\u00a0]+/)
      .filter(Boolean);
    const words = [...mods, m.groups!.noun];
    // Modifiers are adjectives or nouns; the head is a singular noun. None is a verb.
    const fits = (word: string, head: boolean) => {
      if (YOUR_ADDRESS.test(word) || FUNCTION_WORDS.has(word)) return false;
      const r = read(word);
      if (!r) return nounOnly(word) === "singular";
      if (r.verbs.length || r.adverb || r.plural) return false;
      return head ? r.noun && !r.adjective : r.noun || r.adjective;
    };
    return words.every((word, i) => fits(word, i === words.length - 1)) ? "your" : null;
  },
  // "for you and you family": a second "you" before a noun.
  neighbourTyposYou2: (m) => (singularNoun(m.groups!.noun) ? "your" : null),
} satisfies Record<string, Fixer>;

const YOUR_ADDRESS =
  /^(?:two|three|four|sir|madam|man|dude|guy|bro|buddy|pal|mate|kid|boy|girl|honey|dear|darling|babe|baby|idiot|fool|genius|moron|jerk|liar|coward|loser|monster|angel|hero|lot|too|all|both|alone)$/;
/** A singular noun that is no verb and no form of address ("you idiot", "you sir"). */
const singularNoun = (word: string) =>
  !YOUR_ADDRESS.test(word) && !FUNCTION_WORDS.has(word) && nounOnly(word) === "singular";
