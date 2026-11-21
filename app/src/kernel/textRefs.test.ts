// Whole-text profile refs ('<sketchId>/region:<textId>~*') and the curved sides of extruded text.
import { beforeAll, describe, expect, it } from 'vitest'
import type { SketchEntity, TextEntity } from '../doc/types'
import { textCurves } from '../sketch/text/outline'
import { loadTestFont } from '../sketch/text/testFont'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { docOf, extrudeFeature, line, ready, sketchFeature } from './testutil'

beforeAll(async () => {
  loadTestFont()
  await ready()
})

function volumeOf(k: Regenerator, id: string): number {
  const b = k.getBody(id)
  if (!b) return 0
  const m = meshBody(b, 'high')
  const P = m.positions
  let v = 0
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const a = m.indices[i] * 3
    const b2 = m.indices[i + 1] * 3
    const c = m.indices[i + 2] * 3
    v += (P[a] * (P[b2 + 1] * P[c + 2] - P[b2 + 2] * P[c + 1]) - P[a + 1] * (P[b2] * P[c + 2] - P[b2 + 2] * P[c]) + P[a + 2] * (P[b2] * P[c + 1] - P[b2 + 1] * P[c])) / 6
  }
  return Math.abs(v)
}

const text = (over: Partial<TextEntity> = {}): TextEntity => ({
  id: 't1',
  type: 'text',
  construction: false,
  position: [0, 0],
  text: 'AB',
  size: 10,
  rotation: 0,
  ...over,
})

describe('whole-text profile refs', () => {
  it('expand to every glyph region of the text', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [text({ text: 'HI' })])
    k.regenerate(docOf(sk), 1)
    const names = k.getSketch('s1')!.regions.map((r) => r.name)
    expect(names).toHaveLength(2)
    const whole = k.regenerate(docOf(sk, extrudeFeature('e1', ['s1/region:t1~*'], '2')), 2)
    expect(whole.statuses.every((s) => s.ok)).toBe(true)
    const vWhole = volumeOf(k, 'e1')
    const each = k.regenerate(docOf(sk, extrudeFeature('e2', names, '2')), 3)
    expect(each.statuses.every((s) => s.ok)).toBe(true)
    expect(vWhole).toBeGreaterThan(10)
    expect(volumeOf(k, 'e2')).toBeCloseTo(vWhole, 6)
    k.dispose()
  })

  it('pick up a letter added after the extrude (AB to ABC grows the volume)', () => {
    const k = new Regenerator()
    const ext = extrudeFeature('e1', ['s1/region:t1~*'], '2')
    const ab = sketchFeature('s1', 'XY', [text({ text: 'AB' })])
    expect(k.regenerate(docOf(ab, ext), 1).statuses.every((s) => s.ok)).toBe(true)
    const before = volumeOf(k, 'e1')
    const abc = sketchFeature('s1', 'XY', [text({ text: 'ABC' })])
    expect(k.regenerate(docOf(abc, ext), 2).statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'e1')).toBeGreaterThan(before + 5)
    k.dispose()
  })

  it('fail like a missing shape when the text has no glyphs left', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [text({ text: '' })])
    const res = k.regenerate(docOf(sk, extrudeFeature('e1', ['s1/region:t1~*'], '2')), 1)
    const st = res.statuses.find((s) => s.featureId === 'e1')!
    expect(st.ok).toBe(false)
    expect(st.message).toBeTruthy()
    k.dispose()
  })
})

describe('curved sides of extruded text', () => {
  it('"O" keeps one smooth side face per path command, and the volume matches a fine polyline', () => {
    const k = new Regenerator()
    const t = text({ text: 'O', size: 20 })
    const sk = sketchFeature('s1', 'XY', [t])
    k.regenerate(docOf(sk), 1)
    const res = k.regenerate(docOf(sk, extrudeFeature('e1', ['s1/region:t1~*'], '3')), 2)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    const body = k.getBody('e1')!
    const vCurved = volumeOf(k, 'e1')
    const sideNames = [...body.built.faceNames.values()].filter((n) => n.startsWith('e1/side/t1~'))
    const curves = textCurves({ entities: [t], constraints: [] }, loadTestFont())
    expect(sideNames.length).toBe(curves.size)
    // Facets would be dozens per contour; curves are a handful.
    const polylinePoints = [...curves.values()].reduce((n, c) => n + c.poly.length, 0)
    expect(sideNames.length).toBeLessThan(polylinePoints)
    expect(sideNames.length).toBeLessThan(40)
    expect(body.built.shape.faces.length).toBe(sideNames.length + 2)

    // The same glyph as a very fine polyline of the exact curves: the volumes agree within 0.5 %.
    const lines: SketchEntity[] = []
    for (const c of curves.values()) {
      const pts = c.kind === 'line' ? [c.pts[0], c.pts[1]] : sample(c.pts, 60)
      pts.slice(0, -1).forEach((p, i) => lines.push(line(`f${lines.length}`, p, pts[i + 1])))
    }
    const fine = sketchFeature('s2', 'XY', lines)
    k.regenerate(docOf(fine), 3)
    const names = k.getSketch('s2')!.regions.map((r) => r.name)
    expect(names).toHaveLength(1)
    k.regenerate(docOf(fine, extrudeFeature('e2', names, '3')), 4)
    const vFine = volumeOf(k, 'e2')
    expect(Math.abs(vCurved - vFine) / vFine).toBeLessThan(0.005)
    k.dispose()
  })
})

function sample(pts: [number, number][], n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    let cur = pts
    while (cur.length > 1) {
      const next: [number, number][] = []
      for (let j = 0; j + 1 < cur.length; j++) {
        next.push([cur[j][0] + (cur[j + 1][0] - cur[j][0]) * t, cur[j][1] + (cur[j + 1][1] - cur[j][1]) * t])
      }
      cur = next
    }
    out.push(cur[0])
  }
  return out
}
