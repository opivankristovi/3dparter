import { describe, expect, it } from 'vitest'
import { buildGroups, faceNameAtTriangle, sortFaces } from './pick'

// Faces measured in index entries: 3 per triangle.
const faces = [
  { name: 'cap:start', start: 0, count: 6 },
  { name: 'side/a', start: 6, count: 6 },
  { name: 'side/b', start: 12, count: 6 },
  { name: 'side/c', start: 18, count: 12 },
  { name: 'cap:end', start: 30, count: 6 },
]

describe('faceNameAtTriangle', () => {
  const sorted = sortFaces(faces)
  it('finds the face for each triangle (index units, 3 per triangle)', () => {
    expect(faceNameAtTriangle(sorted, 0)).toBe('cap:start')
    expect(faceNameAtTriangle(sorted, 1)).toBe('cap:start')
    expect(faceNameAtTriangle(sorted, 2)).toBe('side/a')
    expect(faceNameAtTriangle(sorted, 3)).toBe('side/a')
    expect(faceNameAtTriangle(sorted, 4)).toBe('side/b')
    expect(faceNameAtTriangle(sorted, 6)).toBe('side/c')
    expect(faceNameAtTriangle(sorted, 9)).toBe('side/c')
    expect(faceNameAtTriangle(sorted, 10)).toBe('cap:end')
    expect(faceNameAtTriangle(sorted, 11)).toBe('cap:end')
  })

  it('returns null outside every range', () => {
    expect(faceNameAtTriangle(sorted, 12)).toBeNull()
    expect(faceNameAtTriangle(sorted, -1)).toBeNull()
    expect(faceNameAtTriangle([], 0)).toBeNull()
  })

  it('sorts unsorted input', () => {
    const shuffled = [faces[3], faces[0], faces[4], faces[2], faces[1]]
    expect(faceNameAtTriangle(sortFaces(shuffled), 5)).toBe('side/b')
  })
})

describe('buildGroups', () => {
  it('covers the whole buffer and picks materials by state', () => {
    const g = buildGroups(sortFaces(faces), 36, (n) => (n === 'side/a' ? 1 : 0))
    expect(g.reduce((s, x) => s + x.count, 0)).toBe(36)
    expect(g[1]).toEqual({ start: 6, count: 6, materialIndex: 1 })
  })

  it('fills gaps and the tail with material 0', () => {
    const g = buildGroups([{ name: 'x', start: 6, count: 6 }], 24, () => 2)
    expect(g).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 2 },
      { start: 12, count: 12, materialIndex: 0 },
    ])
  })
})
