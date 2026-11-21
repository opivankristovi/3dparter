// File export: STL (binary/ASCII), 3MF (Core 1.x XML in PKZIP), and STEP (ISO-10303-21 via OpenCascade).
import { makeCompound } from 'replicad'
import type { ExportFormat, ExportOptions } from './api'
import { safeDelete } from './build'
import type { BodyRecord } from './regenerate'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writeZipStore(files: { path: string; content: string }[]): ArrayBuffer {
  const entries = files.map((f) => {
    const name = encoder.encode(f.path)
    const data = encoder.encode(f.content)
    return { name, data, crc: crc32(data), offset: 0 }
  })

  let localSize = 0
  let centralSize = 0
  for (const e of entries) {
    e.offset = localSize
    localSize += 30 + e.name.length + e.data.length
    centralSize += 46 + e.name.length
  }

  const total = localSize + centralSize + 22
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let pos = 0

  for (const e of entries) {
    view.setUint32(pos, 0x04034b50, true)
    view.setUint16(pos + 4, 20, true) // version needed to extract
    view.setUint16(pos + 6, 0x0800, true) // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true) // STORE (uncompressed)
    view.setUint16(pos + 10, 0, true)
    view.setUint16(pos + 12, 0, true)
    view.setUint32(pos + 14, e.crc, true)
    view.setUint32(pos + 18, e.data.length, true)
    view.setUint32(pos + 22, e.data.length, true)
    view.setUint16(pos + 26, e.name.length, true)
    view.setUint16(pos + 28, 0, true)
    out.set(e.name, pos + 30)
    out.set(e.data, pos + 30 + e.name.length)
    pos += 30 + e.name.length + e.data.length
  }

  const centralOffset = pos
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true)
    view.setUint16(pos + 4, 20, true)
    view.setUint16(pos + 6, 20, true)
    view.setUint16(pos + 8, 0x0800, true)
    view.setUint16(pos + 10, 0, true)
    view.setUint16(pos + 12, 0, true)
    view.setUint16(pos + 14, 0, true)
    view.setUint32(pos + 16, e.crc, true)
    view.setUint32(pos + 20, e.data.length, true)
    view.setUint32(pos + 24, e.data.length, true)
    view.setUint16(pos + 28, e.name.length, true)
    view.setUint16(pos + 30, 0, true)
    view.setUint16(pos + 32, 0, true)
    view.setUint16(pos + 34, 0, true)
    view.setUint16(pos + 36, 0, true)
    view.setUint32(pos + 38, 0, true)
    view.setUint32(pos + 42, e.offset, true)
    out.set(e.name, pos + 46)
    pos += 46 + e.name.length
  }

  view.setUint32(pos, 0x06054b50, true)
  view.setUint16(pos + 4, 0, true)
  view.setUint16(pos + 6, 0, true)
  view.setUint16(pos + 8, entries.length, true)
  view.setUint16(pos + 10, entries.length, true)
  view.setUint32(pos + 12, centralSize, true)
  view.setUint32(pos + 16, centralOffset, true)
  view.setUint16(pos + 20, 0, true)

  return out.buffer
}

/** Reads stored (method 0) UTF-8 entries from a ZIP archive, for testing 3MF archives. */
export function readZipEntries(buffer: ArrayBuffer): Map<string, string> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const entries = new Map<string, string>()
  let pos = 0
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true)
    const size = view.getUint32(pos + 18, true)
    const nameLen = view.getUint16(pos + 26, true)
    const extraLen = view.getUint16(pos + 28, true)
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen))
    const dataStart = pos + 30 + nameLen + extraLen
    if (method === 0) entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + size)))
    pos = dataStart + size
  }
  return entries
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const fmtCoord = (n: number): number => {
  const r = Number(n.toFixed(6))
  return r === 0 ? 0 : r
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

/** Several bodies go into one STL file: they are gathered into a compound and written together. */
export async function exportStl(bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  const shapes = bodies.map((b) => b.built.shape)
  const compound = shapes.length === 1 ? null : makeCompound(shapes)
  try {
    const target = compound ?? shapes[0]
    const blob = target.blobSTL({
      tolerance: opts.tolerance,
      angularTolerance: opts.angularTolerance,
      binary: opts.binary,
    })
    return await blob.arrayBuffer()
  } finally {
    safeDelete(compound)
  }
}

/** Exports bodies as an ISO-10303-21 STEP file. */
export async function exportStep(bodies: BodyRecord[]): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  const shapes = bodies.map((b) => b.built.shape)
  const compound = shapes.length === 1 ? null : makeCompound(shapes)
  try {
    const target = compound ?? shapes[0]
    const blob = target.blobSTEP()
    return await blob.arrayBuffer()
  } finally {
    safeDelete(compound)
  }
}

/** Exports bodies as a 3MF XML model packaged in a standard PKZIP archive. */
export async function export3mf(bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  const objects: string[] = []
  const items: string[] = []

  bodies.forEach((b, idx) => {
    const id = idx + 1
    const m = b.built.shape.mesh({ tolerance: opts.tolerance, angularTolerance: opts.angularTolerance })
    const verts: string[] = []
    for (let i = 0; i + 2 < m.vertices.length; i += 3) {
      verts.push(`<vertex x="${fmtCoord(m.vertices[i])}" y="${fmtCoord(m.vertices[i + 1])}" z="${fmtCoord(m.vertices[i + 2])}"/>`)
    }
    const tris: string[] = []
    for (let i = 0; i + 2 < m.triangles.length; i += 3) {
      tris.push(`<triangle v1="${m.triangles[i]}" v2="${m.triangles[i + 1]}" v3="${m.triangles[i + 2]}"/>`)
    }
    objects.push(
      `    <object id="${id}" name="${escapeXml(b.name)}" type="model">\n      <mesh>\n        <vertices>\n          ${verts.join('\n          ')}\n        </vertices>\n        <triangles>\n          ${tris.join('\n          ')}\n        </triangles>\n      </mesh>\n    </object>`,
    )
    items.push(`    <item objectid="${id}"/>`)
  })

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${items.join('\n')}
  </build>
</model>
`

  return writeZipStore([
    { path: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { path: '_rels/.rels', content: RELS_XML },
    { path: '3D/3dmodel.model', content: modelXml },
  ])
}

/** Dispatches STL, 3MF, or STEP export for the given bodies. */
export async function exportBodies(format: ExportFormat, bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  switch (format) {
    case 'stl':
      return exportStl(bodies, opts)
    case '3mf':
      return export3mf(bodies, opts)
    case 'step':
      return exportStep(bodies)
  }
}
