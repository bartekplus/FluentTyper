import { group, hasUserOrCasedWord, opensSentence, plainToken } from "./phraseTemplates";
import { AGREEMENT_CORRECTIONS } from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { englishInflect, englishLemma } from "../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import {
  englishNounForms,
  knownEnglishNounNumber,
} from "../implementations/helpers/EnglishNounNumber";
import { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import {
  ENGLISH_MASS_NOUNS,
  MASS_WITH_COUNT_SENSE,
} from "../implementations/helpers/EnglishCountability";
import { atClauseStart } from "./englishParticiples";
import { COLLECTIVE } from "./english/agreementSlots";
import { nounNumber } from "./english/nounNumberSlots";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../engine/reviewRules";

/** Only a clause opening establishes the subject; do not reinterpret object pronouns. */
function clauseVerb(
  ctx: DetectContext,
  match: RegExpExecArray,
  anywhere: (match: RegExpExecArray, before: string) => boolean = () => false,
): boolean {
  const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
  if (!atClauseStart(ctx.text, match.index) && !anywhere(match, before)) return false;
  return plainToken(ctx, match.groups!.verb);
}

const PLURAL_BE: Readonly<Record<string, string>> = { is: "are", am: "are", was: "were" };
const SINGULAR_BE: Readonly<Record<string, string>> = { are: "is", am: "is", were: "was" };

// "I" is only ever a subject, so it needs no clause start; a capitalized word before it (a title or
// numeral: "Part I is", "World War I") or a coordination ("Sam and I are") abstains.
// A lowercase "i" is a variable as often as the pronoun; "i are" can only be the pronoun.
const subjectI = (match: RegExpExecArray, before: string) =>
  ((match.groups!.subject === "i"
    ? /^are$/i.test(match.groups!.verb)
    : match.groups!.subject === "I" && !/\p{Lu}[\p{L}.]*[ \t\u00a0]+$/u.test(before)) &&
    !/\b(?:and|or|nor)[ \t\u00a0]+$/i.test(before)) ||
  // "I hope he go away": a clause after a verb of thinking or saying (not "I suggest he go").
  (/^(?:he|she|it)$/.test(match.groups!.subject) &&
    /\b(?:hope|hoped|think|thought|guess|believe|believed|sure|glad|afraid)[ \t\u00a0]+$/i.test(
      before,
    ));

/** Additional finished-text coverage under the existing agreement identity. */
const pronounAgreement: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  if (!clauseVerb(ctx, match, subjectI)) return null;
  const { subject, verb, gap, next } = match.groups!;
  const pronoun = subject.toLowerCase();
  const before = ctx.text.slice(Math.max(0, match.index - 24), match.index);
  // "am I nuts", "such as I finds": an inverted or compared pronoun; "phase I", "the set I":
  // a letter that names a thing.
  if (/\b(?:as|than|am|is|are|was|were)[ \t\u00a0]+$/i.test(before)) return findings;
  if (subject === "I" && LETTER_NAME_BEFORE.test(before)) return findings;
  if (applyWordCase(subject, detectWordCase(subject)) !== subject && subject !== "i")
    return findings;
  if (ctx.dictionary.has(pronoun)) return findings;
  // Let the old detector retain its precise guards and bulk behavior for its six pairs.
  if (/^[ \t\u00a0]+$/.test(gap) && AGREEMENT_CORRECTIONS.has(`${pronoun} ${verb.toLowerCase()}`))
    return findings;
  const plural = /^(?:i|we|they|you)$/.test(pronoun);
  const negative = /n['’]t$/i.exec(verb)?.[0] ?? "";
  const word = (negative ? verb.slice(0, -negative.length) : verb).toLowerCase();
  // "We nurses sometimes feel", "We bears would call": a plural noun names the pronoun.
  if (/^(?:we|you)$/.test(pronoun) && !negative && namesPronoun(word, next)) return findings;
  const forms = englishVerbForms(word);
  let corrected: string | undefined;
  if (/^(?:is|are|am|was|were)$/.test(word) && !negative)
    corrected =
      pronoun === "i"
        ? { are: "am", is: "am", were: subjunctive(ctx, match.index) ? undefined : "was" }[word]
        : (plural ? PLURAL_BE : SINGULAR_BE)[word];
  // "He aren't", "They isn't".
  else if (/^(?:is|are|was|were)$/.test(word) && pronoun !== "i") {
    const be = (plural ? PLURAL_BE : SINGULAR_BE)[word];
    corrected = be && be + negative.toLowerCase();
  } else if (/^(?:has|have|does|do)$/.test(word))
    corrected = (plural ? forms!.lemma : forms!.third) + negative;
  // Lexical verbs: past-shared or noun-shared forms ("He cut", "They bear") abstain.
  else if (forms && !negative && !forms.ambiguous.includes(word))
    corrected = plural
      ? word === forms.third && word !== forms.lemma
        ? forms.lemma
        : undefined
      : // "He run": a participle equal to the base ("run", "come") needs an auxiliary.
        word === forms.lemma && word !== forms.past
        ? forms.third
        : undefined;
  // Regular verbs come from the dictionary: "She study", "They repairs".
  // A soft line wrap is not a clause start for these: "curving\nit down".
  // Only a plural subject's "-s" word or a singular subject's bare word can disagree.
  else if (
    !forms &&
    !negative &&
    (plural ? word.endsWith("s") : !/(?:s|ed|ing|ly)$/.test(word)) &&
    !/[^\n\s.!?:;"“][ \t\u00a0]*\n[ \t\u00a0]*$/.test(
      ctx.text.slice(Math.max(0, match.index - 8), match.index),
    ) &&
    !/^of$/i.test(next ?? "")
  )
    corrected = lexicalAgreement(word, plural, pronoun, next);
  if (!corrected || corrected === verb.toLowerCase()) return findings;
  const [start, end] = group(match, "verb");
  findings.push({
    ruleId: "englishPronounVerbWhitelistAgreement",
    messageKey: "review_msg_pronoun_verb",
    range: { start, end },
    alternatives: [applyWordCase(corrected, detectWordCase(verb))],
    context: {
      start: Math.max(0, match.index - 96),
      end: Math.min(ctx.text.length, match.index + match[0].length + 2),
    },
    bulkBlock: "context-dependent",
  });
  return findings;
};

// "If I were", "I wish I were", "as though I were": the subjunctive keeps "were".
const SUBJUNCTIVE =
  /\b(?:if|wish|wished|wishes|though|suppose|supposing|imagine|rather|unless|only)\b[^.!?;:\n]*$/i;
const subjunctive = (ctx: DetectContext, index: number) =>
  SUBJUNCTIVE.test(ctx.text.slice(Math.max(0, index - 64), index));
// Words after "You fools" or "You kids" that make the -s word a noun the pronoun names.
const VERB_AFTER =
  /^(?:are|were|is|was|have|had|can|could|will|would|should|must|may|might|do|did|don|get|go|come|need|want|know|think|see|look|make|take|stop|leave|listen|shut|keep|play|eat|run|stay|sit|stand)$/i;

const MODAL = /^(?:will|would|can|could|shall|should|may|might|must|ought|need|dare|used)$/;
// Words the lexicon lists as verbs that follow a pronoun as something else: "It better be",
// "He not only…", "It up front…", "It time to…".
const NOT_A_VERB_HERE = /^(?:not|up|down|out|off|better|best|time|only|also|so|too)$/;

// A part or set named by a capital letter: "phase I lasts", "the set I is", "an I is".
const LETTER_NAME_BEFORE =
  /\b(?:a|an|the|part|chapter|section|volume|book|act|phase|step|stage|level|type|class|article|item|figure|table|option|case|grade|war|page|set|ideal|matrix|interval)[ \t\u00a0]+$/i;
// Adverbs the lexicon reads as nouns only.
const FREQUENCY_AFTER =
  /^(?:sometimes|often|always|usually|never|rarely|seldom|also|all|both|still)$/i;

/** "You kids get", "We nurses sometimes": a plural noun before a verb names the pronoun. */
function namesPronoun(word: string, next: string | undefined): boolean {
  if (!next || !englishWordInfo(word)?.plural) return false;
  const nextInfo = englishWordInfo(next);
  return (
    VERB_AFTER.test(next) ||
    MODAL.test(next) ||
    FREQUENCY_AFTER.test(next) ||
    !!nextInfo?.verbs.some((v) => v.form === "base") ||
    !!nextInfo?.adverb
  );
}

/** The agreeing form of a regular verb, or undefined when the word may be a noun or a past. */
function lexicalAgreement(
  word: string,
  plural: boolean,
  pronoun: string,
  next: string | undefined,
): string | undefined {
  const info = englishWordInfo(word);
  if (!info || MODAL.test(word) || NOT_A_VERB_HERE.test(word)) return undefined;
  const nextInfo = next ? englishWordInfo(next) : null;
  const has = (form: string) => info.verbs.some((v) => v.form === form);
  if (plural) {
    if (!has("third") || has("base") || has("past")) return undefined;
    // "You kids get…", "You fools!": a plural noun after the pronoun.
    if (namesPronoun(word, next) || (info.plural && !next && pronoun === "you")) return undefined;
    return englishLemma(word, "third") ?? undefined;
  }
  if (!has("base") || has("past") || has("participle") || has("third") || info.adjective)
    return undefined;
  // "He hand wrote it": a noun-verb before another verb modifies it.
  if (info.noun && nextInfo?.verbs.some((v) => v.form === "past" || v.form === "base"))
    return undefined;
  // "It face was red": a noun before a finite verb is owned ("Its face"), not a verb.
  if (info.noun && /^(?:is|was|has|will|would|can|could|should|must|may|might)$/i.test(next ?? ""))
    return undefined;
  // "It better be careful" drops "had"; no finite verb takes a bare "be" either.
  if (next?.toLowerCase() === "be") return undefined;
  const third = englishInflect(word, "third");
  // Only a form the dictionary lists: "He not sure" never becomes "nots".
  // The dictionary may list the -s form as the noun plural only ("matters").
  const known = third ? englishWordInfo(third) : null;
  return third && (known?.verbs.some((v) => v.form === "third") || known?.plural)
    ? third
    : undefined;
}

/** Simple counted noun phrases only: changing the verb must preserve the stated number. */
const countedExistential: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  if (!clauseVerb(ctx, match)) return null;
  const { verb, quantity, noun } = match.groups!;
  const number = knownEnglishNounNumber(noun);
  if (!number || ctx.dictionary.has(noun.toLowerCase())) return findings;
  const singularQuantity = /^(?:a|an|one|0*1)$/i.test(quantity);
  if ((number === "singular") !== singularQuantity) return findings;
  // A following list can establish a plural whole: "a problem, a file and a key".
  if (singularQuantity && !/^(?:[.!?]|$)/.test(ctx.text.slice(match.index + match[0].length)))
    return findings;
  const past = /^(?:was|were)$/i.test(verb);
  const expected = number === "singular" ? (past ? "was" : "is") : past ? "were" : "are";
  if (verb.toLowerCase() === expected) return findings;
  const [start, end] = group(match, "verb");
  findings.push({
    ruleId: "englishExistentialAgreement",
    messageKey: "review_msg_existential_agreement",
    range: { start, end },
    alternatives: [applyWordCase(expected, detectWordCase(verb))],
    context: {
      start: Math.max(0, match.index - 96),
      end: Math.min(ctx.text.length, match.index + match[0].length + 2),
    },
  });
  return findings;
};

// A noun by a suffix that only forms count nouns ("description"), unknown or a noun only.
const derivedNounNumber = (noun: string) => {
  const info = englishWordInfo(noun);
  return /^[a-z]{4,}(?:tion|sion|ment)$/.test(noun) &&
    (!info || (info.noun && !info.verbs.length && !info.adjective))
    ? "singular"
    : null;
};

/** "there is things", "are there solution…": a bare known noun right after existential there. */
const bareExistential: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { there, verb, contracted, qverb, noun, tail } = m.groups!;
  const number = knownEnglishNounNumber(noun) ?? derivedNounNumber(noun);
  if (!number || ctx.dictionary.has(noun.toLowerCase())) return findings;
  if (noun !== noun.toLowerCase()) return findings;
  const typed = verb ?? contracted ?? qverb;
  const past = /^(?:was|were)$/i.test(typed);
  const plural = number === "plural";
  if (plural === /^(?:are|were)$/i.test(typed)) return findings;
  // A singular noun can still head a compound ("there are key differences").
  if (!plural && tail === undefined) return findings;
  const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
  // Existential there opens its clause; "Over there is…" and "the idea there is (that)…" abstain.
  if (
    there &&
    !/(?:^|[.!?;:,(\n"“][ \t ]*|\b(?:if|when|whether|that|because|since|so|and|but|or|then|where|as|while|unless|until|once|now|currently|also|still|maybe|perhaps|think|guess|see|saw|seems|noticed|sure|know|knew|hope|realized|believe|said)[ \t ]+)$/i.test(
      before,
    )
  )
    return findings;
  if (qverb && !/(?:^|[.!?;:,(\n"“][ \t ]*|\b(?:and|but|or|so)[ \t ]+)$/i.test(before))
    return findings;
  const phraseEnd = m.index + m[0].length;
  const kase = detectWordCase(typed.replace(/^['’]/, ""));
  let [start, end] = group(m, verb ? "verb" : contracted ? "contracted" : "qverb");
  let alternatives: string[];
  if (plural) {
    const fixed = applyWordCase(past ? "were" : "are", kase);
    alternatives = [contracted ? ` ${fixed}` : fixed];
  } else {
    // Singular after are/were: "is a bug" or "are bugs"; the whole phrase changes.
    start = m.index;
    end = group(m, "noun")[1];
    const lead = ctx.text.slice(m.index, group(m, "noun")[0]);
    const swap = applyWordCase(past ? "was" : "is", kase);
    const article = englishInitialSound(noun) === "vowel" ? "an" : "a";
    const verbAt = qverb ? 0 : group(m, "verb")[0] - m.index;
    alternatives = [
      `${lead.slice(0, verbAt)}${swap}${lead.slice(verbAt + typed.length)}${article} ${noun}`,
      `${lead}${applyWordCase(englishNounForms(noun)?.plural ?? `${noun}s`, detectWordCase(noun))}`,
    ];
  }
  if (start < ctx.from || start >= ctx.to) return findings;
  findings.push({
    ruleId: "englishExistentialAgreement",
    messageKey: "review_msg_existential_agreement",
    range: { start, end },
    alternatives,
    requiresChoice: plural ? undefined : true,
    context: {
      start: Math.max(0, m.index - 96),
      end: Math.min(ctx.text.length, phraseEnd + 2),
    },
  });
  return findings;
};

const LINKING = /^(?:look|seem|sound|feel|appear)s?$/;
const AUXILIARY =
  /^(?:is|are|am|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|shall|should|may|might|must|ought|need|needs|dare|used)$/;

/** An -ly adverb with no other reading, or an adjective that is no verb ("good", not "fine"). */
const only = (word: string, is: "adverb" | "adjective") => {
  const info = englishWordInfo(word);
  return (
    !!info?.[is] &&
    !info.verbs.length &&
    (is === "adverb" ? !info.noun && !info.adjective && /ly$/.test(word) : !info.adverb)
  );
};

const determinerSubject: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { det, noun, verb, tail } = m.groups!;
  // Only a sentence opening establishes the subject: not "make the build work", "that the build
  // run", "does the build work", or a soft line wrap ("The system and\nthe application work").
  if (!opensSentence(ctx.scanText, m.index)) return findings;
  // The "i" flag lets [a-z] match capitals: a capitalized noun or verb names something.
  if (`${noun} ${verb} ${tail}` !== `${noun} ${verb} ${tail}`.toLowerCase()) return findings;
  if (hasUserOrCasedWord(ctx, m[0]) || AUXILIARY.test(verb)) return findings;
  if (!(only(tail, "adverb") || (LINKING.test(verb) && only(tail, "adjective")))) return findings;
  // nounNumber reads the whole lexicon and leaves out invariant nouns ("series", "news").
  const forms = nounNumber(noun);
  const number = forms?.number;
  if (
    !number ||
    [COLLECTIVE, ENGLISH_MASS_NOUNS, MASS_WITH_COUNT_SENSE].some((s) => s.has(forms.singular))
  )
    return findings;
  // "the general", "the final": an adjective may modify a noun in the verb slot.
  if (englishWordInfo(noun)?.adjective) return findings;
  const d = det.toLowerCase();
  if (
    number === "singular" ? /^(?:these|those)$/.test(d) : /^(?:this|that|its|every|each)$/.test(d)
  )
    return findings;
  const verbForms = englishVerbForms(verb);
  const info = englishWordInfo(verb);
  const has = (form: string) => !!info?.verbs.some((v) => v.form === form);
  let fix: string | null | undefined;
  if (number === "singular") {
    // A base that is also a past ("set", "cut") may be a participle after a compound noun.
    if (
      verbForms
        ? verb === verbForms.lemma && verb !== verbForms.past && !verbForms.ambiguous.includes(verb)
        : has("base") && !has("past") && !has("participle")
    )
      fix = verbForms?.third ?? englishInflect(verb, "third");
  } else if (verbForms ? verb === verbForms.third : has("third"))
    fix = verbForms?.lemma ?? englishLemma(verb, "third");
  if (!fix || fix === verb) return findings;
  const [start, end] = group(m, "verb");
  findings.push({
    ruleId: "englishSubjectVerbAgreement",
    messageKey: "review_msg_pronoun_verb",
    range: { start, end },
    alternatives: [fix],
    context: {
      start: Math.max(0, m.index - 96),
      end: Math.min(ctx.text.length, m.index + m[0].length + 2),
    },
  });
  return findings;
};

// The verbs of the agreement templates (grammar/rules/common.yaml): the base and the third
// person form. A template replaces the typed one with the other one.
const TEMPLATE_VERBS = [
  ["look", "looks"],
  ["accept", "accepts"],
  ["struggle", "struggles"],
  ["make", "makes"],
  ["work", "works"],
  ["suggest", "suggests"],
  ["forget", "forgets"],
  ["have", "has"],
  ["need", "needs"],
  ["cause", "causes"],
  ["create", "creates"],
  ["were", "was"],
  ["aren't", "isn't"],
  ["solve", "solves"],
  ["seem", "seems"],
  ["sound", "sounds"],
] as const;
const OTHER_FORM: ReadonlyMap<string, string> = new Map(
  TEMPLATE_VERBS.flatMap(([base, third]) => [
    [base, third],
    [third, base],
  ]),
);

/** The named frame fixes of the agreement frames of grammar/rules/common.yaml. */
export const FIXERS = {
  pronounAgreement,
  countedExistential,
  bareExistential,
  // A template frame at a clause start: the other verb form, in the casing of the typed one.
  agreementTemplate: (m, ctx) => {
    if (!opensSentence(ctx.scanText, m.index)) return null;
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const target = m.groups!.target;
    return applyWordCase(OTHER_FORM.get(target.toLowerCase())!, detectWordCase(target));
  },
  determinerSubject,
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/common.yaml (`filter:`). */
export const FILTERS = {
  // Audited noun heads and predicates; no suffix or collective-number inference. A template
  // finding wins over a determiner frame finding at the same start. A capitalized verb, or a
  // subjunctive or a condition before the verb, abstains.
  subjectAgreement: (ctx, findings) => {
    const starts = new Set<number>();
    return findings
      .filter((d) => !starts.has(d.range.start) && !!starts.add(d.range.start))
      .filter(
        (d) =>
          ctx.source.slice(d.range.start, d.range.end) ===
            ctx.source.slice(d.range.start, d.range.end).toLowerCase() &&
          !/\b(?:suggest|suggested|insist|insisted|demand|demanded|essential|important|wish|if|unless)\b/i.test(
            ctx.text.slice(d.context!.start, d.range.start),
          ),
      );
  },
} satisfies Record<string, FindingsFilter>;
