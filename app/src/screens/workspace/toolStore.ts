// Tool state that is NOT part of the document: the live draft of a feature being edited, the sketch in use,
// and transient viewport display toggles.
import { create } from 'zustand'
import type { Feature, PlaneFrame } from '../../doc/types'

export type SelectionFilter = 'all' | 'body' | 'face' | 'edge' | 'vertex'
export type DisplayMode = 'shaded' | 'wireframe'

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
  /** Viewport picking filter when no modeling tool overrides it. */
  selectionFilter: SelectionFilter
  /** Whether a live section clipping plane is active in the viewport. */
  sectionView: boolean
  /** Viewport solid shading mode. */
  displayMode: DisplayMode
  setDraft(draft: Feature, replaces?: string | null): void
  clearDraft(): void
  setActiveSketch(id: string | null): void
  setLiveBodies(ids: string[] | null): void
  setSketchFrames(frames: Record<string, PlaneFrame>): void
  setSketchFrame(id: string, frame: PlaneFrame): void
  setSelectionFilter(filter: SelectionFilter): void
  setSectionView(enabled: boolean): void
  setDisplayMode(mode: DisplayMode): void
}

export const useToolStore = create<ToolState>()((set) => ({
  draft: null,
  draftReplaces: null,
  activeSketchId: null,
  liveBodies: null,
  sketchFrames: {},
  selectionFilter: 'all',
  sectionView: false,
  displayMode: 'shaded',
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
  setSelectionFilter(selectionFilter) {
    set({ selectionFilter })
  },
  setSectionView(sectionView) {
    set({ sectionView })
  },
  setDisplayMode(displayMode) {
    set({ displayMode })
  },
}))
