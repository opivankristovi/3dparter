// The working screen: owns the kernel connection, the 3D viewport and the sketch / extrude tools,
// and hands them to the layout-only <Workspace>.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Scan } from 'lucide-react'
import { saveThumbnail } from '../../data/projects'
import { useProjectStore } from '../../doc/store'
import type { OriginPlaneName, Ref } from '../../doc/types'
import { ORIGIN_PLANE_LABELS } from '../../doc/types'
import { cancelExtrude, useExtrudeTool } from '../../extrude/ExtrudeTool'
import { getKernel } from '../../kernel/client'
import { SketchLayer } from '../../sketch/SketchLayer'
import { endSketch, finishSketch, startSketchOn } from '../../sketch/session'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { ProgressIndicator } from '../../ui/ProgressIndicator'
import { installTestHook } from '../../testing/hook'
import { ViewportEngine } from '../../viewport/engine'
import { Viewport } from '../../viewport/Viewport'
import type { ExportOptions } from '../dialogs/ExportDialog'
import { Workspace } from '../Workspace'
import { isTypingTarget } from './hooks'
import { useHistoryEdit } from './useHistoryEdit'
import { useKernel } from './useKernel'
import { useToolStore } from './toolStore'

const THUMBNAIL_DELAY_MS = 3000

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex h-7 items-center gap-2 rounded-pill border border-border bg-surface-raised px-3 text-sm shadow-panel"
    >
      {children}
    </span>
  )
}

function describe(refs: Ref[]): string {
  if (refs.length === 0) return ''
  if (refs.length > 1) return `${refs.length} items selected`
  const names: Record<Ref['kind'], string> = {
    body: 'Solid',
    face: 'Face',
    edge: 'Edge',
    vertex: 'Point',
    sketchRegion: 'Shape',
    sketchEdge: 'Sketch line',
    originPlane: 'Plane',
    originAxis: 'Axis',
  }
  return `${names[refs[0].kind]} selected`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function WorkspaceView() {
  const doc = useProjectStore((s) => s.doc)
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const activeSketchId = useToolStore((s) => s.activeSketchId)

  const kernel = useKernel(doc, draft, draftReplaces)
  const extrude = useExtrudeTool(kernel.regions, kernel.statuses, kernel.busy)
  useHistoryEdit()

  const [engine, setEngine] = useState<ViewportEngine | null>(null)

  // Dev-only test hook (no-op in production builds).
  const engineReady = useRef(false)
  engineReady.current = kernel.engine === 'ready'
  useEffect(() => (engine ? installTestHook(engine, () => engineReady.current) : undefined), [engine])

  const sketching = activeSketchId !== null
  const sketchTool = activeTool?.startsWith('sketch.') ?? false
  const noBodies = Object.keys(doc.bodies).length === 0
  const planesVisible = !sketching && (noBodies || (sketchTool && !sketching))

  // ---- tool wiring ----------------------------------------------------------------------------------

  // A sketch tool with a plane selected opens a sketch on that plane.
  useEffect(() => {
    if (!sketchTool || sketching) return
    const plane = selection.find((r) => r.kind === 'originPlane')
    if (plane) startSketchOn(plane.name as OriginPlaneName)
  }, [sketchTool, sketching, selection])

  // Choosing a solid tool while sketching ends the sketch (the tool stays).
  useEffect(() => {
    if (sketching && activeTool && !sketchTool) endSketch()
  }, [sketching, activeTool, sketchTool])

  // ---- viewport sync --------------------------------------------------------------------------------

  useEffect(() => {
    if (!engine) return
    engine.onPick = (ref, additive) => {
      const s = useProjectStore.getState()
      if (!ref) {
        if (!additive) s.setSelection([])
        return
      }
      if (additive) {
        const has = s.selection.some((r) => r.kind === ref.kind && r.name === ref.name)
        s.setSelection(has ? s.selection.filter((r) => !(r.kind === ref.kind && r.name === ref.name)) : [...s.selection, ref])
      } else s.setSelection([ref])
    }
  }, [engine])

  useEffect(() => {
    engine?.setBodies(kernel.meshes, doc.bodies)
  }, [engine, kernel.meshes, doc.bodies])

  const regionList = useMemo(() => {
    if (activeTool === 'extrude') return Object.values(kernel.regions).flat()
    if (activeSketchId) return kernel.regions[activeSketchId] ?? []
    return []
  }, [activeTool, activeSketchId, kernel.regions])

  useEffect(() => {
    engine?.setRegions(regionList)
  }, [engine, regionList])

  useEffect(() => {
    if (!engine) return
    engine.setPlanesVisible(planesVisible)
    engine.setPickMode({ bodies: !sketching, planes: planesVisible, regions: activeTool === 'extrude' }, !sketching)
  }, [engine, planesVisible, sketching, activeTool])

  useEffect(() => {
    if (!engine) return
    const refs = [...selection]
    for (const p of extrude.profiles) if (!refs.some((r) => r.name === p.name)) refs.push(p)
    engine.setSelection(refs)
  }, [engine, selection, extrude.profiles])

  // ---- zoom to fit ----------------------------------------------------------------------------------

  const fit = useCallback(async () => {
    if (!engine) return
    try {
      engine.zoomToFit(await getKernel().bounds())
    } catch {
      /* The engine is not ready; there is nothing to frame. */
    }
  }, [engine])

  // Reopening a project frames its solids once.
  const framed = useRef(false)
  useEffect(() => {
    if (engine && !framed.current && kernel.meshes.size > 0) {
      framed.current = true
      void fit()
    }
  }, [engine, kernel.meshes, fit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const s = useProjectStore.getState()
      if (e.key === 'Escape') {
        if (useToolStore.getState().draft) {
          cancelExtrude()
          s.setActiveTool(null)
        } else if (s.selection.length > 0) s.setSelection([])
        else if (s.activeTool) s.setActiveTool(null)
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        void fit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fit])

  // ---- thumbnail ------------------------------------------------------------------------------------

  useEffect(() => {
    if (!engine || kernel.settled === 0) return
    const t = setTimeout(() => {
      const { projectId } = useProjectStore.getState()
      if (!projectId || useToolStore.getState().draft || kernel.meshes.size === 0) return
      void engine
        .snapshot(320, 240)
        .then((blob) => (blob ? saveThumbnail(projectId, blob) : undefined))
        .catch(() => {})
    }, THUMBNAIL_DELAY_MS)
    return () => clearTimeout(t)
    // Only a finished regenerate restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, kernel.settled])

  // ---- export ---------------------------------------------------------------------------------------

  const onExport = useCallback(
    async (opts: ExportOptions) => {
      if (useToolStore.getState().draft) throw new Error('Apply or cancel the open tool first.')
      const s = useProjectStore.getState()
      const ids = Object.entries(s.doc.bodies)
        .filter(([, b]) => b.visible)
        .map(([id]) => id)
      if (ids.length === 0) throw new Error('There is nothing visible to export.')
      const high = opts.quality === 'high'
      const buffer = await getKernel().exportFile('stl', ids, {
        tolerance: high ? 0.01 : 0.1,
        angularTolerance: high ? 0.1 : 0.5,
        binary: opts.binary,
      })
      if (buffer.byteLength === 0) throw new Error('The export came out empty. Try again.')
      const safe = s.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'model'
      downloadBlob(new Blob([buffer], { type: 'model/stl' }), `${safe}.stl`)
    },
    [],
  )

  // ---- status ---------------------------------------------------------------------------------------

  const sketchFeature = activeSketchId ? doc.features.find((f) => f.id === activeSketchId) : undefined
  const planeLabel =
    sketchFeature?.type === 'sketch' ? (ORIGIN_PLANE_LABELS[sketchFeature.params.on.name as OriginPlaneName] ?? 'a plane') : 'a plane'

  let hint: ReactNode = null
  if (kernel.engine === 'loading') {
    hint = (
      <Chip>
        Loading geometry engine…
        <ProgressIndicator label="Loading geometry engine" className="w-20 rounded-pill" />
      </Chip>
    )
  } else if (sketching) {
    hint = <Chip>Sketching on {planeLabel} · R rectangle · C circle · L line · Esc to finish</Chip>
  } else if (sketchTool) {
    hint = <Chip>Pick a plane to sketch on</Chip>
  } else if (extrude.picking) {
    hint = <Chip>Pick a shape to extrude</Chip>
  }

  const status = (
    <>
      {kernel.engine === 'error' ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised py-2 pr-2 pl-4 text-base shadow-panel"
        >
          The geometry engine failed to load.
          <Button size="sm" variant="primary" onClick={kernel.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {sketching ? (
        <Button variant="primary" onClick={finishSketch}>
          Finish sketch
        </Button>
      ) : null}
      {hint}
    </>
  )

  return (
    <Workspace
      viewport={
        <Viewport onEngine={setEngine}>
          {engine ? <SketchLayer engine={engine} /> : null}
          <div className="sr-only" aria-live="polite">
            {describe(selection)}
          </div>
        </Viewport>
      }
      overlay={extrude.card}
      statuses={kernel.statuses}
      status={status}
      busy={kernel.busy}
      topBarActions={
        <IconButton label="Zoom to fit" shortcut="F" icon={<Scan size={20} strokeWidth={1.75} />} onClick={() => void fit()} />
      }
      onExport={onExport}
    />
  )
}
