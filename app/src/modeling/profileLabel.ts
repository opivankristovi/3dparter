// How a card names a profile that is sketch text: 'Text “HELLO”' (whole) or 'Letter 3 of “HELLO”' (one glyph).
import type { Feature, Ref } from '../doc/types'
import { textProfileLabel } from '../sketch/text/regionRef'

/** The label of a text profile, or null when the ref is not sketch text. */
export function textLabelOfRef(
  ref: Ref,
  features: readonly Feature[],
  regions?: Record<string, readonly { name: string }[]>,
): string | null {
  if (ref.kind !== 'sketchRegion') return null
  const skId = ref.name.slice(0, Math.max(0, ref.name.indexOf('/region:')))
  return textProfileLabel(
    ref.name,
    (sketchId, textId) => {
      const sk = features.find((f) => f.id === sketchId)
      const e = sk?.type === 'sketch' ? sk.sketch.entities.find((x) => x.id === textId) : undefined
      return e?.type === 'text' ? e.text : undefined
    },
    regions?.[skId] ?? [],
  )
}
