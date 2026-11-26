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
    // the straight from the previous corner's exit to this corner's entry
    const prevExit = prev.clone().addScaledVector(c.clone().sub(prev).normalize(), r)
    const len = prevExit.distanceTo(t1)
    for (let d = 0; d < len; d += step) {
      const p = prevExit.clone().lerp(t1, d / len)
      out.push(new THREE.Vector3(p.x, 0, p.y))
    }
    const centre = t1.clone().addScaledVector(b, r)
    const turn = Math.atan2(a.cross(b), a.dot(b))
    const start = Math.atan2(t1.y - centre.y, t1.x - centre.x)
    const k = Math.max(6, Math.round(Math.abs(turn) * r / step))
    for (let j = 0; j < k; j++) {
      const angle = start + turn * j / k
      out.push(new THREE.Vector3(centre.x + r * Math.cos(angle), 0, centre.y + r * Math.sin(angle)))
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

  constructor(readonly pts: THREE.Vector3[], readonly closed = true) {
    for (let i = 1; i <= pts.length - (closed ? 0 : 1); i++) this.cum.push(this.cum[i - 1] + pts[i - 1].distanceTo(pts[i % pts.length]))
    this.length = this.cum[this.cum.length - 1]
  }

  /** position and horizontal heading at arc length s (wraps) */
  sample(s: number, out = new THREE.Vector3()) {
    const L = this.length
    s = this.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s))
    let lo = 0
    let hi = this.cum.length - 1
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

/** a long strip along a polyline: the cross-section (lateral offset, height) is swept down the path */
export function sweep(path: THREE.Vector3[], section: [number, number][], closed = true) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let s = 0
  const rows = section.length
  for (let i = 0; i < path.length; i++) {
    if (i > 0) s += path[i].distanceTo(path[i - 1])
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(path.length - 1, i + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    const nx = -dz / l
    const nz = dx / l
    let c = 0
    for (let k = 0; k < rows; k++) {
      const [o, h] = section[k]
      pos.push(path[i].x + nx * o, path[i].y + h, path[i].z + nz * o)
      uv.push(s / 4, c / 4)
      if (k < rows - 1) c += Math.hypot(section[k + 1][0] - o, section[k + 1][1] - h)
    }
  }
  const segs = closed ? rows : rows - 1
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * rows + k
      const b = i * rows + ((k + 1) % rows)
      const c = (i + 1) * rows + k
      const d = (i + 1) * rows + ((k + 1) % rows)
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  const n = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))) n.setXYZ(i, 0, 1, 0)
  return g
}
