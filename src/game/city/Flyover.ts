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

export const SLIPS = { width: 5.4, entry: [-64, -16], exit: [208, 256] }
const edgeZ = -200 - RING.width / 2
const outsideZ = edgeZ - SLIPS.width / 2

export function rampWidth(x: number, entry: boolean) {
  const [a, b] = entry ? SLIPS.entry : SLIPS.exit
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return SLIPS.width * (entry ? 1 - t : t)
}

export function rampUp() {
  const pts: THREE.Vector3[] = []
  for (let k = 0; k <= 10; k++) {
    const a = k * Math.PI / 20
    pts.push(new THREE.Vector3(-180 - 22.4 * Math.cos(a), 0.09, -193.6 - 22.4 * Math.sin(a)))
  }
  for (let x = -176; x <= SLIPS.entry[1]; x += 4) {
    const z = x < SLIPS.entry[0] ? -216 + (outsideZ + 216) * smooth((x + 104) / 40) : edgeZ - rampWidth(x, true) / 2
    pts.push(new THREE.Vector3(x, 0.09 + (RING.y - 0.09) * smooth((x + 180) / 112), z))
  }
  return pts
}

export function rampDown() {
  const pts: THREE.Vector3[] = []
  for (let x = SLIPS.exit[0]; x <= 380; x += 4) {
    const z = x <= SLIPS.exit[1] ? edgeZ - rampWidth(x, false) / 2 : outsideZ - (outsideZ + 216) * smooth((x - 256) / 40)
    pts.push(new THREE.Vector3(x, 0.09 + (RING.y - 0.09) * (1 - smooth((x - 260) / 120)), z))
  }
  for (let k = 1; k <= 10; k++) {
    const a = k * Math.PI / 20
    pts.push(new THREE.Vector3(380 + 17.6 * Math.sin(a), 0.09, -216 + 17.6 * (1 - Math.cos(a))))
  }
  return pts
}

/** traffic on the ring: one loop each way, each on the left of its own direction */
export function ringTrafficLoops() {
  const cw = ringPath()
  const ccw = ringPath().reverse()
  return [offsetLoop(cw, -2.6), offsetLoop(ccw, -2.6)]
}
