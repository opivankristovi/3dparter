// Picking text: a point hits a text entity when it lies inside the bounding box of its outlines.
import type { SketchEntity, TextEntity, Vec2 } from '../../doc/types'
import { getLoadedFont } from './font'
import { contourBounds, textContours } from './outline'

/** Bounding box of a text entity's outlines in sketch mm, or null (no font yet, or no glyphs). */
export function textBounds(e: TextEntity, siblings: SketchEntity[]): { min: Vec2; max: Vec2 } | null {
  const font = getLoadedFont()
  if (!font) return null
  return contourBounds(textContours(e, { entities: siblings, constraints: [] }, font))
}

/**
 * Pick distance for `entityAt`: just under the tolerance inside the box, so the text can be picked
 * anywhere on it but a line or curve drawn right next to it still wins.
 */
export function textPickDistance(e: TextEntity, siblings: SketchEntity[], p: Vec2, tolMm: number): number {
  const b = textBounds(e, siblings)
  if (!b) return Infinity
  const inside = p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1]
  return inside ? tolMm * 0.999 : Infinity
}
