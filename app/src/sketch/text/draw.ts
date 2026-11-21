// Text outlines as world-space line segments, for the 3D viewport's sketch drawing.
import type { PlaneFrame, Sketch, SketchEntity, TextEntity, Vec3 } from '../../doc/types'
import { localToWorld } from '../geometry'
import { getLoadedFont } from './font'
import { textContours } from './outline'

/** Flat xyz pairs for every outline segment of a text entity. `siblings` = the sketch's entities (for paths). */
export function textSegments(e: TextEntity, frame: PlaneFrame, siblings: SketchEntity[]): number[] {
  const font = getLoadedFont()
  if (!font) return []
  const sketch: Sketch = { entities: siblings, constraints: [] }
  const out: number[] = []
  for (const poly of textContours(e, sketch, font)) {
    for (let i = 0; i < poly.length; i++) {
      const a: Vec3 = localToWorld(poly[i], frame)
      const b: Vec3 = localToWorld(poly[(i + 1) % poly.length], frame)
      out.push(...a, ...b)
    }
  }
  return out
}
