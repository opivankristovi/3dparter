// Connects the open document to the kernel worker: engine loading, regeneration, meshes and sketch regions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ORIGIN_PLANES } from '../../doc/types'
import type { Feature, OriginPlaneName, PlaneFrame, ProjectDocument } from '../../doc/types'
import type { MeshData, SketchRegionData } from '../../kernel/api'
import { getKernel, restartKernel } from '../../kernel/client'
import { isPreviewable } from '../../modeling/logic'
import { useToolStore } from './toolStore'
import type { FeatureStatuses } from './SidebarTabs'

export type EngineState = 'loading' | 'ready' | 'error'

const DEBOUNCE_MS = 30

/** The document plus the draft: appended if new, swapped in place if it replaces an existing step. */
export function effectiveDocument(doc: ProjectDocument, draft: Feature | null, replaces: string | null): ProjectDocument {
  if (!draft || !isPreviewable(draft)) return doc
  const features =
    replaces && doc.features.some((f) => f.id === replaces)
      ? doc.features.map((f) => (f.id === replaces ? draft : f))
      : [...doc.features, draft]
  return { ...doc, features }
}

function sketchSignature(f: Feature, frame: PlaneFrame | null | undefined): string {
  return f.type === 'sketch' ? JSON.stringify([f.params, f.sketch, f.suppressed, frame ?? null]) : ''
}

export interface KernelState {
  engine: EngineState
  error: string | null
  retry(): void
  statuses: FeatureStatuses
  /** Preview meshes by body id. */
  meshes: Map<string, MeshData>
  /** Closed regions by sketch feature id. */
  regions: Record<string, SketchRegionData[]>
  /** Construction planes produced by plane features, in feature order. */
  planes: { name: string; frame: PlaneFrame }[]
  /** A regenerate is waiting or running. */
  busy: boolean
  /** Counts up after each regenerate that finished and applied. */
  settled: number
  /** Bodies that exist after the last regenerate (a body consumed by a Combine is not among them). */
  bodies: string[]
  /** True when the result on screen is for the draft as it is right now (not for an earlier edit of it). */
  isDraftCurrent(): boolean
}

export function useKernel(doc: ProjectDocument, draft: Feature | null, draftReplaces: string | null): KernelState {
  const [engine, setEngine] = useState<EngineState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [statuses, setStatuses] = useState<FeatureStatuses>({})
  const [meshes, setMeshes] = useState<Map<string, MeshData>>(() => new Map())
  const [regions, setRegions] = useState<Record<string, SketchRegionData[]>>({})
  const [planes, setPlanes] = useState<{ name: string; frame: PlaneFrame }[]>([])
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState(0)
  const [bodies, setBodies] = useState<string[]>([])
  /** The draft object the applied result was computed for. */
  const settledDraft = useRef<Feature | null>(null)

  const generation = useRef(0)
  /** Bodies the kernel reported as changed but whose mesh we have not applied yet (a result was dropped). */
  const pending = useRef(new Set<string>())
  const meshesRef = useRef(meshes)
  meshesRef.current = meshes
  const regionCache = useRef(new Map<string, { sig: string; data: SketchRegionData[] }>())

  // Load the engine; on unmount free the OpenCascade objects.
  useEffect(() => {
    let live = true
    setEngine('loading')
    setError(null)
    getKernel()
      .init()
      .then(() => live && setEngine('ready'))
      .catch((e: unknown) => {
        if (!live) return
        setError(e instanceof Error ? e.message : 'Unknown error')
        setEngine('error')
      })
    return () => {
      live = false
    }
  }, [attempt])

  useEffect(
    () => () => {
      void getKernel()
        .dispose()
        .catch(() => {})
    },
    [],
  )

  const retry = useCallback(() => {
    restartKernel()
    regionCache.current.clear()
    pending.current.clear()
    setAttempt((n) => n + 1)
  }, [])

  const effective = useMemo(() => effectiveDocument(doc, draft, draftReplaces), [doc, draft, draftReplaces])

  useEffect(() => {
    if (engine !== 'ready') return
    const mine = ++generation.current
    setBusy(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const kernel = getKernel()
        const res = await kernel.regenerate(effective, mine)
        for (const b of res.changedBodies) pending.current.add(b)
        if (cancelled || mine !== generation.current) return

        const alive = new Set(res.bodies)
        const want = res.bodies.filter((b) => pending.current.has(b) || !meshesRef.current.has(b))
        const fetched = await Promise.all(
          want.map((b) =>
            kernel
              .getMesh(b, 'preview')
              .then((m) => [b, m] as const)
              .catch(() => null),
          ),
        )
        if (cancelled || mine !== generation.current) return

        // Frames and regions for every active sketch.
        const nextFrames: Record<string, PlaneFrame> = {}
        const nextRegions: Record<string, SketchRegionData[]> = {}
        for (const f of effective.features) {
          if (f.type !== 'sketch' || f.suppressed) continue
          const frame =
            f.params.on.kind === 'originPlane'
              ? ORIGIN_PLANES[f.params.on.name as OriginPlaneName]
              : await kernel.sketchFrame(f.id).catch(() => null)
          if (cancelled || mine !== generation.current) return
          if (frame) nextFrames[f.id] = frame
          const sig = sketchSignature(f, frame)
          const cached = regionCache.current.get(f.id)
          if (cached && cached.sig === sig) {
            nextRegions[f.id] = cached.data
            continue
          }
          const data = await kernel.sketchRegions(f.id).catch(() => [])
          if (cancelled || mine !== generation.current) return
          regionCache.current.set(f.id, { sig, data })
          nextRegions[f.id] = data
        }

        const nextPlanes = effective.features.some((f) => f.type === 'plane' && !f.suppressed)
          ? await kernel.constructionPlanes().catch(() => [])
          : []
        if (cancelled || mine !== generation.current) return

        // Apply.
        const nextMeshes = new Map<string, MeshData>()
        for (const [id, m] of meshesRef.current) if (alive.has(id)) nextMeshes.set(id, m)
        for (const r of fetched) {
          if (!r) continue
          nextMeshes.set(r[0], r[1])
          pending.current.delete(r[0])
        }
        for (const id of [...pending.current]) if (!alive.has(id)) pending.current.delete(id)

        const st: FeatureStatuses = {}
        for (const s of res.statuses) st[s.featureId] = { ok: s.ok, message: s.message, warning: s.warning }
        settledDraft.current = draft && isPreviewable(draft) ? draft : null
        const toolState = useToolStore.getState()
        toolState.setSketchFrames(nextFrames)
        if (!draft || toolState.liveBodies === null) toolState.setLiveBodies(res.bodies)
        setPlanes(nextPlanes)
        setBodies(res.bodies)
        setMeshes(nextMeshes)
        setRegions(nextRegions)
        setStatuses(st)
        setBusy(false)
        setSettled((n) => n + 1)
      } catch (e) {
        if (cancelled || mine !== generation.current) return
        setBusy(false)
        setError(e instanceof Error ? e.message : 'Unknown error')
        setEngine('error')
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [effective, engine])

  const isDraftCurrent = useCallback(() => {
    const cur = useToolStore.getState().draft
    return cur !== null && isPreviewable(cur) && cur === settledDraft.current
  }, [])

  return { engine, error, retry, statuses, meshes, regions, planes, busy, settled, bodies, isDraftCurrent }
}
