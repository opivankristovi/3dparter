// The one font used for sketch text: Inter Bold (latin, SIL OFL). Loaded once, shared by the UI, the
// kernel worker and the tests. opentype.js parses the .woff.
import * as opentype from 'opentype.js'
import interBoldUrl from '@fontsource/inter/files/inter-latin-700-normal.woff?url'
import { KERNING_PAIRS, KERNING_UNITS_PER_EM } from './kerningData'

export interface FontCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z'
  x?: number
  y?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}
export interface FontGlyph {
  advanceWidth?: number
  unicode?: number
  getPath(x: number, y: number, fontSize: number): { commands: FontCommand[] }
}
/** The slice of an opentype.js Font that the sketch text code uses. */
export interface Font {
  unitsPerEm: number
  tables: { os2?: { sCapHeight?: number } }
  ascender: number
  charToGlyph(c: string): FontGlyph
  /** Kerning between two glyphs in font units (negative pulls them together). */
  getKerningValue?(left: FontGlyph, right: FontGlyph): number
}

interface OpentypeApi {
  parse(buffer: ArrayBuffer): Font
}

let font: Font | null = null
let loading: Promise<Font> | null = null
const listeners = new Set<() => void>()

let kernMap: Map<string, number> | null = null
function kernPairs(): Map<string, number> {
  if (!kernMap) {
    kernMap = new Map()
    for (let i = 0; i + 1 < KERNING_PAIRS.length; i += 2) kernMap.set(KERNING_PAIRS[i] as string, KERNING_PAIRS[i + 1] as number)
  }
  return kernMap
}

function parseFont(buffer: ArrayBuffer): Font {
  const ns = opentype as unknown as Partial<OpentypeApi> & { default?: OpentypeApi }
  const parse = ns.parse ?? ns.default?.parse
  if (!parse) throw new Error('The text font parser is unavailable.')
  const f = parse(buffer)
  // opentype.js cannot read this font's GPOS extension lookups, so its kerning is always 0. The pairs come
  // from scripts/gen-kerning.mjs instead (in font units of the bundled font; scaled to this font's em).
  f.getKerningValue = (left, right) => {
    if (!left.unicode || !right.unicode) return 0
    const v = kernPairs().get(String.fromCodePoint(left.unicode) + String.fromCodePoint(right.unicode)) ?? 0
    return (v * f.unitsPerEm) / KERNING_UNITS_PER_EM
  }
  return f
}

function set(f: Font): void {
  font = f
  for (const l of [...listeners]) l()
}

/** Loads the font once; later calls share the result. */
export function ensureFont(): Promise<Font> {
  if (font) return Promise.resolve(font)
  loading ??= fetch(interBoldUrl)
    .then((r) => {
      if (!r.ok) throw new Error('The text font could not be loaded.')
      return r.arrayBuffer()
    })
    .then((buf) => {
      const f = parseFont(buf)
      set(f)
      return f
    })
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

export function getLoadedFont(): Font | null {
  return font
}

/** Calls `fn` once the font has loaded (every time it is set). Returns an unsubscribe function. */
export function subscribeFont(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Tests (node): hand the font file's bytes in instead of fetching. */
export function setFontForTests(bytes: ArrayBuffer | Uint8Array): void {
  const ab =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes
  set(parseFont(ab))
}

/** Cap height in font units (falls back to 0.7 em). */
export function capHeight(f: Font): number {
  return f.tables.os2?.sCapHeight || f.unitsPerEm * 0.7
}
