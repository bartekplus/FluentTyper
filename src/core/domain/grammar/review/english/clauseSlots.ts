import { englishNounPair, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  DETERMINERS,
  english,
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

// "She wold like…": would after a subject; "the wold" stays (open country).
export const PHRASES: readonly PhraseRow[] = ["i", "you", "he", "she", "we", "they", "it"].map(
  (subject): PhraseRow => [`${subject} wold`, `${subject} would`],
);
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  rule: Rule,
  start: number,
  end: number,
  alternatives: string[],
  from = start,
): void {
  const typed = ctx.source.slice(start, end);
  findings.push({
    ...rule,
    range: { start, end },
    alternatives: alternatives.map((a) => caseLike(typed, a)),
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, from, end),
  });
}

const OBJECT_START =
  "(?:me|you|him|her|us|them|it|the|a|an|my|your|his|our|their|its|this|that|these|those|all|both)";

// Verbs and adverbs of source or motion that take "from": "hear form you", "come form the".
// idioms3 owns "apart form".
const FROM_LEAD =
  "hear|heard|hearing|come|comes|came|coming|away|aside|far|derived|received|receive|got|get|gets|bought|borrowed|took|taken|returned|return|arrived|arrive|moved|graduated|downloaded|copied|sent|fled|escaped|removed|deleted|resigned|retired|suffer|suffers|suffered|benefit|benefits|benefited|benefitted";
const FORM_FROM = `(?:${FROM_LEAD})(?:${S}(?:it|them|one|this|that))?${S}(?<target>form)(?:${S}${OBJECT_START}${E}|(?=[ \\t\\u00a0]*[?!.,;:)]))`;

function formFrom(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, FORM_FROM)) {
    const [start, end] = m.indices!.groups!.target;
    if (ctx.dictionary.has("form") || m.groups!.target !== "form") continue;
    push(ctx, findings, CONFUSED, start, end, ["from"], m.index);
  }
  return findings;
}

// "I wanted to priorities the task": a plural noun whose -ize verb the dictionary lists.
const INFINITIVE_HEADS =
  /^(?:want|wants|wanted|need|needs|needed|like|would|try|tries|tried|trying|have|has|had|going|able|decided|decide|plan|plans|planned|hope|hoped|forgot|remember|wish|wished|must|should|will|can|could)$/;
const TO_IES = `to${S}(?<target>(?<stem>[a-z]{3,})ies)${E}`;

function toIesVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, TO_IES)) {
    const { target, stem } = m.groups!;
    if (ctx.dictionary.has(target) || !INFINITIVE_HEADS.test(wordBefore(ctx, m.index))) continue;
    const verb = `${stem}ize`;
    if (!englishWordInfo(verb)?.verbs.some((v) => v.form === "base" && v.lemma === verb)) continue;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && !FUNCTION_WORDS.has(next.lower)) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_to_base" },
      start,
      end,
      [verb],
      m.index,
    );
  }
  return findings;
}

// "According Anna, …": according takes "to" (archaic "according as" aside).
// A wrong preposition after it is replaced: "According about a survey".
const ACCORDING = `(?<target>according(?:${S}(?<wrong>about|on|with|for|from|by|of|at))?)${S}(?!(?:to|as|ly)${E})(?=[A-Za-z])`;

function accordingTo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ACCORDING)) {
    // A clause opener: "According Anna" heads its sentence or follows a comma.
    if (
      !afterBreak(ctx, m.index) &&
      !/,[ \t ]*$/.test(ctx.text.slice(Math.max(0, m.index - 3), m.index))
    )
      continue;
    // "According however to…": an adverb before the "to".
    if (
      /^[ \t\u00a0]*[A-Za-z]+[ \t\u00a0]+to\b/i.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24),
      )
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    const lead = m.groups!.target.slice(0, "according".length);
    push(
      ctx,
      findings,
      { ruleId: "englishFixedPrepositions", messageKey: "review_msg_fixed_prepositions" },
      start,
      end,
      [`${lead} to`],
      m.index,
    );
  }
  return findings;
}

// "They yelled at there son": after a preposition, "there" before a plain noun is "their".
const PREPOSITION_THERE = `(?:at|to|for|with|of|from|about|by|into|onto|toward|towards|without|against|like)${S}(?<target>there)${S}(?<first>[a-z]+)(?:${S}(?<second>[a-z]+))?${E}`;
const NOT_OWNED =
  /^(?:is|are|was|were|be|been|being|will|would|can|could|should|may|might|must|has|have|had|and|or|but|so|yet|too|again|now|then|today|tomorrow|yesterday|tonight|somewhere|anywhere|everywhere|nowhere|instead|either|though|first|already|once|ever|soon|also|alone|together|until|later|before|after|right|over)$/;

function thereTheir(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PREPOSITION_THERE)) {
    const { first, second } = m.groups!;
    if (NOT_OWNED.test(first)) continue;
    const read = englishWordInfo(first);
    // An adjective may stand before the noun ("to there old parents").
    const adjective = !!read?.adjective && !read.verbs.length && !!second;
    const noun = adjective ? second : first;
    if (NOT_OWNED.test(noun) || FUNCTION_WORDS.has(noun)) continue;
    const nounRead = englishWordInfo(noun);
    if (!(nounOnly(noun) || (nounRead?.noun && !nounRead.adjective && !nounRead.adverb))) continue;
    // A noun-or-verb right after "there" may be a clause ("for there seem to be…").
    if (!adjective && nounRead?.verbs.length && !nounOnly(noun)) continue;
    const nounEnd = m.index + m[0].length - (adjective || !second ? 0 : second.length + 1);
    const after = tokensAfter(ctx, adjective ? m.index + m[0].length : nounEnd, 1)[0];
    // The noun phrase ends there: punctuation, a closed word or a verb, not another noun.
    if (
      after?.kind === "word" &&
      !FUNCTION_WORDS.has(after.lower) &&
      englishWordInfo(after.lower)?.noun
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishTheirThereTheyAre", messageKey: "review_msg_their_possessive" },
      start,
      end,
      ["their"],
      m.index,
    );
  }
  return findings;
}

// "Peter though he could win": a name, then though, then a clause's subject: "thought"
// (englishUsagePhrases owns "I/we/he though").
const THOUGH = `(?<subject>[A-Z][a-z]+)${S}(?<target>though)${S}(?:I|you|he|she|it|we|they|that)${E}`;

function thoughThought(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, THOUGH, "target")) {
    const { subject } = m.groups!;
    if (!afterBreak(ctx, m.index) || !/^[A-Z][a-z]+$/.test(subject)) continue;
    // A capitalized word opening the sentence must be a name, not "Even", "Concerned".
    if (
      /^(?:Even|As|And|But|So|Or|Yet|Although|Though|If|When|While|Because|Since|Then|This|That|It|There|Here|He|She|We|They|You)$/.test(
        subject,
      ) ||
      /(?:ed|ing|ly)$/.test(subject)
    )
      continue;
    // "Egotist though he was, …": a concessive clause closes on be before a comma.
    if (
      /^[ \t\u00a0]+(?:was|is|were|are|may[ \t\u00a0]+be|might[ \t\u00a0]+be)[ \t\u00a0]*[,;:—–-]/.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24),
      )
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, CONFUSED, start, end, ["thought"], m.index);
  }
  return findings;
}

// Predicate adjectives the dictionary also lists as nouns ("a great", "goods").
const EVALUATIVE = /^(?:great|good|fine|right|wrong|cool|fun|perfect|better|worse|ok|okay)$/;
const predicateAdjective = (word: string) => {
  const read = englishWordInfo(word);
  return (
    EVALUATIVE.test(word) ||
    (!!read?.adjective && !read.noun && !read.verbs.length && !FUNCTION_WORDS.has(word))
  );
};

// "That sound great", "it look nice": a linking verb after a singular pronoun takes -s.
const LINKING = `(?<subject>that|this|it)${S}(?<target>sound|look|seem|feel|smell|taste)${S}(?<adjective>[a-z]+)${E}`;

function linkingSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, LINKING, "target")) {
    const { subject, target, adjective } = m.groups!;
    if (subject !== subject.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    // "Does that sound good?", "Make it look nice": do-support or a causative before.
    const before = wordBefore(ctx, m.index);
    if (
      /^(?:do|does|did|don['’]t|doesn['’]t|didn['’]t|will|would|can|could|should|may|might|must|make|makes|made|let|lets|help|helps|to|not)$/.test(
        before,
      ) ||
      /n['’]t$/.test(before)
    )
      continue;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|because|think|guess|hope|said|says|agree)$/.test(before)
    )
      continue;
    if (!predicateAdjective(adjective)) continue;
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      after?.kind === "word" &&
      !/^(?:to|for|and|but|or|now|today|enough|too|again)$/.test(after.lower)
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishSubjectVerbAgreement", messageKey: "review_msg_subject_verb" },
      start,
      end,
      [`${target}s`],
      m.index,
    );
  }
  return findings;
}

// "All car are moving": "all" before a singular count noun and a plural verb.
const ALL_SINGULAR = `(?<lead>all)${S}(?<target>[a-z]+)${S}(?:are|were|have|do|seem|look|need)${E}`;

function allSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ALL_SINGULAR, "target")) {
    const noun = m.groups!.target;
    if (FUNCTION_WORDS.has(noun) || ctx.dictionary.has(noun)) continue;
    // "All three were wounded": a number stands for its noun.
    if (
      /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|dozen)$/.test(
        noun,
      )
    )
      continue;
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
      continue;
    const plural = englishNounPair(noun)?.plural;
    if (!plural) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" },
      start,
      end,
      [plural],
      m.index,
    );
  }
  return findings;
}

// "Please sent the file": please opens an imperative, which takes the base verb.
const PLEASE = `(?<lead>please)${S}(?<target>[a-z]+)${S}(?<object>[a-z]+)${E}`;

function pleasePast(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PLEASE, "target")) {
    const { lead, target, object } = m.groups!;
    if (lead !== lead.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    if (lead === lead.toLowerCase() && !afterBreak(ctx, m.index)) {
      // Mid-sentence: only after a comma or "so/and" ("…, please sent it").
      if (
        !/(?:,|\b(?:so|and|but|then))[ \t ]*$/i.test(
          ctx.text.slice(Math.max(0, m.index - 6), m.index),
        )
      )
        continue;
    }
    if (ctx.dictionary.has(target)) continue;
    if (!DETERMINERS.has(object) && !OBJECT_PRONOUNS.has(object)) continue;
    // "please did this help?": an auxiliary opens a question.
    if (/^(?:did|was|were|had|could|would|should|might)$/.test(target)) continue;
    const read = englishWordInfo(target);
    if (!read || read.noun || (read.adjective && !read.verbs.some((v) => v.form === "past")))
      continue;
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
    if (!base || base === target) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_please_base" },
      start,
      end,
      [base],
      m.index,
    );
  }
  return findings;
}

// "I no good at math": a subject, "no" and a predicate adjective lack "am not".
const NO_ADJECTIVE = `(?<subject>I|you|we|they|he|she|it)${S}(?<target>no)${S}(?<adjective>[a-z]+)${E}`;
const BE: Record<string, string> = {
  i: "am",
  you: "are",
  we: "are",
  they: "are",
  he: "is",
  she: "is",
  it: "is",
};

function noAdjective(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, NO_ADJECTIVE, "target")) {
    const { subject, adjective } = m.groups!;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|because|if|when|that)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    if (!predicateAdjective(adjective)) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      { ruleId: "englishSentenceStructure", messageKey: "review_msg_clause_be" },
      start,
      end,
      [`${BE[subject.toLowerCase()]} not`],
      m.index,
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(formFrom, thoughThought) },
  { rules: ["englishAuxiliaryBaseVerb"], detect: english(toIesVerb, pleasePast) },
  { rules: ["englishFixedPrepositions"], detect: english(accordingTo) },
  { rules: ["englishTheirThereTheyAre"], detect: english(thereTheir) },
  { rules: ["englishSubjectVerbAgreement"], detect: english(linkingSingular) },
  { rules: ["englishNounNumber"], detect: english(allSingular) },
  { rules: ["englishSentenceStructure"], detect: english(noAdjective) },
];
