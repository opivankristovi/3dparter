// Commands that change the document's variables. Each is exactly ONE undo step (one store.apply) and
// returns { ok: true } or { ok: false, message } with a plain message to show the user. A refused command
// leaves the document untouched.
//
// What a change also does:
//   * setVariableExpression / addVariable re-solve every sketch whose dimensions use a variable, and write
//     the solved entities in the SAME undo step. If any such sketch cannot be solved with the new values the
//     whole change is refused ("Sketch 2 can no longer be solved with this value.").
//   * Features (extrude distance and so on) are not touched: they are re-evaluated when the kernel
//     regenerates, and show the problem on their own status if a value does not work.
//   * renameVariable rewrites the name in every expression that uses it (variables, feature fields, sketch
//     dimensions), token-aware, keeping the text's spacing.
//   * deleteVariable is refused while anything uses the variable.
import { collapsed } from '../sketch/commands'
import { isDimensional, mustBePositive } from '../sketch/solver/constraints'
import { isSolverReady, solveSketch } from '../sketch/solver/solver'
import { evalValue } from '../sketch/solver/value'
import { newId, syncBodyEntry } from './commands'
import { namesIn, renameIn } from './expr'
import { useProjectStore } from './store'
import type { ProjectDocument, SketchEntity, SketchFeature, Variable } from './types'
import { evaluateVariables, exprFields, usesOf, validateVariableName } from './variables'
import type { Checked, VariableUse } from './variables'

export type VariableResult = { ok: true } | { ok: false; message: string; uses?: VariableUse[] }

const refuse = (message: string, uses?: VariableUse[]): VariableResult => ({ ok: false, message, ...(uses ? { uses } : {}) })
const state = () => useProjectStore.getState()

/** A variable list that would be saved: its first new error, or null when it is clean (no NEW errors). */
function newErrorOf(before: readonly Variable[], after: readonly Variable[], focusId: string): string | null {
  const was = evaluateVariables(before).errors
  const now = evaluateVariables(after)
  const own = now.errors.get(focusId)
  if (own !== undefined) return own
  for (const x of after) {
    const e = now.errors.get(x.id)
    if (e !== undefined && !was.has(x.id)) return `This would break the variable ${x.name}. ${e}`
  }
  return null
}

type Plan = { ok: true; solved: Map<string, SketchEntity[]> } | { ok: false; message: string }

/** Every variable in `vars` that is in `seed` or depends on it (directly or through other variables). */
function affectedNames(vars: readonly Variable[], seed: ReadonlySet<string>): Set<string> {
  const out = new Set(seed)
  let added = true
  while (added) {
    added = false
    for (const v of vars) {
      if (out.has(v.name)) continue
      if (namesIn(v.expression).some((n) => out.has(n))) {
        out.add(v.name)
        added = true
      }
    }
  }
  return out
}

/** Re-solves every sketch with a dimension that uses a variable, with the values in `scope`. */
function planSketches(doc: ProjectDocument, names: ReadonlySet<string>, scope: ReadonlyMap<string, number>): Plan {
  const solved = new Map<string, SketchEntity[]>()
  const todo: SketchFeature[] = []
  for (const f of doc.features) {
    if (f.type !== 'sketch') continue
    const uses = f.sketch.constraints.some(
      (c) => c.driving && isDimensional(c.type) && c.value !== undefined && namesIn(c.value).some((n) => names.has(n)),
    )
    if (uses) todo.push(f)
  }
  if (todo.length === 0) return { ok: true, solved }
  if (!isSolverReady()) return { ok: false, message: 'The sketch solver is still loading. Try again in a moment.' }
  for (const f of todo) {
    const fail = { ok: false as const, message: `${f.name} can no longer be solved with this value.` }
    for (const c of f.sketch.constraints) {
      if (!c.driving || !isDimensional(c.type)) continue
      const v = evalValue(c.value, scope)
      if (!Number.isFinite(v) || (mustBePositive(c.type) && v <= 0)) return fail
    }
    const r = solveSketch(f.sketch, { scope })
    if (!r.ok || r.conflicting.length > 0 || Object.keys(r.invalid).length > 0) return fail
    if (collapsed(f.sketch.entities, r.entities).length > 0) return fail
    solved.set(f.id, r.entities)
  }
  return { ok: true, solved }
}

/** Checks `next`, re-solves the affected sketches and applies both as one undo step. */
function commit(label: string, next: Variable[], focusId: string, touched: ReadonlySet<string>): VariableResult {
  const doc = state().doc
  const bad = newErrorOf(doc.variables, next, focusId)
  if (bad !== null) return refuse(bad)
  const plan = planSketches(doc, affectedNames(next, touched), evaluateVariables(next).values)
  if (!plan.ok) return refuse(plan.message)
  state().apply(label, (draft) => {
    draft.variables = next
    for (const f of draft.features) {
      const entities = f.type === 'sketch' ? plan.solved.get(f.id) : undefined
      if (f.type === 'sketch' && entities) f.sketch.entities = entities
      if (f.type === 'pattern') syncBodyEntry(draft, f)
    }
  })
  return { ok: true }
}

const nameCheck = (c: Checked): VariableResult | null => (c.ok ? null : refuse(c.message))

/** Adds a variable. The expression may use earlier variables; it must evaluate cleanly. */
export function addVariable(name: string, expression: string): VariableResult {
  const n = name.trim()
  const doc = state().doc
  const bad = nameCheck(validateVariableName(n, doc.variables))
  if (bad) return bad
  const v: Variable = { id: newId(), name: n, expression: expression.trim() }
  return commit(`Add variable ${n}`, [...doc.variables, v], v.id, new Set([n]))
}

/** Changes a variable's expression. Refused if it has an error, makes a circle, or breaks another variable or sketch. */
export function setVariableExpression(id: string, expression: string): VariableResult {
  const doc = state().doc
  const v = doc.variables.find((x) => x.id === id)
  if (!v) return refuse('There is no such variable.')
  const text = expression.trim()
  if (text === v.expression) return { ok: true }
  const next = doc.variables.map((x) => (x.id === id ? { ...x, expression: text } : x))
  return commit(`Change variable ${v.name}`, next, id, new Set([v.name]))
}

/** Renames a variable and every use of it, as one step. A name that is taken, reserved or invalid is refused. */
export function renameVariable(id: string, newName: string): VariableResult {
  const doc = state().doc
  const v = doc.variables.find((x) => x.id === id)
  if (!v) return refuse('There is no such variable.')
  const to = newName.trim()
  if (to === v.name) return { ok: true }
  const bad = nameCheck(validateVariableName(to, doc.variables, id))
  if (bad) return bad
  const from = v.name
  state().apply(`Rename variable ${from}`, (draft) => {
    for (const x of draft.variables) {
      if (x.id === id) x.name = to
      else x.expression = renameIn(x.expression, from, to)
    }
    for (const f of draft.features) {
      for (const field of exprFields(f)) {
        const text = renameIn(field.value, from, to)
        if (text !== field.value) field.set(text)
      }
      if (f.type !== 'sketch') continue
      for (const c of f.sketch.constraints) {
        if (c.value !== undefined) {
          const text = renameIn(c.value, from, to)
          if (text !== c.value) c.value = text
        }
      }
    }
  })
  return { ok: true }
}

/** Deletes a variable that nothing uses. While it is used the command is refused and lists where. */
export function deleteVariable(id: string): VariableResult {
  const doc = state().doc
  const v = doc.variables.find((x) => x.id === id)
  if (!v) return refuse('There is no such variable.')
  const uses = usesOf(doc, v.name)
  if (uses.length > 0) {
    return refuse(`${v.name} is still used in ${uses.map((u) => u.label).join(', ')}.`, uses)
  }
  state().apply(`Delete variable ${v.name}`, (draft) => {
    draft.variables = draft.variables.filter((x) => x.id !== id)
  })
  return { ok: true }
}
