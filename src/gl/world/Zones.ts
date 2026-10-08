import { ANCHORS, type StopAnchor } from './Layout'

/* Areas shared by the ground painter, the scenery scatter and the
   physics: where the maidan is, where the paddy fields are, and
   which spots belong to a landmark and must stay clear of trees. */

export type Rect = { x0: number; z0: number; x1: number; z1: number }
export type Ellipse = { x: number; z: number; rx: number; rz: number }
export type Circle = { x: number; z: number; r: number }

const anchor = (id: string) => ANCHORS.find((a) => a.id === id) as StopAnchor

/** world point relative to a stop: `along` the road, `lateral` towards the landmark side */
export function nearStop(id: string, along: number, lateral: number) {
  const a = anchor(id)
  return {
    x: a.pos.x + a.tan.x * along + a.right.x * lateral * a.place.side,
    z: a.pos.z + a.tan.z * along + a.right.z * lateral * a.place.side,
  }
}

export const MAIDAN: Ellipse = { x: 24, z: 6, rx: 21, rz: 14 }
export const PITCH = { x: 24, z: 6, w: 2.6, l: 15 } // runs east-west

export const CITY: Rect = { x0: -26, z0: -36, x1: 68, z1: -23 }

export const PADDY: Rect[] = [
  { x0: -79, z0: -34, x1: -54, z1: -20 },
]

export const TEA: Rect = { x0: -103, z0: -66, x1: -86, z1: -30 }

export const RAMP = { x: 60, z: 2, yaw: 0 }

/** clearance radius around each landmark, kept free of scattered scenery */
const LANDMARK_RADIUS: Record<string, number> = {
  boarding: 13,
  egra: 15,
  neotia: 13,
  'first-jobs': 9,
  xeta: 13,
  picaku: 9,
  lifeapp: 9,
  howrah: 14,
  gobt: 9,
  pizzahap: 10,
  gharkamali: 11,
  altaqwa: 8,
  accurateastro: 9,
  mastermind: 10,
  gftd: 10,
  agile: 11,
  ideashapers: 8,
  fuel: 10,
  'last-stop': 8,
}

export const CLEARINGS: Circle[] = ANCHORS.map((a) => ({ x: a.landmark.x, z: a.landmark.z, r: LANDMARK_RADIUS[a.id] ?? 9 }))

/** billboards stand a little ahead of each project landmark */
export function billboardSpot(a: StopAnchor) {
  const along = 10
  const lateral = a.place.offset - 2
  return {
    x: a.pos.x + a.tan.x * along + a.right.x * lateral * a.place.side,
    z: a.pos.z + a.tan.z * along + a.right.z * lateral * a.place.side,
  }
}

export const inRect = (x: number, z: number, r: Rect, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
export const inEllipse = (x: number, z: number, e: Ellipse, pad = 0) => {
  const dx = (x - e.x) / (e.rx + pad)
  const dz = (z - e.z) / (e.rz + pad)
  return dx * dx + dz * dz < 1
}
export const inCircle = (x: number, z: number, c: Circle, pad = 0) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2

/** true if a scattered tree/bush may grow at (x, z) */
export function isClear(x: number, z: number, pad = 0) {
  if (inEllipse(x, z, MAIDAN, 3 + pad)) return false
  if (inRect(x, z, CITY, 2 + pad)) return false
  if (PADDY.some((p) => inRect(x, z, p, 1.5 + pad))) return false
  if (inRect(x, z, TEA, 1 + pad)) return false
  if (CLEARINGS.some((c) => inCircle(x, z, c, pad))) return false
  if ((x - RAMP.x) ** 2 + (z - RAMP.z) ** 2 < (12 + pad) ** 2) return false
  return true
}
