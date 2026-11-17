// File export. M0: STL only.
import { makeCompound } from 'replicad'
import type { ExportOptions } from './api'
import { safeDelete } from './build'
import type { BodyRecord } from './regenerate'

/** Several bodies go into one file: they are gathered into a compound and written together. */
export async function exportStl(bodies: BodyRecord[], opts: ExportOptions): Promise<ArrayBuffer> {
  if (bodies.length === 0) throw new Error('There is nothing to export.')
  const shapes = bodies.map((b) => b.built.shape)
  const compound = shapes.length === 1 ? null : makeCompound(shapes)
  try {
    const target = compound ?? shapes[0]
    const blob = target.blobSTL({
      tolerance: opts.tolerance,
      angularTolerance: opts.angularTolerance,
      binary: opts.binary,
    })
    return await blob.arrayBuffer()
  } finally {
    safeDelete(compound)
  }
}
