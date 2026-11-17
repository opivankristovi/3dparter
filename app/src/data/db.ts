import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type { DisplayUnit, ProjectDocument } from '../doc/types'

export interface SettingsRow {
  id: 'app'
  theme: 'light' | 'dark' | 'system'
  units: DisplayUnit
  /** Decimal places shown in readouts (0..4). */
  precision: number
  /** Set once the sample project has been created, so deleting it never re-seeds. */
  seeded?: boolean
}

export interface FolderRow {
  id: string
  parentId: string | null
  name: string
  createdAt: number
}

export interface ProjectRow {
  id: string
  name: string
  folderId: string | null
  units: DisplayUnit
  document: ProjectDocument
  /** Bumped on every successful save; saves are compare-and-set on it. */
  revision: number
  thumbnail: Blob | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ProjectVersionRow {
  id: string
  projectId: string
  label: string
  document: ProjectDocument
  createdAt: number
}

export interface AssetRow {
  id: string
  projectId: string
  name: string
  mime: string
  sha256: string
  bytes: Blob
  createdAt: number
}

export type ShaperDB = Dexie & {
  settings: EntityTable<SettingsRow, 'id'>
  folders: EntityTable<FolderRow, 'id'>
  projects: EntityTable<ProjectRow, 'id'>
  projectVersions: EntityTable<ProjectVersionRow, 'id'>
  assets: EntityTable<AssetRow, 'id'>
}

export const db = new Dexie('3dshaper') as ShaperDB

db.version(1).stores({
  settings: 'id',
  folders: 'id, parentId, name',
  projects: 'id, folderId, updatedAt, name, deletedAt',
  projectVersions: 'id, [projectId+createdAt]',
  assets: 'id, projectId, [projectId+sha256]',
})
