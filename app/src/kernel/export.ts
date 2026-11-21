// File export: STL (binary/ASCII), 3MF (Core 1.x XML in PKZIP), STEP (ISO-10303-21 via OpenCascade),
// Wavefront OBJ (text) and binary glTF 2.0 (GLB).
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

/** One body's triangles as the OBJ and GLB writers take them (world mm, Z up). */
export interface ExportMesh {
  name: string
  positions: ArrayLike<number>
  /** Per-vertex normals, same length as `positions`, or empty when the mesh has none. */
  normals: ArrayLike<number>
  indices: ArrayLike<number>
}

function meshesOf(bodies: BodyRecord[], opts: ExportOptions): ExportMesh[] {
  return bodies.map((b) => {
    const m = b.built.shape.mesh({ tolerance: opts.tolerance, angularTolerance: opts.angularTolerance })
    return {
      name: opts.bodyNames?.[b.name] ?? b.name,
      positions: m.vertices,
      normals: m.normals,
      indices: m.triangles,
    }
  })
}

/** A name in OBJ is one token: spaces and line breaks would break the file. */
const objName = (name: string): string => name.replace(/\s+/g, '_') || 'body'

/** Wavefront OBJ, millimetres, one `o` group per body. Face lines use `v//vn` when the mesh has normals. */
export function objFromMeshes(meshes: ExportMesh[]): string {
  const lines: string[] = ['# 3DParter OBJ export', '# Units: millimetres']
  let offset = 0
  for (const m of meshes) {
    const count = Math.floor(m.positions.length / 3)
    const hasNormals = m.normals.length === m.positions.length && count > 0
    lines.push(`o ${objName(m.name)}`)
    for (let i = 0; i < count; i++) {
      lines.push(`v ${fmtCoord(m.positions[i * 3])} ${fmtCoord(m.positions[i * 3 + 1])} ${fmtCoord(m.positions[i * 3 + 2])}`)
    }
    if (hasNormals) {
      for (let i = 0; i < count; i++) {
        lines.push(`vn ${fmtCoord(m.normals[i * 3])} ${fmtCoord(m.normals[i * 3 + 1])} ${fmtCoord(m.normals[i * 3 + 2])}`)
      }
    }
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      const a = m.indices[t] + 1 + offset
      const b = m.indices[t + 1] + 1 + offset
      const c = m.indices[t + 2] + 1 + offset
      lines.push(hasNormals ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`)
    }
    offset += count
  }
  return lines.join('\n') + '\n'
}

/** Exports bodies as Wavefront OBJ text. */
export async function exportObj(bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  const bytes = encoder.encode(objFromMeshes(meshesOf(bodies, opts)))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const MM_TO_M = 0.001
const GLB_MAGIC = 0x46546c67 // 'glTF'
const GLB_JSON = 0x4e4f534a // 'JSON'
const GLB_BIN = 0x004e4942 // 'BIN' and a zero byte

/**
 * Binary glTF 2.0: one mesh and node per body, positions in metres, Y up ((x, y, z) in the model becomes
 * (x, z, -y)), indices uint32, one default material.
 */
export function glbFromMeshes(meshes: ExportMesh[]): ArrayBuffer {
  const views: { offset: number; length: number; target: number }[] = []
  const accessors: Record<string, unknown>[] = []
  const meshJson: Record<string, unknown>[] = []
  const nodes: Record<string, unknown>[] = []
  const chunks: Uint8Array[] = []
  let binLength = 0
  const addView = (data: ArrayBufferView, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    views.push({ offset: binLength, length: bytes.length, target })
    chunks.push(bytes)
    binLength += bytes.length // float32 and uint32 data is always a multiple of 4
    return views.length - 1
  }

  meshes.forEach((m, mi) => {
    const count = Math.floor(m.positions.length / 3)
    const pos = new Float32Array(count * 3)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++) {
      pos[i * 3] = m.positions[i * 3] * MM_TO_M
      pos[i * 3 + 1] = m.positions[i * 3 + 2] * MM_TO_M
      pos[i * 3 + 2] = -m.positions[i * 3 + 1] * MM_TO_M
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i * 3 + k])
        max[k] = Math.max(max[k], pos[i * 3 + k])
      }
    }
    const attributes: Record<string, number> = {}
    accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count, type: 'VEC3', min, max })
    attributes.POSITION = accessors.length - 1
    if (m.normals.length === m.positions.length && count > 0) {
      const nor = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        nor[i * 3] = m.normals[i * 3]
        nor[i * 3 + 1] = m.normals[i * 3 + 2]
        nor[i * 3 + 2] = -m.normals[i * 3 + 1]
      }
      accessors.push({ bufferView: addView(nor, 34962), componentType: 5126, count, type: 'VEC3' })
      attributes.NORMAL = accessors.length - 1
    }
    const idx = Uint32Array.from(m.indices as ArrayLike<number>)
    accessors.push({ bufferView: addView(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' })
    meshJson.push({ name: m.name, primitives: [{ attributes, indices: accessors.length - 1, material: 0, mode: 4 }] })
    nodes.push({ name: m.name, mesh: mi })
  })

  const json = {
    asset: { version: '2.0', generator: '3DParter' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: meshJson,
    materials: [
      { name: 'Default', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.75, 0.78, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
    ],
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, byteOffset: v.offset, byteLength: v.length, target: v.target })),
    buffers: [{ byteLength: binLength }],
  }
  const jsonBytes = encoder.encode(JSON.stringify(json))
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4
  const total = 12 + 8 + jsonPadded + 8 + binLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonPadded, true)
  view.setUint32(16, GLB_JSON, true)
  out.set(jsonBytes, 20)
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded) // the JSON chunk is padded with spaces
  const binStart = 20 + jsonPadded
  view.setUint32(binStart, binLength, true)
  view.setUint32(binStart + 4, GLB_BIN, true)
  let at = binStart + 8
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out.buffer
}

/** Exports bodies as a binary glTF (GLB) file. */
export async function exportGlb(bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  return glbFromMeshes(meshesOf(bodies, opts))
}

/** Dispatches STL, 3MF, STEP, OBJ or GLB export for the given bodies. */
export async function exportBodies(format: ExportFormat, bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  switch (format) {
    case 'stl':
      return exportStl(bodies, opts)
    case '3mf':
      return export3mf(bodies, opts)
    case 'step':
      return exportStep(bodies)
    case 'obj':
      return exportObj(bodies, opts)
    case 'glb':
      return exportGlb(bodies, opts)
  }
}
