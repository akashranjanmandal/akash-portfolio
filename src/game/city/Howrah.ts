import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'

/* ──────────────────────────────────────────────────────────────
   THE HOOGHLY, HOWRAH BRIDGE AND HOWRAH STATION
   The river runs north–south west of town. The main east–west road
   (z = 0) leaves town, crosses the river on a steel cantilever
   truss, and ends at the red-brick station on the far bank.
────────────────────────────────────────────────────────────── */

export const RIVER = { x: -272, half: 32, bank: 9 }
export const BRIDGE = { x0: -236, x1: -308, half: 6.2 }
export const STATION = { x: -372, z: 0 }

/** depth of the river bed at x (0 outside the river) */
export function riverDepth(x: number) {
  const d = Math.abs(x - RIVER.x)
  if (d > RIVER.half + RIVER.bank) return 0
  if (d < RIVER.half) return 4.8
  const t = 1 - (d - RIVER.half) / RIVER.bank
  return 4.8 * t * t * (3 - 2 * t)
}

function strut(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const len = a.distanceTo(b)
  const g = new THREE.BoxGeometry(t, t, len)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize())
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)))
  return g.toNonIndexed()
}

export class Howrah {
  readonly group = new THREE.Group()
  private lights: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>

  constructor(physics: Physics, m: Materials) {
    const { x0, x1, half } = BRIDGE
    const tA = RIVER.x + 18
    const tB = RIVER.x - 18
    // top chord: low at the anchors, tall at the towers, dipping over the suspended span
    const top = new THREE.SplineCurve([
      new THREE.Vector2(x0, 2.5), new THREE.Vector2(tA + 8, 12), new THREE.Vector2(tA, 26), new THREE.Vector2(tA - 9, 18),
      new THREE.Vector2(RIVER.x, 15), new THREE.Vector2(tB + 9, 18), new THREE.Vector2(tB, 26), new THREE.Vector2(tB - 8, 12), new THREE.Vector2(x1, 2.5),
    ])
    const lut: THREE.Vector2[] = []
    for (let i = 0; i <= 400; i++) lut.push(top.getPoint(i / 400))
    const yTop = (x: number) => lut.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b)).y

    const parts: THREE.BufferGeometry[] = []
    const lightPts: number[] = []
    const xs: number[] = []
    for (let x = x0; x >= x1 - 0.01; x -= 2.4) xs.push(x)
    const deckY = 0.7
    for (const side of [-1, 1]) {
      const z = side * half
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const yt = yTop(x)
        const tower = Math.abs(x - tA) < 1.3 || Math.abs(x - tB) < 1.3
        parts.push(strut(new THREE.Vector3(x, deckY, z), new THREE.Vector3(x, yt, z), tower ? 1.0 : 0.26))
        if (i < xs.length - 1) {
          const xn = xs[i + 1]
          const ytn = yTop(xn)
          parts.push(strut(new THREE.Vector3(x, yt, z), new THREE.Vector3(xn, ytn, z), 0.55))
          parts.push(strut(new THREE.Vector3(x, deckY, z), new THREE.Vector3(xn, deckY, z), 0.7))
          if ((yt + ytn) / 2 > 3) {
            // K-bracing
            parts.push(strut(new THREE.Vector3(x, deckY, z), new THREE.Vector3(xn, (ytn + deckY) * 0.55, z), 0.18))
            parts.push(strut(new THREE.Vector3(x, (yt + deckY) * 0.55, z), new THREE.Vector3(xn, ytn, z), 0.18))
          }
        }
        if (i % 2 === 0) lightPts.push(x, yt + 0.5, z)
      }
      for (const tx of [tA, tB]) {
        parts.push(strut(new THREE.Vector3(tx, 26, z), new THREE.Vector3(tx, 30, z), 0.8))
        parts.push(new THREE.ConeGeometry(0.7, 1.8, 4).translate(tx, 30.9, z).toNonIndexed())
        lightPts.push(tx, 32, z)
      }
    }
    // portal bracing over the road wherever it clears a bus
    for (const x of xs) {
      const yt = yTop(x)
      if (yt < 8) continue
      parts.push(strut(new THREE.Vector3(x, yt, -half), new THREE.Vector3(x, yt, half), 0.24))
      if (Math.round((x - x0) / 2.4) % 2 === 0) {
        parts.push(strut(new THREE.Vector3(x, yt, -half), new THREE.Vector3(x - 2.4, yTop(x - 2.4), half), 0.12))
      }
    }
    for (const tx of [tA, tB]) {
      for (const y of [14, 20, 25.5]) parts.push(strut(new THREE.Vector3(tx, y, -half), new THREE.Vector3(tx, y, half), 0.7))
      parts.push(strut(new THREE.Vector3(tx, 14, -half), new THREE.Vector3(tx, 25.5, half), 0.35))
      parts.push(strut(new THREE.Vector3(tx, 14, half), new THREE.Vector3(tx, 25.5, -half), 0.35))
    }
    const steel = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.55, metalness: 0.6 })
    const truss = new THREE.Mesh(mergeGeometries(parts.map((p) => { for (const k of Object.keys(p.attributes)) if (!['position', 'normal'].includes(k)) p.deleteAttribute(k); return p }))!, steel)
    truss.castShadow = true
    truss.receiveShadow = true
    this.group.add(truss)

    // deck, footways, railings, piers
    const b = new Batch()
    const len = x0 - x1
    const cx = (x0 + x1) / 2
    b.box(len + 2, 0.9, half * 2 + 1, m.concrete, M(cx, -0.25, 0), 4)
    b.box(len, 0.04, 10, m.asphalt, M(cx, 0.22, 0), 6)
    for (const side of [-1, 1]) {
      b.box(len, 0.25, 2.2, m.pavement, M(cx, 0.32, side * (half + 1.4)), 2)
      b.box(len, 1.0, 0.08, m.rail, M(cx, 0.9, side * (half + 2.45)))
      for (const tx of [tA, tB]) b.box(4, 10, 4, m.concrete, M(tx, -5.5, side * half), 3)
    }
    // tram rails continue across
    const rail = new THREE.MeshStandardMaterial({ color: '#8a8b8f', metalness: 0.9, roughness: 0.35 })
    for (const z of [-0.72, 0.72]) b.box(len, 0.04, 0.08, rail, M(cx, 0.26, z))
    // approach roads on both banks
    b.box(32, 0.04, 10, m.asphalt, M(-221, 0.03, 0), 6)
    b.box(64, 0.04, 10, m.asphalt, M(-340, 0.03, 0), 6)
    b.build(this.group)

    physics.fixedBox(cx, -0.25, 0, (len + 2) / 2, 0.45, half + 0.5)
    physics.fixedBox(cx, 0.2, 0, len / 2, 0.02, half + 2.5)
    for (const side of [-1, 1]) {
      physics.fixedBox(cx, 1.5, side * (half + 2.45), len / 2, 1.5, 0.12)
      for (const tx of [tA, tB]) physics.fixedBox(tx, 4, side * half, 0.6, 4, 0.6)
    }
    physics.fixedBox(-221, -0.2, 0, 16, 0.22, 5)
    physics.fixedBox(-340, -0.2, 0, 32, 0.22, 5)

    // a string of lamps along the top chords, lit at night
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPts, 3))
    this.lights = new THREE.Points(lg, new THREE.PointsMaterial({ color: '#ffd89a', size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
    this.group.add(this.lights)

    this.station(m, physics)
    this.river()
    this.embankments(m, physics)
  }

  /** stone embankments with iron railings on both banks; the only way across is the bridge */
  private embankments(m: Materials, physics: Physics) {
    const b = new Batch()
    const edge = RIVER.half + RIVER.bank + 0.6
    for (const side of [-1, 1]) {
      const x = RIVER.x + side * edge
      for (const [z0, z1] of [[-700, -9.5], [9.5, 700]]) {
        const len = z1 - z0
        const cz = (z0 + z1) / 2
        b.box(1.2, 1.4, len, m.concrete, M(x, 0.25, cz), 3)
        b.box(0.08, 0.08, len, m.rail, M(x, 1.9, cz))
        for (let z = z0; z < z1; z += 2.5) b.box(0.07, 1.0, 0.07, m.rail, M(x, 1.45, z))
        physics.fixedBox(x, 1, cz, 0.6, 2, len / 2)
      }
    }
    b.build(this.group)
  }

  /** muddy Hooghly water over the river bed */
  private river() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry((RIVER.half + RIVER.bank) * 2, 1400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#3f5246', roughness: 0.18, metalness: 0.1 }),
    )
    water.position.set(RIVER.x, -1.2, 0)
    water.receiveShadow = true
    this.group.add(water)
  }

  /** Howrah Station: long red-brick front with square clock towers */
  private station(m: Materials, physics: Physics) {
    const b = new Batch()
    const { x, z } = STATION
    const at = (lx: number, ly: number, lz: number) => M(x + lx, ly, z + lz, Math.PI / 2)
    b.box(90, 11, 22, m.redBrick, at(0, 5.5, 0), 2)
    b.box(91, 0.6, 23, m.trim, at(0, 11.3, 0))
    // arched openings along the front (facing east, +x)
    for (let i = 0; i < 14; i++) {
      b.box(3.2, 4.4, 0.2, m.frame, M(x + 11.05, 2.6, z - 39 + i * 6, Math.PI / 2))
      b.box(2.2, 2.4, 0.15, m.glass, M(x + 11.05, 8, z - 39 + i * 6, Math.PI / 2))
    }
    for (const t of [-39, -13, 13, 39]) {
      const tall = Math.abs(t) < 20 ? 30 : 22
      b.box(9, tall, 9, m.redBrick, at(0, tall / 2, t), 2)
      b.box(9.6, 0.6, 9.6, m.trim, at(0, tall + 0.3, t))
      b.add(new THREE.ConeGeometry(6.4, 4.5, 4).rotateY(Math.PI / 4), m.roof, at(0, tall + 2.8, t))
      // a clock face on the front of the tall towers
      if (tall === 30) {
        b.add(new THREE.CircleGeometry(2.2, 32), m.trim, M(x + 4.62, tall - 5, z + t, Math.PI / 2))
        b.box(0.12, 1.5, 0.12, m.frame, M(x + 4.7, tall - 4.4, z + t, Math.PI / 2))
        b.box(0.12, 1.1, 0.12, m.frame, M(x + 4.7, tall - 5, z + t + 0.45, Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2.4)))
      }
    }
    b.build(this.group)
    physics.fixedBox(x, 5.5, z, 11, 5.5, 45)
    for (const t of [-39, -13, 13, 39]) physics.fixedBox(x, 15, z + t, 4.5, 15, 4.5)
  }

  update(night: number) {
    this.lights.material.opacity = Math.min(1, Math.max(0, (night - 0.3) / 0.4))
    this.lights.visible = night > 0.3
  }
}
