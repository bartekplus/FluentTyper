// Shared helpers for the scripts/generate-*-lexicon.ts generators: Hunspell affix rules, front
// coding, Bloom filters and the n-gram model the extension ships (marisa-trie keys and counts).
import { readFileSync } from "node:fs";
import {
  BLOOM_ALPHABET,
  bloomBits,
} from "../src/core/domain/grammar/implementations/helpers/EnglishLexicon";

/* ------------------------------------------------------------- affix rules */

/** One SFX or PFX rule line of a Hunspell .aff file. */
export interface AffixRule {
  kind: "SFX" | "PFX";
  flag: string;
  strip: string;
  /** The added text, without the continuation classes. */
  add: string;
  /** The continuation classes after "/" in the add field. */
  classes: string;
  /** The condition, "" for ".". */
  pattern: string;
  /** The condition, anchored at the end (SFX) or at the start (PFX). */
  cond: RegExp;
}

/** Every SFX and PFX rule of an .aff file, in file order. Header lines have no condition. */
export function parseAffixRules(aff: string): AffixRule[] {
  const rules: AffixRule[] = [];
  for (const line of aff.split("\n")) {
    const [kind, flag, strip, addField, cond] = line.trim().split(/\s+/);
    if ((kind !== "SFX" && kind !== "PFX") || cond === undefined) continue;
    const [add, classes = ""] = addField.split("/");
    const pattern = cond === "." ? "" : cond;
    rules.push({
      kind,
      flag,
      strip: strip === "0" ? "" : strip,
      add: add === "0" ? "" : add,
      classes,
      pattern,
      cond: new RegExp(kind === "SFX" ? `${pattern}$` : `^${pattern}`),
    });
  }
  return rules;
}

/** The rules of each flag, in file order. */
export function rulesByFlag(rules: readonly AffixRule[]): Map<string, AffixRule[]> {
  const byFlag = new Map<string, AffixRule[]>();
  for (const rule of rules) {
    const list = byFlag.get(rule.flag);
    if (list) list.push(rule);
    else byFlag.set(rule.flag, [rule]);
  }
  return byFlag;
}

/** The form `rule` spells from `word`, or null when its condition or strip does not match. */
export function applyAffix(word: string, rule: AffixRule): string | null {
  if (!rule.cond.test(word)) return null;
  if (rule.kind === "SFX")
    return word.endsWith(rule.strip)
      ? word.slice(0, word.length - rule.strip.length) + rule.add
      : null;
  return word.startsWith(rule.strip) ? rule.add + word.slice(rule.strip.length) : null;
}

/* ------------------------------------------------------- encoded word lists */

/**
 * Front coding of sorted words: each word as the count of leading characters it shares with
 * the word before (one digit in `radix`, so at most radix - 1), then the rest.
 */
export function frontCode(words: readonly string[], radix: 10 | 36, separator: string): string {
  let previous = "";
  return words
    .map((word) => {
      let shared = 0;
      while (shared < radix - 1 && shared < word.length && word[shared] === previous[shared])
        shared++;
      previous = word;
      return shared.toString(radix) + word.slice(shared);
    })
    .join(separator);
}

/**
 * A Bloom filter of `keys` with `bitsPerKey` bits a key (and `hashes` hashes, bloomBits's
 * default when not given), as six bits per character of BLOOM_ALPHABET, lowest bit first.
 */
export function bloom(keys: readonly string[], bitsPerKey: number, hashes?: number): string {
  const size = Math.max(6, Math.ceil((keys.length * bitsPerKey) / 6) * 6);
  const bits = new Uint8Array(size);
  for (const key of keys) for (const bit of bloomBits(key, size, hashes)) bits[bit] = 1;
  let filter = "";
  for (let i = 0; i < size; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= bits[i + b] << b;
    filter += BLOOM_ALPHABET[value];
  }
  return filter;
}

/* ------------------------------------------------------------ n-gram model */

// A minimal reader for the marisa-trie file Presage loads: it walks the LOUDS tree in order and
// restores every key, whose id is its rank among terminal nodes.
interface Bits {
  units: Uint8Array;
  size: number;
  ones: number;
}
interface LoudsTrie {
  link: Bits;
  terminal: Bits;
  bases: Uint8Array;
  extras: Uint8Array;
  extraBits: number;
  tail: Uint8Array;
  tailEnds: Bits;
  next: LoudsTrie | null;
  parent: Int32Array;
  linkRank: Int32Array;
}
const bitAt = (bits: Bits | Uint8Array, i: number) =>
  ((bits instanceof Uint8Array ? bits : bits.units)[i >> 3] >> (i & 7)) & 1;

function readMarisa(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  let pos = 16; // "We love Marisa."
  const u32 = () => ((pos += 4), view.getUint32(pos - 4, true));
  const u64 = () => ((pos += 8), Number(view.getBigUint64(pos - 8, true)));
  const vector = () => {
    const size = u64();
    const bytes = new Uint8Array(buffer, pos, size);
    pos += size + ((8 - (size % 8)) % 8);
    return bytes;
  };
  const bitVector = (): Bits => {
    const units = vector();
    const size = u32();
    const ones = u32();
    vector(); // rank index
    vector(); // select0 index
    vector(); // select1 index
    return { units, size, ones };
  };
  const trie = (): LoudsTrie => {
    const louds = bitVector();
    const terminal = bitVector();
    const link = bitVector();
    const bases = vector();
    const extras = vector();
    const extraBits = u32();
    u32(); // mask
    u64(); // size
    const tail = vector();
    const tailEnds = bitVector();
    const next = link.ones !== 0 && tail.length === 0 ? trie() : null;
    vector(); // cache
    u32(); // level-1 nodes
    u32(); // config
    // LOUDS: "10" for the super root, then for each node one 1 per child and a 0.
    const parent = new Int32Array(bases.length);
    for (let node = 0, cursor = 2, child = 1; node < bases.length; node++, cursor++)
      for (; cursor < louds.size && bitAt(louds, cursor); cursor++) parent[child++] = node;
    const linkRank = new Int32Array(bases.length);
    for (let i = 0, rank = 0; i < bases.length; i++) {
      linkRank[i] = rank;
      rank += bitAt(link, i);
    }
    return { link, terminal, bases, extras, extraBits, tail, tailEnds, next, parent, linkRank };
  };
  const top = trie();

  const label = (t: LoudsTrie, node: number, out: number[]) => {
    if (!bitAt(t.link, node)) return void out.push(t.bases[node]);
    let extra = 0;
    for (let b = 0, at = t.linkRank[node] * t.extraBits; b < t.extraBits; b++, at++)
      extra |= bitAt(t.extras, at) << b;
    const link = t.bases[node] | (extra << 8);
    // A next-level trie holds reversed strings, so walking up to its root reads them forward.
    if (t.next) for (let n = link; n !== 0; n = t.next.parent[n]) label(t.next, n, out);
    else if (t.tailEnds.size === 0) for (let p = link; t.tail[p] !== 0; p++) out.push(t.tail[p]);
    else for (let p = link; out.push(t.tail[p]), !bitAt(t.tailEnds, p); p++);
  };
  const decoder = new TextDecoder();
  const paths: number[][] = [[]];
  const keys: string[] = [];
  for (let node = 1; node < top.bases.length; node++) {
    const path = paths[top.parent[node]].slice();
    label(top, node, path);
    paths[node] = path;
    if (bitAt(top.terminal, node)) keys.push(decoder.decode(new Uint8Array(path)));
  }
  return keys;
}

/** Every key of the n-gram model with its count, in key-id order ("1 word", "2 word word", ...). */
export function readNgrams(trie: ArrayBuffer, counts: ArrayBuffer): Array<[string, number]> {
  const values = new Int32Array(counts);
  return readMarisa(trie).map((key, id) => [key, values[id + 1]]);
}

/** Unigram counts of the n-gram model: "1 <word>" keys. */
export function unigrams(trie: ArrayBuffer, counts: ArrayBuffer): Map<string, number> {
  const words = new Map<string, number>();
  for (const [key, count] of readNgrams(trie, counts))
    if (key.startsWith("1 ")) words.set(key.slice(2), count);
  return words;
}

const readBuffer = (path: string) => {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * "words count" lines (each key without its "N " order prefix) for the n-grams of the model
 * files `trie` and `counts` whose key `keep` accepts, sorted, each line ending in "\n".
 */
export function ngramRows(trie: string, counts: string, keep: (key: string) => boolean): string {
  const rows = readNgrams(readBuffer(trie), readBuffer(counts))
    .filter(([key]) => keep(key))
    .map(([key, count]) => `${key.slice(2)} ${count}`)
    .sort();
  return rows.join("\n") + "\n";
}
