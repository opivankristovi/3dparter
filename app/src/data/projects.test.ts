// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  createProject,
  deleteProject,
  getProject,
  getSettings,
  listProjects,
  purgeProject,
  renameProject,
  restoreProject,
  saveDocument,
  updateSettings,
} from './projects'
import { seedIfFirstRun } from './seed'

beforeEach(async () => {
  await db.projects.clear()
  await db.settings.clear()
})

const tick = () => new Promise((r) => setTimeout(r, 3))

describe('projects', () => {
  it('creates with defaults and lists by last edited', async () => {
    const a = await createProject()
    await tick()
    const b = await createProject('Bracket')
    expect(a.name).toBe('Untitled')
    expect(a.document.features).toEqual([])
    expect(a.revision).toBe(1)
    const list = await listProjects({ sort: 'updated' })
    expect(list.map((p) => p.id)).toEqual([b.id, a.id])
  })

  it('sorts by name and searches case-insensitively', async () => {
    await createProject('Zeta')
    await createProject('alpha')
    await createProject('Beta plate')
    expect((await listProjects({ sort: 'name' })).map((p) => p.name)).toEqual(['alpha', 'Beta plate', 'Zeta'])
    expect((await listProjects({ sort: 'name', query: 'PLATE' })).map((p) => p.name)).toEqual(['Beta plate'])
    expect(await listProjects({ sort: 'name', query: 'nope' })).toEqual([])
  })

  it('renames', async () => {
    const p = await createProject('One')
    await renameProject(p.id, '  Two ')
    expect((await getProject(p.id))?.name).toBe('Two')
    await renameProject(p.id, '   ')
    expect((await getProject(p.id))?.name).toBe('Two')
  })

  it('soft deletes, restores and purges', async () => {
    const p = await createProject('Keep me')
    await deleteProject(p.id)
    expect(await listProjects({ sort: 'name' })).toHaveLength(0)
    expect(await listProjects({ sort: 'name', includeDeleted: true })).toHaveLength(1)
    expect((await listProjects({ sort: 'name', onlyDeleted: true }))[0].deletedAt).not.toBeNull()
    await restoreProject(p.id)
    expect(await listProjects({ sort: 'name' })).toHaveLength(1)
    await deleteProject(p.id)
    await purgeProject(p.id)
    expect(await getProject(p.id)).toBeUndefined()
  })

  it('saveDocument is a compare-and-set on revision', async () => {
    const p = await createProject()
    const doc = { ...p.document, units: 'in' as const }
    const first = await saveDocument(p.id, doc, 1)
    expect(first).toEqual({ ok: true, revision: 2 })
    // A second writer still holding revision 1 loses.
    const second = await saveDocument(p.id, { ...doc, units: 'cm' }, 1)
    expect(second).toEqual({ ok: false, reason: 'conflict' })
    const stored = await getProject(p.id)
    expect(stored?.document.units).toBe('in')
    expect(stored?.revision).toBe(2)
    expect(await saveDocument(p.id, doc, 2)).toEqual({ ok: true, revision: 3 })
  })

  it('saveDocument on a missing project is a conflict', async () => {
    const p = await createProject()
    expect(await saveDocument('missing', p.document, 1)).toEqual({ ok: false, reason: 'conflict' })
  })

  it('settings have defaults and merge updates', async () => {
    expect(await getSettings()).toMatchObject({ theme: 'system', units: 'mm', precision: 2 })
    await updateSettings({ theme: 'dark' })
    expect(await getSettings()).toMatchObject({ theme: 'dark', units: 'mm', precision: 2 })
  })

  it('seeds once, even after the sample is deleted', async () => {
    await seedIfFirstRun()
    const list = await listProjects({ sort: 'name' })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Sample: mounting plate')
    const doc = list[0].document
    expect(doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude'])
    await purgeProject(list[0].id)
    await seedIfFirstRun()
    expect(await listProjects({ sort: 'name' })).toHaveLength(0)
  })
})
