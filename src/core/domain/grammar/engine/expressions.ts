// Rule expressions: the logic of a rule file (a frame's `let`, `when` and `return`, a file's `defs`).
// An expression is a TypeScript expression without assignment, statements, `this` or classes.
// The compiler checks it here; the generator writes it unchanged into a typed module, where the
// type checker reads it against the signatures of the rule library.

/** What the compiler learns from one expression. */
export interface CheckedExpression {
  /** The free names: library functions, tables, defs, bindings and match groups. */
  readonly refs: ReadonlySet<string>;
  readonly errors: readonly string[];
  /** The operand when the whole expression is a negation ("!a" -> "a"). */
  readonly negated?: string;
}

// Globals an expression may name, besides the rule library and the file's own names.
export const EXPRESSION_GLOBALS: ReadonlySet<string> = new Set([
  "Math",
  "Number",
  "String",
  "Array",
  "Object",
  "Boolean",
  "Set",
  "Map",
  "RegExp",
  "WeakSet",
  "WeakMap",
  "Infinity",
  "NaN",
  "undefined",
]);
// Constructors `new` may call.
const NEW_TARGETS = new Set(["Set", "Map", "WeakSet", "WeakMap", "RegExp"]);
// Properties that reach the function constructor or change objects.
const DENIED_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "call",
  "apply",
  "bind",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "assign",
  "eval",
]);
const KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "typeof",
  "in",
  "new",
  "as",
  "void",
  "delete",
  "function",
  "this",
  "class",
  "var",
  "let",
  "const",
  "return",
  "if",
  "for",
  "while",
  "do",
  "await",
  "yield",
  "import",
  "export",
  "super",
  "instanceof",
]);
const PUNCTUATORS = [
  "...",
  "===",
  "!==",
  "**=",
  "??=",
  "&&=",
  "||=",
  ">>>",
  "<<=",
  ">>=",
  "=>",
  "?.",
  "??",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**",
  "<<",
  ">>",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ":",
  "?",
  ".",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "=",
  "&",
  "|",
  "^",
  "~",
  ";",
];

type TokenKind = "num" | "str" | "tpl" | "re" | "id" | "p" | "eof";
interface Token {
  kind: TokenKind;
  value: string;
  at: number;
  /** Template literal: the source of each `${…}` part. */
  parts?: string[];
}

class ParseError extends Error {}

class Lexer {
  pos = 0;
  constructor(readonly src: string) {}

  private skipSpace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  /** The next token; `regex` says whether a `/` opens a regex literal here. */
  next(regex: boolean): Token {
    this.skipSpace();
    const { src } = this;
    const at = this.pos;
    if (at >= src.length) return { kind: "eof", value: "", at };
    const c = src[at];
    if (/[\p{L}_$]/u.test(c)) {
      let end = at + 1;
      while (end < src.length && /[\p{L}\p{N}_$]/u.test(src[end])) end++;
      this.pos = end;
      return { kind: "id", value: src.slice(at, end), at };
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[at + 1] ?? ""))) {
      const m =
        /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)n?/.exec(
          src.slice(at),
        )!;
      this.pos = at + m[0].length;
      return { kind: "num", value: m[0], at };
    }
    if (c === '"' || c === "'") {
      let end = at + 1;
      while (end < src.length && src[end] !== c) {
        if (src[end] === "\\") end++;
        if (src[end] === "\n") throw new ParseError(`string not closed at ${at}`);
        end++;
      }
      if (end >= src.length) throw new ParseError(`string not closed at ${at}`);
      this.pos = end + 1;
      return { kind: "str", value: src.slice(at, end + 1), at };
    }
    if (c === "`") return this.template(at);
    if (c === "/" && regex) {
      let end = at + 1;
      let inClass = false;
      for (; end < src.length; end++) {
        const ch = src[end];
        if (ch === "\\") end++;
        else if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === "\n") break;
      }
      if (src[end] !== "/") throw new ParseError(`regex not closed at ${at}`);
      const body = src.slice(at + 1, end);
      let flagsEnd = end + 1;
      while (flagsEnd < src.length && /[a-z]/.test(src[flagsEnd])) flagsEnd++;
      const flags = src.slice(end + 1, flagsEnd);
      try {
        new RegExp(body, flags);
      } catch (error) {
        throw new ParseError(`regex /${body}/${flags} does not compile: ${String(error)}`);
      }
      this.pos = flagsEnd;
      return { kind: "re", value: src.slice(at, flagsEnd), at };
    }
    for (const p of PUNCTUATORS)
      if (src.startsWith(p, at)) {
        // "?." before a digit is a conditional and a number (a ?.5 : b).
        if (p === "?." && /\d/.test(src[at + 2] ?? "")) continue;
        this.pos = at + p.length;
        return { kind: "p", value: p, at };
      }
    throw new ParseError(`unexpected "${c}" at ${at}`);
  }

  /** A template literal from its opening backtick; each `${…}` part is kept as source. */
  private template(at: number): Token {
    const { src } = this;
    const parts: string[] = [];
    let i = at + 1;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") i += 2;
      else if (src.startsWith("${", i)) {
        const sub = new Lexer(src);
        sub.pos = i + 2;
        let depth = 0;
        let regex = true;
        for (;;) {
          const t = sub.next(regex);
          if (t.kind === "eof") throw new ParseError(`template not closed at ${at}`);
          if (t.kind === "p" && (t.value === "{" || t.value === "${")) depth++;
          if (t.kind === "p" && t.value === "}") {
            if (depth === 0) {
              parts.push(src.slice(i + 2, t.at));
              i = sub.pos;
              break;
            }
            depth--;
          }
          regex = !operandEnd(t);
        }
      } else i++;
    }
    if (i >= src.length) throw new ParseError(`template not closed at ${at}`);
    this.pos = i + 1;
    return { kind: "tpl", value: src.slice(at, i + 1), at, parts };
  }
}

/** After this token a `/` divides; elsewhere it opens a regex literal. */
const operandEnd = (t: Token) =>
  t.kind === "num" ||
  t.kind === "str" ||
  t.kind === "tpl" ||
  t.kind === "re" ||
  (t.kind === "id" && !KEYWORDS.has(t.value)) ||
  ["true", "false", "null"].includes(t.value) ||
  (t.kind === "p" && [")", "]", "}"].includes(t.value));

// Binary operators and their binding power.
const BINARY: Readonly<Record<string, number>> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 6,
  "!=": 6,
  "===": 6,
  "!==": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  in: 7,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};

/** A recursive-descent reader that records free names and checks each construct. */
class Parser {
  private lex: Lexer;
  private tok: Token;
  private scopes: Set<string>[] = [];
  readonly refs = new Set<string>();

  constructor(readonly src: string) {
    this.lex = new Lexer(src);
    this.tok = this.lex.next(true);
  }

  private advance() {
    const prev = this.tok;
    this.tok = this.lex.next(!operandEnd(prev));
    return prev;
  }
  private is(value: string) {
    return (this.tok.kind === "p" || this.tok.kind === "id") && this.tok.value === value;
  }
  private eat(value: string) {
    if (!this.is(value))
      throw new ParseError(`expected "${value}" at ${this.tok.at}, found "${this.tok.value}"`);
    return this.advance();
  }
  private fail(message: string): never {
    throw new ParseError(`${message} at ${this.tok.at}`);
  }

  parseAll() {
    this.expression();
    if (this.tok.kind !== "eof") this.fail(`unexpected "${this.tok.value}"`);
  }

  /** True when one unary expression is all of the source. */
  unaryOnly() {
    this.unary();
    return this.tok.kind === "eof";
  }

  private use(name: string) {
    if (!this.scopes.some((scope) => scope.has(name))) this.refs.add(name);
  }

  expression(): void {
    if (this.arrowAhead()) return this.arrow();
    this.conditional();
  }

  private conditional() {
    this.binary(0);
    if (this.is("?")) {
      this.advance();
      this.expression();
      this.eat(":");
      this.expression();
    }
  }

  private binary(min: number) {
    this.unary();
    for (;;) {
      const op = this.tok.value;
      if (this.tok.kind === "id" && op === "as") {
        this.advance();
        this.type();
        continue;
      }
      const binary = (this.tok.kind === "p" || op === "in") && Object.hasOwn(BINARY, op);
      const power = binary ? BINARY[op] : -1;
      if (power < min) break;
      this.advance();
      // "**" binds to the right; the others to the left.
      this.binary(op === "**" ? power : power + 1);
    }
    if (
      this.tok.kind === "p" &&
      /^(?:=|\+=|-=|\*=|\/=|%=|\*\*=|\?\?=|&&=|\|\|=|<<=|>>=)$/.test(this.tok.value)
    )
      this.fail("assignment is not an expression of a rule");
    if (this.tok.kind === "p" && ["&", "|", "^", "<<", ">>", ">>>"].includes(this.tok.value))
      this.fail(`operator "${this.tok.value}" is not allowed`);
  }

  private unary(): void {
    const { value, kind } = this.tok;
    if (kind === "p" && (value === "!" || value === "-" || value === "+")) {
      this.advance();
      return this.unary();
    }
    if (kind === "id" && value === "typeof") {
      this.advance();
      return this.unary();
    }
    if (kind === "p" && (value === "++" || value === "--")) this.fail(`"${value}" changes a value`);
    if (kind === "id" && (value === "delete" || value === "void" || value === "await"))
      this.fail(`"${value}" is not allowed`);
    this.postfix();
  }

  private postfix() {
    this.primary();
    for (;;) {
      if (this.is(".") || this.is("?.")) {
        const optional = this.advance().value === "?.";
        if (optional && this.is("(")) {
          this.args();
          continue;
        }
        if (optional && this.is("[")) {
          this.advance();
          this.expression();
          this.eat("]");
          continue;
        }
        if (this.tok.kind !== "id") this.fail("expected a property name");
        if (DENIED_PROPERTIES.has(this.tok.value))
          this.fail(`property "${this.tok.value}" is denied`);
        this.advance();
      } else if (this.is("[")) {
        this.advance();
        if (this.tok.kind === "str" && DENIED_PROPERTIES.has(this.tok.value.slice(1, -1)))
          this.fail(`property ${this.tok.value} is denied`);
        this.expression();
        this.eat("]");
      } else if (this.is("(")) this.args();
      else if (this.is("!") && !this.lex.src.startsWith("!=", this.tok.at)) {
        // The TypeScript non-null assertion: `m.groups!.target`.
        this.advance();
      } else if (this.is("++") || this.is("--")) this.fail(`"${this.tok.value}" changes a value`);
      else break;
    }
  }

  private args() {
    this.eat("(");
    while (!this.is(")")) {
      if (this.is("...")) this.advance();
      this.expression();
      if (!this.is(")")) this.eat(",");
    }
    this.eat(")");
  }

  private primary(): void {
    const t = this.tok;
    switch (t.kind) {
      case "num":
      case "str":
      case "re":
        this.advance();
        return;
      case "tpl":
        this.advance();
        for (const part of t.parts!) {
          const inner = new Parser(part);
          inner.scopes = this.scopes;
          inner.parseAll();
          for (const name of inner.refs) this.use(name);
        }
        return;
      case "id": {
        if (t.value === "true" || t.value === "false" || t.value === "null") {
          this.advance();
          return;
        }
        if (t.value === "new") {
          this.advance();
          if (this.tok.kind !== "id" || !NEW_TARGETS.has(this.tok.value))
            this.fail(`"new" may make only ${[...NEW_TARGETS].join(", ")}`);
          this.advance();
          if (this.is("<")) this.typeArguments();
          if (this.is("(")) this.args();
          return;
        }
        if (KEYWORDS.has(t.value)) this.fail(`"${t.value}" is not allowed`);
        this.advance();
        this.use(t.value);
        return;
      }
      case "p":
        if (t.value === "(") {
          this.advance();
          this.expression();
          this.eat(")");
          return;
        }
        if (t.value === "[") {
          this.advance();
          while (!this.is("]")) {
            if (this.is(",")) {
              this.advance();
              continue;
            }
            if (this.is("...")) this.advance();
            this.expression();
            if (!this.is("]")) this.eat(",");
          }
          this.eat("]");
          return;
        }
        if (t.value === "{") {
          this.object();
          return;
        }
        break;
      default:
        break;
    }
    this.fail(`unexpected "${t.value || "end"}"`);
  }

  private object() {
    this.eat("{");
    while (!this.is("}")) {
      if (this.is("...")) {
        this.advance();
        this.expression();
      } else if (this.is("[")) {
        this.advance();
        this.expression();
        this.eat("]");
        this.eat(":");
        this.expression();
      } else {
        const key = this.tok;
        if (key.kind !== "id" && key.kind !== "str" && key.kind !== "num")
          this.fail("expected a property");
        if (DENIED_PROPERTIES.has(key.kind === "str" ? key.value.slice(1, -1) : key.value))
          this.fail(`property "${key.value}" is denied`);
        this.advance();
        if (this.is(":")) {
          this.advance();
          this.expression();
        } else if (key.kind === "id") this.use(key.value);
        else this.fail('expected ":"');
      }
      if (!this.is("}")) this.eat(",");
    }
    this.eat("}");
  }

  /** True when the tokens ahead are arrow parameters and "=>". */
  private arrowAhead(): boolean {
    if (this.tok.kind === "id" && !KEYWORDS.has(this.tok.value)) {
      const save = this.save();
      this.advance();
      const arrow = this.is("=>");
      this.restore(save);
      return arrow;
    }
    if (!this.is("(")) return false;
    const save = this.save();
    try {
      this.params(new Set());
      if (this.is(":")) {
        this.advance();
        this.type();
      }
      return this.is("=>");
    } catch {
      return false;
    } finally {
      this.restore(save);
    }
  }

  private arrow() {
    const scope = new Set<string>();
    if (this.tok.kind === "id") scope.add(this.advance().value);
    else {
      this.params(scope);
      if (this.is(":")) {
        this.advance();
        this.type();
      }
    }
    this.eat("=>");
    if (this.is("{")) this.fail("an arrow function returns an expression; wrap an object in ( )");
    this.scopes.push(scope);
    this.expression();
    this.scopes.pop();
  }

  /** Reads a parenthesized parameter list into `scope`. */
  params(scope: Set<string>) {
    this.eat("(");
    while (!this.is(")")) {
      this.pattern(scope);
      if (this.is("?")) this.advance();
      if (this.is(":")) {
        this.advance();
        this.type();
      }
      if (!this.is(")")) this.eat(",");
    }
    this.eat(")");
  }

  /** A binding: a name, or an object or array destructuring. */
  private pattern(scope: Set<string>) {
    if (this.is("...")) this.advance();
    if (this.tok.kind === "id" && !KEYWORDS.has(this.tok.value)) {
      scope.add(this.advance().value);
    } else if (this.is("{")) {
      this.advance();
      while (!this.is("}")) {
        if (this.is("...")) {
          this.advance();
          if (this.tok.kind !== "id") this.fail("expected a name");
          scope.add(this.advance().value);
        } else {
          const key = this.advance();
          if (key.kind !== "id" && key.kind !== "str") this.fail("expected a property name");
          if (this.is(":")) {
            this.advance();
            this.pattern(scope);
          } else scope.add(key.value);
        }
        if (this.is("=")) this.fail("defaults are not allowed in a binding");
        if (!this.is("}")) this.eat(",");
      }
      this.eat("}");
    } else if (this.is("[")) {
      this.advance();
      while (!this.is("]")) {
        if (this.is(",")) {
          this.advance();
          continue;
        }
        this.pattern(scope);
        if (!this.is("]")) this.eat(",");
      }
      this.eat("]");
    } else this.fail("expected a parameter");
  }

  /** A TypeScript type after "as" or ":": read and skipped (the type checker reads it). */
  private type() {
    const one = () => {
      if (this.is("readonly") || this.is("keyof") || this.is("typeof")) this.advance();
      if (this.is("(")) {
        this.advance();
        this.type();
        this.eat(")");
      } else if (this.is("[")) {
        this.advance();
        while (!this.is("]")) {
          this.type();
          if (!this.is("]")) this.eat(",");
        }
        this.eat("]");
      } else if (this.is("{")) {
        let depth = 0;
        do {
          if (this.is("{")) depth++;
          if (this.is("}")) depth--;
          this.advance();
        } while (depth > 0 && this.tok.kind !== "eof");
      } else if (this.tok.kind === "id" || this.tok.kind === "str" || this.tok.kind === "num") {
        this.advance();
        while (this.is(".")) {
          this.advance();
          this.advance();
        }
        if (this.is("<")) this.typeArguments();
      } else this.fail("expected a type");
      while (this.is("[")) {
        this.advance();
        if (!this.is("]")) this.type();
        this.eat("]");
      }
    };
    one();
    while (this.is("|") || this.is("&")) {
      this.advance();
      one();
    }
  }

  private typeArguments() {
    this.eat("<");
    // ">>" closes two type argument lists ("Readonly<Record<string, RegExp>>").
    const closes = () => this.tok.kind === "p" && /^>+$/.test(this.tok.value);
    while (!closes()) {
      this.type();
      if (!closes()) this.eat(",");
    }
    if (this.tok.value.length > 1)
      this.tok = { kind: "p", value: this.tok.value.slice(1), at: this.tok.at + 1 };
    else this.advance();
  }

  private save() {
    return { pos: this.lex.pos, tok: this.tok };
  }
  private restore(state: { pos: number; tok: Token }) {
    this.lex.pos = state.pos;
    this.tok = state.tok;
  }
}

/** Checks one expression; `refs` lists the names it reads from outside itself. */
export function checkExpression(source: string): CheckedExpression {
  const parser = new Parser(source);
  try {
    parser.parseAll();
  } catch (error) {
    if (error instanceof ParseError) return { refs: new Set(), errors: [error.message] };
    throw error;
  }
  const text = source.trimStart();
  const negation = text.startsWith("!") && !text.startsWith("!=") && new Parser(text).unaryOnly();
  return {
    refs: parser.refs,
    errors: [],
    ...(negation ? { negated: text.slice(1).trim() } : {}),
  };
}

/** The name and parameter names of a def signature such as `cap(word: string): string`. */
export function defSignature(signature: string): { name: string; params: string[] } | null {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:(\([\s\S]*\))\s*(?::\s*[\s\S]+)?)?$/.exec(signature);
  if (!m) return null;
  if (m[2] === undefined) return { name: m[1], params: [] };
  const scope = new Set<string>();
  const reader = new Parser(m[2]);
  try {
    reader.params(scope);
  } catch (error) {
    if (error instanceof ParseError) return null;
    throw error;
  }
  return { name: m[1], params: [...scope] };
}
