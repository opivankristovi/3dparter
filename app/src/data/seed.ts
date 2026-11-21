import { emptyDocument } from '../doc/types'
import type { ExtrudeFeature, LineEntity, ProjectDocument, SketchFeature } from '../doc/types'
import { db } from './db'
import { migrateLegacyDb } from './migrate'
import { createProject, getSettings, updateSettings } from './projects'

export function sampleDocument(): ProjectDocument {
  const doc = emptyDocument('mm')
  const sketchId = crypto.randomUUID()
  const extrudeId = crypto.randomUUID()
  const hw = 30 // half of 60
  const hh = 20 // half of 40
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
  const lines: LineEntity[] = corners.map((a, i) => ({
    id: crypto.randomUUID(),
    type: 'line',
    construction: false,
    a,
    b: corners[(i + 1) % 4],
  }))
  const sketch: SketchFeature = {
    id: sketchId,
    name: 'Sketch 1',
    suppressed: false,
    type: 'sketch',
    params: { on: { kind: 'originPlane', name: 'XY' } },
    sketch: {
      entities: [...lines, { id: crypto.randomUUID(), type: 'circle', construction: false, center: [20, 10], radius: 4 }],
      constraints: [],
    },
  }
  const regionName = `${sketchId}/region:${lines
    .map((l) => l.id)
    .sort()
    .join(',')}`
  const extrude: ExtrudeFeature = {
    id: extrudeId,
    name: 'Extrude 1',
    suppressed: false,
    type: 'extrude',
    params: {
      profiles: [{ kind: 'sketchRegion', name: regionName }],
      distance: '6',
      direction: 1,
      mode: 'new',
      targets: [],
    },
  }
  doc.features = [sketch, extrude]
  doc.bodies[extrudeId] = { name: 'Body 1', color: null, opacity: 1, visible: true, itemFolderId: null }
  return doc
}

/** First run only: one sample project. The flag stays set after the sample is deleted. */
export async function seedIfFirstRun(): Promise<void> {
  // Before anything reads projects: bring over data from the pre-rename database.
  try {
    await migrateLegacyDb()
  } catch {
    // A failed copy must not block the app; the old database is untouched and the next load retries.
  }
  const settings = await getSettings()
  if (settings.seeded) return
  if ((await db.projects.count()) === 0) {
    await createProject('Sample: mounting plate', sampleDocument())
  }
  await updateSettings({ seeded: true })
}
