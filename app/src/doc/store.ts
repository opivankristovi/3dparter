// The open project: document, selection, active tool, undo/redo and debounced saving.
// Undo works on the DOCUMENT with Immer patches. Geometry is never undone, only rebuilt.
import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { Patch } from 'immer'
import { getProject, onRemoteSave, renameProject, saveDocument } from '../data/projects'
import { emptyDocument } from './types'
import type { ProjectDocument, Ref } from './types'

enablePatches()

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict'

export interface ProjectState {
  projectId: string | null
  name: string
  doc: ProjectDocument
  revision: number
  saveState: SaveState
  selection: Ref[]
  /** e.g. 'sketch.rectangle', 'extrude' */
  activeTool: string | null
  /** Feature whose parameter card is open. */
  editingFeatureId: string | null
  canUndo: boolean
  canRedo: boolean
  load(id: string): Promise<'ok' | 'not-found'>
  close(): void
  /** ONE undo step. */
  apply(label: string, recipe: (draft: ProjectDocument) => void): void
  undo(): void
  redo(): void
  /** Forgets the redo steps (used after an automatic put-back, so Redo cannot replay a rejected change). */
  discardRedo(): void
  rename(name: string): Promise<void>
  setSelection(refs: Ref[]): void
  setActiveTool(tool: string | null): void
  setEditingFeature(id: string | null): void
}

interface HistoryEntry {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
}

const UNDO_CAP = 200
const SAVE_DELAY_MS = 500

let undoStack: HistoryEntry[] = []
let redoStack: HistoryEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<void> = Promise.resolve()
let queued = 0
let unsubscribeRemote: (() => void) | null = null
/** Last revision we know for each project, so a save queued before close() still lands. */
const revisions = new Map<string, number>()
let flushNow: () => void = () => {}
/** Bumped by close(); a load() that finds it changed was superseded and must not touch state. */
let loadToken = 0

const initial = {
  projectId: null,
  name: '',
  doc: emptyDocument(),
  revision: 0,
  saveState: 'saved' as SaveState,
  selection: [] as Ref[],
  activeTool: null as string | null,
  editingFeatureId: null as string | null,
  canUndo: false,
  canRedo: false,
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  const syncFlags = () => set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })

  const enqueueSave = (id: string, doc: ProjectDocument) => {
    queued++
    queue = queue.then(async () => {
      try {
        const base = revisions.get(id)
        if (base === undefined) return
        const res = await saveDocument(id, doc, base)
        const open = get().projectId === id
        if (res.ok) {
          revisions.set(id, res.revision)
          if (open) {
            set({ revision: res.revision })
            // Last save in the queue and nothing waiting on the debounce: we are in sync.
            if (queued === 1 && timer === null && get().saveState !== 'conflict') set({ saveState: 'saved' })
          }
        } else if (open) {
          set({ saveState: 'conflict' })
        }
      } catch {
        if (get().projectId === id && get().saveState !== 'conflict') set({ saveState: 'error' })
      } finally {
        queued--
      }
    })
  }

  const scheduleSave = () => {
    if (get().saveState !== 'conflict') set({ saveState: 'saving' })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const { projectId, doc } = get()
      if (projectId) enqueueSave(projectId, doc)
    }, SAVE_DELAY_MS)
  }

  flushNow = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    const { projectId, doc } = get()
    if (projectId) enqueueSave(projectId, doc)
  }

  const afterDocChange = () => {
    const s = get()
    const ids = new Set(s.doc.features.map((f) => f.id))
    if (s.editingFeatureId && !ids.has(s.editingFeatureId)) set({ editingFeatureId: null })
    syncFlags()
    scheduleSave()
  }

  return {
    ...initial,

    async load(id) {
      get().close()
      const token = loadToken
      const row = await getProject(id)
      // Superseded by close() or a newer load(): the caller has already moved on.
      if (token !== loadToken) return 'not-found'
      if (!row || row.deletedAt !== null) return 'not-found'
      undoStack = []
      redoStack = []
      revisions.set(id, row.revision)
      unsubscribeRemote = onRemoteSave((m) => {
        // Another tab saved this project: our next save would lose, so warn now.
        if (m.id === get().projectId) set({ saveState: 'conflict' })
      })
      set({
        ...initial,
        projectId: id,
        name: row.name,
        doc: row.document,
        revision: row.revision,
      })
      return 'ok'
    },

    close() {
      loadToken++
      if (get().saveState !== 'conflict') flushNow()
      else if (timer) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribeRemote?.()
      unsubscribeRemote = null
      undoStack = []
      redoStack = []
      set({ ...initial, doc: emptyDocument() })
    },

    apply(label, recipe) {
      const s = get()
      if (!s.projectId) return
      const [next, patches, inversePatches] = produceWithPatches(s.doc, recipe)
      if (patches.length === 0) return
      undoStack.push({ label, patches, inversePatches })
      if (undoStack.length > UNDO_CAP) undoStack.shift()
      redoStack = []
      set({ doc: next })
      afterDocChange()
    },

    undo() {
      const entry = undoStack.pop()
      if (!entry) return
      redoStack.push(entry)
      set({ doc: applyPatches(get().doc, entry.inversePatches) })
      afterDocChange()
    },

    redo() {
      const entry = redoStack.pop()
      if (!entry) return
      undoStack.push(entry)
      set({ doc: applyPatches(get().doc, entry.patches) })
      afterDocChange()
    },

    discardRedo() {
      redoStack = []
      syncFlags()
    },

    async rename(name) {
      const { projectId } = get()
      const clean = name.trim()
      if (!projectId || !clean) return
      await renameProject(projectId, clean)
      if (get().projectId === projectId) set({ name: clean })
    },

    setSelection(refs) {
      set({ selection: refs })
    },
    setActiveTool(tool) {
      set({ activeTool: tool })
    },
    setEditingFeature(id) {
      set({ editingFeatureId: id })
    },
  }
})

/** Saves any pending edit now and waits for the save queue to drain (used on unload and in tests). */
export async function flushSaves(): Promise<void> {
  flushNow()
  await queue
}
