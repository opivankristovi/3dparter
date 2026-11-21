// Pure rules shared by the modelling tools: which references a tool takes, how a click toggles them, and what the
// Join / Cut / Intersect words mean in the document. No React, no store: unit tested on their own.
import type { BodyAppearance, BooleanFeature, BooleanMode, Feature, Ref, Vec3 } from '../doc/types'

/** The words for the three ways of combining solids, the same in the Extrude and Combine cards. */
export const OP_WORDS = { union: 'Join', subtract: 'Cut', intersect: 'Intersect' } as const
export const MODE_WORDS: Record<BooleanMode, string> = { new: 'New', ...OP_WORDS }

export const sameRef = (a: Ref, b: Ref) => a.kind === b.kind && a.name === b.name

/** Adds `ref` to the list, or takes it out if it is already there. */
export function toggleRef(list: Ref[], ref: Ref): Ref[] {
  return list.some((r) => sameRef(r, ref)) ? list.filter((r) => !sameRef(r, ref)) : [...list, ref]
}

export const refsOfKind = (refs: Ref[], kind: Ref['kind']): Ref[] => refs.filter((r) => r.kind === kind)

/** Same references, in any order. */
export function sameRefSet(a: Ref[], b: Ref[]): boolean {
  return a.length === b.length && a.every((r) => b.some((x) => sameRef(r, x)))
}

/** "1 edge", "3 edges". */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The solids a Join, Cut or Intersect works on when none are picked: every visible solid that exists, except
 * the one the feature itself would make.
 */
export function defaultTargets(live: string[] | null, ownId: string, bodies: Record<string, BodyAppearance>): Ref[] {
  return (live ?? [])
    .filter((id) => id !== ownId && bodies[id]?.visible !== false)
    .map((id) => ({ kind: 'body', name: id }) as Ref)
}

/**
 * A click on a solid while the card shows "all solids" restricts the targets to that solid; later clicks add
 * or remove solids; taking the last one away goes back to all solids.
 */
export function toggleTarget(current: Ref[], all: Ref[], clicked: Ref): Ref[] {
  if (!all.some((r) => sameRef(r, clicked))) return current
  if (sameRefSet(current, all)) return [clicked]
  const next = toggleRef(current, clicked)
  return next.length === 0 ? all : next
}

/** The first solid picked is the target, the others are the tools. */
export function combineParts(selection: Ref[]): { target: Ref | null; tools: Ref[] } {
  const bodies = refsOfKind(selection, 'body')
  return { target: bodies[0] ?? null, tools: bodies.slice(1) }
}

export function newCombine(id: string, name: string, selection: Ref[]): BooleanFeature {
  const { target, tools } = combineParts(selection)
  return {
    id,
    type: 'boolean',
    name,
    suppressed: false,
    params: { op: 'union', target: target ?? { kind: 'body', name: '' }, tools, keepTools: false },
  }
}

/** The selection a Combine card shows: target first, then the tools. */
export function combineSelection(f: BooleanFeature): Ref[] {
  return f.params.target.name ? [f.params.target, ...f.params.tools] : [...f.params.tools]
}

/** Which live solid owns `faceName`. Searches meshes first because booleans and shells add prefixes. */
export function bodyOfFace(faceName: string, meshes?: Map<string, { faces: { name: string }[] }>): string {
  if (meshes) {
    for (const [id, mesh] of meshes) {
      if (mesh.faces.some((f) => f.name === faceName)) return id
    }
  }
  return faceName.split('/')[0] ?? ''
}

export const sketchOfRegion = (r: Ref): string => r.name.split('/region:')[0]

/** Regions of the first picked sketch only: extrude and revolve take shapes from one sketch. */
export function sameSketchRegions(refs: Ref[]): Ref[] {
  if (refs.length === 0) return refs
  const sk = sketchOfRegion(refs[0])
  return refs.filter((r) => sketchOfRegion(r) === sk)
}

/** Only a draft with everything it needs is sent to the kernel for a live preview. */
export function isPreviewable(f: Feature): boolean {
  switch (f.type) {
    case 'fillet':
    case 'chamfer':
      return f.params.edges.length > 0
    case 'boolean':
      return f.params.target.name !== '' && f.params.tools.length > 0
    case 'extrude':
      return f.params.profiles.length > 0 && (f.params.mode === 'new' || f.params.targets.length > 0)
    case 'revolve':
      return f.params.profiles.length > 0 && f.params.axis.name !== '' && (f.params.mode === 'new' || f.params.targets.length > 0)
    case 'sweep':
      return (
        f.params.profile.name !== '' &&
        f.params.path.name !== '' &&
        (f.params.mode === 'new' || f.params.targets.length > 0)
      )
    case 'loft':
      return f.params.profiles.length >= 2 && (f.params.mode === 'new' || f.params.targets.length > 0)
    case 'shell':
      return f.params.body.name !== ''
    case 'transform':
      return f.params.bodies.length > 0
    case 'split':
      return f.params.body.name !== '' && f.params.plane.name !== ''
    case 'mirror':
      return f.params.bodies.length > 0 && f.params.plane.name !== ''
    case 'pattern':
      return f.params.bodies.length > 0 && f.params.axis.name !== ''
    case 'plane':
      return f.params.base.name !== ''
    default:
      return true
  }
}

/** The tool id that edits a feature type, or null if it has no card yet. */
export function toolForFeature(type: Feature['type']): string | null {
  switch (type) {
    case 'extrude':
      return 'extrude'
    case 'revolve':
      return 'revolve'
    case 'sweep':
      return 'sweep'
    case 'loft':
      return 'loft'
    case 'fillet':
      return 'fillet'
    case 'chamfer':
      return 'chamfer'
    case 'shell':
      return 'shell'
    case 'boolean':
      return 'combine'
    case 'transform':
      return 'move'
    case 'split':
      return 'split'
    case 'mirror':
      return 'mirror'
    case 'pattern':
      return 'pattern'
    case 'plane':
      return 'plane'
    default:
      return null
  }
}

/** A copy of a feature safe to edit as a draft (its arrays are not shared with the document). */
export function cloneForEdit(f: Feature): Feature {
  switch (f.type) {
    case 'extrude':
      return { ...f, params: { ...f.params, profiles: [...f.params.profiles], targets: [...f.params.targets] } }
    case 'revolve':
      return {
        ...f,
        params: { ...f.params, profiles: [...f.params.profiles], targets: [...f.params.targets], axis: { ...f.params.axis } },
      }
    case 'sweep':
      return {
        ...f,
        params: { ...f.params, profile: { ...f.params.profile }, path: { ...f.params.path }, targets: [...f.params.targets] },
      }
    case 'loft':
      return {
        ...f,
        params: { ...f.params, profiles: [...f.params.profiles], targets: [...f.params.targets] },
      }
    case 'fillet':
    case 'chamfer':
      return { ...f, params: { ...f.params, edges: [...f.params.edges] } } as Feature
    case 'shell':
      return { ...f, params: { ...f.params, body: { ...f.params.body }, removeFaces: [...f.params.removeFaces] } }
    case 'boolean':
      return { ...f, params: { ...f.params, target: { ...f.params.target }, tools: [...f.params.tools] } }
    case 'transform':
      return {
        ...f,
        params: {
          ...f.params,
          bodies: [...f.params.bodies],
          translate: [...f.params.translate] as [string, string, string],
          rotate: f.params.rotate
            ? { ...f.params.rotate, axis: [...f.params.rotate.axis], pivot: [...f.params.rotate.pivot] }
            : null,
        },
      }
    case 'split':
      return { ...f, params: { body: { ...f.params.body }, plane: { ...f.params.plane } } }
    case 'mirror':
      return { ...f, params: { ...f.params, bodies: [...f.params.bodies], plane: { ...f.params.plane } } }
    case 'pattern':
      return { ...f, params: { ...f.params, bodies: [...f.params.bodies], axis: { ...f.params.axis } } }
    case 'plane':
      return { ...f, params: { ...f.params, base: { ...f.params.base } } }
    default:
      return f
  }
}

/** The references a feature's card works on, which is what the viewport has selected while it is open. */
export function selectionForFeature(f: Feature): Ref[] {
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'loft':
      return [...f.params.profiles]
    case 'sweep':
      return [f.params.profile, f.params.path].filter((r) => r.name !== '')
    case 'fillet':
    case 'chamfer':
      return [...f.params.edges]
    case 'shell':
      return f.params.removeFaces.length > 0 ? [...f.params.removeFaces] : f.params.body.name ? [f.params.body] : []
    case 'boolean':
      return combineSelection(f)
    case 'transform':
    case 'mirror':
    case 'pattern':
      return [...f.params.bodies]
    case 'split':
      return f.params.body.name ? [f.params.body] : []
    case 'plane':
      return f.params.base.name ? [f.params.base] : []
    case 'import':
      return [{ kind: 'body', name: f.id }]
    default:
      return []
  }
}

/** Volume of a closed triangle mesh (positions xyz per vertex, three indices per triangle), in mm^3. */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let sum = 0
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    sum +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
  }
  return sum / 6
}

/** Two volumes that differ only by rounding noise. */
export function sameVolume(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
}

/**
 * Which way a Cut should go for a profile sketched on a face. The face's outward normal points away from the solid,
 * so a sketch plane facing the same way would cut nothing: go the other way (-1, "Flip"). A sketch plane that
 * already faces into the solid keeps the normal direction (1).
 */
export function cutDirection(sketchNormal: Vec3, faceOutward: Vec3): 1 | -1 {
  const dot = sketchNormal[0] * faceOutward[0] + sketchNormal[1] * faceOutward[1] + sketchNormal[2] * faceOutward[2]
  return dot > 0 ? -1 : 1
}
