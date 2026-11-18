// Tool state that is NOT part of the document: the live draft of a feature being edited, and the sketch in use.
// The draft is previewed by the kernel but never written to the document until Apply (one undo step).
import { create } from 'zustand'
import type { Feature } from '../../doc/types'

interface ToolState {
  /** The feature being previewed (a new one, or an edited copy of an existing one). */
  draft: Feature | null
  /** Id of the existing feature the draft replaces, or null for a brand new feature. */
  draftReplaces: string | null
  /** The sketch feature that is open for drawing. */
  activeSketchId: string | null
  setDraft(draft: Feature, replaces?: string | null): void
  clearDraft(): void
  setActiveSketch(id: string | null): void
}

export const useToolStore = create<ToolState>()((set) => ({
  draft: null,
  draftReplaces: null,
  activeSketchId: null,
  setDraft(draft, replaces = null) {
    set({ draft, draftReplaces: replaces })
  },
  clearDraft() {
    set({ draft: null, draftReplaces: null })
  },
  setActiveSketch(id) {
    set({ activeSketchId: id })
  },
}))
