/**
 * Tails that also head a "de" phrase: "recuou para trás da ponte" (behind), "avançou para a
 * frente do palco", "adiou para depois do almoço", "previu antes de todos". There the tail is
 * not a repeat, and to drop it breaks the sentence (phraseCorrections skips the row).
 */
export const PORTUGUESE_DE_PHRASE_TAIL =
  /(?:para\s+(?:a\s+)?frente|para\s+trás|para\s+depois|dentro|junto|antes|com\s+antecedência|o\s+futuro|a\s+cabeça|o\s+pescoço)$/iu;
