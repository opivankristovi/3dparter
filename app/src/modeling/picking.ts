// What a click in the viewport (or on a solid in Items) does, depending on the open tool.
import { useProjectStore } from '../doc/store'
import type { Ref } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import { bodyOfFace, defaultTargets, refsOfKind, sameRef, toggleRef, toggleTarget } from './logic'

/** Solids an Extrude or Revolve card in Join, Cut or Intersect mode can work on. */
export function extrudeTargetPool(ownId: string): Ref[] {
  const { doc } = useProjectStore.getState()
  return defaultTargets(useToolStore.getState().liveBodies, ownId, doc.bodies)
}

export function handlePick(ref: Ref | null, additive: boolean, meshes?: Map<string, { faces: { name: string }[] }>) {
  const s = useProjectStore.getState()
  const tools = useToolStore.getState()
  const tool = s.activeTool

  // Fillet and Chamfer: only edges count, and each click toggles one.
  if (tool === 'fillet' || tool === 'chamfer') {
    if (ref?.kind === 'edge') s.setSelection(toggleRef(refsOfKind(s.selection, 'edge'), ref))
    return
  }
  // Combine: solids toggle in and out; the first one is the target.
  if (tool === 'combine') {
    if (ref?.kind === 'body') s.setSelection(toggleRef(refsOfKind(s.selection, 'body'), ref))
    return
  }
  // Move: solids (or faces resolved to their solid) toggle in and out.
  if (tool === 'move') {
    if (ref?.kind === 'body') s.setSelection(toggleRef(refsOfKind(s.selection, 'body'), ref))
    else if (ref?.kind === 'face') {
      const bodyId = bodyOfFace(ref.name, meshes)
      if (bodyId) s.setSelection(toggleRef(refsOfKind(s.selection, 'body'), { kind: 'body', name: bodyId }))
    }
    return
  }
  // Shell: clicking a face toggles that face to open (keeping faces on the same solid); clicking a solid picks the solid.
  if (tool === 'shell') {
    if (ref?.kind === 'face') {
      const faceBody = bodyOfFace(ref.name, meshes)
      const current = refsOfKind(s.selection, 'face')
      const sameSolid = current.length === 0 || bodyOfFace(current[0].name, meshes) === faceBody
      s.setSelection(sameSolid ? toggleRef(current, ref) : [ref])
    } else if (ref?.kind === 'body') {
      s.setSelection([ref])
    }
    return
  }
  // Construction plane: clicking a plane or flat face picks the base.
  if (tool === 'plane') {
    if (ref && (ref.kind === 'originPlane' || ref.kind === 'constructionPlane' || ref.kind === 'face')) {
      s.setSelection([ref])
    }
    return
  }
  // Extrude that joins, cuts or intersects: a click on a solid picks which solids it works on.
  const d = tools.draft
  if (tool === 'extrude' && d?.type === 'extrude' && d.params.mode !== 'new') {
    const bodyRef =
      ref?.kind === 'body' ? ref : ref?.kind === 'face' ? { kind: 'body' as const, name: bodyOfFace(ref.name, meshes) } : null
    if (bodyRef && bodyRef.name) {
      const targets = toggleTarget(d.params.targets, extrudeTargetPool(d.id), bodyRef)
      tools.setDraft({ ...d, params: { ...d.params, targets } }, tools.draftReplaces)
      return
    }
  }
  // Revolve: axis refs set the axis; solids in non-new mode toggle targets; regions pick profiles.
  if (tool === 'revolve' && d?.type === 'revolve') {
    if (ref?.kind === 'sketchEdge' || ref?.kind === 'originAxis') {
      tools.setDraft({ ...d, params: { ...d.params, axis: ref } }, tools.draftReplaces)
      return
    }
    if (d.params.mode !== 'new') {
      const bodyRef =
        ref?.kind === 'body' ? ref : ref?.kind === 'face' ? { kind: 'body' as const, name: bodyOfFace(ref.name, meshes) } : null
      if (bodyRef && bodyRef.name) {
        const targets = toggleTarget(d.params.targets, extrudeTargetPool(d.id), bodyRef)
        tools.setDraft({ ...d, params: { ...d.params, targets } }, tools.draftReplaces)
        return
      }
    }
  }

  if (!ref) {
    if (!additive) s.setSelection([])
    return
  }
  if (additive) {
    const has = s.selection.some((r) => sameRef(r, ref))
    s.setSelection(has ? s.selection.filter((r) => !sameRef(r, ref)) : [...s.selection, ref])
  } else s.setSelection([ref])
}
