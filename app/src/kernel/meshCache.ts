// Cache of converted mesh solids, so an imported STL/3MF is not re-sewn into a solid on every project open.
// Two layers: a Map in the worker (same session) and an IndexedDB store of its own (`3dparter-meshcache`).
// The cached value is the unified shape BEFORE naming, serialised with OCCT BinTools; names are assigned again
// from the restored shape. Every failure of the persistent layer falls back to converting.
import { cast, getOC, HASH_CODE_MAX, type AnyShape } from 'replicad'
import { KERNEL_VERSION } from './occ'
import type { ProjectDocument } from '../doc/types'

/** Bump when the cached payload or the conversion pipeline changes in a way that makes old entries wrong. */
export const MESH_CACHE_FORMAT = 1
export const MESH_CACHE_DB = '3dparter-meshcache'
const STORE_NAME = 'shapes'

/**
 * Face and edge names of the shape, in the order the shape lists its unique faces / edges, with the feature id
 * replaced by a placeholder. Naming from scratch costs seconds on a big mesh; with these it is a single pass.
 */
export interface CachedNames {
  faces: string[]
  edges: string[]
}

export interface MeshCacheEntry {
  key: string
  brep: Uint8Array
  names?: CachedNames
  bytes: number
  createdAt: number
  lastUsed: number
}

export interface MeshCacheStore {
  /** Returns the entry and marks it as used now. */
  get(key: string): Promise<MeshCacheEntry | undefined>
  put(entry: MeshCacheEntry): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<Array<Pick<MeshCacheEntry, 'key' | 'bytes' | 'lastUsed'>>>
}

export interface MeshCacheLimits {
  maxEntryBytes: number
  maxTotalBytes: number
}

const DEFAULT_LIMITS: MeshCacheLimits = { maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 }

/** Counters for tests and diagnostics. */
export const meshCacheStats = { conversions: 0, memoryHits: 0 }

interface MemoryEntry {
  brep: Uint8Array
  names?: CachedNames
}
const memory = new Map<string, MemoryEntry>() // insertion order = least recently used first
let limits: MeshCacheLimits = { ...DEFAULT_LIMITS }
let store: MeshCacheStore | null | undefined // undefined = not decided yet; null = no persistent layer
let pending: Promise<unknown>[] = []

/** Test hook: replace the persistent store (null = none) and limits, and empty the memory layer. */
export function configureMeshCache(opts: { store?: MeshCacheStore | null; limits?: Partial<MeshCacheLimits> } = {}): void {
  store = opts.store === undefined ? undefined : opts.store
  limits = { ...DEFAULT_LIMITS, ...opts.limits }
  memory.clear()
  meshCacheStats.conversions = 0
  meshCacheStats.memoryHits = 0
}

/** Empties only the in-memory layer (as a fresh session would). */
export function clearMeshCacheMemory(): void {
  memory.clear()
}

/** Resolves when every background write to the persistent store has finished. */
export async function flushMeshCache(): Promise<void> {
  while (pending.length) {
    const p = pending
    pending = []
    await Promise.allSettled(p)
  }
}

function persistent(): MeshCacheStore | null {
  if (store === undefined) {
    try {
      store = typeof indexedDB === 'undefined' ? null : createIdbMeshStore(indexedDB)
    } catch {
      store = null
    }
  }
  return store
}

// ---------- key ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Synchronous SHA-256 of the characters of a string (the base64 content is ASCII), as lowercase hex. */
export function sha256Hex(text: string): string {
  const len = text.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  for (let i = 0; i < len; i++) padded[i] = text.charCodeAt(i) & 0xff
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000))
  view.setUint32(padded.length - 4, (len * 8) >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** SHA-256 of the base64 content, plus the cache format and the kernel version. */
export function meshCacheKey(base64Stl: string): string {
  return `${sha256Hex(base64Stl)}|f${MESH_CACHE_FORMAT}|${KERNEL_VERSION}`
}

// ---------- serialisation ----------

function tempName(): string {
  return `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.bin`
}

/** BinTools bytes of a shape, or null when it cannot be written. */
export function serializeShape(shape: AnyShape): Uint8Array | null {
  const oc = getOC()
  const file = tempName()
  const range = new oc.Message_ProgressRange()
  try {
    if (!oc.BinTools.Write(shape.wrapped, `/${file}`, range)) return null
    return oc.FS.readFile(`/${file}`) as Uint8Array
  } catch {
    return null
  } finally {
    range.delete()
    try {
      oc.FS.unlink(`/${file}`)
    } catch {
      /* ignore missing temp file */
    }
  }
}

/** The shape stored in these bytes, or null when they are unreadable. */
export function deserializeShape(bytes: Uint8Array): AnyShape | null {
  const oc = getOC()
  const file = tempName()
  const range = new oc.Message_ProgressRange()
  const target = new oc.TopoDS_Shape()
  try {
    oc.FS.writeFile(`/${file}`, bytes)
    if (!oc.BinTools.Read(target, `/${file}`, range)) return null
    if (target.IsNull()) return null
    const shape = cast(target as never)
    return shape.solids.length > 0 ? shape : null
  } catch {
    return null
  } finally {
    range.delete()
    target.delete()
    try {
      oc.FS.unlink(`/${file}`)
    } catch {
      /* ignore missing temp file */
    }
  }
}

// ---------- names ----------

const ID_MARK = '\u0001'

/** Unique faces or edges of a shape in the order replicad lists them, as their hash codes (one pass, no quadratic scan). */
function enumerateHashes(shape: AnyShape, kind: 'FACE' | 'EDGE'): number[] {
  const oc = getOC()
  const explorer = new oc.TopExp_Explorer(
    shape.wrapped,
    oc.TopAbs_ShapeEnum[kind === 'FACE' ? 'TopAbs_FACE' : 'TopAbs_EDGE'],
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  )
  const buckets = new Map<number, Array<{ delete(): void; IsSame(o: unknown): boolean }>>()
  const hashes: number[] = []
  try {
    while (explorer.More()) {
      const item = explorer.Current()
      const h = oc.ReplicadShapeHasher.HashCode(item, HASH_CODE_MAX)
      const bucket = buckets.get(h)
      if (!bucket) {
        buckets.set(h, [item])
        hashes.push(h)
      } else if (bucket.some((o) => o.IsSame(item))) {
        item.delete()
      } else {
        bucket.push(item)
        hashes.push(h)
      }
      explorer.Next()
    }
  } finally {
    explorer.delete()
    for (const b of buckets.values()) for (const o of b) o.delete()
  }
  return hashes
}

/** The names of a freshly named shape as an order-based list, ready to store. Undefined when they cannot be listed. */
export function captureNames(
  shape: AnyShape,
  names: { faceNames: Map<number, string>; edgeNames: Map<number, string> },
  featureId: string,
): CachedNames | undefined {
  try {
    const strip = (n: string | undefined) => (n === undefined ? undefined : n.split(featureId).join(ID_MARK))
    const faces = enumerateHashes(shape, 'FACE').map((h) => strip(names.faceNames.get(h)))
    const edges = enumerateHashes(shape, 'EDGE').map((h) => strip(names.edgeNames.get(h)))
    if (faces.length !== names.faceNames.size || edges.length !== names.edgeNames.size) return undefined
    if (faces.some((n) => n === undefined) || edges.some((n) => n === undefined)) return undefined
    return { faces: faces as string[], edges: edges as string[] }
  } catch {
    return undefined
  }
}

/** Face and edge names of a restored shape from stored names; null when they do not line up with the shape. */
export function applyCachedNames(
  shape: AnyShape,
  cached: CachedNames,
  featureId: string,
): { faceNames: Map<number, string>; edgeNames: Map<number, string> } | null {
  try {
    const fh = enumerateHashes(shape, 'FACE')
    const eh = enumerateHashes(shape, 'EDGE')
    if (fh.length !== cached.faces.length || eh.length !== cached.edges.length) return null
    const faceNames = new Map<number, string>()
    const edgeNames = new Map<number, string>()
    fh.forEach((h, i) => faceNames.set(h, cached.faces[i].split(ID_MARK).join(featureId)))
    eh.forEach((h, i) => edgeNames.set(h, cached.edges[i].split(ID_MARK).join(featureId)))
    return faceNames.size === fh.length && edgeNames.size === eh.length ? { faceNames, edgeNames } : null
  } catch {
    return null
  }
}

// ---------- memory + persistent layers ----------

function touchMemory(key: string, entry: MemoryEntry): void {
  memory.delete(key)
  memory.set(key, entry)
}

function trimMemory(): void {
  let total = 0
  for (const b of memory.values()) total += b.brep.byteLength
  for (const k of [...memory.keys()]) {
    if (total <= limits.maxTotalBytes) break
    total -= memory.get(k)!.brep.byteLength
    memory.delete(k)
  }
}

/** A cached unified shape for this key, or null (then convert). An unreadable entry is dropped everywhere. */
export function restoreCachedShape(key: string): { shape: AnyShape; names?: CachedNames } | null {
  const entry = memory.get(key)
  if (!entry) return null
  const shape = deserializeShape(entry.brep)
  if (shape) {
    touchMemory(key, entry)
    meshCacheStats.memoryHits++
    return { shape, names: entry.names }
  }
  memory.delete(key)
  const s = persistent()
  if (s) pending.push(s.delete(key).catch(() => undefined))
  return null
}

/** Remembers a freshly converted unified shape, in memory and (in the background) in the persistent store. */
export function storeConvertedShape(key: string, shape: AnyShape, names?: CachedNames): void {
  const bytes = serializeShape(shape)
  if (!bytes || bytes.byteLength > limits.maxEntryBytes) return
  touchMemory(key, { brep: bytes, names })
  trimMemory()
  const s = persistent()
  if (!s) return
  const now = Date.now()
  const entry: MeshCacheEntry = { key, brep: bytes, names, bytes: bytes.byteLength, createdAt: now, lastUsed: now }
  pending.push(
    s
      .put(entry)
      .then(() => evict(s, key))
      .catch(() => undefined),
  )
}

async function evict(s: MeshCacheStore, keep: string): Promise<void> {
  const all = await s.list()
  let total = all.reduce((n, e) => n + e.bytes, 0)
  const oldest = all.filter((e) => e.key !== keep).sort((a, b) => a.lastUsed - b.lastUsed)
  for (const e of oldest) {
    if (total <= limits.maxTotalBytes) break
    await s.delete(e.key)
    total -= e.bytes
  }
}

/** Reads the persistent entries of the mesh imports in a document into memory, before a (synchronous) regenerate. */
export async function prefetchMeshCache(doc: ProjectDocument): Promise<void> {
  try {
    const s = persistent()
    if (!s) return
    for (const f of doc.features) {
      if (f.type !== 'import' || f.suppressed || f.params.format === 'step') continue
      const key = meshCacheKey(f.params.content)
      if (memory.has(key)) continue
      try {
        const e = await s.get(key)
        if (e && e.brep instanceof Uint8Array && e.brep.byteLength > 0) {
          touchMemory(key, { brep: e.brep, names: e.names })
          trimMemory()
        } else if (e) {
          await s.delete(key)
        }
      } catch {
        /* a failing store just means converting */
      }
    }
  } catch {
    /* never fail a regenerate because of the cache */
  }
}

// ---------- IndexedDB store ----------

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Persistent store in its own IndexedDB database, using the plain API (works from a worker). */
export function createIdbMeshStore(factory: IDBFactory): MeshCacheStore {
  let opened: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    if (!opened) {
      opened = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(MESH_CACHE_DB, 1)
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
        req.onsuccess = () => {
          const db = req.result
          // Lets "Delete all local data" remove the database while this worker is running.
          db.onversionchange = () => {
            db.close()
            opened = null
          }
          resolve(db)
        }
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('blocked'))
      })
      opened.catch(() => {
        opened = null
      })
    }
    return opened
  }
  return {
    async get(key) {
      const db = await open()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const os = tx.objectStore(STORE_NAME)
      const entry = (await wrap(os.get(key))) as MeshCacheEntry | undefined
      if (entry) {
        entry.lastUsed = Date.now()
        os.put(entry)
      }
      return entry
    },
    async put(entry) {
      const db = await open()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(entry)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('aborted'))
      })
    },
    async delete(key) {
      const db = await open()
      await wrap(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key))
    },
    async list() {
      const db = await open()
      const all = (await wrap(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll())) as MeshCacheEntry[]
      return all.map((e) => ({ key: e.key, bytes: e.bytes, lastUsed: e.lastUsed }))
    },
  }
}
