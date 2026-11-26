import * as THREE from 'three'

/* Closed paths for things that go round and round: the ring flyover, the metro, the railway. */

/** a closed loop through the corners, rounded with radius r, sampled every `step` metres (y = 0) */
export function roundedLoop(corners: [number, number][], r: number, step = 4): THREE.Vector3[] {
  const n = corners.length
  const out: THREE.Vector3[] = []
  const P = corners.map(([x, z]) => new THREE.Vector2(x, z))
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n]
    const c = P[i]
    const next = P[(i + 1) % n]
    const a = c.clone().sub(prev).normalize()
    const b = next.clone().sub(c).normalize()
    const t1 = c.clone().addScaledVector(a, -r)
    const t2 = c.clone().addScaledVector(b, r)
    // the straight from the previous corner's exit to this corner's entry
    const prevExit = prev.clone().addScaledVector(c.clone().sub(prev).normalize(), r)
    const len = prevExit.distanceTo(t1)
    for (let d = 0; d < len; d += step) {
      const p = prevExit.clone().lerp(t1, d / len)
      out.push(new THREE.Vector3(p.x, 0, p.y))
    }
    // the bend: a quadratic curve with the corner as its control point
    const k = Math.max(6, Math.round((r * Math.PI) / 2 / step))
    for (let j = 0; j < k; j++) {
      const t = j / k
      const p = t1.clone().multiplyScalar((1 - t) ** 2).add(c.clone().multiplyScalar(2 * t * (1 - t))).add(t2.clone().multiplyScalar(t * t))
      out.push(new THREE.Vector3(p.x, 0, p.y))
    }
  }
  return out
}

/** the unit normal to the right of travel at point i (x east, z south) */
export function sideNormal(pts: THREE.Vector3[], i: number, closed = true) {
  const n = pts.length
  const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
  const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l = Math.hypot(dx, dz) || 1
  return new THREE.Vector2(-dz / l, dx / l)
}

/** shift a loop sideways (positive: to the right of travel) */
export function offsetLoop(pts: THREE.Vector3[], d: number, closed = true) {
  return pts.map((p, i) => {
    const nrm = sideNormal(pts, i, closed)
    return new THREE.Vector3(p.x + nrm.x * d, p.y, p.z + nrm.y * d)
  })
}

/** arc-length lookup along a closed loop */
export class Loop {
  readonly cum: number[] = [0]
  readonly length: number

  constructor(readonly pts: THREE.Vector3[]) {
    for (let i = 1; i <= pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i - 1].distanceTo(pts[i % pts.length]))
    this.length = this.cum[pts.length]
  }

  /** position and horizontal heading at arc length s (wraps) */
  sample(s: number, out = new THREE.Vector3()) {
    const L = this.length
    s = ((s % L) + L) % L
    let lo = 0
    let hi = this.pts.length
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid] <= s) lo = mid
      else hi = mid
    }
    const a = this.pts[lo]
    const b = this.pts[(lo + 1) % this.pts.length]
    const t = (s - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo])
    out.lerpVectors(a, b, t)
    return { p: out, dx: b.x - a.x, dz: b.z - a.z }
  }

  /** arc length of the point nearest to (x, z) */
  nearestS(x: number, z: number) {
    let best = 0
    let bd = Infinity
    this.pts.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return this.cum[best]
  }
}
