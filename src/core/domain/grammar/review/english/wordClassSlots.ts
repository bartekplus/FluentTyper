import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { knownEnglishNounNumber } from "../../implementations/helpers/EnglishNounNumber";
import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import { nounNumber } from "./nounNumberSlots";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { finding } from "../finding";

// A word of the wrong class or form in a verb slot: a noun after a modal ("I would opportunity
// for me"), "it" before a noun it owns ("and it suburbs"), a question without do-support
// ("When go you home?") and a simple tense with "since" ("I work here since 2002").
// The frames are in grammar/rules/en.yaml.

// Nouns that stand alone as adverbs or address: "as soon as we can tomorrow", "I will, sir".
const ADVERBIAL_NOUNS =
  /^(?:today|tomorrow|tonight|yesterday|everyday|anytime|sometime|someday|meantime|sir|madam|maam|guys|folks|everyone|everybody|someone|somebody|anyone|anybody|something|anything|everything|nothing|nobody|home|tho|lol|btw|pls|plz|thanks|mom|mum|dad|mother|father|honey|dear|darling|babe|baby|bro|dude|man|buddy|mate|son|kid|nowhere|anywhere|everywhere|somewhere|auto)$/;

/** A closed word after the noun: the clause ends or a new phrase opens. */
function closesAfter(t: Token | undefined): boolean {
  if (!t || t.kind === "end") return true;
  if (t.kind !== "word") return false;
  return (
    t.text !== t.lower ||
    /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|to|for|as|with|at|by|from|me|him|us|them|it)$/.test(
      t.lower,
    )
  );
}

/** The base form and tense of a finite lexical verb, or null. */
function finite(word: string): { lemma: string; tense: "base" | "third" | "past" } | null {
  const forms = englishVerbForms(word);
  if (forms) {
    if (forms.past === word && forms.past !== forms.lemma)
      return { lemma: forms.lemma, tense: "past" };
    if (forms.third === word) return { lemma: forms.lemma, tense: "third" };
    if (forms.lemma === word) return { lemma: word, tense: "base" };
    return null;
  }
  const read = englishWordInfo(word);
  const verb = read?.verbs.find(
    (v) => v.form === "past" || v.form === "third" || v.form === "base",
  );
  if (!verb) return null;
  if (verb.form === "base" && verb.lemma !== word) return null;
  return { lemma: verb.lemma, tense: verb.form as "base" | "third" | "past" };
}

// "How come you…", "How dare you…", "What say you": fixed inversions.
const FIXED_INVERSION = /^(?:come|dare|say|be|need|ought|used)$/;

function participleOf(lemma: string): string | null {
  const forms = englishVerbForms(lemma);
  return forms?.lemma === lemma ? forms.participle : englishInflect(lemma, "past");
}

// Existential "there" opens its clause.
const THERE_CUE =
  /(?:^|[.!?;:,(\n"“][ \t ]*|\b(?:if|when|whether|that|because|since|so|and|but|then|where|as|while|now|also|still|think|hope|said)[ \t ]+)$/i;
// Quantity nouns: "there are a lot/few/number of…" are plural.
const QUANTITY_NOUNS =
  /^(?:lot|lots|few|couple|number|bunch|variety|range|host|dozen|handful|pair|series|total|majority|minority|plethora|myriad|set|group|ton|tons|load|loads|deal|million|thousand|hundred|billion|half|third|quarter|percent|kind|type|sort|mix|collection|list|wealth|multitude|crowd|team|family|pack|flock|herd|batch|selection|combination)$/;
const NUMBER_WORD =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|none|plenty)$/;
const BARE_TAIL =
  /^(?:in|on|at|with|for|about|that|which|when|where|from|to|outside|inside|whether|under|around)$/;

const INDEFINITE = /^(?:nothing|everything|something|anything|everyone|someone|anyone|nobody)$/;

// Subordinators that leave a sentence unfinished without a main clause.
const SUBORDINATOR =
  /^(?:because|although|though|when|whenever|after|before|since|unless|while|whereas|until|if|(?:so|even)[ \t ,]+(?:if|though)|so[ \t ,]+even[ \t ]+if|so[ \t ]+that|in[ \t ]+order[ \t ]+that|provided[ \t ]+that|even[ \t ]+if|even[ \t ]+though)$/i;
const FINITE_AUX =
  /^(?:is|are|was|were|am|has|have|had|do|does|did|will|would|can|could|shall|should|may|might|must|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|don't|doesn't|didn't|won't|can't|couldn't|wouldn't|shouldn't|cannot)$/;

/** Finite verbs in a clause's tokens: auxiliaries, -s and past forms, a base after I/you/we/they. */
function finiteCount(tokens: Token[]): number {
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "word") continue;
    const w = t.lower.replaceAll("’", "'");
    if (FINITE_AUX.test(w)) {
      count++;
      continue;
    }
    if (FUNCTION_WORDS.has(w)) continue;
    const prev = tokens[i - 1]?.lower ?? "";
    // After a determiner or "to" a word is a noun or an infinitive.
    if (
      /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|to|some|any|no)$/.test(prev)
    )
      continue;
    const read = englishWordInfo(w);
    if (!read) continue;
    if (read.verbs.some((v) => v.form === "third" || v.form === "past")) count++;
    else if (/^(?:i|you|we|they)$/.test(prev) && read.verbs.some((v) => v.form === "base")) count++;
  }
  return count;
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /** "I would opportunity for me", "This will user OpenAI": a noun where the modal needs a verb. */
  wordClassModalNoun: (m, ctx) => {
    const subject = m.groups!.subject;
    if (subject !== subject.toLowerCase() && subject !== "I" && !afterBreak(ctx, m.index))
      return null;
    const word = m.groups!.target;
    if (FUNCTION_WORDS.has(word) || ADVERBIAL_NOUNS.test(word) || ctx.dictionary.has(word))
      return null;
    // A noun and nothing else: no verb, adjective or adverb reading.
    if (nounOnly(word) !== "singular") return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (!closesAfter(next)) return null;
    const [start, end] = m.indices!.groups!.target;
    return finding("englishAuxiliaryBaseVerb", "review_msg_auxiliary_base", start, end, [], {
      warningOnly: true,
      context: evidence(ctx, m.index, end),
    });
  },
  /**
   * "It origins date back", "Adelaide and it suburbs", "ten times it size": "it" before a noun
   * that cannot be its object's complement is the possessive.
   */
  wordClassItBeforeNoun: (m, ctx) => {
    const it = m.groups!.target;
    const start = afterBreak(ctx, m.index);
    const before = wordBefore(ctx, m.index);
    // "IT infrastructure" names a field.
    if (it !== "it" && (it !== "It" || !start)) return null;
    // "Much of it efforts": after a quantity, "of it" before a noun is "of its".
    const quantity =
      before === "of" &&
      /\b(?:much|most|all|some|none|part|each|any|many|both)[ \t\u00a0]+of[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 16), m.index),
      );
    if (!start && !quantity && !/^(?:and|or|times)$/.test(before)) return null;
    const noun = m.groups!.noun;
    if (ctx.dictionary.has(noun) || ADVERBIAL_NOUNS.test(noun) || !nounOnly(noun)) return null;
    // "most of it beta decays": after a quantity only a plural noun is owned.
    if (quantity && !start && before === "of" && nounOnly(noun) !== "plural") return null;
    // The noun phrase must go on into a verb or end: "It origins date back", "and it suburbs."
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const next = tokens[0];
    const read = next?.kind === "word" ? englishWordInfo(next.lower) : null;
    const goesOn =
      !next ||
      next.kind === "end" ||
      (next.kind === "comma" && !start) ||
      (next.kind === "word" &&
        (/^(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must)$/.test(
          next.lower,
        ) ||
          !!read?.verbs.some((v) => v.form === "third" || v.form === "past") ||
          (!!read?.verbs.length &&
            !FUNCTION_WORDS.has(next.lower) &&
            !/^(?:out|off|up|down|over|back|away)$/.test(next.lower) &&
            nounOnly(noun) === "plural")));
    if (!goesOn) return null;
    const [s, e] = m.indices!.groups!.target;
    return {
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      range: { start: s, end: e },
      alternatives: [it === "It" ? "Its" : "its"],
      context: evidence(ctx, m.index, m.index + m[0].length),
    };
  },
  /** "When go you home?", "Where went she?": a fronted lexical verb needs do-support. */
  wordClassQuestionWithoutDo: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const { verb, subject } = m.groups!;
    if (FUNCTION_WORDS.has(verb) || FIXED_INVERSION.test(verb) || ctx.dictionary.has(verb))
      return null;
    // A direct question: the sentence ends in "?".
    if (!/^[^.!\n]*\?/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 160)))
      return null;
    const read = finite(verb);
    if (!read) return null;
    const singular = /^(?:he|she)$/i.test(subject);
    const aux = read.tense === "past" ? "did" : read.tense === "third" || singular ? "does" : "do";
    if (read.tense === "third" && !singular) return null;
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_question_do",
      range: { start, end },
      alternatives: [`${aux} ${subject} ${read.lemma}`],
      context: evidence(ctx, m.index, end),
    };
  },
  /** "I work here since 2002", "The boy is here since 10": since + a starting point needs a perfect. */
  wordClassSinceWithSimpleTense: (m, ctx) => {
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|that|because)$/.test(wordBefore(ctx, m.index))
    )
      return null;
    const subject = m.groups!.subject.toLowerCase();
    const word = m.groups!.target;
    if (ctx.dictionary.has(word)) return null;
    // "since 10 people complained": since meaning because.
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      /^[0-9]/.test(m.groups!.point) &&
      after?.kind === "word" &&
      !/^(?:am|pm|and|or|o)$/.test(after.lower)
    )
      return null;
    let singular = /^(?:he|she|it)$/.test(subject);
    if (/\s/.test(subject)) {
      const number = nounNumber(subject.split(/\s+/).pop()!);
      if (!number) return null;
      singular = number.number === "singular";
    }
    const have = singular ? "has" : "have";
    let perfect: string;
    if (/^(?:am|is|are|was|were)$/.test(word)) {
      if ((word === "am" && subject !== "i") || (word === "is" && !singular)) return null;
      perfect = `${have} been`;
    } else {
      if (FUNCTION_WORDS.has(word)) return null;
      const read = finite(word);
      if (!read || (read.tense === "third" && !singular) || (read.tense === "base" && singular))
        return null;
      const participle = participleOf(read.lemma);
      if (!participle) return null;
      perfect = `${have} ${participle}`;
    }
    const [start, end] = m.indices!.groups!.target;
    return finding("englishTenseConsistency", "review_msg_since_perfect", start, end, [perfect], {
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  },
  /**
   * "There are a theory…", "There exist a school…", "There are argument whether…": existential
   * there with a plural verb and one singular noun.
   */
  wordClassExistentialSingular: (m, ctx) => {
    if (!THERE_CUE.test(ctx.text.slice(Math.max(0, m.index - 40), m.index))) return null;
    const verb = m.groups!.verb;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 14);
    const article = /^an?$/.test(tokens[0]?.lower ?? "");
    let k = article ? 1 : 0;
    // Up to two adjectives before the head ("a new theory").
    while (
      article &&
      k < 3 &&
      tokens[k + 1]?.kind === "word" &&
      englishWordInfo(tokens[k].lower)?.adjective &&
      !englishWordInfo(tokens[k].lower)?.noun
    )
      k++;
    const head = tokens[k];
    if (head?.kind !== "word" || head.text !== head.lower || ctx.dictionary.has(head.lower))
      return null;
    const noun = head.lower;
    if (FUNCTION_WORDS.has(noun) || QUANTITY_NOUNS.test(noun) || NUMBER_WORD.test(noun))
      return null;
    const number = nounNumber(noun);
    const read = englishWordInfo(noun);
    if (number?.number !== "singular" || number.singular === number.plural) return null;
    if (read?.adjective || read?.verbs.some((v) => v.form !== "base")) return null;
    const next = tokens[k + 1];
    // "a theory of…" may still be fine; "a cat and a dog" is plural; a noun after is a compound;
    // the authored existential check leaves a relative clause ("a problem that needs") alone.
    if (next?.kind === "word" && /^(?:of|and|or|nor|that|which|who)$/.test(next.lower)) return null;
    if (
      next?.kind === "word" &&
      !FUNCTION_WORDS.has(next.lower) &&
      (nounOnly(next.lower) || englishWordInfo(next.lower)?.noun)
    )
      return null;
    // A coordination later in the sentence makes the whole plural: "a school … and a library",
    // also across a line break.
    const clauseRest = /^[^.!?;]*/.exec(ctx.text.slice(head.end, head.end + 200))![0];
    if (/,|&|\b(?:and|or)\b/i.test(clauseRest)) return null;
    const singularVerb = verb === "exist" ? "exists" : verb === "were" ? "was" : "is";
    const [start, end] = m.indices!.groups!.verb;
    if (article) {
      return {
        ruleId: "englishExistentialAgreement",
        messageKey: "review_msg_existential_agreement",
        range: { start, end },
        alternatives: [singularVerb],
        context: evidence(ctx, m.index, head.end),
      };
    }
    // A bare singular the authored table leaves out: "is a problem" or "are problems".
    if (verb === "exist" || knownEnglishNounNumber(noun)) return null;
    if (
      !next ||
      !(
        next.kind === "end" ||
        next.kind === "comma" ||
        (next.kind === "word" && BARE_TAIL.test(next.lower))
      )
    )
      return null;
    const a = englishInitialSound(noun) === "vowel" ? "an" : "a";
    return {
      ruleId: "englishExistentialAgreement",
      messageKey: "review_msg_existential_agreement",
      range: { start, end: head.end },
      alternatives: [`${singularVerb} ${a} ${noun}`, `${verb} ${number.plural}`],
      requiresChoice: true,
      context: evidence(ctx, m.index, head.end),
    };
  },
  /**
   * "the script it not visible", "nothing it working", "this it the same issue": "it" typed for
   * "is" after a subject that is a noun phrase or an indefinite pronoun.
   */
  wordClassItForIs: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    if (!before) return null;
    const next = m.groups!.next;
    let subject: boolean;
    if (/^(?:this|that)$/.test(before))
      // "this it the exact issue": a determiner-led predicate after this/that.
      subject = /^(?:the|a|an|not)$/.test(next) && afterBreak(ctx, m.index - before.length - 1);
    else {
      // "the script it", "an update it", "nothing (else) it".
      const run = /([A-Za-z]+)[ \t ]+([A-Za-z]+)[ \t ]+$/.exec(
        ctx.text.slice(Math.max(0, m.index - 40), m.index),
      );
      const det = run?.[1].toLowerCase() ?? "";
      subject =
        INDEFINITE.test(before) ||
        (before === "else" && INDEFINITE.test(det)) ||
        (/^(?:the|an|a|my|your|our|their|this)$/.test(det) &&
          (nounOnly(before) === "singular" ||
            (!!englishWordInfo(before)?.noun && !englishWordInfo(before)?.plural)));
    }
    if (!subject) return null;
    // The predicate: not + a word, an -ing form, or an adjective, then the clause ends or goes on.
    const read = englishWordInfo(next);
    const predicate =
      next === "not" ||
      /^(?:the|a|an)$/.test(next) ||
      (!!read?.verbs.some((v) => v.form === "ing") && !read.noun) ||
      (!!read?.adjective && !read.noun && !read.verbs.length && !/ly$/.test(next));
    // "the way it currently…", "the time it took": a relative clause after its head.
    if (
      /^(?:way|time|place|day|reason|moment|amount|speed|rate|extent|year|night|morning)$/.test(
        before,
      )
    )
      return null;
    if (!predicate) return null;
    const [start, end] = m.indices!.groups!.target;
    return finding("englishConfusedWords", "review_msg_confused_word", start, end, ["is"], {
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  },
  /** "I was bit confused", "I'm bit tired": "a bit" before an adjective lost its article. */
  wordClassBareBit: (m, ctx) => {
    const next = m.groups!.next;
    // "I was bit by a dog", "got bit hard": the past of bite.
    if (/^(?:by|hard|badly|again|twice|once|while|when)$/.test(next)) return null;
    const read = englishWordInfo(next);
    const degree = /^(?:too|more|less|late|early|much|of)$/.test(next);
    // An adjective or a participle adjective ("confused", "tired"), never a bare verb.
    const adjective =
      !!read &&
      (read.adjective || read.verbs.some((v) => v.form === "participle")) &&
      !read.noun &&
      !read.verbs.some((v) => v.form === "base" || v.form === "third") &&
      !/ly$/.test(next);
    if (!degree && !adjective) return null;
    const [start, end] = m.indices!.groups!.target;
    return finding(
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      start,
      end,
      ["a bit"],
      {
        context: evidence(ctx, m.index, m.index + m[0].length),
      },
    );
  },
  /** "an a flower", "the this idea", "a this dog": two determiners where one belongs. */
  wordClassStackedArticles: (m, ctx) => {
    const { first, second, noun } = m.groups!;
    // "an an owl", "a a bike": a repeated article belongs to the repeated-word check; "an a
    // flower" keeps the one the noun's sound takes.
    if (first.toLowerCase() === second.toLowerCase()) return null;
    // Letters and Latin: "the a key", "an a priori case", "the A team".
    if (
      second !== second.toLowerCase() ||
      /^(?:priori|posteriori|fortiori|la|capella|cappella)$/.test(noun)
    )
      return null;
    if (
      /^an?$/.test(second) &&
      /^(?:key|button|letter|variable|vowel|grade|side|string|column|field|sound|note|chord|word|team|list|level|version|type|class|series|plus|minus|major|minor|flat|sharp|grader|student|rating|score)$/.test(
        noun,
      )
    )
      return null;
    if (first !== first.toLowerCase() && !afterBreak(ctx, m.index)) return null;
    const read = englishWordInfo(noun);
    if (!read || !(read.noun || read.adjective) || FUNCTION_WORDS.has(noun)) return null;
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    // Either determiner alone; a/an follows the noun's first sound.
    const article = englishInitialSound(noun) === "vowel" ? "an" : "a";
    const alternatives = [
      ...new Set(
        [first, second].map((d) => {
          const word = /^an?$/i.test(d) ? article : d.toLowerCase();
          return /^[A-Z]/.test(first) ? word[0].toUpperCase() + word.slice(1) : word;
        }),
      ),
    ];
    return finding(
      "englishSentenceStructure",
      "review_msg_determiner_clash",
      start,
      end,
      alternatives,
      {
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
        context: evidence(ctx, m.index, m.index + m[0].length),
      },
    );
  },
  /**
   * "Because he was a great musician.", "When the wind howls in the trees.": a sentence that is
   * only a subordinate clause. Opt-in: answers and asides use such fragments on purpose.
   */
  wordClassSubordinateFragment: (m, ctx) => {
    const target = m.groups!.target;
    if (!/^[A-Z]/.test(target) || !afterBreak(ctx, m.index) || !SUBORDINATOR.test(target))
      return null;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 30);
    const end = tokens.findIndex((t) => t.kind !== "word" && t.kind !== "number");
    // The sentence ends with a plain period: no comma, no list, no question or ellipsis.
    const stop = tokens[end];
    if (end < 2 || stop?.kind !== "end" || stop.text !== ".") return null;
    if (/^\.\./.test(ctx.text.slice(stop.start, stop.start + 2))) return null;
    // The clause opens with its subject: a pronoun, a determiner phrase or a name, so a
    // preposition reading ("After a long absence he came back") never applies.
    const clause = tokens.slice(0, end);
    const first = clause[0].lower;
    const subjectStart =
      /^(?:i|you|he|she|it|we|they|there|someone|everyone|nobody|nothing|everything|something)$/.test(
        first,
      ) ||
      (/^(?:the|my|your|his|her|our|their|this|these|those|a|an|every|each|some)$/.test(first) &&
        clause.length > 2) ||
      (clause[0].text !== first && !englishWordInfo(first));
    // "If only he knew", "As if…": exclamations and comparisons.
    if (!subjectStart || first === "only") return null;
    // A determiner phrase followed by a pronoun was a prepositional opener: "After a long
    // absence he came back".
    if (
      !/^(?:i|you|he|she|it|we|they)$/.test(first) &&
      clause.slice(1).some((t) => /^(?:i|you|he|she|we|they)$/.test(t.lower))
    )
      return null;
    if (finiteCount(clause) !== 1) return null;
    const [start, e] = m.indices!.groups!.target;
    return finding("englishSentenceFragment", "review_msg_sentence_fragment", start, e, [], {
      warningOnly: true,
      context: evidence(ctx, m.index, stop.end),
    });
  },
  /** "I look forward.", "I'm looking forward!": the phrase needs "to" and what is awaited. */
  wordClassForwardWithoutObject: (m, ctx) => {
    const range = m.indices!.groups!.target ?? m.indices!.groups!.target2;
    return {
      ruleId: "englishSentenceFragment",
      messageKey: "review_msg_sentence_fragment",
      range: { start: range[0], end: m.index + m[0].length },
      alternatives: [],
      warningOnly: true,
      context: evidence(ctx, m.index, m.index + m[0].length),
    };
  },
  /** "look forward your reply", "looking forward in hearing from you": the phrase takes "to". */
  wordClassForwardPreposition: (m, ctx) => {
    const { wrong, next } = m.groups!;
    const owned =
      /^(?:your|our|their|his|her|my|the|seeing|hearing|meeting|working|receiving|reading|talking|speaking|getting|having)$/.test(
        next,
      );
    // "look forward into the fender area", "look forward five years": a direction.
    if (!owned || (wrong && !/ing$/.test(next) && wrong !== "of")) return null;
    if (!wrong && !/^(?:your|our|their|his|her|my|the)$/.test(next) && !/ing$/.test(next))
      return null;
    // A determiner after a bare "forward" needs an awaited thing: "look forward your reply".
    if (!wrong && /^(?:the|his|her|my)$/.test(next)) {
      const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      if (
        after?.kind !== "word" ||
        !/^(?:reply|response|answer|meeting|visit|call|news|results|weekend|holidays?|trip|event|release|launch|concert|party|game)$/.test(
          after.lower,
        )
      )
        return null;
    }
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "englishFixedPrepositions",
      messageKey: "review_msg_fixed_prepositions",
      range: { start, end },
      alternatives: ["forward to"],
      context: evidence(ctx, m.index, m.index + m[0].length),
    };
  },
} satisfies Record<string, MatchFixer>;
