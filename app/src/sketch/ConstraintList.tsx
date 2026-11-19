// The open sketch's constraints as a plain list in the side panel: reachable by keyboard and screen reader,
// each with a delete button. Choosing one selects it and lights up its geometry in the viewport.
import { X } from 'lucide-react'
import { useProjectStore } from '../doc/store'
import type { Sketch, SketchConstraint, SketchFeature } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import { IconButton } from '../ui/IconButton'
import { cn } from '../ui/cn'
import { deleteConstraints } from './commands'
import { CONSTRAINT_NAMES, labelText } from './dimensions'
import { isDimensional } from './solver/constraints'
import { measureConstraint } from './solver/measure'
import { parseRef } from './solver/refs'
import { evalValue } from './solver/value'
import { useSketchUi } from './sketchUi'

const NONE: string[] = []

/** "Line 2", "Circle 1", "start of Arc 1", "Origin": what a ref points at, counted by kind in drawing order. */
function describeRef(ref: string, sketch: Sketch): string {
  const p = parseRef(ref)
  if (!p) return 'something'
  if (p.kind === 'reserved') return p.name === 'origin' ? 'Origin' : p.name === 'xAxis' ? 'X axis' : 'Y axis'
  const e = sketch.entities.find((x) => x.id === p.entityId)
  if (!e) return 'a removed item'
  const same = sketch.entities.filter((x) => x.type === e.type)
  const name = `${e.type === 'line' ? 'Line' : e.type === 'circle' ? 'Circle' : 'Arc'} ${same.indexOf(e) + 1}`
  if (p.kind === 'entity') return name
  const slot = p.slot === 'a' ? 'start' : p.slot === 'b' ? 'end' : p.slot
  return `${slot} of ${name}`
}

function summary(c: SketchConstraint, sketch: Sketch, units: Parameters<typeof labelText>[2]): string {
  const what = c.entityIds.map((r) => describeRef(r, sketch)).join(', ')
  if (!isDimensional(c.type)) return what
  const v = c.driving ? evalValue(c.value) : (measureConstraint(sketch, c) ?? NaN)
  const text = Number.isFinite(v) ? labelText(c.type, v, units) : ''
  return `${c.driving ? text : `(${text})`} · ${what}`
}

export function ConstraintList() {
  const sketchId = useToolStore((s) => s.activeSketchId)
  const features = useProjectStore((s) => s.doc.features)
  const units = useProjectStore((s) => s.doc.units)
  const selected = useSketchUi((s) => s.selectedConstraintIds)
  const defined = useSketchUi((s) => s.defined)
  const conflicts = defined?.conflicting ?? NONE
  const feature = features.find((f): f is SketchFeature => f.id === sketchId && f.type === 'sketch')
  if (!feature) return null
  const { constraints } = feature.sketch

  return (
    <section aria-label="Constraints list" className="flex flex-col gap-1 border-t border-border p-2">
      <h3 className="px-1 text-xs font-medium text-text-muted">Constraints</h3>
      {constraints.length === 0 ? (
        <p className="px-1 text-sm text-text-muted">None yet. Select geometry to add one.</p>
      ) : (
        <ul aria-label="Sketch constraints" className="flex flex-col">
          {constraints.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={selected.includes(c.id)}
                onClick={() => {
                  useProjectStore.getState().setSelection([])
                  useSketchUi.getState().set({ selectedConstraintIds: [c.id], pending: null, editingId: null })
                }}
                onPointerEnter={() => useSketchUi.getState().set({ hoverConstraintId: c.id })}
                onPointerLeave={() => useSketchUi.getState().set({ hoverConstraintId: null })}
                className={cn(
                  'touch-hit-h min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-surface-sunken',
                  selected.includes(c.id) && 'bg-accent-subtle',
                  conflicts.includes(c.id) && 'text-sketch-conflict',
                )}
              >
                <span className="font-medium">{CONSTRAINT_NAMES[c.type]}</span>
                <span className="block truncate text-text-muted">{summary(c, feature.sketch, units)}</span>
              </button>
              <IconButton
                label={`Delete ${CONSTRAINT_NAMES[c.type].toLowerCase()} constraint`}
                size={28}
                icon={<X size={16} strokeWidth={1.75} />}
                onClick={() => deleteConstraints(feature.id, [c.id])}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
