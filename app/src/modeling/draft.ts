// Shared steps for every tool that previews a feature as a draft and applies it as one undo step.
import { useRef, useState } from 'react'
import { addFeature, updateFeatureParams } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { DisplayUnit, Feature } from '../doc/types'
import { formatDisplay, parseDisplay, toExpr } from '../doc/units'
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
 * Shared state for numeric inputs that hold back Apply while their text is invalid.
 * `typedNow` mirrors the typed text synchronously: Enter in the field commits and applies in the same event,
 * before React re-renders, so Apply must not trust the `disabled` state it was rendered with.
 */
function useGuardedInput(
  expr: string,
  unit: string,
  format: (n: number) => string,
  parse: (text: string) => number | null,
  errorText: string,
  onChange: (expr: string) => void,
) {
  const [typed, setTypedState] = useState<string | null>(null)
  const typedNow = useRef<string | null>(null)
  const setTyped = (t: string | null) => {
    typedNow.current = t
    setTypedState(t)
  }
  const n = Number(expr)
  const field = {
    unit,
    value: typed ?? (Number.isFinite(n) ? format(n) : expr),
    error: typed !== null ? errorText : undefined,
    onValueChange: (text: string) => {
      const v = parse(text)
      if (v === null) {
        setTyped(text)
        return
      }
      setTyped(null)
      onChange(toExpr(v))
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
  return useGuardedInput(
    expr,
    units,
    (mm) => formatDisplay(mm, units),
    (text) => {
      const v = parseDisplay(text, units)
      return v !== null && v > 0 ? v : null
    },
    'Enter a number above zero.',
    onChange,
  )
}

/** A signed length field in display units (negative, zero or positive). */
export function useSignedLengthInput(expr: string, units: DisplayUnit, onChange: (expr: string) => void) {
  return useGuardedInput(
    expr,
    units,
    (mm) => formatDisplay(mm, units),
    (text) => {
      const v = parseDisplay(text, units)
      return v !== null && Number.isFinite(v) ? v : null
    },
    'Enter a number.',
    onChange,
  )
}

/** An angle field in degrees. With `positiveMax360`, requires 0 < angle <= 360. */
export function useAngleInput(expr: string, onChange: (expr: string) => void, opts?: { positiveMax360?: boolean }) {
  const positiveMax360 = opts?.positiveMax360 ?? false
  return useGuardedInput(
    expr,
    '°',
    (deg) => formatDisplay(deg, 'mm'),
    (text) => {
      const v = parseDisplay(text, 'mm')
      if (v === null || !Number.isFinite(v)) return null
      if (positiveMax360 && (v <= 0 || v > 360)) return null
      return v
    },
    positiveMax360 ? 'Enter an angle between 0 and 360.' : 'Enter a number.',
    onChange,
  )
}
