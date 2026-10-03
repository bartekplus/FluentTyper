import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { caseLike, english, evidence } from "./slotWords";

// A second negative in a clause a negated verb already denies: "I didn't see nothing"
// (anything), "There wasn't nobody there" (anybody), "She could not hardly hear" (could hardly).

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const AUX =
  "(?:do|does|did|can|could|will|would|shall|should|must|may|might|is|are|was|were|am|have|has|had)";
const NEGATED = `(?<aux>${AUX}n['’]t|can['’]t|cannot|won['’]t|shan['’]t|${AUX}${SPACE}not|never)`;
const ANY: Record<string, string> = {
  nothing: "anything",
  nobody: "anybody",
  nowhere: "anywhere",
  neither: "either",
  no: "any",
};
// Words that end the negated clause before a second negative could belong to it.
const CLAUSE_BREAK =
  /^(?:that|which|who|whom|whose|what|where|when|why|how|because|if|unless|but|and|or|so|than|as|while|until|whether|though|although|since|yet|nor|said|says|think|thought|know|knew|believe|believed|realize|realized|mean|meant)$/;
// "no longer", "no matter", "no doubt": "no" there starts its own phrase.
const NO_PHRASES =
  /^(?:one|longer|matter|more|less|doubt|further|sooner|way|thanks|end|wonder|problem|question|idea|less|other|sense|use)$/;

/** "I didn't see nothing", "Don't give me no excuses", "There wasn't nobody home". */
function doubleNegatives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `${NEGATED}(?<between>(?:${SPACE}[a-z]+){0,3}?)${SPACE}(?<target>nothing|nobody|nowhere|neither|no)${WORD_END}`,
    "target",
  )) {
    const { aux, between, target } = m.groups!;
    const word = target.toLowerCase();
    const words = between.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.some((w) => CLAUSE_BREAK.test(w))) continue;
    if (hasUserOrCasedWord(ctx, m[0].slice(aux.length))) continue;
    const last = words.at(-1) ?? "";
    // "not for nothing" (in vain), "say no", "not nothing" (litotes).
    if (/^(?:for|say|said|says|saying|answer|answered|vote|voted|take|took)$/.test(last)) continue;
    if (!words.length && word !== "no" && /\bnot$/i.test(aux)) continue;
    const auxWord = aux.toLowerCase();
    // "It isn't nothing", "that's not nothing": litotes after be; "there wasn't nobody" is not.
    if (/^(?:is|are|was|were|am)/.test(auxWord) && !words.length) {
      const subject = /([A-Za-z]+)[ \t\u00a0]+$/.exec(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      );
      if (subject?.[1].toLowerCase() !== "there") continue;
    }
    // "We can't just do nothing": a modal over idle doing is standard; "didn't do nothing" is not.
    if (word === "nothing" && /^(?:do|say|sit)$/.test(last) && !/^(?:do|does|did)/.test(auxWord))
      continue;
    const end = m.indices!.groups!.target[1];
    // "nobody else was there": look past "else".
    const after = /^[ \t\u00a0]+([A-Za-z]+)(?:[ \t\u00a0]+([A-Za-z]+))?/.exec(
      ctx.text.slice(end, end + 32),
    );
    const next = (after?.[1] === "else" ? after[2] : after?.[1])?.toLowerCase();
    if (word === "no") {
      if (!next || NO_PHRASES.test(next)) continue;
      // "Don't tell me no fan ever cried": what is told is a clause of its own.
      if (/^(?:tell|told|say|said|mean|think|guess)$/.test(words[0] ?? "")) continue;
      // "No" before a noun only: "don't give me no excuses".
      const read = englishWordInfo(next);
      if (read && !read.noun && !read.plural && !read.adjective) continue;
    } else if (next) {
      // "I didn't know nobody was home": the negative pronoun subjects its own clause.
      if (/^(?:is|was|were|are|has|had|have|can|could|will|would|should|did|does)$/.test(next))
        continue;
      if (englishWordInfo(next)?.verbs.some((v) => v.form === "third" || v.form === "past"))
        continue;
      // "don't want neither … nor …": either … or needs both words changed.
      if (word === "neither" && /\bnor\b/i.test(ctx.text.slice(end, end + 80))) continue;
    }
    const [start] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishUsagePhrases",
      messageKey: "review_msg_double_negative",
      range: { start, end },
      alternatives: [caseLike(target, ANY[word])],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

/** "She could not hardly hear", "I can't barely see": hardly is negative already. A do-support
 * negation ("didn't hardly sleep") needs the verb inflected and is left alone. */
function negatedHardly(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>(?<aux>can|could|will|would|should)(?:n['’]t|${SPACE}not)|(?<can>can['’]t|cannot)|(?<will>won['’]t))(?=${SPACE}(?:hardly|scarcely|barely)${WORD_END})`,
  )) {
    const { target, aux, can, will } = m.groups!;
    const kept = aux ?? (can ? "can" : will ? "will" : "");
    if (hasUserOrCasedWord(ctx, target.replace(/n['’]t$/i, ""))) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishUsagePhrases",
      messageKey: "review_msg_negated_hardly",
      range: { start, end },
      alternatives: [caseLike(target, kept.toLowerCase())],
      context: evidence(ctx, start, end + 12),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishUsagePhrases"], detect: english(doubleNegatives, negatedHardly) },
];
