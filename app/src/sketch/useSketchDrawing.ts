// Draws the document's sketches in the viewport (coloured by defined state), and the hover and
// selection marks on top. Everything is derived from the document and the sketch UI state.
import { useEffect, useMemo } from 'react'
import { useProjectStore } from '../doc/store'
import { ORIGIN_PLANES } from '../doc/types'
import type { OriginPlaneName, PlaneFrame, SketchEntity, SketchFeature } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import type { ViewportEngine } from '../viewport/engine'
import { refsOfSelection } from './pick'
import { refEntityId } from './solver/refs'
import { useSketchUi } from './sketchUi'

function frameOf(f: SketchFeature | undefined, frames: Record<string, PlaneFrame>): PlaneFrame | null {
  if (!f) return null
  return f.params.on.kind === 'originPlane' ? (ORIGIN_PLANES[f.params.on.name as OriginPlaneName] ?? null) : (frames[f.id] ?? null)
}

export function useSketchFeature(): { sketchId: string | null; sketch: SketchFeature | undefined; frame: PlaneFrame | null } {
  const sketchId = useToolStore((s) => s.activeSketchId)
  const sketchFrames = useToolStore((s) => s.sketchFrames)
  const features = useProjectStore((s) => s.doc.features)
  const sketch = useMemo(
    () => features.find((f): f is SketchFeature => f.id === sketchId && f.type === 'sketch'),
    [features, sketchId],
  )
  const frame = frameOf(sketch, sketchFrames)
  return { sketchId, sketch, frame }
}

/** The active sketch's entities as they should look now: the live drag result, or the stored ones. */
export function useLiveEntities(sketch: SketchFeature | undefined): SketchEntity[] {
  const preview = useSketchUi((s) => s.preview)
  return preview ?? sketch?.sketch.entities ?? []
}

export function useSketchDrawing(engine: ViewportEngine, sketchId: string | null, tool: string | null) {
  const features = useProjectStore((s) => s.doc.features)
  const selection = useProjectStore((s) => s.selection)
  const sketchFrames = useToolStore((s) => s.sketchFrames)
  const preview = useSketchUi((s) => s.preview)
  const defined = useSketchUi((s) => s.defined)
  const hoverRef = useSketchUi((s) => s.hoverRef)
  const hoverConstraintId = useSketchUi((s) => s.hoverConstraintId)
  const selectedConstraintIds = useSketchUi((s) => s.selectedConstraintIds)

  useEffect(() => {
    const used = new Set<string>()
    for (const f of features) {
      if (f.type === 'extrude' || f.type === 'revolve') {
        for (const p of f.params.profiles) used.add(p.name.split('/region:')[0])
      }
    }
    const groups = features.flatMap((f) => {
      if (f.type !== 'sketch' || f.suppressed) return []
      const fr = frameOf(f, sketchFrames)
      if (!fr) return []
      const active = f.id === sketchId
      if (!active && used.has(f.id)) return []
      return [
        {
          id: f.id,
          frame: fr,
          entities: active && preview ? preview : f.sketch.entities,
          active,
          states: active && defined?.sketchId === f.id ? defined.states : undefined,
        },
      ]
    })
    engine.setSketches(groups)
  }, [engine, features, sketchId, sketchFrames, preview, defined])

  useEffect(() => {
    const sk = features.find((f): f is SketchFeature => f.id === sketchId && f.type === 'sketch')
    const fr = frameOf(sk, sketchFrames)
    if (!sk || !fr) {
      engine.setSketchMarks(null, [], [])
      return
    }
    const ents = preview ?? sk.sketch.entities
    const byId = new Map(ents.map((e) => [e.id, e]))
    const selected = new Set<string>()
    const hover = new Set<string>()
    const addRefs = (into: Set<string>, refs: string[]) => {
      for (const r of refs) {
        const id = refEntityId(r)
        // A selected point marks the point (in the overlay), not the whole entity.
        if (id && !r.includes('.')) into.add(id)
      }
    }
    addRefs(selected, refsOfSelection(selection, sk.id))
    const cons = (id: string | null) => sk.sketch.constraints.find((c) => c.id === id)
    for (const id of selectedConstraintIds) for (const r of cons(id)?.entityIds ?? []) if (refEntityId(r)) selected.add(refEntityId(r) as string)
    for (const r of cons(hoverConstraintId)?.entityIds ?? []) if (refEntityId(r)) hover.add(refEntityId(r) as string)
    if (hoverRef && !tool) addRefs(hover, [hoverRef])
    const pick = (ids: Set<string>) => [...ids].flatMap((i) => byId.get(i) ?? [])
    engine.setSketchMarks(fr, pick(hover), pick(selected))
  }, [engine, features, sketchId, sketchFrames, tool, selection, preview, hoverRef, hoverConstraintId, selectedConstraintIds])

  useEffect(
    () => () => {
      engine.setSketchMarks(null, [], [])
    },
    [engine],
  )
}
