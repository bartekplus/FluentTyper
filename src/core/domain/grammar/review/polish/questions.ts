import type { Detector } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveOf, nounTags } from "./lexicon";
import { findingAt, isPl, owned } from "./shared";

/*
 * A question that ends with a full stop: "Czy pójdziesz jutro do kina." -> "?", "Dokąd
 * jedziecie." -> "?". Opt-in (germanQuestionMarks): "Czy" opens a question only when no comma
 * follows ("Czy przyjdzie, nie wiem."); a question word opens one only before a second-person
 * verb, as "Jak widać…" and "Kiedy wrócił…" open statements.
 */

const RULE = "germanQuestionMarks" as const;

/** A sentence on one line that starts with "Czy" or a question word and ends with a full stop. */
const QUESTION =
  /(?<=^|\n|[.!?…][ \t \n]{1,8})(?<first>Czy|Dokąd|Dlaczego|Gdzie|Kiedy|Skąd|Jak|Ile|Czemu|Kto|Co)(?![\p{L}])[^.!?…\n]{1,300}\.(?=[ \t \n]{1,8}\p{Lu}|[ \t \n]*$)/gu;
/** Commas, colons, dashes, brackets and quotes join clauses or quote one. */
const JOINED = /[,;:—–()"„”«»]/u;
/** A second-person verb ending: "-sz" (idziesz), "-cie" (jedziecie), "-eś"/"-aś" (byłeś). */
const SECOND_PERSON = /(?:sz|cie|eś|aś|ście)$/u;

function questions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, QUESTION)) {
    if (JOINED.test(m[0])) continue;
    const words = m[0].match(/\p{L}+/gu) ?? [];
    if (words.length < 2) continue;
    if (m.groups!.first !== "Czy") {
      const asks = words
        .slice(1, 4)
        .map((word) => word.toLowerCase())
        .some((word) => SECOND_PERSON.test(word) && !nounTags(word) && !adjectiveOf(word));
      if (!asks) continue;
    }
    const at = m.index + m[0].length - 1;
    findings.push(findingAt(ctx, at, at + 1, ["?"], RULE, "review_msg_question_mark"));
  }
  return findings;
}

export const PREDICATES = {
  questions: (ctx: DetectContext) => (isPl(ctx) ? questions(ctx) : []),
} satisfies Record<string, Detector>;
