import { englishListedNoun, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { FUNCTION_WORDS } from "./slotWords";
import { type FixResult } from "./idioms5";

const info = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const isVerb = (word: string | undefined, ...forms: string[]) =>
  !!info(word)?.verbs.some((v) => !forms.length || forms.includes(v.form));
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t]{1,8}([A-Za-z]+(?:['’][a-z]+)?)/.exec(ctx.text.slice(end, end + 40))?.[1] ?? "";
const end = (m: RegExpExecArray) => m.index + m[0].length;

// Compound nouns used as a verb, and their participles ("has setup" → "has set up").
const PARTICIPLE: Record<string, string> = {
  setup: "set up",
  shutdown: "shut down",
  backup: "backed up",
  cleanup: "cleaned up",
  signup: "signed up",
  pickup: "picked up",
  lookup: "looked up",
  checkout: "checked out",
  rollout: "rolled out",
};
const BASE: Record<string, string> = {
  setup: "set up",
  shutdown: "shut down",
  backup: "back up",
  cleanup: "clean up",
  signup: "sign up",
  pickup: "pick up",
  lookup: "look up",
  checkout: "check out",
  rollout: "roll out",
};
// The same nouns in a plain verb slot ("Please login", "to backup your files"), and their -s
// forms after he/she/it ("He logins daily" → "logs in").
const SLOT_BASE: Record<string, string> = { ...BASE, login: "log in", logout: "log out" };
const SLOT_THIRD: Record<string, string> = Object.fromEntries(
  Object.entries(SLOT_BASE).map(([noun, verb]) => [`${noun}s`, verb.replace(" ", "s ")]),
);
// The sentence goes on in plain words to its punctuation: not typed half-way ("Please login
// to"), not glued to a token ("continue.next", "continue_id"), not an accented word.
const PLAIN_REST = /^(?:[ \t ]+[A-Za-z0-9]+(?:['’][A-Za-z]+)?)*[ \t ]*[.!?,;:](?![\p{L}\p{N}_])/u;
const verbSlot =
  (table: Record<string, string>) =>
  (m: RegExpExecArray, ctx: DetectContext): string | null => {
    const typed = m.groups!.target;
    if (typed !== typed.toLowerCase()) return null;
    const end = m.indices!.groups!.target[1];
    return PLAIN_REST.test(ctx.text.slice(end, end + 160)) ? table[typed] : null;
  };

const BE_WORDS = /^(?:am|is|are|was|were)$/i;

function tagFix(m: RegExpExecArray): FixResult {
  const { subject, neg, aux, pron } = m.groups!;
  if (subject.toLowerCase() !== pron.toLowerCase()) return null;
  const clauseBe = !/do|did/i.test(neg);
  if (clauseBe === BE_WORDS.test(aux)) return null;
  const past = /was|were|did/i.test(neg);
  const p = pron.toLowerCase();
  const single = /^(?:he|she|it)$/.test(p);
  const verb = clauseBe
    ? past
      ? p === "i" || single
        ? "was"
        : "were"
      : p === "i"
        ? "am"
        : single
          ? "is"
          : "are"
    : past
      ? "did"
      : single
        ? "does"
        : "do";
  return `${verb} ${pron}`;
}

function negativeTagFix(m: RegExpExecArray): FixResult {
  const { subject, verb, aux, pron } = m.groups!;
  const p = pron.toLowerCase();
  if (subject.toLowerCase() !== p) return null;
  // A negated clause takes a positive tag: tagFix's frame.
  if (/n['’]t|\b(?:not|never|no)\b/i.test(m[0].slice(0, m[0].length - m.groups!.target.length)))
    return null;
  const single = /^(?:he|she|it)$/.test(p);
  const word = verb
    .trim()
    .toLowerCase()
    .split(/[ \t\u00a0]+/)
    .pop()!
    .replaceAll("’", "'");
  let tag: string;
  if (word === "'m" || word === "am") tag = "aren't";
  else if (word === "'re" || word === "are") tag = "aren't";
  else if (word === "'s" || word === "is") {
    // "He's got a car, hasn't he?": 's is has before a participle.
    const next = /^[ \t ]+([a-z]+)/.exec(m[0].slice(m.groups!.subject.length + verb.length))?.[1];
    const read = next ? englishWordInfo(next) : null;
    if (word === "'s" && read?.verbs.some((v) => v.form === "participle") && !read.adjective)
      return null;
    tag = "isn't";
  } else if (word === "was") tag = "wasn't";
  else if (word === "were") tag = "weren't";
  else {
    const read = englishWordInfo(word);
    if (!read?.verbs.length || FUNCTION_WORDS.has(word)) return null;
    const forms = new Set(read.verbs.map((v) => v.form));
    // The verb must agree with the subject: "you know", "he knows", "I knew".
    if (forms.has("past") && !forms.has("base")) tag = "didn't";
    else if (single ? forms.has("third") : forms.has("base") && !forms.has("third"))
      tag = single ? "doesn't" : "don't";
    else return null;
  }
  const typed = aux.toLowerCase().replaceAll("’", "'");
  if (typed === tag) return null;
  return `${aux.includes("’") ? tag.replaceAll("'", "’") : tag} ${pron}`;
}

const LATTER_VERB =
  /^(?:is|was|are|were|has|have|had|can|could|will|would|should|may|might|must|does|did|seems|seemed|causes|caused|tends|remains|becomes|offers|requires|means|makes|gives)$/;
// Words before "all ready" that make it the adverb's slot ("I have all ready bought it").
const READY_LEAD =
  /^(?:i|you|we|they|he|she|it|can|could|will|would|should|may|might|must|have|has|had|am|is|are|was|were|i['’](?:ve|m|d)|(?:you|we|they)['’](?:ve|re|d)|(?:he|she|it)['’]s)$/i;

// Short words typed for a verb, in a verb's slot: after a subject, a modal or "to", before
// its object ("I can tech them", "I would choice this", "I ware my coat").
const VERB_FOR: Record<string, string> = {
  tel: "tell",
  tech: "teach",
  choice: "choose",
  ware: "wear",
  multiple: "multiply",
};
const THIRD_FOR: Record<string, string> = {
  tels: "tells",
  teches: "teaches",
  choices: "chooses",
  wares: "wears",
  multiples: "multiplies",
};

const LOCK: Record<string, string> = {
  look: "lock",
  looks: "locks",
  looked: "locked",
  looking: "locking",
};

// "you" before a singular noun that its verb follows: "you car was stolen" -> "your car".
// Not after verbs that take "you" and a clause ("I told you dad is home"), not "what you
// need is", and never a person addressed ("you guys", "you idiot").
export const YOU_CLAUSE_VERBS =
  /^(?:tell|tells|told|telling|show|shows|showed|remind|reminds|reminded|assure|assured|promise|promised|warn|warned|inform|informed|bet|guarantee|guaranteed|ask|asked|teach|taught|convince|convinced|notify|notified|let|lets|thank|thanks|give|gave|given|send|sent|bring|brought|owe|owed|offer|offered|wish|wished|call|called|make|made|get|got|buy|bought|pay|paid|cost|save|saved|charge|charged|see|saw|seen|hear|heard|mean|meant|know|knew|think|thought|believe|suppose)$/;
export const ADDRESSED =
  /^(?:guy|guys|idiot|fool|dummy|moron|genius|darling|honey|baby|sir|madam|man|dude|bro|mate|sis|buddy|pal|lot|kid|boy|girl|people|folks|all|both|two|three|alone|yourself|there|here|too|also|something|anything|nothing|everything|everyone|anyone|someone|one|ones|each|most|now|then|again|later|soon|today|tonight|first|last|instead|anyway|maybe|perhaps|men|women|children|ladies|gentlemen)$/;
const YOU_FINITE =
  /^(?:will|would|can|could|may|might|must|should|shall|is|was|has|does|did|isn['’]t|wasn['’]t|hasn['’]t|doesn['’]t|didn['’]t|won['’]t|can['’]t|got|seems|looks|needs|works|stopped|broke|died)$/;
function yourNoun(
  ctx: DetectContext,
  at: number,
  adj: string | undefined,
  noun: string,
  strict: boolean,
  listed = false,
): boolean {
  if (noun !== noun.toLowerCase() || ADDRESSED.test(noun) || ctx.dictionary.has(noun)) return false;
  // "You might has well…": a modal before a mistyped "as well".
  if (!adj && /^(?:might|may|can|must)$/.test(noun)) return false;
  if (adj) {
    const a = info(adj);
    if (!a?.adjective || a.verbs.length || /^(?:own|only|alone)$/i.test(adj)) return false;
  }
  const read = info(noun);
  // A plain noun only: "you recall", "you still", "you new" read otherwise. A long noun the
  // lexicon lists as a plain noun ("information") counts.
  if (!read && (listed || !strict) && englishListedNoun(noun) === "singular") {
    const before = /([A-Za-z]+)[ \t ]+$/.exec(ctx.text.slice(Math.max(0, at - 24), at))?.[1];
    return !before || !YOU_CLAUSE_VERBS.test(before.toLowerCase());
  }
  if (!read?.noun || read.plural || read.adjective || read.adverb) return false;
  if (strict && read.verbs.some((v) => v.form === "base")) return false;
  const before = /([A-Za-z]+)[ \t ]+$/.exec(ctx.text.slice(Math.max(0, at - 24), at))?.[1];
  return !before || !YOU_CLAUSE_VERBS.test(before.toLowerCase());
}
const COLLECTIVE_NOUN = /^(?:team|family|staff|crew|class|group|company|band|club|department)$/;
/** The noun after "you" (with an optional adjective) and the word after it, both readings. */
function youReadings(m: RegExpExecArray): [string | undefined, string, string | undefined][] {
  const { w1, w2, w3 } = m.groups!;
  return [
    [undefined, w1, w2],
    [w1, w2, w3],
  ];
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "I found anther problem": "another" after a verb or preposition (the flower's anther
  // follows "the", an adjective or a list comma).
  slotConfusionsAnther: (m) => (m.groups!.target === "anther" ? "another" : null),
  // "Many tanks for your help", "Tank you": "thanks", "thank".
  slotConfusionsTanks: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["thanks"], range: g.target ?? g.target2 };
  },
  // "Thank, that helps", "Many thank for", "Thank to the rain": "thanks".
  slotConfusionsThank: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["thanks"], range: g.target ?? g.target2 };
  },
  // "Lets all go home", "Now lets leave": the suggestion "let's".
  slotConfusionsLets: (m) =>
    m.groups!.target === "Lets" ? "Let's" : m.groups!.target === "lets" ? "let's" : null,
  // "the number or workers", "a list or guidelines": "of".
  slotConfusionsOr: (m) =>
    info(m.groups!.n)?.plural || info(m.groups!.n.slice(0, -1))?.noun ? "of" : null,
  // "one if the best", "a couple if days", "if course": "of".
  slotConfusionsIf: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["of"], range: g.target ?? g.target2 };
  },
  // "drop by an see", "the cards an chips": "and" before a word no article takes.
  slotConfusionsAn: (m) => {
    if (m.groups!.target !== "an") return null;
    const read = info(m.groups!.w);
    if (!read) return null;
    const verbOnly =
      /^(?:see|do|go|get|make|take|join|try|play|eat|run|say|tell|ask|stay|leave|come|look|watch|keep|give|send|bring|call)$/.test(
        m.groups!.w,
      ) ||
      (!read.noun && !read.adjective && !read.adverb && read.verbs.some((v) => v.form === "base"));
    return verbOnly ? "and" : null;
  },
  // "it's event possible", "Event I make mistakes": "even".
  slotConfusionsEvent: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["even"], range: g.target ?? g.target2 };
  },
  // "on may different fronts", "May thanks": "many"; "cancel may subscription": "my".
  slotConfusionsMay: (m) => {
    const g = m.indices!.groups!;
    if (g.target && m.groups!.target !== "may") return null;
    return { alternatives: ["many"], range: g.target ?? g.target2 };
  },
  slotConfusionsMay2: (m) => (m.groups!.target === "may" ? "my" : null),
  // "I ave no idea", "should ave been": "have".
  slotConfusionsAve: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["have"], range: g.target ?? g.target2 };
  },
  // "Be quite!", "a quite word": "quiet"; "I am quiet sure": "quite".
  slotConfusionsQuite: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["quiet"], range: g.target ?? g.target2 };
  },
  // "I loss a friend", "could loss his life", "always losses his keys", "a lose tooth".
  slotConfusionsLoss: (m) => {
    const lead = m.groups!.lead.toLowerCase();
    if (/^(?:he|she)$/.test(lead)) return "lost";
    return /^(?:i|you|we|they)$/.test(lead) ? ["lost", "lose"] : "lose";
  },
  // "received your massage", "sent different massages": "message".
  slotConfusionsMassages: (m) => (/s$/.test(m.groups!.target) ? "messages" : "message"),
  // "against his principals", "principals of the Constitution": "principles".
  slotConfusionsPrincipals: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["principles"], range: g.target ?? g.target2 };
  },
  // "That peaked my interest": "piqued".
  slotConfusionsPeaked: (m) => {
    const typed = m.groups!.target.toLowerCase();
    // The phrase table owns "peaked my interest" and its siblings.
    if (/^peak\w*\s+(?:my|your|his|her|our|their)\s+interest$/i.test(m[0])) return null;
    return /ed$/.test(typed) ? "piqued" : /s$/.test(typed) ? "piques" : "piquing";
  },
  // "I did not man to", "what we man?": "mean".
  slotConfusionsMan: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["mean"], range: g.target ?? g.target2 };
  },
  // "the greatest jokes every told", "would every be": "ever".
  slotConfusionsEvery: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["ever"], range: g.target ?? g.target2 };
  },
  // "All the bet", "wish you the bet": "best".
  slotConfusionsBet: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["best"], range: g.target ?? g.target2 };
  },
  // "As off yesterday", "aware off.": "of"; "pulled of an upset": "off".
  slotConfusionsOff: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["of"], range: g.target ?? g.target2 };
  },
  // "If you car was stolen", "You new coat is dirty": "your" before the subject's noun.
  slotConfusionsYou: (m, ctx) => {
    // "if you recall was", "that you need is": inside a sentence only a noun that is no verb,
    // unless a mental verb is ruled out ("if you phone is dead").
    const strict = !!m.groups!.lead;
    const mental =
      /^(?:recall|remember|know|think|believe|see|say|mean|guess|ask|want|like|need|do|get|feel|hear|expect|suppose|said|knew|thought)$/;
    const at = m.indices!.groups!.target[0];
    return youReadings(m).some(
      ([adj, noun, verb]) =>
        !!verb &&
        YOU_FINITE.test(verb.toLowerCase()) &&
        yourNoun(
          ctx,
          at,
          adj,
          noun,
          strict &&
            !(
              !adj &&
              /^(?:is|was|has)$/i.test(verb) &&
              !mental.test(noun) &&
              /^(?:if|because|since|so|and|but)\b/i.test(m.groups!.lead ?? "")
            ),
          true,
        ),
    )
      ? "your"
      : null;
  },
  // "Did you team check it?", "Will you driver pick us up?": an inverted question.
  slotConfusionsYou2: (m, ctx) => {
    const at = m.indices!.groups!.target[0];
    // "does you" and "has you" never pair with the pronoun: a noun that is also a verb fits.
    const strict = !/^(?:does|doesn['’]t|has)$/i.test(m.groups!.aux);
    const base = (word: string | undefined) =>
      word === "be" ||
      (!!word && !!info(word)?.verbs.some((v) => v.form === "base") && !info(word)!.plural);
    return youReadings(m).some(
      ([adj, noun, verb]) =>
        base(verb) &&
        // "Do you grammar check…": plural do takes no singular noun, save a group ("team").
        (!/^(?:do|don['’]t)$/i.test(m.groups!.aux) || COLLECTIVE_NOUN.test(noun)) &&
        yourNoun(ctx, at, adj, noun, strict && verb !== "be"),
    )
      ? "your"
      : null;
  },
  // "Thank you for you time.", "Have you done you homework yet?": an owned noun ends the phrase.
  slotConfusionsYou3: (m, ctx) => {
    const at = m.indices!.groups!.target[0];
    const { w1, w2, end } = m.groups!;
    // "This is for you mom!": a person addressed at the end.
    if (
      /[.!?,;:]/.test(end) &&
      /^(?:mom|mum|dad|mommy|mummy|daddy|mother|father|sister|brother|son|daughter|grandma|grandpa|granny|love|dear|sweetie|friend|friends|boss|team|coach|doc)$/.test(
        w2 ?? w1,
      )
    )
      return null;
    const owned = w2
      ? yourNoun(ctx, at, w1, w2, true, true)
      : yourNoun(ctx, at, undefined, w1, true, true);
    return owned ? "your" : null;
  },
  // "She wasn't upset too.": a negative clause ends in "either".
  slotConfusionsToo: (m, ctx) => {
    // The negation and "too" share one clause: no comma, "but" or "and" between them.
    const before = ctx.text.slice(Math.max(0, m.index - 60), m.index);
    const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(";")) + 1);
    if (/\b(?:but|and|or|because|so)\b/i.test(clause)) return null;
    // "don't have too": the "to" frame below owns it.
    return /\b(?:have|has|had|having|able|want|wants|wanted|wanting|need|needs|needed|supposed|ought|not)[ \t\u00a0]+$/i.test(
      before,
    )
      ? null
      : "either";
  },
  // "I think id rather wait", "Id like that": "I'd" with its apostrophe dropped.
  slotConfusionsId: (m) =>
    /^[Ii]d$/.test(m.groups!.target) ? { alternatives: ["I'd"], raw: true } : null,
  // "my id expired": the identity document is an abbreviation.
  slotConfusionsId2: (m) =>
    m.groups!.target === "id" ? { alternatives: ["ID"], raw: true } : null,
  // "I cold see it", "Cold you hear him?": the modal.
  slotConfusionsCold: (m) => ({
    alternatives: ["could"],
    range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
  }),
  // "The smell began to envelope me": the verb "envelop".
  slotConfusionsEnvelope: (m) =>
    m.groups!.target.toLowerCase() === "envelopes" ? "envelops" : "envelop",
  // "Good lick with it": luck.
  slotConfusionsLick: (m) => ({
    alternatives: ["luck"],
    range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
  }),
  // "I have note seen it", "I'm note running": the negation.
  slotConfusionsNote: (m) => {
    const part = m.groups!.part;
    if (part && !(isVerb(part, "participle") && !isVerb(part, "base") && !info(part)?.noun))
      return null;
    if (m.groups!.ing && !isVerb(m.groups!.ing, "ing")) return null;
    return {
      alternatives: ["not"],
      range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
    };
  },
  slotConfusionsSad: (m) => ({
    alternatives: ["said"],
    range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
  }),
  // "He never looks the front door": lock.
  slotConfusionsLook: (m) => LOCK[m.groups!.target.toLowerCase()],
  // "non alcoholic", "non standard": the prefix takes a hyphen.
  slotConfusionsNon: (m) => {
    const word = m.groups!.word;
    if (/^(?:sequitur|grata|compos|est|plus|ultra|stop|nobis)$/i.test(word)) return null;
    const read = info(word);
    // "Non Khun" is a name; "non new relic" names a product.
    if (m.groups!.target.startsWith("N") || word.length < 5) return null;
    if (!/^[A-Z][a-z]+$/.test(word) && !read?.adjective) return null;
    return `non-${word}`;
  },
  slotConfusionsTel: (m) => VERB_FOR[m.groups!.target.toLowerCase()],
  slotConfusionsTels: (m) => THIRD_FOR[m.groups!.target.toLowerCase()],
  // "This issue mus exist", "you mus see it": the modal "must" before a bare verb.
  slotConfusionsMus: (m) =>
    /^(?:be|have|not|already|also|still|always|never)$/.test(m.groups!.verb) ||
    (isVerb(m.groups!.verb, "base") && !info(m.groups!.verb)?.noun)
      ? "must"
      : null,
  // "I sill check it", "you would sill lock it": the adverb "still" before a verb.
  slotConfusionsSill: (m) =>
    /^(?:always|never|not|here|there|working|waiting|going|alive|open|valid|the|a|an|in|on|at|my|your)$/.test(
      m.groups!.verb,
    ) || isVerb(m.groups!.verb, "base", "past", "third", "ing")
      ? "still"
      : null,
  // "They were vary happy": the degree word before an adjective.
  slotConfusionsVary: (m) => {
    const read = info(m.groups!.adj);
    return read?.adjective || read?.adverb ? "very" : null;
  },
  slotConfusionsAux: (m) => tagFix(m),
  slotConfusionsAux2: (m) => negativeTagFix(m),
  // "I barley moved", "they were barley awake": barley as an adverb before a verb or adjective.
  slotConfusionsBarley: (m) => {
    const next = m.groups!.next;
    const read = info(next);
    return /^(?:even|any|enough|able|there|ever|making|getting|know|knew)$/.test(next) ||
      (read && (read.verbs.length || read.adjective) && !read.plural)
      ? "barely"
      : null;
  },
  // "I found anther problem": a determiner's slot, before a noun.
  slotConfusionsAnther2: (m, ctx) => {
    const next = nextWord(ctx, end(m));
    // The flower's anther: botany around it.
    const near = ctx.text.slice(Math.max(0, m.index - 120), m.index + 160);
    if (/pollen|stamen|filament|petal|flower|stigma/i.test(near)) return null;
    return next === "" || info(next)?.noun || /^(?:one|time|way|day)$/.test(next)
      ? "another"
      : null;
  },
  // "It mans the world to me", "what he mans": the verb "means".
  slotConfusionsMans: (m, ctx) =>
    /^(?:a|an|the|that|to|nothing|something|everything|anything|so|much|more|less|you|me|him|her|us|them|it|business|well)$/i.test(
      nextWord(ctx, end(m)),
    ) || /^[ \t]*[.!?,;]/.test(ctx.text.slice(end(m), end(m) + 4))
      ? "means"
      : null,
  slotConfusionsDue: (m) => (isVerb(m.groups!.verb, "base") ? "Do" : null),
  // "Please us the side door", "will us their method": the verb "use".
  slotConfusionsUs: (m, ctx) =>
    /\b(?:give|gave|show|tell|told|send|sent)\s+$/i.test(
      ctx.text.slice(Math.max(0, m.index - 12), m.index),
    )
      ? null
      : "use",
  // "It event works", "to event try": the adverb "even".
  slotConfusionsEvent2: (m) => {
    const next = m.groups!.next;
    if (
      /^(?:based|driven|related|specific|free|triggered|handling|handler|planning|planner|organizer|management|loop|log|data|type|horizon|listener|queue|bus|stream|source|day|night)$/.test(
        next,
      )
    )
      return null;
    const read = info(next);
    return read && (read.verbs.some((v) => v.form !== "ing") || read.adjective || read.adverb)
      ? "even"
      : null;
  },
  // "I can here you", "glad to here that": the verb "hear".
  slotConfusionsHere: (m, ctx) => {
    const lead = /([A-Za-z']+)[ \t]+here/i.exec(m[0])?.[1].toLowerCase();
    // "to here from there", "moved to here": only "glad/nice/want to hear".
    if (
      lead === "to" &&
      !/\b(?:glad|nice|happy|sad|sorry|good|great|want|wants|wanted|like|love|hate|able|wait|surprised|pleased)[ \t]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      )
    )
      return null;
    return "hear";
  },
  // "It bares repeating", "might bare repeating".
  slotConfusionsBare: (m) => (m.groups!.target.toLowerCase() === "bares" ? "bears" : "bear"),
  // "at he beginning", "to be he best": the article.
  slotConfusionsHe: (m, ctx) =>
    // "for he first had to…": a clause after "for" (because) or "until".
    /^(?:had|was|is|did|has|would|will|could)$/.test(nextWord(ctx, end(m)).toLowerCase())
      ? null
      : "the",
  // "at a lose", "the lose of": the noun "loss".
  slotConfusionsLose: (m) => ({
    alternatives: ["loss"],
    range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
  }),
  // "never heard of it, yet alone tried": "let alone".
  slotConfusionsYet: (m, ctx) => {
    // "Not yet alone": only after a comma or a negative clause.
    const before = ctx.text.slice(Math.max(0, m.index - 80), m.index);
    return /,[ \t]*$|\.{2,}[ \t]*$|\b(?:never|not|n['’]t|no|nobody|nothing|hardly|barely|can['’]?t|cannot|idea)\b[^.!?]*$/i.test(
      before,
    )
      ? "let alone"
      : null;
  },
  // "the former … the later": the second of two named things, a pronoun before its verb.
  slotConfusionsThe: (m, ctx) => {
    const next = m.groups!.next ?? "";
    // "the former" may come before or right after ("subordinated the later to the former").
    const former = /\bformer\b/i.test(ctx.text.slice(Math.max(0, m.index - 300), end(m) + 120));
    const verb = LATTER_VERB.test(next);
    const ADVERB = /^(?:very|actually|also|often|always|never|usually|only|still|clearly)$/;
    const adverb = ADVERB.test(next);
    let after = adverb ? nextWord(ctx, end(m) + 1 + next.length) : "";
    // "the later very often causes": a second adverb before the verb.
    if (ADVERB.test(after)) after = nextWord(ctx, ctx.text.indexOf(after, end(m)) + after.length);
    const ok =
      verb ||
      (adverb && (LATTER_VERB.test(after) || isVerb(after, "third", "ing"))) ||
      /^(?:because|based)$/.test(next) ||
      (former && (next === "" || /^(?:in|on|for|as|because|since|to|and)$/.test(next)));
    return ok
      ? { alternatives: [`${m.groups!.the} latter`], range: m.indices!.groups!.target }
      : null;
  },
  // "I have all ready bought it", "Peter all ready has": the adverb "already".
  slotConfusionsAll: (m) => {
    const { lead, next } = m.groups!;
    // A name owns its verb: "Peter all ready has".
    const name = /^[A-Z][a-z]+$/.test(lead) && /^(?:has|had|did|was)$/.test(next);
    if (!READY_LEAD.test(lead) && !name) return null;
    if (/^(?:to|for|and|or|now|set|here|there|by|when|at|in|on|with|so)$/.test(next)) return null;
    return /^(?:has|have|had|been|done|gone|seen|bought|made|taken|started|finished|left)$/.test(
      next,
    ) ||
      (isVerb(next, "participle", "ing", "base", "third", "past") && !info(next)?.noun)
      ? "already"
      : null;
  },
  // "Can you attache a photo?": the verb; "please find attache" is "attached".
  slotConfusionsAttache: (m, ctx) =>
    /\bfind[ \t]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index + 1)) ? null : "attach",
  // "This is were I live", "the place were the police look", "not sure were to go": "where".
  slotConfusionsWere: (m) => (/^were$/i.test(m.groups!.target) ? "where" : null),
  // "Which browser where you using?", "The runners where running": the past of "be".
  slotConfusionsWhere: (m) => (isVerb(m.groups!.ing, "ing") ? "were" : null),
  // "there's and example", "here is and update": the article "an" before a vowel.
  slotConfusionsAnd: (m) => {
    const read = info(m.groups!.noun);
    return read?.noun && !read.plural ? "an" : null;
  },
  // "They decline an eventually go", "once an for all", "two an a half": "and".
  slotConfusionsAn2: (m) => (m.groups!.target === "an" || m.groups!.target === "An" ? "and" : null),
  // "Let me now your thoughts", "I don't now": the verb "know".
  slotConfusionsNow: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["know"], range: g.target ?? g.target2 };
  },
  slotConfusionsKnow: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["now"], range: g.target ?? g.target2 };
  },
  slotConfusionsThat: (m) =>
    /^(?:important|likely|clear|obvious|necessary|possible|probable|true|surprising|essential|crucial|vital|urgent|interesting|apparent|evident|certain|plausible|unlikely|concerning|worrying)$/.test(
      m.groups!.adj,
    )
      ? null
      : "than",
  slotConfusionsThat2: (m, ctx) => {
    const end = m.indices!.groups!.target[1];
    return m.groups!.target === "that" && /^[ \t ]+\p{Lu}/u.test(ctx.text.slice(end, end + 9))
      ? "than"
      : null;
  },
  // "once of the reasons", "once more time", "One upon a time", "every one in a while".
  slotConfusionsOnce: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["one"], range: g.target ?? g.target2 };
  },
  slotConfusionsOne: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["once"], range: g.target ?? g.target2 };
  },
  // "I wonder it there is", "Catch me it you can": the conjunction "if".
  slotConfusionsIt: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["if"], range: g.target ?? g.target2 };
  },
  slotConfusionsIf2: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["it"], range: g.target ?? g.target2 };
  },
  // "I can all ready do it", "I all so think": "already", "also".
  slotConfusionsAll2: (m) => {
    const read = info(m.groups!.next);
    const verb =
      /^(?:be|are|is|was|were|has|had|have|did|done|seen|see|get|go|do|start|leave|use|make|take|know|say|find|tell|feel|hear|buy|pay|send|book)$/.test(
        m.groups!.next,
      );
    return verb || (read && !read.noun && !read.adjective && read.verbs.length) ? "already" : null;
  },
  // "A user recently complaint that", "A user complaints about": the verb.
  slotConfusionsComplaint: (m) => {
    const g = m.indices!.groups!;
    return g.target
      ? { alternatives: ["complained"], range: g.target }
      : { alternatives: ["complains"], range: g.target2 };
  },
  // "per moth", "the end of the moth", "for moths,": "month".
  slotConfusionsMoth: (m) => {
    const g = m.indices!.groups!;
    return g.target
      ? { alternatives: ["month"], range: g.target }
      : { alternatives: ["months"], range: g.target2 };
  },
  // "It doe not matter", "What doe he think": "does".
  slotConfusionsDoe: (m) => {
    const g = m.indices!.groups!;
    return { alternatives: ["does"], range: g.target ?? g.target2 };
  },
  // "It bares little resemblance", "can't bare the thought": the verb "bear".
  slotConfusionsBares: (m, ctx) => {
    const g = m.indices!.groups!;
    if (g.target2) return { alternatives: ["bear"], range: g.target2 };
    const typed = m.groups!.target.toLowerCase();
    const perfect = /\b(?:has|have|had)[ \t]+$/i.test(
      ctx.text.slice(Math.max(0, g.target[0] - 8), g.target[0]),
    );
    const fix = { bares: "bears", baring: "bearing", bared: perfect ? "borne" : "bore" }[typed]!;
    return { alternatives: [fix], range: g.target };
  },
  // Compound nouns as verbs: "she has setup the tent", "I just setup a meeting", "who login".
  slotConfusionsSetup: (m) => PARTICIPLE[m.groups!.target.toLowerCase()],
  slotConfusionsSetup2: (m) => BASE[m.groups!.target.toLowerCase()],
  slotConfusionsLogin: verbSlot(SLOT_BASE),
  slotConfusionsSetups: verbSlot(SLOT_THIRD),
} satisfies Record<string, Fixer>;
