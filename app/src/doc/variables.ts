// Document variables: names for numbers ("width", "wall"), used in any field that takes an expression.
// Pure: no store, no kernel. The commands that change variables are in variableCommands.ts.
//
// For the UI:
//   evaluateVariables(doc.variables)   values to show next to each variable, and errors per variable id
//   validateVariableName(name, doc.variables, ownId?)   check a name as the user types it
//   usesOf(doc, name)                  "Used in: Extrude 1 (Distance), Sketch 1 (length dimension)"
//   scopeOf(doc)                       the Map a field's text is evaluated with (see fieldText.ts)
import { CONSTANTS, FUNCTIONS, UNITS, evalExpr, namesIn } from './expr'
import type { EvalResult, Scope } from './expr'
import type { Feature, ProjectDocument, Variable } from './types'

export type { Scope }

export const EMPTY_SCOPE: Scope = new Map()

/** Names a variable cannot take: function names, constants and units. */
export const RESERVED: ReadonlySet<string> = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), ...Object.keys(UNITS)])

const NAME_OK = /^[A-Za-z_][A-Za-z0-9_]*$/

export type Checked = { ok: true } | { ok: false; message: string }

/** Is `name` allowed for a variable? `ownId` is the variable being renamed (it may keep its own name). */
export function validateVariableName(name: string, existing: readonly Variable[], ownId?: string): Checked {
  const n = name.trim()
  if (n === '') return { ok: false, message: 'Give the variable a name.' }
  if (!NAME_OK.test(n)) {
    return { ok: false, message: 'Use letters, digits and underscores, and start with a letter or underscore.' }
  }
  if (RESERVED.has(n)) return { ok: false, message: `${n} is already used for a function, constant or unit.` }
  if (existing.some((x) => x.name === n && x.id !== ownId)) return { ok: false, message: `There is already a variable called ${n}.` }
  return { ok: true }
}

// ---- evaluating all variables ------------------------------------------------------------------

export interface Evaluated {
  /** name -> value, for every variable that evaluated cleanly. */
  values: Map<string, number>
  /** variable id -> why it has no value. */
  errors: Map<string, string>
  /** The same errors by variable name (used to explain a field that uses a broken variable). */
  errorNames: Map<string, string>
}

const DEPENDS = 'Depends on a variable that has an error.'

/** Evaluates every variable in dependency order (the list order does not matter). Never throws. */
export function evaluateVariables(vars: readonly Variable[]): Evaluated {
  const values = new Map<string, number>()
  const errors = new Map<string, string>()
  const byName = new Map<string, Variable>()
  for (const x of vars) {
    const bad = validateVariableName(x.name, [], x.id)
    if (!bad.ok) errors.set(x.id, bad.message)
    else if (byName.has(x.name)) errors.set(x.id, `Another variable is already called ${x.name}.`)
    else byName.set(x.name, x)
  }

  const state = new Map<string, 1 | 2>() // 1 = being worked out, 2 = done
  const stack: Variable[] = []

  const resolve = (x: Variable) => {
    state.set(x.id, 1)
    stack.push(x)
    let badDep = false
    for (const dep of namesIn(x.expression)) {
      const d = byName.get(dep)
      if (!d) continue // unknown names are reported by the evaluation below
      const s = state.get(d.id)
      if (s === 1) {
        const from = stack.findIndex((y) => y.id === d.id)
        const loop = stack.slice(from)
        const msg = `These variables use each other in a circle: ${[...loop, d].map((y) => y.name).join(' → ')}.`
        for (const y of loop) errors.set(y.id, msg)
        badDep = true
      } else {
        if (s === undefined) resolve(d)
        if (errors.has(d.id)) badDep = true
      }
    }
    stack.pop()
    state.set(x.id, 2)
    if (errors.has(x.id)) return
    if (badDep) {
      errors.set(x.id, DEPENDS)
      return
    }
    const r = evalExpr(x.expression, values)
    if (r.ok) values.set(x.name, r.value)
    else errors.set(x.id, r.message)
  }

  for (const x of vars) {
    if (state.has(x.id) || errors.has(x.id)) continue
    resolve(x)
  }
  const errorNames = new Map<string, string>()
  for (const x of vars) {
    const e = errors.get(x.id)
    if (e !== undefined && byName.get(x.name) === x) errorNames.set(x.name, e)
  }
  return { values, errors, errorNames }
}

/** The scope (name -> value) of a document's variables. Broken variables are left out. */
export function scopeOf(doc: Pick<ProjectDocument, 'variables'>): Scope {
  return evaluateVariables(doc.variables ?? []).values
}

/**
 * Evaluates field text against evaluated variables. Like evalExpr, but a name that is a BROKEN variable
 * says so instead of claiming it does not exist.
 */
export function evalField(text: string, ev: Evaluated): EvalResult {
  for (const n of namesIn(text)) {
    if (ev.errorNames.has(n)) return { ok: false, message: `The variable ${n} has an error.` }
  }
  return evalExpr(text, ev.values)
}

// ---- expression fields of features -------------------------------------------------------------

export interface ExprField {
  /** Label shown to people: "Distance", "Move X". */
  label: string
  kind: 'length' | 'angle'
  /** The stored text. */
  value: string
  /** Writes new text. Works on an Immer draft or any mutable copy. */
  set(text: string): void
  /** An empty value means 0 (only the plane's tilt angle). */
  emptyIsZero?: boolean
}

/** Every Expr field of a feature (not sketch dimensions: those are on the sketch's constraints). */
export function exprFields(f: Feature): ExprField[] {
  switch (f.type) {
    case 'extrude':
      return [{ label: 'Distance', kind: 'length', value: f.params.distance, set: (t) => (f.params.distance = t) }]
    case 'revolve':
      return [{ label: 'Angle', kind: 'angle', value: f.params.angle, set: (t) => (f.params.angle = t) }]
    case 'fillet':
      return [{ label: 'Radius', kind: 'length', value: f.params.radius, set: (t) => (f.params.radius = t) }]
    case 'chamfer':
      return [{ label: 'Distance', kind: 'length', value: f.params.distance, set: (t) => (f.params.distance = t) }]
    case 'shell':
      return [{ label: 'Thickness', kind: 'length', value: f.params.thickness, set: (t) => (f.params.thickness = t) }]
    case 'transform': {
      const axes = ['X', 'Y', 'Z']
      const out: ExprField[] = axes.map((a, i) => ({
        label: `Move ${a}`,
        kind: 'length' as const,
        value: f.params.translate[i],
        set: (t: string) => {
          f.params.translate[i] = t
        },
      }))
      const rot = f.params.rotate
      if (rot) out.push({ label: 'Rotation angle', kind: 'angle', value: rot.angle, set: (t) => (rot.angle = t) })
      return out
    }
    case 'plane':
      return [
        { label: 'Offset', kind: 'length', value: f.params.offset, set: (t) => (f.params.offset = t) },
        { label: 'Angle', kind: 'angle', value: f.params.angle ?? '', set: (t) => (f.params.angle = t), emptyIsZero: true },
      ]
    default:
      return []
  }
}

// ---- where a name is used ----------------------------------------------------------------------

export interface VariableUse {
  kind: 'variable' | 'feature' | 'sketch'
  /** Variable id, feature id or sketch feature id. */
  id: string
  /** For people: "w2", "Extrude 1 (Distance)", "Sketch 1 (length dimension)". */
  label: string
}

/** Everything that uses the variable called `name`: other variables, feature fields, sketch dimensions. */
export function usesOf(doc: ProjectDocument, name: string): VariableUse[] {
  const uses: VariableUse[] = []
  for (const x of doc.variables ?? []) {
    if (x.name !== name && namesIn(x.expression).includes(name)) uses.push({ kind: 'variable', id: x.id, label: x.name })
  }
  for (const f of doc.features) {
    for (const field of exprFields(f)) {
      if (namesIn(field.value).includes(name)) uses.push({ kind: 'feature', id: f.id, label: `${f.name} (${field.label})` })
    }
    if (f.type !== 'sketch') continue
    for (const c of f.sketch.constraints) {
      if (c.value !== undefined && namesIn(c.value).includes(name)) {
        uses.push({ kind: 'sketch', id: f.id, label: `${f.name} (${c.type} dimension)` })
      }
    }
  }
  return uses
}
