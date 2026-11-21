// A small cube that shows which way the camera looks. Its faces are buttons: each flies the camera to that view.
// Drawn with CSS 3D transforms and re-posed after every rendered frame, so it follows orbiting and fly-to moves.
import { useEffect, useMemo, useRef } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import * as THREE from 'three'
import type { Vec3 } from '../doc/types'
import { layoutPx } from '../ui/layout'
import { cn } from '../ui/cn'
import type { ViewportEngine } from './engine'

interface FaceDef {
  label: string
  /** Accessible name. */
  name: string
  /** Outward normal: also the direction from the model to the camera for that view. */
  normal: Vec3
  /** The world direction that points up the screen when looking at the face from outside. */
  up: Vec3
}

// World axes: Z up. Top looks down -Z, Front is seen from -Y, Right from +X.
const FACES: FaceDef[] = [
  { label: 'Top', name: 'View from top', normal: [0, 0, 1], up: [0, 1, 0] },
  { label: 'Bottom', name: 'View from bottom', normal: [0, 0, -1], up: [0, -1, 0] },
  { label: 'Front', name: 'View from front', normal: [0, -1, 0], up: [0, 0, 1] },
  { label: 'Back', name: 'View from back', normal: [0, 1, 0], up: [0, 0, 1] },
  { label: 'Left', name: 'View from left', normal: [-1, 0, 0], up: [0, 0, 1] },
  { label: 'Right', name: 'View from right', normal: [1, 0, 0], up: [0, 0, 1] },
]

/** CSS matrix3d that puts a size x size square (origin at its top-left) on the cube face. Columns: right, down, normal, offset. */
function faceMatrix(f: FaceDef, size: number): string {
  const n = new THREE.Vector3(...f.normal)
  const u = new THREE.Vector3(...f.up)
  const r = new THREE.Vector3().crossVectors(u, n)
  const d = u.clone().negate()
  const t = n.clone().multiplyScalar(size / 2).addScaledVector(r, -size / 2).addScaledVector(d, -size / 2)
  return `matrix3d(${[r.x, r.y, r.z, 0, d.x, d.y, d.z, 0, n.x, n.y, n.z, 0, t.x, t.y, t.z, 1].join(',')})`
}

export interface OrientationCubeProps {
  engine: ViewportEngine | null
}

export function OrientationCube({ engine }: OrientationCubeProps) {
  const cube = useRef<HTMLDivElement>(null)
  const size = useMemo(() => layoutPx('viewcube-size', 48), [])

  useEffect(() => {
    if (!engine) return
    const q = new THREE.Quaternion()
    const m = new THREE.Matrix4()
    const pose = () => {
      const el = cube.current
      if (!el) return
      // World -> camera rotation, then flip y: CSS has y pointing down.
      m.makeRotationFromQuaternion(q.copy(engine.camera.quaternion).invert())
      const e = m.elements.slice()
      e[1] = -e[1]
      e[5] = -e[5]
      e[9] = -e[9]
      el.style.transform = `matrix3d(${e.join(',')})`
    }
    pose()
    return engine.onFrame(pose)
  }, [engine])

  const rollBtn =
    'flex size-6 cursor-pointer items-center justify-center rounded-sm text-text-muted transition-colors duration-(--motion-fast) enabled:hover:bg-surface-sunken enabled:hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-text-disabled'

  return (
    <div role="group" aria-label="View orientation" className="flex flex-col items-center">
      <div
        className="relative size-(--layout-viewcol-w)"
        style={{ perspective: 'calc(var(--layout-viewcube-size) * 6)' }}
      >
        <div
          ref={cube}
          className="absolute top-1/2 left-1/2 size-0 [transform-origin:0_0] [transform-style:preserve-3d]"
          style={{ transform: 'matrix3d(1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1)' }}
        >
          {FACES.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-label={f.name}
              disabled={!engine}
              onClick={() => engine?.viewFrom(f.normal)}
              style={{ transform: faceMatrix(f, size) }}
              className="absolute top-0 left-0 size-(--layout-viewcube-size) cursor-pointer border border-border bg-surface-raised text-xs text-text transition-colors duration-(--motion-fast) [backface-visibility:hidden] [transform-origin:0_0] enabled:hover:bg-accent-subtle enabled:hover:text-accent disabled:cursor-not-allowed disabled:text-text-disabled"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 pb-1">
        <button
          type="button"
          aria-label="Rotate view 90° left"
          title="Rotate view 90° left"
          disabled={!engine}
          onClick={() => engine?.rollView(-90)}
          className={cn(rollBtn)}
        >
          <RotateCcw size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Rotate view 90° right"
          title="Rotate view 90° right"
          disabled={!engine}
          onClick={() => engine?.rollView(90)}
          className={cn(rollBtn)}
        >
          <RotateCw size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
