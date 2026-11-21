// Grid snap on or off, and what Alt does in each state.
import { describe, expect, it } from 'vitest'
import { GRID_SNAP_MM, noGridFor, snapPoint } from './geometry'

const snap = (gridSnap: boolean, altKey: boolean, targets: [number, number][] = []) =>
  snapPoint([3.4, 7.6], targets, 4, { noGrid: noGridFor(gridSnap, altKey) })

describe('grid snap setting', () => {
  it('on: the cursor rounds to the grid, Alt lets it go free', () => {
    expect(snap(true, false)).toEqual({ point: [3, 8], kind: 'grid' })
    expect(snap(true, true)).toEqual({ point: [3.4, 7.6], kind: 'none' })
  })

  it('off: the cursor is free, Alt turns the grid on while held', () => {
    expect(snap(false, false)).toEqual({ point: [3.4, 7.6], kind: 'none' })
    expect(snap(false, true)).toEqual({ point: [3, 8], kind: 'grid' })
  })

  it('point snapping works in both states', () => {
    for (const on of [true, false]) {
      const r = snap(on, false, [[3.5, 7.6]])
      expect(r.kind).toBe('endpoint')
      expect(r.point).toEqual([3.5, 7.6])
    }
  })

  it('the grid step is the one the indicator shows', () => {
    expect(GRID_SNAP_MM).toBe(1)
    expect(snapPoint([0.6, 0.4], [], 4).point).toEqual([GRID_SNAP_MM, 0])
  })
})
