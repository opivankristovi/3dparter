// Pure helpers for mapping triangles to named faces. No three.js.
export interface FaceRange {
  name: string
  /** In units of index-buffer entries (3 per triangle). */
  start: number
  count: number
}

/** Face ranges sorted by start, ready for binary search. */
export function sortFaces(faces: FaceRange[]): FaceRange[] {
  return [...faces].sort((a, b) => a.start - b.start)
}

/** Name of the face that owns triangle `tri`. `sorted` must come from sortFaces. null if no face covers it. */
export function faceNameAtTriangle(sorted: FaceRange[], tri: number): string | null {
  const pos = tri * 3
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const f = sorted[mid]
    if (pos < f.start) hi = mid - 1
    else if (pos >= f.start + f.count) lo = mid + 1
    else return f.name
  }
  return null
}

export interface DrawGroup {
  start: number
  count: number
  materialIndex: number
}

/**
 * Draw groups that cover the whole index buffer: one group per face (material chosen by `stateOf`),
 * and gaps filled with material 0 so no triangle disappears.
 */
export function buildGroups(sorted: FaceRange[], total: number, stateOf: (name: string) => number): DrawGroup[] {
  const out: DrawGroup[] = []
  let cursor = 0
  for (const f of sorted) {
    if (f.start > cursor) out.push({ start: cursor, count: f.start - cursor, materialIndex: 0 })
    out.push({ start: f.start, count: f.count, materialIndex: stateOf(f.name) })
    cursor = Math.max(cursor, f.start + f.count)
  }
  if (cursor < total) out.push({ start: cursor, count: total - cursor, materialIndex: 0 })
  return out
}
