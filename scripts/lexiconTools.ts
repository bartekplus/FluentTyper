// Shared helpers for the scripts/generate-*-lexicon.ts generators: the n-gram model the extension
// ships (marisa-trie keys and their counts).
import { readFileSync } from "node:fs";

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

export function readMarisa(buffer: ArrayBuffer): string[] {
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
