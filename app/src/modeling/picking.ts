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
  if (tool === 'move' || tool === 'scale') {
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
  // Sweep: edge/sketchEdge sets path, sketchRegion sets profile, solids in non-new mode toggle targets.
  if (tool === 'sweep' && d?.type === 'sweep') {
    if (ref?.kind === 'edge' || ref?.kind === 'sketchEdge') {
      tools.setDraft({ ...d, params: { ...d.params, path: ref } }, tools.draftReplaces)
      return
    }
    if (ref?.kind === 'sketchRegion') {
      tools.setDraft({ ...d, params: { ...d.params, profile: ref } }, tools.draftReplaces)
      s.setSelection([ref])
      return
    }
    if (d.params.mode !== 'new') {
      const bodyRef =
        ref?.kind === 'body' ? ref : ref?.kind === 'face' ? { kind: 'body' as const, name: bodyOfFace(ref.name, meshes) } : null
      if (bodyRef && bodyRef.name) {
        const targets = toggleTarget(d.params.targets, extrudeTargetPool(d.id), bodyRef)
        tools.setDraft({ ...d, params: { ...d.params, targets } }, tools.draftReplaces)
      }
    }
    return
  }
  // Loft: sketchRegions toggle in profiles (across any sketches); solids in non-new mode toggle targets.
  if (tool === 'loft' && d?.type === 'loft') {
    if (ref?.kind === 'sketchRegion') {
      const profiles = toggleRef(d.params.profiles, ref)
      tools.setDraft({ ...d, params: { ...d.params, profiles } }, tools.draftReplaces)
      s.setSelection(profiles)
      return
    }
    if (d.params.mode !== 'new') {
      const bodyRef =
        ref?.kind === 'body' ? ref : ref?.kind === 'face' ? { kind: 'body' as const, name: bodyOfFace(ref.name, meshes) } : null
      if (bodyRef && bodyRef.name) {
        const targets = toggleTarget(d.params.targets, extrudeTargetPool(d.id), bodyRef)
        tools.setDraft({ ...d, params: { ...d.params, targets } }, tools.draftReplaces)
      }
    }
    return
  }
  // Split: body selects solid; plane/flat face selects splitting plane (or body first if none selected).
  if (tool === 'split' && d?.type === 'split') {
    if (ref?.kind === 'body') {
      tools.setDraft({ ...d, params: { ...d.params, body: ref } }, tools.draftReplaces)
    } else if (ref?.kind === 'originPlane' || ref?.kind === 'constructionPlane') {
      tools.setDraft({ ...d, params: { ...d.params, plane: ref } }, tools.draftReplaces)
    } else if (ref?.kind === 'face') {
      if (!d.params.body.name) {
        const id = bodyOfFace(ref.name, meshes)
        if (id) tools.setDraft({ ...d, params: { ...d.params, body: { kind: 'body', name: id } } }, tools.draftReplaces)
      } else {
        tools.setDraft({ ...d, params: { ...d.params, plane: ref } }, tools.draftReplaces)
      }
    }
    return
  }
  // Mirror: bodies toggle in; origin/construction plane or face sets plane (or body first if none selected).
  if (tool === 'mirror' && d?.type === 'mirror') {
    if (ref?.kind === 'body') {
      tools.setDraft({ ...d, params: { ...d.params, bodies: toggleRef(d.params.bodies, ref) } }, tools.draftReplaces)
    } else if (ref?.kind === 'originPlane' || ref?.kind === 'constructionPlane') {
      tools.setDraft({ ...d, params: { ...d.params, plane: ref } }, tools.draftReplaces)
    } else if (ref?.kind === 'face') {
      if (d.params.bodies.length === 0) {
        const id = bodyOfFace(ref.name, meshes)
        if (id) tools.setDraft({ ...d, params: { ...d.params, bodies: [{ kind: 'body', name: id }] } }, tools.draftReplaces)
      } else {
        tools.setDraft({ ...d, params: { ...d.params, plane: ref } }, tools.draftReplaces)
      }
    }
    return
  }
  // Pattern: bodies toggle in; axis/edge/plane/face sets direction axis (or first body when none picked).
  if (tool === 'pattern' && d?.type === 'pattern') {
    if (ref?.kind === 'body') {
      tools.setDraft({ ...d, params: { ...d.params, bodies: toggleRef(d.params.bodies, ref) } }, tools.draftReplaces)
    } else if (ref?.kind === 'face') {
      if (d.params.bodies.length === 0) {
        const id = bodyOfFace(ref.name, meshes)
        if (id) tools.setDraft({ ...d, params: { ...d.params, bodies: [{ kind: 'body', name: id }] } }, tools.draftReplaces)
      } else {
        tools.setDraft({ ...d, params: { ...d.params, axis: ref } }, tools.draftReplaces)
      }
    } else if (
      ref &&
      (ref.kind === 'originAxis' ||
        ref.kind === 'edge' ||
        ref.kind === 'sketchEdge' ||
        ref.kind === 'originPlane' ||
        ref.kind === 'constructionPlane')
    ) {
      tools.setDraft({ ...d, params: { ...d.params, axis: ref } }, tools.draftReplaces)
    }
    return
  }

  // Measure: keep up to 2 picked items (clicking a third shifts the oldest out).
  if (tool === 'measure') {
    if (!ref) {
      if (!additive) s.setSelection([])
      return
    }
    if (s.selection.some((r) => sameRef(r, ref))) {
      s.setSelection(s.selection.filter((r) => !sameRef(r, ref)))
      return
    }
    if (s.selection.length < 2) {
      s.setSelection([...s.selection, ref])
      return
    }
    s.setSelection([s.selection[1], ref])
    return
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

/** Handles box (area) selection in the viewport, respecting the active tool. */
export function handleBoxPick(refs: Ref[], additive: boolean, meshes?: Map<string, { faces: { name: string }[] }>) {
  const s = useProjectStore.getState()
  const tool = s.activeTool

  let filtered = refs
  if (tool === 'fillet' || tool === 'chamfer') {
    filtered = refs.filter((r) => r.kind === 'edge')
  } else if (tool === 'combine' || tool === 'move' || tool === 'scale') {
    filtered = refs.filter((r) => r.kind === 'body')
  } else if (tool === 'mirror' || tool === 'pattern') {
    const tools = useToolStore.getState()
    const d = tools.draft
    const bodies = refs.filter((r) => r.kind === 'body')
    if (d?.type === 'mirror') {
      const next = additive
        ? [...d.params.bodies, ...bodies.filter((b) => !d.params.bodies.some((x) => sameRef(x, b)))]
        : bodies
      tools.setDraft({ ...d, params: { ...d.params, bodies: next } }, tools.draftReplaces)
    } else if (d?.type === 'pattern') {
      const next = additive
        ? [...d.params.bodies, ...bodies.filter((b) => !d.params.bodies.some((x) => sameRef(x, b)))]
        : bodies
      tools.setDraft({ ...d, params: { ...d.params, bodies: next } }, tools.draftReplaces)
    }
    return
  } else if (tool === 'shell') {
    const faces = refs.filter((r) => r.kind === 'face')
    if (faces.length > 0) {
      const solid = bodyOfFace(faces[0].name, meshes)
      filtered = faces.filter((f) => bodyOfFace(f.name, meshes) === solid)
    } else {
      filtered = []
    }
  } else if (tool === 'measure') {
    filtered = refs.slice(0, 2)
  }

  if (!additive) {
    s.setSelection(filtered)
    return
  }
  const next = [...s.selection]
  for (const r of filtered) {
    if (!next.some((x) => sameRef(x, r))) next.push(r)
  }
  s.setSelection(tool === 'measure' ? next.slice(-2) : next)
}
