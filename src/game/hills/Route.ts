import * as THREE from 'three'
import { clamp, lerp, noise2 } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   THE HILL ROAD
   Local coordinates (metres): +x east, -z north. The region lives
   far from the city in world space (HILLS_Z), reached by tunnel.

   A ridge runs north: the road starts on the plain, climbs the
   west flank in hairpins that narrow from 12 m to 5 m, then runs
   along the crest to the Sandakphu viewpoint. Beyond it a snowy
   trail follows the crest towards the Kanchenjunga base camp.
────────────────────────────────────────────────────────────── */

/** world z of local z = 0 */
export const HILLS_Z = -9000
export const VIEW_Y = 520 // altitude of the viewpoint (local metres, exaggerated vertically)
export const VIEW = { x: 0, z: -1500 }
export const BASECAMP = { x: 10, z: -2850 }
export const SUMMIT = { x: -6, z: -3200 }
export const START = { x: -1100, z: -120 }
/** the bounds of the region's terrain */
export const HB = { x0: -1750, x1: 800, z0: -3350, z1: 250 }

const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export type RoutePoint = { x: number; z: number; y: number; s: number; w: number; nx: number; nz: number }

const DX = 100
const LEGS = 11
const X0 = START.x
const ZS = -300
const ZN = -820

/** the centreline: a straight from the tunnel, 11 legs with hairpins, then the crest road to the viewpoint */
function centreline(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  for (let z = START.z; z > ZS; z -= 3) pts.push(new THREE.Vector2(X0, z))
  for (let k = 0; k < LEGS; k++) {
    const x = X0 + DX * k
    const north = k % 2 === 0
    const z0 = north ? ZS : ZN
    const z1 = north ? ZN : ZS
    const dir = north ? -1 : 1
    for (let z = z0; north ? z > z1 : z < z1; z += dir * 3) pts.push(new THREE.Vector2(x, z))
    if (k < LEGS - 1) {
      const cx = x + DX / 2
      const r = DX / 2
      for (let a = 0; a <= 1.0001; a += 1 / 14) {
        const phi = a * Math.PI
        pts.push(new THREE.Vector2(cx - r * Math.cos(phi), z1 + dir * r * Math.sin(phi)))
      }
    }
  }
  // the crest road: gentle curves along the ridge to the viewpoint
  const last = pts[pts.length - 1]
  const crest = new THREE.CatmullRomCurve3(
    [new THREE.Vector3(last.x, 0, last.y), new THREE.Vector3(-110, 0, -950), new THREE.Vector3(-45, 0, -1100), new THREE.Vector3(8, 0, -1260), new THREE.Vector3(22, 0, -1400), new THREE.Vector3(VIEW.x - 6, 0, VIEW.z + 22)],
    false,
    'centripetal',
  )
  const len = crest.getLength()
  for (let d = 3; d < len; d += 3) {
    const p = crest.getPointAt(d / len)
    pts.push(new THREE.Vector2(p.x, p.z))
  }
  return pts
}

/** densified centreline with arc length, width, and altitude */
export const ROUTE: RoutePoint[] = (() => {
  const c = centreline()
  const out: RoutePoint[] = []
  let s = 0
  for (let i = 0; i < c.length; i++) {
    if (i > 0) s += c[i].distanceTo(c[i - 1])
    out.push({ x: c[i].x, z: c[i].y, y: 0, s, w: 0, nx: 0, nz: 0 })
  }
  const L = s
  for (let i = 0; i < out.length; i++) {
    const p = out[i]
    p.y = VIEW_Y * Math.min(1, p.s / (L - 40))
    p.w = lerp(12, 5, sstep(0, 0.95, p.s / L))
    const a = out[Math.max(0, i - 1)]
    const b = out[Math.min(out.length - 1, i + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    p.nx = -dz / l // left of travel
    p.nz = dx / l
  }
  return out
})()
export const ROUTE_LENGTH = ROUTE[ROUTE.length - 1].s

/* ── nearest-point lookup so the terrain can be cut and filled around the road ── */
const CELL = 32
const bucket = new Map<string, number[]>()
ROUTE.forEach((p, i) => {
  const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
  let a = bucket.get(k)
  if (!a) bucket.set(k, (a = []))
  a.push(i)
})

export function nearestRoute(x: number, z: number, reach = 2) {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  let best = -1
  let bd = Infinity
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const a = bucket.get(`${cx + i},${cz + j}`)
      if (!a) continue
      for (const idx of a) {
        const p = ROUTE[idx]
        const d = (p.x - x) ** 2 + (p.z - z) ** 2
        if (d < bd) {
          bd = d
          best = idx
        }
      }
    }
  }
  return best < 0 ? null : { p: ROUTE[best], d: Math.sqrt(bd) }
}

/* ── the land ───────────────────────────────────────────────── */

const fbm = (x: number, z: number) => noise2(x * 0.004, z * 0.004) * 0.55 + noise2(x * 0.012 + 7, z * 0.012) * 0.3 + noise2(x * 0.04, z * 0.04) * 0.15

function crestHeight(lz: number) {
  return lz > -1500 ? VIEW_Y : VIEW_Y + 380 * sstep(0, 1, (-1500 - lz) / 1600)
}

/** the mountain without the road: a ridge, a gentle west flank, a deep east valley */
function baseHeight(lx: number, lz: number) {
  const ramp = sstep(0, 1, (-lz - 150) / 150)
  const Hc = crestHeight(lz)
  let prof: number
  if (lx < 0) prof = Math.max(0, Hc - (VIEW_Y / (-START.x - 40)) * Math.max(0, -lx - 40))
  else prof = Math.max(-240, Hc - 1.4 * Math.max(0, lx - 40))
  if (lx > 350) prof += sstep(350, 650, lx) * 420
  prof += sstep(-3050, -3300, lz) * 500
  let h = prof * ramp
  // beyond the playable ground the land climbs into snow-capped ranges: tall to the west, north and south, lower to the east so the Himalaya stay in view
  const od = Math.hypot(Math.max(HB.x0 - lx, 0, lx - HB.x1), Math.max(HB.z0 - lz, 0, lz - HB.z1))
  if (od > 0) {
    const f = sstep(0, 1100, od)
    const side = lx > HB.x1 ? 0.4 : lz > HB.z1 ? 0.7 : 1
    // broad massifs with a few ridges: rounded like real mountains, not spikes
    const m = noise2(lx * 0.0011 + 3, lz * 0.0011 - 2) * 0.6 + noise2(lx * 0.0032, lz * 0.0032 + 5) * 0.3 + noise2(lx * 0.009 + 1, lz * 0.009) * 0.1
    const ridge = 1 - Math.abs(noise2(lx * 0.0022 + 8, lz * 0.0022) * 2 - 1)
    h += f * side * (300 + 1150 * (0.72 * m + 0.28 * ridge * ridge))
  }
  // rock and ridges: relief grows with altitude
  const amp = 8 + 60 * clamp(h / 700)
  h += (fbm(lx, lz) - 0.5) * amp * ramp
  // high up the mountain breaks into ridges and crags
  const crag = 1 - Math.abs(noise2(lx * 0.018 + 3, lz * 0.018 - 9) * 2 - 1)
  const crag2 = 1 - Math.abs(noise2(lx * 0.05, lz * 0.05 + 4) * 2 - 1)
  h += (crag * 46 + crag2 * 14) * clamp((h - 430) / 260) * ramp
  return h
}

/** the mountain without the road: valid anywhere, including the far ranges beyond the playable ground */
export const outerHeight = (lx: number, lz: number) => baseHeight(lx, lz)

export function terrainHeight(lx: number, lz: number) {
  return terrainSample(lx, lz)[0]
}

/** [height, road weight]: the weight is 1 on the road and fades to 0 across the cut and fill banks */
export function terrainSample(lx: number, lz: number): [number, number] {
  let h = baseHeight(lx, lz)
  let rw = 0
  // a flat apron around the viewpoint
  const dv = Math.hypot(lx - VIEW.x, lz - VIEW.z)
  const wv = 1 - sstep(26, 80, dv)
  if (wv > 0) h = lerp(h, VIEW_Y - 0.35, wv)
  // cut and fill around the road
  const n = nearestRoute(lx, lz)
  if (n) {
    const d = n.d - n.p.w / 2
    // a flat bench for the road and a long, gentle bank: the cut blends into the mountain over 55 m
    const t0 = clamp((d - 2.5) / 55)
    const w = 1 - t0 * t0 * t0 * (t0 * (t0 * 6 - 15) + 10)
    if (w > 0) h = lerp(h, n.p.y - 0.35, w)
    rw = w
  }
  const wv2 = 1 - sstep(26, 80, dv)
  return [h, Math.max(rw, wv2)]
}

/** the terrain sampled once on a grid: used for the mesh, the physics heightfield, and placing things */
export class HeightGrid {
  readonly nx: number
  readonly nz: number
  readonly h: Float32Array // [j * (nz + 1) + i], j along x, i along z (the layout Rapier wants)
  /** 1 on the road corridor and the viewpoint apron, 0 elsewhere: no micro-relief where it is flat on purpose */
  readonly road: Float32Array

  constructor(readonly res: number) {
    this.nx = Math.round((HB.x1 - HB.x0) / res)
    this.nz = Math.round((HB.z1 - HB.z0) / res)
    this.h = new Float32Array((this.nx + 1) * (this.nz + 1))
    this.road = new Float32Array((this.nx + 1) * (this.nz + 1))
    for (let j = 0; j <= this.nx; j++) {
      for (let i = 0; i <= this.nz; i++) {
        const [h, w] = terrainSample(HB.x0 + j * res, HB.z0 + i * res)
        this.h[j * (this.nz + 1) + i] = h
        this.road[j * (this.nz + 1) + i] = w
      }
    }
  }

  at(lx: number, lz: number) {
    return this.sample(this.h, lx, lz)
  }

  roadAt(lx: number, lz: number) {
    return this.sample(this.road, lx, lz)
  }

  private sample(arr: Float32Array, lx: number, lz: number) {
    const fx = clamp((lx - HB.x0) / this.res, 0, this.nx - 0.001)
    const fz = clamp((lz - HB.z0) / this.res, 0, this.nz - 0.001)
    const j = Math.floor(fx)
    const i = Math.floor(fz)
    const u = fx - j
    const v = fz - i
    const w = this.nz + 1
    const a = arr[j * w + i]
    const b = arr[(j + 1) * w + i]
    const c = arr[j * w + i + 1]
    const d = arr[(j + 1) * w + i + 1]
    return lerp(lerp(a, b, u), lerp(c, d, u), v)
  }
}
