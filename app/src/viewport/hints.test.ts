import { describe, expect, it } from 'vitest'
import { edgeHint, edgeSegments, extractVerticesFromEdges, faceHint, nearestOnEdge2D, nearestOnSegment2D, segIntersectsRect2D } from './hints'

// A 4 x 2 rectangle in the plane z = 3, two triangles wound counter-clockwise seen from +z.
const quadPos = [0, 0, 3, 4, 0, 3, 4, 2, 3, 0, 2, 3]
const quadIdx = [0, 1, 2, 0, 2, 3]

describe('faceHint', () => {
  it('finds centroid, outward normal and area of a flat face', () => {
    const h = faceHint(quadPos, quadIdx, 0, 6)
    expect(h.area).toBeCloseTo(8)
    expect(h.centroid[0]).toBeCloseTo(2)
    expect(h.centroid[1]).toBeCloseTo(1)
    expect(h.centroid[2]).toBeCloseTo(3)
    expect(h.normal).toEqual([0, 0, 1])
  })

  it('weights the centroid by triangle area', () => {
    // One big triangle (area 8) and one small one (area 0.5) far away.
    const pos = [0, 0, 0, 4, 0, 0, 0, 4, 0, 100, 0, 0, 101, 0, 0, 100, 1, 0]
    const h = faceHint(pos, [0, 1, 2, 3, 4, 5], 0, 6)
    expect(h.area).toBeCloseTo(8.5)
    const expectedX = (8 * (4 / 3) + 0.5 * (301 / 3)) / 8.5
    expect(h.centroid[0]).toBeCloseTo(expectedX)
  })

  it('reads only its own range of the index buffer', () => {
    const h = faceHint(quadPos, quadIdx, 3, 3)
    expect(h.area).toBeCloseTo(4)
  })

  it('follows the winding for the normal direction', () => {
    const h = faceHint(quadPos, [0, 2, 1, 0, 3, 2], 0, 6)
    expect(h.normal).toEqual([0, 0, -1])
  })

  it('leaves the normal out for a face that wraps round', () => {
    // Two opposite quads of equal size: the normals cancel.
    const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1]
    const h = faceHint(pos, [0, 1, 2, 3, 5, 4], 0, 6)
    expect(h.normal).toBeUndefined()
    expect(h.area).toBeCloseTo(1)
  })

  it('handles an empty range', () => {
    expect(faceHint(quadPos, quadIdx, 0, 0)).toEqual({ centroid: [0, 0, 0], area: 0 })
  })
})

describe('edgeSegments', () => {
  it('keeps segment pairs as they are', () => {
    const pts = [0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]
    expect(edgeSegments(pts)).toEqual(pts)
  })
  it('turns a plain polyline into segments', () => {
    expect(edgeSegments([0, 0, 0, 1, 0, 0, 2, 1, 0])).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 1, 0])
  })
  it('a single segment stays one', () => {
    expect(edgeSegments([0, 0, 0, 5, 0, 0])).toEqual([0, 0, 0, 5, 0, 0])
  })
  it('too few points give nothing', () => {
    expect(edgeSegments([1, 2, 3])).toEqual([])
  })
})

describe('edgeHint', () => {
  it('a straight edge: midpoint and length', () => {
    const h = edgeHint([0, 0, 10, 40, 0, 10])
    expect(h.length).toBeCloseTo(40)
    expect(h.centroid).toEqual([20, 0, 10])
  })

  it('the midpoint is by arc length, not by point count', () => {
    // Segments of length 1 and 9: the middle (5) lies inside the long one.
    const h = edgeHint([0, 0, 0, 1, 0, 0, 1, 0, 0, 10, 0, 0])
    expect(h.length).toBeCloseTo(10)
    expect(h.centroid[0]).toBeCloseTo(5)
  })

  it('a quarter circle: the midpoint sits on the arc', () => {
    const pts: number[] = []
    const n = 90
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * (Math.PI / 2)
      const a1 = ((i + 1) / n) * (Math.PI / 2)
      pts.push(5 * Math.cos(a0), 5 * Math.sin(a0), 0, 5 * Math.cos(a1), 5 * Math.sin(a1), 0)
    }
    const h = edgeHint(pts)
    expect(h.length).toBeCloseTo((Math.PI / 2) * 5, 2)
    expect(h.centroid[0]).toBeCloseTo(5 * Math.cos(Math.PI / 4), 2)
    expect(h.centroid[1]).toBeCloseTo(5 * Math.sin(Math.PI / 4), 2)
  })

  it('a zero-length edge does not divide by zero', () => {
    const h = edgeHint([1, 1, 1, 1, 1, 1])
    expect(h.length).toBe(0)
    expect(h.centroid).toEqual([1, 1, 1])
  })
})

describe('screen distance', () => {
  it('clamps to the ends of a segment', () => {
    expect(nearestOnSegment2D(-3, 4, 0, 0, 10, 0)).toEqual({ t: 0, distance: 5 })
    expect(nearestOnSegment2D(13, 4, 0, 0, 10, 0)).toEqual({ t: 1, distance: 5 })
    expect(nearestOnSegment2D(5, 2, 0, 0, 10, 0)).toEqual({ t: 0.5, distance: 2 })
  })
  it('a degenerate segment is a point', () => {
    expect(nearestOnSegment2D(3, 4, 0, 0, 0, 0).distance).toBe(5)
  })
  it('picks the closest segment of an edge', () => {
    // Two segments: (0,0)-(10,0) and (10,0)-(10,10).
    const best = nearestOnEdge2D(9, 7, [0, 0, 10, 0, 10, 0, 10, 10])
    expect(best?.segment).toBe(1)
    expect(best?.distance).toBeCloseTo(1)
    expect(nearestOnEdge2D(0, 0, [])).toBeNull()
  })
})

describe('M4 vertex extraction and box intersection', () => {
  it('extracts deduplicated, deterministically ordered vertices from edge polylines', () => {
    const verts = extractVerticesFromEdges('b1', [
      { name: 'e1', points: new Float32Array([10, 0, 0, 0, 0, 0]) },
      { name: 'e2', points: new Float32Array([0, 0, 0, 0, 5, 0]) },
      { name: 'e3', points: new Float32Array([0, 5, 0, 10, 0, 0]) },
    ])
    expect(verts).toEqual([
      { name: 'b1/vertex:1', point: [0, 0, 0] },
      { name: 'b1/vertex:2', point: [0, 5, 0] },
      { name: 'b1/vertex:3', point: [10, 0, 0] },
    ])
  })

  it('detects segments inside or crossing a 2D rectangle', () => {
    expect(segIntersectsRect2D(2, 2, 4, 4, 0, 0, 10, 10)).toBe(true) // inside
    expect(segIntersectsRect2D(-5, 5, 15, 5, 0, 0, 10, 10)).toBe(true) // crosses with both endpoints outside
    expect(segIntersectsRect2D(-5, 15, 15, 15, 0, 0, 10, 10)).toBe(false) // completely outside
  })
})
