// Expressions: the text in a number field ("40", "width / 2 + 3 mm", "sqrt(a^2 + b^2)").
// Pure and dependency-free. A hand-written tokenizer, a recursive-descent parser and an evaluator;
// there is no eval and no Function anywhere. Nothing here throws: every problem is a short message.
//
// UNITS RULE (read this before building a field):
//   * Results are plain numbers: millimetres for lengths, degrees for angles. The caller knows which.
//   * A bare number inside an expression means mm (or degrees for an angle field), whatever the
//     document's display unit is. "2 + 3" is 5 mm even when the display unit is inches.
//   * A number may carry a unit suffix right after it (spaces allowed): mm cm m in ft are lengths and
//     are converted to mm; deg and the degree sign are angles and are multiplied by 1.
//     "1 in + 5" is 30.4 mm. A suffix belongs to a number literal only, never to a variable or bracket.
//   * The one exception is a field that holds just a plain number: the field helpers in fieldText.ts
//     convert that from the display unit to mm (typing 2 in an inch document stores 50.8).
//
// Grammar:
//   expr    = term { ('+' | '-') term }
//   term    = unary { ('*' | '/') unary }
//   unary   = ('+' | '-') unary | power
//   power   = primary [ '^' unary ]            right-associative; -2^2 is -4, 2^-1 is 0.5
//   primary = number [unit] | name | name '(' expr {',' expr} ')' | 'pi' | '(' expr ')'
// Functions: sqrt abs min max round floor ceil sin cos tan asin acos atan (trig works in DEGREES).

/** Variable values by name: mm for lengths, degrees for angles. */
export type Scope = ReadonlyMap<string, number>

export type EvalResult = { ok: true; value: number } | { ok: false; message: string }

/** Names a variable cannot take: functions, constants and units. Lower case, case-sensitive. */
export const FUNCTIONS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  abs: { min: 1, max: 1, fn: Math.abs },
  min: { min: 2, max: Infinity, fn: Math.min },
  max: { min: 2, max: Infinity, fn: Math.max },
  round: { min: 1, max: 1, fn: Math.round },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  sin: { min: 1, max: 1, fn: (x) => snap(Math.sin(rad(x))) },
  cos: { min: 1, max: 1, fn: (x) => snap(Math.cos(rad(x))) },
  tan: { min: 1, max: 1, fn: (x) => (Math.abs(Math.cos(rad(x))) < 1e-12 ? NaN : snap(Math.tan(rad(x)))) },
  asin: { min: 1, max: 1, fn: (x) => deg(Math.asin(x)) },
  acos: { min: 1, max: 1, fn: (x) => deg(Math.acos(x)) },
  atan: { min: 1, max: 1, fn: (x) => deg(Math.atan(x)) },
}
export const CONSTANTS: Record<string, number> = { pi: Math.PI }
/** Unit suffix -> factor into mm (lengths) or degrees (angles). */
export const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, deg: 1 }

const rad = (x: number) => (x * Math.PI) / 180
const deg = (x: number) => (x * 180) / Math.PI
/** sin(180) is 1.2e-16 in floating point; show it as 0. */
const snap = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x)

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// ---- tokens ------------------------------------------------------------------------------------

type Tok =
  | { t: 'num'; value: number; unit: string | null; start: number; end: number }
  | { t: 'name'; name: string; start: number; end: number }
  | { t: 'op'; op: '+' | '-' | '*' | '/' | '^' | '(' | ')' | ','; start: number; end: number }
  | { t: 'bad'; message: string; start: number; end: number }

const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/
const SPACE = /^\s+/

/** Splits text into tokens. A character that belongs nowhere becomes a final 'bad' token. */
function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const sp = SPACE.exec(rest)
    if (sp) {
      i += sp[0].length
      continue
    }
    const num = NUMBER.exec(rest)
    if (num) {
      const start = i
      i += num[0].length
      let unit: string | null = null
      // A unit may follow, after spaces: "5 mm", "5mm", "45 °". Only a known unit counts.
      const after = SPACE.exec(text.slice(i))
      const j = i + (after ? after[0].length : 0)
      if (text[j] === '°') {
        unit = 'deg'
        i = j + 1
      } else {
        const nm = NAME.exec(text.slice(j))
        if (nm && has(UNITS, nm[0])) {
          unit = nm[0]
          i = j + nm[0].length
        }
      }
      out.push({ t: 'num', value: Number(num[0]), unit, start, end: i })
      continue
    }
    const nm = NAME.exec(rest)
    if (nm) {
      out.push({ t: 'name', name: nm[0], start: i, end: i + nm[0].length })
      i += nm[0].length
      continue
    }
    const c = text[i]
    if ('+-*/^(),'.includes(c)) {
      out.push({ t: 'op', op: c as '+', start: i, end: i + 1 })
      i++
      continue
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0)
    out.push({ t: 'bad', message: `Unexpected "${ch}" at position ${i + 1}.`, start: i, end: i + ch.length })
    break
  }
  return out
}

// ---- parser ------------------------------------------------------------------------------------

export type Node =
  | { k: 'num'; value: number }
  | { k: 'name'; name: string; pos: number }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }

export type ParseResult = { ok: true; ast: Node } | { ok: false; message: string }

class Fail extends Error {}

function describe(t: Tok | undefined): string {
  if (!t) return 'the end'
  if (t.t === 'num') return 'a number'
  if (t.t === 'name') return `"${t.name}"`
  if (t.t === 'op') return `"${t.op}"`
  return 'this character'
}

class Parser {
  private i = 0
  private toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }

  private peek(): Tok | undefined {
    return this.toks[this.i]
  }
  private at(t: Tok | undefined): string {
    return t ? ` at position ${t.start + 1}` : ' at the end'
  }
  private isOp(op: string): boolean {
    const t = this.peek()
    return t?.t === 'op' && t.op === op
  }

  parse(): Node {
    if (this.toks.length === 0) throw new Fail('Enter a value.')
    const node = this.expr()
    const t = this.peek()
    if (t) {
      if (t.t === 'bad') throw new Fail(t.message)
      if (t.t === 'name' && has(UNITS, t.name)) throw new Fail(`${t.name} is a unit. Put it right after a number, like 5 ${t.name}.`)
      if (t.t === 'op' && t.op === ')') throw new Fail(`There is a ")" with no "(" before it${this.at(t)}.`)
      if (t.t === 'op' && t.op === ',') throw new Fail(`A comma only belongs inside a function${this.at(t)}.`)
      throw new Fail(`Unexpected ${describe(t)}${this.at(t)}. An operator may be missing.`)
    }
    return node
  }

  private expr(): Node {
    let a = this.term()
    for (;;) {
      const t = this.peek()
      if (t?.t === 'op' && (t.op === '+' || t.op === '-')) {
        this.i++
        a = { k: 'bin', op: t.op, a, b: this.term() }
      } else return a
    }
  }

  private term(): Node {
    let a = this.unary()
    for (;;) {
      const t = this.peek()
      if (t?.t === 'op' && (t.op === '*' || t.op === '/')) {
        this.i++
        a = { k: 'bin', op: t.op, a, b: this.unary() }
      } else return a
    }
  }

  private unary(): Node {
    const t = this.peek()
    if (t?.t === 'op' && (t.op === '-' || t.op === '+')) {
      this.i++
      const a = this.unary()
      return t.op === '-' ? { k: 'neg', a } : a
    }
    return this.power()
  }

  private power(): Node {
    const a = this.primary()
    if (this.isOp('^')) {
      this.i++
      return { k: 'bin', op: '^', a, b: this.unary() }
    }
    return a
  }

  private primary(): Node {
    const t = this.peek()
    if (!t) throw new Fail('The expression ends too early. Something is missing after the last symbol.')
    if (t.t === 'bad') throw new Fail(t.message)
    if (t.t === 'num') {
      this.i++
      return { k: 'num', value: t.value * (t.unit ? UNITS[t.unit] : 1) }
    }
    if (t.t === 'name') {
      this.i++
      if (this.isOp('(')) {
        this.i++
        const args: Node[] = []
        if (!this.isOp(')')) {
          args.push(this.expr())
          while (this.isOp(',')) {
            this.i++
            args.push(this.expr())
          }
        }
        if (!this.isOp(')')) throw new Fail(`A closing ")" is missing after ${t.name}(${this.at(this.peek())}.`)
        this.i++
        return { k: 'call', name: t.name, args }
      }
      return { k: 'name', name: t.name, pos: t.start }
    }
    if (t.op === '(') {
      this.i++
      const inner = this.expr()
      if (!this.isOp(')')) throw new Fail(`A closing ")" is missing${this.at(this.peek())}.`)
      this.i++
      return inner
    }
    throw new Fail(`Expected a value but found ${describe(t)}${this.at(t)}.`)
  }
}

/** Parses text into a syntax tree. Never throws. */
export function parseExpr(text: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokenize(text)).parse() }
  } catch (err) {
    return { ok: false, message: err instanceof Fail ? err.message : 'This is not a valid expression.' }
  }
}

// ---- evaluator ---------------------------------------------------------------------------------

function run(n: Node, scope: Scope): number {
  switch (n.k) {
    case 'num':
      return n.value
    case 'neg':
      return -run(n.a, scope)
    case 'name': {
      const v = scope.get(n.name)
      if (v !== undefined) return v
      if (has(CONSTANTS, n.name)) return CONSTANTS[n.name]
      if (has(FUNCTIONS, n.name)) throw new Fail(`${n.name} is a function. Write it with brackets, like ${n.name}(...).`)
      if (has(UNITS, n.name)) throw new Fail(`${n.name} is a unit. Put it right after a number, like 5 ${n.name}.`)
      throw new Fail(`There is no variable called ${n.name}.`)
    }
    case 'bin': {
      const a = run(n.a, scope)
      const b = run(n.b, scope)
      let r: number
      switch (n.op) {
        case '+':
          r = a + b
          break
        case '-':
          r = a - b
          break
        case '*':
          r = a * b
          break
        case '/':
          if (b === 0) throw new Fail('Cannot divide by zero.')
          r = a / b
          break
        default:
          r = Math.pow(a, b)
      }
      if (!Number.isFinite(r)) throw new Fail(Number.isNaN(r) ? 'This calculation has no real result.' : 'The result is too large to be a number.')
      return r
    }
    case 'call': {
      if (!has(FUNCTIONS, n.name)) throw new Fail(`There is no function called ${n.name}.`)
      const f = FUNCTIONS[n.name]
      if (n.args.length < f.min || n.args.length > f.max) {
        throw new Fail(f.max === Infinity ? `${n.name} needs at least ${f.min} values.` : `${n.name} takes ${f.min} value${f.min === 1 ? '' : 's'}.`)
      }
      const r = f.fn(...n.args.map((x) => run(x, scope)))
      if (!Number.isFinite(r)) throw new Fail(`${n.name} cannot be worked out for this input.`)
      return r
    }
  }
}

/**
 * Evaluates `text` with the variable values in `scope` (name -> number, mm or degrees).
 * Never throws; a problem comes back as a short message ending with a period.
 */
export function evalExpr(text: string, scope: Scope): EvalResult {
  const p = parseExpr(text)
  if (!p.ok) return p
  try {
    const value = run(p.ast, scope)
    if (!Number.isFinite(value)) return { ok: false, message: 'The result is not a number.' }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, message: err instanceof Fail ? err.message : 'This is not a valid expression.' }
  }
}

// ---- names -------------------------------------------------------------------------------------

/** The name tokens that stand for variables (not functions in a call, constants or units). */
function variableTokens(text: string): { name: string; start: number; end: number }[] {
  const toks = tokenize(text)
  const out: { name: string; start: number; end: number }[] = []
  toks.forEach((t, i) => {
    if (t.t !== 'name') return
    const next = toks[i + 1]
    if (next?.t === 'op' && next.op === '(') return
    if (has(CONSTANTS, t.name) || has(UNITS, t.name)) return
    out.push({ name: t.name, start: t.start, end: t.end })
  })
  return out
}

/** Variable names used by the text, once each, in order of first use. Works on text with syntax errors too. */
export function namesIn(text: string): string[] {
  const seen: string[] = []
  for (const t of variableTokens(text)) if (!seen.includes(t.name)) seen.push(t.name)
  return seen
}

/** Renames a variable inside the text. Whole names only; spacing and everything else stays as typed. */
export function renameIn(text: string, from: string, to: string): string {
  const hits = variableTokens(text).filter((t) => t.name === from)
  let out = text
  for (let i = hits.length - 1; i >= 0; i--) out = out.slice(0, hits[i].start) + to + out.slice(hits[i].end)
  return out
}

const LITERAL = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/

/** True for a lone number with an optional sign and no unit: "12", "-1.5", ".5", "1e3". */
export function isNumberLiteral(text: string): boolean {
  return LITERAL.test(text)
}
