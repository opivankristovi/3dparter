import { describe, expect, it } from 'vitest'
import { coveredRegions, glyphRegionsOf, isWholeTextRef, refCoversRegion, textProfileLabel, wholeTextName } from './regionRef'

const R = (n: number) => ({ name: `s1/region:t1~${n}` })

describe('text profile refs', () => {
  it('turns a glyph region name into the whole-text name', () => {
    expect(wholeTextName('s1/region:t1~3')).toBe('s1/region:t1~*')
    expect(wholeTextName('s1/region:a1,a2,a3')).toBeNull()
    expect(isWholeTextRef('s1/region:t1~*')).toBe(true)
    expect(isWholeTextRef('s1/region:t1~3')).toBe(false)
  })

  it('orders glyph regions numerically and says which regions a ref covers', () => {
    const regions = [R(10), R(2), R(1), { name: 's1/region:a1,a2' }, { name: 's1/region:t2~0' }]
    expect(glyphRegionsOf(regions, 's1/region:t1~*').map((r) => r.name)).toEqual(['s1/region:t1~1', 's1/region:t1~2', 's1/region:t1~10'])
    expect(coveredRegions(regions, 's1/region:t1~2')).toEqual([R(2)])
    expect(refCoversRegion('s1/region:t1~*', 's1/region:t1~10')).toBe(true)
    expect(refCoversRegion('s1/region:t1~*', 's1/region:t2~0')).toBe(false)
    expect(refCoversRegion('s1/region:t1~2', 's1/region:t1~3')).toBe(false)
  })

  it('labels refs for the cards without raw ids', () => {
    const wording = (sk: string, id: string) => (sk === 's1' && id === 't1' ? 'HELLO' : undefined)
    const regions = [R(0), R(1), R(2)]
    expect(textProfileLabel('s1/region:t1~*', wording, regions)).toBe('Text “HELLO”')
    expect(textProfileLabel('s1/region:t1~2', wording, regions)).toBe('Letter 3 of “HELLO”')
    expect(textProfileLabel('s1/region:a1,a2', wording, regions)).toBeNull()
  })
})
