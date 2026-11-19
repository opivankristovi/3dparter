// Helpers shared by the solver tests (not part of the app bundle).
/// <reference types="node" />
import { createRequire } from 'node:module'
import type { ArcEntity, LineEntity, Sketch, SketchConstraint, SketchEntity, Vec2 } from '../../doc/types'
import { rectangleEntities } from '../geometry'
import { inferConstraints } from './infer'
import { initSolver } from './solver'

export function solverWasmPath(): string {
  return createRequire(import.meta.url).resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')
}

export const readySolver = () => initSolver({ wasmPath: solverWasmPath() })

let seq = 0
export const cid = () => `k${++seq}`

export const line = (id: string, a: Vec2, b: Vec2): LineEntity => ({ id, type: 'line', construction: false, a, b })
export const arc = (id: string, center: Vec2, radius: number, startAngle: number, endAngle: number): ArcEntity => ({
  id,
  type: 'arc',
  construction: false,
  center,
  radius,
  startAngle,
  endAngle,
})

export const con = (type: SketchConstraint['type'], entityIds: string[], value?: string): SketchConstraint => ({
  id: cid(),
  type,
  entityIds,
  value,
  driving: true,
})

/** Rectangle lines r0 bottom, r1 right, r2 top, r3 left, away from the origin, with inferred constraints. */
export function rectSketch(a: Vec2 = [10, 10], b: Vec2 = [50, 40]): Sketch {
  let n = 0
  const entities: SketchEntity[] = rectangleEntities(a, b, () => `r${n++}`)
  const constraints = inferConstraints(entities, [], { tolMm: 1e-3, kind: 'rectangle' })
  return { entities, constraints }
}

export const lineOf = (s: SketchEntity[], id: string): LineEntity => {
  const e = s.find((x) => x.id === id)
  if (e?.type !== 'line') throw new Error(`no line ${id}`)
  return e
}
