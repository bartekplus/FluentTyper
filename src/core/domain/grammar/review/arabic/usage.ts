import type { RawFinding } from "../reviewDetectors";
import { conjugate, QAMA, type StyleToken } from "./styleFrames";

// Optional "say, don't say" advice from Arabic usage guides: a modern verb sense careful
// writers replace with the classical one. The adjacent forms are phrase rows of
// grammar/rules/ar_SA.yaml; this module covers a verb split from its confirming word.

type Pair = readonly [string, string | readonly string[]];

/** Every form of a sound verb (by its past and imperfect stems) and its replacement. */
function verb(
  past: string,
  present: string,
  fixPast: string,
  fixPresent: string,
  tails: ReadonlyArray<readonly [string, string]> = [["", ""]],
): Pair[] {
  const seen = new Map<string, string>();
  for (let slot = 0; slot < QAMA.length; slot++) {
    const typed = conjugate(past, present, slot);
    const fixed = conjugate(fixPast, fixPresent, slot);
    for (const [tail, fixTail] of tails) seen.set(typed + tail, fixed + fixTail);
  }
  // "تتعطش" -> "تعطش" would land on the typed past "تعطش": such a form is left out.
  for (const [typed, fixed] of seen) if (fixed !== typed && seen.has(fixed)) seen.delete(typed);
  return [...seen];
}

/** Verb forms (typed -> replacement) of one entry, without tails. */
const forms = (pairs: readonly Pair[]) =>
  new Map(pairs.map(([typed, fixed]) => [typed, fixed as string]));

// The same verb advice when the subject or a word stands between the verb and
// the word that shows its sense: "استقل الوزير السيارة", "فتحت الشرطة النار".
const GAPPED: ReadonlyArray<readonly [ReadonlyMap<string, string>, RegExp]> = [
  [forms(verb("استقل", "ستقل", "ركب", "ركب")), /^(?:ال)?(?:سيار|قطار|طائر|حافل|سفين)\p{L}*$/u],
  [forms(verb("فتح", "فتح", "أطلق", "طلق")), /^(?:النار|الرصاص)$/u],
  [forms(verb("تستر", "تستر", "ستر", "ستر")), /^على\p{L}*$/u],
  [forms(verb("صادق", "صادق", "صدق", "صدق")), /^على\p{L}*$/u],
  [forms(verb("افتقد", "فتقد", "افتقر", "فتقر")), /^إلى$/u],
  // "تمادى الطالب على زميله": against a person it is تطاول على.
  [
    new Map([
      ["تمادى", "تطاول"],
      ["تمادت", "تطاولت"],
      ["تمادوا", "تطاولوا"],
      ["يتمادى", "يتطاول"],
      ["تتمادى", "تتطاول"],
      ["يتمادون", "يتطاولون"],
    ]),
    /^على\p{L}*$/u,
  ],
];
// A preposition between them opens its own phrase: "تمادى في الكذب على الناس".
const GAP_PREPOSITION = /^(?:في|على|إلى|من|عن|مع|ب\p{L}+|ل\p{L}+)$/u;

const SPACES = /^[ \t\u00a0]+$/u;

/**
 * A verb from GAPPED, one or two words, then its confirming word, with only
 * spaces between: the verb gets the replacement. Adjacent pairs are table rows.
 */
export function gappedUsage(
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Array<Omit<RawFinding, "ruleId">> {
  const findings: Array<Omit<RawFinding, "ruleId">> = [];
  for (let i = 0; i + 2 < list.length; i++) {
    const word = list[i].word;
    for (const [verbs, target] of GAPPED) {
      // "فتحت" is a verb of its own; "وفتحت" carries و.
      const pre = verbs.has(word) || !/^[وف]/u.test(word) ? "" : word[0];
      const fixed = verbs.get(word.slice(pre.length));
      if (!fixed) continue;
      for (let k = i + 2; k <= i + 3 && k < list.length; k++) {
        if (!SPACES.test(list[k].gap) || !SPACES.test(list[k - 1].gap)) break;
        if (GAP_PREPOSITION.test(list[k - 1].word)) break;
        if (!target.test(list[k].word)) continue;
        if (at(list[i].start))
          findings.push({
            messageKey: "review_msg_style_phrasing",
            range: { start: list[i].start, end: list[i].end },
            alternatives: [pre + fixed],
          });
        break;
      }
    }
  }
  return findings;
}
