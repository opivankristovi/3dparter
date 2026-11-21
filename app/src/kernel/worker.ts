// Web Worker entry: exposes the KernelApi through Comlink. All OpenCascade objects live here.
import * as Comlink from 'comlink'
import type { ProjectDocument, Ref } from '../doc/types'
import type { ExportFormat, ExportOptions, KernelApi, MeshData } from './api'
import { exportBodies } from './export'
import { meshBody, sketchRegionData } from './mesh'
import { KERNEL_VERSION } from './occ'
import { loadOCBrowser } from './occ.browser'
import { Regenerator } from './regenerate'

const kernel = new Regenerator()
let ready: Promise<{ version: string; ms: number }> | null = null

function init(): Promise<{ version: string; ms: number }> {
  if (!ready) {
    const t0 = performance.now()
    const p = loadOCBrowser().then(() => ({ version: KERNEL_VERSION, ms: performance.now() - t0 }))
    p.catch(() => {
      ready = null // let the next call retry
    })
    ready = p
  }
  return ready
}

function meshTransfers(m: MeshData): Transferable[] {
  return [m.positions.buffer, m.normals.buffer, m.indices.buffer, ...m.edges.map((e) => e.points.buffer)]
}

const api: KernelApi = {
  init,

  async regenerate(doc: ProjectDocument, generation: number) {
    await init()
    return kernel.regenerate(doc, generation)
  },

  async getMesh(bodyId: string, quality: 'preview' | 'high') {
    await init()
    const body = kernel.getBody(bodyId)
    if (!body) throw new Error('This body no longer exists.')
    const mesh = meshBody(body, quality)
    return Comlink.transfer(mesh, meshTransfers(mesh))
  },

  async sketchRegions(sketchFeatureId: string) {
    await init()
    const sk = kernel.getSketch(sketchFeatureId)
    if (!sk) return []
    const data = sketchRegionData(sk)
    const buffers: Transferable[] = data.flatMap((r) => [
      ...r.loops.map((l) => l.buffer),
      r.fill.positions.buffer,
      r.fill.indices.buffer,
    ])
    return Comlink.transfer(data, buffers)
  },

  async sketchFrame(sketchFeatureId: string) {
    await init()
    return kernel.sketchFrame(sketchFeatureId)
  },

  async planeFrame(ref: Ref) {
    await init()
    return kernel.planeFrame(ref)
  },

  async constructionPlanes() {
    await init()
    return kernel.constructionPlanes()
  },

  async bounds() {
    await init()
    const bodies = kernel.visibleBodies()
    if (bodies.length === 0) return null
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const b of bodies) {
      const bb = b.built.shape.boundingBox
      const [lo, hi] = bb.bounds
      bb.delete()
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], lo[i])
        max[i] = Math.max(max[i], hi[i])
      }
    }
    return { min, max }
  },

  async measure(refs: Ref[]) {
    await init()
    return kernel.measure(refs)
  },

  async exportFile(format: ExportFormat, bodyIds: string[], opts: ExportOptions) {
    await init()
    const bodies = bodyIds.flatMap((id) => {
      const b = kernel.getBody(id)
      return b ? [b] : []
    })
    const buffer = await exportBodies(format, bodies, opts)
    return Comlink.transfer(buffer, [buffer])
  },

  async dispose() {
    kernel.dispose()
  },
}

Comlink.expose(api)
