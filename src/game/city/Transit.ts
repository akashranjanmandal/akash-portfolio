import * as THREE from 'three'
import { RAPIER, type Physics } from '../Physics'
import { Batch, M } from './Batch'
import { townBuilding, type Materials } from './Town'
import { labelTexture } from '../hills/Portal'
import { rng } from '../../utils/math'
import { FLY, flyoverPath } from './Flyover'

/* ──────────────────────────────────────────────────────────────
   RAILWAYS
   The Kolkata Metro runs on a concrete viaduct above the east–west
   road at z = 100, its piers standing in the roadway. South of the
   grid a suburban line has a terminal with colonial arcades, an
   overhead-wire catenary, a level crossing with barriers and bells,
   and electric trains that stop at the platform.
────────────────────────────────────────────────────────────── */

export const METRO = { z: 100, y: 9.5, x0: -190, x1: 430, stations: [0, 300] as number[] }
export const RAIL = { z1: 456, z2: 462, x0: -190, x1: 410, platformX: [40, 230] as [number, number], crossingX: 300 }

type Glow = { mat: THREE.MeshStandardMaterial; day: number; night: number }

/** a long strip along a polyline: the cross-section (lateral offset, height) is swept down the path */
export function sweep(path: THREE.Vector3[], section: [number, number][], closed = true) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let s = 0
  const rows = section.length
  for (let i = 0; i < path.length; i++) {
    if (i > 0) s += path[i].distanceTo(path[i - 1])
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(path.length - 1, i + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    const nx = -dz / l
    const nz = dx / l
    let c = 0
    for (let k = 0; k < rows; k++) {
      const [o, h] = section[k]
      pos.push(path[i].x + nx * o, path[i].y + h, path[i].z + nz * o)
      uv.push(s / 4, c / 4)
      if (k < rows - 1) c += Math.hypot(section[k + 1][0] - o, section[k + 1][1] - h)
    }
  }
  const segs = closed ? rows : rows - 1
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * rows + k
      const b = i * rows + ((k + 1) % rows)
      const c = (i + 1) * rows + k
      const d = (i + 1) * rows + ((k + 1) % rows)
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  const n = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))) n.setXYZ(i, 0, 1, 0)
  return g
}

type Train = {
  group: THREE.Group
  coaches: number
  length: number
  /** x of the train's centre */
  x: number
  v: number
  dir: 1 | -1
  top: number
  stopAt: number[]
  wait: number
  /** the station just served, so a departing train does not stop there again */
  served: number
  windows: THREE.MeshStandardMaterial
  head: THREE.MeshStandardMaterial
  body?: RAPIER.RigidBody
  z: number
  y: number
}

export class Transit {
  readonly group = new THREE.Group()
  trains: Train[] = []
  private glow: Glow[] = []
  private arms: { pivot: THREE.Group; angle: number }[] = []
  private lamps: THREE.MeshStandardMaterial[] = []
  private blink = 0
  /** called when the crossing bells ring: position of the crossing */
  onBell?: (pos: THREE.Vector3) => void
  private bellTimer = 0

  constructor(private physics: Physics, private m: Materials) {
    const b = new Batch()
    this.metro(b)
    this.railway(b)
    this.flyover(b)
    b.build(this.group)
    this.trains.push(this.makeTrain(3, 17, 'metro'))
    this.trains[0].z = METRO.z + 2.1
    this.trains[0].y = METRO.y + 0.12
    this.trains[0].top = 17
    this.trains[0].stopAt = METRO.stations
    this.trains[0].x = METRO.x0 + 40
    this.trains[0].dir = 1
    const t1 = this.makeTrain(4, 20, 'rail')
    t1.z = RAIL.z1
    t1.y = 0.3
    t1.top = 22
    t1.stopAt = [(RAIL.platformX[0] + RAIL.platformX[1]) / 2]
    t1.x = RAIL.x0 + 60
    t1.dir = 1
    const t2 = this.makeTrain(4, 20, 'rail')
    t2.z = RAIL.z2
    t2.y = 0.3
    t2.top = 28
    t2.stopAt = []
    t2.x = RAIL.x1 - 80
    t2.dir = -1
    this.trains.push(t1, t2)
    for (const t of this.trains) this.group.add(t.group)
    for (const t of this.trains.slice(1)) {
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(t.x, 2.2, t.z))
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(t.length / 2, 1.9, 1.4), body)
      t.body = body
    }
  }

  /* ── the metro ────────────────────────────────────────────── */

  private metro(b: Batch) {
    const { m, physics } = this
    const { z, y, x0, x1 } = METRO
    const path: THREE.Vector3[] = []
    for (let x = x0; x <= x1; x += 5) path.push(new THREE.Vector3(x, y, z))
    // a box girder with parapets
    const W = 9
    const deck = new THREE.Mesh(
      sweep(path, [[-W / 2 - 0.5, -1.4], [-W / 2 - 0.5, 0.9], [-W / 2, 0.9], [-W / 2, 0], [W / 2, 0], [W / 2, 0.9], [W / 2 + 0.5, 0.9], [W / 2 + 0.5, -1.4]]),
      (m.concrete as THREE.MeshStandardMaterial).clone(),
    )
    ;(deck.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    deck.castShadow = deck.receiveShadow = true
    this.group.add(deck)
    deck.updateMatrixWorld(true)
    physics.fixedMesh(deck)

    // piers in the roadway: a column with a flared cap, set clear of every junction
    for (let x = x0 + 12.5; x < x1; x += 25) {
      const near = Math.round(x / 100) * 100
      if (Math.abs(x - near) < 9) continue
      b.box(1.7, y - 1.2, 1.7, m.concrete, M(x, (y - 1.2) / 2, z), 2)
      b.box(4.6, 1.0, 2.6, m.concrete, M(x, y - 1.6, z), 2)
      b.box(5.4, 0.5, 2.0, m.concrete, M(x, y - 2.2, z), 2)
      physics.fixedBox(x, (y - 1.2) / 2, z, 0.85, (y - 1.2) / 2, 0.85)
    }
    // two tracks: ballast, sleepers, rails
    const ballast = new THREE.MeshStandardMaterial({ color: '#4a4944', roughness: 1 })
    const steel = new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 0.4, metalness: 0.8 })
    for (const tz of [-2.1, 2.1]) {
      b.box(x1 - x0, 0.14, 3.2, ballast, M((x0 + x1) / 2, y + 0.07, z + tz), 4)
      for (const r of [-0.72, 0.72]) b.box(x1 - x0, 0.16, 0.1, steel, M((x0 + x1) / 2, y + 0.22, z + tz + r), 1)
      for (let x = x0 + 2; x < x1; x += 1.4) b.box(0.28, 0.1, 2.5, m.wood, M(x, y + 0.17, z + tz), 1)
    }
    // the third rail, a yellow centre stripe, and red buffer stops at both ends
    b.box(x1 - x0, 0.05, 0.12, m.yellowLine, M((x0 + x1) / 2, y + 0.12, z), 1)
    const red = new THREE.MeshStandardMaterial({ color: '#c1272d', roughness: 0.6 })
    for (const [bx, s] of [[x0 + 1, 1], [x1 - 1, -1]] as const) for (const tz of [-2.1, 2.1]) b.box(0.6, 1.1, 2.4, red, M(bx + s * 0.1, y + 0.7, z + tz), 1)

    // stations: a canopy on columns, name boards on both faces, lit strips under the roof
    for (const [i, sx] of METRO.stations.entries()) {
      const len = 70
      b.box(len, 0.35, 10.5, m.trim, M(sx, y + 4.6, z), 2)
      for (let k = -len / 2 + 3; k <= len / 2 - 3; k += 7) for (const s of [-1, 1]) b.box(0.4, 4.4, 0.4, m.frame, M(sx + k, y + 2.4, z + s * 4.9), 1)
      const lit = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffe2b0', emissiveIntensity: 0.4 })
      this.glow.push({ mat: lit, day: 0.4, night: 3.5 })
      for (let k = -len / 2 + 6; k < len / 2 - 4; k += 8) b.box(5, 0.1, 0.4, lit, M(sx + k, y + 4.35, z), 1)
      const name = i === 0 ? 'ESPLANADE' : 'PARK STREET'
      for (const s of [-1, 1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshStandardMaterial({ map: labelTexture([name, 'KOLKATA METRO'], '#0a3d91', '#ffffff', 1024, 256, '#ffd23a'), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0 }))
        ;(sign.material as THREE.MeshStandardMaterial).emissiveMap = (sign.material as THREE.MeshStandardMaterial).map
        this.glow.push({ mat: sign.material as THREE.MeshStandardMaterial, day: 0.05, night: 0.9 })
        sign.position.set(sx, y + 3.3, z + s * 5.26)
        if (s < 0) sign.rotation.y = Math.PI
        this.group.add(sign)
      }
      // platform edge tactile strips
      for (const tz of [-3.6, 3.6]) b.box(len - 4, 0.04, 0.4, m.yellowLine, M(sx, y + 0.05, z + tz), 1)
    }
  }

  /* ── the suburban line ────────────────────────────────────── */

  private railway(b: Batch) {
    const { m, physics } = this
    const r = rng(77)
    const { z1, z2, x0, x1, platformX, crossingX } = RAIL
    const zc = (z1 + z2) / 2
    const ballast = new THREE.MeshStandardMaterial({ color: '#59564f', roughness: 1 })
    const steel = new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 0.4, metalness: 0.8 })
    b.box(x1 - x0, 0.2, 13, ballast, M((x0 + x1) / 2, 0.1, zc), 4)
    for (const tz of [z1, z2]) {
      for (const k of [-0.72, 0.72]) b.box(x1 - x0, 0.17, 0.11, steel, M((x0 + x1) / 2, 0.28, tz + k), 1)
      for (let x = x0 + 1; x < x1; x += 1.3) b.box(0.28, 0.12, 2.6, m.wood, M(x, 0.24, tz), 1)
    }
    const red = new THREE.MeshStandardMaterial({ color: '#c1272d', roughness: 0.6 })
    for (const tz of [z1, z2]) for (const [bx, s] of [[x0 + 2, 1], [x1 - 2, -1]] as const) b.box(0.6, 1.1, 2.4, red, M(bx + s * 0.1, 0.8, tz), 1)

    // overhead wires: masts between the tracks' outer side, a cantilever over each track, two contact wires
    for (let x = x0 + 10; x < x1; x += 36) {
      b.box(0.3, 7.6, 0.3, m.frame, M(x, 3.8, z2 + 7), 1)
      b.box(0.15, 0.15, 14, m.frame, M(x, 7.2, zc + 3.5), 1)
      physics.fixedCylinder(x, 1.5, z2 + 7, 0.2, 3)
    }
    const wire = new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.6 })
    for (const tz of [z1, z2]) {
      b.box(x1 - x0, 0.04, 0.04, wire, M((x0 + x1) / 2, 6.6, tz), 1)
      b.box(x1 - x0, 0.03, 0.03, wire, M((x0 + x1) / 2, 7.1, tz), 1)
    }

    // the terminal: colonial arcades facing the grid's south road, a clock tower, a long platform with a canopy
    const brick = m.redBrick
    for (const bx of [100, 170]) townBuilding(b, m, bx, 424, Math.PI, 66, 18, 3, brick, r, { shop: false })
    b.box(14, 22, 14, m.redBrick, M(135, 11, 424), 2)
    b.add(new THREE.ConeGeometry(10, 5, 4).rotateY(Math.PI / 4), m.roof, M(135, 24.5, 424))
    const clock = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshStandardMaterial({ map: labelTexture(['12'], '#f4efe2', '#1a1a1a', 128, 128, '#f4efe2'), roughness: 0.5 }))
    clock.position.set(135, 18, 431.1)
    this.group.add(clock)
    physics.fixedBox(135, 11, 424, 7, 11, 7)
    for (const bx of [100, 170]) physics.fixedBox(bx, 6, 424, 33, 6, 9)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.2), new THREE.MeshStandardMaterial({ map: labelTexture(['SEALDAH', 'Suburban terminal · platforms 1 & 2'], '#7a1f12', '#fff4d6', 1024, 256, '#ffc61a'), roughness: 0.6 }))
    sign.position.set(135, 14.2, 417.0)
    sign.rotation.y = Math.PI
    this.group.add(sign)
    // platform
    const px0 = platformX[0]
    const px1 = platformX[1]
    b.box(px1 - px0, 0.9, 6, m.concrete, M((px0 + px1) / 2, 0.45, 449.8), 3)
    b.box(px1 - px0, 0.03, 0.4, m.yellowLine, M((px0 + px1) / 2, 0.92, 452.6), 1)
    physics.fixedBox((px0 + px1) / 2, 0.45, 449.8, (px1 - px0) / 2, 0.45, 3)
    b.box(px1 - px0 + 4, 0.3, 7.5, m.corrugated, M((px0 + px1) / 2, 5.4, 449.8), 2)
    for (let x = px0 + 4; x < px1; x += 8) b.box(0.3, 4.5, 0.3, m.frame, M(x, 3.1, 452.2), 1)
    for (let x = px0 + 6; x < px1 - 4; x += 14) {
      b.box(2.2, 0.08, 0.6, m.wood, M(x, 1.4, 448), 1)
      physics.fixedBox(x, 1.2, 448, 1.1, 0.4, 0.4)
    }
    // steps from the street side
    for (let i = 0; i < 4; i++) b.box(8, 0.22, 0.4, m.concrete, M(135, 0.12 + i * 0.22, 445.8 - i * 0.4), 1)

    // the level crossing: a road over the tracks, planks, barriers and flashing lights
    const cx = crossingX
    const road = new THREE.MeshStandardMaterial({ color: '#2d2d30', roughness: 0.95 })
    b.box(8, 0.06, 100, road, M(cx, 0.03, 455), 3)
    for (let z = 410; z < 500; z += 6) b.box(0.15, 0.02, 3, m.yellowLine, M(cx, 0.07, z), 1)
    b.box(8, 0.12, 14, m.concrete, M(cx, 0.2, zc), 2)
    for (const s of [-1, 1]) {
      for (const [zz, side] of [[z1 - 8, 1], [z2 + 8, -1]] as const) {
        // post, striped boom (pivoting), and a pair of red lamps
        b.box(0.35, 2.4, 0.35, m.frame, M(cx + s * 4.6, 1.2, zz), 1)
        const lamp = new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff1a1a', emissiveIntensity: 0 })
        this.lamps.push(lamp)
        b.add(new THREE.SphereGeometry(0.2, 10, 8), lamp, M(cx + s * 4.6, 2.55, zz))
        b.add(new THREE.SphereGeometry(0.2, 10, 8), lamp, M(cx + s * 4.6, 2.05, zz))
        void side
      }
    }
    for (const [zz, dir] of [[z1 - 8.6, 1], [z2 + 8.6, -1]] as const) {
      const pivot = new THREE.Group()
      pivot.position.set(cx - 4.6, 1.5, zz)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.14, 0.2), new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 }))
      arm.position.x = 4.6
      pivot.add(arm)
      for (let k = 0; k < 6; k++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.21), new THREE.MeshStandardMaterial({ color: '#d11f26' }))
        stripe.position.set(0.9 + k * 1.5, 0, 0)
        pivot.add(stripe)
      }
      this.group.add(pivot)
      this.arms.push({ pivot, angle: 1.35 })
      void dir
    }
  }


  /* ── the flyover ──────────────────────────────────────────── */

  private flyover(b: Batch) {
    const { m, physics } = this
    const path = flyoverPath()
    const W = FLY.width
    // the structure: a concrete girder with parapets; the driving surface is asphalt laid on top
    const deck = new THREE.Mesh(
      sweep(path, [[-W / 2 - 0.4, -1.6], [-W / 2 - 0.4, 0.95], [-W / 2, 0.95], [-W / 2, 0], [W / 2, 0], [W / 2, 0.95], [W / 2 + 0.4, 0.95], [W / 2 + 0.4, -1.6]]),
      (m.concrete as THREE.MeshStandardMaterial).clone(),
    )
    ;(deck.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    deck.castShadow = deck.receiveShadow = true
    this.group.add(deck)
    deck.updateMatrixWorld(true)
    physics.fixedMesh(deck)
    const surface = new THREE.Mesh(sweep(path.map((p) => p.clone().setY(p.y + 0.03)), [[-W / 2, 0], [W / 2, 0]], false), m.asphalt)
    surface.receiveShadow = true
    this.group.add(surface)
    // lane markings on the surface
    for (let i = 0; i < path.length - 1; i += 2) {
      const p = path[i]
      const q = path[i + 1]
      const yaw = Math.atan2(q.x - p.x, q.z - p.z)
      b.box(0.15, 0.02, 2.4, m.line, M((p.x + q.x) / 2, (p.y + q.y) / 2 + 0.07, (p.z + q.z) / 2, yaw), 1)
    }
    // piers every 24 m where the deck is off the ground, clear of the Bypass carriageways
    const hw = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd79a', emissiveIntensity: 0.2 })
    this.glow.push({ mat: hw, day: 0.2, night: 5 })
    let next = 0
    path.forEach((p, i) => {
      if (i < next) return
      next = i + 6
      if (p.y > 1.6) {
        const inLanes = Math.abs(p.x - 450) > 7 && Math.abs(p.x - 450) < 18
        if (!inLanes) {
          b.box(1.9, p.y - 1.6, 1.9, m.concrete, M(p.x, (p.y - 1.6) / 2, p.z), 2)
          b.box(W - 1, 0.9, 2.6, m.concrete, M(p.x, p.y - 2, p.z), 2)
          physics.fixedBox(p.x, (p.y - 1.6) / 2, p.z, 0.95, (p.y - 1.6) / 2, 0.95)
        }
      }
      if (i % 5 === 0 && p.y > -1) for (const s of [-1, 1]) {
        const q = path[Math.min(path.length - 1, i + 1)]
        const yaw = Math.atan2(q.x - p.x, q.z - p.z)
        const lx = p.x + Math.cos(yaw) * s * (W / 2 + 0.2)
        const lz = p.z - Math.sin(yaw) * s * (W / 2 + 0.2)
        b.box(0.14, 2.6, 0.14, m.frame, M(lx, p.y + 1.3, lz), 1)
        b.add(new THREE.SphereGeometry(0.22, 10, 8), hw, M(lx, p.y + 2.7, lz))
      }
    })
    // the platform: a round deck on a thick column, a parapet with a gap for the road, a sign
    const px = FLY.plat.x
    const r = FLY.plat.r
    const y = FLY.y
    b.add(new THREE.CylinderGeometry(r + 0.4, r + 0.4, 1.6, 40), m.concrete, M(px, y - 0.8, FLY.z))
    const top = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), m.asphalt)
    top.position.set(px, y + 0.03, FLY.z)
    this.group.add(top)
    physics.fixedCylinder(px, y - 0.8, FLY.z, r + 0.4, 1.6)
    for (const dx of [-8, 8]) for (const dz of [-8, 8]) {
      b.box(2, y - 1.6, 2, m.concrete, M(px + dx, (y - 1.6) / 2, FLY.z + dz), 2)
      physics.fixedBox(px + dx, (y - 1.6) / 2, FLY.z + dz, 1, (y - 1.6) / 2, 1)
    }
    const SEG = 28
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2
      const a1 = ((i + 1) / SEG) * Math.PI * 2
      const am = (a0 + a1) / 2
      if (Math.abs(Math.cos(am) + 1) < 0.16 || Math.abs(am - Math.PI) < 0.22) continue // the entrance, on the west side
      const x = px + Math.cos(am) * r
      const z = FLY.z + Math.sin(am) * r
      const len = 2 * r * Math.sin(Math.PI / SEG)
      const yaw = Math.atan2(-Math.cos(am), -Math.sin(am))
      b.box(len + 0.05, 1.0, 0.4, m.concrete, M(x, y + 0.5, z, yaw), 2)
      physics.fixedBox(x, y + 0.5, z, (len + 0.05) / 2, 0.5, 0.2, yaw)
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshStandardMaterial({ map: labelTexture(['VIEWING FLYOVER', 'Kolkata from above'], '#0e3b2e', '#ffffff', 1024, 256), roughness: 0.6 }))
    sign.position.set(px + r - 0.3, y + 1.9, FLY.z)
    sign.rotation.y = -Math.PI / 2
    this.group.add(sign)
    // a few benches at the rail
    for (const k of [-6, 0, 6]) {
      b.box(0.5, 0.07, 1.7, m.wood, M(px + r - 1.4, y + 0.48, FLY.z + k), 1)
      physics.fixedBox(px + r - 1.4, y + 0.45, FLY.z + k, 0.3, 0.4, 0.85)
    }
  }

  /* ── trains ───────────────────────────────────────────────── */

  private makeTrain(coaches: number, len: number, kind: 'metro' | 'rail'): Train {
    const group = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: kind === 'metro' ? '#f4f6fa' : '#e9e6dc', roughness: 0.45, metalness: 0.2 })
    const stripe = new THREE.MeshStandardMaterial({ color: kind === 'metro' ? '#1f55c2' : '#1d6b3a', roughness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.7 })
    const windows = new THREE.MeshStandardMaterial({ color: '#27323c', roughness: 0.2, metalness: 0.4, emissive: '#ffe3a8', emissiveIntensity: 0.1 })
    const head = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4d0', emissiveIntensity: 0.3 })
    const gap = 0.7
    const total = coaches * len + (coaches - 1) * gap
    const H = kind === 'metro' ? 3.5 : 3.7
    for (let c = 0; c < coaches; c++) {
      const cx = -total / 2 + len / 2 + c * (len + gap)
      const body = new THREE.Mesh(new THREE.BoxGeometry(len, H, 3.2), bodyMat)
      body.position.set(cx, H / 2 + 0.55, 0)
      body.castShadow = true
      group.add(body)
      const band = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.55, 3.22), stripe)
      band.position.set(cx, 0.55 + H * 0.28, 0)
      group.add(band)
      for (const s of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(len - 2.4, 1.0, 0.05), windows)
        win.position.set(cx, 0.55 + H * 0.62, s * 1.62)
        group.add(win)
        for (const dx of [-len / 3, 0, len / 3]) {
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 0.05), dark)
          door.position.set(cx + dx, 0.55 + 1.2, s * 1.62)
          group.add(door)
        }
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 0.35, 2.4), dark)
      roof.position.set(cx, H + 0.7, 0)
      group.add(roof)
      // bogies
      for (const dx of [-len / 2 + 3, len / 2 - 3]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.4), dark)
        bogie.position.set(cx + dx, 0.3, 0)
        group.add(bogie)
      }
    }
    // cab faces with headlights at both ends
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.9), head)
      lamp.position.set(s * (total / 2 + 0.02), 1.5, 0)
      group.add(lamp)
    }
    if (kind === 'rail') {
      const pan = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.2), dark)
      pan.position.set(0, H + 1.4, 0)
      group.add(pan)
    }
    return { group, coaches, length: total, x: 0, v: 0, dir: 1, top: 20, stopAt: [], wait: 0, served: NaN, windows, head, z: 0, y: 0 }
  }

  /** where the barriers should be: down when a rail train is within reach of the crossing */
  private crossingBusy() {
    for (const t of this.trains.slice(1)) {
      const d = Math.abs(t.x - RAIL.crossingX) - t.length / 2
      const approaching = (t.x - RAIL.crossingX) * t.dir < 0 || d < 4
      if (d < 120 && (approaching || d < t.length)) return true
    }
    return false
  }

  update(dt: number, night: number) {
    for (const t of this.trains) {
      // accelerate towards cruise; slow for a station stop; wait; turn round at the end of the line
      let target = t.top
      if (t.wait > 0) {
        t.wait -= dt
        target = 0
      } else {
        if (!Number.isNaN(t.served) && Math.abs(t.x - t.served) > 20) t.served = NaN
        for (const sx of t.stopAt) {
          if (sx === t.served) continue
          const d = (sx - t.x) * t.dir
          if (d > -0.5 && d < 50) target = Math.min(target, Math.max(2, d * 0.35))
          if (Math.abs(sx - t.x) < 0.8 && t.v < 3) {
            t.wait = 9
            t.x = sx
            t.v = 0
            t.served = sx
          }
        }
      }
      t.v += (target - t.v) * Math.min(1, dt * 0.9)
      t.x += t.dir * t.v * dt
      const lo = (t === this.trains[0] ? METRO.x0 : RAIL.x0) + t.length / 2 + 6
      const hi = (t === this.trains[0] ? METRO.x1 : RAIL.x1) - t.length / 2 - 6
      if (t.x > hi) {
        t.x = hi
        t.dir = -1
        t.wait = 7
        t.v = 0
      } else if (t.x < lo) {
        t.x = lo
        t.dir = 1
        t.wait = 7
        t.v = 0
      }
      t.group.position.set(t.x, t.y, t.z)
      t.group.rotation.y = t.dir > 0 ? 0 : Math.PI
      t.windows.emissiveIntensity = 0.1 + night * 1.9
      t.head.emissiveIntensity = 0.3 + night * 3
      t.body?.setNextKinematicTranslation({ x: t.x, y: 2.2, z: t.z })
    }
    // level crossing
    const busy = this.crossingBusy()
    this.blink += dt
    for (const a of this.arms) {
      a.angle += ((busy ? 0 : 1.35) - a.angle) * Math.min(1, dt * 1.4)
      a.pivot.rotation.z = a.angle
    }
    const flash = busy && Math.floor(this.blink * 2.5) % 2 === 0
    for (const l of this.lamps) l.emissiveIntensity = flash ? 4 : 0.1
    if (busy) {
      this.bellTimer -= dt
      if (this.bellTimer <= 0) {
        this.bellTimer = 1.1
        this.onBell?.(new THREE.Vector3(RAIL.crossingX, 1, (RAIL.z1 + RAIL.z2) / 2))
      }
    }
    for (const g of this.glow) g.mat.emissiveIntensity = night > 0.3 ? g.night * night : g.day
  }
}
