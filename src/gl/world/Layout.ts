import * as THREE from 'three'
import { STOPS } from '../../content'

/* ──────────────────────────────────────────────────────────────
   LAYOUT
   The island is a rounded rectangle floating in the sky. A river
   runs from a lake in the west interior to the north edge, where it
   pours off the island as a waterfall. One closed road loops around
   the island; the story stops sit along it. Driving direction is
   clockwise when seen from above, so the interior is always on the
   driver's right.
   World axes: x → east, z → south, y → up.
────────────────────────────────────────────────────────────── */

export const ISLAND = { halfX: 105, halfZ: 75, corner: 22, depth: 5 }
export const ROAD_WIDTH = 6.4
export const WATER_LEVEL = -0.9

export const RIVER = {
  width: 10,
  // centreline from the lake to beyond the north edge
  points: [
    new THREE.Vector2(-41, 7),
    new THREE.Vector2(-38, -14),
    new THREE.Vector2(-43, -30),
    new THREE.Vector2(-40, -44),
    new THREE.Vector2(-40, -56.5),
    new THREE.Vector2(-40, -68),
    new THREE.Vector2(-40, -82),
  ],
}
export const LAKE = { x: -42, z: 13, rx: 14, rz: 11 }

const ROAD_POINTS: [number, number][] = [
  [-58, 57], [-78, 54], [-88, 40], [-86, 18], [-88, -6], [-86, -30], [-78, -48],
  [-62, -56.5], [-48, -56.5], [-32, -56.5], [-18, -56.5],
  [6, -55], [32, -58], [58, -55], [78, -46], [88, -26], [87, 0], [89, 22], [82, 42],
  [64, 55], [38, 58], [10, 55], [-14, 58], [-38, 56],
]

export const BRIDGE = { x0: -51, x1: -29, z: -56.5 }

export type StopPlace = {
  /** where the taxi parks (x, z) */
  park: [number, number]
  /** +1 = landmark on the interior (driver's right), -1 = outer side */
  side: 1 | -1
  /** lateral distance of the landmark from the road centre */
  offset: number
  /** shift of the landmark along the road (+ = ahead) */
  along?: number
  shot?: { pos: [number, number, number]; target: [number, number, number]; fov?: number }
}

/* Camera shots are expressed in the stop's local frame:
   [right, up, forward] relative to the parked taxi. */
export const PLACES: Record<string, StopPlace> = {
  boarding: { park: [-50, 57.2], side: 1, offset: 10, along: -2, shot: { pos: [-9, 3.4, 9], target: [4, 1.6, -1], fov: 42 } },
  egra: { park: [-87.6, 38], side: 1, offset: 15 },
  neotia: { park: [-86.4, 12], side: 1, offset: 16, shot: { pos: [-10, 6, -9], target: [7, 3, 3], fov: 48 } },
  'first-jobs': { park: [-87.6, -12], side: 1, offset: 12 },
  xeta: { park: [-85.8, -33], side: -1, offset: 12.5, shot: { pos: [11, 4.5, -10], target: [-6, 5, 2], fov: 52 } },
  picaku: { park: [-74.5, -51], side: -1, offset: 11 },
  lifeapp: { park: [-60, -56.4], side: 1, offset: 11.5, shot: { pos: [-8, 4.2, -15], target: [3, 3.6, 0], fov: 50 } },
  howrah: { park: [-40, -56.5], side: 1, offset: 0, shot: { pos: [25, 4.2, -5], target: [0, 5.5, 0], fov: 50 } },
  gobt: { park: [-6, -55.6], side: -1, offset: 14, shot: { pos: [9, 4, -9], target: [-6, 6, 2], fov: 52 } },
  pizzahap: { park: [20, -56.6], side: 1, offset: 12 },
  gharkamali: { park: [46, -56.8], side: 1, offset: 12 },
  altaqwa: { park: [71, -50.5], side: -1, offset: 12, shot: { pos: [10, 3.2, -8], target: [-6, 4, 2], fov: 48 } },
  accurateastro: { park: [87.7, -12], side: -1, offset: 12.5, shot: { pos: [10, 5, -9], target: [-6, 4.5, 2], fov: 50 } },
  mastermind: { park: [88, 13], side: 1, offset: 12 },
  gftd: { park: [77, 47], side: 1, offset: 11 },
  agile: { park: [50, 57.6], side: -1, offset: 13, shot: { pos: [11, 4, -10], target: [-6, 7, 2], fov: 54 } },
  ideashapers: { park: [22, 56.4], side: 1, offset: 12, shot: { pos: [-10, 3.5, -8], target: [6, 4.5, 2], fov: 50 } },
  fuel: { park: [-6, 57.3], side: -1, offset: 9 },
  'last-stop': { park: [-31, 56.2], side: 1, offset: 9, shot: { pos: [-9, 3.6, -8], target: [5, 1.8, 1.5], fov: 46 } },
}

/* ── road ───────────────────────────────────────────────────── */

export type RoadSample = { pos: THREE.Vector3; tan: THREE.Vector3; right: THREE.Vector3 }

export class Road {
  readonly curve: THREE.CatmullRomCurve3
  readonly length: number
  readonly count = 1600
  readonly points: THREE.Vector3[] = []
  readonly tangents: THREE.Vector3[] = []

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      ROAD_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    )
    this.curve.arcLengthDivisions = 4000
    this.length = this.curve.getLength()
    for (let i = 0; i < this.count; i++) {
      const u = i / this.count
      this.points.push(this.curve.getPointAt(u))
      this.tangents.push(this.curve.getTangentAt(u).setY(0).normalize())
    }
  }

  /** sample at distance d along the loop (wraps) */
  sample(d: number, out?: RoadSample): RoadSample {
    const L = this.length
    const dd = ((d % L) + L) % L
    const f = (dd / L) * this.count
    const i0 = Math.floor(f) % this.count
    const i1 = (i0 + 1) % this.count
    const t = f - Math.floor(f)
    const o = out ?? { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3() }
    o.pos.lerpVectors(this.points[i0], this.points[i1], t)
    o.tan.lerpVectors(this.tangents[i0], this.tangents[i1], t).normalize()
    o.right.set(-o.tan.z, 0, o.tan.x)
    return o
  }

  /** distance along the loop of the road point nearest to (x, z) */
  nearest(x: number, z: number): { d: number; dist: number } {
    let best = Infinity
    let bi = 0
    for (let i = 0; i < this.count; i += 4) {
      const p = this.points[i]
      const dx = p.x - x
      const dz = p.z - z
      const q = dx * dx + dz * dz
      if (q < best) { best = q; bi = i }
    }
    // refine around the coarse hit
    for (let k = -4; k <= 4; k++) {
      const i = (bi + k + this.count) % this.count
      const p = this.points[i]
      const dx = p.x - x
      const dz = p.z - z
      const q = dx * dx + dz * dz
      if (q < best) { best = q; bi = (i + this.count) % this.count }
    }
    return { d: (bi / this.count) * this.length, dist: Math.sqrt(best) }
  }
}

export const road = new Road()

/* ── stops along the road ───────────────────────────────────── */

export type StopAnchor = {
  index: number
  id: string
  /** distance along the story route, 0 at the first stop */
  d: number
  /** absolute distance along the road loop */
  roadD: number
  place: StopPlace
  pos: THREE.Vector3
  tan: THREE.Vector3
  right: THREE.Vector3
  /** world position of the landmark */
  landmark: THREE.Vector3
  /** yaw that makes a landmark face the road */
  faceYaw: number
}

const startD = road.nearest(...PLACES.boarding.park).d

export const ANCHORS: StopAnchor[] = STOPS.map((stop, index) => {
  const place = PLACES[stop.id]
  const roadD = road.nearest(place.park[0], place.park[1]).d
  const d = (((roadD - startD) % road.length) + road.length) % road.length
  const s = road.sample(roadD)
  const along = place.along ?? 0
  const landmark = s.pos.clone()
    .addScaledVector(s.right, place.side * place.offset)
    .addScaledVector(s.tan, along)
  // a landmark on the right faces left (towards the road) and vice versa
  const toRoad = s.right.clone().multiplyScalar(-place.side)
  const faceYaw = Math.atan2(toRoad.x, toRoad.z)
  return { index, id: stop.id, d, roadD, place, pos: s.pos.clone(), tan: s.tan.clone(), right: s.right.clone(), landmark, faceYaw }
})

/** convert a story distance (0 at the first stop) to an absolute road distance */
export const storyToRoad = (d: number) => startD + d

/** story distance of a road distance, in [0, road.length) */
export const roadToStory = (roadD: number) => (((roadD - startD) % road.length) + road.length) % road.length

/* ── island outline and water ───────────────────────────────── */

/** points of a rounded rectangle, clockwise in (x, z) starting at the top-left straight */
export function roundedRect(hx: number, hz: number, r: number, seg = 10): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  const corners: [number, number, number][] = [
    [hx - r, -hz + r, -Math.PI / 2], // NE
    [hx - r, hz - r, 0], // SE
    [-hx + r, hz - r, Math.PI / 2], // SW
    [-hx + r, -hz + r, Math.PI], // NW
  ]
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2)
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r))
    }
  }
  return pts
}

/** smooth river centreline sampled densely */
export const riverCurve = new THREE.SplineCurve(RIVER.points)

/** river bank polylines (west and east), from the lake mouth to past the edge */
export function riverBanks(samples = 80) {
  const west: THREE.Vector2[] = []
  const east: THREE.Vector2[] = []
  for (let i = 0; i <= samples; i++) {
    const u = i / samples
    const p = riverCurve.getPointAt(u)
    const t = riverCurve.getTangentAt(u)
    // left normal (x,z) of a tangent heading north is west
    const n = new THREE.Vector2(t.y, -t.x)
    const w = RIVER.width / 2 + Math.sin(u * 17.0) * 0.35
    west.push(p.clone().addScaledVector(n, w))
    east.push(p.clone().addScaledVector(n, -w))
  }
  return { west, east }
}

export function lakeOutline(seg = 48): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const wobble = 1 + Math.sin(a * 3 + 0.6) * 0.06 + Math.sin(a * 5 + 2) * 0.04
    pts.push(new THREE.Vector2(LAKE.x + Math.cos(a) * LAKE.rx * wobble, LAKE.z + Math.sin(a) * LAKE.rz * wobble))
  }
  return pts
}

/**
 * Island outline with the river and lake cut in as one notch, as a single
 * simple polygon in (x, z). Starts at the river mouth on the north edge and
 * runs clockwise around the island, then down the west bank, around the lake
 * and back up the east bank.
 */
export function islandOutline(): THREE.Vector2[] {
  const { west, east } = riverBanks()
  const edgeZ = -ISLAND.halfZ
  const rim = roundedRect(ISLAND.halfX, ISLAND.halfZ, ISLAND.corner, 12)
  const mouthW = west.reduce((best, p) => (Math.abs(p.y - edgeZ) < Math.abs(best.y - edgeZ) ? p : best)).x
  const mouthE = east.reduce((best, p) => (Math.abs(p.y - edgeZ) < Math.abs(best.y - edgeZ) ? p : best)).x

  const out: THREE.Vector2[] = []
  // north edge from the east bank of the mouth eastwards, then around the island
  out.push(new THREE.Vector2(mouthE, edgeZ))
  const startIdx = rim.findIndex((p) => p.y === edgeZ && p.x > mouthE)
  const n = rim.length
  // rim is clockwise starting at the NE corner; walk it fully, skipping the river mouth span
  for (let k = 0; k < n; k++) {
    const p = rim[(startIdx + k) % n]
    if (Math.abs(p.y - edgeZ) < 1e-6 && p.x > mouthW && p.x < mouthE) continue
    out.push(p)
  }
  out.push(new THREE.Vector2(mouthW, edgeZ))

  // down the west bank (north → south), excluding points beyond the edge or inside the lake
  const westIn = west.filter((p) => p.y > edgeZ + 0.01 && !inLake(p, 1.03)).reverse()
  const eastIn = east.filter((p) => p.y > edgeZ + 0.01 && !inLake(p, 1.03))
  out.push(...westIn)

  // around the lake from the west bank to the east bank, the long way (via the south)
  const lake = lakeOutline(64)
  const wEnd = westIn[westIn.length - 1]
  const eStart = eastIn[0]
  const nearestIdx = (p: THREE.Vector2) => lake.reduce((bi, q, i) => (q.distanceToSquared(p) < lake[bi].distanceToSquared(p) ? i : bi), 0)
  const iw = nearestIdx(wEnd)
  const ie = nearestIdx(eStart)
  // lake points are counter-clockwise in (x,z) screen terms; step so we go via the south side
  const stepDir = pickLakeDirection(lake, iw, ie)
  for (let i = iw; i !== ie; i = (i + stepDir + lake.length) % lake.length) out.push(lake[i])
  out.push(lake[ie])

  // up the east bank (south → north)
  out.push(...eastIn)
  return dedupe(out)
}

function inLake(p: THREE.Vector2, scale = 1) {
  const x = (p.x - LAKE.x) / (LAKE.rx * scale)
  const z = (p.y - LAKE.z) / (LAKE.rz * scale)
  return x * x + z * z < 1
}

function pickLakeDirection(lake: THREE.Vector2[], from: number, to: number): 1 | -1 {
  // walk both ways; take the one passing through the southernmost point
  const walk = (dir: 1 | -1) => {
    let maxZ = -Infinity
    for (let i = from; i !== to; i = (i + dir + lake.length) % lake.length) maxZ = Math.max(maxZ, lake[i].y)
    return maxZ
  }
  return walk(1) > walk(-1) ? 1 : -1
}

function dedupe(pts: THREE.Vector2[]) {
  const out: THREE.Vector2[] = []
  for (const p of pts) if (!out.length || p.distanceToSquared(out[out.length - 1]) > 0.0025) out.push(p)
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) <= 0.0025) out.pop()
  return out
}

/** water polygon (lake + river channel) slightly larger than the cut so it tucks under the banks */
export function waterOutline(): THREE.Vector2[] {
  const { west, east } = riverBanks()
  const grow = 0.8
  const out: THREE.Vector2[] = []
  const westG = west
    .map((p, i) => p.clone().add(p.clone().sub(east[i]).normalize().multiplyScalar(grow)))
    .filter((p) => !inLake(p, 1 + grow / LAKE.rz + 0.03))
  const eastG = east
    .map((p, i) => p.clone().add(p.clone().sub(west[i]).normalize().multiplyScalar(grow)))
    .filter((p) => !inLake(p, 1 + grow / LAKE.rz + 0.03))
  out.push(...westG.slice().reverse())
  const lake = lakeOutline(64).map((p) => {
    const c = new THREE.Vector2(LAKE.x, LAKE.z)
    return p.clone().sub(c).multiplyScalar(1 + grow / LAKE.rx).add(c)
  })
  const wEnd = westG[0]
  const eStart = eastG[0]
  const nearestIdx = (p: THREE.Vector2) => lake.reduce((bi, q, i) => (q.distanceToSquared(p) < lake[bi].distanceToSquared(p) ? i : bi), 0)
  const iw = nearestIdx(wEnd)
  const ie = nearestIdx(eStart)
  const dir = pickLakeDirection(lake, iw, ie)
  for (let i = iw; i !== ie; i = (i + dir + lake.length) % lake.length) out.push(lake[i])
  out.push(lake[ie])
  out.push(...eastG)
  // stop the water at the island lip; the waterfall takes over from there
  const lip = -ISLAND.halfZ - 0.6
  return dedupe(out.map((p) => (p.y < lip ? new THREE.Vector2(p.x, lip) : p)))
}

/** true when (x,z) is on dry land (inside the island and not in the water) */
export function onLand(x: number, z: number, margin = 0): boolean {
  const { halfX, halfZ, corner } = ISLAND
  const ax = Math.abs(x)
  const az = Math.abs(z)
  if (ax > halfX - margin || az > halfZ - margin) return false
  const cx = halfX - corner
  const cz = halfZ - corner
  if (ax > cx && az > cz && Math.hypot(ax - cx, az - cz) > corner - margin) return false
  // lake
  const lx = (x - LAKE.x) / (LAKE.rx + margin + 1.2)
  const lz = (z - LAKE.z) / (LAKE.rz + margin + 1.2)
  if (lx * lx + lz * lz < 1) return false
  // river
  if (z < 4 && z > -halfZ - 10) {
    const rx = riverXAt(z)
    if (rx !== null && Math.abs(x - rx) < RIVER.width / 2 + 1.2 + margin) return false
  }
  return true
}

const riverLUT: { z: number; x: number }[] = []
for (let i = 0; i <= 200; i++) {
  const p = riverCurve.getPointAt(i / 200)
  riverLUT.push({ z: p.y, x: p.x })
}
/** x of the river centreline at a given z (river runs north-south) */
export function riverXAt(z: number): number | null {
  for (let i = 0; i < riverLUT.length - 1; i++) {
    const a = riverLUT[i]
    const b = riverLUT[i + 1]
    if ((z <= a.z && z >= b.z) || (z >= a.z && z <= b.z)) {
      const t = (z - a.z) / (b.z - a.z || 1)
      return a.x + (b.x - a.x) * t
    }
  }
  return null
}

/** distance from (x,z) to the road centreline */
export function roadDistance(x: number, z: number) {
  return road.nearest(x, z).dist
}
