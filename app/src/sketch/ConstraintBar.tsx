// The adaptive constraint bar: exactly the constraints that fit the current selection, as icon buttons.
// It floats just above the selection, or sits under the options on narrow screens (the bottom is taken by the status chips and the tool rail). The option to turn
// automatic constraints off lives next to it.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Ruler, MoveHorizontal, MoveVertical, Spline, Shapes } from 'lucide-react'
import { useProjectStore } from '../doc/store'
import type { ConstraintType, PlaneFrame, SketchConstraint, SketchEntity, Vec2 } from '../doc/types'
import { useBreakpoints } from '../screens/workspace/hooks'
import { ConstraintGlyph } from '../ui/ConstraintGlyph'
import type { ConstraintKind } from '../ui/ConstraintGlyph'
import { IconButton } from '../ui/IconButton'
import { Switch } from '../ui/Switch'
import { Toolbar, ToolbarSeparator } from '../ui/Toolbar'
import type { ViewportEngine } from '../viewport/engine'
import { applyConstraint, setAutoConstraints, toggleConstructionOfSelection } from './actions'
import { CONSTRAINT_KEYS, CONSTRAINT_NAMES } from './dimensions'
import { localToWorld } from './geometry'
import { dimensionFor, refsOfSelection, wholeEntityIds } from './pick'
import { applicableConstraints } from './solver/applicable'
import { refPoint } from './refPoint'
import { useSketchUi } from './sketchUi'
import { useViewSync } from './useViewSync'

const GLYPH: Partial<Record<ConstraintType, ConstraintKind>> = {
  coincident: 'coincident',
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  equal: 'equal',
  midpoint: 'midpoint',
  concentric: 'concentric',
  symmetric: 'symmetric',
  fix: 'fixed',
}

const ic = { size: 20, strokeWidth: 1.75 } as const
const text = (t: string) => (
  <span aria-hidden="true" className="text-base font-medium">
    {t}
  </span>
)

function iconFor(type: ConstraintType): ReactNode {
  const kind = GLYPH[type]
  if (kind) return <ConstraintGlyph kind={kind} size={22} className="text-current stroke-transparent fill-transparent" />
  switch (type) {
    case 'pointOnEntity':
      return <Spline {...ic} />
    case 'length':
    case 'distance':
    case 'pointLineDistance':
      return <Ruler {...ic} />
    case 'horizontalDistance':
      return <MoveHorizontal {...ic} />
    case 'verticalDistance':
      return <MoveVertical {...ic} />
    case 'radius':
      return text('R')
    case 'diameter':
      return text('Ø')
    default:
      return text('∠')
  }
}

export interface ConstraintBarProps {
  engine: ViewportEngine
  frame: PlaneFrame
  sketchId: string
  entities: SketchEntity[]
  constraints: SketchConstraint[]
}

export function ConstraintBar({ engine, frame, sketchId, entities, constraints }: ConstraintBarProps) {
  useViewSync(engine)
  const { tablet } = useBreakpoints()
  const selection = useProjectStore((s) => s.selection)
  const auto = useSketchUi((s) => s.autoConstraints)
  const bar = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const refs = refsOfSelection(selection, sketchId)
  const sketch = { entities, constraints }
  const types = applicableConstraints(refs, sketch)
  const natural = dimensionFor(refs, sketch)
  const wholeIds = wholeEntityIds(refs)
  const allConstruction = wholeIds.length > 0 && wholeIds.every((id) => entities.find((e) => e.id === id)?.construction)
  const hasItems = types.length > 0 || wholeIds.length > 0

  useLayoutEffect(() => {
    const w = bar.current?.offsetWidth ?? 0
    if (w !== width) setWidth(w)
  })

  // Where the selection is on screen.
  let place: { left: number; top: number; below: boolean } | null = null
  if (tablet && hasItems) {
    const rect = engine.canvas.getBoundingClientRect()
    const pts = refs.map((r) => refPoint(r, new Map(entities.map((e) => [e.id, e])))).filter((p): p is Vec2 => p !== null)
    if (pts.length) {
      const toScreen = (p: Vec2) => engine.worldToClient(localToWorld(p, frame))
      const screen = pts.map(toScreen)
      const x = screen.reduce((a, p) => a + p[0], 0) / screen.length - rect.left
      const selY = screen.reduce((a, p) => a + p[1], 0) / screen.length - rect.top
      // The bar goes above or below the WHOLE sketch, on the side nearer the selection, so it never
      // covers the geometry being constrained.
      const all = entities.flatMap((e): Vec2[] =>
        e.type === 'line'
          ? [e.a, e.b]
          : [
              [e.center[0], e.center[1] - e.radius],
              [e.center[0], e.center[1] + e.radius],
              [e.center[0] - e.radius, e.center[1]],
              [e.center[0] + e.radius, e.center[1]],
            ],
      )
      const ys = all.map((p) => toScreen(p)[1] - rect.top)
      const top = Math.min(...ys, selY)
      const bottom = Math.max(...ys, selY)
      const half = width / 2 + 8
      const preferBelow = selY > (top + bottom) / 2
      const below = preferBelow ? bottom + 120 < rect.height : top < 72
      place = { left: Math.max(half, Math.min(x, rect.width - half)), top: Math.max(below ? bottom : top, 0), below }
    }
  }

  const options = (
    <div
      role="group"
      aria-label="Sketch options"
      className="pointer-events-auto absolute left-1/2 top-[calc(var(--layout-topbar-h)+1rem)] -translate-x-1/2 rounded-pill bg-surface-raised px-3 whitespace-nowrap shadow-panel"
    >
      <Switch label="Automatic constraints" checked={auto} onCheckedChange={setAutoConstraints} />
    </div>
  )

  return (
    <>
      {options}
      <div
        ref={bar}
        style={place ? { left: place.left, top: place.top } : undefined}
        className={
          place
            ? `pointer-events-auto absolute z-10 ${place.below ? 'mt-8' : '-translate-y-full -mt-8'} -translate-x-1/2`
            : 'pointer-events-none absolute inset-x-2 top-[calc(var(--layout-topbar-h)+4rem)] z-10 flex justify-center'
        }
      >
        {hasItems ? (
          <div className="pointer-events-auto max-w-full overflow-x-auto rounded-lg bg-surface-raised p-1 shadow-panel">
            <Toolbar label="Constraints" className="flex-wrap gap-0.5">
              {types.map((t) => (
                <IconButton
                  key={t}
                  label={CONSTRAINT_NAMES[t]}
                  shortcut={CONSTRAINT_KEYS[t] ?? (t === natural ? 'D' : undefined)}
                  icon={iconFor(t)}
                  onClick={() => applyConstraint(t)}
                />
              ))}
              {wholeIds.length > 0 ? (
                <>
                  {types.length > 0 ? <ToolbarSeparator /> : null}
                  <IconButton
                    label="Construction"
                    shortcut="X"
                    pressed={allConstruction}
                    icon={<Shapes {...ic} />}
                    onClick={toggleConstructionOfSelection}
                  />
                </>
              ) : null}
            </Toolbar>
          </div>
        ) : null}
      </div>
    </>
  )
}
