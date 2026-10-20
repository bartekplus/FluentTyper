import { englishNounPair, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  caseLike,
  DETERMINERS,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  OBJECT_PRONOUNS,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Small clause frames where only one word fits the slot: "hear form you" (from), "at there
// house" (their), "Peter though he…" (thought), "That sound great" (sounds), "All car are"
// (cars), "Please sent it" (send), "I no good at" (am not), "According Anna" (according to).
// The frames are in grammar/rules/en.yaml.

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

function push(
  ctx: DetectContext,
  rule: Rule,
  start: number,
  end: number,
  alternatives: string[],
  from = start,
): RawFinding {
  const typed = ctx.source.slice(start, end);
  return {
    ...rule,
    range: { start, end },
    alternatives: alternatives.map((a) => caseLike(typed, a)),
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, from, end),
  };
}

// "I wanted to priorities the task": a plural noun whose -ize verb the dictionary lists.
const INFINITIVE_HEADS =
  /^(?:want|wants|wanted|need|needs|needed|like|would|try|tries|tried|trying|have|has|had|going|able|decided|decide|plan|plans|planned|hope|hoped|forgot|remember|wish|wished|must|should|will|can|could)$/;

const NOT_OWNED =
  /^(?:is|are|was|were|be|been|being|will|would|can|could|should|may|might|must|has|have|had|and|or|but|so|yet|too|again|now|then|today|tomorrow|yesterday|tonight|somewhere|anywhere|everywhere|nowhere|instead|either|though|first|already|once|ever|soon|also|alone|together|until|later|before|after|right|over)$/;

// Predicate adjectives the dictionary also lists as nouns ("a great", "goods").
const EVALUATIVE = /^(?:great|good|fine|right|wrong|cool|fun|perfect|better|worse|ok|okay)$/;
const predicateAdjective = (word: string) => {
  const read = englishWordInfo(word);
  return (
    EVALUATIVE.test(word) ||
    (!!read?.adjective && !read.noun && !read.verbs.length && !FUNCTION_WORDS.has(word))
  );
};

const BE: Record<string, string> = {
  i: "am",
  you: "are",
  we: "are",
  they: "are",
  he: "is",
  she: "is",
  it: "is",
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  clauseFormFrom: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    if (ctx.dictionary.has("form") || m.groups!.target !== "form") return null;
    return push(ctx, CONFUSED, start, end, ["from"], m.index);
  },
  clauseToIesVerb: (m, ctx) => {
    const { target, stem } = m.groups!;
    if (ctx.dictionary.has(target) || !INFINITIVE_HEADS.test(wordBefore(ctx, m.index))) return null;
    const verb = `${stem}ize`;
    if (!englishWordInfo(verb)?.verbs.some((v) => v.form === "base" && v.lemma === verb))
      return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && !FUNCTION_WORDS.has(next.lower)) return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_to_base" },
      start,
      end,
      [verb],
      m.index,
    );
  },
  clauseAccordingTo: (m, ctx) => {
    // A clause opener: "According Anna" heads its sentence or follows a comma.
    if (
      !afterBreak(ctx, m.index) &&
      !/,[ \t ]*$/.test(ctx.text.slice(Math.max(0, m.index - 3), m.index))
    )
      return null;
    // "According however to…": an adverb before the "to".
    if (
      /^[ \t\u00a0]*[A-Za-z]+[ \t\u00a0]+to\b/i.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24),
      )
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    const lead = m.groups!.target.slice(0, "according".length);
    return push(
      ctx,
      { ruleId: "englishFixedPrepositions", messageKey: "review_msg_fixed_prepositions" },
      start,
      end,
      [`${lead} to`],
      m.index,
    );
  },
  clauseThereTheir: (m, ctx) => {
    const { first, second } = m.groups!;
    if (NOT_OWNED.test(first)) return null;
    const read = englishWordInfo(first);
    // An adjective may stand before the noun ("to there old parents").
    const adjective = !!read?.adjective && !read.verbs.length && !!second;
    const noun = adjective ? second : first;
    if (NOT_OWNED.test(noun) || FUNCTION_WORDS.has(noun)) return null;
    const nounRead = englishWordInfo(noun);
    if (!(nounOnly(noun) || (nounRead?.noun && !nounRead.adjective && !nounRead.adverb)))
      return null;
    // A noun-or-verb right after "there" may be a clause ("for there seem to be…").
    if (!adjective && nounRead?.verbs.length && !nounOnly(noun)) return null;
    const nounEnd = m.index + m[0].length - (adjective || !second ? 0 : second.length + 1);
    const after = tokensAfter(ctx, adjective ? m.index + m[0].length : nounEnd, 1)[0];
    // The noun phrase ends there: punctuation, a closed word or a verb, not another noun.
    if (
      after?.kind === "word" &&
      !FUNCTION_WORDS.has(after.lower) &&
      englishWordInfo(after.lower)?.noun
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishTheirThereTheyAre", messageKey: "review_msg_their_possessive" },
      start,
      end,
      ["their"],
      m.index,
    );
  },
  clauseThoughThought: (m, ctx) => {
    const { subject } = m.groups!;
    if (!afterBreak(ctx, m.index) || !/^[A-Z][a-z]+$/.test(subject)) return null;
    // A capitalized word opening the sentence must be a name, not "Even", "Concerned".
    if (
      /^(?:Even|As|And|But|So|Or|Yet|Although|Though|If|When|While|Because|Since|Then|This|That|It|There|Here|He|She|We|They|You)$/.test(
        subject,
      ) ||
      /(?:ed|ing|ly)$/.test(subject)
    )
      return null;
    // "Egotist though he was, …": a concessive clause closes on be before a comma.
    if (
      /^[ \t\u00a0]+(?:was|is|were|are|may[ \t\u00a0]+be|might[ \t\u00a0]+be)[ \t\u00a0]*[,;:—–-]/.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24),
      )
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    return push(ctx, CONFUSED, start, end, ["thought"], m.index);
  },
  clauseLinkingSingular: (m, ctx) => {
    const { subject, target, adjective } = m.groups!;
    if (subject !== subject.toLowerCase() && !afterBreak(ctx, m.index)) return null;
    // "Does that sound good?", "Make it look nice": do-support or a causative before.
    const before = wordBefore(ctx, m.index);
    if (
      /^(?:do|does|did|don['’]t|doesn['’]t|didn['’]t|will|would|can|could|should|may|might|must|make|makes|made|let|lets|help|helps|to|not)$/.test(
        before,
      ) ||
      /n['’]t$/.test(before)
    )
      return null;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|because|think|guess|hope|said|says|agree)$/.test(before)
    )
      return null;
    if (!predicateAdjective(adjective)) return null;
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      after?.kind === "word" &&
      !/^(?:to|for|and|but|or|now|today|enough|too|again)$/.test(after.lower)
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishSubjectVerbAgreement", messageKey: "review_msg_subject_verb" },
      start,
      end,
      [`${target}s`],
      m.index,
    );
  },
  clauseAllSingular: (m, ctx) => {
    const noun = m.groups!.target;
    if (FUNCTION_WORDS.has(noun) || ctx.dictionary.has(noun)) return null;
    // "All three were wounded": a number stands for its noun.
    if (
      /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|dozen)$/.test(
        noun,
      )
    )
      return null;
    const read = englishWordInfo(noun);
    // A plain singular noun with a regular plural ("car", "file"); mass nouns stay.
    // After "all" and before "are", a noun-or-verb ("window", "file") can only be the noun.
    if (
      !read?.noun ||
      read.plural ||
      read.adjective ||
      read.adverb ||
      read.verbs.some((v) => v.form !== "base")
    )
      return null;
    const plural = englishNounPair(noun)?.plural;
    if (!plural) return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" },
      start,
      end,
      [plural],
      m.index,
    );
  },
  clausePleasePast: (m, ctx) => {
    const { lead, target, object } = m.groups!;
    if (lead !== lead.toLowerCase() && !afterBreak(ctx, m.index)) return null;
    if (lead === lead.toLowerCase() && !afterBreak(ctx, m.index)) {
      // Mid-sentence: only after a comma or "so/and" ("…, please sent it").
      if (
        !/(?:,|\b(?:so|and|but|then))[ \t ]*$/i.test(
          ctx.text.slice(Math.max(0, m.index - 6), m.index),
        )
      )
        return null;
    }
    if (ctx.dictionary.has(target)) return null;
    if (!DETERMINERS.has(object) && !OBJECT_PRONOUNS.has(object)) return null;
    // "please did this help?": an auxiliary opens a question.
    if (/^(?:did|was|were|had|could|would|should|might)$/.test(target)) return null;
    const read = englishWordInfo(target);
    if (!read || read.noun || (read.adjective && !read.verbs.some((v) => v.form === "past")))
      return null;
    const forms = englishVerbForms(target);
    let base: string | null = null;
    // An irregular past that is no base ("sent", "gave"), or a regular -ed past.
    if (
      forms &&
      forms.past === target &&
      forms.lemma !== target &&
      !forms.ambiguous.includes(target)
    )
      base = forms.lemma;
    // "attached" reads as attach and attache: the shorter lemma is the verb.
    else if (!forms && /ed$/.test(target))
      base =
        read.verbs
          .filter((v) => v.form === "past")
          .map((v) => v.lemma)
          .sort((a, b) => a.length - b.length)[0] ?? null;
    if (!base || base === target) return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_please_base" },
      start,
      end,
      [base],
      m.index,
    );
  },
  clauseNoAdjective: (m, ctx) => {
    const { subject, adjective } = m.groups!;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|because|if|when|that)$/.test(wordBefore(ctx, m.index))
    )
      return null;
    if (!predicateAdjective(adjective)) return null;
    const [start, end] = m.indices!.groups!.target;
    return push(
      ctx,
      { ruleId: "englishSentenceStructure", messageKey: "review_msg_clause_be" },
      start,
      end,
      [`${BE[subject.toLowerCase()]} not`],
      m.index,
    );
  },
} satisfies Record<string, MatchFixer>;
