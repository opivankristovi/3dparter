// Helpers shared by the kernel tests (not part of the app bundle).
/// <reference types="node" />
import { createRequire } from 'node:module'
import {
  emptyDocument,
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
      targets: [],
    },
  }
}

export function docOf(...features: ProjectDocument['features']): ProjectDocument {
  const d = emptyDocument()
  d.features = features
  return d
}
