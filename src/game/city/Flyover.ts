import * as THREE from 'three'
import { roundedLoop, offsetLoop } from './paths'

/* The ring flyover: an elevated road all the way round the city above its outer roads (like Kolkata's Maa
   flyover, but a closed loop), its piers in the middle of the road below. Two ramps join it to the ground:
   one up from the Victoria Memorial road, one down to the north-east corner of the grid. */

export const RING = { y: 9.2, corners: [[-200, -200], [400, -200], [400, 400], [-200, 400]] as [number, number][], r: 24, width: 13 }

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** the ring's centreline, clockwise seen from above (east along the north side) */
export function ringPath() {
  return roundedLoop(RING.corners, RING.r, 4).map((p) => p.setY(RING.y))
}

/** up: from the Memorial road (x = 0) east along z = -216, climbing, then merging into the ring at x = 150 */
export function rampUp() {
  const pts: THREE.Vector3[] = []
  for (let x = -6; x <= 112; x += 4) pts.push(new THREE.Vector3(x, RING.y * smooth((x - 4) / 108), -216))
  for (let k = 1; k <= 10; k++) {
    const t = k / 10
    pts.push(new THREE.Vector3(112 + 38 * t, RING.y, -216 + 16 * smooth(t)))
  }
  return pts
}

/** down: leaving the ring at x = 250, out to z = -216, descending east, then turning south into the grid's corner */
export function rampDown() {
  const pts: THREE.Vector3[] = []
  for (let k = 0; k <= 10; k++) {
    const t = k / 10
    pts.push(new THREE.Vector3(250 + 38 * t, RING.y, -200 - 16 * smooth(t)))
  }
  for (let x = 292; x <= 380; x += 4) pts.push(new THREE.Vector3(x, RING.y * (1 - smooth((x - 288) / 92)), -216))
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 0.5
    pts.push(new THREE.Vector3(380 + 20 * Math.sin(a), 0, -216 + 20 * (1 - Math.cos(a))))
  }
  return pts
}

/** traffic on the ring: one loop each way, each on the left of its own direction */
export function ringTrafficLoops() {
  const cw = ringPath()
  const ccw = ringPath().reverse()
  return [offsetLoop(cw, -2.6), offsetLoop(ccw, -2.6)]
}
