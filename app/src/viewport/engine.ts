// The three.js side of the viewport, managed imperatively (React only owns the <canvas>).
// Render on demand: a frame is drawn only when something changed or the camera moves.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { createPickGeometry } from './pickGeometry'
import { ORIGIN_PLANES, ORIGIN_PLANE_LABELS } from '../doc/types'
import type { OriginPlaneName, PlaneFrame, ProjectDocument, Ref, SketchEntity, Vec2, Vec3 } from '../doc/types'
import type { MeshData, SketchRegionData } from '../kernel/api'
import type { EntityState } from '../sketch/solver/defined'
import { circlePolyline, localToWorld, rayPlane, worldToLocal } from '../sketch/geometry'
import { textSegments } from '../sketch/text/draw'
import { buildGroups, faceNameAtTriangle, sortFaces } from './pick'
import { EDGE_PICK_PX, VERTEX_PICK_PX, edgeHint, edgeSegments, extractVerticesFromEdges, faceHint, nearestOnEdge2D, segIntersectsRect2D } from './hints'
import type { RefHint } from './hints'
import type { FaceRange } from './pick'

const _tmpV = new THREE.Vector3()


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
  'sketch-full',
  'sketch-conflict',
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
/** How far panels cover each edge of the canvas, in CSS px. */
export interface ScreenInsets {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PickMode {
  bodies: boolean
  planes: boolean
  regions: boolean
  /**
   * What a click on a solid gives. 'face-edge' (default): a vertex, edge, or face (vertices/edges win).
   * 'edge': only edges. 'face': only faces. 'vertex': only vertices. 'solid': the whole solid, sub-elements ignored.
   */
  bodyPick?: 'face-edge' | 'edge' | 'face' | 'solid' | 'vertex'
}

export interface BoxFrame {
  left: number
  top: number
  width: number
  height: number
  crossing: boolean
}

export interface SketchGroup {
  id: string
  frame: PlaneFrame
  entities: SketchEntity[]
  active: boolean
  /** Defined state per entity id (active sketch only). Missing = under-defined. */
  states?: Record<string, EntityState>
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
  color: string | null
  opacity: number
  customMats: THREE.MeshStandardMaterial[] | null
  /** Edges as world-space segments, by name, for picking and for the highlight lines. */
  edgeList: { name: string; seg: number[] }[]
  edgeByName: Map<string, { name: string; seg: number[] }>
  faceByName: Map<string, FaceRange>
  /** Unique edge endpoints, by name, for 3D vertex picking. */
  vertexList: { name: string; point: Vec3 }[]
  vertexByName: Map<string, Vec3>
  /** Hints are computed when something is first picked, then kept. */
  hints: Map<string, RefHint>
}

interface RegionObj {
  name: string
  mesh: THREE.Mesh
  outline: THREE.LineSegments
}

const PLANE_SIZE = 80
/** Widths of the sketch lines and of their hover and selection marks, in CSS pixels. */
const SKETCH_LINE_WIDTH = 2
const SELECT_LINE_WIDTH = 5
const HOVER_LINE_WIDTH = 4
/** Dot sizes (CSS pixels) on sketch geometry: ends and centres, and line midpoints. */
const DOT_SIZE = 8
const MID_DOT_SIZE = 5
/** Visible height of a new, empty sketch, and the closest a sketch view may get (mm). */
const EMPTY_SKETCH_SPAN = 120
const MIN_SKETCH_DISTANCE = 40
/** Largest share of the view's width and height that existing sketch geometry fills (panels cover the rest). */
const SKETCH_FILL_W = 0.4
const SKETCH_FILL_H = 0.5
const DEFAULT_DIR = new THREE.Vector3(1, -1, 0.8).normalize()
const DEFAULT_DISTANCE = 250

function segmentsOf(points: Vec3[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < points.length; i++) out.push(...points[i], ...points[i + 1])
  return out
}

/** Entity outline as world-space line segments (flat xyz pairs). */
export function entitySegments(e: SketchEntity, frame: PlaneFrame, siblings: SketchEntity[] = []): number[] {
  if (e.type === 'text') return textSegments(e, frame, siblings)
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
  private cPlanesGroup = new THREE.Group()
  private regionsGroup = new THREE.Group()
  private sketchGroup = new THREE.Group()
  private marksGroup = new THREE.Group()
  private edgeMarksGroup = new THREE.Group()
  private previewGroup = new THREE.Group()
  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight

  private bodies = new Map<string, BodyObj>()
  private regions: RegionObj[] = []
  private planeGeo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)
  private planeMeshes = new Map<OriginPlaneName, THREE.Mesh>()
  private cPlaneMeshes = new Map<string, THREE.Mesh>()
  private planeLabels: THREE.Sprite[] = []
  private snapDot: THREE.Points
  private snapDotMat: THREE.PointsMaterial

  // Materials shared by every object of a kind. Index = highlight state (0 normal, 1 hover, 2 selected, 3 both).
  private bodyMats: THREE.MeshStandardMaterial[] = []
  private planeMats: THREE.MeshBasicMaterial[] = []
  private regionMats: THREE.MeshBasicMaterial[] = []
  private pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  private edgeMat = new THREE.LineBasicMaterial()
  private cameraListeners = new Set<() => void>()
  private regionLineMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.8 })
  // Wide screen-space lines (WebGL ignores `linewidth` on basic lines). `resolution` is the CSS size of the
  // canvas, so `linewidth` is in CSS pixels. Sketch lines are 2 px; construction lines are dashed (dash and
  // gap are in millimetres).
  private sketchMat = new LineMaterial({ depthTest: false, transparent: true, linewidth: SKETCH_LINE_WIDTH })
  private sketchInactiveMat = new LineMaterial({ depthTest: false, transparent: true, opacity: 0.55, linewidth: SKETCH_LINE_WIDTH })
  private sketchFullMat = new LineMaterial({ depthTest: false, transparent: true, linewidth: SKETCH_LINE_WIDTH })
  private sketchConflictMat = new LineMaterial({ depthTest: false, transparent: true, linewidth: SKETCH_LINE_WIDTH })
  private sketchConstructionMat = new LineMaterial({
    depthTest: false,
    transparent: true,
    linewidth: SKETCH_LINE_WIDTH,
    dashed: true,
    dashSize: 2.5,
    gapSize: 2,
  })
  private sketchInactiveConstructionMat = new LineMaterial({
    depthTest: false,
    transparent: true,
    opacity: 0.55,
    linewidth: SKETCH_LINE_WIDTH,
    dashed: true,
    dashSize: 2.5,
    gapSize: 2,
  })
  /** Round dots on sketch geometry, one material per colour and size. */
  private dotMats = new Map<string, THREE.PointsMaterial>()
  private dotTexture: THREE.CanvasTexture | null = null
  private hoverLineMat = new LineMaterial({ depthTest: false, linewidth: HOVER_LINE_WIDTH })
  private selectLineMat = new LineMaterial({ depthTest: false, linewidth: SELECT_LINE_WIDTH })
  private hoverPointMat: THREE.PointsMaterial
  private selectPointMat: THREE.PointsMaterial
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
  private measureSegment: [Vec3, Vec3] | null = null
  private displayMode: 'shaded' | 'wireframe' = 'shaded'
  private sectionPlane: THREE.Plane | null = null

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
  /** Called while dragging a selection rectangle over the canvas. */
  onBoxFrame: ((box: BoxFrame | null) => void) | null = null
  /** Called when a box-selection drag completes. */
  onBoxSelect: (refs: Ref[], additive: boolean) => void = () => {}

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
    this.helpers.add(
      this.grid,
      this.planesGroup,
      this.cPlanesGroup,
      this.regionsGroup,
      this.sketchGroup,
      this.marksGroup,
      this.edgeMarksGroup,
      this.previewGroup,
    )
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
    this.dotTexture = new THREE.CanvasTexture(dotCanvas)
    const makePointMat = () =>
      new THREE.PointsMaterial({
        size: 10,
        sizeAttenuation: false,
        map: this.dotTexture,
        transparent: true,
        alphaTest: 0.4,
        depthTest: false,
      })
    this.hoverPointMat = makePointMat()
    this.selectPointMat = makePointMat()
    this.snapDotMat = new THREE.PointsMaterial({
      size: 9,
      sizeAttenuation: false,
      map: this.dotTexture,
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

    // Pointer picking and box (area) selection.
    let boxDrag: { startX: number; startY: number; active: boolean } | null = null
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
    const onBoxMove = (e: PointerEvent) => {
      if (!boxDrag) return
      if (!this.pickEnabled) {
        boxDrag = null
        this.onBoxFrame?.(null)
        return
      }
      if (!boxDrag.active && Math.hypot(e.clientX - boxDrag.startX, e.clientY - boxDrag.startY) > 6) {
        boxDrag.active = true
      }
      if (boxDrag.active) {
        const rect = canvas.getBoundingClientRect()
        this.onBoxFrame?.({
          left: Math.min(boxDrag.startX, e.clientX) - rect.left,
          top: Math.min(boxDrag.startY, e.clientY) - rect.top,
          width: Math.abs(e.clientX - boxDrag.startX),
          height: Math.abs(e.clientY - boxDrag.startY),
          crossing: e.clientX < boxDrag.startX,
        })
      }
    }
    const onBoxEnd = (e: PointerEvent) => {
      const drag = boxDrag
      boxDrag = null
      window.removeEventListener('pointermove', onBoxMove)
      window.removeEventListener('pointerup', onBoxEnd)
      window.removeEventListener('pointercancel', onBoxEnd)
      if (!drag?.active) return
      this.onBoxFrame?.(null)
      if (e.type === 'pointerup' && this.pickEnabled) {
        this.onBoxSelect(this.pickInBox(drag.startX, drag.startY, e.clientX, e.clientY), e.shiftKey)
      }
    }
    const onLeave = () => this.setHover(null)
    const onDown = (e: PointerEvent) => {
      this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
      if (e.button === 0 && e.pointerType !== 'touch' && this.pickEnabled) {
        boxDrag = { startX: e.clientX, startY: e.clientY, active: false }
        window.addEventListener('pointermove', onBoxMove)
        window.addEventListener('pointerup', onBoxEnd)
        window.addEventListener('pointercancel', onBoxEnd)
      }
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
      window.removeEventListener('pointermove', onBoxMove)
      window.removeEventListener('pointerup', onBoxEnd)
      window.removeEventListener('pointercancel', onBoxEnd)
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
    for (const fn of this.cameraListeners) fn()
  }

  /** Calls `fn` after every drawn frame (camera moves, resizes), so overlays can follow the view. */
  onFrame(fn: () => void): () => void {
    this.cameraListeners.add(fn)
    return () => this.cameraListeners.delete(fn)
  }

  private resize() {
    if (this.disposed) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    for (const m of this.wideMats()) m.resolution.set(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.applyViewOffset()
    this.requestRender()
  }

  /**
   * Tells the engine how much of the canvas edges panels cover (CSS px). The model's centre (the orbit target) is
   * then drawn in the middle of the uncovered part, and framing fits into that part.
   */
  setScreenInsets(insets: ScreenInsets) {
    const a = this.insets
    if (a.left === insets.left && a.right === insets.right && a.top === insets.top && a.bottom === insets.bottom) return
    this.insets = { ...insets }
    this.applyViewOffset()
    this.requestRender()
  }

  private insets: ScreenInsets = { left: 0, right: 0, top: 0, bottom: 0 }

  /** The part of the canvas the panels leave free, in CSS px. Never smaller than a quarter of the canvas. */
  private freeSize(): { w: number; h: number } {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const { left, right, top, bottom } = this.insets
    return { w: Math.max(w / 4, w - left - right), h: Math.max(h / 4, h - top - bottom) }
  }

  /** Shifts the projection so the orbit target lands in the middle of the uncovered rectangle. */
  private applyViewOffset() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    const free = this.freeSize()
    // The target projects to the canvas centre; it should land at the centre of the free rectangle instead.
    const dx = (w - free.w) / 2 - this.insets.left
    const dy = (h - free.h) / 2 - this.insets.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) this.camera.clearViewOffset()
    else this.camera.setViewOffset(w, h, dx, dy, w, h)
    this.camera.updateProjectionMatrix()
  }

  /** Half-angle tangents (vertical, horizontal) of the part of the view the panels leave free. */
  private freeTans(): { tanV: number; tanH: number } {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const free = this.freeSize()
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    return { tanV: (tanV * free.h) / h, tanH: (tanV * this.camera.aspect * free.w) / w }
  }

  /** Every screen-space-width line material (they all need the canvas size). */
  private wideMats(): LineMaterial[] {
    return [
      this.sketchMat,
      this.sketchInactiveMat,
      this.sketchFullMat,
      this.sketchConflictMat,
      this.sketchConstructionMat,
      this.sketchInactiveConstructionMat,
      this.hoverLineMat,
      this.selectLineMat,
    ]
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
    this.sketchFullMat.color.copy(p['sketch-full'])
    this.sketchConflictMat.color.copy(p['sketch-conflict'])
    this.sketchConstructionMat.color.copy(p['sketch-construction'])
    this.sketchInactiveConstructionMat.color.copy(p['sketch-construction'])
    this.regionLineMat.color.copy(p['sketch-under'])
    for (const [key, m] of this.dotMats) m.color.copy(this.dotColor(key))
    this.hoverLineMat.color.copy(p.preselect)
    this.selectLineMat.color.copy(p.selection)
    this.hoverPointMat.color.copy(p.preselect)
    this.selectPointMat.color.copy(p.selection)
    this.previewMat.color.copy(p['sketch-under'])
    this.gridMinorMat.color.copy(p['viewport-grid'])
    this.gridMajorMat.color.copy(p['viewport-grid'])
    this.planeLineMat.color.copy(p['viewport-grid'])
    this.axisMats[0].color.copy(p['axis-x'])
    this.axisMats[1].color.copy(p['axis-y'])
    this.axisMats[2].color.copy(p['axis-z'])
    this.snapDotMat.color.copy(p.accent)
    this.syncBodyMaterialProps()
    this.drawLabels()
  }

  private resolveBodyColor(color: string | null): THREE.Color {
    if (!color) return this.palette.body.clone()
    const raw = color.startsWith('token:')
      ? getComputedStyle(document.documentElement).getPropertyValue(`--t-color-${color.slice(6)}`).trim()
      : color
    const out = this.palette.body.clone()
    if (raw) {
      try {
        out.set(raw)
      } catch {
        // Keep fallback body token colour if string isn't a valid CSS colour.
      }
    }
    return out
  }

  private createBodyMatSet(): THREE.MeshStandardMaterial[] {
    const mats: THREE.MeshStandardMaterial[] = []
    for (let i = 0; i < 4; i++) {
      mats.push(
        new THREE.MeshStandardMaterial({
          roughness: 0.65,
          metalness: 0.05,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      )
    }
    return mats
  }

  private syncBodyMaterialProps() {
    const p = this.palette
    const wire = this.displayMode === 'wireframe'
    const clips = this.sectionPlane ? [this.sectionPlane] : []
    for (const m of this.bodyMats) {
      m.wireframe = wire
      m.clippingPlanes = clips
    }
    this.edgeMat.clippingPlanes = clips
    for (const obj of this.bodies.values()) {
      if (!obj.customMats) continue
      const base = this.resolveBodyColor(obj.color)
      const tint = (to: THREE.Color, k: number) => base.clone().lerp(to, k)
      const transparent = obj.opacity < 1
      obj.customMats[0].color.copy(base)
      obj.customMats[1].color.copy(tint(p.preselect, 0.4))
      obj.customMats[2].color.copy(tint(p.selection, 0.5))
      obj.customMats[3].color.copy(tint(p.selection, 0.5).lerp(p.preselect, 0.35))
      for (const m of obj.customMats) {
        m.opacity = obj.opacity
        m.transparent = transparent
        m.depthWrite = !transparent
        m.wireframe = wire
        m.clippingPlanes = clips
        m.needsUpdate = true
      }
    }
  }

  setDisplayMode(mode: 'shaded' | 'wireframe') {
    if (this.displayMode === mode) return
    this.displayMode = mode
    this.syncBodyMaterialProps()
    this.requestRender()
  }

  getDisplayMode(): 'shaded' | 'wireframe' {
    return this.displayMode
  }

  setSectionView(enabled: boolean, plane?: PlaneFrame) {
    this.renderer.localClippingEnabled = enabled
    if (!enabled) {
      this.sectionPlane = null
    } else if (plane) {
      this.sectionPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(...plane.normal).normalize(),
        new THREE.Vector3(...plane.origin),
      )
    } else {
      const box = new THREE.Box3()
      for (const b of this.bodies.values()) {
        if (!b.visible) continue
        b.geo.computeBoundingBox()
        if (b.geo.boundingBox) box.union(b.geo.boundingBox)
      }
      const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3())
      // Keep the back (+Y) half so the default camera at (1, -1, 0.8) looks directly into the cut face.
      this.sectionPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), center)
    }
    this.syncBodyMaterialProps()
    this.requestRender()
  }

  getSectionView(): boolean {
    return this.sectionPlane !== null
  }

  private dotColor(key: string): THREE.Color {
    const kind = key.split(':')[0] as 'under' | 'full' | 'conflict' | 'construction'
    return this.palette[`sketch-${kind}`]
  }

  private dotMat(kind: 'under' | 'full' | 'conflict' | 'construction', size: number): THREE.PointsMaterial {
    const key = `${kind}:${size}`
    let m = this.dotMats.get(key)
    if (!m) {
      m = new THREE.PointsMaterial({
        size,
        sizeAttenuation: false,
        map: this.dotTexture,
        transparent: true,
        alphaTest: 0.4,
        depthTest: false,
      })
      m.color.copy(this.dotColor(key))
      this.dotMats.set(key, m)
    }
    return m
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

    for (const name of Object.keys(ORIGIN_PLANES) as OriginPlaneName[]) {
      const f = ORIGIN_PLANES[name]
      const mesh = new THREE.Mesh(this.planeGeo, this.planeMats[0])
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
      const app = appearance[obj.id]
      obj.visible = app?.visible !== false
      obj.group.visible = obj.visible
      const nextColor = app?.color ?? null
      const nextOpacity = app?.opacity ?? 1
      const needsCustom = nextColor !== null || nextOpacity < 1
      obj.color = nextColor
      obj.opacity = nextOpacity
      if (needsCustom && !obj.customMats) {
        obj.customMats = this.createBodyMatSet()
        obj.mesh.material = obj.customMats
      } else if (!needsCustom && obj.customMats) {
        obj.mesh.material = this.bodyMats
        for (const m of obj.customMats) m.dispose()
        obj.customMats = null
      }
    }
    this.syncBodyMaterialProps()
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
    const edgeList = data.edges.map((e) => ({ name: e.name, seg: edgeSegments(e.points) }))
    const vertexList = data.vertices ?? extractVerticesFromEdges(id, data.edges)
    return {
      id,
      data,
      sorted: sortFaces(data.faces),
      group,
      mesh,
      edges,
      pick,
      geo,
      pickGeo,
      edgeGeo,
      visible: true,
      color: null,
      opacity: 1,
      customMats: null,
      edgeList,
      edgeByName: new Map(edgeList.map((e) => [e.name, e])),
      faceByName: new Map(data.faces.map((f) => [f.name, f])),
      vertexList,
      vertexByName: new Map(vertexList.map((v) => [v.name, v.point])),
      hints: new Map(),
    }
  }

  private disposeBody(obj: BodyObj) {
    this.bodiesGroup.remove(obj.group)
    if (obj.customMats) {
      for (const m of obj.customMats) m.dispose()
      obj.customMats = null
    }
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

  setConstructionPlanesVisible(v: boolean) {
    this.cPlanesGroup.visible = v
    this.requestRender()
  }

  private clearConstructionPlanes() {
    for (const c of [...this.cPlanesGroup.children]) {
      this.cPlanesGroup.remove(c)
      if (c instanceof THREE.LineLoop) c.geometry.dispose()
    }
    this.cPlaneMeshes.clear()
  }

  setConstructionPlanes(list: { name: string; frame: PlaneFrame }[]) {
    this.clearConstructionPlanes()
    const h = PLANE_SIZE / 2
    const corners: Vec2[] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ]
    for (const { name, frame } of list) {
      const mesh = new THREE.Mesh(this.planeGeo, this.planeMats[0])
      mesh.matrixAutoUpdate = false
      mesh.matrix.makeBasis(new THREE.Vector3(...frame.xDir), new THREE.Vector3(...frame.yDir), new THREE.Vector3(...frame.normal))
      mesh.matrix.setPosition(frame.origin[0], frame.origin[1], frame.origin[2])
      mesh.matrixWorldNeedsUpdate = true
      mesh.userData = { kind: 'constructionPlane', name }
      this.cPlaneMeshes.set(name, mesh)
      const outline = new THREE.LineLoop(lineGeometry(corners.flatMap((c) => localToWorld(c, frame))), this.planeLineMat)
      outline.frustumCulled = false
      this.cPlanesGroup.add(mesh, outline)
    }
    this.refreshHighlights()
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

  setMeasureSegment(seg: [Vec3, Vec3] | null) {
    this.measureSegment = seg
    this.refreshEdgeMarks()
    this.requestRender()
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
      const bodyHov = this.hover?.kind === 'body' && this.hover.name === obj.id
      const total = obj.data.indices.length
      const groups = buildGroups(obj.sorted, total, (face) => {
        let s = this.stateOf('face', face)
        if (bodySel) s = Math.max(s, 2)
        if (bodyHov) s |= 1
        return s
      })
      obj.geo.clearGroups()
      for (const g of groups) obj.geo.addGroup(g.start, g.count, g.materialIndex)
    }
    for (const [name, mesh] of this.planeMeshes) mesh.material = this.planeMats[this.stateOf('originPlane', name)]
    for (const [name, mesh] of this.cPlaneMeshes) mesh.material = this.planeMats[this.stateOf('constructionPlane', name)]
    for (const r of this.regions) r.mesh.material = this.regionMats[this.stateOf('sketchRegion', r.name)]
    this.refreshEdgeMarks()
    this.requestRender()
  }

  /** Selected and hovered edges, vertices and measurement connector on top of the model. */
  private refreshEdgeMarks() {
    this.disposeChildren(this.edgeMarksGroup)
    const find = (name: string) => {
      for (const b of this.bodies.values()) {
        const e = b.edgeByName.get(name)
        if (e && b.visible) return e.seg
      }
      return undefined
    }
    const findVertex = (ref: Ref): Vec3 | undefined => {
      const [bodyId] = ref.name.split('/vertex:')
      const body = this.bodies.get(bodyId)
      if (!body || !body.visible) return undefined
      return body.vertexByName.get(ref.name) ?? ref.hint?.centroid
    }
    const add = (refs: Ref[], mat: LineMaterial, order: number) => {
      const seg: number[] = []
      for (const r of refs) if (r.kind === 'edge') seg.push(...(find(r.name) ?? []))
      if (seg.length === 0) return
      const geo = new LineSegmentsGeometry()
      geo.setPositions(seg)
      const l = new LineSegments2(geo, mat)
      l.renderOrder = order
      l.frustumCulled = false
      this.edgeMarksGroup.add(l)
    }
    const addPts = (pts: number[], mat: THREE.PointsMaterial, order: number) => {
      if (pts.length === 0) return
      const p = new THREE.Points(lineGeometry(pts), mat)
      p.renderOrder = order
      p.frustumCulled = false
      this.edgeMarksGroup.add(p)
    }
    add(this.selection, this.selectLineMat, 7)
    if (this.hover) add([this.hover], this.hoverLineMat, 8)

    const selPts: number[] = []
    for (const r of this.selection) {
      if (r.kind === 'vertex') {
        const pt = findVertex(r)
        if (pt) selPts.push(...pt)
      }
    }
    if (this.measureSegment) {
      const [a, b] = this.measureSegment
      const geo = new LineSegmentsGeometry()
      geo.setPositions([...a, ...b])
      const l = new LineSegments2(geo, this.selectLineMat)
      l.renderOrder = 8
      l.frustumCulled = false
      this.edgeMarksGroup.add(l)
      selPts.push(...a, ...b)
    }
    addPts(selPts, this.selectPointMat, 9)
    if (this.hover?.kind === 'vertex') {
      const pt = findVertex(this.hover)
      if (pt) addPts([...pt], this.hoverPointMat, 10)
    }
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
    this.camera.updateMatrixWorld()
    this.setNdc(clientX, clientY)
    const pickKind = this.mode.bodyPick ?? 'face-edge'
    const objs: THREE.Object3D[] = []
    if (this.mode.bodies) for (const b of this.bodies.values()) if (b.visible) objs.push(b.pick)
    if (this.mode.planes && this.planesVisible) objs.push(...this.planeMeshes.values())
    if (this.cPlanesGroup.visible && (this.mode.planes || (this.mode.bodies && pickKind === 'face-edge'))) {
      objs.push(...this.cPlaneMeshes.values())
    }
    if (this.mode.regions) for (const r of this.regions) objs.push(r.mesh)
    if (objs.length === 0) return null
    const hits = this.raycaster.intersectObjects(objs, false)
    let hit = hits[0]
    // An opaque solid face wins over translucent origin planes that pass in front of it.
    if (hit && hit.object.userData.kind === 'originPlane' && pickKind === 'face') {
      const bodyHit = hits.find((h) => h.object.userData.kind === 'body')
      if (bodyHit) hit = bodyHit
    }
    // A sketch shape that lies in the plane of a solid's face wins over that face.
    if (hit && hit.object.userData.kind === 'body') {
      const first = hit
      const region = hits.find((h) => h.object.userData.kind === 'sketchRegion' && h.distance <= first.distance + 0.05)
      if (region) hit = region
    }

    if (this.mode.bodies && (pickKind === 'vertex' || pickKind === 'face-edge')) {
      const vertex = this.nearestVertex(clientX, clientY, hit ? hit.distance : Infinity)
      if (vertex) return vertex
    }
    if (this.mode.bodies && pickKind !== 'solid' && pickKind !== 'face' && pickKind !== 'vertex') {
      const edge = this.nearestEdge(clientX, clientY, hit ? hit.distance : Infinity)
      if (edge) return edge
    }
    if (!hit) return null
    const ud = hit.object.userData as { kind: string; name?: string; bodyId?: string }
    if (ud.kind === 'originPlane') return { kind: 'originPlane', name: ud.name as string }
    if (ud.kind === 'constructionPlane') return { kind: 'constructionPlane', name: ud.name as string }
    if (ud.kind === 'sketchRegion') return { kind: 'sketchRegion', name: ud.name as string }
    const body = this.bodies.get(ud.bodyId as string)
    if (!body) return null
    if (pickKind === 'solid') return { kind: 'body', name: body.id }
    if (pickKind === 'edge' || pickKind === 'vertex') return null
    const face = hit.faceIndex == null ? null : faceNameAtTriangle(body.sorted, hit.faceIndex)
    return face ? { kind: 'face', name: face, hint: this.faceHintOf(body, face) } : { kind: 'body', name: body.id }
  }

  private faceHintOf(body: BodyObj, name: string): RefHint | undefined {
    const key = `face:${name}`
    let h = body.hints.get(key)
    if (!h) {
      const range = body.faceByName.get(name)
      if (!range) return undefined
      h = faceHint(body.data.positions, body.data.indices, range.start, range.count)
      body.hints.set(key, h)
    }
    return h
  }

  private toScreen(
    x: number,
    y: number,
    z: number,
    rect = this.canvas.getBoundingClientRect(),
  ): [number, number, number] | null {
    // Camera space looks down -z: anything closer than the near plane cannot be projected.
    const camZ = _tmpV.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse).z
    if (camZ > -this.camera.near) return null
    _tmpV.set(x, y, z).project(this.camera)
    return [rect.left + ((_tmpV.x + 1) / 2) * rect.width, rect.top + ((1 - _tmpV.y) / 2) * rect.height, -camZ]
  }

  /** The visible vertex closest to the pointer within VERTEX_PICK_PX and not occluded. */
  private nearestVertex(clientX: number, clientY: number, limit: number): Ref | null {
    const rect = this.canvas.getBoundingClientRect()
    const eye = this.camera.position
    let best: { distance: number; v: { name: string; point: Vec3 } } | null = null
    for (const body of this.bodies.values()) {
      if (!body.visible) continue
      for (const v of body.vertexList) {
        const s = this.toScreen(v.point[0], v.point[1], v.point[2], rect)
        if (!s) continue
        const d = Math.hypot(s[0] - clientX, s[1] - clientY)
        if (d >= VERTEX_PICK_PX || (best && d >= best.distance)) continue
        const depth = Math.hypot(v.point[0] - eye.x, v.point[1] - eye.y, v.point[2] - eye.z)
        if (depth > limit + Math.max(1, limit * 0.01)) continue
        best = { distance: d, v }
      }
    }
    return best ? { kind: 'vertex', name: best.v.name, hint: { centroid: [...best.v.point] } } : null
  }

  /** Box (area) selection: left-to-right selects fully enclosed items; right-to-left selects crossing items. */
  pickInBox(x0: number, y0: number, x1: number, y1: number): Ref[] {
    if (!this.mode.bodies) return []
    this.scene.updateMatrixWorld()
    this.camera.updateMatrixWorld()
    const rect = this.canvas.getBoundingClientRect()
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    const crossing = x1 < x0
    const inside = (p: [number, number, number]) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY
    const pickKind = this.mode.bodyPick ?? 'face-edge'
    const out: Ref[] = []

    for (const body of this.bodies.values()) {
      if (!body.visible) continue
      if (pickKind === 'vertex') {
        for (const v of body.vertexList) {
          const s = this.toScreen(v.point[0], v.point[1], v.point[2], rect)
          if (s && inside(s)) out.push({ kind: 'vertex', name: v.name, hint: { centroid: [...v.point] } })
        }
        continue
      }
      if (pickKind === 'edge') {
        for (const e of body.edgeList) {
          if (e.seg.length < 6) continue
          let allIn = true
          let anyCross = false
          for (let i = 0; i + 5 < e.seg.length; i += 6) {
            const p = this.toScreen(e.seg[i], e.seg[i + 1], e.seg[i + 2], rect)
            const q = this.toScreen(e.seg[i + 3], e.seg[i + 4], e.seg[i + 5], rect)
            if (!p || !q || !inside(p) || !inside(q)) allIn = false
            if (p && q && segIntersectsRect2D(p[0], p[1], q[0], q[1], minX, minY, maxX, maxY)) anyCross = true
          }
          if (crossing ? anyCross : allIn) {
            const pts = body.data.edges.find((x) => x.name === e.name)?.points
            out.push({ kind: 'edge', name: e.name, hint: pts ? edgeHint(pts) : undefined })
          }
        }
        continue
      }

      const pos = body.data.positions
      const idx = body.data.indices
      const nVerts = Math.floor(pos.length / 3)
      const projected: ([number, number, number] | null)[] = new Array(nVerts)
      for (let i = 0; i < nVerts; i++) {
        projected[i] = this.toScreen(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], rect)
      }

      if (pickKind === 'face') {
        for (const f of body.sorted) {
          if (f.count < 3) continue
          let allIn = true
          let anyCross = false
          const end = Math.min(f.start + f.count, idx.length)
          for (let i = f.start; i + 2 < end; i += 3) {
            const pa = projected[idx[i]]
            const pb = projected[idx[i + 1]]
            const pc = projected[idx[i + 2]]
            if (!pa || !pb || !pc || !inside(pa) || !inside(pb) || !inside(pc)) allIn = false
            if (
              pa &&
              pb &&
              pc &&
              (segIntersectsRect2D(pa[0], pa[1], pb[0], pb[1], minX, minY, maxX, maxY) ||
                segIntersectsRect2D(pb[0], pb[1], pc[0], pc[1], minX, minY, maxX, maxY) ||
                segIntersectsRect2D(pc[0], pc[1], pa[0], pa[1], minX, minY, maxX, maxY))
            ) {
              anyCross = true
            }
          }
          if (crossing ? anyCross : allIn) {
            out.push({ kind: 'face', name: f.name, hint: this.faceHintOf(body, f.name) })
          }
        }
        continue
      }

      // 'solid' or 'face-edge' selects solids in box-select mode.
      let allIn = nVerts > 0
      let anyCross = false
      for (const p of projected) {
        if (!p || !inside(p)) {
          allIn = false
          if (crossing && anyCross) break
        } else {
          anyCross = true
        }
      }
      if (crossing && !anyCross) {
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const pa = projected[idx[i]]
          const pb = projected[idx[i + 1]]
          const pc = projected[idx[i + 2]]
          if (
            pa &&
            pb &&
            pc &&
            (segIntersectsRect2D(pa[0], pa[1], pb[0], pb[1], minX, minY, maxX, maxY) ||
              segIntersectsRect2D(pb[0], pb[1], pc[0], pc[1], minX, minY, maxX, maxY) ||
              segIntersectsRect2D(pc[0], pc[1], pa[0], pa[1], minX, minY, maxX, maxY))
          ) {
            anyCross = true
            break
          }
        }
      }
      if (crossing ? anyCross : allIn) out.push({ kind: 'body', name: body.id })
    }
    return out
  }

  /**
   * The edge closest to the pointer, if it is within EDGE_PICK_PX on screen and not hidden behind a surface
   * that is `limit` away along the view ray.
   */
  private nearestEdge(clientX: number, clientY: number, limit: number): Ref | null {
    const rect = this.canvas.getBoundingClientRect()
    const eye = this.camera.position
    let best: { distance: number; body: BodyObj; name: string } | null = null
    for (const body of this.bodies.values()) {
      if (!body.visible) continue
      for (const e of body.edgeList) {
        const screen: number[] = []
        const kept: number[] = []
        const depths: number[] = []
        for (let i = 0; i + 5 < e.seg.length; i += 6) {
          const p = this.toScreen(e.seg[i], e.seg[i + 1], e.seg[i + 2], rect)
          const q = this.toScreen(e.seg[i + 3], e.seg[i + 4], e.seg[i + 5], rect)
          if (!p || !q) continue
          screen.push(p[0], p[1], q[0], q[1])
          depths.push(p[2], q[2])
          kept.push(i)
        }
        const r = nearestOnEdge2D(clientX, clientY, screen)
        if (!r || r.distance >= EDGE_PICK_PX || (best && r.distance >= best.distance)) continue
        const d0 = depths[r.segment * 2]
        const d1 = depths[r.segment * 2 + 1]
        const denom = (1 - r.t) * d1 + r.t * d0
        const t3 = denom > 0 ? (r.t * d0) / denom : r.t
        const o = kept[r.segment]
        const px = e.seg[o] + (e.seg[o + 3] - e.seg[o]) * t3
        const py = e.seg[o + 1] + (e.seg[o + 4] - e.seg[o + 1]) * t3
        const pz = e.seg[o + 2] + (e.seg[o + 5] - e.seg[o + 2]) * t3
        const depth = Math.hypot(px - eye.x, py - eye.y, pz - eye.z)
        if (depth > limit + Math.max(1, limit * 0.01)) continue
        best = { distance: r.distance, body, name: e.name }
      }
    }
    if (!best) return null
    const key = `edge:${best.name}`
    let hint = best.body.hints.get(key)
    if (!hint) {
      const pts = best.body.data.edges.find((x) => x.name === best.name)?.points
      hint = pts ? edgeHint(pts) : undefined
      if (hint) best.body.hints.set(key, hint)
    }
    return { kind: 'edge', name: best.name, hint }
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

  /** Changes whenever the camera or the canvas size does, so overlays know when to reposition. */
  viewKey(): string {
    const p = this.camera.position
    const q = this.camera.quaternion
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, this.camera.fov, this.canvas.clientWidth, this.canvas.clientHeight]
      .map((n) => n.toFixed(4))
      .join(',')
  }

  /** Client (page) coordinates of a world point. */
  worldToClient(world: Vec3): [number, number] {
    this.camera.updateMatrixWorld()
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector3(...world).project(this.camera)
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
  }

  setSketches(groups: SketchGroup[]) {
    this.disposeChildren(this.sketchGroup)
    for (const g of groups) {
      const solid = new Map<THREE.Material, number[]>()
      const dashed: number[] = []
      const dots = new Map<THREE.PointsMaterial, number[]>()
      const dotsInto = (mat: THREE.PointsMaterial, p: Vec3) => {
        const list = dots.get(mat)
        if (list) list.push(...p)
        else dots.set(mat, [...p])
      }
      const into = (mat: THREE.Material, seg: number[]) => {
        const list = solid.get(mat)
        if (list) list.push(...seg)
        else solid.set(mat, [...seg])
      }
      for (const e of g.entities) {
        const seg = entitySegments(e, g.frame, g.entities)
        let kind: 'under' | 'full' | 'conflict' | 'construction' = 'under'
        if (e.construction) {
          dashed.push(...seg)
          kind = 'construction'
        } else if (!g.active) into(this.sketchInactiveMat, seg)
        else {
          const st = g.states?.[e.id]
          into(st === 'full' ? this.sketchFullMat : st === 'conflict' ? this.sketchConflictMat : this.sketchMat, seg)
          kind = st === 'full' ? 'full' : st === 'conflict' ? 'conflict' : 'under'
        }
        if (!g.active) continue
        const big = this.dotMat(kind, DOT_SIZE)
        const at = (l: Vec2): Vec3 => localToWorld(l, g.frame)
        if (e.type === 'line') {
          dotsInto(big, at(e.a))
          dotsInto(big, at(e.b))
          if (!e.construction) dotsInto(this.dotMat(kind, MID_DOT_SIZE), at([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]))
        } else if (e.type !== 'text') {
          dotsInto(big, at(e.center))
          if (e.type === 'arc') {
            dotsInto(big, at([e.center[0] + e.radius * Math.cos(e.startAngle), e.center[1] + e.radius * Math.sin(e.startAngle)]))
            dotsInto(big, at([e.center[0] + e.radius * Math.cos(e.endAngle), e.center[1] + e.radius * Math.sin(e.endAngle)]))
          }
        }
      }
      const add = (seg: number[], mat: LineMaterial, dash: boolean) => {
        const geo = new LineSegmentsGeometry()
        geo.setPositions(seg)
        const lines = new LineSegments2(geo, mat)
        if (dash) lines.computeLineDistances()
        lines.renderOrder = 5
        lines.frustumCulled = false
        this.sketchGroup.add(lines)
      }
      for (const [mat, seg] of solid) add(seg, mat as LineMaterial, false)
      if (dashed.length) add(dashed, g.active ? this.sketchConstructionMat : this.sketchInactiveConstructionMat, true)
      for (const [mat, pos] of dots) {
        const pts = new THREE.Points(lineGeometry(pos), mat)
        pts.renderOrder = 6
        pts.frustumCulled = false
        this.sketchGroup.add(pts)
      }
    }
    this.requestRender()
  }

  /** Hover and selection marks for sketch entities. */
  setSketchMarks(frame: PlaneFrame | null, hover: SketchEntity[], selected: SketchEntity[], all: SketchEntity[] = []) {
    this.disposeChildren(this.marksGroup)
    if (frame) {
      const add = (ents: SketchEntity[], mat: LineMaterial, order: number) => {
        const seg: number[] = []
        for (const e of ents) seg.push(...entitySegments(e, frame, all))
        if (seg.length === 0) return
        const geo = new LineSegmentsGeometry()
        geo.setPositions(seg)
        const l = new LineSegments2(geo, mat)
        l.renderOrder = order
        l.frustumCulled = false
        this.marksGroup.add(l)
      }
      add(selected, this.selectLineMat, 7)
      add(hover, this.hoverLineMat, 8)
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

  /**
   * Look straight at a sketch plane, from the side its normal points to. With existing geometry the view
   * frames it (with margin); an empty sketch gets a view about EMPTY_SKETCH_SPAN mm tall.
   */
  lookAtPlane(frame: PlaneFrame, geometry: SketchEntity[] = []) {
    if (!this.preSketchView) {
      const target = this.controls.target.clone()
      const offset = this.camera.position.clone().sub(target)
      this.preSketchView = { target, dir: offset.clone().normalize(), dist: offset.length() }
    }
    const n = new THREE.Vector3(...frame.normal)
    // A tiny tilt so "up" stays defined when looking along the world Z axis.
    const tilt = Math.abs(n.z) > 0.99 ? new THREE.Vector3(0, -0.001, 0) : new THREE.Vector3(0, 0, 0)

    const { tanV, tanH } = this.freeTans()
    const pts: Vec3[] = []
    for (const e of geometry) {
      const seg = entitySegments(e, frame, geometry)
      for (let i = 0; i + 2 < seg.length; i += 3) pts.push([seg[i], seg[i + 1], seg[i + 2]])
    }
    if (pts.length === 0) {
      this.flyTo(new THREE.Vector3(...frame.origin), n.clone().add(tilt), EMPTY_SKETCH_SPAN / 2 / tanV)
      return
    }
    const lo: Vec2 = [Infinity, Infinity]
    const hi: Vec2 = [-Infinity, -Infinity]
    for (const p of pts) {
      const l = worldToLocal(p, frame)
      lo[0] = Math.min(lo[0], l[0])
      lo[1] = Math.min(lo[1], l[1])
      hi[0] = Math.max(hi[0], l[0])
      hi[1] = Math.max(hi[1], l[1])
    }
    const w = hi[0] - lo[0]
    const h = hi[1] - lo[1]
    const c = localToWorld([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], frame)
    const dist = Math.max(MIN_SKETCH_DISTANCE, Math.max(h / 2 / tanV / SKETCH_FILL_H, w / 2 / tanH / SKETCH_FILL_W))
    this.flyTo(new THREE.Vector3(...c), n.clone().add(tilt), dist)
  }

  private syncControlsUp() {
    const c = this.controls as unknown as { _quat?: THREE.Quaternion; _quatInverse?: THREE.Quaternion }
    if (c._quat && c._quatInverse) {
      c._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0))
      c._quatInverse.copy(c._quat).invert()
    }
  }

  /** Fly to look along `dir` (the direction from the target to the camera), keeping target and distance. */
  viewFrom(dir: Vec3) {
    this.camera.up.set(0, 0, 1)
    this.syncControlsUp()
    const d = new THREE.Vector3(...dir).normalize()
    // Top and Bottom: a tiny tilt keeps "up" defined (screen up is +Y from the top, -Y from below).
    if (Math.abs(d.z) > 0.99) d.add(new THREE.Vector3(0, -0.001, 0))
    this.flyTo(this.controls.target.clone(), d, this.camera.position.distanceTo(this.controls.target))
  }

  /** Rolls the camera 90 degrees left (-90) or right (+90) around the view axis. */
  rollView(deg: 90 | -90) {
    this.anim = null
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize()
    screenUp.applyAxisAngle(dir, THREE.MathUtils.degToRad(deg)).normalize()
    this.camera.up.copy(screenUp)
    this.syncControlsUp()
    this.camera.lookAt(this.controls.target)
    this.controls.update()
    this.requestRender()
  }

  /** Back to the 3D view the user had before the sketch opened. No-op if no sketch view is active. */
  leavePlaneView() {
    const v = this.preSketchView
    if (!v) return
    this.preSketchView = null
    this.camera.up.set(0, 0, 1)
    this.syncControlsUp()
    this.flyTo(v.target, v.dir, v.dist)
  }

  resetView() {
    this.camera.up.set(0, 0, 1)
    this.syncControlsUp()
    this.flyTo(new THREE.Vector3(0, 0, 0), DEFAULT_DIR, DEFAULT_DISTANCE)
  }

  zoomToFace(frame: PlaneFrame) {
    const n = new THREE.Vector3(...frame.normal).normalize()
    const tilt = Math.abs(n.z) > 0.99 ? new THREE.Vector3(0, -0.001, 0) : new THREE.Vector3(0, 0, 0)
    this.camera.up.set(0, 0, 1)
    this.syncControlsUp()
    const box = new THREE.Box3()
    for (const b of this.bodies.values()) {
      if (!b.visible) continue
      b.geo.computeBoundingBox()
      if (b.geo.boundingBox) box.union(b.geo.boundingBox)
    }
    const radius = box.isEmpty() ? 30 : Math.max(15, box.getBoundingSphere(new THREE.Sphere()).radius)
    const { tanV, tanH } = this.freeTans()
    const dist = (radius / Math.sin(Math.atan(Math.min(tanV, tanH)))) * 0.9
    this.flyTo(new THREE.Vector3(...frame.origin), n.add(tilt), Math.max(40, dist))
  }

  /** Frame a box. null = nothing to frame, go back to the home view. */
  zoomToFit(box: { min: Vec3; max: Vec3 } | null) {
    if (!box) {
      this.resetView()
      return
    }
    const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
    const sphere = b.getBoundingSphere(new THREE.Sphere())
    // Fit inside the part of the view the panels leave free (the target is drawn in its middle).
    const { tanV, tanH } = this.freeTans()
    const dist = (Math.max(sphere.radius, 1) / Math.sin(Math.atan(Math.min(tanV, tanH)))) * 1.15
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

  // ---- screenshot -------------------------------------------------------------------------------

  /**
   * The view as it is now, as a PNG at the canvas size. A frame is drawn and read in the same task, so the
   * canvas does not need to keep its buffer. Hover and selection marks on edges are left out of the picture.
   */
  captureImage(): Promise<Blob> {
    const hidden = this.edgeMarksGroup.visible
    this.edgeMarksGroup.visible = false
    try {
      this.renderNow()
      return new Promise((resolve, reject) => {
        this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made. Try again.'))), 'image/png')
      })
    } finally {
      this.edgeMarksGroup.visible = hidden
      this.requestRender()
    }
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
    this.disposeChildren(this.edgeMarksGroup)
    this.setPreview(null, [], null)
    this.grid.traverse((o) => (o as THREE.Line).geometry?.dispose())
    this.planesGroup.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose()
        o.material.dispose()
      } else if (o instanceof THREE.LineLoop) o.geometry.dispose()
    })
    this.clearConstructionPlanes()
    this.planeGeo.dispose()
    this.snapDot.geometry.dispose()
    this.dotTexture?.dispose()
    this.snapDotMat.dispose()
    for (const m of this.dotMats.values()) m.dispose()
    for (const m of [
      ...this.bodyMats,
      ...this.planeMats,
      ...this.regionMats,
      ...this.axisMats,
      this.pickMat,
      this.edgeMat,
      this.sketchMat,
      this.sketchInactiveMat,
      this.sketchFullMat,
      this.sketchConflictMat,
      this.sketchConstructionMat,
      this.sketchInactiveConstructionMat,
      this.regionLineMat,
      this.hoverLineMat,
      this.selectLineMat,
      this.hoverPointMat,
      this.selectPointMat,
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
