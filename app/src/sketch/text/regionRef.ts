// Profile refs that point at sketch text. A glyph region is '<sketchId>/region:<textId>~<c>'; the ref
// '<sketchId>/region:<textId>~*' means EVERY glyph region of that text, whatever letters it has when the
// model regenerates. Pure string work, shared by the kernel, the viewport and the cards.
const GLYPH = /^(.+\/region:.+)~(\d+)$/
const WHOLE = /^(.+\/region:.+)~\*$/

/** True for '<sketchId>/region:<textId>~*'. */
export const isWholeTextRef = (name: string): boolean => WHOLE.test(name)

/** The whole-text ref name for a glyph region name, or null when the name is not a glyph. */
export function wholeTextName(regionName: string): string | null {
  const m = GLYPH.exec(regionName)
  return m ? `${m[1]}~*` : null
}

/** The glyph number of a glyph region name ('...~3' is 3), or null. */
export function glyphNumber(regionName: string): number | null {
  const m = GLYPH.exec(regionName)
  return m ? Number(m[2]) : null
}

/** The text entity id inside a text ref or glyph region name, or null. */
export function textIdOf(name: string): string | null {
  const m = GLYPH.exec(name) ?? WHOLE.exec(name)
  return m ? m[1].slice(m[1].indexOf('/region:') + '/region:'.length) : null
}

/** The glyph regions a whole-text ref stands for, in glyph order. */
export function glyphRegionsOf<T extends { name: string }>(regions: readonly T[], wholeName: string): T[] {
  return regions
    .filter((r) => wholeTextName(r.name) === wholeName)
    .sort((a, b) => (glyphNumber(a.name) ?? 0) - (glyphNumber(b.name) ?? 0))
}

/** True when a profile ref covers a region: it is that region, or the whole text the region belongs to. */
export function refCoversRegion(refName: string, regionName: string): boolean {
  return refName === regionName || (isWholeTextRef(refName) && wholeTextName(regionName) === refName)
}

/** The first region a profile ref covers (the region itself, or the first glyph of a whole text). */
export function firstRegionOf<T extends { name: string }>(regions: readonly T[], refName: string): T | undefined {
  if (isWholeTextRef(refName)) return glyphRegionsOf(regions, refName)[0]
  return regions.find((r) => r.name === refName)
}

/** Every region a profile ref covers: the region itself, or all glyph regions of a whole text. */
export function coveredRegions<T extends { name: string }>(regions: readonly T[], refName: string): T[] {
  if (isWholeTextRef(refName)) return glyphRegionsOf(regions, refName)
  const r = regions.find((x) => x.name === refName)
  return r ? [r] : []
}

const SHORT = 24

/**
 * What a card calls a text profile: 'Text “HELLO”' for a whole text, 'Letter 3 of “HELLO”' for one glyph.
 * null when the ref is not text. `sketchText` gives the wording of a text entity by sketch id and entity id.
 */
export function textProfileLabel(
  refName: string,
  sketchText: (sketchId: string, textId: string) => string | undefined,
  regionsOfSketch: readonly { name: string }[] = [],
): string | null {
  const textId = textIdOf(refName)
  if (textId === null) return null
  const sketchId = refName.slice(0, refName.indexOf('/region:'))
  const wording = sketchText(sketchId, textId)
  const quoted = wording === undefined ? '' : `“${wording.length > SHORT ? `${wording.slice(0, SHORT)}…` : wording}”`
  if (isWholeTextRef(refName)) return quoted ? `Text ${quoted}` : 'Text'
  const whole = wholeTextName(refName)
  const idx = whole ? glyphRegionsOf(regionsOfSketch, whole).findIndex((r) => r.name === refName) : -1
  const letter = idx >= 0 ? `Letter ${idx + 1}` : 'Letter'
  return quoted ? `${letter} of ${quoted}` : letter
}
