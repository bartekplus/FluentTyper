import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { adjectiveOf, nounTags } from "./lexicon";
import { findingAt } from "./shared";

/*
 * A question that ends with a full stop: "Czy pójdziesz jutro do kina." -> "?", "Dokąd
 * jedziecie." -> "?". Opt-in (germanQuestionMarks): "Czy" opens a question only when no comma
 * follows ("Czy przyjdzie, nie wiem."); a question word opens one only before a second-person
 * verb, as "Jak widać…" and "Kiedy wrócił…" open statements.
 */

const RULE = "germanQuestionMarks" as const;

/** Commas, colons, dashes, brackets and quotes join clauses or quote one. */
const JOINED = /[,;:—–()"„”«»]/u;
/** A second-person verb ending: "-sz" (idziesz), "-cie" (jedziecie), "-eś"/"-aś" (byłeś). */
const SECOND_PERSON = /(?:sz|cie|eś|aś|ście)$/u;

function questions(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  if (JOINED.test(m[0])) return null;
  const words = m[0].match(/\p{L}+/gu) ?? [];
  if (words.length < 2) return null;
  if (m.groups!.first !== "Czy") {
    const asks = words
      .slice(1, 4)
      .map((word) => word.toLowerCase())
      .some((word) => SECOND_PERSON.test(word) && !nounTags(word) && !adjectiveOf(word));
    if (!asks) return null;
  }
  const at = m.index + m[0].length - 1;
  return findingAt(ctx, at, at + 1, ["?"], RULE, "review_msg_question_mark");
}

/** The named frame fixes of the question rule of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = { questions } satisfies Record<string, MatchFixer>;
