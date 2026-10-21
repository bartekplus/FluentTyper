import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { MatchFixer } from "../engine/reviewRules";
import { group } from "./phraseTemplates";

/** What a possessive frame reads before and after its target. */
type Construction = {
  replacement: string;
  /** The frame opens a clause. */
  clause?: boolean;
  /** A cue word, a clause start or the text start comes before the frame. */
  cue?: boolean;
  /** A name follows the target. */
  name?: boolean;
};

/**
 * The fixer of a possessive frame: full bounded phrases, never a guess about arbitrary names
 * or singular/plural ownership.
 */
const construction =
  ({ replacement, clause, cue, name }: Construction): MatchFixer =>
  (m, ctx, frame) => {
    const [start, end] = group(m, "target");
    const afterTarget = ctx.text.slice(end, end + 12);
    if (frame.messageKey === "review_msg_its_contraction") {
      // "took its time to heal": the possessive in "take one's time".
      if (
        /^[ \t\u00a0]+time\b/i.test(afterTarget) &&
        /\b(?:take|takes|took|taken|taking|bide|bides|bided)[ \t\u00a0]+$/i.test(
          ctx.text.slice(Math.max(0, start - 12), start),
        )
      )
        return null;
      // "on its A list": a capital letter names a list or grade.
      if (/^[ \t\u00a0]+[A-Z](?![\p{L}\p{N}])/u.test(afterTarget)) return null;
    }
    // A name after an opinion verb: "I hope its Katie." ("its accuracy" is possessive.)
    if (name && !/^[ \t\u00a0]+\p{Lu}\p{Ll}/u.test(ctx.text.slice(end, end + 10))) return null;
    const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
    if (
      cue &&
      !/\b(?:think|thinks|thought|hope|guess|know|sure|since|because|if|when|but|so|that|and)[ \t\u00a0]+$/i.test(
        before,
      ) &&
      !(m.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
      !/[.!?;:\n"“(][ \t\u00a0]*$/.test(before)
    )
      return null;
    if (
      clause &&
      !(m.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
      !/(?:,[ \t\u00a0]*(?:but|and)[ \t\u00a0]+|[.!?;:\n][ \t\u00a0]*|,[ \t\u00a0]*["“'‘])["“'‘]{0,3}[ \t\u00a0]*$/.test(
        before,
      ) &&
      !/^[ \t\u00a0]*["“'‘]{1,3}$/.test(before)
    )
      return null;
    const target = m.groups!.target;
    if (frame.ruleId === "englishElsePossessive" && target !== "elses") return null;
    // Uppercase may be an acronym, mixed case an identifier. Protect evidence words too.
    if (target === target.toUpperCase() || applyWordCase(target, detectWordCase(target)) !== target)
      return null;
    if (
      (m[0].match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? []).some((w) =>
        ctx.dictionary.has(w.toLowerCase()),
      )
    )
      return null;
    return applyWordCase(replacement, detectWordCase(target));
  };

/** The named frame fixes of the possessive frames of grammar/rules/common.yaml. */
export const FIXERS = {
  itsAfterVerb: construction({ replacement: "its" }),
  itsNounPredicate: construction({ replacement: "its", clause: true }),
  itsPhrase: construction({ replacement: "it's", clause: true }),
  itsBeforeFunctionWord: construction({ replacement: "it's" }),
  itsBeforeAdjective: construction({ replacement: "it's", cue: true }),
  itsBeforeName: construction({ replacement: "it's", name: true }),
  itsAfterPreposition: construction({ replacement: "its" }),
  itsOwn: construction({ replacement: "its" }),
  itsOrdinal: construction({ replacement: "its" }),
  itsBeforeVerb: construction({ replacement: "its", clause: true }),
  letsPhrase: construction({ replacement: "let's", clause: true }),
  elsePossessive: construction({ replacement: "else's" }),
} satisfies Record<string, MatchFixer>;
