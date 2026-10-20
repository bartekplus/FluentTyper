// The lowercase prefixes with which every match of a regex starts. A frame scan then runs its
// regex only where one of them stands in the text, not at every character (frameMatches).

/** One node of the parsed regex: a run of alternatives, a sequence, or an atom. */
type Node =
  | { kind: "alt"; branches: Node[] }
  | { kind: "seq"; items: Node[] }
  | { kind: "char"; char: string }
  // A zero-width test (lookaround, anchor, word boundary): it consumes no text.
  | { kind: "empty" }
  // Any other atom: a class, a property escape, a dot, a back reference.
  | { kind: "any" }
  | { kind: "repeat"; node: Node; min: number };

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
    if (char === "?" || char === "*") {
      min = 0;
      at++;
    } else if (char === "+") {
      min = 1;
      at++;
    } else if (char === "{") {
      const m = /^\{(\d+)(?:,\d*)?\}/.exec(source.slice(at));
      if (m) {
        min = Number(m[1]);
        at += m[0].length;
      }
    }
    if (min === undefined) return node;
    if (source[at] === "?") at++;
    return { kind: "repeat", node, min };
  };
  const atom = (): Node => {
    const char = source[at];
    if (char === "(") {
      at++;
      let zeroWidth = false;
      if (source.startsWith("?:", at)) at += 2;
      else if (/^\?<?[=!]/.test(source.slice(at, at + 3))) {
        zeroWidth = true;
        at += source[at + 1] === "<" ? 3 : 2;
      } else if (source.startsWith("?<", at)) at = source.indexOf(">", at) + 1;
      const inner = alternation();
      at++; // ")"
      return zeroWidth ? { kind: "empty" } : inner;
    }
    if (char === "[") {
      // Skip the class: escapes inside it may hold "]".
      at++;
      if (source[at] === "^") at++;
      if (source[at] === "]") at++;
      while (at < source.length && source[at] !== "]") at += source[at] === "\\" ? 2 : 1;
      at++;
      return { kind: "any" };
    }
    if (char === "\\") {
      const next = source[at + 1];
      at += 2;
      if (next === "b" || next === "B") return { kind: "empty" };
      if (next === "p" || next === "P" || next === "k") {
        // \p{L}, \k<name>: skip the braces or the name.
        const close = source.indexOf(next === "k" ? ">" : "}", at);
        at = close + 1;
        return { kind: "any" };
      }
      if (next === "u" || next === "x") {
        const m = /^(?:\{[0-9A-Fa-f]+\}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{2})/.exec(source.slice(at));
        if (m) at += m[0].length;
        return { kind: "any" };
      }
      return SIMPLE_ESCAPE.test(next) ? { kind: "char", char: next } : { kind: "any" };
    }
    at++;
    if (char === "^" || char === "$") return { kind: "empty" };
    if (char === ".") return { kind: "any" };
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
const MAX_PREFIXES = 256;

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
