import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RAPIER, type Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'
import { labelTexture } from '../hills/Portal'
import { buildCoach, type Coach } from './Coach'
import { RING, SLIPS, rampWidth, ringPath, rampUp, rampDown } from './Flyover'
import { GRID, RAIL_RECT, METRO } from './Plan'
import { suburbanPath } from './RailLines'
import { Loop, offsetLoop, sideNormal, sweep } from './paths'

export const RAIL = {
  z1: RAIL_RECT.z1,
  z2: RAIL_RECT.z1 + 6,
  gap: 6,
  platformX: [40, 230] as [number, number],
  crossingX: 300,
  sealdah: 135,
}

type Glow = { mat: THREE.MeshStandardMaterial; day: number; night: number }

type Train = {
  cars: Coach[]
  bodies: RAPIER.RigidBody[]
  loop: Loop
  kind: 'metro' | 'rail'
  len: number
  gap: number
  total: number
  /** arc length of the train's centre */
  s: number
  v: number
  top: number
  /** arc lengths where it stops */
  stops: number[]
  wait: number
  /** the stop just served, so a departing train does not stop there again */
  served: number
  direction: number
  nextStop: number
  door: number
  /** arc length of the level crossing on this loop */
  cross: number
  windows: THREE.MeshStandardMaterial
  head: THREE.MeshStandardMaterial
  y: number
}

const wrap = (x: number, L: number) => ((((x + L / 2) % L) + L) % L) - L / 2

export class Transit {
  readonly group = new THREE.Group()
  trains: Train[] = []
  private glow: Glow[] = []
  private arms: { pivot: THREE.Group; angle: number }[] = []
  private lamps: THREE.MeshStandardMaterial[] = []
  readonly lightPositions: THREE.Vector3[] = []
  private gates: THREE.Mesh[] = []
  private blink = 0
  /** called when the crossing bells ring: position of the crossing */
  onBell?: (pos: THREE.Vector3) => void
  private bellTimer = 0
  private deckPools: THREE.Mesh | null = null
  private tA = new THREE.Vector3()
  private tB = new THREE.Vector3()

  constructor(private physics: Physics, private m: Materials) {
    const b = new Batch()
    const metroTracks = [-1, 1].map(side => {
      const points = []
      for (let z = METRO.z0; z < METRO.z1; z += 2) points.push(new THREE.Vector3(METRO.x + side * METRO.offset, METRO.y, z))
      points.push(new THREE.Vector3(METRO.x + side * METRO.offset, METRO.y, METRO.z1))
      return new Loop(points, false)
    })
    this.metro(b, metroTracks)
    const railA = suburbanPath()
    const railB = offsetLoop(railA, RAIL.gap).reverse()
    this.railway(b, railA, railB)
    this.flyover(b)
    b.build(this.group)

    const stopsOf = (loop: Loop, pts: [number, number][]) => pts.map(([x, z]) => loop.nearestS(x, z))
    const mk = (loop: Loop, kind: 'metro' | 'rail', coaches: number, len: number, top: number, stops: number[], at: number, y: number, cross: number) => {
      const t = this.makeTrain(coaches, len, kind)
      stops = [...stops].sort((a, b) => a - b)
      Object.assign(t, { loop, top, stops, s: at * loop.length, y, cross })
      t.nextStop = stops.findIndex(stop => stop > t.s)
      if (t.nextStop < 0) t.nextStop = 0
      this.trains.push(t)
      for (const c of t.cars) this.group.add(c)
      for (let i = 0; i < coaches; i++) {
        const at = loop.sample(t.s + t.total / 2 - len / 2 - i * (len + t.gap))
        const yaw = Math.atan2(-at.dz, at.dx)
        const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.p.x, at.p.y + y + 2.05, at.p.z).setRotation(rotation))
        this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 1.72, 1.56), body)
        t.bodies.push(body)
      }
    }
    for (const [i, line] of metroTracks.entries()) {
      const stops = METRO.stations.map(station => station.z - 8 - METRO.z0)
      mk(line, 'metro', 3, 15, 16, stops, stops[i * 2] / line.length, 0.34, 0)
      const train = this.trains[this.trains.length - 1]
      train.direction = i === 0 ? 1 : -1
      train.nextStop = 1
      train.wait = 6
    }
    const rA = new Loop(railA)
    const rB = new Loop(railB)
    const sealA = stopsOf(rA, [[RAIL.sealdah, RAIL.z1], [RAIL_RECT.x0, 0]])
    const sealB = stopsOf(rB, [[RAIL.sealdah, RAIL.z2], [RAIL_RECT.x0 - RAIL.gap, 0]])
    const crossA = rA.nearestS(RAIL.crossingX, RAIL.z1)
    const crossB = rB.nearestS(RAIL.crossingX, RAIL.z2)
    for (const at of [0.05, 0.55]) mk(rA, 'rail', 4, 20, 24, sealA, at, 0.3, crossA)
    for (const at of [0.3, 0.8]) mk(rB, 'rail', 4, 20, 24, sealB, at, 0.3, crossB)
    this.update(0, 0)
  }

  /** ballast, two rails and sleepers along a closed path (y of the path is the ground the track sits on) */
  private track(b: Batch, path: THREE.Vector3[], circuit = true) {
    const { m } = this
    const ballast = new THREE.MeshStandardMaterial({ color: '#59564f', roughness: 1, side: THREE.DoubleSide })
    const steel = new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 0.4, metalness: 0.8 })
    const closed = circuit ? [...path, path[0]] : path
    const bed = new THREE.Mesh(sweep(closed, [[2.02, 0], [1.65, 0.2], [-1.65, 0.2], [-2.02, 0]], false), ballast)
    bed.receiveShadow = true
    this.group.add(bed)
    for (const o of [-0.72, 0.72]) this.group.add(new THREE.Mesh(sweep(closed, [[o + 0.06, 0.2], [o + 0.06, 0.36], [o - 0.06, 0.36], [o - 0.06, 0.2]]), steel))
    const loop = new Loop(path, circuit)
    const p = new THREE.Vector3()
    for (let s = 0; s < loop.length; s += 1.7) {
      const { dx, dz } = loop.sample(s, p)
      b.box(0.28, 0.1, 2.6, m.wood, M(p.x, p.y + 0.25, p.z, Math.atan2(-dz, dx)), 1)
    }
  }

  /* ── the metro ────────────────────────────────────────────── */

  private board(b: Batch, x: number, y: number, z: number, yaw: number, w: number, h: number, lines: string[], bg = '#183e68', ink = '#ffffff') {
    const map = labelTexture(lines, bg, ink, 768, 256, ink)
    b.add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.7, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.22 }), M(x, y, z, yaw))
  }

  private metro(b: Batch, tracks: Loop[]) {
    const { x, y, platformY: floor, z0, z1 } = METRO
    const { m, physics } = this
    const solid = (px: number, py: number, pz: number, w: number, h: number, d: number, mat: THREE.Material) => {
      b.box(w, h, d, mat, M(px, py, pz))
      physics.fixedBox(px, py, pz, w / 2, h / 2, d / 2)
    }
    const mid = (z0 + z1) / 2
    solid(x, y - 0.65, mid, 8.3, 1.3, z1 - z0, m.concrete)
    for (let z = z0 + 18; z < z1; z += 21) {
      if (GRID.some(g => Math.abs(g - z) < 8)) continue
      solid(x, (y - 1.3) / 2, z, 1.25, y - 1.3, 2, m.concrete)
      b.box(7.7, 1, 2.4, m.concrete, M(x, y - 1.65, z))
    }
    const blue = new THREE.MeshStandardMaterial({ color: '#244d82', roughness: 0.58 })
    const platformTile = (m.granite as THREE.MeshStandardMaterial).clone()
    platformTile.emissive.set('#c2d8df')
    platformTile.emissiveMap = platformTile.map
    this.glow.push({ mat: platformTile, day: 0, night: 0.19 })
    const strip = new THREE.MeshStandardMaterial({ color: '#e4e9e6', emissive: '#ffe8c8' })
    this.glow.push({ mat: strip, day: 0.2, night: 2.3 })
    const reader = new THREE.MeshStandardMaterial({ color: '#84ffad', emissive: '#2ec778', emissiveIntensity: 0.8 })
    for (const [i, line] of tracks.entries()) {
      this.track(b, line.pts, false)
      const side = i === 0 ? -1 : 1
      const px = x + side * 6.1
      const trackX = x + side * METRO.offset
      for (const z of [z0 + 1, z1 - 1]) solid(trackX, y + 0.8, z, 2.8, 0.9, 0.65, m.kerb)
      let start = z0
      for (const station of METRO.stations) {
        const z = station.z
        const lo = z - 35, hi = z + 17
        solid(x + side * 4.03, y + 0.45, (start + lo) / 2, 0.24, 0.9, lo - start, m.concrete)
        start = hi
        solid(px, floor - 0.48, (lo + hi) / 2, 4.45, 0.96, hi - lo, platformTile)
        b.box(0.25, 0.025, hi - lo, m.yellowLine, M(x + side * 4.32, floor + 0.015, (lo + hi) / 2))
        for (let k = lo + 2; k < hi; k += 8) {
          solid(x + side * 8, floor + 1.8, k, 0.2, 3.6, 0.2, m.frame)
          b.box(0.2, 0.08, 4.4, strip, M(px, floor + 3.42, k + 1.8))
          this.lightPositions.push(new THREE.Vector3(px, floor + 3.34, k + 1.8))
          b.box(4.6, 0.18, 0.16, blue, M(px, floor + 3.52, k))
        }
        solid(x + side * 8.23, floor + 0.52, (lo + hi) / 2, 0.12, 1.04, hi - lo, m.rail)
        b.box(4.65, 0.22, hi - lo + 1, m.corrugated, M(px, floor + 3.7, (lo + hi) / 2))
        b.box(0.12, 0.42, hi - lo + 1, blue, M(x + side * 8.36, floor + 3.53, (lo + hi) / 2))
        this.board(b, x + side * 8.43, floor + 3.02, z - 8, side * Math.PI / 2, 9, 1.65, [station.bengali, station.name.toUpperCase()])
        this.board(b, x + side * 7.82, floor + 2, z - 16, -side * Math.PI / 2, 5, 1.1, [station.name, 'PLATFORM ' + (i + 1)])
        for (const dz of [-24, -6]) {
          solid(x + side * 7.45, floor + 0.42, z + dz, 0.58, 0.15, 2.6, m.wood)
          for (const end of [-1, 1]) b.box(0.45, 0.36, 0.1, m.frame, M(x + side * 7.45, floor + 0.18, z + dz + end))
        }
        this.stairs(b, x + side * 6.65, hi, floor)
        // Readers flank a 1.4 m accessible passage aligned with the stair centreline.
        const gateX = x + side * 6.65
        for (const dx of [-0.92, 0.92]) {
          solid(gateX + dx, floor + 0.5, hi - 2.4, 0.38, 1, 1.5, m.frame)
          b.box(0.25, 0.035, 0.34, reader, M(gateX + dx, floor + 1.02, hi - 2))
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.67, 0.4, 0.08), blue)
          flap.geometry.translate(-Math.sign(dx) * 0.335, 0, 0)
          flap.position.set(gateX + dx - Math.sign(dx) * 0.18, floor + 0.65, hi - 2.4)
          flap.userData.side = Math.sign(dx)
          this.gates.push(flap)
          this.group.add(flap)
        }
        const entry = hi + 22
        for (const dx of [-1.38, 1.38]) solid(gateX + dx, 1.72, entry, 0.12, 3.16, 0.12, blue)
        this.board(b, gateX, 3.2, entry + 0.08, 0, 3.15, 0.94, [station.name, 'METRO  ·  GATE ' + (i + 1)])
      }
      solid(x + side * 4.03, y + 0.45, (start + z1) / 2, 0.24, 0.9, z1 - start, m.concrete)
    }
  }

  private stairs(b: Batch, x: number, topZ: number, floor: number) {
    const { physics, m } = this
    const rise = (floor - 0.15) / 60
    const tread = 0.32, width = 2.8
    for (let flight = 0; flight < 3; flight++) {
      const z = topZ + flight * (20 * tread + 1.45)
      const y = floor - flight * 20 * rise
      const length = 20 * tread
      const slope = Math.atan2(20 * rise, length)
      for (let i = 0; i < 20; i++) {
        const stepY = y - (i + 1) * rise
        b.box(width, 0.25, tread, m.concrete, M(x, stepY - 0.125, z + (i + 0.5) * tread))
        b.box(width, 0.014, 0.055, m.yellowLine, M(x, stepY + 0.008, z + (i + 0.9) * tread))
      }
      const tilt = new THREE.Matrix4().makeRotationX(slope)
      const span = Math.hypot(length, 20 * rise)
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, span), m.concrete)
      slab.position.set(x, y - 10 * rise - 0.13, z + length / 2)
      slab.rotation.x = slope
      b.add(slab.geometry, m.concrete, M(x, slab.position.y - 0.14, slab.position.z).multiply(tilt))
      physics.fixedMesh(slab)
      for (const dx of [-1.34, 1.34]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, span), m.rail)
        rail.position.set(x + dx, y - 10 * rise + 0.96, z + length / 2)
        rail.rotation.x = slope
        rail.updateMatrixWorld()
        b.add(rail.geometry, m.rail, rail.matrixWorld)
        physics.fixedMesh(rail)
        for (const t of [0, 0.5, 1]) b.box(0.07, 1, 0.07, m.rail, M(x + dx, y - t * 20 * rise + 0.46, z + t * length))
      }
      // Kolkata's elevated entrances are covered: a tin roof follows each flight on slim posts
      b.add(new THREE.BoxGeometry(width + 0.7, 0.1, span + 1.5), m.corrugated, M(x, y - 10 * rise + 3, z + length / 2).multiply(tilt))
      for (const dx of [-1.6, 1.6]) for (const t of [0, 1]) b.box(0.12, 2.95, 0.12, m.frame, M(x + dx, y - t * 20 * rise + 1.5, z + t * length))
      if (flight === 2) continue
      const ly = y - 20 * rise, lz = z + length + 0.725
      b.box(width, 0.28, 1.45, m.concrete, M(x, ly - 0.14, lz))
      physics.fixedBox(x, ly - 0.14, lz, width / 2, 0.14, 0.725)
      b.box(0.48, ly - 0.28, 0.65, m.concrete, M(x, (ly - 0.28) / 2, lz))
      for (const dx of [-1.34, 1.34]) b.box(0.07, 0.08, 1.45, m.rail, M(x + dx, ly + 0.96, lz))
    }
  }

  /* ── the suburban line ────────────────────────────────────── */

  /** a long platform beside a track: slab, yellow edge line, canopy on columns, benches. `along` is the axis the platform runs on. */
  private platform(b: Batch, cx: number, cz: number, len: number, wid: number, along: 'x' | 'z', trackSide: 1 | -1) {
    const { m, physics } = this
    const w = along === 'x' ? len : wid
    const d = along === 'x' ? wid : len
    b.box(w, 0.9, d, m.concrete, M(cx, 0.45, cz), 3)
    physics.fixedBox(cx, 0.45, cz, w / 2, 0.45, d / 2)
    const ex = along === 'x' ? 0 : trackSide * (wid / 2 - 0.2)
    const ez = along === 'x' ? trackSide * (wid / 2 - 0.2) : 0
    b.box(along === 'x' ? len : 0.4, 0.03, along === 'x' ? 0.4 : len, m.yellowLine, M(cx + ex, 0.92, cz + ez), 1)
    b.box(w + (along === 'x' ? 4 : 2.5), 0.3, d + (along === 'z' ? 4 : 2.5), m.corrugated, M(cx, 5.4, cz), 2)
    for (let k = -len / 2 + 4; k < len / 2; k += 8) b.box(0.3, 4.5, 0.3, m.frame, M(cx + (along === 'x' ? k : -ex), 3.1, cz + (along === 'x' ? -ez : k)), 1)
    for (let k = -len / 2 + 6; k < len / 2 - 4; k += 14) {
      const bx = cx + (along === 'x' ? k : -ex * 0.5)
      const bz = cz + (along === 'x' ? -ez * 0.5 : k)
      b.box(along === 'x' ? 2.2 : 0.6, 0.08, along === 'x' ? 0.6 : 2.2, m.wood, M(bx, 1.4, bz), 1)
      physics.fixedBox(bx, 1.2, bz, along === 'x' ? 1.1 : 0.4, 0.4, along === 'x' ? 0.4 : 1.1)
    }
  }

  /** a girder bridge for both tracks across the Hooghly, centred on z */
  private bridge(b: Batch, zc: number, wid: number) {
    const { m, physics } = this
    const x0 = -318
    const x1 = -226
    const cx = (x0 + x1) / 2
    b.box(x1 - x0, 0.8, wid, m.concrete, M(cx, -0.35, zc), 3)
    physics.fixedBox(cx, -0.35, zc, (x1 - x0) / 2, 0.4, wid / 2)
    for (const s of [-1, 1]) {
      b.box(x1 - x0, 2.2, 0.4, m.frame, M(cx, 1.3, zc + s * (wid / 2 - 0.2)), 1)
      physics.fixedBox(cx, 1.3, zc + s * (wid / 2 - 0.2), (x1 - x0) / 2, 1.1, 0.2)
    }
    for (const px of [-296, -272, -248]) b.box(3, 8, wid - 4, m.concrete, M(px, -2.9, zc), 3)
  }

  private railway(b: Batch, A: THREE.Vector3[], B: THREE.Vector3[]) {
    const { m, physics } = this

    const { z1, z2, platformX, crossingX } = RAIL
    const zc = (z1 + z2) / 2
    this.track(b, A)
    this.track(b, B)
    const elevated = A.filter(p => p.y > 0.01)
    const deck = new THREE.Mesh(sweep(elevated, [[8.2, -0.04], [-2.2, -0.04], [-2.2, -0.98], [8.2, -0.98]]), m.concrete)
    this.group.add(deck)
    physics.fixedMesh(deck)
    elevated.forEach((p, i) => {
      if (p.y < 1.3 || i % 7 || [-100, 100, 300].some(z => Math.abs(z - p.z) < 9)) return
      const q = elevated[Math.min(i + 1, elevated.length - 1)]
      const yaw = Math.atan2(q.x - p.x, q.z - p.z)
      const px = p.x - 3 * Math.cos(yaw), pz = p.z + 3 * Math.sin(yaw)
      b.box(1.6, p.y - 0.98, 2, m.concrete, M(px, (p.y - 0.98) / 2, pz, yaw))
      physics.fixedBox(px, (p.y - 0.98) / 2, pz, 0.8, (p.y - 0.98) / 2, 1, yaw)
    })
    // overhead wires: a portal gantry across both tracks every 48 m and two contact wires round the whole circuit
    const loopA = new Loop(A)
    const p = new THREE.Vector3()
    for (let s = 0; s < loopA.length; s += 48) {
      const { dx, dz } = loopA.sample(s, p)
      const l = Math.hypot(dx, dz) || 1
      const nx = -dz / l
      const nz = dx / l
      if (Math.abs(p.x - crossingX) < 6 && Math.abs(p.z - z1) < 10) continue
      for (const o of [-3.4, 9.4]) {
        b.box(0.3, 7.6, 0.3, m.frame, M(p.x + nx * o, p.y + 3.8, p.z + nz * o), 1)
        physics.fixedCylinder(p.x + nx * o, p.y + 1.5, p.z + nz * o, 0.2, 3)
      }
      b.box(0.15, 0.15, 13, m.frame, M(p.x + nx * 3, p.y + 7.2, p.z + nz * 3, Math.atan2(-dz, dx)), 1)
    }
    const wire = new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.6 })
    for (const path of [A, B]) this.group.add(new THREE.Mesh(sweep([...path, path[0].clone(), path[1].clone()], [[-0.03, 6.6], [-0.03, 6.66], [0.03, 6.66], [0.03, 6.6]]), wire))

    // Howrah: a platform on each side of the double track behind the station building, and its name on the back wall
    this.platform(b, RAIL_RECT.x0 + 5.45, 0, 92, 7.2, 'z', -1)
    this.platform(b, RAIL_RECT.x0 - RAIL.gap - 5.45, 0, 92, 7.2, 'z', 1)
    const howrah = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.4), new THREE.MeshStandardMaterial({ map: labelTexture(['HOWRAH JUNCTION', 'Kolkata · since 1854'], '#7a1f12', '#fff4d6', 1024, 256, '#ffc61a'), roughness: 0.6 }))
    howrah.position.set(-383.2, 8.2, 0)
    howrah.rotation.y = -Math.PI / 2
    this.group.add(howrah)
    const centre = (platformX[0] + platformX[1]) / 2
    const length = platformX[1] - platformX[0]
    for (const side of [-1, 1] as const) {
      const z = side < 0 ? z1 - 5.45 : z2 + 5.45
      this.platform(b, centre, z, length, 7.2, 'x', side < 0 ? 1 : -1)
      for (const dx of [-49, 49]) this.board(b, centre + dx, 3.5, z, side > 0 ? Math.PI : 0, 5.7, 1.45, ['শিয়ালদহ', 'SEALDAH'], '#f4bf42', '#241c13')
    }
    this.bridge(b, RAIL_RECT.z0 - RAIL.gap / 2, 18)
    this.bridge(b, zc, 18)
    // An open ticket hall connects the forecourt directly to platform one.
    b.box(130, 0.2, 43, m.pavement, M(centre, 0, 428))
    physics.fixedBox(centre, 0, 428, 65, 0.1, 21.5)
    for (const dx of [-40, 40]) {
      b.box(54, 10, 13, m.redBrick, M(centre + dx, 5, 429))
      physics.fixedBox(centre + dx, 5, 429, 27, 5, 6.5)
      for (let i = -22; i <= 22; i += 5.5) {
        b.box(3.7, 2.5, 0.16, m.glass, M(centre + dx + i, 6.9, 422.45))
        b.box(0.36, 9.6, 0.5, m.trim, M(centre + dx + i - 2.4, 4.8, 422.3))
      }
    }
    b.box(137, 0.55, 17, m.trim, M(centre, 10.22, 429))
    for (const dx of [-12, 12]) for (const dz of [-7, 7]) {
      b.box(0.6, 9.9, 0.6, m.frame, M(centre + dx, 5, 429 + dz))
      physics.fixedBox(centre + dx, 5, 429 + dz, 0.3, 5, 0.3)
    }
    this.board(b, centre, 8.1, 420.4, Math.PI, 24, 3.6, ['শিয়ালদহ  ·  SEALDAH', 'EASTERN RAILWAY'])
    for (let i = 0; i < 5; i++) {
      const h = 0.1 + (i + 1) * 0.16
      const z = z1 - 9.05 - (4.5 - i) * 0.34
      b.box(14, h, 0.34, m.concrete, M(centre, h / 2, z))
      physics.fixedBox(centre, h / 2, z, 7, h / 2, 0.17)
    }
    // The footbridge begins at the ends of the canopies and clears the contact wires.
    const footX = platformX[1] + 16
    const footY = 8.15
    for (const side of [-1, 1]) {
      const pz = side < 0 ? z1 - 5.45 : z2 + 5.45
      const run = 14.4, rise = footY - 0.9
      for (let i = 0; i < 42; i++) {
        const h = 0.9 + rise * (i + 1) / 42
        b.box(run / 42, 0.24, 2.8, m.concrete, M(platformX[1] + (i + 0.5) * run / 42, h - 0.12, pz))
      }
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(run, rise), 0.2, 2.8), m.concrete)
      ramp.position.set(platformX[1] + run / 2, 0.9 + rise / 2 - 0.11, pz)
      ramp.rotation.z = Math.atan2(rise, run)
      ramp.updateMatrixWorld()
      b.add(ramp.geometry, m.concrete, ramp.matrixWorld)
      physics.fixedMesh(ramp)
      for (const d of [-1, 1]) {
        b.box(Math.hypot(run, rise), 0.08, 0.08, m.rail, M(ramp.position.x, ramp.position.y + 1.1, pz + d * 1.31).multiply(new THREE.Matrix4().makeRotationZ(ramp.rotation.z)))
        b.box(0.5, footY, 0.5, m.frame, M(footX, footY / 2, pz + d * 1.31))
      }
    }
    b.box(3.2, 0.46, 19.8, m.concrete, M(footX, footY - 0.23, zc))
    physics.fixedBox(footX, footY - 0.23, zc, 1.6, 0.23, 9.9)
    for (const side of [-1, 1]) {
      const len = side < 0 ? 13.9 : 19.8
      b.box(0.12, 1.05, len, m.rail, M(footX + side * 1.55, footY + 0.525, zc))
      physics.fixedBox(footX + side * 1.55, footY + 0.525, zc, 0.06, 0.525, len / 2)
    }
    for (const dx of [-20, 20]) {
      this.board(b, centre + dx, 3.85, 422.36, Math.PI, 6, 1, ['টিকিট  ·  TICKETS'], '#254d40')
      for (const w of [-1.5, 1.5]) {
        b.box(1.95, 1.2, 0.16, m.glass, M(centre + dx + w, 2.12, 422.39))
        b.box(2.14, 0.15, 0.68, m.trim, M(centre + dx + w, 1.49, 422.2))
      }
    }

    // the level crossing: a road over the tracks, planks, barriers and flashing lights
    const cx = crossingX
    const road = new THREE.MeshStandardMaterial({ color: '#2d2d30', roughness: 0.95 })
    b.box(8, 0.06, 100, road, M(cx, 0.03, 455), 3)
    for (let z = 410; z < 500; z += 6) b.box(0.15, 0.02, 3, m.yellowLine, M(cx, 0.07, z), 1)
    b.box(8, 0.12, 14, m.concrete, M(cx, 0.2, zc), 2)
    for (const s of [-1, 1]) {
      for (const zz of [z1 - 8, z2 + 8]) {
        // post and a pair of red lamps
        b.box(0.35, 2.4, 0.35, m.frame, M(cx + s * 4.6, 1.2, zz), 1)
        const lamp = new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff1a1a', emissiveIntensity: 0 })
        this.lamps.push(lamp)
        b.add(new THREE.SphereGeometry(0.2, 10, 8), lamp, M(cx + s * 4.6, 2.55, zz))
        b.add(new THREE.SphereGeometry(0.2, 10, 8), lamp, M(cx + s * 4.6, 2.05, zz))
      }
    }
    for (const zz of [z1 - 8.6, z2 + 8.6]) {
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
    }
  }

  /* ── the ring flyover ─────────────────────────────────────── */

  private flyover(b: Batch) {
    const { m, physics } = this
    const asphalt = (m.asphalt as THREE.MeshStandardMaterial).clone()
    asphalt.side = THREE.DoubleSide
    const hw = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd79a', emissiveIntensity: 0.2 })
    this.glow.push({ mat: hw, day: 0.2, night: 5 })
    const steel = new THREE.MeshStandardMaterial({ color: '#a9adb1', metalness: 0.85, roughness: 0.35 })
    const joint = new THREE.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0.6, roughness: 0.5 })
    const paint = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
    const pools: THREE.BufferGeometry[] = []
    const white = paint('#e8e4d8')
    const yellow = paint('#e4b42c')
    this.roadSign(-209, -180, 0, ['RING ROAD', 'Flyover entry ↖'])
    this.roadSign(209, -192, -Math.PI / 2, ['CITY EXIT', 'Eastern Bypass ↖'], RING.y)
    this.gantry(b, -110, -200, ['RING ROAD  →', 'Eden Gardens · Sealdah'], ['HOWRAH BRIDGE  ↓', 'Ghat · Howrah Station'])
    this.gantry(b, 160, -200, ['EXIT  ↗  50 m', 'Eastern Bypass · Hills'], ['VICTORIA MEMORIAL', 'Park Street  ↓'])
    this.gantry(b, 400, 120, ['EDEN GARDENS  ↓', 'Sealdah · Maidan'], ['EXIT  ↖', 'Eastern Bypass'])
    this.gantry(b, 120, 400, ['HOWRAH  ←', 'Ghat · Howrah Bridge'], ['SEALDAH  ↓', 'Eden Gardens'])
    for (const [route, pts] of [ringPath(), rampUp(), rampDown()].entries()) {
      const ring = route === 0
      const entry = route === 1
      const edge = (p: THREE.Vector3, i: number, side: number) => {
        const normal = sideNormal(pts, i, ring)
        const w = ring ? RING.width : rampWidth(p.x, entry)
        if (!ring && w < SLIPS.width) normal.set(0, 1)
        return new THREE.Vector3(p.x + normal.x * side * w / 2, p.y, p.z + normal.y * side * w / 2)
      }
      const left = pts.map((p, i) => edge(p, i, -1))
      const right = pts.map((p, i) => edge(p, i, 1))
      const deck: number[] = [], uv: number[] = []
      const barriers: THREE.BufferGeometry[] = []
      let distance = 0
      for (let i = 0; i < pts.length - (ring ? 0 : 1); i++) {
        const j = (i + 1) % pts.length
        const p = pts[i], q = pts[j]
        const ds = p.distanceTo(q)
        for (const [point, d, across] of [[left[i], distance, 0], [left[j], distance + ds, 0], [right[i], distance, 1], [right[i], distance, 1], [left[j], distance + ds, 0], [right[j], distance + ds, 1]] as const) {
          deck.push(point.x, point.y, point.z)
          uv.push(d / 5, across * (ring ? RING.width : SLIPS.width) / 5)
        }
        const mid = p.clone().lerp(q, 0.5)
        const joining = mid.z < -199 && mid.z > -214 && [SLIPS.entry, SLIPS.exit].some(([a, b]) => mid.x > a - 2 && mid.x < b + 2)
        for (const [side, line] of [[-1, left], [1, right]] as const) {
          if (joining && ((ring && side < 0) || (!ring && side > 0))) continue
          const outside = [line[i], line[j]]
          const wall = sweep(outside, [[-0.12, -0.56], [-0.12, 0.74], [0.12, 0.74], [0.12, -0.56]])
          if (mid.y > 0.7) {
            b.add(wall, m.concrete)
            barriers.push(wall)
            // a galvanised rail on the crash barrier
            b.add(sweep(outside, [[-0.05, 0.86], [-0.05, 1.0], [0.05, 1.0], [0.05, 0.86]]), steel)
            if (i % 2 === 0) b.box(0.06, 0.26, 0.06, steel, M(line[i].x, line[i].y + 0.87, line[i].z))
          }
          if (!ring && mid.y > 3 && i % 10 === 3 && side === -1 && !joining) {
            // a lamp post on the parapet with its arm reaching out over the ramp
            const lp = line[i]
            const lat = new THREE.Vector3(Math.cos(Math.atan2(q.x - p.x, q.z - p.z)), 0, -Math.sin(Math.atan2(q.x - p.x, q.z - p.z)))
            const tip = lp.clone().addScaledVector(lat, -1.9)
            b.box(0.14, 8, 0.14, m.frame, M(lp.x, lp.y + 4.75, lp.z))
            b.box(0.08, 0.08, 2, m.frame, M((lp.x + tip.x) / 2, lp.y + 8.6, (lp.z + tip.z) / 2, Math.atan2(tip.x - lp.x, tip.z - lp.z)))
            b.box(0.7, 0.14, 0.32, hw, M(tip.x, lp.y + 8.5, tip.z, Math.atan2(q.x - p.x, q.z - p.z)))
          }
        }
        const yaw = Math.atan2(q.x - p.x, q.z - p.z)
        const width = ring ? RING.width : rampWidth(mid.x, entry)
        if (width > 1) b.box(width - 0.45, 0.9, ds + 0.03, m.concrete, M(mid.x, mid.y - 0.52, mid.z, yaw).multiply(new THREE.Matrix4().makeRotationX(-Math.asin((q.y - p.y) / ds))))
        // expansion joints: a steel finger strip across the deck every 32 m
        if (i % 8 === 0 && p.y > 1 && width > 1) b.box(width - 0.5, 0.03, 0.32, joint, M(p.x, p.y + 0.006, p.z, yaw + Math.PI / 2), 1)
        if (ring && i % 10 === 3 && !joining) {
          // twin-arm lamps standing on the median, the way Kolkata's flyovers are lit
          const lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
          b.box(0.18, 9, 0.18, m.frame, M(mid.x, mid.y + 0.48 + 4.5, mid.z))
          for (const sd of [-1, 1]) {
            const tip = mid.clone().addScaledVector(lat, sd * 2.6)
            b.box(0.08, 0.08, 2.7, m.frame, M((mid.x + tip.x) / 2, mid.y + 9.45, (mid.z + tip.z) / 2, yaw + Math.PI / 2))
            b.box(0.75, 0.14, 0.34, hw, M(tip.x, mid.y + 9.36, tip.z, yaw))
            pools.push(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(tip.x, mid.y + 0.05, tip.z))
          }
        }
        if (ring) {
          b.box(0.38, 0.48, ds + 0.02, m.concrete, M(mid.x, mid.y + 0.24, mid.z, yaw))
          if (i % 2 === 0) for (const side of [-1, 1]) b.box(0.10, 0.018, 2.3, m.line, M(mid.x + Math.cos(yaw) * side * 3.4, mid.y + 0.015, mid.z - Math.sin(yaw) * side * 3.4, yaw))
        }
        if (width > 4.5 && mid.y > 2.5 && i % 7 === 4 && !joining && !GRID.some(gx => GRID.some(gz => Math.hypot(mid.x - gx, mid.z - gz) < 13))) {
          b.box(1.4, mid.y - 0.8, 1.65, m.concrete, M(mid.x, (mid.y - 0.8) / 2, mid.z, yaw))
          b.box(width - 0.9, 0.65, 2, m.concrete, M(mid.x, mid.y - 1.12, mid.z, yaw))
          physics.fixedBox(mid.x, (mid.y - 0.8) / 2, mid.z, 0.7, (mid.y - 0.8) / 2, 0.825, yaw)
          // a drain scupper at the deck edge and its downpipe down the pier
          const lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
          const dp = mid.clone().addScaledVector(lat, 0.82)
          b.add(new THREE.CylinderGeometry(0.08, 0.08, mid.y - 0.9, 8), m.frame, M(dp.x, (mid.y - 0.9) / 2 + 0.1, dp.z))
          b.box(0.3, 0.2, 0.3, m.frame, M(dp.x, 0.1, dp.z))
        }
        distance += ds
      }
      if (barriers.length) physics.fixedMesh(new THREE.Mesh(mergeGeometries(barriers)!))
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(deck, 3))
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geom.setIndex(Array.from({ length: deck.length / 3 }, (_, n) => n - n % 3 + [0, 2, 1][n % 3]))
      geom.computeVertexNormals()
      const road = new THREE.Mesh(geom, asphalt)
      road.castShadow = road.receiveShadow = true
      this.group.add(road)
      physics.fixedMesh(road)
      if (ring) {
        const median = new THREE.Mesh(sweep([...pts, pts[0]], [[-0.19, 0], [-0.19, 0.48], [0.19, 0.48], [0.19, 0]]))
        physics.fixedMesh(median)
      }
      // painted lines: white edge lines inside both barriers, yellow along the median
      const close = (a: THREE.Vector3[]) => (ring ? [...a, a[0]] : a).map((v) => v.clone().setY(v.y + 0.02))
      for (const [line, o] of [[left, 0.55], [right, -0.55]] as const) {
        const strip = new THREE.Mesh(sweep(close(line), [[o - 0.07, 0], [o + 0.07, 0]], false), white)
        strip.receiveShadow = true
        this.group.add(strip)
      }
      if (ring) for (const o of [-0.38, 0.38]) this.group.add(new THREE.Mesh(sweep(close(pts), [[o - 0.06, 0], [o + 0.06, 0]], false), yellow))
    }
    // pools of lamplight on the deck after dark: one merged additive decal
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0, 'rgba(255,210,150,0.75)')
    grd.addColorStop(0.45, 'rgba(255,190,120,0.25)')
    grd.addColorStop(1, 'rgba(255,190,120,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 64)
    this.deckPools = new THREE.Mesh(mergeGeometries(pools)!, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }))
    this.deckPools.renderOrder = 1
    this.deckPools.visible = false
    this.group.add(this.deckPools)
  }

  /** an overhead sign gantry across both carriageways of the ring, one board facing each direction of traffic */
  private gantry(b: Batch, x: number, z: number, cw: string[], ccw: string[]) {
    const { m, physics } = this
    const pts = ringPath()
    let i = 0
    pts.forEach((p, k) => { if (Math.hypot(p.x - x, p.z - z) < Math.hypot(pts[i].x - x, pts[i].z - z)) i = k })
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const t = new THREE.Vector3(q.x - p.x, 0, q.z - p.z).normalize()
    const n = new THREE.Vector3(-t.z, 0, t.x)
    const yaw = Math.atan2(n.x, n.z)
    const y = p.y
    const half = RING.width / 2 - 0.4
    for (const s of [-1, 1]) {
      const c = p.clone().addScaledVector(n, s * half)
      b.box(0.35, 7.6, 0.35, m.frame, M(c.x, y + 3.8, c.z))
      physics.fixedBox(c.x, y + 3.8, c.z, 0.18, 3.8, 0.18)
    }
    for (const h of [6.4, 7.5]) b.box(0.18, 0.18, RING.width - 0.4, m.frame, M(p.x, y + h, p.z, yaw))
    for (let k = -half; k <= half + 0.01; k += 1.6) b.box(0.08, 1.1, 0.08, m.frame, M(p.x + n.x * k, y + 6.95, p.z + n.z * k))
    // left-hand traffic: clockwise traffic keeps to the side opposite the normal
    for (const [dir, lines] of [[1, cw], [-1, ccw]] as const) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.9), new THREE.MeshStandardMaterial({ map: labelTexture(lines, '#0e5a2e', '#ffffff', 1024, 360, '#ffffff'), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.06 }))
      const c = p.clone().addScaledVector(n, -dir * 3.25).addScaledVector(t, -dir * 0.2)
      const bm = board.material as THREE.MeshStandardMaterial
      bm.emissiveMap = bm.map
      this.glow.push({ mat: bm, day: 0.06, night: 0.8 })
      board.position.set(c.x, y + 6.95, c.z)
      board.rotation.y = Math.atan2(-dir * t.x, -dir * t.z)
      this.group.add(board)
    }
  }

  /** a green direction sign on two posts */
  private roadSign(x: number, z: number, yaw: number, lines: string[], height = 0) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshStandardMaterial({ map: labelTexture(lines, '#0e5a2e', '#ffffff', 1024, 256, '#ffffff'), roughness: 0.6, side: THREE.DoubleSide }))
    board.position.set(x, height + 4.6, z)
    board.rotation.y = yaw
    this.group.add(board)
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.6, 0.2), this.m.frame)
      post.position.set(x + Math.cos(yaw) * s * 3.6, height + 2.3, z - Math.sin(yaw) * s * 3.6)
      this.group.add(post)
    }
  }

  /* ── trains ───────────────────────────────────────────────── */

  private makeTrain(coaches: number, len: number, kind: 'metro' | 'rail'): Train {
    const windows = new THREE.MeshStandardMaterial({ color: '#364857', metalness: 0.35, roughness: 0.23, emissive: '#ffdfb5' })
    const head = new THREE.MeshStandardMaterial({ color: '#fffbea', emissive: '#fff4d0' })
    const gap = 0.7
    const cars = Array.from({ length: coaches }, (_, i) => buildCoach(kind, len, i === 0 ? 1 : i === coaches - 1 ? -1 : 0, windows, head))
    return { cars, bodies: [], loop: undefined as unknown as Loop, kind, len, gap, total: coaches * len + (coaches - 1) * gap, s: 0, v: 0, top: 20, stops: [], wait: 0, served: -1, cross: 0, windows, head, y: 0, direction: 1, nextStop: 0, door: 0 }
  }

  /** the barriers are down while a rail train is within reach of the crossing */
  private crossingBusy() {
    for (const t of this.trains) {
      if (t.kind !== 'rail') continue
      const d = wrap(t.cross - t.s, t.loop.length)
      if (d < t.total / 2 + 120 && d > -(t.total / 2 + 6)) return true
    }
    return false
  }

  update(dt: number, night: number, player?: THREE.Vector3) {
    for (const flap of this.gates) {
      const open = player && Math.abs(player.y - flap.position.y) < 3 && Math.hypot(player.x - flap.position.x, player.z - flap.position.z) < 3.8
      flap.rotation.y = THREE.MathUtils.damp(flap.rotation.y, open ? flap.userData.side * 1.5 : 0, 9, dt)
    }
    for (const t of this.trains) {
      const L = t.loop.length
      const stop = t.stops[t.nextStop]
      if (t.wait > 0) {
        t.wait = Math.max(0, t.wait - dt)
      } else {
        const distance = t.loop.closed ? (stop - t.s + L) % L : Math.abs(stop - t.s)
        const target = Math.min(t.top, Math.sqrt(2 * 1.15 * distance))
        t.v = THREE.MathUtils.clamp(target, t.v - 1.25 * dt, t.v + 0.95 * dt)
        const advance = t.v * dt
        if (distance <= Math.max(advance, 0.02)) {
          t.s = stop
          t.v = 0
          t.wait = t.kind === 'metro' ? 10 : 12
          t.served = t.nextStop
          if (!t.loop.closed && (t.nextStop === 0 || t.nextStop === t.stops.length - 1)) t.direction = t.nextStop === 0 ? 1 : -1
          t.nextStop = (t.nextStop + t.direction + t.stops.length) % t.stops.length
        } else {
          t.s += advance * t.direction
          if (t.loop.closed) t.s %= L
        }
      }
      const opening = t.wait > 1.5 ? 1 : 0
      t.door = THREE.MathUtils.damp(t.door, opening, 5, dt)
      // each coach sits between two points of the track, so it bends round the curves
      t.cars.forEach((car, i) => {
        const sc = t.s + t.total / 2 - t.len / 2 - i * (t.len + t.gap)
        const a = t.loop.sample(sc - t.len * 0.4, this.tA).p
        const c = t.loop.sample(sc + t.len * 0.4, this.tB).p
        const yaw = Math.atan2(-(c.z - a.z), c.x - a.x)
        const pitch = Math.atan2(c.y - a.y, Math.hypot(c.z - a.z, c.x - a.x))
        car.position.set((a.x + c.x) / 2, (a.y + c.y) / 2 + t.y, (a.z + c.z) / 2)
        car.rotation.set(0, yaw, pitch, 'YXZ')
        // Local +z is the right side of the track tangent. The suburban inner track serves the inner platform.
        const platformSide = t.kind === 'metro' ? (car.position.x < METRO.x ? 1 : -1) : -1
        car.setDoors(platformSide, t.door)
        const body = t.bodies[i]
        if (body) {
          body.setNextKinematicTranslation({ x: car.position.x, y: car.position.y + 2.05, z: car.position.z })
          body.setNextKinematicRotation(car.quaternion)
        }
      })
      t.windows.emissiveIntensity = 0.06 + night * 0.72
      t.head.emissiveIntensity = 0.3 + night * 3
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
    if (this.deckPools) {
      this.deckPools.visible = night > 0.3
      ;(this.deckPools.material as THREE.MeshBasicMaterial).opacity = night * 0.8
    }
  }
}
