// The Shell tool: hollows a solid inwards to a wall thickness, optionally opening picked faces.
import { useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { BodyAppearance, DisplayUnit, Ref, ShellFeature } from '../doc/types'
import { applyDraft, cancelDraft, changeDraft, useLengthInput } from './draft'
import { bodyOfFace, countLabel, refsOfKind, sameRef, sameRefSet } from './logic'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { ShellIcon } from '../ui/ModelIcons'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'

export interface ShellToolResult {
  card: ReactNode
}

export function useShellTool(kernel: KernelState): ShellToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const liveBodies = useToolStore((s) => s.liveBodies)
  const shell = draft?.type === 'shell' ? draft : null

  // Tool turned on with no draft: read faces/body from selection, or auto-pick the sole visible solid.
  useEffect(() => {
    if (activeTool !== 'shell' || draft) return
    const s = useProjectStore.getState()
    const faces = refsOfKind(s.selection, 'face')
    const pickedBody = refsOfKind(s.selection, 'body')[0]
    let body: Ref = { kind: 'body', name: '' }
    let removeFaces: Ref[] = []
    if (faces.length > 0) {
      const owner = bodyOfFace(faces[0].name, kernel.meshes)
      body = { kind: 'body', name: owner }
      removeFaces = faces
    } else if (pickedBody) {
      body = pickedBody
    } else {
      const visible = (liveBodies ?? []).filter((id) => s.doc.bodies[id]?.visible !== false)
      if (visible.length === 1) {
        body = { kind: 'body', name: visible[0] }
        s.setSelection([body])
      }
    }
    const f: ShellFeature = {
      id: newId(),
      type: 'shell',
      name: nextFeatureName(s.doc, 'shell'),
      suppressed: false,
      params: { body, removeFaces, thickness: '2' },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, kernel.meshes, liveBodies])

  useEffect(() => {
    if (shell && activeTool !== 'shell') cancelDraft()
  }, [shell, activeTool])

  // Keep draft body & open faces synced with viewport selection.
  useEffect(() => {
    if (!shell || activeTool !== 'shell') return
    const faces = refsOfKind(selection, 'face')
    const pickedBody = refsOfKind(selection, 'body')[0]
    const nextBody: Ref =
      faces.length > 0
        ? { kind: 'body', name: bodyOfFace(faces[0].name, kernel.meshes) }
        : pickedBody ?? { kind: 'body', name: '' }
    if (sameRef(nextBody, shell.params.body) && sameRefSet(faces, shell.params.removeFaces)) return
    changeDraft<ShellFeature>('shell', { body: nextBody, removeFaces: faces })
  }, [selection, shell, activeTool, kernel.meshes])

  useEffect(() => {
    if (draftReplaces && shell && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, shell, features])

  const change = useCallback((thickness: string) => changeDraft<ShellFeature>('shell', { thickness }), [])

  const apply = useCallback(() => {
    if (!kernel.isDraftCurrent()) return
    const done = applyDraft('Shell')
    if (done) useProjectStore.getState().setSelection([])
  }, [kernel])

  const status = shell ? kernel.statuses[shell.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = shell ? (
    <ShellCard
      key={shell.id}
      draft={shell}
      bodies={bodies}
      units={units}
      busy={kernel.busy}
      failure={status && !status.ok ? (status.message ?? 'This shape could not be hollowed.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onRemoveBody={() => useProjectStore.getState().setSelection([])}
      onClearFaces={() => useProjectStore.getState().setSelection(shell.params.body.name ? [shell.params.body] : [])}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card }
}

interface CardProps {
  draft: ShellFeature
  bodies: Record<string, BodyAppearance>
  units: DisplayUnit
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (thickness: string) => void
  onRemoveBody: () => void
  onClearFaces: () => void
  onApply: () => void
  onCancel: () => void
}

function ShellCard({
  draft,
  bodies,
  units,
  busy,
  failure,
  editingStep,
  onChange,
  onRemoveBody,
  onClearFaces,
  onApply,
  onCancel,
}: CardProps) {
  const p = draft.params
  const length = useLengthInput(p.thickness, units, onChange)
  const noBody = p.body.name === ''
  const bodyName = bodies[p.body.name]?.name ?? p.body.name

  return (
    <ParameterCard
      title="Shell"
      icon={<ShellIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={noBody ? { message: 'Pick a solid or face to hollow out.' } : failure ? { message: failure } : undefined}
      applyDisabled={busy || length.invalid || noBody || !!failure}
      onApply={length.guard(onApply)}
      onCancel={onCancel}
    >
      <ParameterRow label="Solid">
        {noBody ? (
          <p className="text-sm text-text-muted">Click a solid or face in the view.</p>
        ) : (
          <div className="flex">
            <RemovableChip label={bodyName} removeLabel={`Remove ${bodyName}`} onRemove={onRemoveBody} />
          </div>
        )}
      </ParameterRow>
      <ParameterRow label="Open faces">
        {p.removeFaces.length === 0 ? (
          <p className="text-sm text-text-muted">None (hollow closed solid). Click faces to open them.</p>
        ) : (
          <div className="flex">
            <RemovableChip
              label={countLabel(p.removeFaces.length, 'face')}
              removeLabel="Clear faces"
              onRemove={onClearFaces}
            />
          </div>
        )}
      </ParameterRow>
      <NumericInput label="Thickness" {...length.field} />
    </ParameterCard>
  )
}
