// The ONLY module screens call for persistence.
import { emptyDocument } from '../doc/types'
import type { ProjectDocument } from '../doc/types'
import { db } from './db'
import type { ProjectRow, SettingsRow } from './db'

export type { ProjectRow, SettingsRow }

export type SaveResult = { ok: true; revision: number } | { ok: false; reason: 'conflict' }

export interface ListOptions {
  sort: 'updated' | 'name'
  query?: string
  includeDeleted?: boolean
  /** Only deleted projects (the Trash view). */
  onlyDeleted?: boolean
}

export const DEFAULT_SETTINGS: SettingsRow = { id: 'app', theme: 'system', units: 'mm', precision: 2, gridSnap: true }

// ---- cross-tab notice -------------------------------------------------------------------

export interface SavedMessage {
  type: 'saved'
  id: string
  revision: number
}

let channel: BroadcastChannel | null | undefined
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('3dshaper')
  }
  return channel
}

/** Calls `fn` when ANOTHER tab saves a project. Returns an unsubscribe function. */
export function onRemoteSave(fn: (m: SavedMessage) => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}
  const h = (e: MessageEvent) => {
    if (e.data?.type === 'saved') fn(e.data as SavedMessage)
  }
  ch.addEventListener('message', h)
  return () => ch.removeEventListener('message', h)
}

// ---- storage persistence ----------------------------------------------------------------

let persistAsked = false
export function requestPersistence(): void {
  if (persistAsked) return
  persistAsked = true
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {
    // Ignore: persistence is a nice-to-have.
  }
}

// ---- projects ---------------------------------------------------------------------------

export async function listProjects(opts: ListOptions): Promise<ProjectRow[]> {
  let rows = await db.projects.toArray()
  if (opts.onlyDeleted) rows = rows.filter((r) => r.deletedAt !== null)
  else if (!opts.includeDeleted) rows = rows.filter((r) => r.deletedAt === null)
  const q = opts.query?.trim().toLowerCase()
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q))
  if (opts.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  else rows.sort((a, b) => b.updatedAt - a.updatedAt)
  return rows
}

export async function getProject(id: string): Promise<ProjectRow | undefined> {
  return db.projects.get(id)
}

export async function createProject(name = 'Untitled', doc?: ProjectDocument): Promise<ProjectRow> {
  const settings = await getSettings()
  const now = Date.now()
  const document = doc ?? emptyDocument(settings.units)
  const row: ProjectRow = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled',
    folderId: null,
    units: document.units,
    document,
    revision: 1,
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.projects.add(row)
  return row
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  await db.projects.update(id, { name: clean, updatedAt: Date.now() })
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.update(id, { deletedAt: Date.now() })
}

export async function restoreProject(id: string): Promise<void> {
  await db.projects.update(id, { deletedAt: null })
}

export async function purgeProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.projectVersions, db.assets, async () => {
    await db.projects.delete(id)
    await db.projectVersions.where('projectId').equals(id).delete()
    await db.assets.where('projectId').equals(id).delete()
  })
}

/**
 * Compare-and-set on `revision`: writes only if the stored revision still equals `baseRevision`.
 * Two tabs editing one project: the loser gets `conflict`.
 */
export async function saveDocument(id: string, doc: ProjectDocument, baseRevision: number): Promise<SaveResult> {
  const result = await db.transaction('rw', db.projects, async (): Promise<SaveResult> => {
    const row = await db.projects.get(id)
    if (!row || row.revision !== baseRevision) return { ok: false, reason: 'conflict' }
    const revision = baseRevision + 1
    await db.projects.update(id, { document: doc, units: doc.units, revision, updatedAt: Date.now() })
    return { ok: true, revision }
  })
  if (result.ok) getChannel()?.postMessage({ type: 'saved', id, revision: result.revision } satisfies SavedMessage)
  return result
}

export async function saveThumbnail(id: string, blob: Blob): Promise<void> {
  await db.projects.update(id, { thumbnail: blob })
}

// ---- settings ---------------------------------------------------------------------------

const settingsListeners = new Set<(s: SettingsRow) => void>()
/** Subscribe to settings changes made in this tab. */
export function onSettingsChange(fn: (s: SettingsRow) => void): () => void {
  settingsListeners.add(fn)
  return () => settingsListeners.delete(fn)
}

export async function getSettings(): Promise<SettingsRow> {
  const row = await db.settings.get('app')
  return { ...DEFAULT_SETTINGS, ...row }
}

export async function updateSettings(partial: Partial<Omit<SettingsRow, 'id'>>): Promise<SettingsRow> {
  const next: SettingsRow = { ...(await getSettings()), ...partial, id: 'app' }
  await db.settings.put(next)
  settingsListeners.forEach((fn) => fn(next))
  return next
}
