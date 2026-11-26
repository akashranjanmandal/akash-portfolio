import * as THREE from 'three'
import { RAPIER, type Physics } from '../Physics'
import { Batch, M } from './Batch'
import { townBuilding, type Materials } from './Town'
import { labelTexture } from '../hills/Portal'
import { rng } from '../../utils/math'
import { RING, ringPath, rampUp, rampDown } from './Flyover'
import { GRID, RAIL_RECT } from './Plan'
import { Loop, roundedLoop, offsetLoop, sweep } from './paths'

/* ──────────────────────────────────────────────────────────────
   RAILWAYS
   Everything here runs in a closed loop; nothing ends at a buffer stop.
   The Kolkata Metro circles four blocks on a concrete viaduct above the
   streets, with three stations you can climb to by stairs. The suburban
   railway is a double-track circuit round the whole city: Howrah on
   the west bank, over the Hooghly on two bridges, Sealdah in the south,
   with a level crossing. Coaches follow the track one by one, so they
   bend round the curves.
────────────────────────────────────────────────────────────── */

export const METRO = {
  y: 9.5,
  corners: [[-100, 100], [300, 100], [300, 300], [-100, 300]] as [number, number][],
  r: 24,
  stations: [[0, 100, 'ESPLANADE'], [200, 100, 'PARK STREET'], [100, 300, 'MAIDAN']] as [number, number, string][],
}
export const RAIL = {
  z1: RAIL_RECT.z1,
  z2: RAIL_RECT.z1 + 6,
  gap: 6,
  r: 60,
  platformX: [40, 230] as [number, number],
  crossingX: 300,
  sealdah: 135,
}

type Glow = { mat: THREE.MeshStandardMaterial; day: number; night: number }

type Train = {
  cars: THREE.Group[]
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
  private blink = 0
  /** called when the crossing bells ring: position of the crossing */
  onBell?: (pos: THREE.Vector3) => void
  private bellTimer = 0
  private tA = new THREE.Vector3()
  private tB = new THREE.Vector3()

  constructor(private physics: Physics, private m: Materials) {
    const b = new Batch()
    const metroD = roundedLoop(METRO.corners, METRO.r, 4).map((p) => p.setY(METRO.y))
    const metroA = new Loop(offsetLoop(metroD, -2.1))
    const metroB = new Loop(offsetLoop(metroD, 2.1).reverse())
    this.metro(b, metroD, metroA, metroB)
    const railA = roundedLoop([[RAIL_RECT.x0, RAIL_RECT.z1], [RAIL_RECT.x1, RAIL_RECT.z1], [RAIL_RECT.x1, RAIL_RECT.z0], [RAIL_RECT.x0, RAIL_RECT.z0]], RAIL.r, 4)
    const railB = offsetLoop(railA, RAIL.gap).reverse()
    this.railway(b, railA, railB)
    this.flyover(b)
    b.build(this.group)

    const stopsOf = (loop: Loop, pts: [number, number][]) => pts.map(([x, z]) => loop.nearestS(x, z))
    const mk = (loop: Loop, kind: 'metro' | 'rail', coaches: number, len: number, top: number, stops: number[], at: number, y: number, cross: number) => {
      const t = this.makeTrain(coaches, len, kind)
      Object.assign(t, { loop, top, stops, s: at * loop.length, y, cross })
      this.trains.push(t)
      for (const c of t.cars) this.group.add(c)
      if (kind === 'rail') {
        for (let i = 0; i < coaches; i++) {
          const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2.2, 0))
          this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 1.9, 1.4), body)
          t.bodies.push(body)
        }
      }
    }
    const ms = METRO.stations.map(([x, z]) => [x, z] as [number, number])
    for (const [loop, at] of [[metroA, 0.1], [metroA, 0.6], [metroB, 0.3], [metroB, 0.8]] as [Loop, number][]) mk(loop, 'metro', 3, 17, 17, stopsOf(loop, ms), at, 0.12, 0)
    const rA = new Loop(railA)
    const rB = new Loop(railB)
    const sealA = stopsOf(rA, [[RAIL.sealdah, RAIL.z1], [RAIL_RECT.x0, 0]])
    const sealB = stopsOf(rB, [[RAIL.sealdah, RAIL.z2], [RAIL_RECT.x0 - RAIL.gap, 0]])
    const crossA = rA.nearestS(RAIL.crossingX, RAIL.z1)
    const crossB = rB.nearestS(RAIL.crossingX, RAIL.z2)
    for (const at of [0.05, 0.55]) mk(rA, 'rail', 4, 20, 24, sealA, at, 0.3, crossA)
    for (const at of [0.3, 0.8]) mk(rB, 'rail', 4, 20, 24, sealB, at, 0.3, crossB)
  }

  /** ballast, two rails and sleepers along a closed path (y of the path is the ground the track sits on) */
  private track(b: Batch, path: THREE.Vector3[]) {
    const { m } = this
    const ballast = new THREE.MeshStandardMaterial({ color: '#59564f', roughness: 1, side: THREE.DoubleSide })
    const steel = new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 0.4, metalness: 0.8 })
    const closed = [...path, path[0].clone(), path[1].clone()]
    const bed = new THREE.Mesh(sweep(closed, [[-2.7, 0], [-1.9, 0.2], [1.9, 0.2], [2.7, 0]], false), ballast)
    bed.receiveShadow = true
    this.group.add(bed)
    for (const o of [-0.72, 0.72]) this.group.add(new THREE.Mesh(sweep(closed, [[o - 0.06, 0.2], [o - 0.06, 0.36], [o + 0.06, 0.36], [o + 0.06, 0.2]]), steel))
    const loop = new Loop(path)
    const p = new THREE.Vector3()
    for (let s = 0; s < loop.length; s += 1.7) {
      const { dx, dz } = loop.sample(s, p)
      b.box(0.28, 0.1, 2.6, m.wood, M(p.x, p.y + 0.25, p.z, Math.atan2(-dz, dx)), 1)
    }
  }

  /* ── the metro ────────────────────────────────────────────── */

  private metro(b: Batch, D: THREE.Vector3[], A: Loop, B: Loop) {
    const { m, physics } = this
    const y = METRO.y
    const W = 9
    const closed = [...D, D[0].clone(), D[1].clone()]
    const inStation = (p: THREE.Vector3) => METRO.stations.some(([sx, sz]) => Math.abs(p.x - sx) < 44 && Math.abs(p.z - sz) < 8)
    const cmat = (m.concrete as THREE.MeshStandardMaterial).clone()
    cmat.side = THREE.DoubleSide
    // the viaduct: a box girder with parapets, and a flat platform slab (no parapet) where a station stands
    let i0 = 0
    for (let i = 1; i <= closed.length; i++) {
      if (i < closed.length && inStation(closed[i]) === inStation(closed[i0])) continue
      const run = closed.slice(Math.max(0, i0 - 1), Math.min(closed.length, i + 1))
      if (run.length > 1) {
        const sec: [number, number][] = inStation(closed[i0])
          ? [[-W / 2 - 3.4, -1.4], [-W / 2 - 3.4, 0], [W / 2 + 3.4, 0], [W / 2 + 3.4, -1.4]]
          : [[-W / 2 - 0.5, -1.4], [-W / 2 - 0.5, 0.9], [-W / 2, 0.9], [-W / 2, 0], [W / 2, 0], [W / 2, 0.9], [W / 2 + 0.5, 0.9], [W / 2 + 0.5, -1.4]]
        const deck = new THREE.Mesh(sweep(run, sec), cmat)
        deck.castShadow = deck.receiveShadow = true
        this.group.add(deck)
        deck.updateMatrixWorld(true)
        physics.fixedMesh(deck)
      }
      i0 = i
    }
    // piers in the roadway: a column with a flared cap, set clear of every junction
    const junction = (x: number, z: number) => GRID.some((gx) => GRID.some((gz) => Math.hypot(x - gx, z - gz) < 15))
    D.forEach((p, i) => {
      if (i % 6 !== 3 || junction(p.x, p.z)) return
      const q = D[(i + 1) % D.length]
      const yaw = Math.atan2(q.x - p.x, q.z - p.z)
      b.box(1.7, y - 1.2, 1.7, m.concrete, M(p.x, (y - 1.2) / 2, p.z), 2)
      b.box(7.5, 1.0, 2.6, m.concrete, M(p.x, y - 1.6, p.z, yaw), 2)
      physics.fixedBox(p.x, (y - 1.2) / 2, p.z, 0.85, (y - 1.2) / 2, 0.85)
    })
    this.track(b, A.pts)
    this.track(b, B.pts)

    // stations: a canopy on columns, name boards on both faces, lit strips, stairs down to the street at both ends
    for (const [sx, sz, name] of METRO.stations) {
      const len = 80
      b.box(len, 0.35, 17, m.trim, M(sx, y + 4.6, sz), 2)
      for (let k = -len / 2 + 3; k <= len / 2 - 3; k += 7) for (const s of [-1, 1]) b.box(0.4, 4.4, 0.4, m.frame, M(sx + k, y + 2.4, sz + s * 7.6), 1)
      const lit = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffe2b0', emissiveIntensity: 0.4 })
      this.glow.push({ mat: lit, day: 0.4, night: 3.5 })
      for (let k = -len / 2 + 6; k < len / 2 - 4; k += 8) for (const s of [-1, 0, 1]) b.box(5, 0.1, 0.4, lit, M(sx + k, y + 4.35, sz + s * 5), 1)
      for (const s of [-1, 1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshStandardMaterial({ map: labelTexture([name, 'KOLKATA METRO'], '#0a3d91', '#ffffff', 1024, 256, '#ffd23a'), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0 }))
        ;(sign.material as THREE.MeshStandardMaterial).emissiveMap = (sign.material as THREE.MeshStandardMaterial).map
        this.glow.push({ mat: sign.material as THREE.MeshStandardMaterial, day: 0.05, night: 0.9 })
        sign.position.set(sx, y + 3.3, sz + s * 8.6)
        if (s < 0) sign.rotation.y = Math.PI
        this.group.add(sign)
      }
      for (const tz of [-4.2, 4.2]) b.box(len - 4, 0.04, 0.4, m.yellowLine, M(sx, y + 0.05, sz + tz), 1)
      for (const tz of [-6.3, 6.3]) for (const k of [-20, 0, 20]) {
        b.box(2.2, 0.08, 0.6, m.wood, M(sx + k, y + 0.5, sz + tz), 1)
        physics.fixedBox(sx + k, y + 0.45, sz + tz, 1.1, 0.4, 0.3)
      }
      for (const s of [-1, 1]) {
        b.box(len, 0.08, 0.08, m.rail, M(sx, y + 1.0, sz + s * 7.9), 1)
        physics.fixedBox(sx, y + 0.5, sz + s * 7.9, len / 2, 0.5, 0.1)
      }
      this.stairs(b, sx + len / 2 + 10, sz + 6.2, 1)
      this.stairs(b, sx - len / 2 - 10, sz + 6.2, -1)
    }
  }

  /** a flight of stairs from the viaduct platform (top at x, z, height METRO.y) down to the street, running along +x or -x */
  private stairs(b: Batch, xt: number, zt: number, dir: 1 | -1) {
    const { m, physics } = this
    const H = METRO.y
    const n = 50
    const rise = H / n
    const run = 0.3
    const Ls = n * run
    // a flat landing between the platform's end and the top step, held up by a column
    b.box(10, 0.4, 2.4, m.concrete, M(xt - dir * 5, H - 0.2, zt), 2)
    physics.fixedBox(xt - dir * 5, H - 0.2, zt, 5, 0.2, 1.2)
    b.box(0.6, H - 0.4, 0.6, m.concrete, M(xt - dir * 0.6, (H - 0.4) / 2, zt), 2)
    for (let i = 0; i < n - 1; i++) {
      const h = H - (i + 1) * rise
      b.box(run, h, 2.4, m.concrete, M(xt + dir * (i + 0.5) * run, h / 2, zt), 2)
    }
    // the walkable surface is one smooth ramp, a touch below the tread tips
    const ang = Math.atan2(H, Ls)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(Ls, H) + 1, 0.3, 2.4), m.concrete)
    ramp.position.set(xt + (dir * Ls) / 2, H / 2 - rise * 0.5 - 0.15, zt)
    ramp.rotation.z = -dir * ang
    ramp.updateMatrixWorld(true)
    physics.fixedMesh(ramp)
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(Ls, H), 0.08, 0.08), m.rail)
      rail.position.set(xt + (dir * Ls) / 2, H / 2 + 1.0, zt + s * 1.15)
      rail.rotation.z = -dir * ang
      this.group.add(rail)
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
    const r = rng(77)
    const { z1, z2, platformX, crossingX } = RAIL
    const zc = (z1 + z2) / 2
    this.track(b, A)
    this.track(b, B)
    // overhead wires: a portal gantry across both tracks every 48 m and two contact wires round the whole circuit
    const loopA = new Loop(A)
    const p = new THREE.Vector3()
    for (let s = 0; s < loopA.length; s += 48) {
      const { dx, dz } = loopA.sample(s, p)
      const l = Math.hypot(dx, dz) || 1
      const nx = -dz / l
      const nz = dx / l
      for (const o of [-3.4, 9.4]) {
        b.box(0.3, 7.6, 0.3, m.frame, M(p.x + nx * o, 3.8, p.z + nz * o), 1)
        physics.fixedCylinder(p.x + nx * o, 1.5, p.z + nz * o, 0.2, 3)
      }
      b.box(0.15, 0.15, 13, m.frame, M(p.x + nx * 3, 7.2, p.z + nz * 3, Math.atan2(-dz, dx)), 1)
    }
    const wire = new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.6 })
    for (const path of [A, B]) this.group.add(new THREE.Mesh(sweep([...path, path[0].clone(), path[1].clone()], [[-0.03, 6.6], [-0.03, 6.66], [0.03, 6.66], [0.03, 6.6]]), wire))

    // Howrah: a platform on each side of the double track behind the station building, and its name on the back wall
    this.platform(b, RAIL_RECT.x0 + 6.6, 0, 92, 7, 'z', -1)
    this.platform(b, RAIL_RECT.x0 - RAIL.gap - 6.6, 0, 92, 7, 'z', 1)
    const howrah = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.4), new THREE.MeshStandardMaterial({ map: labelTexture(['HOWRAH JUNCTION', 'Kolkata · since 1854'], '#7a1f12', '#fff4d6', 1024, 256, '#ffc61a'), roughness: 0.6 }))
    howrah.position.set(-383.2, 8.2, 0)
    howrah.rotation.y = -Math.PI / 2
    this.group.add(howrah)
    // Sealdah's second platform, beside the far track
    b.box(platformX[1] - platformX[0], 0.9, 6, m.concrete, M((platformX[0] + platformX[1]) / 2, 0.45, z2 + 6.6), 3)
    physics.fixedBox((platformX[0] + platformX[1]) / 2, 0.45, z2 + 6.6, (platformX[1] - platformX[0]) / 2, 0.45, 3)
    b.box(platformX[1] - platformX[0], 0.03, 0.4, m.yellowLine, M((platformX[0] + platformX[1]) / 2, 0.92, z2 + 4.2), 1)
    this.bridge(b, -404, 24)
    this.bridge(b, 459, 24)

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
    const W = RING.width
    const ring = ringPath()
    ring.push(ring[0].clone(), ring[1].clone())
    const asphalt = (m.asphalt as THREE.MeshStandardMaterial).clone()
    asphalt.side = THREE.DoubleSide
    const hw = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd79a', emissiveIntensity: 0.2 })
    this.glow.push({ mat: hw, day: 0.2, night: 5 })
    const junction = (x: number, z: number) => GRID.some((gx) => GRID.some((gz) => Math.hypot(x - gx, z - gz) < 15))
    this.roadSign(-193, -178, 0, ['RING FLYOVER', 'ENTRY ▲ north-west corner'])
    this.roadSign(-193, -213, 0, ['RING FLYOVER', 'ENTRY ▲ keep left'])
    this.roadSign(393, -178, 0, ['RING FLYOVER', 'EXIT ▼ north-east corner'])
    this.roadSign(425, -190, 0, ['EXIT', 'to the city ▼'])
    for (const path of [ring, rampUp(), rampDown()]) {
      // the structure: a concrete girder with parapets; the driving surface is asphalt laid on top
      // parapets only where the deck is off the ground: the ramp's foot is an open slab you can drive straight onto
      // and no parapet within 32 m of where a ramp meets the ring, so you can drive on and off at the top
      const low = (p: THREE.Vector3) => p.y < 0.9 || ([[-44, -200], [250, -200]] as const).some(([mx, mz]) => Math.hypot(p.x - mx, p.z - mz) < 32 && p.y > 5)
      let i0 = 0
      for (let i = 1; i <= path.length; i++) {
        if (i < path.length && low(path[i]) === low(path[i0])) continue
        const run = path.slice(Math.max(0, i0 - 1), Math.min(path.length, i + 1))
        if (run.length > 1) {
          const sec: [number, number][] = low(path[i0])
            ? [[-W / 2, -1.2], [-W / 2, 0], [W / 2, 0], [W / 2, -1.2]]
            : [[-W / 2 - 0.4, -1.6], [-W / 2 - 0.4, 0.95], [-W / 2, 0.95], [-W / 2, 0], [W / 2, 0], [W / 2, 0.95], [W / 2 + 0.4, 0.95], [W / 2 + 0.4, -1.6]]
          const deck = new THREE.Mesh(sweep(run, sec), (m.concrete as THREE.MeshStandardMaterial).clone())
          ;(deck.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
          deck.castShadow = deck.receiveShadow = true
          this.group.add(deck)
          deck.updateMatrixWorld(true)
          physics.fixedMesh(deck)
        }
        i0 = i
      }
      const surface = new THREE.Mesh(sweep(path.map((p) => p.clone().setY(p.y + 0.03)), [[-W / 2, 0], [W / 2, 0]], false), asphalt)
      surface.receiveShadow = true
      this.group.add(surface)
      // piers every 24 m where the deck is off the ground, clear of junctions; lamps on the parapets
      path.forEach((p, i) => {
        const q = path[Math.min(path.length - 1, i + 1)]
        const yaw = Math.atan2(q.x - p.x, q.z - p.z)
        if (i % 6 === 3 && p.y > 2 && !junction(p.x, p.z)) {
          b.box(1.9, p.y - 1.6, 1.9, m.concrete, M(p.x, (p.y - 1.6) / 2, p.z), 2)
          b.box(W - 1, 0.9, 2.6, m.concrete, M(p.x, p.y - 2, p.z, yaw), 2)
          physics.fixedBox(p.x, (p.y - 1.6) / 2, p.z, 0.95, (p.y - 1.6) / 2, 0.95)
        }
        if (i % 6 === 0 && p.y > -1) {
          for (const s of [-1, 1]) {
            const lx = p.x + Math.cos(yaw) * s * (W / 2 + 0.2)
            const lz = p.z - Math.sin(yaw) * s * (W / 2 + 0.2)
            b.box(0.14, 2.6, 0.14, m.frame, M(lx, p.y + 1.3, lz), 1)
            b.add(new THREE.SphereGeometry(0.22, 10, 8), hw, M(lx, p.y + 2.7, lz))
          }
          b.box(0.15, 0.02, 2.4, m.line, M(p.x, p.y + 0.07, p.z, yaw), 1)
        }
      })
    }
  }

  /** a green direction sign on two posts */
  private roadSign(x: number, z: number, yaw: number, lines: string[]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshStandardMaterial({ map: labelTexture(lines, '#0e5a2e', '#ffffff', 1024, 256, '#ffffff'), roughness: 0.6, side: THREE.DoubleSide }))
    board.position.set(x, 4.6, z)
    board.rotation.y = yaw
    this.group.add(board)
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.6, 0.2), this.m.frame)
      post.position.set(x + Math.cos(yaw) * s * 3.6, 2.3, z - Math.sin(yaw) * s * 3.6)
      this.group.add(post)
    }
  }

  /* ── trains ───────────────────────────────────────────────── */

  private makeTrain(coaches: number, len: number, kind: 'metro' | 'rail'): Train {
    const bodyMat = new THREE.MeshStandardMaterial({ color: kind === 'metro' ? '#f4f6fa' : '#e9e6dc', roughness: 0.45, metalness: 0.2 })
    const stripe = new THREE.MeshStandardMaterial({ color: kind === 'metro' ? '#1f55c2' : '#1d6b3a', roughness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.7 })
    const windows = new THREE.MeshStandardMaterial({ color: '#27323c', roughness: 0.2, metalness: 0.4, emissive: '#ffe3a8', emissiveIntensity: 0.1 })
    const head = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4d0', emissiveIntensity: 0.3 })
    const gap = 0.7
    const total = coaches * len + (coaches - 1) * gap
    const H = kind === 'metro' ? 3.5 : 3.7
    const cars: THREE.Group[] = []
    for (let c = 0; c < coaches; c++) {
      const group = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(len, H, 3.2), bodyMat)
      body.position.set(0, H / 2 + 0.55, 0)
      body.castShadow = true
      group.add(body)
      const band = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.55, 3.22), stripe)
      band.position.set(0, 0.55 + H * 0.28, 0)
      group.add(band)
      for (const s of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(len - 2.4, 1.0, 0.05), windows)
        win.position.set(0, 0.55 + H * 0.62, s * 1.62)
        group.add(win)
        for (const dx of [-len / 3, 0, len / 3]) {
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 0.05), dark)
          door.position.set(dx, 0.55 + 1.2, s * 1.62)
          group.add(door)
        }
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 0.35, 2.4), dark)
      roof.position.set(0, H + 0.7, 0)
      group.add(roof)
      for (const dx of [-len / 2 + 3, len / 2 - 3]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.4), dark)
        bogie.position.set(dx, 0.3, 0)
        group.add(bogie)
      }
      for (const s of [-1, 1]) {
        if ((s === 1 && c !== 0) || (s === -1 && c !== coaches - 1)) continue
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.9), head)
        lamp.position.set(s * (len / 2 + 0.02), 1.5, 0)
        group.add(lamp)
      }
      if (kind === 'rail' && c === 1) {
        const pan = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.2), dark)
        pan.position.set(0, H + 1.4, 0)
        group.add(pan)
      }
      cars.push(group)
    }
    return { cars, bodies: [], loop: undefined as unknown as Loop, kind, len, gap, total, s: 0, v: 0, top: 20, stops: [], wait: 0, served: -1, cross: 0, windows, head, y: 0 }
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

  update(dt: number, night: number) {
    for (const t of this.trains) {
      const L = t.loop.length
      // accelerate towards cruise; slow for a station stop and wait there
      let target = t.top
      if (t.wait > 0) {
        t.wait -= dt
        target = 0
      } else {
        if (t.served >= 0 && Math.abs(wrap(t.s - t.served, L)) > 20) t.served = -1
        for (const stop of t.stops) {
          if (stop === t.served) continue
          const d = wrap(stop - t.s, L)
          if (d > -0.5 && d < 50) target = Math.min(target, Math.max(2, d * 0.35))
          if (Math.abs(d) < 0.8 && t.v < 3) {
            t.wait = 9
            t.s = stop
            t.v = 0
            t.served = stop
          }
        }
      }
      t.v += (target - t.v) * Math.min(1, dt * 0.9)
      t.s = (t.s + t.v * dt) % L
      // each coach sits between two points of the track, so it bends round the curves
      t.cars.forEach((car, i) => {
        const sc = t.s + t.total / 2 - t.len / 2 - i * (t.len + t.gap)
        const a = t.loop.sample(sc - t.len * 0.4, this.tA).p
        const c = t.loop.sample(sc + t.len * 0.4, this.tB).p
        const yaw = Math.atan2(-(c.z - a.z), c.x - a.x)
        car.position.set((a.x + c.x) / 2, (a.y + c.y) / 2 + t.y, (a.z + c.z) / 2)
        car.rotation.y = yaw
        const body = t.bodies[i]
        if (body) {
          body.setNextKinematicTranslation({ x: car.position.x, y: 2.2, z: car.position.z })
          body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)))
        }
      })
      t.windows.emissiveIntensity = 0.1 + night * 1.9
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
  }
}
