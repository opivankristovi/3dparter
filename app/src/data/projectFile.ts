// Native project file serialization and validation (.3dparter.json).
import type { ProjectDocument } from '../doc/types'

export interface ProjectFileV1 {
  schemaVersion: 1
  name: string
  document: ProjectDocument
}

export function serializeProjectFile(name: string, doc: ProjectDocument): string {
  const payload: ProjectFileV1 = { schemaVersion: 1, name, document: doc }
  return JSON.stringify(payload, null, 2)
}

export function exportProjectJson(name: string, doc: ProjectDocument): void {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project'
  const blob = new Blob([serializeProjectFile(name, doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.3dparter.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function parseProjectFile(text: string): { name: string; document: ProjectDocument } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project file format.')
  const rec = raw as Record<string, unknown>
  if (rec.schemaVersion !== 1 || !rec.document || typeof rec.document !== 'object') {
    throw new Error('Unsupported or incomplete 3DParter project file.')
  }
  const doc = rec.document as Record<string, unknown>
  if (!Array.isArray(doc.features) || !doc.bodies || typeof doc.bodies !== 'object') {
    throw new Error('Project file is missing geometry history or solids.')
  }
  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Imported project'
  return { name, document: rec.document as ProjectDocument }
}
