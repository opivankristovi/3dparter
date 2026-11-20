// The Variables panel (S08): named numbers that any size field can use. Each row edits its name and its
// expression in place; Enter or leaving the field commits through the variable commands, and a refusal is
// shown on that field with the typed text kept. Self-contained: mount it as the content of the Variables tab.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Variable as VariableIcon } from 'lucide-react'
import { evalExpr } from '../../doc/expr'
import { addVariable, deleteVariable, renameVariable, setVariableExpression } from '../../doc/variableCommands'
import { useProjectStore } from '../../doc/store'
import type { Variable } from '../../doc/types'
import { evaluateVariables } from '../../doc/variables'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { IconButton } from '../../ui/IconButton'
import { NumericInput } from '../../ui/NumericInput'
import type { FieldFeedback } from '../../ui/NumericInput'
import { cn } from '../../ui/cn'

/** The first of v1, v2, v3 ... that no variable has. */
export function freeVariableName(taken: readonly string[]): string {
  const used = new Set(taken)
  let n = 1
  while (used.has(`v${n}`)) n++
  return `v${n}`
}

/** A value for the row: no float noise, no long tails. */
export function valueLabel(value: number): string {
  return String(Number(value.toFixed(4)))
}

interface RowProps {
  variable: Variable
  /** Names offered while typing an expression: every variable except this one. */
  others: readonly { name: string; detail?: string }[]
  /** Why the expression does not evaluate (unknown name, circle ...), if it does not. */
  problem: string | undefined
  /** Values of the other variables, to preview what is being typed. */
  scope: ReadonlyMap<string, number>
}

function VariableRow({ variable: v, others, problem, scope }: RowProps) {
  const [name, setName] = useState(v.name)
  const [nameError, setNameError] = useState<string>()
  const [exprError, setExprError] = useState<string>()
  const [removeError, setRemoveError] = useState<string>()
  const nameErrorId = `var-${v.id}-name-err`

  // The document changed (an undo, a rename from elsewhere): show it, and drop what was refused before.
  useEffect(() => {
    setName(v.name)
    setNameError(undefined)
  }, [v.name])
  useEffect(() => setExprError(undefined), [v.expression])

  const commitName = () => {
    if (name.trim() === v.name) {
      setNameError(undefined)
      return
    }
    const r = renameVariable(v.id, name)
    setNameError(r.ok ? undefined : r.message)
    if (r.ok) setRemoveError(undefined)
  }

  const commitExpression = (text: string) => {
    const r = setVariableExpression(v.id, text)
    setExprError(r.ok ? undefined : r.message)
  }

  const remove = () => {
    const r = deleteVariable(v.id)
    setRemoveError(r.ok ? undefined : r.message)
  }

  const check = (text: string): FieldFeedback => {
    const r = evalExpr(text, scope)
    return r.ok ? { preview: valueLabel(r.value) } : { error: r.message }
  }

  return (
    <li data-variable-id={v.id}>
      <div role="group" aria-label={`Variable ${v.name}`} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2">
        <div className="flex items-start gap-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`var-${v.id}-name`} className="sr-only">
              Name
            </label>
            <input
              id={`var-${v.id}-name`}
              data-field="name"
              value={name}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(undefined)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                else if (e.key === 'Escape') {
                  setName(v.name)
                  setNameError(undefined)
                }
              }}
              onBlur={commitName}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(
                'touch-hit-h h-7 w-full min-w-0 rounded-sm border bg-bg px-2 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                nameError ? 'border-danger' : 'border-border-input hover:border-text-muted',
              )}
            />
            {nameError ? (
              <p id={nameErrorId} className="text-xs text-danger">
                {nameError}
              </p>
            ) : null}
          </div>
          <IconButton
            label={`Delete variable ${v.name}`}
            size={28}
            icon={<Trash2 size={16} strokeWidth={1.75} />}
            onClick={remove}
          />
        </div>
        <NumericInput
          hideLabel
          label="Expression"
          value={v.expression}
          onValueChange={commitExpression}
          onDraftChange={() => setExprError(undefined)}
          check={check}
          suggestions={others}
          error={exprError ?? problem}
        />
        {removeError ? (
          <p role="alert" className="text-xs text-danger">
            {removeError}
          </p>
        ) : null}
      </div>
    </li>
  )
}

export function VariablesPanel() {
  const variables = useProjectStore((s) => s.doc.variables)
  const list = useMemo(() => variables ?? [], [variables])
  const ev = useMemo(() => evaluateVariables(list), [list])
  const [addError, setAddError] = useState<string>()
  const focusId = useRef<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // After "Add variable", put the cursor in the new row's name.
  useEffect(() => {
    const id = focusId.current
    if (!id) return
    const input = root.current?.querySelector<HTMLInputElement>(`[data-variable-id="${id}"] [data-field="name"]`)
    if (!input) return
    focusId.current = null
    input.focus()
    input.select()
  }, [list])

  const add = () => {
    const name = freeVariableName(list.map((v) => v.name))
    const r = addVariable(name, '10')
    setAddError(r.ok ? undefined : r.message)
    if (!r.ok) return
    const added = useProjectStore.getState().doc.variables.find((v) => v.name === name)
    focusId.current = added?.id ?? null
    // The list may not have re-rendered yet; the effect above runs when it does.
    if (added) {
      const input = root.current?.querySelector<HTMLInputElement>(`[data-variable-id="${added.id}"] [data-field="name"]`)
      if (input) {
        focusId.current = null
        input.focus()
        input.select()
      }
    }
  }

  const addButton = (
    <Button variant="primary" size="sm" icon={<Plus size={16} strokeWidth={1.75} />} onClick={add}>
      Add variable
    </Button>
  )

  return (
    <div ref={root} className="flex flex-col gap-2 p-1">
      {list.length === 0 ? (
        <EmptyState
          icon={<VariableIcon strokeWidth={1.75} />}
          title="No variables yet"
          description="Give a number a name once, then type that name into any size field."
          action={addButton}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-text-muted">
              {list.length === 1 ? '1 variable' : `${list.length} variables`}
            </h3>
            {addButton}
          </div>
          <ul aria-label="Variables" className="flex flex-col gap-1.5">
            {list.map((v) => (
              <VariableRow
                key={v.id}
                variable={v}
                others={list.filter((x) => x.id !== v.id).map((x) => ({ name: x.name, detail: ev.values.has(x.name) ? valueLabel(ev.values.get(x.name)!) : undefined }))}
                problem={ev.errors.get(v.id)}
                scope={ev.values}
              />
            ))}
          </ul>
        </>
      )}
      {addError ? (
        <p role="alert" className="text-xs text-danger">
          {addError}
        </p>
      ) : null}
      <p className="px-1 text-xs text-text-muted">
        Write a number or a formula such as <span className="font-mono">width / 2 + 3</span>. Add units to a number
        (<span className="font-mono">5 mm</span>, <span className="font-mono">2 in</span>, <span className="font-mono">90 deg</span>);
        a bare number is millimetres, or degrees in an angle field. Functions: sqrt, abs, min, max, round, floor, ceil,
        sin, cos, tan, asin, acos, atan, and pi.
      </p>
    </div>
  )
}
