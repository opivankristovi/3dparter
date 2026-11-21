// Reads the kerning pairs of the bundled font (Inter Bold, latin, SIL OFL) and writes
// src/sketch/text/kerningData.ts. Run it after changing the font file:  node scripts/gen-kerning.mjs
//
// Why: opentype.js 2.0 cannot read GPOS "extension" lookups (type 9), and that is where Inter keeps its
// kerning, so font.getKerningValue() answers 0 for every pair. This script reads the GPOS table itself.
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import * as opentypeNs from 'opentype.js'
const opentype = opentypeNs.parse ? opentypeNs : opentypeNs.default

const require = createRequire(import.meta.url)
const fontPath = require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff')
const raw = readFileSync(fontPath)

// ---- WOFF container ----------------------------------------------------------------------------
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
const tables = new Map()
for (let i = 0, n = dv.getUint16(12); i < n; i++) {
  const at = 44 + i * 20
  const tag = String.fromCharCode(...raw.subarray(at, at + 4))
  const offset = dv.getUint32(at + 4)
  const comp = dv.getUint32(at + 8)
  const orig = dv.getUint32(at + 12)
  const bytes = raw.subarray(offset, offset + comp)
  tables.set(tag, comp < orig ? inflateSync(bytes) : bytes)
}
const gposBytes = tables.get('GPOS')
if (!gposBytes) throw new Error('The font has no GPOS table.')
const g = new DataView(gposBytes.buffer, gposBytes.byteOffset, gposBytes.byteLength)
const u16 = (o) => g.getUint16(o)
const i16 = (o) => g.getInt16(o)
const u32 = (o) => g.getUint32(o)

// ---- GPOS: the lookups of the 'kern' feature ---------------------------------------------------
const scriptList = u16(4)
const featureList = u16(6)
const lookupList = u16(8)

function tagAt(o) {
  return String.fromCharCode(g.getUint8(o), g.getUint8(o + 1), g.getUint8(o + 2), g.getUint8(o + 3))
}

function featureIndexesOf(scriptTag) {
  const count = u16(scriptList)
  for (let i = 0; i < count; i++) {
    if (tagAt(scriptList + 2 + i * 6) !== scriptTag) continue
    const script = scriptList + u16(scriptList + 2 + i * 6 + 4)
    const def = u16(script)
    if (!def) return []
    const lang = script + def
    const n = u16(lang + 4)
    return Array.from({ length: n }, (_, k) => u16(lang + 6 + k * 2))
  }
  return null
}

const latn = featureIndexesOf('latn') ?? featureIndexesOf('DFLT') ?? []
const kernLookups = new Set()
for (const fi of latn) {
  const rec = featureList + 2 + fi * 6
  if (tagAt(rec) !== 'kern') continue
  const feature = featureList + u16(rec + 4)
  const n = u16(feature + 2)
  for (let k = 0; k < n; k++) kernLookups.add(u16(feature + 4 + k * 2))
}
const lookupOrder = [...kernLookups].sort((a, b) => a - b)

function coverageIndex(cov, glyph) {
  const format = u16(cov)
  if (format === 1) {
    const n = u16(cov + 2)
    for (let i = 0; i < n; i++) if (u16(cov + 4 + i * 2) === glyph) return i
    return -1
  }
  const n = u16(cov + 2)
  for (let i = 0; i < n; i++) {
    const r = cov + 4 + i * 6
    if (glyph >= u16(r) && glyph <= u16(r + 2)) return u16(r + 4) + (glyph - u16(r))
  }
  return -1
}

function classOf(def, glyph) {
  const format = u16(def)
  if (format === 1) {
    const start = u16(def + 2)
    const n = u16(def + 4)
    return glyph >= start && glyph < start + n ? u16(def + 6 + (glyph - start) * 2) : 0
  }
  const n = u16(def + 2)
  for (let i = 0; i < n; i++) {
    const r = def + 4 + i * 6
    if (glyph >= u16(r) && glyph <= u16(r + 2)) return u16(r + 4)
  }
  return 0
}

const valueSize = (fmt) => {
  let n = 0
  for (let b = 0; b < 8; b++) if (fmt & (1 << b)) n++
  return n * 2
}
/** XAdvance of a value record (0 when the format has none). */
function xAdvance(at, fmt) {
  if (!(fmt & 0x4)) return 0
  let o = at
  if (fmt & 0x1) o += 2
  if (fmt & 0x2) o += 2
  return i16(o)
}

/** The kerning one pair-adjustment subtable gives a pair: a number when it applies, null when it does not. */
function pairValue(sub, left, right) {
  const format = u16(sub)
  const cov = coverageIndex(sub + u16(sub + 2), left)
  if (cov < 0) return null
  const vf1 = u16(sub + 4)
  const vf2 = u16(sub + 6)
  if (format === 1) {
    const set = sub + u16(sub + 10 + cov * 2)
    const n = u16(set)
    const rec = 2 + valueSize(vf1) + valueSize(vf2)
    for (let i = 0; i < n; i++) {
      const at = set + 2 + i * rec
      if (u16(at) === right) return xAdvance(at + 2, vf1)
    }
    return null
  }
  const c1 = classOf(sub + u16(sub + 8), left)
  const c2 = classOf(sub + u16(sub + 10), right)
  const class2Count = u16(sub + 14)
  const rec = valueSize(vf1) + valueSize(vf2)
  return xAdvance(sub + 16 + (c1 * class2Count + c2) * rec, vf1)
}

function kerning(left, right) {
  let total = 0
  for (const li of lookupOrder) {
    const lookup = lookupList + u16(lookupList + 2 + li * 2)
    let type = u16(lookup)
    const n = u16(lookup + 4)
    for (let s = 0; s < n; s++) {
      let sub = lookup + u16(lookup + 6 + s * 2)
      let subType = type
      if (type === 9) {
        subType = u16(sub + 2)
        sub += u32(sub + 4)
      }
      if (subType !== 2) continue
      const v = pairValue(sub, left, right)
      if (v !== null) {
        total += v
        break
      }
    }
  }
  return total
}

// ---- pairs for the characters the font draws --------------------------------------------------
const font = opentype.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
const chars = []
for (let c = 33; c < 127; c++) chars.push(String.fromCharCode(c))
for (let c = 161; c < 256; c++) chars.push(String.fromCharCode(c))
const index = new Map(chars.map((ch) => [ch, font.charToGlyph(ch).index]))
const flat = []
for (const a of chars) {
  for (const b of chars) {
    if (!index.get(a) || !index.get(b)) continue
    const v = kerning(index.get(a), index.get(b))
    if (v !== 0) flat.push(a + b, v)
  }
}

const body = `// Kerning pairs of Inter Bold (latin, SIL OFL), in font units (2048 per em), as pair-of-characters, value, ...
// GENERATED by scripts/gen-kerning.mjs (opentype.js cannot read this font's GPOS extension lookups). Do not edit.
export const KERNING_UNITS_PER_EM = ${font.unitsPerEm}
export const KERNING_PAIRS: readonly (string | number)[] = ${JSON.stringify(flat)}
`
writeFileSync(new URL('../src/sketch/text/kerningData.ts', import.meta.url), body)
console.log(`kerning pairs: ${flat.length / 2}`)
