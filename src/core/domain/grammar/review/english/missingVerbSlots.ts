import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Clauses whose subject has no verb: "It very easy", "I not sure", "There a lot of ways",
// "Can we able to", "would very helpful", and no/not mixed up next to a verb or noun.

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const BE: Record<string, string> = {
  i: "am",
  you: "are",
  we: "are",
  they: "are",
  he: "is",
  she: "is",
  it: "is",
  this: "is",
};
// Words after which a subject opens a clause.
const CLAUSE_CUE =
  /^(?:and|but|so|because|if|when|that|think|thought|know|knew|hope|guess|maybe|since|though|although|while|whether|sure|certain|clear|obvious|said|says|unless|once|until|why|how|what)$/;
const ADVERB_RUN = new Set(
  "not really very so still also only just totally too much always probably rarely never definitely already partially properly completely pretty quite now first maybe currently actually finally more less".split(
    " ",
  ),
);
// Predicate words the lexicon gives no adjective reading.
const PREDICATIVE = new Set(
  "afraid able unable sure glad sorry worth alone awake asleep okay ok".split(" "),
);
// Adjectives that take a clause: "it possible the…", "it likely we…".
const CLAUSE_ADJECTIVES =
  /^(?:possible|likely|unlikely|clear|obvious|true|important|lucky|strange|odd|weird|funny|sad|good|great|nice|bad)$/;
const INTENSIFIERS = /^(?:fucking|freaking|frigging|bloody|damn|kindly)$/;
const NOT_PREDICATE = new Set(
  "just likely often soon together alone only still even sure best most least all intent".split(
    " ",
  ),
);

// "I don't know, it pathetic": a clause may also open after a comma.
const subjectClause = (ctx: DetectContext, start: number) =>
  afterBreak(ctx, start) ||
  CLAUSE_CUE.test(wordBefore(ctx, start)) ||
  /,[ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, start - 4), start));

/** A finite verb before the clause ends: the subject already has its verb. */
function finiteLater(tokens: Token[], from: number): boolean {
  for (const t of tokens.slice(from)) {
    if (t.kind === "comma") continue;
    if (t.kind !== "word") return false;
    if (
      /^(?:is|are|was|were|am|has|have|had|do|does|did|will|would|can|could|should|may|might|must)$/.test(
        t.lower,
      )
    )
      return true;
    if (/^(?:that|which|who|to|and|but|because|if|when|then|so|or)$/.test(t.lower)) return false;
    const read = FUNCTION_WORDS.has(t.lower) ? null : englishWordInfo(t.lower);
    if (
      read &&
      !read.noun &&
      !read.adjective &&
      read.verbs.some((v) => v.form === "past" || v.form === "third")
    )
      return true;
  }
  return false;
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  until: number,
): void {
  if (findings.some((f) => f.range.start === start)) return;
  findings.push({
    ruleId,
    messageKey,
    range: { start, end },
    alternatives,
    context: evidence(ctx, start, until),
  });
}

/** "It very easy", "I not sure", "He a racist", "You going to be there": a subject and no be. */
function subjectWithoutBe(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>I|you|he|she|it|we|they|this)${SPACE}(?=[a-z])`)) {
    const subject = m.groups!.target;
    const lower = subject.toLowerCase();
    if (subject !== lower && !(subject === "I" || afterBreak(ctx, m.index))) continue;
    if (!subjectClause(ctx, m.index)) continue;
    // An unreadable token ("(", a URL) ends the look-ahead like punctuation.
    const tokens = tokensAfter(ctx, m.index + m[0].length, 10).map((t) =>
      t.kind === "other" ? { ...t, kind: "end" as const } : t,
    );
    let k = 0;
    while (k < 2 && tokens[k]?.kind === "word" && ADVERB_RUN.has(tokens[k].lower)) k++;
    const head = tokens[k];
    if (head?.kind !== "word" || head.text !== head.lower) continue;
    const word = head.lower;
    const read = FUNCTION_WORDS.has(word) ? null : englishWordInfo(word);
    const next = tokens[k + 1];
    const adverbs = tokens.slice(0, k).map((t) => t.lower);
    // The predicate closes: punctuation or a closed word that cannot continue a noun phrase.
    const closes =
      !next ||
      next.kind === "end" ||
      next.kind === "comma" ||
      (next.kind === "word" &&
        /^(?:to|then|and|or|for|enough|than|now|anymore|again|too|because|so|outside|inside|here|there|today|tonight|tomorrow)$/.test(
          next.lower,
        ));
    // "This not only helps": a focus construction. "It maybe helpful" is "may be"
    // (wordFormSlots).
    if (tokens[0]?.lower === "not" && tokens[1]?.lower === "only") continue;
    if (tokens[0]?.lower === "maybe") continue;
    if (INTENSIFIERS.test(word) || (adverbs.length === 0 && /ly$/.test(word))) continue;
    const before = wordBefore(ctx, m.index);
    let ok = false;
    let clauseAfter = false;
    if (/^(?:a|an|the|my|our|your)$/.test(word) && k === 0) {
      // "I bought a book and he a ruler" (gapping), "think it a distinction" (object + NP).
      ok =
        (lower !== "this" || word !== "my") &&
        !/^(?:and|or|nor|think|thought|consider|considered|thinks)$/.test(before) &&
        !/^(?:we|you)$/.test(lower);
    } else if (lower === "this")
      // "This not public information": "this" with "not" and a predicate.
      ok =
        adverbs[0] === "not" &&
        afterBreak(ctx, m.index) &&
        (!!read?.adjective || !!read?.noun || /^(?:just|a|an|the)$/.test(word));
    else if (
      word === "worth" &&
      next?.kind === "word" &&
      (/ing$/.test(next.lower) || /^(?:the|a|an|it|every|more|less)$/.test(next.lower))
    )
      // "it worth knowing about".
      ok = true;
    else if (
      CLAUSE_ADJECTIVES.test(word) &&
      next?.kind === "word" &&
      // "It possible that…"; after a person "sad that" is more often "said that".
      (/^(?:the|a|an|we|you|they|he|she|i|my|our|your|their)$/.test(next.lower) ||
        (lower === "it" && /^(?:this|that)$/.test(next.lower))) &&
      !/^(?:think|thought|believe|believed|consider|considered|find|found|deem|deemed|made|make|makes|keep)$/.test(
        before,
      )
    )
      // "It possible the automation has…": a predicate adjective before a clause.
      ok = clauseAfter = true;
    else if (
      PREDICATIVE.has(word) ||
      (/^(?:fine|good|great|ready|right|wrong)$/.test(word) &&
        (!/^(?:it|this|you)$/.test(lower) ||
          !/^(?:think|thought|believe|believed|consider|considered|find|found|deem|deemed)$/.test(
            before,
          ))) ||
      (read?.adjective &&
        !read.verbs.length &&
        !NOT_PREDICATE.has(word) &&
        // "It normal to see", "if it dark then": an adjective that is also a noun needs the
        // clause to go on with a closed word, and no verb of thinking before ("think it fun").
        (!read.noun ||
          (closes &&
            // "think it fun" is an object and its complement; "think we good" lacks "are".
            (!/^(?:it|this|you)$/.test(lower) ||
              !/^(?:think|thought|believe|believed|consider|considered|find|found|deem|deemed)$/.test(
                before,
              )))))
    )
      // "We nifty workarounds" has a noun after it: no predicate.
      ok = !(
        !closes &&
        next?.kind === "word" &&
        (nounOnly(next.lower) ||
          englishWordInfo(next.lower)?.noun ||
          englishWordInfo(next.lower)?.verbs.some((v) => v.form === "base"))
      );
    else if (
      read?.verbs.some((v) => v.form === "ing") &&
      // A gerund noun ("going", "doing") needs a verb-like run after it.
      (!read.noun || !next || next.kind !== "word" || !nounLike(next.lower)) &&
      !/^(?:being|having)$/.test(word) &&
      lower !== "this" &&
      // "You dithering idiot!": an -ing adjective right before a noun ("working great" is no
      // noun phrase).
      !(
        k === 0 &&
        next?.kind === "word" &&
        !/^(?:great|fine|well|good|perfectly|ok|okay|now|again)$/.test(next.lower) &&
        (nounOnly(next.lower) || englishWordInfo(next.lower)?.noun)
      ) &&
      !/^or$/.test(before) &&
      // "You and I getting together makes sense": a gerund clause before its verb.
      !(
        before === "and" &&
        tokens
          .slice(k + 1)
          .some(
            (t) =>
              t.kind === "word" &&
              englishWordInfo(t.lower)?.verbs.some((v) => v.form === "third" || v.form === "past"),
          )
      )
    )
      ok = true;
    if (!ok || (!clauseAfter && finiteLater(tokens, k + 1))) continue;
    // "How are Tom and I doing?": be already stands before the subject.
    const inverted = /\b(?:am|is|are|was|were)((?:[ \t]+[A-Za-z]+){0,3})[ \t]+$/i.exec(
      ctx.text.slice(Math.max(0, m.index - 48), m.index),
    );
    if (
      inverted &&
      !/\b(?:so|if|that|because|when|hope|think|but|sure|certain|clear|glad|afraid)\b/i.test(
        inverted[1],
      )
    )
      continue;
    // A word right before that takes the pronoun as its object: "make it easy".
    if (
      !afterBreak(ctx, m.index) &&
      /^(?:make|makes|made|keep|keeps|kept|find|found|consider|let|leave|left|have|get|got|see|saw)$/.test(
        wordBefore(ctx, m.index),
      )
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    // "Adam and I going": a coordinated subject at the clause start is plural; "…ago and it
    // still working" joins two clauses.
    const coordinated =
      before === "and" &&
      lower !== "it" &&
      /(?:^|[.!?;:,\n"“(])[ \t\u00a0]*(?:[A-Za-z]+[ \t\u00a0]+){1,2}and[ \t\u00a0]+$/.test(
        ctx.text.slice(Math.max(0, start - 40), start),
      );
    const be = coordinated && read?.verbs.some((v) => v.form === "ing") ? "are" : BE[lower];
    // "What they doing?": a direct question inverts.
    const wh = /\b(what|when|how|why)[ \t]+$/i.exec(ctx.text.slice(Math.max(0, start - 8), start));
    const question = wh && /^[^.!\n]*\?/.test(ctx.text.slice(head.end, head.end + 120));
    if (question) {
      const whStart = start - wh[0].length;
      push(
        ctx,
        findings,
        "englishSentenceStructure",
        "review_msg_clause_be",
        whStart,
        end,
        [`${wh[1]} ${be} ${subject}`],
        head.end,
      );
    } else if (
      afterBreak(ctx, start) &&
      /^[^.!\n]{0,40}\?/.test(ctx.text.slice(head.end, head.end + 48)) &&
      lower !== "this"
    )
      // "You good?", "We ready to go?": a short yes/no question puts be first.
      push(
        ctx,
        findings,
        "englishSentenceStructure",
        "review_msg_clause_be",
        start,
        end,
        [`${caseLike(subject, be)} ${subject === "I" ? "I" : subject.toLowerCase()}`],
        head.end,
      );
    else
      push(
        ctx,
        findings,
        "englishSentenceStructure",
        "review_msg_clause_be",
        start,
        end,
        [`${subject} ${be}`],
        head.end,
      );
  }
  return findings;
}

/** A noun that is no adverb: after a gerund noun it continues a compound ("meeting rooms"). */
const nounLike = (word: string) => {
  const read = englishWordInfo(word);
  return (
    !!read?.noun &&
    !read.adverb &&
    !/^(?:well|there|here|home|today|tonight|tomorrow|now|fine|great|okay|ok|out|back)$/.test(word)
  );
};

/** "There a lot of ways", "Here my new song", "if there any questions": there/here + no verb. */
function existentialWithoutBe(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>there|here)${SPACE}(?<det>a|an|some|any|no|nothing|nobody|several|many|my|our|your)${WORD_END}`,
  )) {
    const target = m.groups!.target;
    if (target !== target.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    if (!subjectClause(ctx, m.index) && wordBefore(ctx, m.index) !== "hope") continue;
    const det = m.groups!.det.toLowerCase();
    const tokens = tokensAfter(ctx, m.index + m[0].length, 10);
    // "Here a, b and c are constants": a list of letters.
    if (tokens[0]?.kind !== "word") continue;
    if (finiteLater(tokens, 0) || tokens.some((t) => t.kind === "other")) continue;
    // "a lot/couple/number/bunch of", "some/any/several/many + plural": are.
    const next = tokens[0]?.lower ?? "";
    // A plural noun in the words before a closed word: "my new songs", "some free seats left".
    const run = tokens.slice(0, 4);
    const stop = run.findIndex((t) => t.kind !== "word" || FUNCTION_WORDS.has(t.lower));
    const pluralNoun = (stop < 0 ? run : run.slice(0, stop)).some(
      (t, i) => i > 0 && /[^s]s$/.test(t.lower) && !!englishWordInfo(t.lower)?.plural,
    );
    const plural =
      /^(?:several|many)$/.test(det) ||
      (/^an?$/.test(det) && /^(?:lot|couple|number|bunch|few)$/.test(next)) ||
      (/^(?:some|any|my|our|your|no)$/.test(det) &&
        ((/s$/.test(next) && !/ss$/.test(next)) || pluralNoun));
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "englishSentenceStructure",
      "review_msg_clause_be",
      start,
      end,
      [`${target} ${plural ? "are" : "is"}`],
      m.index + m[0].length,
    );
  }
  return findings;
}

/** "Can we able to…", "Have you able to…": able needs be/been. */
function ableWithoutBe(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<aux>can|could|would|will|should|can['’]t|couldn['’]t|have|has|haven['’]t|hasn['’]t)${SPACE}(?<target>we|you|they|he|she|it|I|anyone|someone|everyone)(?:${SPACE}(?:ever|still|not))?${SPACE}(?:able|unable)${SPACE}to${WORD_END}`,
  )) {
    const aux = m.groups!.aux.toLowerCase();
    const target = m.groups!.target;
    // "…and then have it able to…": a causative have.
    if (/^ha/.test(aux) && !afterBreak(ctx, m.index)) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "englishSentenceStructure",
      "review_msg_clause_be",
      start,
      end,
      [`${target} ${/^ha/.test(aux) ? "been" : "be"}`],
      m.index + m[0].length,
    );
  }
  return findings;
}

/** "It would very helpful", "It will OK to go": a modal before a degree word and an adjective. */
function modalDegreeAdjective(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<modal>would|will|could|should|might|may|must|can)(?<target>${SPACE})(?:(?:very|too|so|extremely|quite|pretty|forever)${SPACE}(?<adjective>[a-z]+)|(?<fixed>ok|okay|worth))${WORD_END}`,
  )) {
    const { adjective, fixed } = m.groups!;
    if (adjective) {
      const read = englishWordInfo(adjective);
      if (
        !read ||
        !(read.adjective || read.verbs.some((v) => v.form === "participle")) ||
        read.verbs.some((v) => v.form === "base")
      )
        continue;
      if (/^(?:much|many|few|little|likely)$/.test(adjective)) continue;
    } else if (fixed && !/^(?:it|that|this|which)$/.test(wordBefore(ctx, m.index))) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "englishSentenceStructure",
      "review_msg_missing_be",
      start,
      end,
      [" be "],
      m.index + m[0].length,
    );
  }
  return findings;
}

/** "She could no hear", "There is not time", "I have not idea": no and not swapped. */
function noNot(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:could|would|should|can|will|might|must|does|do|did|am|is|are|was|were|['’]m|['’]re)${SPACE}(?<target>no)${SPACE}(?<word>[a-z]+)${WORD_END}`,
  )) {
    const word = m.groups!.word;
    if (
      FUNCTION_WORDS.has(word) ||
      /^(?:longer|doubt|matter|one|good|better|worse|different|less|more|way|problem|big|bigger)$/.test(
        word,
      )
    )
      continue;
    const read = englishWordInfo(word);
    if (!read || read.noun || read.plural) continue;
    const verbBase = read.verbs.some((v) => v.form === "base") && !read.adjective;
    const ing = read.verbs.some((v) => v.form === "ing");
    const adjective = read.adjective && !read.verbs.length && !/er$/.test(word);
    const be = /^(?:am|is|are|was|were|['’]m|['’]re)$/i.test(m[0].split(/\s+/)[0]);
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    // "There was no stopping him", "It is no easy thing": a noun phrase after be.
    if (be) {
      if (/\bthere[ \t\u00a0]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) continue;
      if (after?.kind === "word" && (nounOnly(after.lower) || englishWordInfo(after.lower)?.noun))
        continue;
      if (verbBase || !(ing || adjective)) continue;
    } else if (!verbBase) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "englishConfusedWords",
      "review_msg_confused_word",
      start,
      end,
      [caseLike(m.groups!.target, "not")],
      m.index + m[0].length,
    );
  }
  for (const m of frameMatches(
    ctx,
    `(?<lead>there${SPACE}(?:is|are|was|were|['’]s)|(?:i|we|you|they)${SPACE}(?:have|['’]ve)|(?:he|she|it)${SPACE}has)${SPACE}(?<target>not)${SPACE}(?<word>[a-z]+)${WORD_END}`,
  )) {
    const word = m.groups!.word;
    // "the folks that work there are not mechanics": a locative there.
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:if|that|so|and|but|because|since|when|think|know)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten)$/.test(word)) continue;
    if (
      FUNCTION_WORDS.has(word) ||
      /^(?:enough|sufficient|any|much|many|yet|got|gotten|been)$/.test(word)
    )
      continue;
    const read = englishWordInfo(word);
    const noun = read ? read.noun && !read.verbs.length && !read.adverb : !!nounOnly(word);
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    // "There is not a…", "I have not seen": only a bare noun phrase takes "no".
    const adjectiveNoun =
      !!read?.adjective &&
      !read.verbs.length &&
      tokens[0]?.kind === "word" &&
      !!nounOnly(tokens[0].lower);
    if (!noun && !adjectiveNoun) continue;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "englishConfusedWords",
      "review_msg_confused_word",
      start,
      end,
      ["no"],
      m.index + m[0].length,
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishSentenceStructure", "englishConfusedWords"],
    detect: english(
      subjectWithoutBe,
      existentialWithoutBe,
      ableWithoutBe,
      modalDegreeAdjective,
      noNot,
    ),
  },
];
