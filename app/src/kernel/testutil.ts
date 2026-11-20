// Helpers shared by the kernel tests (not part of the app bundle).
/// <reference types="node" />
import { createRequire } from 'node:module'
import {
  emptyDocument,
  type BooleanFeature,
  type ChamferFeature,
  type FilletFeature,
  type PlaneFeature,
  type RevolveFeature,
  type ShellFeature,
  type TransformFeature,
  type Ref,
  type CircleEntity,
  type ExtrudeFeature,
  type LineEntity,
  type ProjectDocument,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
} from '../doc/types'
import { loadOC } from './occ'

export function nodeWasmPath(): string {
  return createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm')
}

export const ready = () => loadOC({ wasmPath: nodeWasmPath() })

export const line = (id: string, a: Vec2, b: Vec2): LineEntity => ({ id, type: 'line', construction: false, a, b })
export const circle = (id: string, center: Vec2, radius: number): CircleEntity => ({
  id,
  type: 'circle',
  construction: false,
  center,
  radius,
})

/** Four lines l1..l4 (counter-clockwise from the corner) with the given id prefix. */
export function rect(prefix: string, x: number, y: number, w: number, h: number): SketchEntity[] {
  return [
    line(`${prefix}1`, [x, y], [x + w, y]),
    line(`${prefix}2`, [x + w, y], [x + w, y + h]),
    line(`${prefix}3`, [x + w, y + h], [x, y + h]),
    line(`${prefix}4`, [x, y + h], [x, y]),
  ]
}

export function sketchFeature(id: string, plane: 'XY' | 'XZ' | 'YZ', entities: SketchEntity[]): SketchFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'sketch',
    params: { on: { kind: 'originPlane', name: plane } },
    sketch: { entities, constraints: [] },
  }
}

export function extrudeFeature(
  id: string,
  regionNames: string[],
  distance: string,
  direction: 1 | -1 | 0 = 1,
  mode: ExtrudeFeature['params']['mode'] = 'new',
  targets: string[] = [],
): ExtrudeFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'extrude',
    params: {
      profiles: regionNames.map((name) => ({ kind: 'sketchRegion' as const, name })),
      distance,
      direction,
      mode,
      targets: targets.map((name) => ({ kind: 'body' as const, name })),
    },
  }
}

/** An edge ref by name; pass a hint to test the position fallback. */
export const edgeRef = (name: string, hint?: Ref['hint']): Ref => ({ kind: 'edge', name, ...(hint ? { hint } : {}) })

export function filletFeature(id: string, edges: (string | Ref)[], radius: string): FilletFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'fillet',
    params: { edges: edges.map((e) => (typeof e === 'string' ? edgeRef(e) : e)), radius },
  }
}

export function chamferFeature(id: string, edges: (string | Ref)[], distance: string): ChamferFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'chamfer',
    params: { edges: edges.map((e) => (typeof e === 'string' ? edgeRef(e) : e)), distance },
  }
}

export function booleanFeature(
  id: string,
  op: BooleanFeature['params']['op'],
  target: string,
  tools: string[],
  keepTools = false,
): BooleanFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'boolean',
    params: {
      op,
      target: { kind: 'body', name: target },
      tools: tools.map((name) => ({ kind: 'body' as const, name })),
      keepTools,
    },
  }
}

export function docOf(...features: ProjectDocument['features']): ProjectDocument {
  const d = emptyDocument()
  d.features = features
  return d
}

// ---- M2 helpers ------------------------------------------------------------------------------

export const bodyRef = (name: string): Ref => ({ kind: 'body', name })
export const faceRef = (name: string, hint?: Ref['hint']): Ref => ({ kind: 'face', name, ...(hint ? { hint } : {}) })

/** A sketch on any Ref (origin plane, construction plane or face). */
export function sketchOn(id: string, on: Ref, entities: SketchEntity[]): SketchFeature {
  return { id, name: id, suppressed: false, type: 'sketch', params: { on }, sketch: { entities, constraints: [] } }
}

export const constructionLine = (id: string, a: Vec2, b: Vec2): LineEntity => ({ ...line(id, a, b), construction: true })

export function revolveFeature(
  id: string,
  regionNames: string[],
  axis: Ref,
  angle: string,
  mode: RevolveFeature['params']['mode'] = 'new',
  targets: string[] = [],
): RevolveFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'revolve',
    params: {
      profiles: regionNames.map((name) => ({ kind: 'sketchRegion' as const, name })),
      axis,
      angle,
      mode,
      targets: targets.map(bodyRef),
    },
  }
}

export function shellFeature(id: string, body: string, removeFaces: string[], thickness: string): ShellFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'shell',
    params: { body: bodyRef(body), removeFaces: removeFaces.map((n) => faceRef(n)), thickness },
  }
}

export function transformFeature(
  id: string,
  bodies: string[],
  o: { translate?: [string, string, string]; rotate?: TransformFeature['params']['rotate']; copy?: boolean } = {},
): TransformFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'transform',
    params: {
      bodies: bodies.map(bodyRef),
      translate: o.translate ?? ['0', '0', '0'],
      rotate: o.rotate ?? null,
      copy: o.copy ?? false,
    },
  }
}

export function planeFeature(id: string, base: Ref, offset: string, angle = '0'): PlaneFeature {
  return { id, name: id, suppressed: false, type: 'plane', params: { base, offset, angle } }
}
