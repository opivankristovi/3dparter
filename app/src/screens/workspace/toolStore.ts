// Tool state that is NOT part of the document: the live draft of a feature being edited, and the sketch in use.
// The draft is previewed by the kernel but never written to the document until Apply (one undo step).
import { create } from 'zustand'
import type { Feature, PlaneFrame } from '../../doc/types'

interface ToolState {
  /** The feature being previewed (a new one, or an edited copy of an existing one). */
  draft: Feature | null
  /** Id of the existing feature the draft replaces, or null for a brand new feature. */
  draftReplaces: string | null
  /** The sketch feature that is open for drawing. */
  activeSketchId: string | null
  /** Bodies the kernel reports after the last regenerate (null until the first one). Consumed bodies are not in it. */
  liveBodies: string[] | null
  /** Resolved plane frames for sketch features (for sketches on flat faces or construction planes). */
  sketchFrames: Record<string, PlaneFrame>
  setDraft(draft: Feature, replaces?: string | null): void
  clearDraft(): void
  setActiveSketch(id: string | null): void
  setLiveBodies(ids: string[] | null): void
  setSketchFrames(frames: Record<string, PlaneFrame>): void
  setSketchFrame(id: string, frame: PlaneFrame): void
}

export const useToolStore = create<ToolState>()((set) => ({
  draft: null,
  draftReplaces: null,
  activeSketchId: null,
  liveBodies: null,
  sketchFrames: {},
  setDraft(draft, replaces = null) {
    set({ draft, draftReplaces: replaces })
  },
  clearDraft() {
    set({ draft: null, draftReplaces: null })
  },
  setActiveSketch(id) {
    set({ activeSketchId: id })
  },
  setLiveBodies(ids) {
    set({ liveBodies: ids })
  },
  setSketchFrames(frames) {
    set({ sketchFrames: frames })
  },
  setSketchFrame(id, frame) {
    set((s) => ({ sketchFrames: { ...s.sketchFrames, [id]: frame } }))
  },
}))
