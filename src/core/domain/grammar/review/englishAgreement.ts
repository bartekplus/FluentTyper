import { detectPhraseTemplates, type PhraseTemplate } from "./phraseTemplates";
import { AGREEMENT_CORRECTIONS } from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import {
  englishNounForms,
  knownEnglishNounNumber,
} from "../implementations/helpers/EnglishNounNumber";
import { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const WORD_END = "(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])";
const CLAUSE_START = "(?<![\\p{L}\\p{M}\\p{N}_'’@/#.\\\\-])";

function* clauseMatches(
  ctx: DetectContext,
  pattern: string,
  anywhere: (match: RegExpExecArray, before: string) => boolean = () => false,
): Generator<RegExpExecArray> {
  const regex = new RegExp(`${CLAUSE_START}${pattern}`, "gidu");
  regex.lastIndex = Math.max(0, ctx.from - 256);
  for (
    let match = regex.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = regex.exec(ctx.scanText)
  ) {
    const [start] = match.indices!.groups!.verb;
    if (start < ctx.from || start >= ctx.to) continue;
    const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
    // Only a clause opening establishes the subject; do not reinterpret object pronouns.
    if (
      !(match.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
      !/[.!?;:\n"“][ \t\u00a0]{0,8}$/.test(before) &&
      !anywhere(match, before)
    )
      continue;
    if (
      /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“][^"”\r\n\uFFFC]{0,64}$/i.test(
        before,
      )
    )
      continue;
    const verb = match.groups!.verb;
    if (
      ctx.dictionary.has(verb.toLowerCase()) ||
      (verb !== verb.toLowerCase() && verb !== verb.toUpperCase())
    )
      continue;
    const end = match.index + match[0].length;
    if (/^\uFFFC|^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(end, end + 2))) continue;
    yield match;
  }
}

const PLURAL_BE: Readonly<Record<string, string>> = { is: "are", am: "are", was: "were" };
const SINGULAR_BE: Readonly<Record<string, string>> = { are: "is", am: "is", were: "was" };

/** Additional finished-text coverage under the existing agreement identity. */
export function additionalPronounAgreement(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // A clause end may follow ("It don't."); a lexical verb must come from the authored table.
  const pattern = `(?<subject>I|we|they|you|he|she|it)(?<gap>${SPACE}(?:(?:really|still|also|always|never|usually|often|just)${SPACE})?)(?<verb>[A-Za-z]+(?:n['’]t)?)(?:${SPACE}(?:not${SPACE})?[A-Za-z]+${WORD_END}|(?=[ \t\u00a0]{0,8}[.!?,;:]))`;
  // "I" is only ever a subject, so it needs no clause start; a capitalized word before it (a title or
  // numeral: "Part I is", "World War I") or a coordination ("Sam and I are") abstains.
  const subjectI = (match: RegExpExecArray, before: string) =>
    match.groups!.subject === "I" &&
    !/\p{Lu}[\p{L}.]*[ \t\u00a0]+$/u.test(before) &&
    !/\b(?:and|or|nor)[ \t\u00a0]+$/i.test(before);
  for (const match of clauseMatches(ctx, pattern, subjectI)) {
    const { subject, verb, gap } = match.groups!;
    const pronoun = subject.toLowerCase();
    if (applyWordCase(subject, detectWordCase(subject)) !== subject) continue;
    if (ctx.dictionary.has(pronoun)) continue;
    // Let the old detector retain its precise guards and bulk behavior for its six pairs.
    if (/^[ \t\u00a0]+$/.test(gap) && AGREEMENT_CORRECTIONS.has(`${pronoun} ${verb.toLowerCase()}`))
      continue;
    const plural = /^(?:i|we|they|you)$/.test(pronoun);
    const negative = /n['’]t$/i.exec(verb)?.[0] ?? "";
    const word = (negative ? verb.slice(0, -negative.length) : verb).toLowerCase();
    const forms = englishVerbForms(word);
    let corrected: string | undefined;
    if (/^(?:is|are|am|was|were)$/.test(word) && !negative)
      corrected =
        pronoun === "i" ? { are: "am", is: "am" }[word] : (plural ? PLURAL_BE : SINGULAR_BE)[word];
    else if (/^(?:has|have|does|do)$/.test(word))
      corrected = (plural ? forms!.lemma : forms!.third) + negative;
    // Lexical verbs: past-shared or noun-shared forms ("He cut", "They bear") abstain.
    else if (forms && !negative && !forms.ambiguous.includes(word))
      corrected = plural
        ? word === forms.third && word !== forms.lemma
          ? forms.lemma
          : undefined
        : word === forms.lemma && word !== forms.past && word !== forms.participle
          ? forms.third
          : undefined;
    if (!corrected || corrected === verb.toLowerCase()) continue;
    const [start, end] = match.indices!.groups!.verb;
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
  }
  return findings;
}

/** Simple counted noun phrases only: changing the verb must preserve the stated number. */
export function existentialAgreement(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const adjective = `(?:(?:new|old|updated|missing|small|large|additional|possible)${SPACE})?`;
  const location = `(?:${SPACE}(?:in|on|under|near|inside|outside)${SPACE}(?:the|this|that|my|your|our|their)${SPACE}${adjective}(?:report|folder|file|document|room|box|table|account|list|screen|desk))?`;
  const pattern = `There${SPACE}(?<verb>is|are|was|were)${SPACE}(?:(?:not|still|also)${SPACE})?(?<quantity>a|an|one|two|three|four|five|six|seven|eight|nine|ten|zero|many|several|a${SPACE}lot${SPACE}of|[0-9]{1,4})${SPACE}${adjective}(?<noun>[A-Za-z]+)${WORD_END}${location}[ \\t\\u00a0]{0,8}(?=[.!?,;]|$|(?:that|which|with)${SPACE})`;
  for (const match of clauseMatches(ctx, pattern)) {
    const { verb, quantity, noun } = match.groups!;
    const number = knownEnglishNounNumber(noun);
    if (!number || ctx.dictionary.has(noun.toLowerCase())) continue;
    const singularQuantity = /^(?:a|an|one|0*1)$/i.test(quantity);
    if ((number === "singular") !== singularQuantity) continue;
    // A following list can establish a plural whole: "a problem, a file and a key".
    if (singularQuantity && !/^(?:[.!?]|$)/.test(ctx.text.slice(match.index + match[0].length)))
      continue;
    const past = /^(?:was|were)$/i.test(verb);
    const expected = number === "singular" ? (past ? "was" : "is") : past ? "were" : "are";
    if (verb.toLowerCase() === expected) continue;
    const [start, end] = match.indices!.groups!.verb;
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
  }
  return [...findings, ...bareExistentialAgreement(ctx)];
}

const BARE_EXISTENTIAL = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’@/#.\\\\-])(?:(?<there>there)(?:${SPACE}(?<verb>is|was|are|were)|(?<contracted>['’]s))|(?<qverb>is|was|are|were)${SPACE}there)${SPACE}(?<noun>[A-Za-z]+)${WORD_END}(?<tail>[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$)|${SPACE}(?:in|on|at|with|for|about|regarding|that|which|when|where|from|of|to|running|missing|left)${WORD_END})?`,
  "gidu",
);

/** "there is things", "are there solution…": a bare known noun right after existential there. */
function bareExistentialAgreement(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  BARE_EXISTENTIAL.lastIndex = Math.max(0, ctx.from - 256);
  for (
    let m = BARE_EXISTENTIAL.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = BARE_EXISTENTIAL.exec(ctx.scanText)
  ) {
    const { there, verb, contracted, qverb, noun, tail } = m.groups!;
    const number = knownEnglishNounNumber(noun);
    if (!number || ctx.dictionary.has(noun.toLowerCase())) continue;
    if (noun !== noun.toLowerCase()) continue;
    const typed = verb ?? contracted ?? qverb;
    const past = /^(?:was|were)$/i.test(typed);
    const plural = number === "plural";
    if (plural === /^(?:are|were)$/i.test(typed)) continue;
    // A singular noun can still head a compound ("there are key differences").
    if (!plural && tail === undefined) continue;
    const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
    // Existential there opens its clause; "Over there is…" and "the idea there is (that)…" abstain.
    if (
      there &&
      !/(?:^|[.!?;:,(\n"“][ \t ]*|\b(?:if|when|whether|that|because|since|so|and|but|or|then|where|as|while|unless|until|once|now|currently|also|still|maybe|perhaps|think|guess|see|saw|seems|noticed|sure|know|knew|hope|realized|believe|said)[ \t ]+)$/i.test(
        before,
      )
    )
      continue;
    if (qverb && !/(?:^|[.!?;:,(\n"“][ \t ]*|\b(?:and|but|or|so)[ \t ]+)$/i.test(before)) continue;
    if (
      /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n￼]{0,80}$/i.test(
        before,
      )
    )
      continue;
    const phraseEnd = m.index + m[0].length;
    if (/^￼|^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
    const kase = detectWordCase(typed.replace(/^['’]/, ""));
    const group = verb ? "verb" : contracted ? "contracted" : "qverb";
    let [start, end] = m.indices!.groups![group];
    let alternatives: string[];
    if (plural) {
      const fixed = applyWordCase(past ? "were" : "are", kase);
      alternatives = [contracted ? ` ${fixed}` : fixed];
    } else {
      // Singular after are/were: "is a bug" or "are bugs"; the whole phrase changes.
      start = m.index;
      end = m.indices!.groups!.noun[1];
      const lead = ctx.text.slice(m.index, m.indices!.groups!.noun[0]);
      const swap = applyWordCase(past ? "was" : "is", kase);
      const article = englishInitialSound(noun) === "vowel" ? "an" : "a";
      const verbAt = qverb ? 0 : m.indices!.groups!.verb[0] - m.index;
      alternatives = [
        `${lead.slice(0, verbAt)}${swap}${lead.slice(verbAt + typed.length)}${article} ${noun}`,
        `${lead}${applyWordCase(englishNounForms(noun)!.plural, detectWordCase(noun))}`,
      ];
    }
    if (start < ctx.from || start >= ctx.to) continue;
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
  }
  return findings;
}

/** Audited noun heads and predicates; no suffix or collective-number inference. */
export function subjectAgreement(ctx: DetectContext): RawFinding[] {
  const determiner = `(?:the|this|that|our|your)${SPACE}(?:(?:new|old|current|original)${SPACE})?`;
  const singular = `(?:${determiner}(?:feature|application|system|software|checker|solution)|it|everyone|everybody|nobody|everything|no${SPACE}one|every${SPACE}developer|verb${SPACE}tense${SPACE}detection|each${SPACE}of${SPACE}(?:them|the${SPACE}tests))`;
  const plural = `(?:(?:the|these|those|our|your)${SPACE}(?:features|applications|systems|checkers|solutions|results)|prepositions|conditional${SPACE}sentences|numbers${SPACE}and${SPACE}dates|the${SPACE}last${SPACE}few${SPACE}weeks|some${SPACE}of${SPACE}them)`;
  const adverbs = `(?:${SPACE}(?:sometimes|also|often|still|actually|completely)){0,2}${SPACE}`;
  const predicates = [
    ["look", "looks", "(?:quite )?promising|good"],
    ["accept", "accepts", "words"],
    ["struggle", "struggles", "with constructions"],
    ["make", "makes", "many mistakes"],
    ["work", "works", "(?:correctly|well|reliably)"],
    ["suggest", "suggests", "(?:a|an|the) (?:change|solution|correction)"],
    ["forget", "forgets", "an article"],
    ["have", "has", "other tasks|checked|finished|completed|passed|been"],
    ["need", "needs", "improvements"],
    ["cause", "causes", "subtle issues|trouble"],
    ["create", "creates", "additional edge cases"],
    ["were", "was", "(?:consuming|running|working)"],
    ["aren't", "isn't", "detected"],
    ["solve", "solves", "the (?:original )?issue"],
    ["seem", "seems", "to work"],
  ] as const;
  const patterns: PhraseTemplate[] = predicates.flatMap(([base, third, predicate]) => [
    {
      pattern: `${singular}${adverbs}(?<target>${base})${SPACE}(?:${predicate.replaceAll(" ", SPACE)})${WORD_END}`,
      replacement: third,
      messageKey: "review_msg_pronoun_verb" as const,
    },
    {
      pattern: `${plural}${adverbs}(?<target>${third})${SPACE}(?:${predicate.replaceAll(" ", SPACE)})${WORD_END}`,
      replacement: base,
      messageKey: "review_msg_pronoun_verb" as const,
    },
  ]);
  patterns.push({
    pattern: `some${SPACE}sentences${SPACE}are${SPACE}grammatical${SPACE}but${SPACE}still${SPACE}(?<target>sounds)${SPACE}unnatural${WORD_END}`,
    replacement: "sound",
    messageKey: "review_msg_pronoun_verb",
  });
  return detectPhraseTemplates(
    ctx,
    patterns.map((p) => ({ ...p, clauseStart: true as const })),
    "englishSubjectVerbAgreement",
  ).filter(
    (d) =>
      ctx.source.slice(d.range.start, d.range.end) ===
        ctx.source.slice(d.range.start, d.range.end).toLowerCase() &&
      !/\b(?:suggest|suggested|insist|insisted|demand|demanded|essential|important|wish|if|unless)\b/i.test(
        ctx.text.slice(d.context!.start, d.range.start),
      ),
  );
}
