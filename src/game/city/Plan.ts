import { rng } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   TOWN PLAN (metres, y up, -z = north)
   A grid of streets every 100 m. Each portfolio stop owns a block
   and faces the street named in `face`. Everything else in a block
   is filled with ordinary town buildings and greenery.
────────────────────────────────────────────────────────────── */

export const GRID = [-200, -100, 0, 100, 200, 300, 400]
/** the suburban railway circuit (double track, the near track is at the rectangle's edge): Howrah in the west, Sealdah in the south */
export const RAIL_RECT = { x0: -396, x1: 418, z0: -400, z1: 456 }
/** where the circuit crosses the Hooghly (z ranges of the two rail bridges) */
export const RAIL_GAPS: [number, number][] = [[-416, -392], [447, 471]]
/** distance from (x, z) to the railway corridor (the outline of the circuit) */
export function railDist(x: number, z: number) {
  const cx = (RAIL_RECT.x0 + RAIL_RECT.x1) / 2
  const cz = (RAIL_RECT.z0 + RAIL_RECT.z1) / 2
  return Math.abs(Math.max(Math.abs(x - cx) - (RAIL_RECT.x1 - RAIL_RECT.x0) / 2, Math.abs(z - cz) - (RAIL_RECT.z1 - RAIL_RECT.z0) / 2))
}
/** the riverside ghat on the east bank of the Hooghly (the embankment is cut for its steps) */
export const GHAT = { z0: 150, z1: 230 }
export const ROAD_W = 10
export const WALK_W = 3.5
/** the paved town: streets run to the west bank (x = -200) and out east and south to 400 */
export const TOWN_RECT = { x0: -210, x1: 410, z0: -210, z1: 410 }
export const inTown = (x: number, z: number, pad = 0) => x > TOWN_RECT.x0 - pad && x < TOWN_RECT.x1 + pad && z > TOWN_RECT.z0 - pad && z < TOWN_RECT.z1 + pad

export type Face = 'n' | 's' | 'e' | 'w'

export type Plot = {
  id: string
  /** block centre */
  cx: number
  cz: number
  /** which street the landmark fronts */
  face: Face
  /** footprint of the landmark building (along the street × depth) */
  w: number
  d: number
}

export const PLOTS: Plot[] = [
  { id: 'home', cx: -50, cz: 150, face: 'n', w: 80, d: 80 },
  { id: 'egra', cx: -150, cz: 150, face: 'n', w: 34, d: 16 },
  { id: 'neotia', cx: -150, cz: 50, face: 'e', w: 44, d: 22 },
  { id: 'first-jobs', cx: -150, cz: -50, face: 'e', w: 22, d: 16 },
  { id: 'xeta', cx: -150, cz: -150, face: 'e', w: 32, d: 22 },
  { id: 'picaku', cx: -150, cz: -150, face: 's', w: 14, d: 12 },
  { id: 'lifeapp', cx: -150, cz: -150, face: 'n', w: 14, d: 12 },
  { id: 'pizzahap', cx: -50, cz: -150, face: 's', w: 20, d: 16 },
  { id: 'gobt', cx: 50, cz: -150, face: 's', w: 80, d: 80 },
  { id: 'gharkamali', cx: 150, cz: -150, face: 'w', w: 30, d: 22 },
  { id: 'altaqwa', cx: 150, cz: -50, face: 'w', w: 18, d: 14 },
  { id: 'accurateastro', cx: 150, cz: 50, face: 'w', w: 22, d: 22 },
  { id: 'mastermind', cx: 150, cz: 150, face: 'w', w: 28, d: 16 },
  { id: 'gftd', cx: 50, cz: 150, face: 'n', w: 22, d: 16 },
  { id: 'agile', cx: 50, cz: 50, face: 'n', w: 28, d: 20 },
  { id: 'ideashapers', cx: 50, cz: -50, face: 's', w: 20, d: 16 },
  { id: 'fuel', cx: -50, cz: -50, face: 's', w: 30, d: 20 },
  { id: 'last-stop', cx: -50, cz: 50, face: 'n', w: 20, d: 14 },
]

/** half the size of a block's buildable area (inside the sidewalks) */
export const BLOCK_HALF = 50 - ROAD_W / 2 - WALK_W

const FACE_DIR: Record<Face, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }

/** world-space frame of a plot: origin at the front-centre of the footprint on the property line, +z towards the street */
export function plotFrame(p: Plot) {
  const [fx, fz] = FACE_DIR[p.face]
  const ox = p.cx + fx * BLOCK_HALF
  const oz = p.cz + fz * BLOCK_HALF
  // rotation that maps local +z onto the facing direction
  const yaw = Math.atan2(fx, fz)
  return { x: ox, z: oz, yaw, fx, fz }
}

/** world point from plot-local coordinates (x along the street, z towards the street) */
export function plotToWorld(p: Plot, lx: number, lz: number) {
  const f = plotFrame(p)
  const c = Math.cos(f.yaw)
  const s = Math.sin(f.yaw)
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c }
}

export const SPAWN = (() => {
  const home = PLOTS[0]
  // inside the compound by the gate, looking at the garage
  const p = plotToWorld(home, 4, -3)
  const g = plotToWorld(home, 20, -15)
  const dx = g.x - p.x
  const dz = g.z - p.z
  return { x: p.x, z: p.z, yaw: Math.atan2(-dx, -dz) }
})()

/** famous places that aren't portfolio stops but deserve a waypoint */
export const SIGHTS = [
  { id: 'howrah', label: 'Howrah Bridge', sub: 'Across the Hooghly', x: -232, z: 9 },
  { id: 'station', label: 'Howrah Station', sub: 'The other bank', x: -355, z: 0 },
  { id: 'memorial', label: 'Victoria Memorial', sub: 'White marble, since 1921', x: 0, z: -250 },
  { id: 'sarobar', label: 'Rabindra Sarobar', sub: 'Lakeside promenade', x: 250, z: 50 },
  { id: 'minar', label: 'Shaheed Minar Plaza', sub: 'Pedestrian esplanade', x: 250, z: -50 },
  { id: 'bypass', label: 'Eastern Bypass', sub: 'The highway', x: 450, z: 100 },
  { id: 'eden', label: 'Eden Gardens', sub: 'The cricket cathedral', x: 150, z: 250 },
  { id: 'sealdah', label: 'Sealdah terminal', sub: 'Suburban trains · level crossing', x: 135, z: 436 },
  { id: 'esplanade', label: 'Esplanade metro', sub: 'Kolkata Metro, on the viaduct', x: 0, z: 100 },
  { id: 'ghat', label: 'Hooghly Ghat', sub: 'Steps to the river · ferries', x: -217, z: 190 },
  { id: 'flyover', label: 'Ring flyover', sub: 'High road round the whole city · ramp at the NW corner', x: -200, z: -204 },
]

/** the Eastern Bypass: a divided highway running north-south beyond the east edge of the grid */
export const HIGHWAY = { x: 450, z0: -500, z1: 415, w: 31 }

/** special blocks that are not lined with shop-houses (block centres on the grid) */
export type DistrictKind = 'lake' | 'plaza' | 'stadium'
export const DISTRICTS: { id: string; kind: DistrictKind; cx: number; cz: number; label: string; sub: string }[] = [
  { id: 'sarobar', kind: 'lake', cx: 250, cz: 50, label: 'Rabindra Sarobar', sub: 'Lakeside promenade' },
  { id: 'minar', kind: 'plaza', cx: 250, cz: -50, label: 'Shaheed Minar Plaza', sub: 'Pedestrian esplanade' },
  { id: 'eden', kind: 'stadium', cx: 150, cz: 250, label: 'Eden Gardens', sub: 'The cricket cathedral' },
]
export const districtAt = (x: number, z: number) => DISTRICTS.find((d) => Math.abs(x - d.cx) < 50 && Math.abs(z - d.cz) < 50)

/* ── narrow lanes ───────────────────────────────────────────── */

export type Lane = { pts: { x: number; z: number }[]; cum: number[]; len: number }

/**
 * Through-lanes: in every other block a narrow winding lane cuts from one street to the neighbouring one,
 * lined with small houses. They always connect two streets, so none is a dead end.
 */
export const LANES: Lane[] = (() => {
  const r = rng(4242)
  const occ = PLOTS.map((p) => {
    const f = plotFrame(p)
    return { x: f.x - (f.fx * p.d) / 2, z: f.z - (f.fz * p.d) / 2, r: Math.max(p.w, p.d) / 2 + 8 }
  })
  const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
  const out: Lane[] = []
  for (let i = 0; i < GRID.length - 1; i++) {
    for (let j = 0; j < GRID.length - 1; j++) {
      const cx = (GRID[i] + GRID[i + 1]) / 2
      const cz = (GRID[j] + GRID[j + 1]) / 2
      if (districtAt(cx, cz) || (i + j) % 2) continue
      const e1 = Math.floor(r() * 4)
      const e2 = (e1 + (r() < 0.5 ? 1 : 3)) % 4
      const [d1x, d1z] = dirs[e1]
      const [d2x, d2z] = dirs[e2]
      const o1 = (r() - 0.5) * 24
      const o2 = (r() - 0.5) * 24
      const R = BLOCK_HALF + WALK_W
      const s = { x: cx + d1x * R - d1z * o1, z: cz + d1z * R + d1x * o1 }
      const e = { x: cx + d2x * R - d2z * o2, z: cz + d2z * R + d2x * o2 }
      const c = { x: cx + (r() - 0.5) * 16, z: cz + (r() - 0.5) * 16 }
      const pts: { x: number; z: number }[] = []
      for (let k = 0; k <= 20; k++) {
        const t = k / 20
        pts.push({ x: (1 - t) ** 2 * s.x + 2 * t * (1 - t) * c.x + t * t * e.x, z: (1 - t) ** 2 * s.z + 2 * t * (1 - t) * c.z + t * t * e.z })
      }
      if (pts.some((p) => occ.some((o) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < (o.r + 4) ** 2))) continue
      const cum = [0]
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z))
      out.push({ pts, cum, len: cum[cum.length - 1] })
    }
  }
  return out
})()

/** distance from (x, z) to the nearest lane centreline sample */
export function laneDist(x: number, z: number) {
  let best = Infinity
  for (const l of LANES) for (const p of l.pts) best = Math.min(best, Math.hypot(p.x - x, p.z - z))
  return best
}
