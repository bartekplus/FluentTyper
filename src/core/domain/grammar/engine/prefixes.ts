// The lowercase prefixes with which every match of a regex starts. A frame scan then runs its
// regex only where one of them stands in the text, not at every character (frameMatches).

/** One node of the parsed regex: a run of alternatives, a sequence, or an atom. */
type Node =
  | { kind: "alt"; branches: Node[] }
  | { kind: "seq"; items: Node[] }
  | { kind: "char"; char: string }
  // A zero-width test (lookaround, anchor, word boundary): it consumes no text. A lookahead
  // keeps its content.
  | { kind: "empty"; ahead?: Node }
  // Any other atom: a class, a property escape, a dot, a back reference, with its source.
  | { kind: "any"; source: string }
  | { kind: "repeat"; node: Node; min: number; max: number };

const SIMPLE_ESCAPE = /[^A-Za-z0-9]/;

/** Parses the subset of regex syntax that prefixes need. Unknown syntax becomes `any`. */
function parse(source: string): Node {
  let at = 0;
  const alternation = (): Node => {
    const branches: Node[] = [sequence()];
    while (source[at] === "|") {
      at++;
      branches.push(sequence());
    }
    return branches.length === 1 ? branches[0] : { kind: "alt", branches };
  };
  const sequence = (): Node => {
    const items: Node[] = [];
    while (at < source.length && source[at] !== "|" && source[at] !== ")") {
      let node = atom();
      node = quantified(node);
      items.push(node);
    }
    return { kind: "seq", items };
  };
  const quantified = (node: Node): Node => {
    const char = source[at];
    let min: number | undefined;
    let max = Infinity;
    if (char === "?" || char === "*") {
      min = 0;
      if (char === "?") max = 1;
      at++;
    } else if (char === "+") {
      min = 1;
      at++;
    } else if (char === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));
      if (m) {
        min = Number(m[1]);
        max = m[2] === undefined ? min : m[3] ? Number(m[3]) : Infinity;
        at += m[0].length;
      }
    }
    if (min === undefined) return node;
    if (source[at] === "?") at++;
    return { kind: "repeat", node, min, max };
  };
  const atom = (): Node => {
    const char = source[at];
    if (char === "(") {
      at++;
      let zeroWidth = false;
      let ahead = false;
      if (source.startsWith("?:", at)) at += 2;
      else if (/^\?<?[=!]/.test(source.slice(at, at + 3))) {
        zeroWidth = true;
        ahead = source.startsWith("?=", at);
        at += source[at + 1] === "<" ? 3 : 2;
      } else if (source.startsWith("?<", at)) at = source.indexOf(">", at) + 1;
      const inner = alternation();
      at++; // ")"
      if (!zeroWidth) return inner;
      return ahead ? { kind: "empty", ahead: inner } : { kind: "empty" };
    }
    const from = at;
    if (char === "[") {
      // Skip the class: escapes inside it may hold "]".
      at++;
      if (source[at] === "^") at++;
      if (source[at] === "]") at++;
      while (at < source.length && source[at] !== "]") at += source[at] === "\\" ? 2 : 1;
      at++;
      return { kind: "any", source: source.slice(from, at) };
    }
    if (char === "\\") {
      const next = source[at + 1];
      at += 2;
      if (next === "b" || next === "B") return { kind: "empty" };
      if (next === "p" || next === "P" || next === "k") {
        // \p{L}, \k<name>: skip the braces or the name.
        const close = source.indexOf(next === "k" ? ">" : "}", at);
        at = close + 1;
        return { kind: "any", source: source.slice(from, at) };
      }
      if (next === "u" || next === "x") {
        const m = /^(?:\{[0-9A-Fa-f]+\}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{2})/.exec(source.slice(at));
        if (m) at += m[0].length;
        return { kind: "any", source: source.slice(from, at) };
      }
      return SIMPLE_ESCAPE.test(next)
        ? { kind: "char", char: next }
        : { kind: "any", source: source.slice(from, at) };
    }
    at++;
    if (char === "^" || char === "$") return { kind: "empty" };
    if (char === ".") return { kind: "any", source: "." };
    return { kind: "char", char: char.toLowerCase() };
  };
  const node = alternation();
  if (at !== source.length) throw new Error(`regex syntax at ${at}`);
  return node;
}

/** A prefix and whether the regex text after it may extend it. */
type Prefix = { text: string; open: boolean };
// Above this count the prefixes are cut to two characters, then to one: a shorter prefix is
// still a correct (wider) start set.
const MAX_PREFIXES = 1024;

function prefixes(node: Node, max: number): Prefix[] {
  switch (node.kind) {
    case "char":
      return [{ text: node.char, open: true }];
    case "empty":
      return [{ text: "", open: true }];
    case "any":
      return [{ text: "", open: false }];
    case "alt":
      return node.branches.flatMap((branch) => prefixes(branch, max));
    case "repeat": {
      // One pass of the node, which may repeat: after it the prefix cannot grow.
      const once = prefixes(node.node, max).map((p) => ({ text: p.text, open: false }));
      return node.min === 0 ? [...once, { text: "", open: true }] : once;
    }
    case "seq": {
      let current: Prefix[] = [{ text: "", open: true }];
      for (const item of node.items) {
        if (current.every((p) => !p.open || p.text.length >= max)) break;
        const next = prefixes(item, max);
        const joined: Prefix[] = [];
        for (const p of current) {
          if (!p.open || p.text.length >= max) joined.push(p);
          else
            for (const q of next)
              joined.push({ text: (p.text + q.text).slice(0, max), open: q.open });
        }
        current = dedupe(joined);
        if (current.length > MAX_PREFIXES) current = dedupe(current.map((p) => cut(p, 2)));
        if (current.length > MAX_PREFIXES) current = dedupe(current.map((p) => cut(p, 1)));
      }
      return current;
    }
  }
}

const cut = (p: Prefix, length: number): Prefix =>
  p.text.length > length ? { text: p.text.slice(0, length), open: false } : p;

function dedupe(list: Prefix[]): Prefix[] {
  const seen = new Map<string, Prefix>();
  for (const p of list) {
    const key = `${p.text}\u0000${p.open}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * The lowercase prefixes (at most `max` characters) with which every match of `source` starts,
 * or null when a match may start with any character. A prefix that another one starts with is
 * dropped: its matches are found at the shorter one.
 */
export function startPrefixes(source: string, max = 3): string[] | null {
  let node: Node;
  try {
    node = parse(source);
  } catch {
    return null;
  }
  let found = prefixes(node, max);
  if (found.length > MAX_PREFIXES) found = dedupe(found.map((p) => cut(p, 2)));
  if (found.length > MAX_PREFIXES) found = dedupe(found.map((p) => cut(p, 1)));
  const texts = [...new Set(found.map((p) => p.text))];
  if (texts.length === 0 || texts.includes("")) return null;
  texts.sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const text of texts) if (!kept.some((k) => text.startsWith(k))) kept.push(text);
  return kept.length > MAX_PREFIXES ? null : kept;
}

// ------------------------------------------------------------------ literal anchors

// Every character that \s matches (ECMAScript WhiteSpace and LineTerminator).
const SPACES = [
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
  " ",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2001",
  "\u2002",
  "\u2003",
  "\u2004",
  "\u2005",
  "\u2006",
  "\u2007",
  "\u2008",
  "\u2009",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
];
const SPACE = /\s/u;

/** "solid": the atom matches no space; "space": only spaces; "mixed": maybe both. */
function atomKind(source: string): "solid" | "space" | "mixed" {
  if (source === "." || source.startsWith("\\k")) return "mixed";
  if (source === "\\s") return "space";
  let regex: RegExp;
  try {
    regex = new RegExp(source, "u");
  } catch {
    return "mixed";
  }
  if (!SPACES.some((space) => regex.test(space))) return "solid";
  // A class of spaces only: no negation, no range, each member a space.
  if (!source.startsWith("[") || source.startsWith("[^")) return "mixed";
  const members = [
    ...source.slice(1, -1).matchAll(/\\u\{[0-9A-Fa-f]+\}|\\u[0-9A-Fa-f]{4}|\\.|-|./gsu),
  ].map((m) => m[0]);
  if (members.includes("-")) return "mixed";
  const space = (member: string) =>
    member === "\\s" || SPACE.test(member.startsWith("\\") ? unescape(member) : member);
  return members.length > 0 && members.every(space) ? "space" : "mixed";
}

function unescape(member: string): string {
  const named: Record<string, string> = { t: "\t", n: "\n", r: "\r", v: "\v", f: "\f" };
  const code = /^\\u\{?([0-9A-Fa-f]+)\}?$/.exec(member)?.[1];
  if (code) return String.fromCodePoint(parseInt(code, 16));
  return named[member[1]] ?? member[1];
}

/** True when the node matches only spaces (one run of them). */
function onlySpaces(node: Node): boolean {
  switch (node.kind) {
    case "char":
      return SPACE.test(node.char);
    case "any":
      return atomKind(node.source) === "space";
    case "alt":
      return node.branches.every(onlySpaces);
    case "seq":
      return node.items.length > 0 && node.items.every(onlySpaces);
    case "repeat":
      return node.min >= 1 && onlySpaces(node.node);
    default:
      return false;
  }
}

/**
 * The most runs of spaces a match of `node` can hold: null when a part may match spaces and
 * other characters, Infinity when the runs are not bounded.
 */
function spaceRuns(node: Node): number | null {
  switch (node.kind) {
    case "char":
      return SPACE.test(node.char) ? 1 : 0;
    case "empty":
      return 0;
    case "any": {
      const kind = atomKind(node.source);
      return kind === "solid" ? 0 : kind === "space" ? 1 : null;
    }
    case "seq": {
      let sum = 0;
      for (const item of node.items) {
        const runs = spaceRuns(item);
        if (runs === null) return null;
        sum += runs;
      }
      return sum;
    }
    case "alt": {
      let most = 0;
      for (const branch of node.branches) {
        const runs = spaceRuns(branch);
        if (runs === null) return null;
        most = Math.max(most, runs);
      }
      return most;
    }
    case "repeat": {
      const runs = spaceRuns(node.node);
      if (runs === null || runs === 0) return runs;
      if (onlySpaces(node.node)) return 1;
      return runs * node.max;
    }
  }
}

/** A literal anchor: every match holds one of `prefixes` after at most `spaces` space runs. */
export interface LiteralAnchor {
  prefixes: string[];
  spaces: number;
}

function anchorIn(node: Node, max: number): LiteralAnchor | null {
  const items = node.kind === "seq" ? node.items : [node];
  let spaces = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "empty" && item.ahead) {
      const inner = anchorIn(item.ahead, max);
      if (inner) return { prefixes: inner.prefixes, spaces: spaces + inner.spaces };
    }
    // The text where item i starts begins with a prefix of the rest of the sequence.
    const found = startsOf({ kind: "seq", items: items.slice(i) }, max);
    if (found && found.every((prefix) => prefix.length >= 2)) return { prefixes: found, spaces };
    const runs = spaceRuns(item);
    if (runs === null || runs === Infinity) return null;
    spaces += runs;
  }
  return null;
}

function startsOf(node: Node, max: number): string[] | null {
  let found = prefixes(node, max);
  if (found.length > MAX_PREFIXES) found = dedupe(found.map((p) => cut(p, 2)));
  if (found.length > MAX_PREFIXES) return null;
  const texts = [...new Set(found.map((p) => p.text))];
  if (texts.length === 0 || texts.includes("")) return null;
  texts.sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const text of texts) if (!kept.some((k) => text.startsWith(k))) kept.push(text);
  return kept;
}

/**
 * For a regex without start prefixes: a part that every match holds, which starts with one of
 * the anchor's prefixes, with at most `spaces` runs of spaces between the match start and it.
 * Null when no such part exists or the runs before it have no bound.
 */
export function literalAnchor(source: string, max = 3): LiteralAnchor | null {
  let node: Node;
  try {
    node = parse(source);
  } catch {
    return null;
  }
  return anchorIn(node, max);
}
