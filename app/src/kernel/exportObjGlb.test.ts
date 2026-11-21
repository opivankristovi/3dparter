// OBJ and GLB export: the files are parsed back and compared with the mesh they were written from.
import { beforeAll, describe, expect, it } from 'vitest'
import { exportBodies, glbFromMeshes, objFromMeshes } from './export'
import type { ExportOptions } from './api'
import { Regenerator } from './regenerate'
import { docOf, extrudeFeature, ready, rect, sketchFeature } from './testutil'

beforeAll(async () => {
  await ready()
})

const OPTS: ExportOptions = { tolerance: 0.01, angularTolerance: 0.1, binary: true, bodyNames: { e: 'My box' } }

function boxBodies() {
  const k = new Regenerator()
  k.regenerate(docOf(sketchFeature('s', 'XY', rect('l', 0, 0, 10, 20)), extrudeFeature('e', ['s/region:l1,l2,l3,l4'], '30')), 1)
  return { k, bodies: [k.getBody('e')!] }
}

function parseGlb(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const jsonLen = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)))
  const binHeader = 20 + jsonLen
  const binLen = view.getUint32(binHeader, true)
  return { view, json, jsonLen, binLen, binStart: binHeader + 8 }
}

describe('OBJ export', () => {
  it('has one object per body, 1-based faces and matching counts', async () => {
    const { k, bodies } = boxBodies()
    const text = new TextDecoder().decode(await exportBodies('obj', bodies, OPTS))
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^#/)
    expect(lines.filter((l) => l.startsWith('o '))).toEqual(['o My_box'])
    const v = lines.filter((l) => l.startsWith('v '))
    const vn = lines.filter((l) => l.startsWith('vn '))
    const f = lines.filter((l) => l.startsWith('f '))
    expect(v.length).toBeGreaterThan(0)
    expect(vn.length).toBe(v.length)
    expect(f.length).toBe(12)
    const refs = f.flatMap((l) => l.slice(2).split(' ').map((p) => p.split('//').map(Number)))
    for (const [a, b] of refs) {
      expect(a).toBeGreaterThanOrEqual(1)
      expect(a).toBeLessThanOrEqual(v.length)
      expect(b).toBe(a)
    }
    const xs = v.map((l) => Number(l.split(' ')[1]))
    expect(Math.max(...xs)).toBeCloseTo(10, 4) // millimetres
    k.dispose()
  })

  it('offsets face indices for the second object', () => {
    const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [], indices: [0, 1, 2] }
    const text = objFromMeshes([
      { name: 'a', ...tri },
      { name: 'b', ...tri },
    ])
    const f = text.split('\n').filter((l) => l.startsWith('f '))
    expect(f).toEqual(['f 1 2 3', 'f 4 5 6']) // no normals: plain form
  })
})

describe('GLB export', () => {
  it('writes a valid binary glTF 2.0 with metres and Y up', async () => {
    const { k, bodies } = boxBodies()
    const buffer = await exportBodies('glb', bodies, OPTS)
    const { view, json, jsonLen, binLen, binStart } = parseGlb(buffer)
    expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 4))).toBe('glTF')
    expect(view.getUint32(4, true)).toBe(2)
    expect(view.getUint32(8, true)).toBe(buffer.byteLength)
    expect(jsonLen % 4).toBe(0)
    expect(binLen % 4).toBe(0)
    expect(20 + jsonLen + 8 + binLen).toBe(buffer.byteLength)
    expect(json.asset.version).toBe('2.0')
    expect(json.meshes).toHaveLength(1)
    expect(json.nodes[0].name).toBe('My box')
    const prim = json.meshes[0].primitives[0]
    const pos = json.accessors[prim.attributes.POSITION]
    const nor = json.accessors[prim.attributes.NORMAL]
    const idx = json.accessors[prim.indices]
    expect(pos.count).toBe(nor.count)
    expect(idx.count).toBe(36)
    expect(idx.componentType).toBe(5125)
    // box 10 x 20 x 30 mm (x, y, z) becomes x 0.01, y (up) 0.03, z -0.02..0 in metres
    expect(pos.max[0]).toBeCloseTo(0.01, 6)
    expect(pos.max[1]).toBeCloseTo(0.03, 6)
    expect(pos.min[2]).toBeCloseTo(-0.02, 6)
    expect(pos.max[2]).toBeCloseTo(0, 6)
    // the BIN bytes agree with the declared min/max
    const bv = json.bufferViews[pos.bufferView]
    const floats = new Float32Array(buffer.slice(binStart + bv.byteOffset, binStart + bv.byteOffset + bv.byteLength))
    expect(floats.length).toBe(pos.count * 3)
    let maxY = -Infinity
    for (let i = 1; i < floats.length; i += 3) maxY = Math.max(maxY, floats[i])
    expect(maxY).toBeCloseTo(pos.max[1], 6)
    k.dispose()
  })

  it('writes one mesh and node per body and pads the JSON chunk with spaces', () => {
    const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [], indices: [0, 1, 2] }
    const buffer = glbFromMeshes([
      { name: 'a', ...tri },
      { name: 'b', ...tri },
    ])
    const { json, jsonLen } = parseGlb(buffer)
    expect(json.meshes).toHaveLength(2)
    expect(json.nodes).toHaveLength(2)
    expect(json.accessors.filter((a: { type: string }) => a.type === 'SCALAR')).toHaveLength(2)
    expect(Object.keys(json.meshes[0].primitives[0].attributes)).toEqual(['POSITION'])
    expect(jsonLen % 4).toBe(0)
  })
})
