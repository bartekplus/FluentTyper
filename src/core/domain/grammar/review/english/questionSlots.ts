import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { afterBreak, caseLike, evidence } from "./slotWords";
import { finding } from "../finding";

// Auxiliaries in questions: a do-question keeps its verb bare ("how did he smiled" -> smile),
// one auxiliary leads ("Does anyone can help?" -> Can anyone help?, "Did you have entered" ->
// Have you entered), and a repeated auxiliary goes ("Can I can", "have already have").

/** The base of a past, -s or -ing verb form ("smiled", "says", "writing"), or null. */
function bareOf(word: string): string | null {
  const read = englishWordInfo(word);
  // Right after do + a pronoun subject only a verb fits, so "works" and "used" read as verbs.
  if (!read?.verbs.length) return null;
  if (word.endsWith("ing")) return englishLemma(word, "ing");
  if (word.endsWith("s")) return englishLemma(word, "third");
  const forms = englishVerbForms(word);
  if (forms && (forms.ambiguous.includes(word) || forms.lemma === word)) return null;
  if (!read.verbs.some((v) => v.form === "past")) return null;
  return englishLemma(word, "past");
}

// Verbs that a causative's object does rather than becomes: "make it works", "makes me wonders".
const CAUSED =
  /^(?:works|happens|runs|seems|sounds|looks|fails|moves|stops|loads|starts|compiles|crashes|fits|appears|disappears|lasts|stays|loops|wonders|laughs|smiles|cries|thinks|feels|realizes|believes|wants|wishes|forgets|remembers|knows|understands)$/;

const auxiliary = (
  ctx: DetectContext,
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
): RawFinding =>
  finding("englishAuxiliaryBaseVerb", messageKey, start, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, start, end),
  });

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  questionDoBase: (m, ctx) => {
    const verb = m.groups!.verb;
    if (verb !== verb.toLowerCase() || ctx.dictionary.has(verb)) return null;
    // "what did he used to do" still wants "use". After who/which, "it" and "you" may be the
    // object of do: "the shop who does it tells me".
    // "What do you guys think?": a plural noun in apposition to you/we/they.
    const lead = m[0].slice(0, -verb.length);
    if (/s$/.test(verb) && englishWordInfo(verb)?.noun && /\b(?:you|we|they)\s+$/i.test(lead))
      return null;
    const base = bareOf(verb);
    if (!base || base === verb || base === "be") return null;
    const [start, end] = m.indices!.groups!.verb;
    return auxiliary(ctx, "review_msg_auxiliary_base", start, end, [caseLike(verb, base)]);
  },
  questionDoModal: (m, ctx) => {
    const { aux, subject, modal, verb } = m.groups!;
    // A clause start or a question word right before the auxiliary.
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (
      !afterBreak(ctx, m.index) &&
      !/\b(?:what|how|why|where|when|which)[ \t\u00a0]+$/i.test(before)
    )
      return null;
    if (hasUserOrCasedWord(ctx, `${subject} ${modal} ${verb}`)) return null;
    // The modal must be the auxiliary: a base verb after it ("can provide", "would like").
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) return null;
    const [start, end] = m.indices!.groups!.target;
    const lead = caseLike(aux, modal.toLowerCase());
    return auxiliary(ctx, "review_msg_question_auxiliary", start, end, [`${lead}${subject}`]);
  },
  questionDidPerfect: (m, ctx) => {
    const { aux, subject, verb } = m.groups!;
    if (!afterBreak(ctx, m.index) || hasUserOrCasedWord(ctx, `${subject} ${verb}`)) return null;
    const read = englishWordInfo(verb);
    // "Did you have fun", "Did they have lunch": have is the main verb there.
    if (verb !== "been" && !read?.verbs.some((v) => v.form === "participle")) return null;
    if (read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) return null;
    const plural = /^\s*(?:i|you|we|they)$/i.test(subject.trim());
    const [start, end] = m.indices!.groups!.target;
    const lead = caseLike(aux, plural ? "have" : "has");
    return auxiliary(ctx, "review_msg_question_auxiliary", start, end, [`${lead}${subject}`]);
  },
  questionRepeatedModal: (m, ctx) => {
    const { first, subject, second } = m.groups!;
    if (first.toLowerCase() !== second.toLowerCase() || !afterBreak(ctx, m.index)) return null;
    const question = /^[^.!\n]*\?/.test(ctx.text.slice(m.index, m.index + 160));
    const asked = `${first}${subject}`;
    const told = `${caseLike(first, subject.trim())} ${second.toLowerCase()}`;
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    return auxiliary(
      ctx,
      "review_msg_repeated_auxiliary",
      start,
      end,
      question ? [asked] : [asked, told],
    );
  },
  questionRepeatedHave: (m, ctx) => {
    const { first, adverb, second } = m.groups!;
    if (first.toLowerCase() !== second.toLowerCase()) return null;
    // "have already had" is fine; only the same form twice.
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    return auxiliary(ctx, "review_msg_repeated_auxiliary", start, end, [
      caseLike(first, `${adverb} ${second}`),
      `${first} ${adverb}`,
    ]);
  },
  questionCausative: (m, ctx) => {
    const verb = m.groups!.verb;
    const have = /^ha/i.test(m.groups!.head);
    const reaction = CAUSED.test(verb);
    // "have them ready", "had it fixed": have only with a verb that cannot be a noun object.
    if (have && !reaction) return null;
    if (ctx.dictionary.has(verb)) return null;
    // "the board you made me has been\u2026": an auxiliary there is the outer clause's verb.
    if (/^(?:has|is|was|does)$/.test(verb) && !/^let/i.test(m.groups!.head)) return null;
    // "The person who made it seems happy": a relative clause ends at the object.
    if (
      /\b(?:who|that|which|whom)[ \t\u00a0]{1,8}$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      return null;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "third")) return null;
    if (/^[ \t\u00a0]{1,8}of\b/i.test(ctx.text.slice(m.index + m[0].length))) return null;
    // "made us friends", "makes them objects of lust", "makes me nuts": a plural noun
    // complement; only an adverb, adjective or particle after it shows the verb.
    if (read.noun || read.plural) {
      const tail = ctx.text.slice(m.index + m[0].length);
      // "make it works.", "makes me wonders,": a verb no one makes into a plural object, at the
      // clause end.
      const closed = reaction && /^[ \t\u00a0]*(?:[.!?,;:)\n]|$)/.test(tail);
      const next = /^[ \t\u00a0]{1,8}([a-z]+)/.exec(tail)?.[1];
      if (!next && !closed) return null;
      if (next && !/^(?:up|out|down|like|well|better|fine|again|now)$/.test(next)) {
        const after = englishWordInfo(next);
        if (!after || after.noun || after.plural || after.verbs.length) return null;
      }
    }
    const base = englishLemma(verb, "third");
    if (!base || base === verb) return null;
    const [start, end] = m.indices!.groups!.verb;
    return {
      ruleId: "englishVerbComplements",
      messageKey: "review_msg_causative_base",
      range: { start, end },
      alternatives: [caseLike(verb, base)],
      context: evidence(ctx, m.index, end),
    };
  },
} satisfies Record<string, MatchFixer>;
