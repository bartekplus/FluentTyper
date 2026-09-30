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
    cue?: boolean;
    name?: boolean;
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
    // "its" never precedes a verb, an article or a function word.
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_contraction",
      pattern: `(?<target>its)${SPACE}(?:been|got|had|gotten|a|an|the|my|your|our|his|her|their|not|never|always|so|too|because|like|about|called|named|raining|snowing|someone|something|anyone|anything|everyone|everything|nobody|nothing|somebody|anybody|everybody|somewhere|anywhere|everywhere|going${SPACE}to|getting${SPACE}(?:late|dark|better|worse|harder|easier|cold|warm|old)|time${SPACE}to)`,
      replacement: "it's",
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_contraction",
      pattern: `(?<target>its)${SPACE}(?:(?:also|just|still|really|very|pretty|quite|always|never)${SPACE})?(?:hard|easy|common|important|critical|crucial|essential|vital|necessary|possible|impossible|likely|unlikely|clear|obvious|true|amazing|nice|great|good|bad|fine|okay|ok|worth|better|best|worse|safe|fun|strange|weird|odd|interesting|useful|helpful|difficult|annoying|frustrating|sad|funny|normal|okay|free|done|over|here|there|now)(?=${SPACE}(?:to|for|that|if|when|because|how|what|why)(?!${EDGE})|${END})`,
      replacement: "it's",
      cue: true,
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_contraction",
      pattern: `(?<=(?:think|thinks|hope|hopes|guess|assume|doubt|suppose|believe|bet)${SPACE})(?<target>its)${SPACE}[a-z]+(?:${SPACE}[a-z]+)?${END}`,
      replacement: "it's",
      name: true,
    },
    // "it's" never follows a preposition or precedes "own".
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?<!(?:how|what)${SPACE}about${SPACE})(?<=(?:of|for|with|from|into|onto|about|by|on|in|at|to|under|over|through|during|without|within|despite|toward|towards|against|among)${SPACE})(?<target>it['’]s)${SPACE}(?!(?:not|also|still|just|really|never|always|so|too|very|already|probably|a|an|the|all|been|going|getting|time|what|how|why|where|when|who|this|that|here|there|now|over|done|ok|okay|fine|true|possible|important|like)(?!${EDGE}))[a-z]+`,
      replacement: "its",
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?<target>it['’]s)${SPACE}own${SPACE}[a-z]+`,
      replacement: "its",
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?<=[a-z]{3,}ed${SPACE})(?<target>it['’]s)${SPACE}[0-9]{1,4}(?:st|nd|rd|th)`,
      replacement: "its",
    },
    {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      pattern: `(?<target>it['’]s)${SPACE}(?!(?:not|all|both|each|also|still|just|really|never|always|so|too|very|already|probably|certainly|here|there|now|then|what|who|which|whoever|whatever|where|how|why|when|that|this|it|one|someone|something|everything|everyone|anything|nothing|time|because|like|as|kind|sort|type|going|getting)(?!${EDGE}))[a-z]+${SPACE}(?:are|were|have)(?!${EDGE})`,
      replacement: "its",
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
  for (const { ruleId, messageKey, pattern, replacement, clause, cue, name } of constructions) {
    const regex = new RegExp(`(?<!${EDGE})${pattern}(?!${EDGE})`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      // A name after an opinion verb: "I hope its Katie." ("its accuracy" is possessive.)
      if (name && !/^[ \t\u00a0]+\p{Lu}\p{Ll}/u.test(ctx.text.slice(end, end + 10))) continue;
      const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
      if (
        cue &&
        !/\b(?:think|thinks|thought|hope|guess|know|sure|since|because|if|when|but|so|that|and)[ \t\u00a0]+$/i.test(
          before,
        ) &&
        !(m.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
        !/[.!?;:\n"“(][ \t\u00a0]*$/.test(before)
      )
        continue;
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
