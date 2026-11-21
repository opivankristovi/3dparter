// The text card's state: which text entity is being placed or edited. Never part of the document; the
// document is only written when the card is applied (one undo step).
import { create } from 'zustand'
import type { TextEntity } from '../../doc/types'

export interface TextSession {
  sketchId: string
  /** The entity as the card holds it now (drawn live in the viewport). */
  draft: TextEntity
  /** True while the text has not been added to the sketch yet. */
  isNew: boolean
}

interface TextUiState {
  session: TextSession | null
  /** The next click on a circle, arc or line sets what the text follows. */
  pickingPath: boolean
  open(session: TextSession): void
  change(patch: Partial<Omit<TextEntity, 'id' | 'type'>>): void
  setPicking(on: boolean): void
  close(): void
}

export const useTextUi = create<TextUiState>()((set) => ({
  session: null,
  pickingPath: false,
  open: (session) => set({ session, pickingPath: false }),
  change: (patch) => set((s) => (s.session ? { session: { ...s.session, draft: { ...s.session.draft, ...patch } } } : s)),
  setPicking: (pickingPath) => set({ pickingPath }),
  close: () => set({ session: null, pickingPath: false }),
}))

export const DEFAULT_TEXT = 'Text'
export const DEFAULT_SIZE_MM = 10
