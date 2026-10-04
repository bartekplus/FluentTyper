import { ENGLISH_COMPARATIVES } from "../implementations/helpers/EnglishDegreeForms";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { atClauseStart } from "./englishParticiples";
import { COMPLETE_OR_PAREN, frameMatches, group, SPACE, WORD_END } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { ReviewMessageKey } from "./types";

const NOUN =
  "(?:passwords?|accounts?|files?|documents?|names?|address(?:es)?|keys?|reports?|versions?|models?|results?|plans?|answers?)";
const COMPARATIVE = `(?:${ENGLISH_COMPARATIVES.join("|")})`;
const MORE_COMPARATIVES =
  "(?:more|less|fewer|other|bigger|taller|shorter|longer|higher|lower|younger|stronger|weaker|smarter|harder|easier|simpler|busier|happier|greater|closer|quicker|louder|quieter|heavier|lighter|wider|warmer|colder|hotter|nicer)";
const ARGUMENT = `(?:(?:the|my|your|our|their)${SPACE}(?:(?:old|new|previous|other)${SPACE})?${NOUN}|me|him|her|us|them)`;

function finding(
  ctx: DetectContext,
  match: RegExpExecArray,
  ruleId: RawFinding["ruleId"],
  messageKey: ReviewMessageKey,
  replacement: string,
): RawFinding | null {
  const target = match.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return null;
  if (applyWordCase(target, detectWordCase(target)) !== target) return null;
  const [start, end] = group(match, "target");
  const phraseEnd = match.index + match[0].length;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(target))],
    context: {
      start: Math.max(0, match.index - 96),
      end: Math.min(ctx.text.length, phraseEnd + 10),
    },
  };
}

/** Independently selectable families (one rule each), using explicit grammatical evidence. */
export function wordConfusions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // Copular comparison + complete comparison argument; temporal sentence tails abstain.
  for (const match of frameMatches(
    ctx,
    `(?:is|are|was|were)${SPACE}(?:(?:much|even|far|slightly)${SPACE})?${COMPARATIVE}${SPACE}(?<target>then)${SPACE}${ARGUMENT}${COMPLETE_OR_PAREN}`,
  )) {
    const result = finding(ctx, match, "englishThenThan", "review_msg_then_than", "than");
    if (result) findings.push(result);
  }
  // A comparison closed by an object pronoun or "ever": "taller then me", "busier then ever",
  // and the fixed "rather then" and "easier said then done". "earlier then him" and
  // "then you/her/it" can be a sequence or a new clause, so they are left out.
  for (const pattern of [
    `(?:${COMPARATIVE}|${MORE_COMPARATIVES})${SPACE}(?<target>then)${SPACE}(?:me|him|us|them|mine|yours|hers|ours|theirs|ever|usual|expected)${WORD_END}`,
    // "I would rather then leave" may be "rather, then,": only "X rather then Y".
    `(?<!(?:would|had|should|['’]d)${SPACE})rather${SPACE}(?<target>then)${WORD_END}`,
    `easier${SPACE}said${SPACE}(?<target>then)${SPACE}done${WORD_END}`,
  ]) {
    for (const match of frameMatches(ctx, pattern)) {
      const result = finding(ctx, match, "englishThenThan", "review_msg_then_than", "than");
      if (result) findings.push(result);
    }
  }
  // "going to" + a known lexical verb and object, closed before another predicate.
  // "Your going away upset us" and "Your going to work upset us" remain noun phrases.
  for (const match of frameMatches(
    ctx,
    `(?<target>your|their|there)${SPACE}going${SPACE}to${SPACE}(?:like|enjoy|need|want|understand|remember)${SPACE}(?:this|that|it|them|us|me)${COMPLETE_OR_PAREN}`,
  )) {
    if (!atClauseStart(ctx.text, match.index)) continue;
    const your = match.groups!.target.toLowerCase() === "your";
    const result = finding(
      ctx,
      match,
      your ? "englishYourYouAre" : "englishTheirThereTheyAre",
      your ? "review_msg_your_you_are" : "review_msg_they_are",
      your ? "you're" : "they're",
    );
    if (result) findings.push(result);
  }
  // An object-taking verb + own + a known noun supplies a complete possessive phrase.
  for (const match of frameMatches(
    ctx,
    `(?:check|checked|reset|update|updated|save|saved|change|changed|remember|remembered|forgot|entered|used|found|lost)${SPACE}(?<target>you['’]re)${SPACE}own${SPACE}${NOUN}${COMPLETE_OR_PAREN}`,
  )) {
    const result = finding(ctx, match, "englishYourYouAre", "review_msg_your_possessive", "your");
    if (result) findings.push(result);
  }
  // No light/fast/slow: those adjectives are also base verbs after prospective "is to".
  for (const match of frameMatches(
    ctx,
    `(?:is|are|was|were|am|be|seems?|looks?)${SPACE}(?<target>to)${SPACE}(?:heavy|large|small|hot|cold|late|early|expensive|difficult|hard|tired)${SPACE}to${SPACE}(?:lift|carry|fit|eat|drink|finish|move|read|use|reach|leave|start|stop|understand)${WORD_END}`,
  )) {
    const result = finding(ctx, match, "englishToToo", "review_msg_to_too", "too");
    if (result) findings.push(result);
  }
  return comparisonAndDegree(ctx, theirConfusions(ctx, findings));
}

// Stricter than EnglishRuleShared's opensClause: a comma opens a clause only
// with "and", "but" or "so" after it, and dashes, [ and { never do.
const opensMainClause = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?;:\n"“(][ \t ]*|,[ \t ]*(?:and|but|so)[ \t ]+)$/i.test(
    ctx.text.slice(Math.max(0, index - 96), index),
  );
// Words after which a new clause (and so a subject) starts.
const CLAUSE_CUE =
  "(?:think|thought|guess|hope|know|knew|heard|suspect|promise|realized|realised|said|says|sure|maybe|perhaps|because|since|if|when|as|before|after|that|(?:looks|seems|sounds|feels)[ \\t\\u00a0]+like|(?:tell|told|remind|reminded)[ \\t\\u00a0]+them)";
// A dash also closes a they’re predicate: "Their just kidding--don’t worry".
const CLAUSE_END = `(?:${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|[—–]|$))|--(?!-))`;
const THEY_ARE = `(?<target>their)${SPACE}(?:(?:not|already|still|probably|always|just|also|really|all|both|never|definitely|actually|so)${SPACE})?(?:(?<pred>going|gonna|coming|leaving|trying|planning|running|moving|waiting|looking|getting|doing|making|taking|kidding|joking|working|staying|sitting|standing|playing|talking|arriving|ready|sure|here|late|early|busy|done|able|allowed|available|invited|supposed|happy|right|wrong|fine|okay|away|finished|tired|aware|afraid|excited|interested|responsible|safe|cool|sorry|healthy|strong|serious|proud|loyal|offline|online)${SPACE}(?<follow>to|for|at|in|on|with|about|until|by|from|over|into|behind|right|now|today|tonight|tomorrow|again|yet|anymore|here|there|home|back|out|up|away|off|a|an|the|this|that|it|them|us|me|him|her|you|my|your|our|his|their|some|any|next|last|where|what|how|why)${WORD_END}|(?<pred2>ready|sure|here|there|late|early|busy|done|right|wrong|fine|okay|home|back|away|gone|finished|tired|kidding|joking|coming|leaving|waiting|working|offline|online|safe|cool|sorry|healthy|serious|proud|loyal|happy|excited|even)${CLAUSE_END}|(?:in|on|at|off)${SPACE}(?:the|a|an|my|your|our|his|her|their|this|that|work|home|school|lunch|risk)|to${SPACE}(?:blame|meet|be|see|go)|far${SPACE}(?:too|more|less|better|worse)|(?<pred3>(?:not|probably|definitely|obviously|currently|actually|still|just|always|already|really|also|never)${SPACE}[a-z]{3,}ing)${SPACE}(?:to|for|at|in|on|with|about|over|into|a|an|the|any|some|this|that|it|them|us|me|him|her|you|my|your|our|his|their|where|what|how|why)|the|a|an)(?:${WORD_END}|(?<=--))`;
// Finite verbs that show a "their going to…" clause is a gerund subject ("…surprised me").
// "going to" needs the rest of its clause as plain words on the same line.
const PLAIN_CLAUSE = /^(?:[ \t\u00a0]{1,8}[A-Za-z'’]+)+(?=[ \t\u00a0]*(?:[.!?,;:)]|$))/;
const LATER_PREDICATE =
  /^[^.!?;:,\n]*?\b(?:is|was|are|were|has|had|surprised|upset|made|caused|seemed|became|annoyed|worried|shocked|pleased|helped|meant|took|cost|lasted|went|felt|looked)\b/i;
const CUED = new RegExp(`\\b${CLAUSE_CUE}[ \\t\\u00a0]+$`, "i");
const cued = (ctx: DetectContext, index: number) =>
  CUED.test(ctx.text.slice(Math.max(0, index - 96), index));
/** Where "your"/"their" at `index` would open a clause, the you're/they're frames own it. */
export const opensSubjectClause = (ctx: DetectContext, index: number) =>
  opensMainClause(ctx, index) || cued(ctx, index);
const PREPOSITION =
  "(?:of|for|about|with|from|into|onto|at|by|against|between|among|without|toward|towards|under|through|during|despite|to|on|in)";
const LOCATIVE =
  "(?:been|go|goes|went|gone|going|stay|stayed|staying|stand|standing|sit|sitting|put|left|leave|meet|park|wait|waited|waiting|sat|stood|stop|stopped|paused|live|lived|get|got|over|right|safer|back|up|down|out)";
// Only intransitive place verbs before a clause end: "They left their." may be "theirs".
const PLACE_END =
  /^(?:been|go|goes|went|gone|going|stay|stayed|staying|stand|standing|sit|sitting|live|lived|wait|waited|waiting|sat|stood|park|paused|stop|stopped|safer|over|right|up|down|out)$/i;

/**
 * A clause-opening "their"/"your" frame that reads "they're"/"you're": no "right to", and no
 * later predicate after "going (to)" or "X not".
 */
function opensPredicate(ctx: DetectContext, match: RegExpExecArray): boolean {
  if (!opensSubjectClause(ctx, match.index)) return false;
  const { pred, follow } = match.groups!;
  if (pred === "right" && follow === "to") return false;
  const end = match.index + match[0].length;
  const going = /^(?:going|gonna)$/i.test(pred ?? "");
  if (
    (going || /^\w+\s+not\b/i.test(match[0])) &&
    LATER_PREDICATE.test(ctx.text.slice(end, end + 96))
  )
    return false;
  return !going || PLAIN_CLAUSE.test(ctx.text.slice(end, end + 200));
}

/** their/there/they're in frames where only one reading is grammatical. */
function theirConfusions(ctx: DetectContext, findings: RawFinding[]): RawFinding[] {
  const push = (match: RegExpExecArray, key: ReviewMessageKey, replacement: string) => {
    const result = finding(ctx, match, "englishTheirThereTheyAre", key, replacement);
    if (result && !findings.some((f) => f.range.start === result.range.start))
      findings.push(result);
  };
  // Existential there: modal/perfect "be", negative contractions and "their's a …".
  for (const match of frameMatches(
    ctx,
    `(?<target>their)${SPACE}(?:(?:will|won['’]t|can|could|should|would|may|might|must)(?:n['’]t)?${SPACE}(?:not${SPACE})?be|(?:has|have)(?:n['’]t)?${SPACE}been|(?:isn|aren|wasn|weren)['’]t|used${SPACE}to${SPACE}be)${WORD_END}`,
  ))
    if (opensSubjectClause(ctx, match.index)) push(match, "review_msg_their_there", "there");
  for (const match of frameMatches(
    ctx,
    `(?<target>their['’]s)${SPACE}(?:a|an|the|no|another|enough|nothing|something|always|still|also|just|plenty|some|more|lots|one|only)${WORD_END}`,
  ))
    push(match, "review_msg_their_there", "there's");
  // Location there: a possessive never precedes a preposition or ends a clause.
  for (const match of frameMatches(
    ctx,
    `(?<verb>${LOCATIVE})${SPACE}(?<target>their)(?:${SPACE}(?:on|in|at|by|near|beside|until|after|before|among|inside|outside|under|behind|during|without|within|to|and|again|yet|anymore|once|already|now|today|tonight|tomorrow|mid)${WORD_END}|(?<end>(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))))`,
  ))
    if (match.groups!.end === undefined || PLACE_END.test(match.groups!.verb))
      push(match, "review_msg_their_there", "there");
  // They're: a clause-opening "their" before a predicate, a participle or an article.
  for (const match of frameMatches(ctx, THEY_ARE))
    if (opensPredicate(ctx, match)) push(match, "review_msg_they_are", "they're");
  // A determiner never precedes a preposition phrase: "the keys their on the counter"; a clause-opening one is "they're".
  for (const match of frameMatches(
    ctx,
    `(?<target>their)${SPACE}(?:on|in|at|by|near|beside|behind|inside|outside|under|until|among)${SPACE}(?:the|a|an|my|your|our|his|her|this|that)${WORD_END}`,
  ))
    if (!opensMainClause(ctx, match.index)) push(match, "review_msg_their_there", "there");
  // Possessive: a preposition never takes "they're"; "they're X were" has no room for a verb.
  for (const match of frameMatches(
    ctx,
    `${PREPOSITION}${SPACE}(?<target>they['’]?re)${SPACE}[a-z]+${WORD_END}`,
  ))
    push(match, "review_msg_their_possessive", "their");
  for (const match of frameMatches(
    ctx,
    `(?<target>they['’]?re)${SPACE}(?!(?:not|all|both|each|also|still|just|really|never|always|so|too|very|already|probably|certainly|here|there|now|then|what|who|which|whoever|whatever|where|how|why|when|that|this|it|one|someone|something|everything|everyone|anything|nothing)${WORD_END})[a-z]+${SPACE}(?:is|are|was|were|has|have|had)(?:n['’]t)?${WORD_END}`,
  ))
    push(match, "review_msg_their_possessive", "their");
  // "they're own" + a word is only ever the possessive; "there own" also reads
  // "people there own cars", so it needs a clause start, preposition or verb before it.
  for (const match of frameMatches(
    ctx,
    `(?<target>there|they['’]?re)${SPACE}own${SPACE}[a-z]+${WORD_END}`,
  ))
    if (
      !/^there$/i.test(match.groups!.target) ||
      opensMainClause(ctx, match.index) ||
      new RegExp(
        `(?:\\b${PREPOSITION}|ing|\\bto[ \\t\\u00a0]+[a-z]+|\\b(?:create|creates|created|make|makes|made|have|has|had|get|gets|got|build|builds|built|find|found|choose|chose|bring|brought|use|uses|used|pay|paid|run|runs|ran|do|does|did|manage|managed|keep|keeps|kept|set|sets|write|wrote|host|hosted|provide|provides|provided|become|became|define|defined|pick|picks|picked|want|wants|wanted|need|needs|needed|take|takes|took|brings|like|likes|prefer|prefers|love|loves)|\\b(?:check|checked|reset|update|updated|save|saved|change|changed|remember|remembered|forgot|entered|lost))[ \\t\\u00a0]+$`,
        "i",
      ).test(ctx.text.slice(Math.max(0, match.index - 96), match.index))
    )
      push(match, "review_msg_their_possessive", "their");
  return findings;
}

// Comparatives beyond the shared list; "later"/"earlier" stay out ("earlier then him" may be a sequence).
const COMPARISON_WORDS =
  "(?:bigger|higher|lower|longer|shorter|stronger|weaker|easier|harder|simpler|greater|wider|deeper|heavier|lighter|louder|quieter|clearer|cleaner|happier|busier|richer|poorer|taller|warmer|colder|hotter|cooler|thicker|thinner|closer|further|farther|crazier|smarter|stupider|more|less|fewer|rather)";
// Only a comparison continues with these; "then" + a clause ("then we left") never does here.
const COMPARED =
  "(?:me|him|us|them|hers|his|ours|theirs|yours|mine|anyone|anything|anybody|nothing|nobody|ever|before|usual|expected|necessary|needed|last|[0-9]+)";
const DEGREE_ADJECTIVE =
  "(?:big|small|large|short|hot|cold|late|early|hard|easy|good|bad|high|loud|heavy|tired|hungry|busy|far|soon|much|many|expensive|difficult|complicated|ambitious|young|old|strict|risky|dangerous|tight|full|sweet|weak|strong|lazy)";
const LINKING =
  "(?:is|are|was|were|am|be|been|being|seems?|seemed|looks?|looked|feels?|felt|sounds?|sounded|gets?|got|became|becomes|['’]s|['’]re|['’]m)";

/** then/than and to/too where the other reading has no grammatical slot. */
function comparisonAndDegree(ctx: DetectContext, findings: RawFinding[]): RawFinding[] {
  const push = (
    match: RegExpExecArray,
    ruleId: RawFinding["ruleId"],
    key: ReviewMessageKey,
    replacement: string,
  ) => {
    // Identifiers and names in the evidence ("versionName") abstain.
    if ((match[0].match(/\p{L}+/gu) ?? []).some((w) => /\p{Ll}\p{Lu}/u.test(w))) return;
    const result = finding(ctx, match, ruleId, key, replacement);
    if (result && !findings.some((f) => f.range.start === result.range.start))
      findings.push(result);
  };
  const conditional = (match: RegExpExecArray) =>
    /\b(?:if|when|once|unless|after|before|until)\b[^.!?;:\n]*$/i.test(
      ctx.text.slice(Math.max(0, match.index - 96), match.index),
    );
  for (const match of frameMatches(
    ctx,
    `(?=[a-z]+(?:[ \\t\\u00a0]{1,8}[a-z]+)?[ \\t\\u00a0]{1,8}then(?![\\p{L}]))(?<!(?:more|most|less)${SPACE})(?:${COMPARATIVE}|${COMPARISON_WORDS}|(?:more|less)${SPACE}(?![a-z]+er${WORD_END})[a-z]+|(?<=(?:no${SPACE}one|nobody|nothing|anything|anyone|someone|something|none|no)${SPACE})other)${SPACE}(?<target>then)${SPACE}(?:${COMPARED}|(?:(?:the|a|an|my|your|our|their|its|this|that|those|these)(?:${SPACE}(?!(?:[a-z]+ed)${WORD_END})[a-z]+){1,3}|you|her)(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$)|${SPACE}(?:at|in|for|on|with|by|when|so)${WORD_END}))${WORD_END}`,
  ))
    if (!conditional(match)) push(match, "englishThenThan", "review_msg_then_than", "than");
  for (const match of frameMatches(
    ctx,
    `(?:now${SPACE}and|until|till|since|by|back)${SPACE}(?<target>than)(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:…)]|$))`,
  ))
    push(match, "englishThenThan", "review_msg_then_than_temporal", "then");
  // you're: the they're frames for "your", plus "your out of/at…" and intensifier + adjective.
  for (const match of [
    THEY_ARE.replace("(?<target>their)", "(?<target>your)"),
    `(?<target>your)${SPACE}(?:(?:completely|totally|still|already)${SPACE})?out${SPACE}(?:of|at|on|in|with|under|for)${WORD_END}`,
    `(?<target>your)(?:${SPACE}(?:so|very|really|too|totally|completely|absolutely|pretty|quite|extremely|barely|surprisingly)){1,3}${SPACE}(?!own${WORD_END})[a-z]+${COMPLETE_OR_PAREN}`,
  ].flatMap((pattern) => [...frameMatches(ctx, pattern)]))
    if (opensPredicate(ctx, match))
      push(match, "englishYourYouAre", "review_msg_your_you_are", "you're");
  // Degree "too": a linking verb + to + adjective, then an infinitive, for-phrase or clause end.
  // A clitic keeps its owner ("It’s to hard"); a soft line break may split the frame.
  for (const match of frameMatches(
    ctx,
    `(?:[a-z]+(?=['’]))?${LINKING}(?:${SPACE}|[ \\t\\u00a0]{0,8}\\r?\\n[ \\t\\u00a0]{0,8})(?:(?:not|way|far|just|a${SPACE}bit|much|still|also|really|simply)${SPACE})?(?<target>to)${SPACE}${DEGREE_ADJECTIVE}(?:${SPACE}(?:to|for)${SPACE}[a-z]+${WORD_END}|(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$)))`,
  ))
    push(match, "englishToToo", "review_msg_to_too", "too");
  for (const match of frameMatches(
    ctx,
    `(?:(?:go|goes|going|gone|went|take|takes|took|taken|push|pushed|carry|carried|speak|spoke|spoken|speaking|talk|talked|celebrate|celebrated|act|acted|judge|judged)${SPACE}(?<target>to)${SPACE}(?:far|soon)(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$)|${SPACE}(?:with|for|on|in|this|and|but|when|because|like)${WORD_END})|(?<![Tt]he${SPACE}|[Aa]${SPACE}|[Tt]his${SPACE}|[Tt]hat${SPACE}|[Oo]ne${SPACE}|[Nn]o${SPACE}|[Bb]est${SPACE}|[Ww]hich${SPACE})way${SPACE}(?<target>to)${SPACE}(?:much|many|long|big|small|far|late|early|hard|easy|fast|slow|good|bad|high|low|expensive|complicated|little|often))${WORD_END}`,
  ))
    push(match, "englishToToo", "review_msg_to_too", "too");
  // "too" never precedes a determiner or object pronoun, nor a bare verb after want/need…
  for (const match of frameMatches(
    ctx,
    `(?<target>too)${SPACE}(?:the|a|an|him|them|me|us|my|your|his|our|their)${WORD_END}`,
  ))
    push(match, "englishToToo", "review_msg_to_infinitive", "to");
  for (const match of frameMatches(
    ctx,
    `(?:want|wants|wanted|need|needs|needed|going|able|trying|try|tried|supposed|used|have|has|had|like|love|hope|plan|decided)${SPACE}(?<target>too)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
  )) {
    const verb = match.groups!.verb.toLowerCase();
    const forms = englishVerbForms(verb);
    if (verb === "be" || (forms?.lemma === verb && !forms.ambiguous.includes(verb)))
      push(match, "englishToToo", "review_msg_to_infinitive", "to");
  }
  // were: a subject pronoun before where + a predicate that cannot start a place clause.
  for (const match of frameMatches(
    ctx,
    `(?:we|they|you)${SPACE}(?<target>where)${SPACE}(?:(?:not|all|still|just|already|also|never|always|almost)${SPACE})?(?:right|wrong|happy|able|told|asked|supposed|going|done|ready|sure|late|busy|here|there|the${SPACE}only|allowed|given|shown|sent|invited|expected|lucky|about|trying|waiting|working|looking|talking|finished|gone)${WORD_END}`,
  )) {
    const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
    // "…show you where the exit is", "I know you where…": an object "you" before where.
    if (
      /\b(?:show|showed|shown|tell|told|ask|asked|know|knew|see|saw|remind|reminded|guide|guided|take|took)[ \t\u00a0]+$/i.test(
        before,
      )
    )
      continue;
    push(match, "englishWereWhere", "review_msg_were_where", "were");
  }
  // where: a verb of knowing or finding before were + a subject and more clause.
  for (const match of frameMatches(
    ctx,
    `(?:go|goes|went|look|looked|know|knows|knew|forgot|forget|remember|remembers|found|find|check|asked|ask|wonder|wondered|show|showed|tell|told|see|saw|sure|idea)${SPACE}(?:(?:me|us|him|her|them)${SPACE})?(?<target>were)${SPACE}(?:I|he|she|it|we|they|you|the${SPACE}[a-z]+${SPACE}(?:is|was|are|were|[a-z]+ed))${WORD_END}`,
  ))
    push(match, "englishWereWhere", "review_msg_were_where", "where");
  return findings;
}
