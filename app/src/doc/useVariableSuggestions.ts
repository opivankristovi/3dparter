// The variable names a number field offers while a name is being typed.
import { useMemo } from 'react'
import { useSettings } from '../app/useSettings'
import type { Candidate } from './fieldInput'
import { useProjectStore } from './store'
import type { DisplayUnit } from './types'
import { formatDisplay } from './units'
import { evaluateVariables } from './variables'

/** Every variable with its current value in the display unit. A broken variable is listed without a value. */
export function useVariableSuggestions(units: DisplayUnit): Candidate[] {
  const variables = useProjectStore((s) => s.doc.variables)
  const precision = useSettings((s) => s.settings.precision)
  return useMemo(() => {
    const ev = evaluateVariables(variables ?? [])
    return (variables ?? []).map((v) => {
      const value = ev.values.get(v.name)
      return { name: v.name, ...(value !== undefined ? { detail: formatDisplay(value, units, precision) } : {}) }
    })
  }, [variables, units, precision])
}
