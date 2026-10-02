/** Lowercase Greek without accents or diaeresis: "Άντρας" -> "αντρας". */
export const bareGreek = (word: string) =>
  word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The word is written in Greek letters. */
export const isGreek = (word: string) => /^[Ͱ-Ͽἀ-῿]/u.test(word);

/**
 * Whether a final ν stays before `next`: before a vowel, κ π τ ξ ψ and the
 * digraphs μπ ντ γκ (τσ τζ start with τ); dropped before the continuants
 * β γ δ ζ θ λ μ ν ρ σ φ χ. Undefined for a word not in Greek letters.
 */
export function keepsFinalNu(next: string): boolean | undefined {
  if (!isGreek(next)) return undefined;
  return /^(?:[αεηιουωκπτξψ]|μπ|ντ|γκ)/.test(bareGreek(next));
}
