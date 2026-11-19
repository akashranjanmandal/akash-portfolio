import * as THREE from 'three'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'
import { addFairy, type FairyBuffer } from './Fairy'
import { DISTRICTS, HIGHWAY } from './Plan'
import { SCALE } from '../Scale'
import { rng } from '../../utils/math'

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
export function buildDistricts(b: Batch, m: Materials, physics: Physics, fairy: FairyBuffer, group: THREE.Group): DistrictOut {
  const out: DistrictOut = { trees: [], lamps: [], pools: [], glow: [], water: [] }
  const c: Ctx = { b, m, physics, fairy, group, out, r: rng(2468) }
  for (const d of DISTRICTS) {
    if (d.kind === 'lake') lake(c, d.cx, d.cz)
    else plaza(c, d.cx, d.cz)
  }
  highway(c)
  return out
}
