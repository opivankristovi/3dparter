// The three.js side of the viewport, managed imperatively (React only owns the <canvas>).
// Render on demand: a frame is drawn only when something changed or the camera moves.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createPickGeometry } from './pickGeometry'
import { ORIGIN_PLANES, ORIGIN_PLANE_LABELS } from '../doc/types'
import type { OriginPlaneName, PlaneFrame, ProjectDocument, Ref, SketchEntity, Vec2, Vec3 } from '../doc/types'
import type { MeshData, SketchRegionData } from '../kernel/api'
import { circlePolyline, localToWorld, rayPlane, worldToLocal } from '../sketch/geometry'
import { buildGroups, faceNameAtTriangle, sortFaces } from './pick'
import type { FaceRange } from './pick'


const TOKEN_NAMES = [
  'viewport-bg',
  'viewport-grid',
  'axis-x',
  'axis-y',
  'axis-z',
  'body',
  'edge',
  'preselect',
  'selection',
  'sketch-under',
  'sketch-construction',
  'accent-subtle',
  'accent',
  'text',
] as const
type TokenName = (typeof TOKEN_NAMES)[number]
type Palette = Record<TokenName, THREE.Color>

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  const out = {} as Palette
  for (const n of TOKEN_NAMES) {
    const c = new THREE.Color(0.5, 0.5, 0.5)
    const v = style.getPropertyValue(`--t-color-${n}`).trim()
    if (v) c.set(v)
    out[n] = c
  }
  return out
}

/** What the pointer can pick right now. */
export interface PickMode {
  bodies: boolean
  planes: boolean
  regions: boolean
}

export interface SketchGroup {
  id: string
  frame: PlaneFrame
  entities: SketchEntity[]
  active: boolean
}

interface BodyObj {
  id: string
  data: MeshData
  sorted: FaceRange[]
  group: THREE.Group
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  pick: THREE.Mesh
  geo: THREE.BufferGeometry
  pickGeo: THREE.BufferGeometry
  edgeGeo: THREE.BufferGeometry
  visible: boolean
}

interface RegionObj {
  name: string
  mesh: THREE.Mesh
  outline: THREE.LineSegments
}

const PLANE_SIZE = 80
const DEFAULT_DIR = new THREE.Vector3(1, -1, 0.8).normalize()
const DEFAULT_DISTANCE = 250

function segmentsOf(points: Vec3[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < points.length; i++) out.push(...points[i], ...points[i + 1])
  return out
}

/** Entity outline as world-space line segments (flat xyz pairs). */
export function entitySegments(e: SketchEntity, frame: PlaneFrame): number[] {
  if (e.type === 'line') return [...localToWorld(e.a, frame), ...localToWorld(e.b, frame)]
  if (e.type === 'circle') return segmentsOf(circlePolyline(e.center, e.radius).map((p) => localToWorld(p, frame)))
  let end = e.endAngle
  while (end <= e.startAngle) end += Math.PI * 2
  const pts: Vec3[] = []
  const n = 48
  for (let i = 0; i <= n; i++) {
    const t = e.startAngle + ((end - e.startAngle) * i) / n
    pts.push(localToWorld([e.center[0] + e.radius * Math.cos(t), e.center[1] + e.radius * Math.sin(t)], frame))
  }
  return segmentsOf(pts)
}

function lineGeometry(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return g
}

export class ViewportEngine {
  readonly canvas: HTMLCanvasElement
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private palette: Palette = readPalette()
  private disposed = false
  private raf = 0

  /** Scene parts that are not the model (hidden for thumbnails). */
  private helpers = new THREE.Group()
  private bodiesGroup = new THREE.Group()
  private grid = new THREE.Group()
  private planesGroup = new THREE.Group()
  private regionsGroup = new THREE.Group()
  private sketchGroup = new THREE.Group()
  private marksGroup = new THREE.Group()
  private previewGroup = new THREE.Group()
  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight

  private bodies = new Map<string, BodyObj>()
  private regions: RegionObj[] = []
  private planeMeshes = new Map<OriginPlaneName, THREE.Mesh>()
  private planeLabels: THREE.Sprite[] = []
  private snapDot: THREE.Points
  private snapDotMat: THREE.PointsMaterial

  // Materials shared by every object of a kind. Index = highlight state (0 normal, 1 hover, 2 selected, 3 both).
  private bodyMats: THREE.MeshStandardMaterial[] = []
  private planeMats: THREE.MeshBasicMaterial[] = []
  private regionMats: THREE.MeshBasicMaterial[] = []
  private pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  private edgeMat = new THREE.LineBasicMaterial()
  private sketchMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true })
  private sketchInactiveMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.55 })
  private regionLineMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.8 })
  private hoverLineMat = new THREE.LineBasicMaterial({ depthTest: false })
  private selectLineMat = new THREE.LineBasicMaterial({ depthTest: false })
  private previewMat = new THREE.LineBasicMaterial({ depthTest: false })
  private gridMinorMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 })
  private gridMajorMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 })
  private axisMats: THREE.LineBasicMaterial[] = []
  private planeLineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 })

  private mode: PickMode = { bodies: true, planes: false, regions: false }
  private pickEnabled = true
  private planesVisible = false
  private hover: Ref | null = null
  private selection: Ref[] = []

  private raycaster = new THREE.Raycaster()
  private down: { x: number; y: number } | null = null
  private moveEvt: PointerEvent | null = null
  private hoverRaf = 0
  private anim: {
    t0: number
    dur: number
    fromDir: THREE.Vector3
    qTotal: THREE.Quaternion
    fromDist: number
    toDist: number
    fromTarget: THREE.Vector3
    toTarget: THREE.Vector3
  } | null = null
  private cleanups: (() => void)[] = []

  /** Called on a left click (not after a drag) while picking is enabled. null = empty space. */
  onPick: (ref: Ref | null, additive: boolean) => void = () => {}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 20000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.copy(DEFAULT_DIR).multiplyScalar(DEFAULT_DISTANCE)
    this.camera.lookAt(0, 0, 0)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = false
    this.controls.zoomToCursor = true
    // Left button is for picking and sketching, so it does nothing here.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.controls.addEventListener('change', this.requestRender)
    this.controls.addEventListener('start', () => {
      this.anim = null
    })

    this.hemi = new THREE.HemisphereLight(new THREE.Color(1, 1, 1), new THREE.Color(0.45, 0.45, 0.5), 1.6)
    this.sun = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1.8)
    this.scene.add(this.hemi, this.sun, this.sun.target)

    for (let i = 0; i < 4; i++) {
      this.bodyMats.push(
        new THREE.MeshStandardMaterial({
          roughness: 0.65,
          metalness: 0.05,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      )
      this.planeMats.push(
        new THREE.MeshBasicMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      )
      this.regionMats.push(
        new THREE.MeshBasicMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
    }
    for (let i = 0; i < 3; i++) this.axisMats.push(new THREE.LineBasicMaterial())

    this.buildStatic()
    this.helpers.add(this.grid, this.planesGroup, this.regionsGroup, this.sketchGroup, this.marksGroup, this.previewGroup)
    this.scene.add(this.bodiesGroup, this.helpers)

    const dotCanvas = document.createElement('canvas')
    dotCanvas.width = dotCanvas.height = 32
    const ctx = dotCanvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'white'
      ctx.beginPath()
      ctx.arc(16, 16, 14, 0, Math.PI * 2)
      ctx.fill()
    }
    this.snapDotMat = new THREE.PointsMaterial({
      size: 9,
      sizeAttenuation: false,
      map: new THREE.CanvasTexture(dotCanvas),
      transparent: true,
      alphaTest: 0.4,
      depthTest: false,
    })
    this.snapDot = new THREE.Points(new THREE.BufferGeometry(), this.snapDotMat)
    this.snapDot.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    this.snapDot.visible = false
    this.snapDot.renderOrder = 20
    this.snapDot.frustumCulled = false
    this.previewGroup.add(this.snapDot)

    this.applyPalette()
    this.planesGroup.visible = false

    // Size and pixel ratio.
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(canvas)
    this.cleanups.push(() => ro.disconnect())
    this.resize()

    // Theme changes.
    const mo = new MutationObserver(() => this.refreshPalette())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => this.refreshPalette()
    mq.addEventListener('change', onScheme)
    this.cleanups.push(() => {
      mo.disconnect()
      mq.removeEventListener('change', onScheme)
    })

    // Pointer picking.
    const onMove = (e: PointerEvent) => {
      this.moveEvt = e
      if (e.buttons !== 0 || !this.pickEnabled) return
      if (!this.hoverRaf) {
        this.hoverRaf = requestAnimationFrame(() => {
          this.hoverRaf = 0
          if (this.moveEvt) this.updateHover(this.moveEvt)
        })
      }
    }
    const onLeave = () => this.setHover(null)
    const onDown = (e: PointerEvent) => {
      this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    }
    const onClick = (e: MouseEvent) => {
      if (!this.pickEnabled || e.button !== 0) return
      const d = this.down
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
      const hit = this.pickAt(e.clientX, e.clientY)
      this.onPick(hit, e.shiftKey)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('click', onClick)
    this.cleanups.push(() => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('click', onClick)
      if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf)
    })

    this.requestRender()
  }

  // ---- frame loop -----------------------------------------------------------------------------

  requestRender = () => {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed) return
    if (this.anim) this.stepAnim(now)
    this.renderNow()
    if (this.anim) this.requestRender()
  }

  renderNow() {
    const dist = this.camera.position.distanceTo(this.controls.target)
    const near = Math.max(0.05, dist * 0.01)
    const far = dist * 100 + 5000
    if (Math.abs(near - this.camera.near) > 1e-6 || Math.abs(far - this.camera.far) > 1e-3) {
      this.camera.near = near
      this.camera.far = far
      this.camera.updateProjectionMatrix()
    }
    this.sun.position.copy(this.camera.position)
    this.sun.target.position.copy(this.controls.target)
    this.renderer.render(this.scene, this.camera)
  }

  private resize() {
    if (this.disposed) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  // ---- colours --------------------------------------------------------------------------------

  private refreshPalette() {
    this.palette = readPalette()
    this.applyPalette()
    this.requestRender()
  }

  private applyPalette() {
    const p = this.palette
    this.renderer.setClearColor(p['viewport-bg'])
    const base = p.body
    const tint = (to: THREE.Color, k: number) => base.clone().lerp(to, k)
    this.bodyMats[0].color.copy(base)
    this.bodyMats[1].color.copy(tint(p.preselect, 0.4))
    this.bodyMats[2].color.copy(tint(p.selection, 0.5))
    this.bodyMats[3].color.copy(tint(p.selection, 0.5).lerp(p.preselect, 0.35))
    const states: [THREE.Color, number][] = [
      [p['accent-subtle'], 0.55],
      [p.preselect, 0.35],
      [p.selection, 0.4],
      [p.selection, 0.5],
    ]
    states.forEach(([c, o], i) => {
      this.planeMats[i].color.copy(c)
      this.planeMats[i].opacity = o
    })
    const rstates: [THREE.Color, number][] = [
      [p['accent-subtle'], 0.85],
      [p.preselect, 0.5],
      [p.selection, 0.5],
      [p.selection, 0.65],
    ]
    rstates.forEach(([c, o], i) => {
      this.regionMats[i].color.copy(c)
      this.regionMats[i].opacity = o
    })
    this.edgeMat.color.copy(p.edge)
    this.sketchMat.color.copy(p['sketch-under'])
    this.sketchInactiveMat.color.copy(p['sketch-under'])
    this.regionLineMat.color.copy(p['sketch-under'])
    this.hoverLineMat.color.copy(p.preselect)
    this.selectLineMat.color.copy(p.selection)
    this.previewMat.color.copy(p['sketch-under'])
    this.gridMinorMat.color.copy(p['viewport-grid'])
    this.gridMajorMat.color.copy(p['viewport-grid'])
    this.planeLineMat.color.copy(p['viewport-grid'])
    this.axisMats[0].color.copy(p['axis-x'])
    this.axisMats[1].color.copy(p['axis-y'])
    this.axisMats[2].color.copy(p['axis-z'])
    this.snapDotMat.color.copy(p.accent)
    this.drawLabels()
  }

  // ---- static scene ---------------------------------------------------------------------------

  private buildStatic() {
    const minor: number[] = []
    const major: number[] = []
    const extent = 500
    for (let v = -extent; v <= extent; v += 10) {
      const target = v % 100 === 0 ? major : minor
      target.push(-extent, v, -0.05, extent, v, -0.05, v, -extent, -0.05, v, extent, -0.05)
    }
    const minorLines = new THREE.LineSegments(lineGeometry(minor), this.gridMinorMat)
    const majorLines = new THREE.LineSegments(lineGeometry(major), this.gridMajorMat)
    minorLines.frustumCulled = majorLines.frustumCulled = false
    this.grid.add(minorLines, majorLines)

    const axes: Vec3[] = [
      [100, 0, 0],
      [0, 100, 0],
      [0, 0, 100],
    ]
    axes.forEach((end, i) => {
      const l = new THREE.Line(lineGeometry([0, 0, 0, ...end]), this.axisMats[i])
      l.frustumCulled = false
      this.grid.add(l)
    })

    const planeGeo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)
    for (const name of Object.keys(ORIGIN_PLANES) as OriginPlaneName[]) {
      const f = ORIGIN_PLANES[name]
      const mesh = new THREE.Mesh(planeGeo, this.planeMats[0])
      mesh.matrixAutoUpdate = false
      mesh.matrix.makeBasis(new THREE.Vector3(...f.xDir), new THREE.Vector3(...f.yDir), new THREE.Vector3(...f.normal))
      mesh.matrixWorldNeedsUpdate = true
      mesh.userData = { kind: 'originPlane', name }
      this.planeMeshes.set(name, mesh)
      const h = PLANE_SIZE / 2
      const corners: Vec2[] = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ]
      const outline = new THREE.LineLoop(lineGeometry(corners.flatMap((c) => localToWorld(c, f))), this.planeLineMat)
      outline.frustumCulled = false
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }))
      sprite.userData = { plane: name }
      const lp = localToWorld([0, -h + 7], f)
      sprite.position.set(lp[0], lp[1], lp[2])
      sprite.scale.set(22, 8.25, 1)
      sprite.renderOrder = 10
      this.planeLabels.push(sprite)
      this.planesGroup.add(mesh, outline, sprite)
    }
  }

  private drawLabels() {
    for (const s of this.planeLabels) {
      const mat = s.material as THREE.SpriteMaterial
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 96
      const ctx = c.getContext('2d')
      if (!ctx) continue
      ctx.font = '600 52px Inter Variable, Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = this.palette.text.getStyle(THREE.SRGBColorSpace)
      ctx.fillText(ORIGIN_PLANE_LABELS[s.userData.plane as OriginPlaneName], 128, 50)
      mat.map?.dispose()
      mat.map = new THREE.CanvasTexture(c)
      mat.map.colorSpace = THREE.SRGBColorSpace
      mat.needsUpdate = true
    }
  }

  // ---- bodies ---------------------------------------------------------------------------------

  /** Replaces the rendered bodies. Geometry of bodies that went away or changed is disposed. */
  setBodies(meshes: Map<string, MeshData>, appearance: ProjectDocument['bodies']) {
    for (const [id, obj] of this.bodies) {
      if (meshes.get(id) !== obj.data) {
        this.disposeBody(obj)
        this.bodies.delete(id)
      }
    }
    for (const [id, data] of meshes) {
      if (!this.bodies.has(id)) this.bodies.set(id, this.buildBody(id, data))
    }
    for (const obj of this.bodies.values()) {
      obj.visible = appearance[obj.id]?.visible !== false
      obj.group.visible = obj.visible
    }
    this.refreshHighlights()
  }

  private buildBody(id: string, data: MeshData): BodyObj {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))

    // A twin geometry for raycasting: same buffers, no draw groups, with a BVH.
    const pickGeo = createPickGeometry(geo.getAttribute('position') as THREE.BufferAttribute, geo.getIndex()!)

    const mesh = new THREE.Mesh(geo, this.bodyMats)
    const pick = new THREE.Mesh(pickGeo, this.pickMat)
    pick.userData = { kind: 'body', bodyId: id }

    let n = 0
    for (const e of data.edges) n += e.points.length
    const lines = new Float32Array(n)
    let o = 0
    for (const e of data.edges) {
      lines.set(e.points, o)
      o += e.points.length
    }
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(lines, 3))
    const edges = new THREE.LineSegments(edgeGeo, this.edgeMat)

    const group = new THREE.Group()
    group.add(mesh, edges)
    this.bodiesGroup.add(group)
    this.requestRender()
    return { id, data, sorted: sortFaces(data.faces), group, mesh, edges, pick, geo, pickGeo, edgeGeo, visible: true }
  }

  private disposeBody(obj: BodyObj) {
    this.bodiesGroup.remove(obj.group)
    obj.geo.dispose()
    obj.edgeGeo.dispose()
    obj.pickGeo.disposeBoundsTree()
    obj.pickGeo.dispose()
    this.requestRender()
  }

  // ---- planes, regions, selection ---------------------------------------------------------------

  setPlanesVisible(v: boolean) {
    this.planesVisible = v
    this.planesGroup.visible = v
    this.requestRender()
  }

  setPickMode(mode: PickMode, enabled: boolean) {
    this.mode = mode
    this.pickEnabled = enabled
    if (!enabled) this.setHover(null)
  }

  setCursor(cursor: string) {
    this.canvas.style.cursor = cursor
  }

  setSelection(refs: Ref[]) {
    this.selection = refs
    this.refreshHighlights()
  }

  setRegions(list: SketchRegionData[]) {
    for (const r of this.regions) {
      this.regionsGroup.remove(r.mesh, r.outline)
      r.mesh.geometry.dispose()
      r.outline.geometry.dispose()
    }
    this.regions = []
    for (const r of list) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(r.fill.positions, 3))
      geo.setIndex(new THREE.BufferAttribute(r.fill.indices, 1))
      const mesh = new THREE.Mesh(geo, this.regionMats[0])
      mesh.userData = { kind: 'sketchRegion', name: r.name }
      mesh.renderOrder = 1
      const seg: number[] = []
      for (const loop of r.loops) {
        for (let i = 0; i + 3 < loop.length; i += 3) seg.push(loop[i], loop[i + 1], loop[i + 2], loop[i + 3], loop[i + 4], loop[i + 5])
      }
      const outline = new THREE.LineSegments(lineGeometry(seg), this.regionLineMat)
      outline.renderOrder = 4
      this.regionsGroup.add(mesh, outline)
      this.regions.push({ name: r.name, mesh, outline })
    }
    this.refreshHighlights()
  }

  private stateOf(kind: Ref['kind'], name: string): number {
    const sel = this.selection.some((r) => r.kind === kind && r.name === name)
    const hov = this.hover?.kind === kind && this.hover.name === name
    return (sel ? 2 : 0) + (hov ? 1 : 0)
  }

  private refreshHighlights() {
    for (const obj of this.bodies.values()) {
      const bodySel = this.selection.some((r) => r.kind === 'body' && r.name === obj.id)
      const total = obj.data.indices.length
      const groups = buildGroups(obj.sorted, total, (face) => {
        const s = this.stateOf('face', face)
        return bodySel ? Math.max(s, 2) : s
      })
      obj.geo.clearGroups()
      for (const g of groups) obj.geo.addGroup(g.start, g.count, g.materialIndex)
    }
    for (const [name, mesh] of this.planeMeshes) mesh.material = this.planeMats[this.stateOf('originPlane', name)]
    for (const r of this.regions) r.mesh.material = this.regionMats[this.stateOf('sketchRegion', r.name)]
    this.requestRender()
  }

  // ---- picking --------------------------------------------------------------------------------

  private setNdc(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera)
  }

  pickAt(clientX: number, clientY: number): Ref | null {
    this.scene.updateMatrixWorld()
    this.setNdc(clientX, clientY)
    const objs: THREE.Object3D[] = []
    if (this.mode.bodies) for (const b of this.bodies.values()) if (b.visible) objs.push(b.pick)
    if (this.mode.planes && this.planesVisible) objs.push(...this.planeMeshes.values())
    if (this.mode.regions) for (const r of this.regions) objs.push(r.mesh)
    if (objs.length === 0) return null
    const hit = this.raycaster.intersectObjects(objs, false)[0]
    if (!hit) return null
    const ud = hit.object.userData as { kind: string; name?: string; bodyId?: string }
    if (ud.kind === 'originPlane') return { kind: 'originPlane', name: ud.name as string }
    if (ud.kind === 'sketchRegion') return { kind: 'sketchRegion', name: ud.name as string }
    const body = this.bodies.get(ud.bodyId as string)
    if (!body) return null
    const face = hit.faceIndex == null ? null : faceNameAtTriangle(body.sorted, hit.faceIndex)
    return face ? { kind: 'face', name: face } : { kind: 'body', name: body.id }
  }

  private updateHover(e: PointerEvent) {
    this.setHover(this.pickAt(e.clientX, e.clientY))
  }

  private setHover(ref: Ref | null) {
    const same = this.hover?.kind === ref?.kind && this.hover?.name === ref?.name
    if (same) return
    this.hover = ref
    this.canvas.style.cursor = ref ? 'pointer' : ''
    this.refreshHighlights()
  }

  // ---- sketch drawing support -------------------------------------------------------------------

  /** Local plane coordinates under the pointer, or null if the ray misses the plane. */
  localPointAt(clientX: number, clientY: number, frame: PlaneFrame): Vec2 | null {
    this.setNdc(clientX, clientY)
    const r = this.raycaster.ray
    const hit = rayPlane([r.origin.x, r.origin.y, r.origin.z], [r.direction.x, r.direction.y, r.direction.z], frame)
    return hit ? worldToLocal(hit, frame) : null
  }

  /** Screen pixels per millimetre at a world point (perspective: depends on distance from the camera). */
  pixelsPerMmAt(world: Vec3): number {
    const fwd = this.camera.getWorldDirection(new THREE.Vector3())
    const v = new THREE.Vector3(...world).sub(this.camera.position)
    const depth = Math.max(1e-6, v.dot(fwd))
    const h = this.canvas.clientHeight
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * depth)
  }

  /** Client (page) coordinates of a world point. */
  worldToClient(world: Vec3): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector3(...world).project(this.camera)
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
  }

  setSketches(groups: SketchGroup[]) {
    this.disposeChildren(this.sketchGroup)
    for (const g of groups) {
      const seg: number[] = []
      for (const e of g.entities) if (!e.construction) seg.push(...entitySegments(e, g.frame))
      if (seg.length === 0) continue
      const lines = new THREE.LineSegments(lineGeometry(seg), g.active ? this.sketchMat : this.sketchInactiveMat)
      lines.renderOrder = 5
      lines.frustumCulled = false
      this.sketchGroup.add(lines)
    }
    this.requestRender()
  }

  /** Hover and selection marks for sketch entities. */
  setSketchMarks(frame: PlaneFrame | null, hover: SketchEntity | null, selected: SketchEntity[]) {
    this.disposeChildren(this.marksGroup)
    if (frame) {
      const add = (ents: SketchEntity[], mat: THREE.LineBasicMaterial, order: number) => {
        const seg: number[] = []
        for (const e of ents) seg.push(...entitySegments(e, frame))
        if (seg.length === 0) return
        const l = new THREE.LineSegments(lineGeometry(seg), mat)
        l.renderOrder = order
        l.frustumCulled = false
        this.marksGroup.add(l)
      }
      add(selected, this.selectLineMat, 7)
      if (hover) add([hover], this.hoverLineMat, 8)
    }
    this.requestRender()
  }

  /** Rubber-band geometry while drawing (local polylines) and the snap dot. */
  setPreview(frame: PlaneFrame | null, polylines: Vec2[][], dot: Vec2 | null) {
    for (const c of [...this.previewGroup.children]) {
      if (c !== this.snapDot) {
        this.previewGroup.remove(c)
        ;(c as THREE.LineSegments).geometry.dispose()
      }
    }
    if (frame) {
      const seg: number[] = []
      for (const pl of polylines) seg.push(...segmentsOf(pl.map((p) => localToWorld(p, frame))))
      if (seg.length) {
        const l = new THREE.LineSegments(lineGeometry(seg), this.previewMat)
        l.renderOrder = 6
        l.frustumCulled = false
        this.previewGroup.add(l)
      }
      if (dot) {
        const w = localToWorld(dot, frame)
        this.snapDot.position.set(w[0], w[1], w[2])
        this.snapDot.visible = true
      } else this.snapDot.visible = false
    } else this.snapDot.visible = false
    this.requestRender()
  }

  private disposeChildren(group: THREE.Group) {
    for (const c of [...group.children]) {
      group.remove(c)
      ;(c as THREE.LineSegments).geometry?.dispose()
    }
  }

  // ---- camera ---------------------------------------------------------------------------------

  private reducedMotion(): boolean {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private flyTo(target: THREE.Vector3, dir: THREE.Vector3, dist: number) {
    const fromTarget = this.controls.target.clone()
    const fromVec = this.camera.position.clone().sub(fromTarget)
    const fromDist = fromVec.length()
    const fromDir = fromVec.normalize()
    const toDir = dir.clone().normalize()
    if (this.reducedMotion()) {
      this.anim = null
      this.controls.target.copy(target)
      this.camera.position.copy(target).addScaledVector(toDir, dist)
      this.controls.update()
      this.requestRender()
      return
    }
    const css = getComputedStyle(document.documentElement).getPropertyValue('--t-motion-camera')
    const dur = Number.parseFloat(css) || 350
    this.anim = {
      t0: performance.now(),
      dur,
      fromDir,
      qTotal: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      fromDist,
      toDist: dist,
      fromTarget,
      toTarget: target.clone(),
    }
    this.requestRender()
  }

  private stepAnim(now: number) {
    const a = this.anim
    if (!a) return
    const u = Math.min(1, Math.max(0, (now - a.t0) / a.dur))
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
    const q = new THREE.Quaternion().slerp(a.qTotal, e)
    const dir = a.fromDir.clone().applyQuaternion(q)
    const target = a.fromTarget.clone().lerp(a.toTarget, e)
    const dist = a.fromDist + (a.toDist - a.fromDist) * e
    this.controls.target.copy(target)
    this.camera.position.copy(target).addScaledVector(dir, dist)
    this.controls.update()
    if (u >= 1) this.anim = null
  }

  /** Camera pose from before the current sketch opened, restored by leavePlaneView(). */
  private preSketchView: { target: THREE.Vector3; dir: THREE.Vector3; dist: number } | null = null

  /** Look straight at a sketch plane, from the side its normal points to. */
  lookAtPlane(frame: PlaneFrame) {
    if (!this.preSketchView) {
      const target = this.controls.target.clone()
      const offset = this.camera.position.clone().sub(target)
      this.preSketchView = { target, dir: offset.clone().normalize(), dist: offset.length() }
    }
    const n = new THREE.Vector3(...frame.normal)
    // A tiny tilt so "up" stays defined when looking along the world Z axis.
    const tilt = Math.abs(n.z) > 0.99 ? new THREE.Vector3(0, -0.001, 0) : new THREE.Vector3(0, 0, 0)
    const dist = Math.min(Math.max(this.camera.position.distanceTo(this.controls.target), 60), 400)
    this.flyTo(new THREE.Vector3(0, 0, 0), n.clone().add(tilt), dist)
  }

  /** Back to the 3D view the user had before the sketch opened. No-op if no sketch view is active. */
  leavePlaneView() {
    const v = this.preSketchView
    if (!v) return
    this.preSketchView = null
    this.flyTo(v.target, v.dir, v.dist)
  }

  resetView() {
    this.flyTo(new THREE.Vector3(0, 0, 0), DEFAULT_DIR, DEFAULT_DISTANCE)
  }

  /** Frame a box. null = nothing to frame, go back to the home view. */
  zoomToFit(box: { min: Vec3; max: Vec3 } | null) {
    if (!box) {
      this.resetView()
      return
    }
    const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
    const sphere = b.getBoundingSphere(new THREE.Sphere())
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect)
    const dist = (Math.max(sphere.radius, 1) / Math.sin(Math.min(vfov, hfov) / 2)) * 1.15
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.flyTo(sphere.center, dir, dist)
  }

  // ---- thumbnail --------------------------------------------------------------------------------

  /** Renders the model from a home angle at w x h and returns a PNG. null when there is nothing to show. */
  snapshot(w = 320, h = 240): Promise<Blob | null> {
    const box = new THREE.Box3()
    for (const b of this.bodies.values()) {
      if (!b.visible) continue
      b.geo.computeBoundingBox()
      if (b.geo.boundingBox) box.union(b.geo.boundingBox)
    }
    if (box.isEmpty()) return Promise.resolve(null)
    const cam = new THREE.PerspectiveCamera(this.camera.fov, w / h, 0.1, 100000)
    cam.up.set(0, 0, 1)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const dist = (Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.1
    cam.position.copy(sphere.center).addScaledVector(DEFAULT_DIR, dist)
    cam.lookAt(sphere.center)

    const size = this.renderer.getSize(new THREE.Vector2())
    const ratio = this.renderer.getPixelRatio()
    const savedSun = this.sun.position.clone()
    const savedTarget = this.sun.target.position.clone()
    this.helpers.visible = false
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h, false)
    this.sun.position.copy(cam.position)
    this.sun.target.position.copy(sphere.center)
    this.renderer.render(this.scene, cam)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')?.drawImage(this.canvas, 0, 0, w, h)
    this.helpers.visible = true
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(size.x, size.y, false)
    this.sun.position.copy(savedSun)
    this.sun.target.position.copy(savedTarget)
    this.renderNow()
    return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'))
  }

  // ---- teardown ---------------------------------------------------------------------------------

  dispose() {
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    for (const c of this.cleanups) c()
    this.cleanups = []
    this.controls.removeEventListener('change', this.requestRender)
    this.controls.dispose()
    for (const obj of this.bodies.values()) this.disposeBody(obj)
    this.bodies.clear()
    this.setRegions([])
    this.disposeChildren(this.sketchGroup)
    this.disposeChildren(this.marksGroup)
    this.setPreview(null, [], null)
    this.grid.traverse((o) => (o as THREE.Line).geometry?.dispose())
    this.planesGroup.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose()
        o.material.dispose()
      } else if (o instanceof THREE.LineLoop) o.geometry.dispose()
    })
    this.planeMeshes.get('XY')?.geometry.dispose()
    this.snapDot.geometry.dispose()
    this.snapDotMat.map?.dispose()
    this.snapDotMat.dispose()
    for (const m of [
      ...this.bodyMats,
      ...this.planeMats,
      ...this.regionMats,
      ...this.axisMats,
      this.pickMat,
      this.edgeMat,
      this.sketchMat,
      this.sketchInactiveMat,
      this.regionLineMat,
      this.hoverLineMat,
      this.selectLineMat,
      this.previewMat,
      this.gridMinorMat,
      this.gridMajorMat,
      this.planeLineMat,
    ])
      m.dispose()
    // No forceContextLoss: React may mount a new engine on this same canvas right away (StrictMode).
    this.renderer.dispose()
  }
}
