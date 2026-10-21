import { beforeAll, expect, test } from "bun:test";
import { nounVerb } from "../../src/core/domain/grammar/library/english/verbs";
import { ptClauseVerb } from "../../src/core/domain/grammar/library/portuguese/clauses";
import { ptConjugate, ptSubjunctive } from "../../src/core/domain/grammar/library/portuguese/verbs";
import { loadAllReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";

// The library tables that a word keys have no prototype: an Object member name such as
// "constructor" finds nothing, as an unknown word of the same casing ("xxxxxxxxxxx") does.
const MEMBERS = Object.getOwnPropertyNames(Object.prototype).filter((name) => /^[a-z]/i.test(name));

/** An unknown word with the letters and the casing of `word`: "toString" -> "xxXxxxxx". */
const unknown = (word: string) => word.replace(/\p{Lu}/gu, "X").replace(/\p{Ll}/gu, "x");

/** The forms of `verb`, or the error it gives, with `verb` written as `name`. */
const conjugation = (verb: string, name: string) => {
  try {
    return ptConjugate(verb);
  } catch (error) {
    return String(error).replace(verb, name);
  }
};

beforeAll(async () => {
  await loadAllReviewData();
});

test("English: a member name has no verb of its own", () => {
  for (const member of MEMBERS) {
    expect({ member, verb: nounVerb(member) }).toEqual({ member, verb: nounVerb(unknown(member)) });
    expect({ member, verb: nounVerb(`${member}s`) }).toEqual({
      member,
      verb: nounVerb(`${unknown(member)}s`),
    });
  }
});

test("Portuguese: a member name is no pronoun, no irregular verb and no listed paradigm", () => {
  for (const member of MEMBERS) {
    const clause = ptClauseVerb(`${member} fala muito.`, 0);
    expect({ member, person: clause?.person }).toEqual({
      member,
      person: ptClauseVerb(`${unknown(member)} fala muito.`, 0)?.person,
    });
    expect({ member, subjunctive: ptSubjunctive(member) }).toEqual({
      member,
      subjunctive: ptSubjunctive(unknown(member)),
    });
    // A word that is no infinitive throws "Not a verb", the same for both.
    expect({ member, forms: conjugation(member, member) }).toEqual({
      member,
      forms: conjugation(unknown(member), member),
    });
  }
});
