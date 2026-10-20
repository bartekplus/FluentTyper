import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { MatchFixer } from "../../engine/reviewRules";
import { caseLike, evidence } from "./slotWords";

// A second negative in a clause a negated verb already denies: "I didn't see nothing"
// (anything), "There wasn't nobody there" (anybody), "She could not hardly hear" (could hardly).

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

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  negationDouble: (m, ctx) => {
    const { aux, between, target } = m.groups!;
    const word = target.toLowerCase();
    const words = between.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.some((w) => CLAUSE_BREAK.test(w))) return null;
    if (hasUserOrCasedWord(ctx, m[0].slice(aux.length))) return null;
    const last = words.at(-1) ?? "";
    // "not for nothing" (in vain), "say no", "not nothing" (litotes).
    if (/^(?:for|say|said|says|saying|answer|answered|vote|voted|take|took)$/.test(last))
      return null;
    if (!words.length && word !== "no" && /\bnot$/i.test(aux)) return null;
    const auxWord = aux.toLowerCase();
    // "It isn't nothing", "that's not nothing": litotes after be; "there wasn't nobody" is not.
    if (/^(?:is|are|was|were|am)/.test(auxWord) && !words.length) {
      const subject = /([A-Za-z]+)[ \t\u00a0]+$/.exec(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      );
      if (subject?.[1].toLowerCase() !== "there") return null;
    }
    // "We can't just do nothing": a modal over idle doing is standard; "didn't do nothing" is not.
    if (word === "nothing" && /^(?:do|say|sit)$/.test(last) && !/^(?:do|does|did)/.test(auxWord))
      return null;
    const end = m.indices!.groups!.target[1];
    // "nobody else was there": look past "else".
    const after = /^[ \t\u00a0]+([A-Za-z]+)(?:[ \t\u00a0]+([A-Za-z]+))?/.exec(
      ctx.text.slice(end, end + 32),
    );
    const next = (after?.[1] === "else" ? after[2] : after?.[1])?.toLowerCase();
    if (word === "no") {
      if (!next || NO_PHRASES.test(next)) return null;
      // "Don't tell me no fan ever cried": what is told is a clause of its own.
      if (/^(?:tell|told|say|said|mean|think|guess)$/.test(words[0] ?? "")) return null;
      // "No" before a noun only: "don't give me no excuses".
      const read = englishWordInfo(next);
      if (read && !read.noun && !read.plural && !read.adjective) return null;
    } else if (next) {
      // "I didn't know nobody was home": the negative pronoun subjects its own clause.
      if (/^(?:is|was|were|are|has|had|have|can|could|will|would|should|did|does)$/.test(next))
        return null;
      if (englishWordInfo(next)?.verbs.some((v) => v.form === "third" || v.form === "past"))
        return null;
      // "don't want neither … nor …": either … or needs both words changed.
      if (word === "neither" && /\bnor\b/i.test(ctx.text.slice(end, end + 80))) return null;
    }
    const [start] = m.indices!.groups!.target;
    return {
      ruleId: "englishUsagePhrases",
      messageKey: "review_msg_double_negative",
      range: { start, end },
      alternatives: [caseLike(target, ANY[word])],
      context: evidence(ctx, m.index, end),
    };
  },
  negationHardly: (m, ctx) => {
    const { target, aux, can, will } = m.groups!;
    const kept = aux ?? (can ? "can" : will ? "will" : "");
    if (hasUserOrCasedWord(ctx, target.replace(/n['’]t$/i, ""))) return null;
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "englishUsagePhrases",
      messageKey: "review_msg_negated_hardly",
      range: { start, end },
      alternatives: [caseLike(target, kept.toLowerCase())],
      context: evidence(ctx, start, end + 12),
    };
  },
} satisfies Record<string, MatchFixer>;
