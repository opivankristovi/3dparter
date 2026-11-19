// The raycast twin of a body mesh. Kept separate (and tested) because three-mesh-bvh would otherwise
// reorder the shared index buffer in place, which silently breaks the triangle -> face-name mapping
// used for both picking and highlight draw groups (BUG-001).
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

/**
 * Geometry for raycasting against a body. It shares the position buffer with the visible mesh, and its BVH
 * is built in `indirect` mode, so the index buffer keeps its original order and `hit.faceIndex` refers to
 * the kernel's triangle order (the order the face ranges are written in).
 */
export function createPickGeometry(position: THREE.BufferAttribute, index: THREE.BufferAttribute): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', position)
  geo.setIndex(index)
  geo.computeBoundsTree({ indirect: true })
  return geo
}
