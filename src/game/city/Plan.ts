/* ──────────────────────────────────────────────────────────────
   TOWN PLAN (metres, y up, -z = north)
   A grid of streets every 100 m. Each portfolio stop owns a block
   and faces the street named in `face`. Everything else in a block
   is filled with ordinary town buildings and greenery.
────────────────────────────────────────────────────────────── */

export const GRID = [-200, -100, 0, 100, 200]
export const ROAD_W = 10
export const WALK_W = 3.5
export const TOWN = 240 // half-size of the paved town

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
  { id: 'home', cx: -50, cz: 150, face: 'n', w: 26, d: 18 },
  { id: 'egra', cx: -150, cz: 150, face: 'n', w: 34, d: 16 },
  { id: 'neotia', cx: -150, cz: 50, face: 'e', w: 44, d: 22 },
  { id: 'first-jobs', cx: -150, cz: -50, face: 'e', w: 22, d: 16 },
  { id: 'xeta', cx: -150, cz: -150, face: 'e', w: 32, d: 22 },
  { id: 'picaku', cx: -150, cz: -150, face: 's', w: 14, d: 12 },
  { id: 'lifeapp', cx: -150, cz: -150, face: 'n', w: 14, d: 12 },
  { id: 'pizzahap', cx: -50, cz: -150, face: 's', w: 20, d: 16 },
  { id: 'gobt', cx: 50, cz: -150, face: 's', w: 26, d: 26 },
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
  const p = plotToWorld(home, -6, 6)
  return { x: p.x, z: p.z, yaw: Math.PI } // looking north, away from the garage
})()
