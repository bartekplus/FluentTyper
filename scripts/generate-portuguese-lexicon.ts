// Derives the Portuguese accent-paronym table behind Review's Portuguese checks from the Hunspell
// dictionary the extension ships (VERO pt_BR.dic/.aff): every unaccented word the dictionary only
// knows as a finite verb form ("fabrica", "duvida") paired with the accented noun or adjective
// spelled with the same letters ("fábrica", "dúvida").
// Writes src/core/domain/grammar/review/portuguese/paronyms.generated.ts.
// Usage: bun run generate:portuguese-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Rule = { strip: string; add: string; cond: RegExp };
type Affix = { prefix: boolean; cross: boolean; rules: Rule[] };

const root = resolve(import.meta.dir, "..");
export const PORTUGUESE_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/pt_BR/hunspell/pt_BR.dic"),
  aff: resolve(root, "resources_js/pt_BR/hunspell/pt_BR.aff"),
  out: resolve(root, "src/core/domain/grammar/review/portuguese/paronyms.generated.ts"),
};

// VERO's .aff documents its classes: lowercase suffix flags conjugate verbs (b and j spell
// participles and -dor adjectives; k-s and v spell hyphenated clitic forms, which never collide
// with a noun), uppercase letters and digits spell nouns and adjectives, accented letters prefix.
const FINITE_VERB_FLAGS = new Set("acdefghituw");
const CLITIC_FLAGS = new Set("kmnopqrsv");
const FORBIDDEN = "ý";
const NO_SUGGEST = "Ý";
const RARE = "~";

// VERO folds a noun into a verb entry when the spellings coincide (coisa, jogo, secretaria), so
// "only a verb form" needs a second opinion. These plain spellings are common on their own in the
// shipped pt_BR n-gram counts (as often as half their accented twin, or after a determiner), so
// they stay unflagged: everyday nouns, names and frequent verb forms such as "seria" or "sabia".
const COMMON_ON_THEIR_OWN = new Set(
  `abalo acaricia amplifica arias ataca bali bebia beneficiaria cabula caiba calamos celebre
  circuito comia comportaria confidencia continua credencia curtia danifica dedica digamos
  digite domina edita edito elege engodo escancara espera esperas estadia estadias estipula
  examina fabrico facilitaria faria farias feria ficaria filosofa florido floridos homilia
  homilias hospeda incomoda indica indico influenciaria integra invalida irrita lambia leria
  ligaria lugares lutaria luzia macetes melodia melodias mobile munida munidas murmura
  murmuro necessitaria necropsia ninharia ninharias nutria opera palio paralise paramos
  parecia paris participe passara patina paulo penico penseis perpetua polia polias polis
  prestamos prolifera propicia queria querias radica recita recua reina reuso rocio sabia
  sacrifica sacrifico secretaria secretarias sedia seria serraria servia simula solicita
  solicito subsecretaria supera suplico temia teria termina tocaria trafega transita vacaria
  valeria valia valias vangloria varia venera vestia vicia viria vivifica voltaria`.split(/\s+/),
);

// The .aff's SET line names the encoding of both files (VERO ships ISO8859-1).
function decoder(affBytes: Uint8Array): (bytes: Uint8Array) => string {
  const head = new TextDecoder("latin1").decode(affBytes.subarray(0, 200));
  const set = /^SET\s+(\S+)/m.exec(head)?.[1]?.toUpperCase() ?? "UTF-8";
  const textDecoder = new TextDecoder(set === "UTF-8" ? "utf-8" : "latin1");
  return (bytes) => textDecoder.decode(bytes).replace(/\r/g, "");
}

function parseAff(aff: string): Map<string, Affix> {
  const affixes = new Map<string, Affix>();
  for (const line of aff.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const [kind, flag] = parts;
    if (kind !== "SFX" && kind !== "PFX") continue;
    if (parts.length === 4 && /^[YN]$/.test(parts[2])) {
      affixes.set(flag, { prefix: kind === "PFX", cross: parts[2] === "Y", rules: [] });
      continue;
    }
    const affix = affixes.get(flag);
    if (!affix || parts.length < 5) continue;
    const [, , strip, addField, cond] = parts;
    const add = addField.split("/")[0];
    const pattern = cond === "." ? "" : cond;
    affix.rules.push({
      strip: strip === "0" ? "" : strip,
      add: add === "0" ? "" : add,
      cond: new RegExp(affix.prefix ? `^${pattern}` : `${pattern}$`, "u"),
    });
  }
  return affixes;
}

function applySuffix(word: string, rule: Rule): string | null {
  if (!rule.cond.test(word) || !word.endsWith(rule.strip)) return null;
  return word.slice(0, word.length - rule.strip.length) + rule.add;
}

function applyPrefix(word: string, rule: Rule): string | null {
  if (!rule.cond.test(word) || !word.startsWith(rule.strip)) return null;
  return rule.add + word.slice(rule.strip.length);
}

const PLAIN_VOWEL: Record<string, string> = {
  á: "a",
  â: "a",
  é: "e",
  ê: "e",
  í: "i",
  ó: "o",
  ô: "o",
  ú: "u",
};
const strip = (word: string) => word.replace(/[áâéêíóôú]/g, (vowel) => PLAIN_VOWEL[vowel]);
// One written accent, with a consonant and a vowel after it: the stress the accent marks falls
// before the last syllable (fábrica, início), unlike the verb form it shadows (fabrica, inicio).
// An accent on the last syllable (suã, jogó) marks rare words whose plain spelling is everyday.
const STRESSED_BEFORE_LAST_SYLLABLE =
  /^[a-zç]*[áâéêíóôú](?=[a-zç]*[b-df-hj-np-tv-zç][a-zç]*[aeiou])[a-zç]*$/;

export function buildPortugueseLexicon(dicBytes: Uint8Array, affBytes: Uint8Array): string {
  const decode = decoder(affBytes);
  const affixes = parseAff(decode(affBytes));
  const verbForms = new Set<string>();
  const otherForms = new Set<string>();
  for (const line of decode(dicBytes).split("\n").slice(1)) {
    const entry = line.trim();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    const word = slash < 0 ? entry : entry.slice(0, slash);
    const flags = [...(slash < 0 ? "" : entry.slice(slash + 1))];
    if (flags.includes(FORBIDDEN) || word !== word.toLowerCase()) continue;
    const dubious = flags.includes(NO_SUGGEST) || flags.includes(RARE);
    const isVerb = flags.some((flag) => FINITE_VERB_FLAGS.has(flag));
    // A verb entry's own spelling is its infinitive: neither a finite form nor a noun.
    if (!isVerb && !dubious) otherForms.add(word);
    const prefixes = flags.flatMap((flag) => {
      const affix = affixes.get(flag);
      return affix?.prefix ? [affix] : [];
    });
    const spell = (form: string, target: Set<string>, cross: boolean) => {
      target.add(form);
      if (!cross) return;
      for (const prefix of prefixes) {
        if (!prefix.cross) continue;
        for (const rule of prefix.rules) {
          const prefixed = applyPrefix(form, rule);
          if (prefixed) target.add(prefixed);
        }
      }
    };
    for (const flag of flags) {
      const affix = affixes.get(flag);
      if (!affix || affix.prefix || CLITIC_FLAGS.has(flag)) continue;
      const target = FINITE_VERB_FLAGS.has(flag) ? verbForms : dubious ? null : otherForms;
      if (!target) continue;
      for (const rule of affix.rules) {
        const form = applySuffix(word, rule);
        if (form) spell(form, target, affix.cross);
      }
    }
    if (!dubious && !isVerb) spell(word, otherForms, true);
  }

  const twins = new Map<string, string[]>();
  for (const form of otherForms) {
    if (verbForms.has(form) || !STRESSED_BEFORE_LAST_SYLLABLE.test(form)) continue;
    const bare = strip(form);
    if (!verbForms.has(bare) || otherForms.has(bare) || COMMON_ON_THEIR_OWN.has(bare)) continue;
    twins.set(bare, [...(twins.get(bare) ?? []), form].sort());
  }
  const rows = [...twins.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, forms]) => forms.join("|"));
  return [
    "// Generated by scripts/generate-portuguese-lexicon.ts from resources_js/pt_BR/hunspell (VERO).",
    "// Do not edit. Each entry is an accented noun or adjective whose unaccented spelling the",
    "// dictionary knows only as a finite verb form; entries sharing that spelling are joined by |.",
    `export const PORTUGUESE_PARONYMS =\n  ${JSON.stringify(rows.join(" "))};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all([
    readFile(PORTUGUESE_LEXICON_SOURCES.dic),
    readFile(PORTUGUESE_LEXICON_SOURCES.aff),
  ]);
  const output = buildPortugueseLexicon(dic, aff);
  await writeFile(PORTUGUESE_LEXICON_SOURCES.out, output);
  console.log(`${PORTUGUESE_LEXICON_SOURCES.out}: ${output.length} bytes`);
}
