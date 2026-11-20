// Sketch-mode UI state that is not part of the document: solver status, the live solve while dragging,
// which constraints are selected or hovered, and the dimension editor that is open.
import { create } from 'zustand'
import type { ArmStart, DimensionalConstraintType, SketchEntity } from '../doc/types'
import type { EntityState } from './solver/defined'

export type SolverStatus = 'idle' | 'loading' | 'ready' | 'error'

/** How well the open sketch is pinned down, recomputed after each document change. */
export interface DefinedInfo {
  sketchId: string
  states: Record<string, EntityState>
  dof: number
  /** 'over' = conflicting constraints. */
  state: 'under' | 'full' | 'over'
  conflicting: string[]
}

/** A dimension being added: shown as an inline field until Enter adds it (Esc drops it). */
export interface PendingDimension {
  type: DimensionalConstraintType
  refs: string[]
  /** Angle only: where each line's arm starts, decided when the dimension was started. */
  arms?: [ArmStart, ArmStart]
  text: string
  error?: string
}

interface SketchUiState {
  solver: SolverStatus
  autoConstraints: boolean
  selectedConstraintIds: string[]
  hoverConstraintId: string | null
  /** The point or entity under the pointer in selection mode (a constraint ref). */
  hoverRef: string | null
  /** Constraints flashing red after a refused edit. */
  flashIds: string[]
  pending: PendingDimension | null
  /** Id of the existing dimension whose value is being edited. */
  editingId: string | null
  /** Entities of the open sketch while a drag is being previewed (never written to the document). */
  preview: SketchEntity[] | null
  defined: DefinedInfo | null
  set(patch: Partial<Omit<SketchUiState, 'set'>>): void
}

export const useSketchUi = create<SketchUiState>()((set) => ({
  solver: 'idle',
  autoConstraints: true,
  selectedConstraintIds: [],
  hoverConstraintId: null,
  hoverRef: null,
  flashIds: [],
  pending: null,
  editingId: null,
  preview: null,
  defined: null,
  set: (patch) => set(patch),
}))
