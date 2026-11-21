// The one font used for sketch text: Inter Bold (latin, SIL OFL). Loaded once, shared by the UI, the
// kernel worker and the tests. opentype.js parses the .woff.
import * as opentype from 'opentype.js'
import interBoldUrl from '@fontsource/inter/files/inter-latin-700-normal.woff?url'

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
  getPath(x: number, y: number, fontSize: number): { commands: FontCommand[] }
}
/** The slice of an opentype.js Font that the sketch text code uses. */
export interface Font {
  unitsPerEm: number
  tables: { os2?: { sCapHeight?: number } }
  ascender: number
  charToGlyph(c: string): FontGlyph
}

interface OpentypeApi {
  parse(buffer: ArrayBuffer): Font
}

let font: Font | null = null
let loading: Promise<Font> | null = null
const listeners = new Set<() => void>()

function parseFont(buffer: ArrayBuffer): Font {
  const ns = opentype as unknown as Partial<OpentypeApi> & { default?: OpentypeApi }
  const parse = ns.parse ?? ns.default?.parse
  if (!parse) throw new Error('The text font parser is unavailable.')
  return parse(buffer)
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
