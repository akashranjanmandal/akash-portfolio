import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RAPIER, type Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'
import { GRID, ROAD_W, PLOTS, plotFrame } from './Plan'
import { rng } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   KOLKATA
   What makes the town read as Kolkata rather than "a town":
   tangled overhead wires, black-and-yellow kerbs, the blue-and-
   cream tram on its tracks, yellow taxis parked along the kerb,
   red pillar boxes, tea stalls, and Victoria Memorial in white
   marble at the end of the main avenue.
────────────────────────────────────────────────────────────── */

export function kerbStripes() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#e3b21f'
  g.fillRect(0, 0, 64, 16)
  g.fillStyle = '#1a1a1d'
  g.fillRect(64, 0, 64, 16)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(0.5, 1)
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })
}

/* ── overhead wires ─────────────────────────────────────────── */

function sagTube(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius: number) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, radius, 3, false)
}

export function wires(lamps: THREE.Vector3[]) {
  const r = rng(77)
  const geos: THREE.BufferGeometry[] = []
  const top = 5.4
  // index lamps by street edge so we can link neighbours
  const key = (p: THREE.Vector3) => `${Math.round(p.x)},${Math.round(p.z)}`
  const set = new Map(lamps.map((p) => [key(p), p]))
  for (const p of lamps) {
    const a = p.clone().setY(top + r() * 0.4)
    // along the pavement to the next lamp (22 m apart)
    for (const [dx, dz] of [[22, 0], [0, 22], [24, 0], [0, 24]]) {
      const q = set.get(`${Math.round(p.x + dx)},${Math.round(p.z + dz)}`)
      if (!q) continue
      const n = 2 + Math.floor(r() * 3)
      for (let k = 0; k < n; k++) geos.push(sagTube(a.clone().setY(top - k * 0.18), q.clone().setY(top - k * 0.15 + r() * 0.2), 0.5 + r() * 0.9, 0.018))
    }
    // across the street to the lamp opposite (11.6 m)
    for (const [dx, dz] of [[11.6, 0], [0, 11.6]]) {
      const q = [...set.values()].find((o) => Math.abs(o.x - p.x - dx) < 0.6 && Math.abs(o.z - p.z - dz) < 0.6)
      if (q && r() < 0.6) geos.push(sagTube(a, q.clone().setY(top + r() * 0.3), 0.6 + r() * 0.5, 0.02))
    }
    // a service drop into the building behind the lamp
    if (r() < 0.7) {
      const out = new THREE.Vector3(Math.sign(Math.round(p.x) % 100 === 0 ? 0 : 1), 0, 0)
      const bx = ((p.x % 100) + 100) % 100
      const bz = ((p.z % 100) + 100) % 100
      // which side is the building? the edge the lamp stands on tells us
      if (Math.abs(bx - 94.2) < 1 || Math.abs(bx - 5.8) < 1) out.set(Math.abs(bx - 94.2) < 1 ? -1 : 1, 0, 0)
      else out.set(0, 0, Math.abs(bz - 94.2) < 1 ? -1 : 1)
      const wall = p.clone().addScaledVector(out, 2.6).setY(4.2 + r() * 3)
      wall.x += (r() - 0.5) * 4
      wall.z += (r() - 0.5) * 4
      geos.push(sagTube(a, wall, 0.3 + r() * 0.3, 0.015))
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.6 }))
  mesh.castShadow = false
  return mesh
}

/* ── the tram ───────────────────────────────────────────────── */

function tramTexture() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#e9e1cf'
  g.fillRect(0, 0, 1024, 256)
  g.fillStyle = '#2c5fa6'
  g.fillRect(0, 168, 1024, 88)
  g.fillRect(0, 0, 1024, 26)
  // windows
  for (let i = 0; i < 9; i++) {
    g.fillStyle = '#1d2733'
    g.fillRect(40 + i * 108, 48, 82, 92)
    g.fillStyle = 'rgba(255,255,255,0.12)'
    g.fillRect(40 + i * 108, 48, 82, 20)
  }
  g.fillStyle = '#ffffff'
  g.font = '700 30px system-ui, sans-serif'
  g.fillText('CALCUTTA TRAMWAYS · ESPLANADE — GOBT HQ', 40, 220)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** just the window panes, used as the tram's glow map after dark */
function tramGlow() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 1024, 256)
  g.fillStyle = '#ffe2b0'
  for (let i = 0; i < 9; i++) g.fillRect(40 + i * 108, 48, 82, 92)
  return new THREE.CanvasTexture(c)
}

export class Tram {
  private side!: THREE.MeshStandardMaterial
  private lamp!: THREE.Mesh
  readonly group = new THREE.Group()
  private body: RAPIER.RigidBody
  private z = -170
  private dir = 1
  private wait = 0
  private readonly x = 0
  static readonly Z0 = -190
  static readonly Z1 = 190
  onBell?: (pos: THREE.Vector3) => void

  constructor(physics: Physics) {
    const tex = tramTexture()
    const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissiveMap: tramGlow(), emissive: '#ffffff', emissiveIntensity: 0 })
    this.side = side
    const end = new THREE.MeshStandardMaterial({ color: '#e9e1cf', roughness: 0.5 })
    const roof = new THREE.MeshStandardMaterial({ color: '#7b7f86', roughness: 0.6, metalness: 0.3 })
    const dark = new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.7 })
    const L = 12
    const W = 2.4
    const H = 2.9
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), [side, side, roof, dark, end, end])
    // texture maps along the long sides: rotate UVs on the ±X faces
    box.position.y = 0.5 + H / 2
    box.castShadow = true
    box.receiveShadow = true
    this.group.add(box)
    const roofCap = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, L, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(0), roof)
    roofCap.scale.y = 0.25
    roofCap.rotation.z = Math.PI / 2
    roofCap.rotation.set(0, 0, 0)
    roofCap.position.y = 0.5 + H
    this.group.add(roofCap)
    // trolley pole up to the wire
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.2, 6), dark)
    pole.position.set(0, 0.5 + H + 1.6, -2)
    pole.rotation.x = -0.75
    this.group.add(pole)
    for (const z of [-L / 2 + 1.6, L / 2 - 1.6]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, 0.5, 2.4), dark)
      bogie.position.set(0, 0.3, z)
      this.group.add(bogie)
    }
    // headlamps at both ends
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff3d0', emissiveIntensity: 0.2 }))
    for (const z of [-L / 2 - 0.05, L / 2 + 0.05]) {
      const m = this.lamp.clone()
      m.position.set(0, 1.4, z)
      this.group.add(m)
    }
    this.group.position.set(this.x, 0.02, this.z)
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, 1.9, this.z))
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, 1.5, L / 2), this.body)
  }

  setNight(n: number) {
    this.side.emissiveIntensity = n > 0.3 ? 1.6 * n : 0
    ;(this.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + (n > 0.3 ? 6 * n : 0)
  }

  update(dt: number) {
    if (this.wait > 0) {
      this.wait -= dt
      return
    }
    this.z += this.dir * 6 * dt
    if (this.z > Tram.Z1 || this.z < Tram.Z0) {
      this.z = THREE.MathUtils.clamp(this.z, Tram.Z0, Tram.Z1)
      this.dir *= -1
      this.wait = 6
      this.onBell?.(this.group.position)
    }
    this.group.position.z = this.z
    this.body.setNextKinematicTranslation({ x: this.x, y: 1.9, z: this.z })
  }
}

/** rails along the central avenue and the trolley wire above it */
export function tramLine(b: Batch) {
  const rail = new THREE.MeshStandardMaterial({ color: '#8a8b8f', metalness: 0.9, roughness: 0.35 })
  const L = Tram.Z1 - Tram.Z0 + 20
  for (const x of [-0.72, 0.72]) b.box(0.08, 0.04, L, rail, M(x, 0.04, 0))
  const wire = new THREE.MeshStandardMaterial({ color: '#202022' })
  b.add(new THREE.CylinderGeometry(0.015, 0.015, L, 4).rotateX(Math.PI / 2), wire, M(0, 6.2, 0))
}

/* ── parked yellow taxis (merged into a few draws) ──────────── */

/* ── street furniture ───────────────────────────────────────── */

export function streetLife(b: Batch, m: Materials, physics: Physics) {
  const r = rng(31)
  const red = new THREE.MeshStandardMaterial({ color: '#b5201c', roughness: 0.5 })
  const black = new THREE.MeshStandardMaterial({ color: '#1b1b1e', roughness: 0.6 })
  const tin = new THREE.MeshStandardMaterial({ color: '#8f8f93', roughness: 0.5, metalness: 0.6 })
  const blue = new THREE.MeshStandardMaterial({ color: '#2e5aa0', roughness: 0.6 })
  const clay = new THREE.MeshStandardMaterial({ color: '#a8572e', roughness: 0.9 })
  const edge = 50 - ROAD_W / 2 - 1.3
  let posts = 0
  for (let i = 0; i < GRID.length - 1; i++) {
    for (let j = 0; j < GRID.length - 1; j++) {
      const cx = (GRID[i] + GRID[i + 1]) / 2
      const cz = (GRID[j] + GRID[j + 1]) / 2
      // a red pillar box on every other block corner
      if ((i + j) % 2 === 0) {
        const x = cx + edge - 3
        const z = cz + edge
        b.add(new THREE.CylinderGeometry(0.32, 0.34, 1.3, 16), red, M(x, 0.8, z))
        b.add(new THREE.SphereGeometry(0.33, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, M(x, 1.45, z))
        b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 16), black, M(x, 1.3, z))
        physics.fixedCylinder(x, 0.8, z, 0.35, 1.6)
        posts++
      }
      // a tea stall: tin counter, blue tarp, clay cups
      if (r() < 0.55) {
        const x = cx - edge + 2.4
        const z = cz + (r() - 0.5) * 50
        if (PLOTS.some((p) => { const f = plotFrame(p); return Math.hypot(f.x - x, f.z - z) < 12 })) continue
        b.box(1.8, 1.0, 0.9, tin, M(x, 0.65, z))
        for (const [dx, dz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) b.box(0.05, 2.3, 0.05, black, M(x + dx, 1.3, z + dz))
        b.box(2.4, 0.04, 1.6, blue, M(x, 2.4, z).multiply(new THREE.Matrix4().makeRotationX(0.12)))
        for (let k = 0; k < 5; k++) b.add(new THREE.CylinderGeometry(0.04, 0.03, 0.08, 8), clay, M(x - 0.5 + k * 0.22, 1.2, z + 0.2))
        b.add(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 12), tin, M(x + 0.5, 1.3, z - 0.1))
        // two wooden benches
        b.box(1.4, 0.08, 0.35, m.wood, M(x, 0.45, z + 1.2))
        b.box(1.4, 0.08, 0.35, m.wood, M(x, 0.45, z - 1.2))
        physics.fixedBox(x, 0.65, z, 0.9, 0.65, 0.45)
      }
    }
  }
  return posts
}

/* ── Victoria Memorial, at the end of the central avenue ────── */

export const MEMORIAL = { x: 0, z: -300 }

export function victoriaMemorial(b: Batch, m: Materials, physics: Physics) {
  const { x, z } = MEMORIAL
  const marble = m.marble
  const at = (lx: number, ly: number, lz: number, ry = 0) => M(x + lx, ly, z + lz, ry)
  // the approach: avenue, lawns and a long reflecting pool
  const road = new THREE.MeshStandardMaterial({ color: '#d6cdb9', roughness: 0.9 })
  b.box(10, 0.04, 70, m.asphalt, at(0, 0.02, 60))
  b.box(14, 0.06, 40, road, at(0, 0.03, 26))
  const water = new THREE.MeshStandardMaterial({ color: '#4b6f7c', roughness: 0.05, metalness: 0.3 })
  for (const sx of [-1, 1]) {
    b.box(8, 0.05, 36, water, at(sx * 16, 0.04, 28))
    b.box(8.6, 0.25, 36.6, marble, at(sx * 16, 0.0, 28))
  }
  // plinth and steps
  b.box(76, 1.2, 44, marble, at(0, 0.6, -6), 4)
  for (let s = 0; s < 4; s++) b.box(30 - s * 2, 0.3, 4, marble, at(0, 0.15 + s * 0.3, 17 + s * -0.9))
  // main block with wings
  b.box(64, 12, 30, marble, at(0, 7.2, -6), 4)
  for (const sx of [-1, 1]) {
    b.box(12, 15, 32, marble, at(sx * 27, 8.7, -6), 4)
    // corner cupolas
    b.add(new THREE.CylinderGeometry(3.4, 3.4, 4, 16), marble, at(sx * 27, 17.8, 4))
    b.add(new THREE.SphereGeometry(3.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), marble, at(sx * 27, 19.8, 4))
    b.add(new THREE.CylinderGeometry(3.4, 3.4, 4, 16), marble, at(sx * 27, 17.8, -16))
    b.add(new THREE.SphereGeometry(3.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), marble, at(sx * 27, 19.8, -16))
  }
  // arcade of columns across the front
  for (let i = 0; i < 13; i++) b.add(new THREE.CylinderGeometry(0.55, 0.6, 8, 14), marble, at(-21 + i * 3.5, 5.2, 9.6))
  b.box(46, 1.4, 2, marble, at(0, 9.9, 9.6))
  // central drum, dome, lantern and the figure on top
  b.add(new THREE.CylinderGeometry(12, 12.5, 8, 40), marble, at(0, 17, -6))
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 7, 10), marble, at(Math.sin(a) * 12.6, 17, -6 + Math.cos(a) * 12.6))
  }
  const dome = new THREE.SphereGeometry(12.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2)
  dome.scale(1, 1.15, 1)
  b.add(dome, marble, at(0, 21, -6))
  b.add(new THREE.CylinderGeometry(2, 2.4, 4, 16), marble, at(0, 35.5, -6))
  b.add(new THREE.SphereGeometry(2.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), marble, at(0, 37.5, -6))
  const bronze = new THREE.MeshStandardMaterial({ color: '#2f3b33', metalness: 0.8, roughness: 0.45 })
  b.add(new THREE.CylinderGeometry(0.3, 0.6, 3, 10), bronze, at(0, 41, -6))
  b.box(3.4, 0.25, 0.6, bronze, at(0, 41.6, -6))
  physics.fixedBox(x, 1.2, z - 6, 38, 1.2, 22)
  physics.fixedBox(x, 9, z - 6, 33, 9, 16)
  // the asphalt approach needs a floor (terrain is right below it)
  physics.fixedBox(x, -0.2, z + 60, 5, 0.22, 35)
}
