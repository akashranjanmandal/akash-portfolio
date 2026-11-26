import { RAIL_RECT, RAIL_RADIUS } from './Plan'
import { roundedLoop } from './paths'

export function suburbanPath() {
  const { x0, x1, z0, z1 } = RAIL_RECT
  const pts = roundedLoop([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], RAIL_RADIUS)
  for (const p of pts) {
    const t = Math.max(0, Math.min(1, Math.min(z1 - p.z, p.z - z0) / 140))
    if (p.x > x1 - RAIL_RADIUS - 5) p.y = 7.8 * t * t * (3 - 2 * t)
  }
  return pts
}
