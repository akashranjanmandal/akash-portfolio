import * as THREE from 'three'
import { RAPIER, type Physics } from '../Physics'
import type { Assets } from '../Assets'
import type { Quality } from '../Engine'
import type { Materials } from '../city/Town'
import { Batch, M } from '../city/Batch'
import { Panorama, PEAKS } from './Panorama'
import { buildPortal, labelTexture } from './Portal'
import { HB, HILLS_Z, HeightGrid, outerHeight, ROUTE, ROUTE_LENGTH, VIEW, VIEW_Y, BASECAMP, SUMMIT, START, nearestRoute } from './Route'
import type { Spot } from '../city/Landmarks'
import { clamp, rng, noise2, smoothstep } from '../../utils/math'
import { ChunkedTerrain, terrainMaterial, microDetail } from '../Terrain'

/* ──────────────────────────────────────────────────────────────
   THE HILLS
   A ridge region far from the city, built the first time you drive
   through the tunnel: hairpin road, pine forest, a sea of cloud,
   the Sandakphu viewpoint facing the Himalaya, and a snowy trail
   along the crest to a base camp.
────────────────────────────────────────────────────────────── */

export type HillEvent = 'viewpoint' | 'basecamp' | 'summit'

const w = (lx: number, y: number, lz: number) => new THREE.Vector3(lx, y, HILLS_Z + lz)

export class Hills {
  readonly group = new THREE.Group()
  built = false
  readonly panorama: Panorama
  onEvent?: (e: HillEvent) => void
  private grid!: HeightGrid
  private trees: { mesh: THREE.InstancedMesh; c: THREE.Vector3; far: number }[] = []
  private clouds: THREE.Mesh[] = []
  private cloudMats: THREE.ShaderMaterial[] = []
  private fired = new Set<HillEvent>()
  private cull = 0
  /** where the tunnel puts you, and the trigger that sends you home */
  readonly arrive = { x: START.x, y: 0.6, z: HILLS_Z - 62, yaw: 0 }
  readonly returnTrigger = { x: START.x, z: HILLS_Z - 42, half: 14 }
  readonly viewpoint = w(VIEW.x, VIEW_Y, VIEW.z)
  /** named places, for the map and waypoints */
  readonly spots: Spot[] = [
    { id: 'sandakphu', title: 'Sandakphu viewpoint', sub: '3,636 m · Kanchenjunga & the Sleeping Buddha', pos: w(VIEW.x + 14, VIEW_Y, VIEW.z), yaw: 0 },
    { id: 'basecamp', title: 'Kanchenjunga base camp', sub: 'Expedition trail · 2.7 km north', pos: w(BASECAMP.x, 700, BASECAMP.z), yaw: 0 },
    { id: 'summit', title: 'Summit flag', sub: 'The top of the trail', pos: w(SUMMIT.x, 800, SUMMIT.z), yaw: 0 },
    { id: 'hilltunnel', title: 'Tunnel to Kolkata', sub: 'NH-12 · back to the city', pos: w(START.x, 0, START.z), yaw: 0 },
  ]
  private mapCanvas: HTMLCanvasElement | null = null

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
    private assets: Assets,
    private quality: Quality,
    private mats: Materials,
    sunDir: THREE.Vector3,
  ) {
    this.panorama = new Panorama(sunDir)
    this.group.visible = false
    this.scene.add(this.group, this.panorama.group)
  }

  height(lx: number, lz: number) {
    return this.grid.at(lx, lz)
  }

  build() {
    if (this.built) return
    this.built = true
    const res = this.quality.tier === 'high' ? 10 : this.quality.tier === 'mid' ? 12 : 16
    this.grid = new HeightGrid(res)
    this.terrain()
    this.road()
    this.forest()
    this.start()
    this.viewpointBuild()
    this.expedition()
    this.cloudSea()
    this.fence()
    this.group.traverse((o) => ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh ? ((o as THREE.Mesh).matrixAutoUpdate = true) : 0))
  }

  /** a painted map of the region (height-shaded terrain with the road), in the same bounds as the terrain */
  mapImage() {
    if (this.mapCanvas || !this.built) return this.mapCanvas
    const W = 380
    const H = Math.round((W * (HB.z1 - HB.z0)) / (HB.x1 - HB.x0))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    const img = g.createImageData(W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const lx = HB.x0 + (x / W) * (HB.x1 - HB.x0)
        const lz = HB.z0 + (y / H) * (HB.z1 - HB.z0)
        const h = this.grid.at(lx, lz)
        const shade = clamp(0.8 + (this.grid.at(lx - 14, lz) - this.grid.at(lx + 14, lz)) / 60, 0.5, 1.2)
        let r: number, gg: number, b: number
        if (h < 4) [r, gg, b] = [92, 120, 78]
        else if (h < 330) [r, gg, b] = [44, 92, 56]
        else if (h < 560) [r, gg, b] = [126, 138, 84]
        else if (h < 640) [r, gg, b] = [150, 146, 134]
        else [r, gg, b] = [236, 240, 247]
        if (h < -10) [r, gg, b] = [70, 98, 118] // the deep valley
        const o = (y * W + x) * 4
        img.data[o] = Math.min(255, r * shade)
        img.data[o + 1] = Math.min(255, gg * shade)
        img.data[o + 2] = Math.min(255, b * shade)
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    // the road, its width exaggerated so it reads
    g.strokeStyle = '#f2efe6'
    g.lineWidth = 2.2
    g.lineJoin = 'round'
    g.beginPath()
    ROUTE.forEach((p, i) => {
      const x = ((p.x - HB.x0) / (HB.x1 - HB.x0)) * W
      const y = ((p.z - HB.z0) / (HB.z1 - HB.z0)) * H
      i ? g.lineTo(x, y) : g.moveTo(x, y)
    })
    g.stroke()
    g.strokeStyle = '#ff9a3d'
    g.setLineDash([3, 3])
    g.lineWidth = 1.6
    g.beginPath()
    for (let lz = VIEW.z - 30; lz > SUMMIT.z; lz -= 20) {
      const x = ((this.trailX(lz) - HB.x0) / (HB.x1 - HB.x0)) * W
      const y = ((lz - HB.z0) / (HB.z1 - HB.z0)) * H
      lz === VIEW.z - 30 ? g.moveTo(x, y) : g.lineTo(x, y)
    }
    g.stroke()
    this.mapCanvas = c
    return c
  }

  setVisible(v: boolean) {
    this.group.visible = v
    this.panorama.group.visible = v
  }

  /* ── terrain ──────────────────────────────────────────────── */

  private terrainChunks!: ChunkedTerrain
  private outerChunks!: ChunkedTerrain

  private terrain() {
    const g = this.grid
    const mat = terrainMaterial(this.assets, true)
    // the ground the player sees: the 10 m grid (with the road cut into it) plus rock and crag detail off the road,
    // and the analytic mountain beyond the grid, so the horizon is real land
    const height = (x: number, z: number, detail: number) => {
      const lz = z - HILLS_Z
      const inside = x > HB.x0 + 12 && x < HB.x1 - 12 && lz > HB.z0 + 12 && lz < HB.z1 - 12
      const h = inside ? g.at(x, lz) : outerHeight(x, lz)
      const rw = inside ? g.roadAt(x, lz) : 0
      const amp = (0.25 + 1.6 * smoothstep(450, 800, h)) * (1 - rw)
      return h + microDetail(x, z, detail * amp)
    }
    const inner = { x0: HB.x0, z0: HILLS_Z + HB.z0, x1: HB.x1, z1: HILLS_Z + HB.z1 }
    this.terrainChunks = new ChunkedTerrain(inner, 150, [{ cell: 3.75, dist: 230, detail: 1 }, { cell: 7.5, dist: 620, detail: 0.5 }, { cell: 18.75, dist: 1e9, detail: 0 }], height, mat)
    this.group.add(this.terrainChunks.group)
    this.terrainChunks.prime(new THREE.Vector3(this.arrive.x, 0, this.arrive.z))
    // far ranges: six big chunks all round, coarse, snow-capped
    const ring = 6 * 300
    this.outerChunks = new ChunkedTerrain({ x0: inner.x0 - ring, z0: inner.z0 - ring, x1: inner.x1 + ring, z1: inner.z1 + ring }, 300, [{ cell: 50, dist: 1e9, detail: 0 }], height, mat, inner)
    this.group.add(this.outerChunks.group)
    this.outerChunks.prime(new THREE.Vector3(this.arrive.x, 0, this.arrive.z))

    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((HB.x0 + HB.x1) / 2, 0, HILLS_Z + (HB.z0 + HB.z1) / 2))
    this.physics.world.createCollider(RAPIER.ColliderDesc.heightfield(g.nz, g.nx, g.h, { x: g.nx * g.res, y: 1, z: g.nz * g.res }), body)
  }

  /* ── the road ─────────────────────────────────────────────── */

  private road() {
    const m = this.mats
    const pts = ROUTE
    const N = pts.length
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i < N; i++) {
      const p = pts[i]
      const hw = p.w / 2
      pos.push(p.x + p.nx * hw, p.y, HILLS_Z + p.z + p.nz * hw, p.x - p.nx * hw, p.y, HILLS_Z + p.z - p.nz * hw)
      uv.push(0, p.s / 6, p.w / 6, p.s / 6)
      if (i < N - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    cleanNormals(geo)
    const road = new THREE.Mesh(geo, m.asphalt)
    road.receiveShadow = true
    this.group.add(road)
    road.updateMatrixWorld(true)
    this.physics.fixedMesh(road)

    // paint: solid edge lines, a dashed centre line while the road is wide enough for two lanes
    const b = new Batch()
    const ribbon = (offset: (p: (typeof pts)[number]) => number, width: number, yOff: number, keep: (i: number) => boolean) => {
      const P: number[] = []
      const I: number[] = []
      let base = 0
      for (let i = 0; i < N - 1; i++) {
        if (!keep(i)) continue
        for (const k of [i, i + 1]) {
          const p = pts[k]
          const o = offset(p)
          P.push(p.x + p.nx * (o + width / 2), p.y + yOff, HILLS_Z + p.z + p.nz * (o + width / 2), p.x + p.nx * (o - width / 2), p.y + yOff, HILLS_Z + p.z + p.nz * (o - width / 2))
        }
        I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
        base += 4
      }
      if (!P.length) return
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
      g.setIndex(I)
      cleanNormals(g)
      b.add(g, m.line)
    }
    for (const s of [-1, 1]) ribbon((p) => s * (p.w / 2 - 0.45), 0.14, 0.025, () => true)
    ribbon(() => 0, 0.13, 0.025, (i) => pts[i].w > 7 && Math.floor(pts[i].s / 8) % 2 === 0)

    // low stone parapets on the downhill side, where there is a drop
    const wallPos: number[] = []
    const wallUv: number[] = []
    const wallIdx: number[] = []
    let wb = 0
    // walls on both sides along the whole climb: nobody drives off a mountain road (the tunnel and the viewpoint apron stay open)
    const drop = (p: (typeof pts)[number], _side: number) => p.s > 150 && p.s < ROUTE_LENGTH - 45
    for (let i = 0; i < N - 1; i += 1) {
      for (const side of [-1, 1]) {
        if (!drop(pts[i], side) || !drop(pts[i + 1], side)) continue
        const a = pts[i]
        const c = pts[i + 1]
        const quad: number[] = []
        for (const p of [a, c]) {
          const e = p.w / 2 + 0.25
          const inner = e - 0.25
          const outer = e + 0.25
          const px = (o: number) => p.x + side * p.nx * o
          const pz = (o: number) => HILLS_Z + p.z + side * p.nz * o
          quad.push(px(inner), p.y, pz(inner), px(inner), p.y + 0.75, pz(inner), px(outer), p.y + 0.75, pz(outer), px(outer), p.y, pz(outer))
        }
        wallPos.push(...quad)
        // painted stones: black and white every 1.4 m, like the real hill roads
        for (const p of [a, c]) for (const v of [0, 1, 1, 0]) wallUv.push(p.s / 1.4, v)
        // top, inner and outer faces (both windings so it is solid from any side)
        const f = (a1: number, a2: number, a3: number, a4: number) => wallIdx.push(wb + a1, wb + a2, wb + a3, wb + a1, wb + a3, wb + a4)
        f(1, 2, 6, 5)
        f(0, 1, 5, 4)
        f(3, 2, 6, 7)
        wb += 8
      }
    }
    if (wallPos.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2))
      g.setIndex(wallIdx)
      cleanNormals(g)
      const stripe = document.createElement('canvas')
      stripe.width = 64
      stripe.height = 4
      const sg = stripe.getContext('2d')!
      sg.fillStyle = '#1d1d20'
      sg.fillRect(0, 0, 32, 4)
      sg.fillStyle = '#e8e4d6'
      sg.fillRect(32, 0, 32, 4)
      const stripeTex = new THREE.CanvasTexture(stripe)
      stripeTex.colorSpace = THREE.SRGBColorSpace
      stripeTex.wrapS = THREE.RepeatWrapping
      const wallMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.9, side: THREE.DoubleSide })
      const wall = new THREE.Mesh(g, wallMat)
      wall.castShadow = true
      this.group.add(wall)
      wall.updateMatrixWorld(true)
      this.physics.fixedMesh(wall)
    }
    // km stones every 500 m
    for (let s = 500; s < ROUTE_LENGTH; s += 500) {
      const p = pts.find((q) => q.s >= s)!
      b.box(0.3, 0.8, 0.2, m.line, M(p.x + p.nx * (p.w / 2 + 0.9), p.y + 0.4, HILLS_Z + p.z + p.nz * (p.w / 2 + 0.9)), 1)
    }
    b.build(this.group)
  }

  /* ── forest, undergrowth and rock ─────────────────────────── */

  private forest() {
    const density = this.quality.density
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const ng = g.index ? g.toNonIndexed() : g
      const n = ng.attributes.position.count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3))
      if (!ng.attributes.normal) ng.computeVertexNormals()
      return ng
    }
    const conifer = (trunk: number, layers: [number, number, number, string][]) => {
      const parts = [paint(new THREE.CylinderGeometry(0.2, 0.34, trunk, 5).translate(0, trunk / 2, 0), new THREE.Color('#3b2a1c'))]
      for (const [rad, h, y, c] of layers) parts.push(paint(new THREE.ConeGeometry(rad, h, 8, 1).translate(0, y + h / 2, 0), new THREE.Color(c)))
      return mergeParts(parts)
    }
    const blob = (rx: number, ry: number, x: number, y: number, z: number, c: string, seed: number) => {
      const g = new THREE.IcosahedronGeometry(1, 1)
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const k = 0.8 + 0.4 * noise2(p.getX(i) * 3 + seed, p.getZ(i) * 3 + p.getY(i) * 2)
        p.setXYZ(i, p.getX(i) * rx * k + x, p.getY(i) * ry * k + y, p.getZ(i) * rx * k + z)
      }
      g.computeVertexNormals()
      return paint(g, new THREE.Color(c))
    }
    const kinds = [
      // spruce: tall and narrow with many tiers
      conifer(2.2, [[2.2, 4.2, 2.6, '#14331f'], [1.9, 3.8, 4.9, '#173a22'], [1.5, 3.4, 7.0, '#1b4227'], [1.1, 3.0, 8.9, '#1f4a2b'], [0.7, 2.6, 10.6, '#245230']]),
      // fir: a fuller, darker cone
      conifer(2.6, [[2.8, 5.2, 2.8, '#102d1b'], [2.2, 4.6, 5.6, '#14331f'], [1.4, 3.8, 8.4, '#193c25']]),
      // pine: a few broad flat skirts on a long bare trunk
      conifer(5.0, [[2.6, 2.6, 5.0, '#1d4a2a'], [2.1, 2.4, 6.8, '#235430'], [1.4, 2.2, 8.4, '#2a5c35']]),
      // broadleaf: rhododendron and oak, lighter and rounder
      mergeParts([paint(new THREE.CylinderGeometry(0.22, 0.4, 3.2, 6).translate(0, 1.6, 0), new THREE.Color('#4a3524')), blob(2.6, 2.1, 0, 4.4, 0, '#3f6b2a', 1), blob(2.0, 1.7, 1.2, 5.4, 0.5, '#4a7a30', 5), blob(1.9, 1.6, -1.1, 5.0, -0.6, '#386328', 9)]),
    ]
    const shrubGeo = mergeParts([blob(1.1, 0.8, 0, 0.6, 0, '#35592a', 2), blob(0.8, 0.6, 0.8, 0.45, 0.4, '#406830', 7), blob(0.7, 0.55, -0.7, 0.4, -0.3, '#2e4f25', 12)])
    const rockGeo = (() => {
      const g = new THREE.IcosahedronGeometry(1, 1)
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const k = 0.7 + 0.5 * noise2(p.getX(i) * 2.3 + 4, p.getZ(i) * 2.3 + p.getY(i) * 3)
        p.setXYZ(i, p.getX(i) * k * 1.2, p.getY(i) * k * 0.7, p.getZ(i) * k)
      }
      g.computeVertexNormals()
      return paint(g, new THREE.Color('#7b7a76'))
    })()
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })
    const r = rng(31337)
    const CELL = 120
    type Cells = Map<string, THREE.Matrix4[]>
    const treeCells: Cells[] = kinds.map(() => new Map())
    const shrubCells: Cells = new Map()
    const rockCells: Cells = new Map()
    const add = (cells: Cells, lx: number, lz: number, mx: THREE.Matrix4) => {
      const key = `${Math.floor(lx / CELL)},${Math.floor(lz / CELL)}`
      let a = cells.get(key)
      if (!a) cells.set(key, (a = []))
      a.push(mx)
    }
    const place = (lx: number, y: number, lz: number, s: number, sy: number, tilt = 0) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * tilt, r() * 6.28, (r() - 0.5) * tilt))
      return new THREE.Matrix4().compose(new THREE.Vector3(lx, y, HILLS_Z + lz), q, new THREE.Vector3(s, s * sy, s))
    }
    const slopeAt = (lx: number, lz: number) => Math.abs(this.grid.at(lx + 6, lz) - this.grid.at(lx - 6, lz)) / 12 + Math.abs(this.grid.at(lx, lz + 6) - this.grid.at(lx, lz - 6)) / 12
    const tries = Math.round(24000 * density)
    for (let k = 0; k < tries; k++) {
      const lx = HB.x0 + 40 + r() * (HB.x1 - HB.x0 - 80)
      const lz = HB.z0 + 40 + r() * (HB.z1 - 150 - HB.z0 - 40)
      const y = this.grid.at(lx, lz)
      // forest from the plain to the tree line, thinning as it climbs
      const keep = 1 - clamp((y - 300) / 220)
      if (y < 3 || r() > keep) continue
      if (slopeAt(lx, lz) > 1.1) continue
      const nr = nearestRoute(lx, lz, 1)
      if (nr && nr.d < nr.p.w / 2 + 5) continue
      if (Math.hypot(lx - VIEW.x, lz - VIEW.z) < 70) continue
      // lower slopes: broadleaf and tea-country trees; higher: conifers
      const u = r()
      const kind = y < 160 && u < 0.45 ? 3 : u < 0.5 ? 0 : u < 0.78 ? 1 : u < 0.92 ? 2 : 3
      const s = 0.75 + r() * 0.8
      add(treeCells[kind], lx, lz, place(lx, y - 0.2, lz, s, 0.85 + r() * 0.45, 0.06))
    }
    // undergrowth: thick along the road edges, scattered through the forest
    const shrubs = Math.round(16000 * density)
    for (let k = 0; k < shrubs; k++) {
      const i = Math.floor(r() * ROUTE.length)
      const near = k % 2 === 0
      const p = near ? ROUTE[i] : null
      const lx = p ? p.x + p.nx * (r() < 0.5 ? 1 : -1) * (p.w / 2 + 2 + r() * 12) : HB.x0 + 40 + r() * (HB.x1 - HB.x0 - 80)
      const lz = p ? p.z + p.nz * 0 + (r() - 0.5) * 6 : HB.z0 + 40 + r() * (HB.z1 - 150 - HB.z0 - 40)
      const y = this.grid.at(lx, lz)
      if (y < 3 || y > 470 + r() * 40 || slopeAt(lx, lz) > 1.0) continue
      const nr = nearestRoute(lx, lz, 1)
      if (nr && nr.d < nr.p.w / 2 + 1.6) continue
      const s = 0.6 + r() * 0.9
      add(shrubCells, lx, lz, place(lx, y - 0.1, lz, s, 0.8 + r() * 0.5))
    }
    // rock: along the cuts, on steep faces and strewn above the tree line
    const rocks = Math.round(7000 * density)
    for (let k = 0; k < rocks; k++) {
      let lx: number
      let lz: number
      if (k % 3 === 0) {
        const p = ROUTE[Math.floor(r() * ROUTE.length)]
        const side = r() < 0.5 ? 1 : -1
        lx = p.x + p.nx * side * (p.w / 2 + 1.5 + r() * 18)
        lz = p.z + p.nz * side * (p.w / 2 + 1.5 + r() * 18)
      } else {
        lx = HB.x0 + 40 + r() * (HB.x1 - HB.x0 - 80)
        lz = HB.z0 + 40 + r() * (HB.z1 - 150 - HB.z0 - 40)
      }
      const y = this.grid.at(lx, lz)
      const sl = slopeAt(lx, lz)
      if (y < 3 || (k % 3 !== 0 && sl < 0.45 && y < 480)) continue
      const nr = nearestRoute(lx, lz, 1)
      if (nr && nr.d < nr.p.w / 2 + 1.4) continue
      const s = 0.5 + r() * r() * 3.2
      add(rockCells, lx, lz, place(lx, y - s * 0.25, lz, s, 0.9, 0.4))
    }
    const build = (cells: Cells, geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, far: number) => {
      for (const list of cells.values()) {
        const mesh = new THREE.InstancedMesh(geo, mat, list.length)
        list.forEach((mx, i) => mesh.setMatrixAt(i, mx))
        mesh.castShadow = cast
        mesh.computeBoundingSphere()
        this.group.add(mesh)
        this.trees.push({ mesh, c: mesh.boundingSphere!.center.clone(), far })
      }
    }
    treeCells.forEach((cells, i) => build(cells, kinds[i], treeMat, true, 1))
    build(shrubCells, shrubGeo, treeMat, false, 0.55)
    build(rockCells, rockGeo, rockMat, false, 0.7)
  }

  /* ── the tunnel exit and a welcome gate ───────────────────── */

  private start() {
    const rock = this.assets.material('rocky_terrain_02', 1)
    buildPortal(this.group, this.physics, this.mats, { x: START.x, z: HILLS_Z + START.z, dir: 1, roadY: 0, width: 16, length: 78, title: 'WELCOME TO THE HILLS', sub: 'Singalila · Sandakphu 3,636 m', rock })
  }

  /* ── Sandakphu ────────────────────────────────────────────── */

  private viewpointBuild() {
    const m = this.mats
    const b = new Batch()
    const y = VIEW_Y
    const cx = VIEW.x
    const cz = HILLS_Z + VIEW.z
    // apron: a round car park joined to the road end
    const apron = new THREE.Mesh(new THREE.CircleGeometry(17, 40).rotateX(-Math.PI / 2), m.asphalt)
    apron.position.set(cx, y + 0.015, cz)
    apron.receiveShadow = true
    this.group.add(apron)
    this.physics.fixedCylinder(cx, y - 0.15, cz, 17, 0.3)
    for (let i = -3; i <= 3; i++) b.add(new THREE.PlaneGeometry(0.15, 5).rotateX(-Math.PI / 2), m.line, M(cx - 6 + i * 2.7, y + 0.03, cz + 9))

    // the viewing deck: timber boards over the east edge, a railing all round
    const deckX = cx + 34
    const deck = new THREE.Mesh(new THREE.BoxGeometry(26, 0.4, 22), m.wood)
    deck.position.set(deckX, y + 0.05, cz)
    deck.receiveShadow = deck.castShadow = true
    this.group.add(deck)
    this.physics.fixedBox(deckX, y + 0.05, cz, 13, 0.2, 11)
    // a solid footing under the deck so it never floats over the drop
    for (const [dx, dz] of [[-11, -9], [11, -9], [-11, 9], [11, 9]]) b.box(1.2, 28, 1.2, m.concrete, M(deckX + dx, y - 14, cz + dz), 2)
    const rail = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1)
      const yaw = Math.atan2(x2 - x1, z2 - z1)
      const mx = (x1 + x2) / 2
      const mz = (z1 + z2) / 2
      b.box(0.12, 0.12, len, m.frame, M(mx, y + 1.15, mz, yaw), 1)
      b.box(0.08, 0.08, len, m.frame, M(mx, y + 0.7, mz, yaw), 1)
      for (let d = 0; d <= len; d += 2) b.box(0.1, 1.1, 0.1, m.frame, M(x1 + ((x2 - x1) * d) / len, y + 0.6, z1 + ((z2 - z1) * d) / len), 1)
      this.physics.fixedBox(mx, y + 0.8, mz, 0.15, 0.8, len / 2, yaw)
    }
    rail(deckX + 13, cz - 11, deckX + 13, cz + 11)
    rail(deckX - 13, cz - 11, deckX + 13, cz - 11)
    rail(deckX - 13, cz + 11, deckX + 13, cz + 11)

    // boards on the rail naming what you are looking at
    const boards: { text: string[]; az: number; z: number }[] = [
      { text: ['KANCHENJUNGA', '8,586 m · world no. 3', 'east · 82°'], az: 82, z: -3 },
      { text: ['THE SLEEPING BUDDHA', 'Kabru is the head · Jannu the feet', 'east · 60°–105°'], az: 90, z: 3.5 },
      { text: ['SANDAKPHU', '3,636 m · highest point in West Bengal', ''], az: 0, z: -9 },
    ]
    for (const bd of boards) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshStandardMaterial({ map: labelTexture(bd.text.filter(Boolean), '#0f2a22', '#ffffff', 1024, 256), roughness: 0.7 }))
      board.position.set(deckX + 12.7, y + 0.85, cz + bd.z)
      board.rotation.order = 'YXZ'
      board.rotation.y = -Math.PI / 2
      board.rotation.x = -0.18
      this.group.add(board)
    }
    // the sign by the apron
    const big = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.6), new THREE.MeshStandardMaterial({ map: labelTexture(['SANDAKPHU', '3,636 m · Singalila Ridge'], '#7a1f12', '#fff4d6', 1024, 256, '#ffc61a'), roughness: 0.6 }))
    big.position.set(cx - 2, y + 3.4, cz + 14)
    big.rotation.y = Math.PI
    this.group.add(big)
    for (const s of [-3.4, 3.4]) b.box(0.2, 3.2, 0.2, m.frame, M(cx - 2 + s, y + 1.6, cz + 14.1), 1)
    this.physics.fixedBox(cx - 2, y + 1.6, cz + 14.1, 4, 1.6, 0.2)

    // a tea hut: stone walls, a tin roof, a lit window
    const hx = cx - 22
    const hz = cz - 8
    b.box(8, 3, 5, m.granite, M(hx, y + 1.5, hz), 2)
    b.box(8.8, 0.25, 5.8, m.corrugated, M(hx, y + 3.2, hz, 0, 1, 1, 1), 2)
    b.box(2, 3, 0.4, m.corrugated, M(hx + 2, y + 4.2, hz - 1, 0, 1, 1, 1), 2)
    const win = new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: '#ffcf80', emissiveIntensity: 0.8 })
    b.add(new THREE.PlaneGeometry(1.2, 1.0), win, M(hx + 4.02, y + 1.8, hz, Math.PI / 2))
    b.add(new THREE.PlaneGeometry(1.0, 2.0), m.frame, M(hx + 4.02, y + 1.1, hz + 1.6, Math.PI / 2))
    this.physics.fixedBox(hx, y + 1.5, hz, 4, 1.5, 2.5)
    for (const [dx, dz] of [[-3.4, 4], [-2, 4.4], [-0.8, 4.2]]) b.box(0.5, 0.9, 0.5, m.wood, M(hx + dx, y + 0.45, hz + dz + 0.5), 1)

    // prayer flags on poles round the deck
    this.flags(b, deckX - 13, cz - 11, deckX + 13, cz - 11, y + 4.6)
    this.flags(b, deckX - 13, cz + 11, deckX + 13, cz + 11, y + 4.6)
    for (const [x, z] of [[deckX - 13, cz - 11], [deckX + 13, cz - 11], [deckX - 13, cz + 11], [deckX + 13, cz + 11]]) b.box(0.14, 5, 0.14, m.wood, M(x, y + 2.5, z), 1)
    b.build(this.group)
  }

  private flags(b: Batch, x1: number, z1: number, x2: number, z2: number, y: number) {
    const colours = ['#2b6fd6', '#f2f2f2', '#d63b2b', '#2fa04a', '#f2c230']
    const n = Math.max(8, Math.round(Math.hypot(x2 - x1, z2 - z1) / 0.6))
    const yaw = Math.atan2(x2 - x1, z2 - z1)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      const sag = Math.sin(t * Math.PI) * 0.9
      const mat = this.flagMat(colours[i % 5])
      b.add(new THREE.PlaneGeometry(0.34, 0.26), mat, M(x1 + (x2 - x1) * t, y - sag - 0.14, z1 + (z2 - z1) * t, yaw + Math.PI / 2))
    }
  }

  private flagCache = new Map<string, THREE.Material>()
  private flagMat(c: string) {
    let m = this.flagCache.get(c)
    if (!m) this.flagCache.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide })))
    return m
  }

  /* ── the expedition trail ─────────────────────────────────── */

  private trailX = (lz: number) => 14 * Math.sin(lz / 170)

  private expedition() {
    const m = this.mats
    const b = new Batch()
    // cairns and prayer-flag poles marking the way
    const r = rng(7)
    for (let lz = VIEW.z - 60; lz > SUMMIT.z; lz -= 70) {
      const x = this.trailX(lz) + (r() < 0.5 ? -2.2 : 2.2)
      const y = this.grid.at(x, lz)
      for (let i = 0; i < 4; i++) b.add(new THREE.SphereGeometry(0.5 - i * 0.09, 7, 5), m.granite, M(x, y + 0.35 + i * 0.5, HILLS_Z + lz, i))
      this.physics.fixedCylinder(x, y + 1, HILLS_Z + lz, 0.5, 2)
    }
    for (let lz = VIEW.z - 160; lz > SUMMIT.z + 40; lz -= 260) {
      const x1 = this.trailX(lz) - 2.6
      const x2 = this.trailX(lz) + 2.6
      const y1 = this.grid.at(x1, lz)
      const y2 = this.grid.at(x2, lz)
      b.box(0.14, 5, 0.14, m.wood, M(x1, y1 + 2.5, HILLS_Z + lz), 1)
      b.box(0.14, 5, 0.14, m.wood, M(x2, y2 + 2.5, HILLS_Z + lz), 1)
      this.flags(b, x1, HILLS_Z + lz, x2, HILLS_Z + lz, Math.min(y1, y2) + 4.6)
    }
    // trailhead sign at the viewpoint
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), new THREE.MeshStandardMaterial({ map: labelTexture(['EXPEDITION', 'Kanchenjunga base camp →  2.7 km north'], '#12243a', '#ffffff', 1024, 256, '#ff7a3d'), roughness: 0.7 }))
    const tz = VIEW.z - 26
    sign.position.set(this.trailX(tz) - 3.2, this.grid.at(this.trailX(tz) - 3.2, tz) + 1.9, HILLS_Z + tz)
    sign.rotation.y = Math.PI
    this.group.add(sign)
    b.box(0.14, 2, 0.14, m.wood, M(sign.position.x, sign.position.y - 1, sign.position.z), 1)

    // base camp: tents round a fire ring, a mess tent, flags
    const bx = BASECAMP.x
    const bz = BASECAMP.z
    const by = this.grid.at(bx, bz)
    const cols = ['#d6532b', '#2b78d6', '#f2c230', '#2fa04a', '#d62b86', '#e8e8e8']
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const tx = bx + Math.cos(a) * 12
      const tz2 = bz + Math.sin(a) * 12
      const ty = this.grid.at(tx, tz2)
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.9 }))
      tent.position.set(tx, ty + 1.1, HILLS_Z + tz2)
      tent.rotation.y = -a
      tent.castShadow = true
      this.group.add(tent)
      this.physics.fixedCylinder(tx, ty + 1, HILLS_Z + tz2, 1.6, 2)
    }
    for (const t of [0, 1, 2, 3, 4]) b.add(new THREE.SphereGeometry(0.28, 6, 5), m.granite, M(bx + Math.cos(t * 1.26) * 1.6, by + 0.2, HILLS_Z + bz + Math.sin(t * 1.26) * 1.6))
    const fire = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: '#ff7a1a', emissiveIntensity: 2.5 })
    b.add(new THREE.ConeGeometry(0.5, 0.9, 6), fire, M(bx, by + 0.45, HILLS_Z + bz))
    this.flags(b, bx - 10, HILLS_Z + bz - 14, bx + 10, HILLS_Z + bz - 14, by + 5)
    for (const x of [bx - 10, bx + 10]) b.box(0.14, 6, 0.14, m.wood, M(x, this.grid.at(x, bz - 14) + 3, HILLS_Z + bz - 14), 1)

    // the summit: a flagpole, a cairn, a plaque
    const sx = SUMMIT.x
    const sy = this.grid.at(sx, SUMMIT.z)
    b.box(0.12, 9, 0.12, m.frame, M(sx, sy + 4.5, HILLS_Z + SUMMIT.z), 1)
    b.box(2.6, 1.6, 0.04, this.flagMat('#d63b2b'), M(sx + 1.4, sy + 8.2, HILLS_Z + SUMMIT.z), 1)
    for (let i = 0; i < 5; i++) b.add(new THREE.SphereGeometry(0.9 - i * 0.13, 7, 5), m.granite, M(sx + 2, sy + 0.5 + i * 0.7, HILLS_Z + SUMMIT.z + 1.5, i))
    this.physics.fixedCylinder(sx + 2, sy + 1.5, HILLS_Z + SUMMIT.z + 1.5, 1, 3)
    b.build(this.group)
  }

  /* ── clouds ───────────────────────────────────────────────── */

  private cloudSea() {
    const make = (y: number, cover: number, speed: number) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#f4f1ec') }, uCam: { value: new THREE.Vector3() }, uY: { value: y }, uCover: { value: cover }, uSpeed: { value: speed } },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `
          uniform float uTime; uniform vec3 uColor; uniform vec3 uCam; uniform float uY; uniform float uCover; uniform float uSpeed;
          varying vec3 vW;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float a=0.0, w=0.5; for(int i=0;i<5;i++){ a+=w*vn(p); p*=2.03; w*=0.5; } return a; }
          void main(){
            vec2 p = vW.xz * 0.0011 + vec2(uTime * uSpeed, uTime * uSpeed * 0.4);
            float d = fbm(p) + 0.25 * fbm(p * 3.1 + 7.0);
            float a = smoothstep(uCover - 0.12, uCover + 0.2, d);
            float dist = length(vW.xz - uCam.xz);
            a *= 1.0 - smoothstep(2300.0, 3300.0, dist);
            // thin out when the camera is inside the layer
            a *= smoothstep(6.0, 50.0, abs(uCam.y - uY));
            // thick cloud is brighter on top and greyer in its hollows
            float body = smoothstep(uCover, uCover + 0.35, d);
            vec3 c = uColor * (0.62 + 0.55 * body) * (0.85 + 0.25 * fbm(p * 5.0));
            gl_FragColor = vec4(c, a * 0.97);
          }`,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), mat)
      mesh.position.y = y
      mesh.frustumCulled = false
      mesh.renderOrder = 3
      this.group.add(mesh)
      this.clouds.push(mesh)
      this.cloudMats.push(mat)
    }
    make(60, 0.52, 0.006)
    make(210, 0.7, 0.004)
  }

  /** an invisible wall round the region so nobody walks off the map */
  private fence() {
    const pts: [number, number][] = [[HB.x0 + 8, HB.z0 + 8], [HB.x1 - 8, HB.z0 + 8], [HB.x1 - 8, HB.z1 - 8], [HB.x0 + 8, HB.z1 - 8]]
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[(i + 1) % 4]
      const len = Math.hypot(bx - ax, bz - az)
      this.physics.fixedBox((ax + bx) / 2, 400, HILLS_Z + (az + bz) / 2, Math.abs(bx - ax) / 2 + 1, 1000, Math.abs(bz - az) / 2 + 1)
      void len
    }
  }

  /* ── per-frame ────────────────────────────────────────────── */

  update(dt: number, t: number, cam: THREE.Vector3, focus: THREE.Vector3, haze: THREE.Color, alpenglow: number, night: number) {
    if (!this.built) return
    this.terrainChunks.update(focus, dt)
    this.outerChunks.update(focus, dt)
    // distance-cull pine chunks
    this.cull -= dt
    if (this.cull <= 0) {
      this.cull = 0.3
      const far = this.quality.tier === 'high' ? 380 : this.quality.tier === 'mid' ? 300 : 220
      for (const tr of this.trees) tr.mesh.visible = Math.hypot(tr.c.x - focus.x, tr.c.z - focus.z) < (far + 90) * tr.far
    }
    const lz = focus.z - HILLS_Z
    // how far along the expedition you are: the range rises as you approach it
    this.panorama.approach = clamp((VIEW.z - lz) / (VIEW.z - SUMMIT.z)) * clamp(1 - Math.abs(focus.x - VIEW.x) / 900)
    this.panorama.update(cam, haze, alpenglow, night)
    const cloudCol = haze.clone().lerp(new THREE.Color('#ffffff'), 0.55).multiplyScalar(1 - night * 0.9)
    cloudCol.lerp(new THREE.Color('#ffc9a3'), alpenglow * 0.5)
    for (const m of this.cloudMats) {
      m.uniforms.uTime.value = t
      m.uniforms.uCam.value.copy(cam)
      m.uniforms.uColor.value.copy(cloudCol)
    }
    for (const c of this.clouds) c.position.set(cam.x, c.position.y, cam.z)
    // arrivals
    const near = (x: number, z: number, r: number) => Math.hypot(focus.x - x, lz - z) < r && Math.abs(focus.y - this.grid.at(x, z)) < 60
    const fire = (e: HillEvent) => {
      if (!this.fired.has(e)) {
        this.fired.add(e)
        this.onEvent?.(e)
      }
    }
    if (near(VIEW.x + 10, VIEW.z, 40)) fire('viewpoint')
    if (near(BASECAMP.x, BASECAMP.z, 30)) fire('basecamp')
    if (near(SUMMIT.x, SUMMIT.z, 22)) fire('summit')
  }
}

/** normals from degenerate triangles can come out NaN, and one NaN pixel blacks out the whole bloom chain */
function cleanNormals(g: THREE.BufferGeometry) {
  g.computeVertexNormals()
  const n = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))) n.setXYZ(i, 0, 1, 0)
  return g
}

/** merge several non-indexed geometries that all carry position / normal / uv / color */
function mergeParts(parts: THREE.BufferGeometry[]) {
  let n = 0
  for (const p of parts) n += p.attributes.position.count
  const attrs: Record<string, Float32Array> = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), color: new Float32Array(n * 3) }
  let o = 0
  for (const p of parts) {
    const c = p.attributes.position.count
    attrs.position.set(p.attributes.position.array as Float32Array, o * 3)
    attrs.normal.set(p.attributes.normal.array as Float32Array, o * 3)
    attrs.color.set(p.attributes.color.array as Float32Array, o * 3)
    o += c
  }
  const g = new THREE.BufferGeometry()
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, new THREE.BufferAttribute(v, 3))
  g.computeBoundingSphere()
  return g
}

export { PEAKS, noise2 }
