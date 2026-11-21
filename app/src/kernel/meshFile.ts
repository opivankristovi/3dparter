// Pure TypeScript readers for triangle-mesh files (STL and 3MF) that become solids on import. No OpenCascade here,
// so everything is unit-testable. Every format is normalised to a flat list of triangles in millimetres, and stored
// in the document as a base64 binary STL.

/** The largest mesh 3DParter will turn into a solid. */
export const MAX_MESH_TRIANGLES = 20_000

export interface MeshData {
  /** Nine floats per triangle: x, y, z of each corner, in millimetres. */
  positions: Float32Array
  triangles: number
}

const textDecoder = new TextDecoder()

/** Throws a plain-English error when a mesh is empty, too big, or contains broken numbers. */
export function checkMesh(positions: Float32Array): MeshData {
  const triangles = Math.floor(positions.length / 9)
  if (triangles === 0) throw new Error('This file does not contain any triangles, so there is nothing to import.')
  assertTriangleCount(triangles)
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new Error('This mesh contains broken coordinates (not-a-number values), so it cannot be imported.')
    }
  }
  return { positions, triangles }
}

function assertTriangleCount(triangles: number): void {
  if (triangles > MAX_MESH_TRIANGLES) {
    throw new Error(
      `This mesh has ${triangles.toLocaleString('en-US')} triangles. 3DParter can turn meshes of up to ` +
        `${MAX_MESH_TRIANGLES.toLocaleString('en-US')} triangles into solids. Simplify it in your mesh tool first.`,
    )
  }
}

// ---- STL --------------------------------------------------------------------------------------

/** Reads a binary or ASCII STL. */
export function parseStl(bytes: Uint8Array): MeshData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const binaryCount = bytes.length >= 84 ? view.getUint32(80, true) : -1
  const exactBinary = binaryCount >= 0 && 84 + 50 * binaryCount === bytes.length
  const startsSolid = textDecoder.decode(bytes.subarray(0, Math.min(5, bytes.length))).toLowerCase() === 'solid'
  if (exactBinary) return readBinaryStl(view, binaryCount)
  if (startsSolid) {
    const text = textDecoder.decode(bytes)
    if (/\bfacet\b/i.test(text)) return readAsciiStl(text)
  }
  // Some exporters pad the file; accept it when every triangle the header promises is present.
  if (binaryCount > 0 && 84 + 50 * binaryCount <= bytes.length) return readBinaryStl(view, binaryCount)
  throw new Error('This file does not look like a valid STL model.')
}

function readBinaryStl(view: DataView, count: number): MeshData {
  assertTriangleCount(count)
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const o = 84 + 50 * t + 12 // skip the stored normal
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(o + 4 * k, true)
  }
  return checkMesh(positions)
}

function readAsciiStl(text: string): MeshData {
  const values: number[] = []
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    values.push(Number(m[1]), Number(m[2]), Number(m[3]))
    if (values.length / 9 > MAX_MESH_TRIANGLES + 1) break
  }
  if (values.length % 9 !== 0) throw new Error('This STL file is cut short or damaged.')
  return checkMesh(Float32Array.from(values))
}

/** Writes positions (nine floats per triangle) as a binary STL with computed normals. */
export function toBinaryStl(positions: Float32Array): Uint8Array {
  const n = Math.floor(positions.length / 9)
  const out = new Uint8Array(84 + 50 * n)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode('3DParter normalised mesh'), 0)
  view.setUint32(80, n, true)
  for (let t = 0; t < n; t++) {
    const p = positions.subarray(t * 9, t * 9 + 9)
    const ux = p[3] - p[0]
    const uy = p[4] - p[1]
    const uz = p[5] - p[2]
    const vx = p[6] - p[0]
    const vy = p[7] - p[1]
    const vz = p[8] - p[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const o = 84 + 50 * t
    view.setFloat32(o, nx, true)
    view.setFloat32(o + 4, ny, true)
    view.setFloat32(o + 8, nz, true)
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + 4 * k, p[k], true)
  }
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---- 3MF --------------------------------------------------------------------------------------

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
}

interface ZipEntry {
  method: number
  compressedSize: number
  localOffset: number
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('This file does not look like a valid 3MF model.')
  const count = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) break
    const method = view.getUint16(pos + 10, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = textDecoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen))
    entries.set(name.replace(/^\/+/, ''), { method, compressedSize, localOffset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZipText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = entries.get(name.replace(/^\/+/, ''))
  if (!e) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nameLen = view.getUint16(e.localOffset + 26, true)
  const extraLen = view.getUint16(e.localOffset + 28, true)
  const start = e.localOffset + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + e.compressedSize)
  if (e.method === 0) return textDecoder.decode(raw)
  if (e.method === 8) return textDecoder.decode(await inflateRaw(raw))
  throw new Error('This 3MF file uses a compression method 3DParter cannot read.')
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1]] = m[2] ?? m[3] ?? ''
  return out
}

/** Row-vector affine matrix from the 3MF "m00 m01 m02 m10 ... m32" string; null when absent or malformed. */
function parseTransform(s: string | undefined): number[] | null {
  if (!s) return null
  const v = s.trim().split(/\s+/).map(Number)
  return v.length === 12 && v.every(Number.isFinite) ? v : null
}

function applyM(m: number[] | null, p: [number, number, number]): [number, number, number] {
  if (!m) return p
  const [x, y, z] = p
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ]
}

function multiply(a: number[] | null, b: number[] | null): number[] | null {
  if (!a) return b
  if (!b) return a
  // Apply a first, then b (row vectors).
  const r: number[] = new Array(12).fill(0)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  }
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j]
  return r
}

function determinant(m: number[] | null): number {
  if (!m) return 1
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

interface ObjectDef {
  vertices: number[]
  tris: number[]
  components: { id: string; transform: number[] | null }[]
}

function parseModelXml(xml: string): MeshData {
  const unitName = (/<(?:\w+:)?model\b[^>]*?\bunit\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1] ?? 'millimeter').toLowerCase()
  const unit = UNIT_TO_MM[unitName]
  if (unit === undefined) throw new Error(`This 3MF file uses an unknown unit (${unitName}).`)

  const objects = new Map<string, ObjectDef>()
  const objRe = /<(?:\w+:)?object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?object>)/gi
  let m: RegExpExecArray | null
  while ((m = objRe.exec(xml))) {
    const id = attrs(m[1]).id
    const body = m[2] ?? ''
    if (id === undefined) continue
    const def: ObjectDef = { vertices: [], tris: [], components: [] }
    for (const v of body.matchAll(/<(?:\w+:)?vertex\b([^>]*?)\/?>/gi)) {
      const a = attrs(v[1])
      def.vertices.push(Number(a.x), Number(a.y), Number(a.z))
    }
    for (const t of body.matchAll(/<(?:\w+:)?triangle\b([^>]*?)\/?>/gi)) {
      const a = attrs(t[1])
      def.tris.push(Number(a.v1), Number(a.v2), Number(a.v3))
    }
    for (const c of body.matchAll(/<(?:\w+:)?component\b([^>]*?)\/?>/gi)) {
      const a = attrs(c[1])
      if (a.objectid !== undefined) def.components.push({ id: a.objectid, transform: parseTransform(a.transform) })
    }
    objects.set(id, def)
  }

  const items: { id: string; transform: number[] | null }[] = []
  const build = /<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/i.exec(xml)?.[1] ?? ''
  for (const it of build.matchAll(/<(?:\w+:)?item\b([^>]*?)\/?>/gi)) {
    const a = attrs(it[1])
    if (a.objectid !== undefined) items.push({ id: a.objectid, transform: parseTransform(a.transform) })
  }
  if (items.length === 0) {
    const referenced = new Set<string>()
    for (const o of objects.values()) for (const c of o.components) referenced.add(c.id)
    for (const id of objects.keys()) if (!referenced.has(id)) items.push({ id, transform: null })
  }

  const out: number[] = []
  const add = (id: string, transform: number[] | null, depth: number) => {
    const def = objects.get(id)
    if (!def || depth > 16) return
    const flip = determinant(transform) < 0
    const vcount = def.vertices.length / 3
    for (let i = 0; i + 2 < def.tris.length; i += 3) {
      const idx = [def.tris[i], def.tris[i + 1], def.tris[i + 2]]
      if (idx.some((k) => !Number.isInteger(k) || k < 0 || k >= vcount)) {
        throw new Error('This 3MF file refers to corners that do not exist, so it cannot be imported.')
      }
      if (flip) [idx[1], idx[2]] = [idx[2], idx[1]]
      for (const k of idx) {
        const p = applyM(transform, [def.vertices[k * 3], def.vertices[k * 3 + 1], def.vertices[k * 3 + 2]])
        out.push(p[0] * unit, p[1] * unit, p[2] * unit)
      }
      if (out.length / 9 > MAX_MESH_TRIANGLES * 2) assertTriangleCount(out.length / 9)
    }
    for (const c of def.components) add(c.id, multiply(c.transform, transform), depth + 1)
  }
  for (const it of items) add(it.id, it.transform, 0)
  return checkMesh(Float32Array.from(out))
}

/** Reads every mesh in a 3MF package, applying build-item and component transforms and converting to millimetres. */
export async function parse3mf(bytes: Uint8Array): Promise<MeshData> {
  const entries = readZipDirectory(bytes)
  let modelPath = '3D/3dmodel.model'
  const rels = await readZipText(bytes, entries, '_rels/.rels')
  if (rels) {
    for (const r of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/gi)) {
      const a = attrs(r[1])
      if (a.Type?.endsWith('/3dmodel') && a.Target) {
        modelPath = a.Target.replace(/^\/+/, '')
        break
      }
    }
  }
  let xml = await readZipText(bytes, entries, modelPath)
  if (xml === null && modelPath !== '3D/3dmodel.model') xml = await readZipText(bytes, entries, '3D/3dmodel.model')
  if (xml === null) throw new Error('This 3MF file has no model inside it.')
  return parseModelXml(xml)
}

export const MESH_GAPS_MESSAGE =
  'This mesh has gaps, so it cannot become a solid. Repair it (close the holes) and import it again.'

/**
 * Counts edges used by only one triangle once nearby corners are welded. The weld is coarser than the kernel's sewing
 * tolerance, so this never reports gaps the kernel would have closed: it only lets the dialog fail fast.
 */
export function countOpenEdges(positions: Float32Array): number {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i])
    max[i % 3] = Math.max(max[i % 3], positions[i])
  }
  const cell = Math.max(1e-6, 1e-3 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]))
  const ids = new Map<string, number>()
  const idOf = (i: number): number => {
    const key = `${Math.round(positions[i] / cell)},${Math.round(positions[i + 1] / cell)},${Math.round(positions[i + 2] / cell)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    return id
  }
  const uses = new Map<number, number>()
  const markUse = (a: number, b: number) => {
    if (a === b) return
    const k = a < b ? a * 0x4000000 + b : b * 0x4000000 + a
    uses.set(k, (uses.get(k) ?? 0) + 1)
  }
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const a = idOf(t)
    const b = idOf(t + 3)
    const c = idOf(t + 6)
    markUse(a, b)
    markUse(b, c)
    markUse(c, a)
  }
  let open = 0
  for (const n of uses.values()) if (n === 1) open++
  return open
}

/** Reads a file by its extension and returns a normalised binary STL plus its triangle count. */
export async function readMeshFile(filename: string, bytes: Uint8Array): Promise<{ stl: Uint8Array; triangles: number }> {
  const lower = filename.toLowerCase()
  const mesh = lower.endsWith('.3mf') ? await parse3mf(bytes) : parseStl(bytes)
  if (countOpenEdges(mesh.positions) > 0) throw new Error(MESH_GAPS_MESSAGE)
  return { stl: toBinaryStl(mesh.positions), triangles: mesh.triangles }
}
