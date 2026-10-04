// A limited clause reader that the agreement checks of several languages share. It is not a
// parser. From the head noun of a subject, it reads past the adjectives after the noun, up to
// four complements ("de la maison", "of the list"), and a relative clause whose subject is the
// relative pronoun ("qui transmet depuis Lyon", "who ran the light"). Then it gives the index of
// the finite verb of the main clause.
//
// The reader works on the caller's tokens: the words of one clause, in order. Each step reads a
// fixed maximum number of tokens, so one read is bounded and a scan is linear in the chunk. When a
// step is not sure, it stops: a skip function gives back its start index, and a verb function
// gives -1. The caller then reports nothing.

/** A word of a clause: lowercase, with its offsets. `hyphen`: a hyphen joins it to the next word. */
export interface ClauseToken {
  w: string;
  start: number;
  end: number;
  hyphen: boolean;
}

/** The words and the lexicon of one language. */
export interface ClauseProfile {
  /** Determiners that open a noun phrase: "le", "les", "the", "these". */
  determiners: ReadonlySet<string>;
  /** Prepositions that open a complement of a noun: "de", "dans", "of", "in". */
  prepositions: ReadonlySet<string>;
  /** Words that stand for a determiner after a preposition: "certaines", "all". */
  quantifiers: ReadonlySet<string>;
  /** Number words that may follow a determiner: "deux", "two". */
  numbers: ReadonlySet<string>;
  /** Words that are never the noun of a complement. */
  notHeads: ReadonlySet<string>;
  /** "et", "ou", "and", "or": they join two adjectives after a noun. */
  coordinators: ReadonlySet<string>;
  /** Stressed pronouns that close a complement: "de moi", "pour toi", "for them". */
  pronouns: ReadonlySet<string>;
  /** Relative pronouns that are the subject of their clause: "qui", "who", "which", "that". */
  relatives: ReadonlySet<string>;
  /** Words between a subject and its verb: negation and object pronouns ("ne", "se", "lui"). */
  clitics: ReadonlySet<string>;
  /** Adverbs that may come between a clause and the main verb: "toujours", "usually". */
  adverbs: ReadonlySet<string>;
  /** A noun as far as the lexicon knows, or a name. */
  isNoun(text: string, t: ClauseToken): boolean;
  /** An adjective that is the head of its phrase, with no noun after it: "des communes". */
  nominal(text: string, tokens: readonly ClauseToken[], k: number): boolean;
  /** An adjective or a past participle after a noun: "financiers", "inscrits". */
  postnominal(t: ClauseToken | undefined): boolean;
  /** The index past an adjective before a noun at `i` ("la vieille chèvre"), or `i`. */
  prenominal(text: string, tokens: readonly ClauseToken[], i: number): number;
  /** A finite verb form, as against a noun or an infinitive. */
  isFiniteVerb(t: ClauseToken): boolean;
}

const capital = (text: string, t?: ClauseToken) =>
  !!t && /^\p{Lu}\p{Ll}/u.test(text.slice(t.start, t.end));

/** Index past up to two adjectives after a noun: "les flux financiers actuels", "les
 * entraînements phonologiques et multisensoriels". */
export function skipPostnominal(
  p: ClauseProfile,
  tokens: readonly ClauseToken[],
  i: number,
): number {
  for (let n = 0; n < 2 && p.postnominal(tokens[i]); n++) {
    i++;
    if (p.coordinators.has(tokens[i]?.w ?? "") && p.postnominal(tokens[i + 1])) i += 2;
  }
  return i;
}

/** Index past one complement of the head noun: "des maisons", "dans le jardin", "de Nora".
 * `nouns` gets the index of the complement's noun. */
function skipComplement(
  p: ClauseProfile,
  text: string,
  tokens: readonly ClauseToken[],
  i: number,
  nouns?: number[],
): number {
  if (!tokens[i] || !p.prepositions.has(tokens[i].w)) return i;
  let k = i + 1;
  // "pour toi", "of them": a stressed pronoun closes the complement.
  if (tokens[k] && p.pronouns.has(tokens[k].w) && !tokens[k].hyphen) return k + 1;
  // "de certaines voyelles": a quantifier is a determiner here.
  if (tokens[k] && (p.determiners.has(tokens[k].w) || p.quantifiers.has(tokens[k].w))) k++;
  // "entre ces deux langues": a number after the determiner.
  if (k > i + 1 && tokens[k] && p.numbers.has(tokens[k].w)) k++;
  // "des petites communes": an adjective before the noun.
  k = p.prenominal(text, tokens, k);
  const noun = tokens[k];
  // "de Pont-Menhir", "de Saint-Malo": a hyphenated name.
  if (noun?.hyphen && capital(text, noun) && capital(text, tokens[k + 1]) && !tokens[k + 1].hyphen)
    return skipPostnominal(p, tokens, k + 2);
  if (!noun || noun.hyphen || p.notHeads.has(noun.w)) return i;
  if (!p.isNoun(text, noun) && !p.nominal(text, tokens, k)) return i;
  nouns?.push(k);
  // "du Père Noël", "de Jean Dupont": a name of two capitalized words.
  if (capital(text, noun) && capital(text, tokens[k + 1]) && !capital(text, tokens[k + 2])) k++;
  return skipPostnominal(p, tokens, k + 1);
}

/** Index past up to four complements: "les flux au sein des systèmes de santé". `nouns` gets the
 * index of each complement's noun. */
export function skipComplements(
  p: ClauseProfile,
  text: string,
  tokens: readonly ClauseToken[],
  i: number,
  nouns?: number[],
): number {
  for (let n = 0; n < 4; n++) {
    const next = skipComplement(p, text, tokens, i, nouns);
    if (next === i) break;
    i = next;
  }
  return i;
}

/** Index past a noun phrase at `i`: a determiner, a number, an adjective before the noun, the
 * noun and the adjectives after it ("the light", "les deux petites maisons rouges"); `i` when
 * there is none. `nouns` gets the index of the noun. */
export function skipNounPhrase(
  p: ClauseProfile,
  text: string,
  tokens: readonly ClauseToken[],
  i: number,
  nouns?: number[],
): number {
  if (!tokens[i] || !p.determiners.has(tokens[i].w)) return i;
  let k = i + 1;
  if (tokens[k] && p.numbers.has(tokens[k].w)) k++;
  k = p.prenominal(text, tokens, k);
  const noun = tokens[k];
  if (!noun || noun.hyphen || p.notHeads.has(noun.w) || !p.isNoun(text, noun)) return i;
  nouns?.push(k);
  return skipPostnominal(p, tokens, k + 1);
}

/** The index of the main verb after a relative clause at `i` whose subject is the relative
 * pronoun: "qui transmet depuis Lyon | sont", "who ran the light fatally | injures". `agrees`
 * tells whether the relative's own verb agrees with the head noun; -1 when unsure. The clause
 * may hold an object, up to four complements and adverbs, and nothing else. */
export function verbAfterRelative(
  p: ClauseProfile,
  text: string,
  tokens: readonly ClauseToken[],
  i: number,
  agrees: (verb: ClauseToken) => boolean,
): number {
  if (!tokens[i] || !p.relatives.has(tokens[i].w)) return -1;
  let j = i + 1;
  while (tokens[j] && p.clitics.has(tokens[j].w)) j++;
  const verb = tokens[j];
  if (!verb || verb.hyphen || !p.isFiniteVerb(verb) || !agrees(verb)) return -1;
  // "qui est arrivée hier", "who was born": a participle or an attribute after the verb.
  let k = skipPostnominal(p, tokens, j + 1);
  k = skipNounPhrase(p, text, tokens, k);
  k = skipComplements(p, text, tokens, k);
  while (tokens[k] && p.adverbs.has(tokens[k].w)) k++;
  // Nothing was read past the verb: the next word may still belong to its clause.
  if (k === j + 1) return -1;
  const main = tokens[k];
  return main && !main.hyphen && p.isFiniteVerb(main) ? k : -1;
}
