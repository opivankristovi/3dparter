import { describe, expect, it } from 'vitest'
import { MAX_MESH_TRIANGLES, MESH_GAPS_MESSAGE, countOpenEdges, readMeshFile, base64ToBytes, bytesToBase64, parse3mf, parseStl, toBinaryStl } from './meshFile'
import { RELS, asciiStl, binaryStl, boxTriangles, flatten, modelXml, prismTriangles, zip } from './meshTestutil'

const bounds = (p: Float32Array) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3], p[i])
    max[i % 3] = Math.max(max[i % 3], p[i])
  }
  return { min, max }
}

describe('meshFile', () => {
  it('parses a binary and an ASCII cube STL to 12 triangles', () => {
    const cube = boxTriangles(10, 10, 10)
    const b = parseStl(binaryStl(cube))
    const a = parseStl(asciiStl(cube))
    expect(b.triangles).toBe(12)
    expect(a.triangles).toBe(12)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
  })

  it('round-trips through the normalised STL and base64', () => {
    const p = flatten(boxTriangles(1, 2, 3))
    const back = parseStl(base64ToBytes(bytesToBase64(toBinaryStl(p))))
    expect(Array.from(back.positions)).toEqual(Array.from(p))
  })

  it('rejects empty files, garbage and not-a-number coordinates', () => {
    expect(() => parseStl(new TextEncoder().encode('solid empty\nendsolid empty\n'))).toThrow()
    expect(() => parseStl(new Uint8Array([1, 2, 3]))).toThrow(/valid STL/)
    const bad = flatten(boxTriangles(1, 1, 1))
    bad[4] = NaN
    expect(() => parseStl(toBinaryStl(bad))).toThrow(/broken coordinates/)
  })

  it('rejects meshes over the triangle limit with a plain message', () => {
    const n = MAX_MESH_TRIANGLES + 1
    const bytes = new Uint8Array(84 + 50 * n)
    new DataView(bytes.buffer).setUint32(80, n, true)
    expect(() => parseStl(bytes)).toThrow(/20,001 triangles.*up to 20,000 triangles.*Simplify/)
    expect(parseStl(toBinaryStl(flatten(prismTriangles(1000, 5, 5)))).triangles).toBe(4000)
  })

  const cube = boxTriangles(10, 10, 10)
  for (const deflate of [false, true]) {
    const kind = deflate ? 'DEFLATE' : 'STORED'
    it(`reads a ${kind} 3MF and converts inches to millimetres`, async () => {
      const file = await zip({ '_rels/.rels': RELS, '3D/3dmodel.model': modelXml(cube, { unit: 'inch' }) }, deflate)
      const m = await parse3mf(file)
      expect(m.triangles).toBe(12)
      const { min, max } = bounds(m.positions)
      expect(min).toEqual([0, 0, 0])
      expect(max[0]).toBeCloseTo(254, 3)
    })

    it(`applies the build item transform in a ${kind} 3MF`, async () => {
      // Scale by 2 and move by (5, 6, 7).
      const xml = modelXml(cube, { itemTransform: '2 0 0 0 2 0 0 0 2 5 6 7' })
      const file = await zip({ '_rels/.rels': RELS, '3D/3dmodel.model': xml }, deflate)
      const { min, max } = bounds((await parse3mf(file)).positions)
      expect(min).toEqual([5, 6, 7])
      expect(max).toEqual([25, 26, 27])
    })
  }

  it('keeps the winding right for mirrored transforms and finds the default model path', async () => {
    const file = await zip({ '3D/3dmodel.model': modelXml(cube, { itemTransform: '-1 0 0 0 1 0 0 0 1 0 0 0' }) }, false)
    const p = (await parse3mf(file)).positions
    let v = 0
    for (let i = 0; i < p.length; i += 9) {
      v +=
        (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) -
          p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) +
          p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) /
        6
    }
    expect(v).toBeCloseTo(1000, 3)
  })

  it('spots open edges before the kernel runs, and accepts closed meshes', async () => {
    expect(countOpenEdges(flatten(boxTriangles(10, 10, 10)))).toBe(0)
    expect(countOpenEdges(flatten(prismTriangles(64, 5, 5)))).toBe(0)
    expect(countOpenEdges(flatten(boxTriangles(10, 10, 10).slice(1)))).toBe(3)
    await expect(readMeshFile('open.stl', binaryStl(boxTriangles(10, 10, 10).slice(1)))).rejects.toThrow(MESH_GAPS_MESSAGE)
    expect((await readMeshFile('ok.stl', binaryStl(boxTriangles(10, 10, 10)))).triangles).toBe(12)
  })

  it('rejects a 3MF above the triangle limit', async () => {
    const big = prismTriangles(6000, 5, 5) // 24,000 triangles
    const file = await zip({ '_rels/.rels': RELS, '3D/3dmodel.model': modelXml(big) }, true)
    await expect(parse3mf(file)).rejects.toThrow(/24,000 triangles/)
  })
})
