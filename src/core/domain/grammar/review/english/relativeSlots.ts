import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { COLLECTIVE } from "./agreementSlots";
import { MASS, nounNumber } from "./nounNumberSlots";
import {
  afterBreak,
  AUXILIARIES,
  caseLike,
  DETERMINERS,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  PREPOSITIONS,
  tokensAfter,
} from "./slotWords";
import { finding } from "../finding";
import { alone } from "./confusionSlots";

// The verb of a subject relative clause agrees with the noun the relative pronoun stands for:
// "a report that describe" (describes), "tools that runs" (run), "He who wake" (wakes). The
// noun must plainly own the clause: not inside a prepositional phrase, a cleft or a list.

const SINGULAR_PRONOUNS =
  /^(?:he|she|something|anything|everything|nothing|someone|anyone|everyone|somebody|anybody|everybody)$/;
// Counts and quantities ("two that follow", "the handful that remain"), time words ("these
// days that is"), and nouns whose "that" opens a content clause ("the chances that happens").
const NOT_ANTECEDENT =
  /^(?:none|one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|handful|faculty|days?|weeks?|months?|years?|times?|hours?|minutes?|moments?|nights?|mornings?|evenings?|summer|winter|spring|autumn|fall|season|decades?|century|era|fact|idea|chances?|possibility|probability|likelihood|hope|belief|claim|notion|odds|risk|sign|proof|assumption|impression|feeling|rumou?r|suggestion|way)$/;
// "It's the chemicals in it that make it…", "Is it X that…": a cleft's that-clause.
const CLEFT = /\b(?:it|this|that)(?:['’]s|[ \t\u00a0]+(?:is|was))\b|\b(?:is|was)[ \t\u00a0]+it\b/i;
const TO_PLURAL: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };
const TO_SINGULAR: Record<string, string> = { are: "is", were: "was", have: "has", do: "does" };
// An object or determiner right after a noun-or-verb word shows it is the verb: "that show
// the request", "that make it".
const VERB_EVIDENCE =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|these|those|it|them|me|us|him|you|every|each|any|some|all)$/;
const LINKING = /^(?:feel|look|sound|seem|taste|smell|appear|become|remain|stay|get|grow)$/;
const MODALS = /^(?:can|could|will|would|shall|should|may|might|must|need|dare|ought|be)$/;

const LATER_VERB =
  /^(?:is|are|was|were|has|have|had|will|would|can|could|should|must|may|might|do|does|did)$/;
/** A be, have, do or modal form later in the clause after `index`. */
const verbLater = (ctx: DetectContext, index: number) => {
  for (const t of tokensAfter(ctx, index, 10)) {
    if (t.kind !== "word") return false;
    if (LATER_VERB.test(t.lower)) return true;
  }
  return false;
};

/** The number of the noun before the relative pronoun, or null when the clause may be another's. */
function antecedent(
  ctx: DetectContext,
  word: string,
  index: number,
  pronoun: string,
): "singular" | "plural" | null {
  if (SINGULAR_PRONOUNS.test(word)) return "singular";
  if (word === "those") return "plural";
  if (FUNCTION_WORDS.has(word) || NOT_ANTECEDENT.test(word) || COLLECTIVE.has(word)) return null;
  // The clause so far: a cleft or an earlier relative pronoun leaves the owner open ("a place
  // that shows art that depends on…").
  // A comma inside a number ("12,000 items") does not end it.
  const clause = /(?:[^.!?;:,()\n—]|[,;](?=[\dA-Za-z]))*$/.exec(
    ctx.text.slice(Math.max(0, index - 120), index),
  )![0];
  if (CLEFT.test(clause) || /\b(?:that|which|who)\b/i.test(clause)) return null;
  const before = (clause.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*/g) ?? []).map((w) => w.toLowerCase());
  // "tools for customers that…", "servers on computers running Apache that…": a noun inside a
  // prepositional phrase may not own the clause. Look back past participles to an auxiliary.
  for (const w of before.slice(-6).reverse()) {
    if (PREPOSITIONS.has(w) || /^(?:to|amongst|among|like|than|given)$/.test(w)) return null;
    if (AUXILIARIES.has(w) || /n['’]t$/.test(w)) break;
  }
  const previous = before.at(-1);
  if (pronoun === "that" && /^(?:so|such|now)$/.test(previous ?? "")) return null;
  // "Please note that…"; "useless junk that fail": a collective mass noun.
  if (previous === "please" || /^(?:stuff|junk|gear|crap|garbage|rubbish)$/.test(word)) return null;
  const read = englishWordInfo(word);
  // A word that may be the verb itself needs a determiner, adjective or verb before it: not
  // "the piston fires that…", "Please note that…", "Greta treats which…".
  if (read?.verbs.length) {
    const prev = previous ? englishWordInfo(previous) : null;
    const opens =
      !!previous &&
      (DETERMINERS.has(previous) || (!!prev && (prev.adjective || prev.verbs.length > 0)));
    if (!opens) return null;
  }
  const counted = nounNumber(word)?.number;
  // "A people that loses its past": a singular determiner makes the plural form one group.
  if (counted === "plural" && /^(?:a|an|every|each|one|another)$/.test(previous ?? "")) return null;
  if (counted) return counted;
  // Derived nouns the pair table misses: "manager", "drivers".
  if (!read?.noun || read.verbs.length || read.adjective || read.adverb) return null;
  return read.plural ? "plural" : "singular";
}

/** A capitalized word the lexicon does not know: a given name ("Xavier", "Tim"). */
const isName = (word: string) => /^[A-Z][a-z]+$/.test(word) && !englishWordInfo(word);

// The be/have/do form each subject pronoun takes.
const PRONOUN_FORMS: Record<string, Record<string, string>> = {
  i: { is: "am", has: "have", does: "do" },
  you: { is: "are", was: "were", has: "have", does: "do" },
  we: { is: "are", was: "were", has: "have", does: "do" },
  they: { is: "are", was: "were", has: "have", does: "do" },
};
// Words after which a pronoun opens its own clause ("I hope you is", "as soon as you hears").
const CLAUSE_CUE =
  /^(?:so|because|when|whenever|while|since|until|although|though|if|unless|once|that|feel|hope|think|guess|believe|know|sure|wish|maybe|perhaps)$/;

/** The verb fix after a name subject; null when the fix is the typed verb. */
function nameSubject(
  ctx: DetectContext,
  start: number,
  end: number,
  typed: string,
  fix: string | null,
  from: number,
  rule: "englishSubjectVerbAgreement" | "englishPossibleErrors" = "englishSubjectVerbAgreement",
): RawFinding | null {
  return fix && fix !== typed
    ? finding(rule, "review_msg_subject_verb", start, end, [fix], {
        context: evidence(ctx, from, end),
      })
    : null;
}

/** The be/have/do or base form a subject pronoun takes. */
const pronounForm = (
  ctx: DetectContext,
  start: number,
  end: number,
  typed: string,
  fix: string,
  from: number,
): RawFinding => ({
  ruleId: "englishPronounVerbWhitelistAgreement",
  messageKey: "review_msg_pronoun_verb",
  range: { start, end },
  alternatives: [caseLike(typed, fix)],
  context: evidence(ctx, from, end),
});

const MATCH = {
  relativeVerb: (m, ctx) => {
    const { noun, verb } = m.groups!;
    const pronoun = m.groups!.pronoun.toLowerCase();
    // The frame starts at the pronoun (cheap to find); the noun is in its lookbehind.
    const at = m.indices!.groups!.noun[0];
    const end = m.index + m[0].length;
    // A capital names something, except at a sentence start ("Users who uses…").
    if (verb !== verb.toLowerCase() || (noun !== noun.toLowerCase() && !afterBreak(ctx, at)))
      return null;
    if (hasUserOrCasedWord(ctx, ctx.text.slice(at, end))) return null;
    const finite = verb in TO_PLURAL || verb in TO_SINGULAR;
    if (!finite && (FUNCTION_WORDS.has(verb) || MODALS.test(verb))) return null;
    const number = antecedent(ctx, noun.toLowerCase(), at, pronoun);
    if (!number) return null;
    const next = tokensAfter(ctx, end, 1)[0];
    const read = englishWordInfo(verb);
    // "tells the collector which host the data…": after which, a noun-or-verb is a noun.
    // "tools that works for", "people who lives abroad", "a member who feels good": a
    // preposition, an adverb or an adjective after a linking verb shows the verb too. After
    // "that" the word may be a noun that opens a content clause ("states that bills from
    // sellers will go"): a later verb shows that clause.
    const nextRead = next?.kind === "word" ? englishWordInfo(next.lower) : null;
    const plainAdverb =
      !!nextRead?.adverb && !nextRead.noun && !nextRead.adjective && !nextRead.verbs.length;
    const opensPhrase =
      PREPOSITIONS.has(next?.lower ?? "") && !/^(?:of|like)$/.test(next?.lower ?? "");
    const linked =
      LINKING.test(englishLemma(verb, "third") ?? verb) && !!nextRead?.adjective && !nextRead.noun;
    const evidenced =
      pronoun !== "which" &&
      next?.kind === "word" &&
      (VERB_EVIDENCE.test(next.lower) ||
        (/ly$/.test(next.lower) && !!nextRead?.adverb) ||
        (pronoun === "who" && (plainAdverb || opensPhrase || linked)) ||
        (pronoun === "that" && opensPhrase && !verbLater(ctx, end)));
    let replacement: string | null;
    if (number === "plural") {
      replacement = TO_PLURAL[verb] ?? null;
      if (!replacement && read?.verbs.some((v) => v.form === "third")) {
        // "plans", "changes" are nouns too: "told the users that changes were coming".
        const verbOnly = !read.noun && !read.plural && !read.adjective;
        if (verbOnly || evidenced) replacement = englishLemma(verb, "third");
      }
    } else {
      // "the issues and the uncertainty that still exist": a list before owns it.
      // A comma list without "and" too: "krypton, hydrogen which are".
      const listed =
        /\b(?:and|or)\b(?:[ \t\u00a0]+[A-Za-z]+){0,3}[ \t\u00a0]*$/i.test(
          ctx.text.slice(Math.max(0, at - 40), at),
        ) ||
        (/[A-Za-z],[ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, at - 4), at)) &&
          !/^(?:some|any|every|no)(?:thing|one|body)$/.test(noun));
      // "useless junk that fail": a mass noun can stand for a group.
      if (listed || MASS.has(noun)) return null;
      replacement = TO_SINGULAR[verb] ?? null;
      // "do" and "have" need an object or verb after them to be finite here.
      if ((verb === "do" || verb === "have") && !evidenced) replacement = null;
      const base =
        !replacement &&
        !MODALS.test(verb) &&
        read?.verbs.some((v) => v.form === "base" && v.lemma === verb) &&
        !read.verbs.some((v) => v.form !== "base") &&
        !/^(?:please|thank)$/.test(verb);
      if (base) {
        const verbOnly = !read!.noun && !read!.plural && !read!.adjective && !read!.adverb;
        if (verbOnly || evidenced) replacement = englishInflect(verb, "third");
      }
    }
    if (!replacement || replacement === verb) return null;
    const [start, verbEnd] = m.indices!.groups!.verb;
    return {
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end: verbEnd },
      alternatives: [caseLike(verb, replacement)],
      context: evidence(ctx, at, verbEnd),
    };
  },
  relativeGerundSubject: (m, ctx) => {
    const { subject, verb } = m.groups!;
    const at = m.indices!.groups!.subject[0];
    if (!afterBreak(ctx, at) || !/^[A-Z]/.test(subject)) return null;
    const read = englishWordInfo(subject.toLowerCase());
    if (!read?.verbs.some((v) => v.form === "ing") || read.plural || read.adjective) return null;
    if (
      /^(?:following|remaining|including|missing|attaching|enclosing|according|nothing|something|anything|everything)$/i.test(
        subject,
      )
    )
      return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    // "Following are the results", "Remaining were two seats": an inverted list.
    if (
      next?.kind === "word" &&
      (DETERMINERS.has(next.lower) ||
        /^(?:one|two|three|four|five|six|seven|eight|nine|ten|several|many|few|both|all|most)$/.test(
          next.lower,
        ))
    )
      return null;
    if (next?.kind === "number") return null;
    const fix = TO_SINGULAR[verb];
    if (!fix || fix === verb) return null;
    const [start, end] = m.indices!.groups!.verb;
    return finding("englishSubjectVerbAgreement", "review_msg_subject_verb", start, end, [fix], {
      context: evidence(ctx, m.index, end),
    });
  },
  relativeToSubject: (m, ctx) => {
    const { base, verb } = m.groups!;
    const at = ctx.text.lastIndexOf("To", m.indices!.groups!.base[0]);
    if (!afterBreak(ctx, at)) return null;
    const read = englishWordInfo(base);
    // "To date were found…": an adverbial phrase before an inverted subject.
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === base) || base === "date")
      return null;
    const [start, end] = m.indices!.groups!.verb;
    return finding(
      "englishSubjectVerbAgreement",
      "review_msg_subject_verb",
      start,
      end,
      [TO_SINGULAR[verb]],
      {
        context: evidence(ctx, at, end),
      },
    );
  },
  relativeNamePair: (m, ctx) => {
    const { first, second, verb } = m.groups!;
    const at = m.indices!.groups!.first[0];
    if (first === second || ctx.dictionary.has(verb)) return null;
    // "Tom and Mary finds", "Haley and Will has": one name is also a word ("tom", "will"). Two
    // names may also be a firm ("Marks and Spencer has"), so such a pair is only an optional
    // check.
    const capital = (w: string) => /^[A-Z][a-z]+$/.test(w) && !FUNCTION_WORDS.has(w.toLowerCase());
    const sure = isName(first) && isName(second);
    if (!sure && !((isName(first) && capital(second)) || (capital(first) && isName(second))))
      return null;
    // The pair opens its clause: not "from California and Africa is", "between Cardiff and
    // Bristol was".
    const lead = /([A-Za-z]+)[ \t\u00a0]{1,8}$/.exec(ctx.text.slice(Math.max(0, at - 24), at))?.[1];
    if (
      lead &&
      !afterBreak(ctx, at) &&
      !/^(?:that|if|when|because|since|while|although|though|unless|think|hope|know|guess|believe|say|said)$/i.test(
        lead,
      )
    )
      return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && /^(?:a|an)$/.test(next.lower)) return null;
    const read = englishWordInfo(verb);
    const fix =
      TO_PLURAL[verb] ??
      (read?.verbs.some((v) => v.form === "third") && !read.noun && !read.plural
        ? englishLemma(verb, "third")
        : null);
    const [start, end] = m.indices!.groups!.verb;
    return nameSubject(
      ctx,
      start,
      end,
      verb,
      fix,
      at,
      sure ? "englishSubjectVerbAgreement" : "englishPossibleErrors",
    );
  },
  relativeNameHis: (m, ctx) => {
    const { name, verb } = m.groups!;
    const at = m.indices!.groups!.name[0];
    if (!isName(name) || ctx.dictionary.has(verb) || FUNCTION_WORDS.has(verb)) return null;
    // "Tell Tim give his…" is rare; a name after a verb or "and" may be its object.
    const before = /([A-Za-z]+)[ \t\u00a0]{1,8}$/.exec(
      ctx.text.slice(Math.max(0, at - 24), at),
    )?.[1];
    if (before && !afterBreak(ctx, at)) return null;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) return null;
    if (read.verbs.some((v) => v.form !== "base") || MODALS.test(verb)) return null;
    const [start, end] = m.indices!.groups!.verb;
    return nameSubject(ctx, start, end, verb, englishInflect(verb, "third"), at);
  },
  relativePronounVerbS: (m, ctx) => {
    const { pronoun, verb } = m.groups!;
    // The frame is case-blind: "You" opens a sentence, "tHeY" is an identifier.
    if (!/^(?:I|[A-Za-z][a-z]*)$/.test(pronoun)) return null;
    const p = pronoun.toLowerCase();
    if (pronoun !== "I" && pronoun !== pronoun.toLowerCase() && !afterBreak(ctx, m.index))
      return null;
    // "the gift I gave you is lost": an object you belongs to the clause before.
    const cue = /([A-Za-z]+)[ \t\u00a0]{1,8}$/.exec(
      ctx.text.slice(Math.max(0, m.index - 24), m.index),
    )?.[1];
    // The pronoun opens its clause: not "Phase I corresponds", "singular they has", "My
    // Husband and I has been released" (a title), "Everyone but you has".
    if (!afterBreak(ctx, m.index) && !(cue && CLAUSE_CUE.test(cue.toLowerCase()))) return null;
    // A lowercase "i" is a variable ("where i is the number").
    if (pronoun === "i") return null;
    if (ctx.dictionary.has(verb)) return null;
    let fix = PRONOUN_FORMS[p][verb];
    if (!fix) {
      const read = englishWordInfo(verb);
      // Only a verb-only -s form: "you guys" or "they all means" with a plural noun abstain.
      if (!read?.verbs.some((v) => v.form === "third")) return null;
      // "you guys", "they all means": a plural noun reading needs an object after it.
      const object = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      if (
        (read.noun || read.plural) &&
        !(object?.kind === "word" && VERB_EVIDENCE.test(object.lower))
      )
        return null;
      fix = englishLemma(verb, "third") ?? "";
    }
    if (!fix || fix === verb) return null;
    const [start, end] = m.indices!.groups!.verb;
    return pronounForm(ctx, start, end, verb, fix, m.index);
  },
  relativePronounQuestion: (m, ctx) => {
    const { verb, pronoun } = m.groups!;
    const p = pronoun === "I" ? "i" : pronoun.toLowerCase();
    // A question: the clause opens with the verb or a wh-word right before it.
    const lead = /([A-Za-z]+)[ \t\u00a0]{1,8}$/.exec(
      ctx.text.slice(Math.max(0, m.index - 16), m.index),
    )?.[1];
    if (!afterBreak(ctx, m.index) && !/^(?:what|where|why|how|when|who|which)$/i.test(lead ?? ""))
      return null;
    if (!/^[^.!\n]{0,120}\?/.test(ctx.text.slice(m.index))) return null;
    if (pronoun === "i") return null;
    // "Is you question related…": "you" for "your" before a noun is another slip.
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const read = after?.kind === "word" ? englishWordInfo(after.lower) : null;
    if (
      after?.kind === "word" &&
      !FUNCTION_WORDS.has(after.lower) &&
      (nounOnly(after.lower) || (read?.noun && !read.adjective))
    )
      return null;
    const fix = PRONOUN_FORMS[p][verb.toLowerCase()];
    if (!fix) return null;
    const [start, end] = m.indices!.groups!.verb;
    return pronounForm(ctx, start, end, verb, fix, m.index);
  },
} satisfies Record<string, MatchFixer>;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  ...MATCH,
  relativeNamePairAlone: alone("englishSubjectVerbAgreement", MATCH.relativeNamePair),
} satisfies Record<string, MatchFixer>;
