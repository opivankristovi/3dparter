// Shared steps for every tool that previews a feature as a draft and applies it as one undo step.
import { useRef, useState } from 'react'
import { addFeature, updateFeatureParams } from '../doc/commands'
import { checkFieldText } from '../doc/fieldInput'
import type { FieldRule } from '../doc/fieldInput'
import { exprToFieldText } from '../doc/fieldText'
import { useProjectStore } from '../doc/store'
import type { DisplayUnit, Feature } from '../doc/types'
import { useVariableSuggestions } from '../doc/useVariableSuggestions'
import type { FieldFeedback } from '../ui/NumericInput'
import { useToolStore } from '../screens/workspace/toolStore'

/** Drops the open draft without touching the document. */
export function cancelDraft() {
  useToolStore.getState().clearDraft()
  useProjectStore.getState().setEditingFeature(null)
}

/** Writes the open draft into the document (a new step, or the edit of an existing one) and closes the tool. */
export function applyDraft(label: string): Feature | null {
  const { draft, draftReplaces } = useToolStore.getState()
  if (!draft) return null
  if (draftReplaces) updateFeatureParams(draft.id, draft.params, `Edit ${label}`)
  else addFeature(draft, label)
  useToolStore.getState().clearDraft()
  const s = useProjectStore.getState()
  s.setEditingFeature(null)
  s.setActiveTool(null)
  return draft
}

/** Replaces the open draft's parameters (keeps whether it edits an existing step). */
export function changeDraft<T extends Feature>(type: T['type'], partial: Partial<T['params']>) {
  const cur = useToolStore.getState()
  if (cur.draft?.type !== type) return
  cur.setDraft({ ...cur.draft, params: { ...cur.draft.params, ...partial } } as Feature, cur.draftReplaces)
}

/**
 * Shared state for numeric inputs that take a number or an expression and hold back Apply while their text is
 * invalid. A plain number is typed in the display unit; anything else is an expression kept as typed.
 * `typedNow` mirrors the typed text synchronously: Enter in the field commits and applies in the same event,
 * before React re-renders, so Apply must not trust the `disabled` state it was rendered with.
 */
function useGuardedInput(
  expr: string,
  unit: string,
  units: DisplayUnit,
  rule: FieldRule,
  onChange: (expr: string) => void,
) {
  const [typed, setTypedState] = useState<string | null>(null)
  const typedNow = useRef<string | null>(null)
  const suggestions = useVariableSuggestions(units)
  const setTyped = (t: string | null) => {
    typedNow.current = t
    setTypedState(t)
  }
  const check = (text: string): FieldFeedback => {
    const r = checkFieldText(text, units, rule)
    if (!r.ok) return { error: r.message }
    return r.isExpression ? { preview: r.preview } : {}
  }
  const field = {
    unit,
    value: typed ?? exprToFieldText(expr, units, rule.kind),
    error: typed !== null ? check(typed).error : undefined,
    check,
    suggestions,
    onValueChange: (text: string) => {
      const r = checkFieldText(text, units, rule)
      if (!r.ok) {
        setTyped(text)
        return
      }
      setTyped(null)
      onChange(r.expr)
    },
  }
  return {
    field,
    /** The text is not valid right now. */
    invalid: typed !== null,
    /** Wraps an apply handler so it does nothing while the text is invalid. */
    guard: (apply: () => void) => () => {
      if (typedNow.current !== null) return
      apply()
    },
  }
}

/** A positive length field in display units. */
export function useLengthInput(expr: string, units: DisplayUnit, onChange: (expr: string) => void) {
  return useGuardedInput(expr, units, units, { kind: 'length', positive: true }, onChange)
}

/** A signed length field in display units (negative, zero or positive). */
export function useSignedLengthInput(expr: string, units: DisplayUnit, onChange: (expr: string) => void) {
  return useGuardedInput(expr, units, units, { kind: 'length' }, onChange)
}

/** An angle field in degrees. With `positiveMax360`, requires 0 < angle <= 360. */
export function useAngleInput(expr: string, onChange: (expr: string) => void, opts?: { positiveMax360?: boolean }) {
  return useGuardedInput(expr, '°', 'mm', { kind: 'angle', upTo360: opts?.positiveMax360 ?? false }, onChange)
}
