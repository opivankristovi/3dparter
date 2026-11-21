// The mesh cache: a mesh converted once is restored from memory or IndexedDB instead of being sewn again.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ImportFeature } from '../doc/types'
import { assignNames } from './build'
import { bytesToBase64 } from './meshFile'
import {
  applyCachedNames,
  captureNames,
  clearMeshCacheMemory,
  deserializeShape,
  serializeShape,
  configureMeshCache,
  createIdbMeshStore,
  flushMeshCache,
  meshCacheKey,
  meshCacheStats,
  prefetchMeshCache,
  sha256Hex,
  type MeshCacheStore,
} from './meshCache'
import { binaryStl, boxTriangles, prismTriangles } from './meshTestutil'
import { convertMeshToShape } from './m5Ops'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { docOf, edgeRef, filletFeature, ready } from './testutil'

beforeAll(async () => {
  await ready()
})

afterEach(() => configureMeshCache({ store: null }))

const importFeature = (tris: number[][][], id = 'imp'): ImportFeature => ({
  id,
  name: 'Part',
  suppressed: false,
  type: 'import',
  params: { filename: 'part.stl', format: 'stl', content: bytesToBase64(binaryStl(tris as never)) },
})

function snapshot(k: Regenerator, id: string) {
  const b = k.getBody(id)!
  const shape = b.built.shape
  const m = meshBody(b, 'preview')
  return {
    solids: shape.solids.length,
    faces: shape.faces.length,
    faceNames: [...b.built.faceNames.values()].sort(),
    edgeNames: [...b.built.edgeNames.values()].sort(),
    meshFaces: m.faces.map((f) => f.name).sort(),
    meshEdges: m.edges.map((e) => e.name).sort(),
    volume: m.indices.length,
  }
}

function run(feature: ImportFeature) {
  const k = new Regenerator()
  const r = k.regenerate(docOf(feature), 1)
  expect(r.statuses.every((s) => s.ok)).toBe(true)
  const snap = snapshot(k, feature.id)
  k.dispose()
  return snap
}

describe('mesh cache', () => {
  it('hashes like SHA-256', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    // Multi-block input (NIST test vector: one million 'a').
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
    expect(meshCacheKey('abc')).toContain('replicad')
  })

  it('does not convert the same content twice and yields identical names', () => {
    configureMeshCache({ store: null })
    const feature = importFeature(prismTriangles(24, 10, 20))
    const first = run(feature)
    expect(meshCacheStats.conversions).toBe(1)
    const second = run(feature)
    expect(meshCacheStats.conversions).toBe(1)
    expect(meshCacheStats.memoryHits).toBe(1)
    expect(second).toEqual(first)
    expect(first.faces).toBe(26)
    expect(first.faceNames.length).toBeGreaterThan(0)
  })

  it('cached names on a restored shape equal naming it from scratch', () => {
    configureMeshCache({ store: null })
    for (const tris of [boxTriangles(10, 12, 14), prismTriangles(40, 10, 20)]) {
      const shape = convertMeshToShape(bytesToBase64(binaryStl(tris as never)))
      const fresh = assignNames(shape, new Map(), 'imp')
      const cached = captureNames(shape, fresh, 'imp')!
      const restored = deserializeShape(serializeShape(shape)!)!
      const viaCache = applyCachedNames(restored, cached, 'other')!
      const scratch = assignNames(restored, new Map(), 'other')
      expect([...viaCache.faceNames]).toEqual([...scratch.faceNames])
      expect([...viaCache.edgeNames].sort()).toEqual([...scratch.edgeNames].sort())
    }
  })

  it('restores from the persistent store in a new session, with the same names', async () => {
    const store = createIdbMeshStore(new IDBFactory())
    configureMeshCache({ store })
    const feature = importFeature(boxTriangles(10, 12, 14))
    const first = run(feature)
    await flushMeshCache()
    expect((await store.list()).length).toBe(1)

    clearMeshCacheMemory() // a fresh worker
    await prefetchMeshCache(docOf(feature))
    const second = run(feature)
    expect(meshCacheStats.conversions).toBe(1)
    expect(second).toEqual(first)
  })

  it('still regenerates a fillet that references an edge of a cached shape', () => {
    configureMeshCache({ store: null })
    const feature = importFeature(boxTriangles(10, 10, 10))
    const k1 = new Regenerator()
    k1.regenerate(docOf(feature), 1)
    const edges = meshBody(k1.getBody('imp')!, 'preview').edges.map((e) => e.name)
    k1.dispose()

    const k2 = new Regenerator()
    k2.regenerate(docOf(feature), 1)
    expect(meshCacheStats.conversions).toBe(1) // second open came from the cache
    const r = k2.regenerate(docOf(feature, filletFeature('f1', [edgeRef(edges[0])], '1')), 2)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const m = meshBody(k2.getBody('imp')!, 'preview')
    expect(m.faces.length).toBeGreaterThan(6)
    k2.dispose()
  })

  it('deletes a corrupt persistent entry, converts again and replaces it', async () => {
    const store = createIdbMeshStore(new IDBFactory())
    configureMeshCache({ store })
    const feature = importFeature(boxTriangles(8, 9, 10))
    const first = run(feature)
    await flushMeshCache()
    const [{ key }] = await store.list()

    const junk = new Uint8Array(64).fill(7)
    await store.put({ key, brep: junk, bytes: junk.byteLength, createdAt: 1, lastUsed: 1 })
    clearMeshCacheMemory()
    await prefetchMeshCache(docOf(feature))
    const second = run(feature)
    await flushMeshCache()
    expect(meshCacheStats.conversions).toBe(2)
    expect(second).toEqual(first)
    const entry = await store.get(key)
    expect(entry).toBeDefined()
    expect(entry!.bytes).toBeGreaterThan(junk.byteLength)

    clearMeshCacheMemory()
    await prefetchMeshCache(docOf(feature))
    run(feature)
    expect(meshCacheStats.conversions).toBe(2) // the replacement is good
  })

  it('never fails an import when the persistent store throws', async () => {
    const broken: MeshCacheStore = {
      get: () => Promise.reject(new Error('quota')),
      put: () => Promise.reject(new Error('quota')),
      delete: () => Promise.reject(new Error('quota')),
      list: () => Promise.reject(new Error('quota')),
    }
    configureMeshCache({ store: broken })
    const feature = importFeature(boxTriangles(5, 6, 7))
    await prefetchMeshCache(docOf(feature))
    run(feature)
    await flushMeshCache()
    expect(meshCacheStats.conversions).toBe(1)
  })

  it('evicts least recently used entries to stay under the total cap, and skips oversized results', async () => {
    const store = createIdbMeshStore(new IDBFactory())
    configureMeshCache({ store })
    const a = importFeature(boxTriangles(10, 10, 10), 'a')
    run(a)
    await flushMeshCache()
    const size = (await store.list())[0].bytes

    configureMeshCache({ store, limits: { maxTotalBytes: Math.floor(size * 2.5) } })
    const sizes = [11, 12, 13, 14]
    for (const s of sizes) {
      run(importFeature(boxTriangles(s, 10, 10), 'x'))
      await flushMeshCache()
      await new Promise((r) => setTimeout(r, 3)) // distinct lastUsed
    }
    const left = await store.list()
    const total = left.reduce((n, e) => n + e.bytes, 0)
    expect(total).toBeLessThanOrEqual(Math.floor(size * 2.5))
    expect(left.length).toBe(2)

    configureMeshCache({ store: createIdbMeshStore(new IDBFactory()), limits: { maxEntryBytes: 10 } })
    run(importFeature(boxTriangles(3, 3, 3), 'tiny'))
    run(importFeature(boxTriangles(3, 3, 3), 'tiny'))
    expect(meshCacheStats.conversions).toBe(2) // too big to cache, so converted both times
  })

  it('is much faster from the cache for a 20,000-triangle prism (timing)', () => {
    configureMeshCache({ store: null })
    const feature = importFeature(prismTriangles(5000, 10, 20))
    const regen = () => {
      const k = new Regenerator()
      const t = performance.now()
      const r = k.regenerate(docOf(feature), 1)
      const ms = performance.now() - t
      expect(r.statuses.every((x) => x.ok)).toBe(true)
      const snap = snapshot(k, 'imp')
      k.dispose()
      return { ms, snap }
    }
    const { ms: firstMs, snap: first } = regen()
    const { ms: cachedMs, snap: second } = regen()
    console.log(`20,000-triangle import: first ${Math.round(firstMs)} ms, cached ${Math.round(cachedMs)} ms`)
    expect(meshCacheStats.conversions).toBe(1)
    expect(second).toEqual(first)
    expect(cachedMs).toBeLessThan(firstMs)
  }, 120_000)
})
