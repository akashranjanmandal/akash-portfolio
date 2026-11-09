import * as THREE from 'three'
import { RAPIER, type Physics } from './Physics'
import { ambassador, type Ambassador } from './Ambassador'
import { GRID, ROAD_W } from './city/Plan'
import { rng } from '../utils/math'

/* ──────────────────────────────────────────────────────────────
   TRAFFIC
   Yellow Ambassador taxis lapping blocks of the grid, keeping to
   the left as in India. They brake for the player, for other
   traffic and for the tram, then carry on.
────────────────────────────────────────────────────────────── */

const LANE = 2.0 // metres left of the road centreline
const CRUISE = 9

type Driver = {
  car: Ambassador
  body: RAPIER.RigidBody
  path: THREE.Vector3[] // dense loop of lane points
  dist: number[] // cumulative distance
  length: number
  s: number
  speed: number
  stuck: number
}

/** a rounded rectangle loop through four junctions, driven anticlockwise on the left lane */
function loopPath(x0: number, z0: number, x1: number, z1: number) {
  // corners in driving order (anticlockwise seen from above with -z north: E along south edge… )
  const corners = [new THREE.Vector2(x0, z1), new THREE.Vector2(x1, z1), new THREE.Vector2(x1, z0), new THREE.Vector2(x0, z0)]
  const pts: THREE.Vector3[] = []
  const R = 7
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    const dir = b.clone().sub(a).normalize()
    // left of the heading: (dz, -dx)
    const left = new THREE.Vector2(dir.y, -dir.x)
    const off = left.multiplyScalar(LANE)
    const start = a.clone().add(off).addScaledVector(dir, R)
    const end = b.clone().add(off).addScaledVector(dir, -R)
    const len = start.distanceTo(end)
    for (let t = 0; t < len; t += 2) {
      const p = start.clone().addScaledVector(dir, t)
      pts.push(new THREE.Vector3(p.x, 0, p.y))
    }
    // rounded turn into the next leg
    const c = corners[(i + 2) % 4]
    const dir2 = c.clone().sub(b).normalize()
    const left2 = new THREE.Vector2(dir2.y, -dir2.x).multiplyScalar(LANE)
    const p0 = end
    const p2 = b.clone().add(left2).addScaledVector(dir2, R)
    const ctrl = b.clone().add(off).add(left2)
    for (let k = 0; k <= 6; k++) {
      const t = k / 6
      const q = p0.clone().multiplyScalar((1 - t) ** 2).add(ctrl.clone().multiplyScalar(2 * t * (1 - t))).add(p2.clone().multiplyScalar(t * t))
      pts.push(new THREE.Vector3(q.x, 0, q.y))
    }
  }
  return pts
}

export class Traffic {
  readonly group = new THREE.Group()
  private drivers: Driver[] = []
  private parked: Ambassador[] = []
  private readonly tmp = new THREE.Vector3()
  private poolMat = (() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 128
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(32, 120, 4, 32, 70, 70)
    grd.addColorStop(0, 'rgba(255,240,210,0.9)')
    grd.addColorStop(1, 'rgba(255,240,210,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 128)
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 })
  })()

  constructor(physics: Physics, count: number) {
    const r = rng(1234)
    const lines = GRID
    for (let i = 0; i < count; i++) {
      // pick a rectangle of 1 or 2 blocks
      const ix = Math.floor(r() * (lines.length - 1))
      const iz = Math.floor(r() * (lines.length - 1))
      const wx = Math.min(lines.length - 1 - ix, 1 + Math.floor(r() * 2))
      const wz = Math.min(lines.length - 1 - iz, 1 + Math.floor(r() * 2))
      const path = loopPath(lines[ix], lines[iz], lines[ix + wx], lines[iz + wz])
      const dist = [0]
      for (let k = 1; k <= path.length; k++) dist.push(dist[k - 1] + path[k - 1].distanceTo(path[k % path.length]))
      const car = ambassador()
      this.group.add(car.model)
      // a soft pool of headlight on the road ahead, only after dark
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9).rotateX(-Math.PI / 2), this.poolMat)
      pool.position.set(0, 0.05, -6.6)
      pool.renderOrder = 1
      car.model.add(pool)
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.7, 2.2).setTranslation(0, 0.8, 0), body)
      const length = dist[path.length]
      this.drivers.push({ car, body, path, dist, length, s: r() * length, speed: CRUISE * r(), stuck: 0 })
    }
  }

  /** parked Ambassadors along the kerbs */
  park(spots: [number, number, number][], physics: Physics) {
    for (const [x, z, yaw] of spots) {
      const car = ambassador()
      car.model.position.set(x, 0.02, z)
      car.model.rotation.y = yaw
      this.group.add(car.model)
      this.parked.push(car)
      physics.fixedBox(x, 0.8, z, 0.85, 0.8, 2.2, yaw)
    }
  }

  private sample(d: Driver, s: number, out: THREE.Vector3) {
    let lo = 0
    let hi = d.path.length
    s = ((s % d.length) + d.length) % d.length
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (d.dist[mid] <= s) lo = mid
      else hi = mid
    }
    const a = d.path[lo]
    const b = d.path[(lo + 1) % d.path.length]
    const t = (s - d.dist[lo]) / Math.max(1e-6, d.dist[lo + 1] - d.dist[lo])
    return out.lerpVectors(a, b, t)
  }

  update(dt: number, player: THREE.Vector3, others: THREE.Vector3[], night: number) {
    const ahead = new THREE.Vector3()
    const pos = new THREE.Vector3()
    for (const d of this.drivers) {
      this.sample(d, d.s, pos)
      this.sample(d, d.s + 3, ahead)
      const fwd = ahead.clone().sub(pos).normalize()
      // is anything in the lane just ahead?
      let block = false
      const check = (p: THREE.Vector3, range: number) => {
        const rel = this.tmp.copy(p).sub(pos)
        rel.y = 0
        const along = rel.dot(fwd)
        const side = Math.abs(rel.x * fwd.z - rel.z * fwd.x)
        if (along > 1.5 && along < range && side < 2.4) block = true
      }
      check(player, 9)
      for (const o of others) check(o, 9)
      if (d.stuck < 3) for (const e of this.drivers) if (e !== d) check(e.car.model.position, 8)
      const target = block ? 0 : CRUISE
      d.speed += (target - d.speed) * Math.min(1, dt * (block ? 4 : 0.8))
      d.stuck = block && d.speed < 0.3 ? d.stuck + dt : 0
      if (d.stuck > 6) d.stuck = 0
      d.s += d.speed * dt
      this.sample(d, d.s, pos)
      d.car.model.position.copy(pos).setY(0.02)
      // model nose is -Z
      d.car.model.rotation.y = Math.atan2(-fwd.x, -fwd.z)
      d.body.setNextKinematicTranslation({ x: pos.x, y: 0, z: pos.z })
      d.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(d.car.model.rotation))
      const spin = (d.speed * dt) / 0.45
      for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
        const w = d.car.model.getObjectByName(n)
        if (w) w.rotation.x -= spin
      }
      d.car.setNight(night, block)
      d.car.model.visible = Math.abs(pos.x - player.x) < 110 && Math.abs(pos.z - player.z) < 110
    }
    this.poolMat.opacity = night > 0.3 ? 0.5 * night : 0
    for (const p of this.parked) {
      p.setNight(night * 0.2)
      p.model.visible = Math.abs(p.model.position.x - player.x) < 110 && Math.abs(p.model.position.z - player.z) < 110
    }
  }

  get positions() {
    return this.drivers.map((d) => d.car.model.position)
  }
}

/** spots along the kerbs for parked taxis: [x, z, yaw] */
export function kerbSpots(avoid: { x: number; z: number }[], max: number) {
  const r = rng(5)
  const spots: [number, number, number][] = []
  for (const g of GRID) {
    for (let i = 0; i < GRID.length - 1; i++) {
      const a = GRID[i] + ROAD_W / 2 + 14
      const c = GRID[i + 1] - ROAD_W / 2 - 14
      for (let t = a; t < c; t += 9) {
        if (r() > 0.16) continue
        const side = r() < 0.5 ? -1 : 1
        const vertical = r() < 0.5
        if (g === 0 && vertical) continue // tram lane
        const x = vertical ? g + side * (ROAD_W / 2 - 1.0) : t
        const z = vertical ? t : g + side * (ROAD_W / 2 - 1.0)
        if (avoid.some((e) => Math.hypot(e.x - x, e.z - z) < 12)) continue
        // parked facing the direction of travel on that side (left-hand traffic)
        const yaw = vertical ? (side < 0 ? 0 : Math.PI) : side < 0 ? -Math.PI / 2 : Math.PI / 2
        spots.push([x, z, yaw])
      }
    }
  }
  return spots.slice(0, max)
}
