import * as THREE from 'three'

/* The flyover: a road that leaves the grid's north-east junction, curves east, climbs
   over the Eastern Bypass and ends on a round viewing platform. Shared by the
   builder (Transit) and the traffic that drives it. */

export const FLY = { y: 8.5, x0: 240, z: -285, plat: { x: 512, r: 17 }, width: 11 }

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** the centreline from the junction (ground) to the platform (deck height) */
export function flyoverPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let z = -205; z > -245; z -= 4) pts.push(new THREE.Vector3(200, 0, z))
  for (let a = 0; a <= 1.0001; a += 1 / 16) {
    const f = a * Math.PI * 0.5
    pts.push(new THREE.Vector3(240 - 40 * Math.cos(f), 0, -245 - 40 * Math.sin(f)))
  }
  for (let x = FLY.x0 + 4; x <= FLY.plat.x - FLY.plat.r + 2; x += 4) pts.push(new THREE.Vector3(x, FLY.y * smooth((x - FLY.x0) / 110), FLY.z))
  return pts
}

/** a closed loop for traffic: out along one lane, a U-turn on the platform, back on the other, a U-turn at the junction */
export function flyoverLoop(): THREE.Vector3[] {
  const c = flyoverPath()
  const lane = 2.5
  const off = (side: number) =>
    c.map((p, i) => {
      const a = c[Math.max(0, i - 1)]
      const b = c[Math.min(c.length - 1, i + 1)]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const l = Math.hypot(dx, dz) || 1
      // left of travel is (-dz, dx)/l
      return new THREE.Vector3(p.x + (-dz / l) * lane * side, p.y, p.z + (dx / l) * lane * side)
    })
  const out = off(1)
  const back = off(1).reverse() // the same left offset while travelling the other way is the opposite lane
  const back2 = c.map((p, i) => {
    const a = c[Math.max(0, i - 1)]
    const b = c[Math.min(c.length - 1, i + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    return new THREE.Vector3(p.x + (-dz / l) * -lane, p.y, p.z + (dx / l) * -lane)
  }).reverse()
  void back
  const loop: THREE.Vector3[] = [...out]
  const e = out[out.length - 1]
  const f = back2[0]
  // U-turn on the platform
  for (let k = 1; k < 8; k++) {
    const t = (k / 8) * Math.PI
    const mx = (e.x + f.x) / 2
    const mz = (e.z + f.z) / 2
    const r = Math.hypot(e.x - f.x, e.z - f.z) / 2
    loop.push(new THREE.Vector3(mx + Math.sin(t) * (r + 6), e.y, mz + Math.cos(t) * r * (e.z > f.z ? 1 : -1)))
  }
  loop.push(...back2)
  return loop
}
