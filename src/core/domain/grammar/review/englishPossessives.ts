import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const END = "(?=[ \\t\\u00a0]{0,8}[.!?,;:]|[ \\t\\u00a0]{0,8}$)";
const ADJECTIVE = `(?:(?:new|old|cold|warm|red|blue|main|original|updated|private)${SPACE})?`;
const NOUN =
  "(?:policy|connection|surface|folder|file|password|screen|keyboard|owner|name|settings|color|cover|door|engine|battery|address)";

/** Full bounded phrases, never a guess about arbitrary names or singular/plural ownership. */
export function contextualPossessives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const constructions: Array<{
    ruleId: RawFinding["ruleId"];
    messageKey: RawFinding["messageKey"];
    pattern: string;
    replacement: string;
    clause?: boolean;
  }> = [
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?:lost|checked|changed|updated|fixed|opened|closed|remembered|forgot|replaced|painted|cleaned)${SPACE}(?<target>it['’]s)${SPACE}${ADJECTIVE}${NOUN}${END}`,
      replacement: "its",
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?<target>it['’]s)${SPACE}${ADJECTIVE}${NOUN}${SPACE}(?:is|was|looks|seems)${SPACE}(?:wet|dry|broken|new|old|red|blue|missing|different)${END}`,
      replacement: "its",
      clause: true,
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_contraction",
      pattern: `(?<target>its)${SPACE}(?:unclear${SPACE}whether${SPACE}(?:the${SPACE}change${SPACE}will${SPACE}affect${SPACE}us|it${SPACE}will${SPACE}work)|ready${SPACE}to${SPACE}(?:use|go|open|start)|(?:cold|warm)${SPACE}outside|(?:working|raining|snowing)${SPACE}(?:now|again|today)|been${SPACE}(?:fixed|updated|removed|replaced)|already${SPACE}(?:been${SPACE})?(?:fixed|updated|removed|replaced))${END}`,
      replacement: "it's",
      clause: true,
    },
    {
      ruleId: "englishLetsContext",
      messageKey: "review_msg_lets_contraction",
      pattern: `(?<target>lets)${SPACE}(?:try${SPACE}again|go${SPACE}home|start${SPACE}now|work${SPACE}together|take${SPACE}a${SPACE}break|check${SPACE}the${SPACE}file|open${SPACE}the${SPACE}folder|read${SPACE}the${SPACE}report|fix${SPACE}the${SPACE}problem|meet${SPACE}tomorrow|wait${SPACE}here|begin${SPACE}with${SPACE}the${SPACE}basics)${END}`,
      replacement: "let's",
      clause: true,
    },
    {
      ruleId: "englishElsePossessive",
      messageKey: "review_msg_else_possessive",
      pattern: `(?:someone|anyone|everyone|somebody|anybody|nobody|no${SPACE}one)${SPACE}(?<target>elses)${SPACE}${ADJECTIVE}${NOUN}${END}`,
      replacement: "else's",
    },
  ];
  for (const { ruleId, messageKey, pattern, replacement, clause } of constructions) {
    const regex = new RegExp(`(?<!${EDGE})${pattern}(?!${EDGE})`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
      if (
        clause &&
        !(m.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
        !/(?:,[ \t\u00a0]*(?:but|and)[ \t\u00a0]+|[.!?;:\n][ \t\u00a0]*|,[ \t\u00a0]*["“'‘])["“'‘]{0,3}[ \t\u00a0]*$/.test(
          before,
        ) &&
        !/^[ \t\u00a0]*["“'‘]{1,3}$/.test(before)
      )
        continue;
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
          before,
        )
      )
        continue;
      const target = m.groups!.target;
      if (ruleId === "englishElsePossessive" && target !== "elses") continue;
      // Uppercase may be an acronym, mixed case an identifier. Protect evidence words too.
      if (
        target === target.toUpperCase() ||
        applyWordCase(target, detectWordCase(target)) !== target
      )
        continue;
      if (
        (m[0].match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? []).some((w) =>
          ctx.dictionary.has(w.toLowerCase()),
        )
      )
        continue;
      // Include every preceding character and the trailing boundary inspected by the recognizer.
      const context = {
        start: Math.max(0, m.index - 96),
        end: Math.min(ctx.text.length, m.index + m[0].length + 9),
      };
      if (
        /^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 2))
      )
        continue;
      findings.push({
        ruleId,
        messageKey,
        range: { start, end },
        alternatives: [applyWordCase(replacement, detectWordCase(target))],
        context,
      });
    }
  }
  return findings;
}
