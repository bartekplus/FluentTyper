// An exact word set as a minimal automaton (a DAWG: words sharing an ending share its states),
// packed for the generated lexicon files and decoded once into typed arrays. Lookups walk the
// graph, one state per character.
//
// Stream: the states in depth-first order of their first visit. A state is a Huffman-coded header
// (whether it ends a word, whether more than one edge leads to it), then its edges, each a
// Huffman-coded symbol (label, where it leads, whether it is the state's last edge): to the next
// state written (a first visit), to the final state with no edges, or back to an earlier state
// with several incoming edges, which a third Huffman code then names. Bits are packed 13 to two
// characters of PACK_ALPHABET (printable ASCII without '"' or '\'), so the text needs no escapes.

const PACK_ALPHABET = Array.from({ length: 92 }, (_, i) => String.fromCharCode(0x23 + i))
  .filter((c) => c !== "\\")
  .join("");
const PACK = PACK_ALPHABET.length;
const MAX_CODE = 24;
const LENGTH_BITS = 5;

type Kind = "N" | "L" | "R";

class BitReader {
  private pos = 0;
  private readonly values: Uint16Array;
  constructor(text: string) {
    const digit = (i: number) => text.charCodeAt(i) - (text.charCodeAt(i) > 0x5c ? 0x24 : 0x23);
    this.values = new Uint16Array(text.length / 2);
    for (let i = 0; i < this.values.length; i++)
      this.values[i] = digit(2 * i) * PACK + digit(2 * i + 1);
  }
  private bit(): number {
    const value = this.values[(this.pos / 13) | 0];
    return (value >> (12 - (this.pos++ % 13))) & 1;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
  /** A canonical Huffman decoder for the given code lengths (0: symbol unused). */
  huffman(lengths: number[]): () => number {
    const { firsts, counts, symbols } = canonical(lengths);
    return () => {
      let code = 0;
      for (let len = 1; len <= MAX_CODE; len++) {
        code = (code << 1) | this.bit();
        const offset = code - firsts[len];
        if (offset < counts[len]) return symbols[len][offset];
      }
      throw new Error("bad word graph code");
    };
  }
  lengths(count: number): number[] {
    return Array.from({ length: count }, () => this.bits(LENGTH_BITS));
  }
}

function canonical(lengths: number[]) {
  const counts = new Array<number>(MAX_CODE + 1).fill(0);
  const symbols: number[][] = Array.from({ length: MAX_CODE + 1 }, () => []);
  lengths.forEach((len, symbol) => {
    if (len) {
      counts[len]++;
      symbols[len].push(symbol);
    }
  });
  const firsts = new Array<number>(MAX_CODE + 1).fill(0);
  let code = 0;
  for (let len = 1; len <= MAX_CODE; len++) {
    code = (code + counts[len - 1]) << 1;
    firsts[len] = code;
  }
  firsts[0] = 0;
  return { firsts, counts, symbols };
}

/** The exact set of words written by encodeWordGraph. */
export class WordGraph {
  private final: Uint8Array;
  private firstEdge: Uint32Array;
  private labels: string[];
  private targets: Int32Array;

  constructor(encoded: string) {
    const newline = encoded.indexOf("\n");
    const header = encoded.slice(0, newline).split(" ");
    const nodeCount = Number(header[0]);
    const sharedCount = Number(header[1]);
    const symbolText = header.slice(2).join(" ");
    // Symbols: a label character, then a kind (N, L, R), then "$" for a last edge or ".".
    const symbols: Array<{ label: string; kind: Kind; last: boolean }> = [];
    for (let i = 0; i < symbolText.length; i += 3)
      symbols.push({
        label: symbolText[i],
        kind: symbolText[i + 1] as Kind,
        last: symbolText[i + 2] === "$",
      });
    const reader = new BitReader(encoded.slice(newline + 1));
    const readHeader = reader.huffman(reader.lengths(4));
    const readSymbol = reader.huffman(reader.lengths(symbols.length));
    const readRef = reader.huffman(reader.lengths(sharedCount));

    this.final = new Uint8Array(nodeCount + 1);
    const edges: Array<Array<[string, number]>> = [];
    const shared: number[] = [];
    // State 0 is the final state with no edges; the root is state 1.
    this.final[0] = 1;
    edges.push([]);
    const readState = (): number => {
      const id = edges.length;
      const head = readHeader();
      this.final[id] = head & 1;
      if (head & 2) shared.push(id);
      const own: Array<[string, number]> = [];
      edges.push(own);
      for (;;) {
        const symbol = symbols[readSymbol()];
        const target =
          symbol.kind === "L" ? 0 : symbol.kind === "R" ? shared[readRef()] : readState();
        own.push([symbol.label, target]);
        if (symbol.last) return id;
      }
    };
    readState();
    let total = 0;
    for (const own of edges) total += own.length;
    this.firstEdge = new Uint32Array(edges.length + 1);
    this.labels = new Array<string>(total);
    this.targets = new Int32Array(total);
    let at = 0;
    edges.forEach((own, id) => {
      this.firstEdge[id] = at;
      for (const [label, target] of own) {
        this.labels[at] = label;
        this.targets[at++] = target;
      }
    });
    this.firstEdge[edges.length] = at;
  }

  private step(state: number, label: string): number {
    for (let e = this.firstEdge[state]; e < this.firstEdge[state + 1]; e++)
      if (this.labels[e] === label) return this.targets[e];
    return -1;
  }

  /** The state reached by spelling `prefix` from the root, or -1. */
  private walk(prefix: string): number {
    let state = 1;
    for (let i = 0; i < prefix.length && state >= 0; i++) state = this.step(state, prefix[i]);
    return state;
  }

  has(word: string): boolean {
    const state = this.walk(word);
    return state >= 0 && this.final[state] === 1;
  }

  /** The endings that complete `prefix` into a word ("grand|" -> ["F+"]). */
  completions(prefix: string): string[] {
    const out: string[] = [];
    const visit = (state: number, suffix: string) => {
      if (this.final[state]) out.push(suffix);
      for (let e = this.firstEdge[state]; e < this.firstEdge[state + 1]; e++)
        visit(this.targets[e], suffix + this.labels[e]);
    };
    const start = this.walk(prefix);
    if (start >= 0) visit(start, "");
    return out;
  }
}

class BitWriter {
  private readonly out: number[] = [];
  bits(value: number, n: number) {
    for (let i = n - 1; i >= 0; i--) this.out.push((value >> i) & 1);
  }
  text(): string {
    let text = "";
    for (let i = 0; i < this.out.length; i += 13) {
      let value = 0;
      for (let b = 0; b < 13; b++) value = (value << 1) | (this.out[i + b] ?? 0);
      text += PACK_ALPHABET[Math.floor(value / PACK)] + PACK_ALPHABET[value % PACK];
    }
    return text;
  }
}

/** Huffman code lengths for symbol counts, capped at MAX_CODE. */
function codeLengths(counts: number[]): number[] {
  type Tree = { weight: number; symbols: number[] };
  let queue: Tree[] = counts.flatMap((weight, symbol) =>
    weight ? [{ weight, symbols: [symbol] }] : [],
  );
  const lengths = counts.map(() => 0);
  if (queue.length === 1) lengths[queue[0].symbols[0]] = 1;
  while (queue.length > 1) {
    queue.sort((a, b) => a.weight - b.weight);
    const [a, b] = queue;
    for (const symbol of [...a.symbols, ...b.symbols]) lengths[symbol]++;
    queue = [
      { weight: a.weight + b.weight, symbols: [...a.symbols, ...b.symbols] },
      ...queue.slice(2),
    ];
  }
  if (Math.max(...lengths) > MAX_CODE) throw new Error("word graph code too long");
  return lengths;
}

function huffmanWriter(writer: BitWriter, lengths: number[]) {
  const { firsts, symbols } = canonical(lengths);
  const codes = new Map<number, number>();
  for (let len = 1; len <= MAX_CODE; len++)
    symbols[len].forEach((symbol, i) => codes.set(symbol, firsts[len] + i));
  for (const len of lengths) writer.bits(len, LENGTH_BITS);
  return (symbol: number) => writer.bits(codes.get(symbol)!, lengths[symbol]);
}

/** Packs a word set for WordGraph (generator side). */
export function encodeWordGraph(words: Iterable<string>): string {
  type State = { final: boolean; edges: Map<string, State>; id: number };
  const make = (): State => ({ final: false, edges: new Map(), id: -1 });
  const root = make();
  for (const word of new Set(words)) {
    let state = root;
    for (const ch of word) {
      let next = state.edges.get(ch);
      if (!next) state.edges.set(ch, (next = make()));
      state = next;
    }
    state.final = true;
  }
  // Minimize bottom-up: states with the same finality and edges merge.
  const registry = new Map<string, State>();
  let ids = 0;
  const minimize = (state: State): State => {
    const edges = [...state.edges].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    state.edges = new Map(edges.map(([label, child]) => [label, minimize(child)]));
    const key = `${state.final ? 1 : 0}${[...state.edges].map(([l, c]) => l + c.id).join(",")}`;
    const known = registry.get(key);
    if (known) return known;
    state.id = ids++;
    registry.set(key, state);
    return state;
  };
  const top = minimize(root);
  const incoming = new Map<State, number>();
  const seen = new Set<State>();
  const count = (state: State) => {
    if (seen.has(state)) return;
    seen.add(state);
    for (const child of state.edges.values()) {
      incoming.set(child, (incoming.get(child) ?? 0) + 1);
      count(child);
    }
  };
  count(top);
  const isLeaf = (state: State) => state.final && state.edges.size === 0;

  // First pass: the symbols, headers and references in stream order.
  const headers: number[] = [];
  const stream: Array<{ symbol: string; ref?: number; header?: number }> = [];
  const sharedIndex = new Map<State, number>();
  const visited = new Set<State>();
  const emit = (state: State) => {
    visited.add(state);
    const shared = (incoming.get(state) ?? 0) > 1;
    const header = (state.final ? 1 : 0) | (shared ? 2 : 0);
    headers.push(header);
    stream.push({ symbol: "", header });
    if (shared) sharedIndex.set(state, sharedIndex.size);
    const edges = [...state.edges];
    edges.forEach(([label, child], i) => {
      const last = i === edges.length - 1 ? "$" : ".";
      if (isLeaf(child)) stream.push({ symbol: `${label}L${last}` });
      else if (visited.has(child))
        stream.push({ symbol: `${label}R${last}`, ref: sharedIndex.get(child)! });
      else {
        stream.push({ symbol: `${label}N${last}` });
        emit(child);
      }
    });
  };
  if (isLeaf(top) || !top.edges.size) throw new Error("empty word graph");
  emit(top);

  const symbolList = [...new Set(stream.map((s) => s.symbol).filter(Boolean))].sort();
  const symbolIds = new Map(symbolList.map((s, i) => [s, i]));
  const headerCounts = [0, 0, 0, 0];
  const symbolCounts = symbolList.map(() => 0);
  const refCounts = new Array<number>(sharedIndex.size).fill(0);
  for (const item of stream) {
    if (item.header !== undefined) headerCounts[item.header]++;
    else symbolCounts[symbolIds.get(item.symbol)!]++;
    if (item.ref !== undefined) refCounts[item.ref]++;
  }
  const writer = new BitWriter();
  const writeHeader = huffmanWriter(writer, codeLengths(headerCounts));
  const writeSymbol = huffmanWriter(writer, codeLengths(symbolCounts));
  const writeRef = huffmanWriter(writer, codeLengths(refCounts));
  for (const item of stream) {
    if (item.header !== undefined) writeHeader(item.header);
    else writeSymbol(symbolIds.get(item.symbol)!);
    if (item.ref !== undefined) writeRef(item.ref);
  }
  return `${headers.length} ${sharedIndex.size} ${symbolList.join("")}\n${writer.text()}`;
}
