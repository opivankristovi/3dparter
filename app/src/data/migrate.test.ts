// @vitest-environment node
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/types'
import { db } from './db'
import type { ProjectRow } from './db'
import { LEGACY_DB_NAME, migrateLegacyDb } from './migrate'

const row = (id: string, name: string): ProjectRow => ({
  id,
  name,
  folderId: null,
  units: 'mm',
  document: emptyDocument('mm'),
  revision: 1,
  thumbnail: null,
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null,
})

function legacy() {
  const old = new Dexie(LEGACY_DB_NAME)
  old.version(1).stores({
    settings: 'id',
    folders: 'id, parentId, name',
    projects: 'id, folderId, updatedAt, name, deletedAt',
    projectVersions: 'id, [projectId+createdAt]',
    assets: 'id, projectId, [projectId+sha256]',
  })
  return old
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear()
  await Dexie.delete(LEGACY_DB_NAME)
})

describe('legacy 3dshaper -> 3dparter migration', () => {
  it('is a no-op when the old database does not exist', async () => {
    expect(await migrateLegacyDb()).toBe(false)
    expect(await db.projects.count()).toBe(0)
    expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(false)
  })

  it('copies projects and settings, keeps the old database, and does not duplicate on a second run', async () => {
    const old = legacy()
    await old.table('projects').bulkAdd([row('a', 'One'), row('b', 'Two')])
    await old.table('settings').put({ id: 'app', theme: 'dark', units: 'in', precision: 3, gridSnap: false, seeded: true })
    old.close()

    expect(await migrateLegacyDb()).toBe(true)
    expect((await db.projects.toArray()).map((p) => p.name).sort()).toEqual(['One', 'Two'])
    const s = await db.settings.get('app')
    expect(s).toMatchObject({ theme: 'dark', units: 'in', precision: 3, gridSnap: false, seeded: true, legacyMigrated: true })

    expect(await migrateLegacyDb()).toBe(false)
    expect(await db.projects.count()).toBe(2)

    // Old database is still there as a backup.
    expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true)
    const again = legacy()
    expect(await again.table('projects').count()).toBe(2)
    again.close()
  })

  it('does not bring old projects back after the user deletes everything', async () => {
    const old = legacy()
    await old.table('projects').add(row('a', 'One'))
    old.close()
    await migrateLegacyDb()
    await db.projects.clear()
    expect(await migrateLegacyDb()).toBe(false)
    expect(await db.projects.count()).toBe(0)
  })

  it('does nothing when the new database already has projects', async () => {
    const old = legacy()
    await old.table('projects').add(row('a', 'Old'))
    old.close()
    await db.projects.add(row('n', 'New'))
    expect(await migrateLegacyDb()).toBe(false)
    expect((await db.projects.toArray()).map((p) => p.name)).toEqual(['New'])
  })
})
