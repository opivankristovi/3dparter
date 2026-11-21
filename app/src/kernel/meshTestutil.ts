// Mesh builders shared by the mesh import tests (not part of the app bundle).
import { toBinaryStl } from './meshFile'

type V = [number, number, number]

/** Outward-wound triangles of an axis-aligned box from the origin. */
export function boxTriangles(w: number, h: number, d: number): V[][] {
  const p: V[] = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ]
  const quads = [
    [0, 3, 2, 1], // bottom (-z)
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // front (-y)
    [2, 3, 7, 6], // back
    [1, 2, 6, 5], // right
    [3, 0, 4, 7], // left
  ]
  const out: V[][] = []
  for (const [a, b, c, e] of quads) out.push([p[a], p[b], p[c]], [p[a], p[c], p[e]])
  return out
}

/** Outward-wound triangles of an n-gon prism of the given radius, height h, standing on z = 0. */
export function prismTriangles(n: number, r: number, h: number): V[][] {
  const out: V[][] = []
  const ring = (z: number, i: number): V => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    out.push([[0, 0, 0], ring(0, j), ring(0, i)])
    out.push([[0, 0, h], ring(h, i), ring(h, j)])
    out.push([ring(0, i), ring(0, j), ring(h, j)], [ring(0, i), ring(h, j), ring(h, i)])
  }
  return out
}

export const flatten = (tris: V[][]): Float32Array => Float32Array.from(tris.flat(2))

export const binaryStl = (tris: V[][]): Uint8Array => toBinaryStl(flatten(tris))

export function asciiStl(tris: V[][]): Uint8Array {
  let s = 'solid test\n'
  for (const t of tris) {
    s += 'facet normal 0 0 0\nouter loop\n'
    for (const v of t) s += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
    s += 'endloop\nendfacet\n'
  }
  return new TextEncoder().encode(s + 'endsolid test\n')
}

/** Builds a ZIP with the given text files, STORED or DEFLATE (raw), as 3MF packages are. */
export async function zip(files: Record<string, string>, deflate: boolean): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text)
    let data = raw
    if (deflate) {
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const nameBytes = enc.encode(name)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const cen = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nameBytes, 46)
    parts.push(local, data)
    central.push(cen)
    offset += local.length + data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, eocd]
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0))
  let o = 0
  for (const c of all) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** A 3MF model XML for one mesh object. */
export function modelXml(tris: V[][], opts: { unit?: string; itemTransform?: string } = {}): string {
  const verts: string[] = []
  const idx = new Map<string, number>()
  const triXml: string[] = []
  for (const t of tris) {
    const ids = t.map((v) => {
      const k = v.join(',')
      if (!idx.has(k)) {
        idx.set(k, idx.size)
        verts.push(`<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`)
      }
      return idx.get(k)!
    })
    triXml.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${opts.unit ?? 'millimeter'}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${triXml.join('')}</triangles></mesh></object></resources>
<build><item objectid="1"${opts.itemTransform ? ` transform="${opts.itemTransform}"` : ''}/></build>
</model>`
}

export const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
