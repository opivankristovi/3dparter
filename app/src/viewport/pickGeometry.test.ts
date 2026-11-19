// @vitest-environment node
// BUG-001 regression: after building the BVH, the triangle -> face-name mapping must still be right,
// and the index buffer the visible mesh draws from must keep its order.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { faceNameAtTriangle, sortFaces } from './pick'
import { createPickGeometry } from './pickGeometry'

/**
 * Two faces on z = 0, written face A first then face B, but spatially interleaved in strips along x
 * (A in the y<0 half, B in the y>0 half, 40 quads each). Any BVH split along x mixes their triangles.
 */
function twoFaceMesh() {
  const pos: number[] = []
  const idx: number[] = []
  const quad = (x: number, y0: number) => {
    const b = pos.length / 3
    pos.push(x, y0, 0, x + 1, y0, 0, x + 1, y0 + 1, 0, x, y0 + 1, 0)
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  for (let i = 0; i < 40; i++) quad(i, -1) // face A: y in [-1, 0]
  for (let i = 0; i < 40; i++) quad(i, 0) // face B: y in [0, 1]
  const faces = [
    { name: 'A', start: 0, count: 240 },
    { name: 'B', start: 240, count: 240 },
  ]
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), faces }
}

describe('createPickGeometry', () => {
  it('keeps the index order and maps hits to the right face', () => {
    const m = twoFaceMesh()
    const original = m.indices.slice()
    const position = new THREE.BufferAttribute(m.positions, 3)
    const index = new THREE.BufferAttribute(m.indices, 1)
    const geo = createPickGeometry(position, index)

    // The visible mesh shares `index`: it must not have been reordered.
    expect(Array.from(index.array as Uint32Array)).toEqual(Array.from(original))

    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    const sorted = sortFaces(m.faces)
    const ray = new THREE.Raycaster()
    for (const [x, y, want] of [
      [30.3, 0.5, 'B'],
      [5.7, 0.5, 'B'],
      [30.3, -0.5, 'A'],
      [12.2, -0.4, 'A'],
    ] as const) {
      ray.set(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1))
      const hit = ray.intersectObject(mesh)[0]
      expect(hit, `hit at ${x},${y}`).toBeDefined()
      expect(faceNameAtTriangle(sorted, hit.faceIndex!), `face at ${x},${y}`).toBe(want)
    }
  })
})
