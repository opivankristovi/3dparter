export interface StlInfo {
  binary: boolean
  triangles: number
  byteLength: number
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
  /** Signed volume in mm^3 (positive when the triangles wind outward). */
  volume: number
}

/** Parses a binary STL: 80-byte header, uint32 triangle count, then 50 bytes per triangle. */
export function parseBinaryStl(buf: Buffer): StlInfo {
  if (buf.length < 84) throw new Error(`STL too short: ${buf.length} bytes`)
  const n = buf.readUInt32LE(80)
  const expected = 84 + 50 * n
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let vol = 0
  if (buf.length === expected) {
    for (let t = 0; t < n; t++) {
      const o = 84 + 50 * t + 12 // skip the normal
      const v: number[][] = []
      for (let k = 0; k < 3; k++) {
        const p = [buf.readFloatLE(o + 12 * k), buf.readFloatLE(o + 12 * k + 4), buf.readFloatLE(o + 12 * k + 8)]
        v.push(p)
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i])
          max[i] = Math.max(max[i], p[i])
        }
      }
      const [a, b, c] = v
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return {
    binary: buf.length === expected,
    triangles: n,
    byteLength: buf.length,
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    volume: vol,
  }
}
