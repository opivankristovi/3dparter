import Dexie from 'dexie'
import { db } from './db'

/** Database name used before the product was renamed 3DShaper -> 3DParter. Kept only for the migration. */
export const LEGACY_DB_NAME = '3dshaper'

/**
 * One-time copy of every table from the old '3dshaper' database into the current one.
 * Runs only when the old database exists, the new one has no projects and the migration has not run before
 * (a flag on the settings row, so deleting every project later never brings the old ones back).
 * The old database is left in place as a backup. Safe to call repeatedly. Returns true when rows were copied.
 */
export async function migrateLegacyDb(): Promise<boolean> {
  if ((await db.settings.get('app'))?.legacyMigrated) return false
  if ((await db.projects.count()) > 0) return false

  if (!(await Dexie.exists(LEGACY_DB_NAME))) return false
  const old = new Dexie(LEGACY_DB_NAME)
  let copied: { table: string; rows: unknown[] }[]
  try {
    await old.open()
    copied = []
    for (const t of old.tables) copied.push({ table: t.name, rows: await t.toArray() })
  } finally {
    old.close()
  }
  const hasData = copied.some((c) => c.rows.length > 0)
  if (!hasData) return false

  const targets = db.tables.filter((t) => copied.some((c) => c.table === t.name))
  await db.transaction('rw', db.tables, async () => {
    for (const t of targets) {
      const rows = copied.find((c) => c.table === t.name)!.rows
      if (rows.length > 0) await t.bulkPut(rows)
    }
    const existing = await db.settings.get('app')
    await db.settings.put({ ...(existing ?? { theme: 'system' as const, units: 'mm' as const, precision: 2, gridSnap: true }), id: 'app', legacyMigrated: true })
  })
  return true
}
