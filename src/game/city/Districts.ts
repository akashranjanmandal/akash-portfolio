import * as THREE from 'three'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'
import { addFairy, type FairyBuffer } from './Fairy'
import { DISTRICTS, HIGHWAY, EDEN } from './Plan'
import { SCALE } from '../Scale'
import { rng } from '../../utils/math'
import { labelTexture } from '../hills/Portal'

/* ──────────────────────────────────────────────────────────────
   DISTRICTS & THE HIGHWAY
   Not every block is a row of shop-houses. A lakeside promenade,
   a pedestrian esplanade around a tall memorial column, and an
   eastern bypass with a median — so the town has places to be,
   not just streets to drive.
────────────────────────────────────────────────────────────── */

const CURB = SCALE.kerb
const HALF = 41.5 // buildable half-size of a block

export type DistrictOut = {
  /** matrices for shade trees (scale 1 = a 5 m tree) */
  trees: THREE.Matrix4[]
  /** extra street lamps: x, z, yaw */
  lamps: [number, number, number][]
  /** ground light pools (decals), brightness 0..peak at night */
  pools: { mat: THREE.MeshBasicMaterial; peak: number }[]
  /** glowing materials: intensity multiplier at night */
  glow: { mat: THREE.MeshStandardMaterial; day: number; night: number }[]
  /** water surfaces to animate */
  water: THREE.MeshStandardMaterial[]
}

type Ctx = { b: Batch; m: Materials; physics: Physics; fairy: FairyBuffer; group: THREE.Group; out: DistrictOut; r: () => number }

const waterMat = () =>
  new THREE.MeshStandardMaterial({ color: '#1b3f4a', roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.94, envMapIntensity: 1.1 })

/** planar UVs from world position so a texture keeps its real-world size on any shape */
function planar(geo: THREE.BufferGeometry, scale: number) {
  const p = geo.attributes.position as THREE.BufferAttribute
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / scale
    uv[i * 2 + 1] = p.getZ(i) / scale
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

function solid(c: Ctx, x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, yaw = 0, tex = 2) {
  c.b.box(w, h, d, mat, M(x, y, z, yaw), tex)
  c.physics.fixedBox(x, y, z, w / 2, h / 2, d / 2, yaw)
}

function bench(c: Ctx, x: number, z: number, yaw: number) {
  const { b, m } = c
  b.box(1.7, 0.07, 0.5, m.wood, M(x, CURB + SCALE.benchSeat, z, yaw), 1)
  const back = M(x, CURB + 0.75, z, yaw).multiply(M(0, 0, -0.22))
  b.box(1.7, 0.4, 0.06, m.wood, back, 1)
  for (const s of [-0.7, 0.7]) b.box(0.08, 0.45, 0.45, m.rail, M(x, CURB + 0.22, z, yaw).multiply(M(s, 0, 0)))
  c.physics.fixedBox(x, CURB + 0.4, z, 0.85, 0.4, 0.3, yaw)
}

function tree(c: Ctx, x: number, z: number, s = 1.15) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r() * 6.28)
  c.out.trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB, z), q, new THREE.Vector3(s, s * 1.25, s)))
}

function lampAt(c: Ctx, x: number, z: number, cx: number, cz: number) {
  c.out.lamps.push([x, z, Math.atan2(cx - x, cz - z)])
}

/** a soft pool of light on the ground: one cheap additive decal instead of a real light (real lights slow every surface) */
const poolTex = (() => {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,0.85)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
})()

function nightLight(c: Ctx, x: number, _y: number, z: number, color: string, power: number, range: number) {
  const mat = new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 })
  const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).scale(range * 0.9, 1, range * 0.9), mat)
  d.position.set(x, CURB + 0.05, z)
  d.renderOrder = 1
  c.group.add(d)
  c.out.pools.push({ mat, peak: Math.min(0.9, power / 60) })
}

function strand(c: Ctx, a: [number, number, number], b2: [number, number, number], sag = 0.5, colour = false) {
  addFairy(c.fairy, new THREE.Vector3(...a), new THREE.Vector3(...b2), sag, colour)
}

/* ── the lake ───────────────────────────────────────────────── */

function lake(c: Ctx, cx: number, cz: number) {
  const { b, m, group, out } = c
  const A = 23 // water radii (x, z)
  const Z = 15
  b.add(new THREE.PlaneGeometry(2 * HALF, 2 * HALF).rotateX(-Math.PI / 2), m.grass, M(cx, CURB + 0.015, cz))

  // paved promenade ring around the lake, with a kerb on both edges
  const ring = new THREE.RingGeometry(1.0, 1.3, 72, 1).rotateX(-Math.PI / 2)
  ring.scale(A + 0.6, 1, Z + 0.6)
  ring.translate(cx, CURB + 0.03, cz)
  planar(ring, 3)
  b.add(ring, m.pavement)

  // the lake itself, a low stone parapet around it
  const water = waterMat()
  out.water.push(water)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2).scale(A, 1, Z), water)
  disc.position.set(cx, CURB + 0.07, cz)
  disc.receiveShadow = true
  group.add(disc)
  // sunk bed so the lake has depth: a dark floor under the water
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(A, 1, Z), new THREE.MeshStandardMaterial({ color: '#0f2a2e', roughness: 1 }))
  bed.position.set(cx, CURB + 0.04, cz)
  group.add(bed)
  const SEG = 44
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2
    const a1 = ((i + 1) / SEG) * Math.PI * 2
    const x0 = cx + Math.cos(a0) * (A + 0.35), z0 = cz + Math.sin(a0) * (Z + 0.35)
    const x1 = cx + Math.cos(a1) * (A + 0.35), z1 = cz + Math.sin(a1) * (Z + 0.35)
    const len = Math.hypot(x1 - x0, z1 - z0)
    solid(c, (x0 + x1) / 2, CURB + 0.4, (z0 + z1) / 2, 0.45, 0.8, len + 0.08, m.granite, Math.atan2(x1 - x0, z1 - z0), 2)
  }

  // an island with a pavilion, reached by a little bridge from the south shore
  const ix = cx - 4
  const iz = cz - 2
  const island = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.6, 24), m.grass)
  island.position.set(ix, CURB + 0.2, iz)
  group.add(island)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.18, 6, 32).rotateX(Math.PI / 2), m.granite)
  rim.position.set(ix, CURB + 0.5, iz)
  group.add(rim)
  c.physics.fixedCylinder(ix, CURB + 0.2, iz, 4.5, 1.2)
  // gazebo: eight columns, a stone floor, a shallow roof
  b.add(new THREE.CylinderGeometry(3.2, 3.4, 0.3, 8), m.marble, M(ix, CURB + 0.65, iz))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    b.add(new THREE.CylinderGeometry(0.14, 0.17, 3.0, 8), m.trim, M(ix + Math.cos(a) * 2.9, CURB + 2.2, iz + Math.sin(a) * 2.9))
  }
  b.add(new THREE.ConeGeometry(3.7, 1.5, 8), m.roof, M(ix, CURB + 4.4, iz))
  b.add(new THREE.CylinderGeometry(3.45, 3.45, 0.2, 8), m.trim, M(ix, CURB + 3.75, iz))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const a2 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8
    strand(c, [ix + Math.cos(a) * 3, CURB + 3.65, iz + Math.sin(a) * 3], [ix + Math.cos(a2) * 3, CURB + 3.65, iz + Math.sin(a2) * 3], 0.3, true)
  }
  nightLight(c, ix, CURB + 3, iz, '#ffd9a0', 22, 14)
  // bridge from the south shore
  solid(c, ix, CURB + 0.4, cz + (Z + iz - cz) / 2 + 2.2, 1.8, 0.2, Z - (iz - cz) - 3.4, m.wood, 0, 1)
  for (const s of [-0.9, 0.9]) b.box(0.08, 0.9, Z - (iz - cz) - 3.4, m.rail, M(ix + s, CURB + 0.95, cz + (Z + iz - cz) / 2 + 2.2))

  // benches facing the water, lamps and trees around the promenade
  const N = 14
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.2
    const x = cx + Math.cos(a) * (A + 4.6)
    const z = cz + Math.sin(a) * (Z + 4.6)
    bench(c, x, z, Math.atan2(cx - x, cz - z) + Math.PI)
    if (i % 2 === 0) {
      lampAt(c, cx + Math.cos(a + 0.2) * (A + 6.2), cz + Math.sin(a + 0.2) * (Z + 6.2), cx, cz)
      tree(c, cx + Math.cos(a + 0.45) * (A + 9), cz + Math.sin(a + 0.45) * (Z + 9), 1.1 + c.r() * 0.35)
    }
  }
  // fairy lights strung between lamps all the way round
  const L = 14
  for (let i = 0; i < L; i++) {
    const a = ((i + 0.4) / L) * Math.PI * 2
    const a2 = ((i + 1.4) / L) * Math.PI * 2
    strand(c, [cx + Math.cos(a) * (A + 6.4), 4.6, cz + Math.sin(a) * (Z + 6.4)], [cx + Math.cos(a2) * (A + 6.4), 4.6, cz + Math.sin(a2) * (Z + 6.4)], 0.9, false)
  }
  // trees in the park corners, so the middle of the block feels like a real park
  for (let i = 0; i < 12; i++) {
    const x = cx + (c.r() - 0.5) * 2 * (HALF - 3)
    const z = cz + (c.r() - 0.5) * 2 * (HALF - 3)
    if (((x - cx) / (A + 9)) ** 2 + ((z - cz) / (Z + 9)) ** 2 < 1) continue
    tree(c, x, z, 1.15 + c.r() * 0.4)
  }
  for (const s of [-1, 1]) nightLight(c, cx + s * 30, CURB + 4, cz + 2, '#ffd8a8', 20, 20)
}

/* ── the esplanade ──────────────────────────────────────────── */

function plaza(c: Ctx, cx: number, cz: number) {
  const { b, m, group, out } = c
  // paving over the whole block, with a lighter cross of paths
  b.box(2 * HALF, 0.03, 2 * HALF, m.paving, M(cx, CURB + 0.02, cz), 3)
  b.box(8, 0.035, 2 * HALF, m.pavement, M(cx, CURB + 0.04, cz), 3)
  b.box(2 * HALF, 0.035, 8, m.pavement, M(cx + 0, CURB + 0.04, cz), 3)

  // the memorial column: three marble steps, a 44 m tapering shaft, a domed cap
  let y = CURB
  for (const [s, h] of [[16, 0.4], [12.5, 0.4], [9.5, 0.4]] as const) {
    solid(c, cx, y + h / 2, cz, s, h, s, m.marble, 0, 3)
    y += h
  }
  const shaftH = 44
  // the shaft is floodlit after dark, so it gets its own material that glows warmly
  const lit = (m.marble as THREE.MeshStandardMaterial).clone()
  lit.emissive = new THREE.Color('#ffd9a0')
  lit.emissiveIntensity = 0
  out.glow.push({ mat: lit, day: 0, night: 0.55 })
  const shaft = new THREE.CylinderGeometry(0.95, 1.55, shaftH, 24)
  b.add(shaft, lit, M(cx, y + shaftH / 2, cz))
  b.add(new THREE.CylinderGeometry(1.5, 1.6, 1.2, 24), m.trim, M(cx, y + 0.6, cz))
  for (const h of [12, 26]) b.add(new THREE.CylinderGeometry(1.25, 1.25, 0.25, 24), m.trim, M(cx, y + h, cz))
  b.add(new THREE.CylinderGeometry(1.3, 1.0, 1.2, 24), m.trim, M(cx, y + shaftH + 0.6, cz))
  b.add(new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.marble, M(cx, y + shaftH + 1.2, cz))
  b.add(new THREE.CylinderGeometry(0.03, 0.05, 3, 6), m.rail, M(cx, y + shaftH + 2.7, cz))
  c.physics.fixedCylinder(cx, y + shaftH / 2, cz, 1.7, shaftH)
  // floodlights at the foot light the shaft after dark
  const flood = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffe9bd', emissiveIntensity: 0.2 })
  out.glow.push({ mat: flood, day: 0.2, night: 4 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    b.box(0.5, 0.35, 0.5, flood, M(cx + Math.cos(a) * 6.2, CURB + 1.1, cz + Math.sin(a) * 6.2, -a))
  }
  nightLight(c, cx, CURB + 7, cz, '#ffe3b0', 70, 46)
  nightLight(c, cx, CURB + 22, cz, '#ffe3b0', 60, 40)

  // four fountains
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const fx = cx + sx * 21
    const fz = cz + sz * 21
    b.add(new THREE.CylinderGeometry(3.9, 4.1, 0.8, 28), m.marble, M(fx, CURB + 0.4, fz))
    b.add(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 12), m.marble, M(fx, CURB + 1.5, fz))
    b.add(new THREE.CylinderGeometry(1.4, 0.4, 0.35, 16), m.marble, M(fx, CURB + 2.2, fz))
    const w = waterMat()
    out.water.push(w)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.55, 32).rotateX(-Math.PI / 2), w)
    disc.position.set(fx, CURB + 0.72, fz)
    group.add(disc)
    const spray = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: true }))
    spray.position.set(fx, CURB + 2.5, fz)
    group.add(spray)
    c.physics.fixedCylinder(fx, CURB + 0.4, fz, 4.1, 0.8)
    nightLight(c, fx, CURB + 3, fz, '#9fd8ff', 14, 12)
  }

  // chai stalls and cart-stands in a ring, striped awnings in festival colours
  const stall = 8
  for (let i = 0; i < stall; i++) {
    const a = (i / stall) * Math.PI * 2 + 0.4
    const x = cx + Math.cos(a) * 31
    const z = cz + Math.sin(a) * 31
    const yaw = Math.atan2(cx - x, cz - z)
    const col = m.cloth[i % m.cloth.length]
    const base = M(x, CURB, z, yaw)
    b.box(2.6, 1.0, 1.1, m.wood, base.clone().multiply(M(0, 0.5, 0)), 1)
    b.box(2.6, 2.3, 0.1, m.frame, base.clone().multiply(M(0, 1.15, -0.6)), 1)
    const awn = new THREE.BoxGeometry(2.9, 0.05, 1.6)
    b.add(awn, col, base.clone().multiply(M(0, 2.35, 0.1)).multiply(new THREE.Matrix4().makeRotationX(0.18)))
    for (const s of [-1.3, 1.3]) b.box(0.07, 2.35, 0.07, m.rail, base.clone().multiply(M(s, 1.17, 0.7)))
    b.add(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 10), m.rail, base.clone().multiply(M(0.6, 1.2, 0)))
    c.physics.fixedBox(x, CURB + 1, z, 1.4, 1, 0.8, yaw)
    const lamp = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf80', emissiveIntensity: 0.2 })
    out.glow.push({ mat: lamp, day: 0.2, night: 3.5 })
    b.add(new THREE.SphereGeometry(0.1, 8, 6), lamp, base.clone().multiply(M(-1, 2.2, 0.8)))
  }
  // benches in two rows along the paths, planters between them
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue
    for (const side of [-1, 1]) {
      bench(c, cx + side * 6, cz + k * 10, side > 0 ? -Math.PI / 2 : Math.PI / 2)
      bench(c, cx + k * 10, cz + side * 6, side > 0 ? Math.PI : 0)
    }
  }
  // lamps and tall shade trees around the edge, strings of lights across the paths
  const edge = 36
  for (const t of [-30, -15, 0, 15, 30]) {
    lampAt(c, cx + t, cz - edge, cx, cz)
    lampAt(c, cx + t, cz + edge, cx, cz)
    if (t !== 0) {
      lampAt(c, cx - edge, cz + t, cx, cz)
      lampAt(c, cx + edge, cz + t, cx, cz)
    }
  }
  for (let t = -30; t < 30; t += 15) {
    strand(c, [cx + t, 5.4, cz - edge], [cx + t + 15, 5.4, cz - edge], 0.7, true)
    strand(c, [cx + t, 5.4, cz + edge], [cx + t + 15, 5.4, cz + edge], 0.7, true)
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    tree(c, cx + Math.cos(a) * 38, cz + Math.sin(a) * 38, 1.2 + c.r() * 0.4)
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    for (const o of [-10, 10]) tree(c, cx + sx * 33 + o * 0.2, cz + sz * 12 + o, 1.1 + c.r() * 0.3)
  }
}


/* ── Eden Gardens ───────────────────────────────────────────── */

function stadium(c: Ctx, cx: number, cz: number) {
  const { b, m, group, out } = c
  const RX = EDEN.fieldX
  const RZ = EDEN.fieldZ
  const ROWS = 22
  const rise = 0.5
  const run = 0.75
  b.box(2 * (EDEN.half - 3.5), 0.03, 2 * (EDEN.half - 3.5), m.paving, M(cx, CURB + 0.02, cz), 3)

  // the outfield, mown in broad stripes, with a rope, a 30-yard circle, the pitch and creases
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 8
  const g = cv.getContext('2d')!
  g.fillStyle = '#3d7a37'
  g.fillRect(0, 0, 32, 8)
  g.fillStyle = '#4a8d41'
  g.fillRect(32, 0, 32, 8)
  const stripe = new THREE.CanvasTexture(cv)
  stripe.colorSpace = THREE.SRGBColorSpace
  stripe.wrapS = stripe.wrapT = THREE.RepeatWrapping
  const fieldGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2)
  fieldGeo.scale(RX, 1, RZ)
  fieldGeo.translate(cx, CURB + 0.07, cz)
  planar(fieldGeo, 6)
  group.add(Object.assign(new THREE.Mesh(fieldGeo, new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.95 })), { receiveShadow: true }))
  const ringLine = (rxs: number, rzs: number, y: number, w: number, color: string) => {
    const r = new THREE.RingGeometry(1 - w, 1, 72).rotateX(-Math.PI / 2)
    r.scale(rxs, 1, rzs)
    r.translate(cx, CURB + y, cz)
    group.add(new THREE.Mesh(r, new THREE.MeshBasicMaterial({ color })))
  }
  ringLine(RX, RZ, 0.1, 0.006, '#f4f4ee')
  ringLine(32, 27.4, 0.09, 0.008, '#e8ecdc')
  const clay = new THREE.MeshStandardMaterial({ color: '#c9b27c', roughness: 1 })
  b.box(20.1, 0.02, 3.05, clay, M(cx, CURB + 0.1, cz), 4)
  for (const s of [-1, 1]) {
    b.box(3.5, 0.015, 0.05, m.line, M(cx + s * 8.6, CURB + 0.115, cz + 1.3), 1)
    b.box(3.5, 0.015, 0.05, m.line, M(cx + s * 8.6, CURB + 0.115, cz - 1.3), 1)
    b.box(0.05, 0.015, 2.64, m.line, M(cx + s * 8.6, CURB + 0.115, cz), 1)
    b.box(0.05, 0.015, 2.64, m.line, M(cx + s * 10.05, CURB + 0.115, cz), 1)
    for (const dz of [-0.11, 0, 0.11]) b.box(0.04, 0.7, 0.04, m.wood, M(cx + s * 10.05, CURB + 0.45, cz + dz), 1)
  }
  // advertising boards round the rope
  const adColors = ['#1d4fa8', '#d62b2b', '#f2f2f2', '#f2b705', '#1c8c4e', '#7a2fb0']
  const AD = 44
  for (let i = 0; i < AD; i++) {
    const a0 = (i / AD) * Math.PI * 2
    const a1 = ((i + 1) / AD) * Math.PI * 2
    const am = (a0 + a1) / 2
    if (Math.abs(Math.cos(am)) < 0.08) continue
    const rr = 1.012
    const x = cx + Math.cos(am) * RX * rr
    const z = cz + Math.sin(am) * RZ * rr
    const len = Math.hypot((Math.cos(a1) - Math.cos(a0)) * RX, (Math.sin(a1) - Math.sin(a0)) * RZ)
    const yaw = Math.atan2(-(Math.sin(a1) - Math.sin(a0)) * RZ, (Math.cos(a1) - Math.cos(a0)) * RX)
    b.box(len + 0.05, 0.9, 0.14, new THREE.MeshStandardMaterial({ color: adColors[i % adColors.length], roughness: 0.6 }), M(x, CURB + 0.5, z, yaw), 1)
  }

  // the bowl: 22 stepped rows. Seats alternate blue and white with a yellow band; gaps at north and south are the gates,
  // the west end makes room for the pavilion and the east end for the sightscreen
  const white = new THREE.MeshStandardMaterial({ color: '#e8ecf4', roughness: 0.8 })
  const rx = (t: number) => RX + 2.2 + t * run
  const rz = (t: number) => RZ + 2.2 + t * run * 0.9
  const SEC = 56
  const gate = (am: number) => Math.abs(Math.cos(am)) < 0.1
  const west = (am: number) => Math.abs(am - Math.PI) < 0.42
  const east = (am: number) => Math.abs(am < Math.PI ? am : am - Math.PI * 2) < 0.2
  // the bowl as one continuous stepped surface with per-vertex colour: blue and white blocks split by grey aisles,
  // a darker upper tier and a yellow band; gaps at the two gates, the pavilion and the sightscreen
  {
    const pos: number[] = []
    const col: number[] = []
    const P = (a: number, t: number, y: number) => [cx + Math.cos(a) * (RX + 2.2 + t * run), CURB + y, cz + Math.sin(a) * (RZ + 2.2 + t * run * 0.9)]
    const quad = (A: number[], B: number[], C: number[], D: number[], k: THREE.Color) => {
      for (const v of [A, B, C, A, C, D]) {
        pos.push(...v)
        col.push(k.r, k.g, k.b)
      }
    }
    const grey = new THREE.Color('#8f9298')
    for (let k = 0; k < SEC; k++) {
      const a0 = (k / SEC) * Math.PI * 2
      const a1 = ((k + 1) / SEC) * Math.PI * 2
      const am = (a0 + a1) / 2
      if (gate(am)) continue
      const bl = Math.floor(k / 4) % 2
      for (let t = 0; t < ROWS; t++) {
        if ((west(am) && t < 15) || (east(am) && t < 7)) continue
        const base = k % 4 === 0 ? grey : t % 7 === 6 ? new THREE.Color('#f2b705') : t >= 12 ? new THREE.Color(bl ? '#2b4f8f' : '#cfd6e4') : new THREE.Color(bl ? '#1d4fa8' : '#e8ecf4')
        const y0 = t * rise
        const y1 = (t + 1) * rise
        quad(P(a0, t, y0), P(a1, t, y0), P(a1, t, y1), P(a0, t, y1), base.clone().multiplyScalar(0.8))
        quad(P(a0, t, y1), P(a1, t, y1), P(a1, t + 1, y1), P(a0, t + 1, y1), base)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.computeVertexNormals()
    const bowlMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }))
    bowlMesh.castShadow = bowlMesh.receiveShadow = true
    group.add(bowlMesh)
    bowlMesh.updateMatrixWorld(true)
    c.physics.fixedMesh(bowlMesh)
  }
  const seats: THREE.Matrix4[] = []
  const colours: THREE.Color[] = []
  const seatPalette = ['#566fa1', '#e4ebed', '#719bc0', '#c3a64c'].map(hex => new THREE.Color(hex))
  for (let sector = 0; sector < SEC; sector++) {
    const middle = (sector + 0.5) * 2 * Math.PI / SEC
    if (gate(middle) || sector % 4 === 0) continue
    for (let row = 0; row < ROWS; row++) {
      if ((west(middle) && row < 15) || (east(middle) && row < 7)) continue
      const count = Math.floor(Math.hypot(Math.sin(middle) * rx(row), Math.cos(middle) * rz(row)) * 2 * Math.PI / SEC / 0.54)
      for (let seat = 0; seat < count; seat++) {
        const a = (sector + (seat + 0.5) / count) * 2 * Math.PI / SEC
        seats.push(M(cx + Math.cos(a) * rx(row + 0.72), CURB + (row + 1) * rise + 0.16, cz + Math.sin(a) * rz(row + 0.72), Math.atan2(Math.cos(a), Math.sin(a))))
        colours.push(seatPalette[row % 7 === 6 ? 3 : Math.floor(sector / 4) % 3])
      }
    }
  }
  const chairs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.29, 0.085), new THREE.MeshStandardMaterial({ roughness: 0.73 }), seats.length)
  seats.forEach((at, i) => { chairs.setMatrixAt(i, at); chairs.setColorAt(i, colours[i]) })
  chairs.receiveShadow = true
  group.add(chairs)
  // the facade: a tall wall of pale plaster ribs with rows of lit arched windows, a gap at each gate
  const wall = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.9 })
  const rib = new THREE.MeshStandardMaterial({ color: '#b9b2a2', roughness: 0.9 })
  const winMat = new THREE.MeshStandardMaterial({ color: '#202833', emissive: '#ffd9a0', emissiveIntensity: 0.1, roughness: 0.3 })
  out.glow.push({ mat: winMat, day: 0.1, night: 2.2 })
  const FH = 15
  for (let i = 0; i < SEC; i++) {
    const a0 = (i / SEC) * Math.PI * 2
    const a1 = ((i + 1) / SEC) * Math.PI * 2
    const am = (a0 + a1) / 2
    if (gate(am)) continue
    const rxm = rx(ROWS) + 1.2
    const rzm = rz(ROWS) + 1.2
    const x = cx + Math.cos(am) * rxm
    const z = cz + Math.sin(am) * rzm
    const dx = (Math.cos(a1) - Math.cos(a0)) * rxm
    const dz = (Math.sin(a1) - Math.sin(a0)) * rzm
    const len = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dz, dx)
    b.box(len + 0.05, FH, 0.9, wall, M(x, CURB + FH / 2, z, yaw), 3)
    if (i % 4 === 0) b.box(1.5, FH + 1.2, 2.2, rib, M(x, CURB + (FH + 1.2) / 2, z, yaw), 3)
    b.box(len + 0.3, 1.2, 1.3, rib, M(x, CURB + FH + 0.4, z, yaw), 3)
    c.physics.fixedBox(x, CURB + FH / 2, z, (len + 0.05) / 2, FH / 2, 0.45, yaw)
    // windows on the outer face, facing away from the field
    const nx = Math.cos(am) / RX
    const nz = Math.sin(am) / RZ
    const nl = Math.hypot(nx, nz)
    const ox = x + (nx / nl) * 0.5
    const oz = z + (nz / nl) * 0.5
    if (i % 2 === 1) for (const y of [4, 9.2]) b.box(len * 0.45, 2.6, 0.12, winMat, M(ox, CURB + y, oz, yaw), 1)
  }
  // the roof: a continuous canopy over the upper rows, white, with a lit lip along its inner edge
  const lip = new THREE.MeshStandardMaterial({ color: '#fff8e6', emissive: '#fff1c8', emissiveIntensity: 0.2 })
  out.glow.push({ mat: lip, day: 0.2, night: 3.5 })
  {
    const pos: number[] = []
    const E = (a: number, rxv: number, rzv: number, y: number) => [cx + Math.cos(a) * rxv, CURB + y, cz + Math.sin(a) * rzv]
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.6, metalness: 0.5 })
    for (let i = 0; i < SEC; i++) {
      const a0 = (i / SEC) * Math.PI * 2
      const a1 = ((i + 1) / SEC) * Math.PI * 2
      const am = (a0 + a1) / 2
      if (west(am)) continue // the pavilion has its own roof
      const r0x = rx(10)
      const r1x = rx(ROWS) + 2.8
      const r0z = rz(10)
      const r1z = rz(ROWS) + 2.8
      // outer edge high, inner lip lower: a cantilever sloping towards the pitch
      const A = E(a0, r1x, r1z, 14.8)
      const B2 = E(a1, r1x, r1z, 14.8)
      const C = E(a1, r0x, r0z, 12.6)
      const D = E(a0, r0x, r0z, 12.6)
      for (const v of [A, B2, C, A, C, D]) pos.push(...v)
      const lx = cx + Math.cos(am) * (r0x - 0.1)
      const lz = cz + Math.sin(am) * (r0z - 0.1)
      b.box(Math.hypot((Math.cos(a1) - Math.cos(a0)) * r0x, (Math.sin(a1) - Math.sin(a0)) * r0z) + 0.04, 0.2, 0.3, lip, M(lx, CURB + 12.45, lz, Math.atan2(-(Math.sin(a1) - Math.sin(a0)) * r0z, (Math.cos(a1) - Math.cos(a0)) * r0x)), 1)
      if (i % 3 === 0) {
        // a steel truss under the roof: a radial beam and a diagonal brace
        const o = new THREE.Vector3(cx + Math.cos(am) * r1x, CURB + 14.3, cz + Math.sin(am) * r1z)
        const q = new THREE.Vector3(cx + Math.cos(am) * r0x, CURB + 12.2, cz + Math.sin(am) * r0z)
        const low = new THREE.Vector3(cx + Math.cos(am) * (r1x - 1), CURB + 10.5, cz + Math.sin(am) * (r1z - 1))
        for (const [p0, p1] of [[o, q], [low, q]] as const) {
          const dir = p1.clone().sub(p0)
          const g = new THREE.BoxGeometry(0.3, 0.3, dir.length())
          b.add(g, dark, new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()), new THREE.Vector3(1, 1, 1)))
        }
      }
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    rg.computeVertexNormals()
    const roofMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.85, side: THREE.DoubleSide }))
    roofMesh.castShadow = roofMesh.receiveShadow = true
    group.add(roofMesh)
  }

  // the pavilion at the west end: a two-storey club house with a balcony, a green roof and a flagpole
  const px = cx - rx(8) - 4
  b.box(14, 9, 20, white, M(px, CURB + 4.5, cz), 3)
  b.box(14.8, 0.6, 20.8, new THREE.MeshStandardMaterial({ color: '#2a6b3d', roughness: 0.8 }), M(px, CURB + 9.3, cz), 3)
  b.box(2.2, 2.0, 16, m.frame, M(px + 7.1, CURB + 5.2, cz), 1)
  for (const dz of [-6, -2, 2, 6]) b.box(0.15, 1.5, 2.2, winMat, M(px + 7.15, CURB + 6.6, cz + dz), 1)
  b.box(0.18, 14, 0.18, m.frame, M(px, CURB + 14.6, cz - 8), 1)
  b.box(3, 1.6, 0.05, new THREE.MeshStandardMaterial({ color: '#1d4fa8' }), M(px + 1.5, CURB + 20.4, cz - 8), 1)
  c.physics.fixedBox(px, CURB + 4.5, cz, 7, 4.5, 10)
  // the sightscreen at the east end
  b.box(0.4, 7, 9, white, M(cx + RX + 3.2, CURB + 3.5, cz), 2)
  b.box(0.3, 0.4, 9.4, m.frame, M(cx + RX + 3.2, CURB + 7.2, cz), 1)
  c.physics.fixedBox(cx + RX + 3.2, CURB + 3.5, cz, 0.3, 3.5, 4.5)

  // floodlight pylons at the four corners; lamp panels glow after dark
  const lamp = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff1c8', emissiveIntensity: 0.3 })
  out.glow.push({ mat: lamp, day: 0.3, night: 6 })
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const fx = cx + sx * 68
    const fz = cz + sz * 64
    const yaw = Math.atan2(-sx, -sz)
    let at = M(fx, CURB, fz, yaw)
    for (let y = 0; y < 36; y += 4) {
      const width = 2.8 - y * 0.043
      for (const a of [-1, 1]) for (const d of [-1, 1]) {
        b.box(0.19, 4.1, 0.19, m.frame, at.clone().multiply(M(a * width / 2, y + 2, d * width / 2)))
        b.box(0.095, Math.hypot(4, width), 0.095, m.frame, at.clone().multiply(M(0, y + 2, d * width / 2)).multiply(new THREE.Matrix4().makeRotationZ(a * Math.atan2(width, 4))))
      }
    }
    at = M(fx, CURB + 37.8, fz, yaw)
    b.box(7.6, 4.2, 0.42, m.frame, at)
    for (let k = -3; k <= 3; k++) for (let j = -1; j <= 1; j++) {
      b.add(new THREE.CylinderGeometry(0.42, 0.48, 0.2, 10).rotateX(Math.PI / 2), lamp, at.clone().multiply(M(k, j * 1.17, 0.28)))
    }
    c.physics.fixedCylinder(fx, CURB + 4, fz, 0.8, 8)
  }
  // a ring of floodlights along the roof edge
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    b.box(0.8, 0.6, 0.5, lamp, M(cx + Math.cos(a) * (rx(ROWS) + 2.6), CURB + 14, cz + Math.sin(a) * (rz(ROWS) + 2.6), -a), 1)
  }
  // scoreboard, names over the gates, ticket booths
  const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshStandardMaterial({ map: labelTexture(['EDEN GARDENS', 'Kolkata · since 1864'], '#07121f', '#ffd23a', 1024, 256, '#1d9bf0'), emissive: '#ffffff', roughness: 0.4, emissiveIntensity: 0.6 }))
  ;(board.material as THREE.MeshStandardMaterial).emissiveMap = (board.material as THREE.MeshStandardMaterial).map
  board.position.set(cx + rx(9) + 3.2, CURB + 9.5, cz)
  board.rotation.y = -Math.PI / 2
  group.add(board)
  for (const s of [-1, 1]) {
    const name = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.6), new THREE.MeshStandardMaterial({ map: labelTexture(['EDEN GARDENS', 'Home of Bengal cricket'], '#0d2f6b', '#ffffff', 1024, 256, '#ffd23a'), roughness: 0.6 }))
    name.position.set(cx, CURB + FH - 1.2, cz + s * (rz(ROWS) + 1.7))
    if (s < 0) name.rotation.y = Math.PI
    group.add(name)
    for (const dx of [-12, 12]) {
      b.box(2.4, 2.6, 1.8, m.frame, M(cx + dx, CURB + 1.3, cz + s * (rz(ROWS) + 4)), 1)
      c.physics.fixedBox(cx + dx, CURB + 1.3, cz + s * (rz(ROWS) + 4), 1.2, 1.3, 0.9)
    }
  }
  const club = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.25), new THREE.MeshStandardMaterial({ map: labelTexture(['DR B. C. ROY CLUB HOUSE'], '#173729', '#ffedc9', 1024, 128) }))
  club.position.set(px + 7.24, CURB + 8.55, cz)
  club.rotation.y = Math.PI / 2
  group.add(club)
  // A compact garden pavilion stands outside the north-east curve of the oval.
  const gx = cx + 69, gz = cz - 78
  const gold = new THREE.MeshStandardMaterial({ color: '#b58b41', metalness: 0.48, roughness: 0.48 })
  b.box(7.2, 0.38, 7.2, m.paving, M(gx, CURB + 0.19, gz))
  for (const dx of [-2.2, 2.2]) for (const dz of [-2.2, 2.2]) {
    b.add(new THREE.CylinderGeometry(0.2, 0.27, 3.3, 10), m.wood, M(gx + dx, CURB + 2, gz + dz))
    c.physics.fixedCylinder(gx + dx, CURB + 2, gz + dz, 0.26, 3.4)
  }
  for (let i = 0; i < 5; i++) {
    const radius = 4.9 - i * 0.88
    const y = CURB + 3.66 + i * 0.92
    b.add(new THREE.CylinderGeometry(radius * 0.48, radius, 0.82, 4).rotateY(Math.PI / 4), m.wood, M(gx, y, gz))
    b.add(new THREE.CylinderGeometry(radius, radius, 0.12, 4).rotateY(Math.PI / 4), gold, M(gx, y - 0.4, gz))
  }
  b.add(new THREE.ConeGeometry(0.42, 1.9, 12), gold, M(gx, CURB + 8.63, gz))
  nightLight(c, cx, CURB, cz, '#e8ffe0', 130, 56)
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    tree(c, cx + sx * 81, cz + sz * 79, 1.2)
  }
}

/* ── the Eastern Bypass ─────────────────────────────────────── */

function highway(c: Ctx) {
  const { b, m, out } = c
  const { x, z0, z1, w } = HIGHWAY
  const len = z1 - z0
  const zc = (z0 + z1) / 2
  const H = 0.05
  const asphalt = m.asphalt
  // two carriageways with shoulders, one wide sheet for each
  const lane = SCALE.lane
  const roadW = lane * 3 + 1.6
  const median = w - roadW * 2
  for (const s of [-1, 1]) {
    const ox = x + s * (median / 2 + roadW / 2)
    const g = new THREE.PlaneGeometry(roadW, len).rotateX(-Math.PI / 2)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * roadW / 6, uv.getY(i) * len / 6)
    b.add(g, asphalt, M(ox, H, zc))
    // edge lines (solid) and lane lines (dashed)
    for (const e of [-1, 1]) b.add(new THREE.PlaneGeometry(0.18, len).rotateX(-Math.PI / 2), m.line, M(ox + e * (roadW / 2 - 0.5), H + 0.01, zc))
    for (const k of [-1, 1]) for (let t = z0 + 6; t < z1 - 6; t += 9) b.add(new THREE.PlaneGeometry(0.15, 4.5).rotateX(-Math.PI / 2), m.line, M(ox + k * (lane / 2), H + 0.01, t + 2.25))
  }
  // median: raised concrete with a planted strip and tall double lamps
  const mh = 0.35
  b.box(median, mh, len - 40, m.concrete, M(x, mh / 2, zc), 2)
  b.box(median - 0.8, 0.04, len - 41, m.grass, M(x, mh + 0.02, zc), 6)
  c.physics.fixedBox(x, mh / 2 + 0.3, zc, median / 2, 0.65, (len - 40) / 2)
  const hw = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd79a', emissiveIntensity: 0.2 })
  out.glow.push({ mat: hw, day: 0.2, night: 5 })
  for (let t = z0 + 25; t < z1 - 20; t += 34) {
    b.box(0.35, 10.5, 0.35, m.frame, M(x, mh + 5.25, t), 1)
    for (const s of [-1, 1]) {
      b.box(3.8, 0.12, 0.12, m.frame, M(x + s * 2.0, mh + 10.3, t), 1)
      b.box(1.0, 0.16, 0.45, hw, M(x + s * 3.8, mh + 10.2, t), 1)
    }
    c.physics.fixedCylinder(x, 2.5, t, 0.3, 5)
  }
  // crash barriers along both outer edges; the west one has gaps where the link roads join
  const off = median / 2 + roadW + 0.3
  const LINKS = [-100, 100, 300]
  const cuts: [number, number][] = []
  let from = z0
  for (const lz of LINKS) {
    cuts.push([from, lz - 8])
    from = lz + 8
  }
  cuts.push([from, z1])
  for (const [a0, a1] of cuts) {
    const l = a1 - a0
    b.box(0.35, 0.8, l, m.concrete, M(x - off, 0.4, (a0 + a1) / 2), 2)
    c.physics.fixedBox(x - off, 0.4, (a0 + a1) / 2, 0.2, 0.4, l / 2)
  }
  b.box(0.35, 0.8, len, m.concrete, M(x + off, 0.4, zc), 2)
  c.physics.fixedBox(x + off, 0.4, zc, 0.2, 0.4, len / 2)
  // link roads from the grid's east edge to the west carriageway
  const gx = 405
  const lx1 = x - median / 2 - roadW + 0.8
  for (const lz of LINKS) {
    const l = lx1 - gx
    const g = new THREE.PlaneGeometry(l, 10).rotateX(-Math.PI / 2)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l / 6, uv.getY(i) * 10 / 6)
    b.add(g, asphalt, M((gx + lx1) / 2, H + 0.005, lz))
    for (let t = gx + 2; t < lx1 - 4; t += 6) b.add(new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), m.line, M(t + 1.5, H + 0.015, lz))
  }
  // a tall avenue of shade trees on both sides
  for (let t = z0 + 10; t < z1 - 10; t += 30) {
    for (const s of [-1, 1]) {
      const px = x + s * (off + 7)
      if (LINKS.some((lz) => Math.abs(t - lz) < 9) && s < 0) continue
      tree(c, px, t + (s > 0 ? 7 : 0), 1.3 + c.r() * 0.4)
    }
  }
}

/** build every district and the highway; returns what the town needs to light and plant them */
/* ── the Victoria Memorial's gardens ───────────────────────── */

function memorialGarden(c: Ctx) {
  const { b, m, group, out, physics } = c
  const marble = m.marble
  const road = new THREE.MeshStandardMaterial({ color: '#d6cdb9', roughness: 0.9 })
  const hedge = new THREE.MeshStandardMaterial({ color: '#2f5a2c', roughness: 1 })
  const bronze = new THREE.MeshStandardMaterial({ color: '#2f3b33', metalness: 0.8, roughness: 0.45 })

  // the lawn, mown in broad stripes
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 8
  const g = cv.getContext('2d')!
  g.fillStyle = '#4c8a3e'
  g.fillRect(0, 0, 32, 8)
  g.fillStyle = '#579a47'
  g.fillRect(32, 0, 32, 8)
  const stripe = new THREE.CanvasTexture(cv)
  stripe.colorSpace = THREE.SRGBColorSpace
  stripe.wrapS = stripe.wrapT = THREE.RepeatWrapping
  const lawnGeo = new THREE.PlaneGeometry(230, 168).rotateX(-Math.PI / 2).translate(0, 0.01, -312)
  planar(lawnGeo, 12)
  const lawn = new THREE.Mesh(lawnGeo, new THREE.MeshStandardMaterial({ map: stripe, roughness: 1 }))
  lawn.receiveShadow = true
  group.add(lawn)

  // paths: a cross axis in front of the building, a ring behind it, and long side walks
  const strip = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0)
    b.box(horizontal ? x1 - x0 : w, 0.05, horizontal ? w : z1 - z0, road, M((x0 + x1) / 2, 0.07, (z0 + z1) / 2), 3)
  }
  strip(-112, -265.5, 112, -258.5, 7)
  strip(-62, -355, 62, -349, 6)
  for (const s of [-1, 1]) {
    strip(s * 62 - 3, -352, s * 62 + 3, -262, 6)
    strip(s * 100 - 2.5, -392, s * 100 + 2.5, -262, 5)
    strip(s * 62, -355, s * 100, -349, 6)
  }

  // clipped hedges along the cross walk and the ring
  for (const s of [-1, 1]) for (const dz of [-4.4, 4.4]) {
    b.box(56, 0.9, 1.2, hedge, M(s * 80, 0.5, -262 + dz), 1)
    physics.fixedBox(s * 80, 0.5, -262 + dz, 28, 0.45, 0.6)
  }
  for (const dz of [-3.9, 3.9]) b.box(110, 0.9, 1.2, hedge, M(0, 0.5, -352 + dz), 1)

  // two fountains
  const water = waterMat()
  out.water.push(water)
  for (const s of [-1, 1]) {
    const fx = s * 50
    const fz = -240
    b.add(new THREE.CylinderGeometry(7.6, 7.8, 0.9, 40), marble, M(fx, 0.45, fz))
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6.9, 40).rotateX(-Math.PI / 2), water)
    pool.position.set(fx, 0.82, fz)
    group.add(pool)
    b.add(new THREE.CylinderGeometry(0.7, 1.1, 2.6, 14), marble, M(fx, 1.9, fz))
    b.add(new THREE.SphereGeometry(1.3, 16, 10), marble, M(fx, 3.5, fz))
    b.add(new THREE.ConeGeometry(0.5, 2.2, 10), marble, M(fx, 5.2, fz))
    physics.fixedCylinder(fx, 0.45, fz, 7.8, 0.9)
    nightLight(c, fx, 0, fz, '#cfe8ff', 40, 26)
  }

  // the Queen's pavilion: a seated bronze figure on a plinth under a marble canopy
  const px = -30
  const pz = -247
  b.box(8, 0.3, 8, marble, M(px, 0.15, pz), 3)
  b.box(3.2, 4, 3.2, marble, M(px, 2.3, pz), 3)
  b.box(1.2, 1.5, 1.0, bronze, M(px, 5.05, pz))
  b.add(new THREE.ConeGeometry(0.95, 1.7, 12), bronze, M(px, 4.9, pz + 0.1))
  b.add(new THREE.SphereGeometry(0.3, 12, 8), bronze, M(px, 6.1, pz))
  b.add(new THREE.CylinderGeometry(0.22, 0.28, 0.25, 10), bronze, M(px, 6.45, pz))
  for (const dx of [-3.4, 3.4]) for (const dz of [-3.4, 3.4]) {
    b.add(new THREE.CylinderGeometry(0.3, 0.36, 6, 12), marble, M(px + dx, 3.3, pz + dz))
    physics.fixedCylinder(px + dx, 3, pz + dz, 0.36, 6)
  }
  b.box(8.4, 0.4, 8.4, marble, M(px, 6.5, pz), 3)
  b.add(new THREE.SphereGeometry(3.6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), marble, M(px, 6.7, pz))
  b.add(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 8), bronze, M(px, 10.9, pz))
  physics.fixedBox(px, 2.3, pz, 1.6, 2.3, 1.6)
  nightLight(c, px, 0, pz, '#ffd9a0', 36, 20)

  // the gate on the avenue, a name board over it, and railings either side
  for (const s of [-1, 1]) {
    solid(c, s * 7.5, 2.6, -228, 1.6, 5.2, 1.6, marble, 0, 3)
    b.add(new THREE.SphereGeometry(0.8, 14, 10), marble, M(s * 7.5, 5.7, -228))
    const len = 102
    const fx = s * (8.8 + len / 2)
    b.box(len, 0.1, 0.1, m.rail, M(fx, 1.2, -228), 1)
    b.box(len, 0.1, 0.1, m.rail, M(fx, 0.35, -228), 1)
    for (let x = 0; x < len; x += 3) b.box(0.07, 1.3, 0.07, m.rail, M(s * (8.8 + x), 0.65, -228), 1)
    physics.fixedBox(fx, 0.7, -228, len / 2, 0.7, 0.15)
  }
  b.box(15, 0.5, 0.8, marble, M(0, 5.4, -228), 3)
  const board = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.7), new THREE.MeshStandardMaterial({ map: labelTexture(['VICTORIA MEMORIAL', 'Museum & gardens · 1921'], '#10261d', '#f6efd9', 1024, 256, '#d8b25a'), roughness: 0.6 }))
  board.position.set(0, 6.4, -227.55)
  group.add(board)

  // trees: a cypress avenue and shade trees round the lawns
  const cypress = new THREE.MeshStandardMaterial({ color: '#1f4a2b', roughness: 0.95 })
  for (const s of [-1, 1]) {
    for (let z = -216; z > -286; z -= 10) {
      b.add(new THREE.ConeGeometry(1.7, 9, 8), cypress, M(s * 24, 4.8, z))
      b.add(new THREE.CylinderGeometry(0.2, 0.3, 1, 6), m.wood, M(s * 24, 0.5, z))
    }
    for (let x = 14; x < 58; x += 11) b.add(new THREE.ConeGeometry(1.6, 8, 8), cypress, M(s * x, 4.4, -343))
  }
  const free = (x: number, z: number) => {
    if (Math.abs(x) < 46 && z > -338 && z < -276) return false
    if (Math.abs(x) < 13) return false
    if (Math.abs(z + 262) < 8 || Math.abs(z + 352) < 7) return false
    if (Math.abs(Math.abs(x) - 62) < 6 || Math.abs(Math.abs(x) - 100) < 5) return false
    for (const s of [-1, 1]) if (Math.hypot(x - s * 50, z + 240) < 11) return false
    return Math.hypot(x - px, z - pz) > 9
  }
  const spots: [number, number][] = []
  for (let z = -386; z < -236; z += 15) for (const s of [-1, 1]) spots.push([s * 112, z])
  for (let x = -100; x <= 100; x += 17) spots.push([x, -390])
  for (let k = 0; k < 90; k++) spots.push([(c.r() - 0.5) * 216, -228 - c.r() * 160])
  for (const [x, z] of spots) if (free(x, z)) tree(c, x, z, 1.0 + c.r() * 0.5)

  // lamps, benches, and a warm pool of light on the monument's forecourt
  for (const x of [-96, -76, -56, 56, 76, 96]) for (const dz of [-1, 1]) lampAt(c, x, -262 + dz * 5.4, x, -262)
  for (const z of [-300, -330, -372]) for (const s of [-1, 1]) lampAt(c, s * 66, z, s * 62, z)
  for (const x of [-88, -66, 66, 88]) {
    bench(c, x, -257.2, 0)
    bench(c, x, -266.8, Math.PI)
  }
  nightLight(c, 0, 0, -262, '#ffe2b0', 90, 56)
  nightLight(c, 0, 0, -286, '#ffe2b0', 70, 46)
}

export function buildDistricts(b: Batch, m: Materials, physics: Physics, fairy: FairyBuffer, group: THREE.Group): DistrictOut {
  const out: DistrictOut = { trees: [], lamps: [], pools: [], glow: [], water: [] }
  const c: Ctx = { b, m, physics, fairy, group, out, r: rng(2468) }
  for (const d of DISTRICTS) {
    if (d.kind === 'lake') lake(c, d.cx, d.cz)
    else if (d.kind === 'stadium') stadium(c, d.cx, d.cz)
    else plaza(c, d.cx, d.cz)
  }
  memorialGarden(c)
  highway(c)
  return out
}
