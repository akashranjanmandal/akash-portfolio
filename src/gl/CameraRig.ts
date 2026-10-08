import * as THREE from 'three'
import type { StopAnchor } from './world/Layout'
import { damp, smoothstep, angleDelta, clamp } from '../utils/math'
import { reducedMotion } from '../utils/device'

export type Shot = { pos: THREE.Vector3; target: THREE.Vector3; fov: number }

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

/** a stop's hero shot in world space (camera frames the taxi with the landmark behind it) */
export function stopShot(a: StopAnchor, carYaw?: number): Shot {
  const side = a.place.side
  const s = a.place.shot ?? {
    pos: [-11 * side, 4.6, -7] as [number, number, number],
    target: [5.5 * side, 2.2, 1.5] as [number, number, number],
    fov: 46,
  }
  const right = a.right
  const fwd = carYaw === undefined ? a.tan : new THREE.Vector3(Math.sin(carYaw), 0, Math.cos(carYaw))
  const up = THREE.Object3D.DEFAULT_UP
  const at = (v: [number, number, number], out: THREE.Vector3) =>
    out.copy(a.pos).addScaledVector(right, v[0]).addScaledVector(up, v[1]).addScaledVector(fwd, v[2])
  return { pos: at(s.pos, new THREE.Vector3()), target: at(s.target, new THREE.Vector3()), fov: s.fov ?? 46 }
}

/** 3/4 chase view behind the moving taxi, slightly to the outer side */
export function chaseShot(car: THREE.Vector3, yaw: number, out?: Shot): Shot {
  const o = out ?? { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  // right vector is (-fz, 0, fx); go a little to the left of the car
  o.pos.set(car.x - fx * 7.2 + fz * 3.2, car.y + 3.3, car.z - fz * 7.2 - fx * 3.2)
  o.target.set(car.x + fx * 4, car.y + 0.6, car.z + fz * 4)
  o.fov = 50
  return o
}

export class CameraRig {
  readonly pos = new THREE.Vector3(0, 60, 120)
  readonly target = new THREE.Vector3()
  fov = 45
  readonly desiredPos = new THREE.Vector3(0, 60, 120)
  readonly desiredTarget = new THREE.Vector3()
  desiredFov = 45
  /** how quickly the camera chases the desired pose */
  stiffness = 4
  /** drive-mode zoom multiplier, changed by the wheel / pinch */
  zoom = 1
  private followYaw = 0
  private shake = 0
  private readonly pointer = new THREE.Vector2()
  private readonly pointerSmooth = new THREE.Vector2()
  readonly desiredShift = new THREE.Vector2()
  private snapNext = true

  constructor(private camera: THREE.PerspectiveCamera, private shift: THREE.Vector2, private applyShift: () => void) {
    if (!reducedMotion) {
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return
        this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
      }, { passive: true })
    }
  }

  /** jump straight to the desired pose on the next update (after teleports) */
  snap() {
    this.snapNext = true
  }

  addShake(amount: number) {
    if (reducedMotion) return
    this.shake = Math.min(1.2, this.shake + amount)
  }

  setStory(shot: Shot) {
    this.desiredPos.copy(shot.pos)
    this.desiredTarget.copy(shot.target)
    this.desiredFov = shot.fov
  }

  /** follow camera for drive mode */
  setDrive(car: THREE.Vector3, yaw: number, speed: number, boosting: boolean, dt: number) {
    if (speed > 0.6) this.followYaw += angleDelta(this.followYaw, yaw) * (1 - Math.exp(-2.4 * dt))
    else if (speed > -0.6) this.followYaw += angleDelta(this.followYaw, yaw) * (1 - Math.exp(-0.6 * dt))
    const s = clamp(Math.abs(speed) / 20)
    const dist = (8.5 + s * 3.5) * this.zoom
    const height = (3.9 + s * 0.8) * (0.75 + this.zoom * 0.25)
    const fx = Math.sin(this.followYaw)
    const fz = Math.cos(this.followYaw)
    this.desiredPos.set(car.x - fx * dist, car.y + height, car.z - fz * dist)
    this.desiredTarget.set(car.x + fx * 2.5, car.y + 0.7, car.z + fz * 2.5)
    this.desiredFov = boosting ? 58 : 50 + s * 4
  }

  resetFollow(yaw: number) {
    this.followYaw = yaw
  }

  update(dt: number, elapsed: number) {
    if (this.snapNext) {
      this.pos.copy(this.desiredPos)
      this.target.copy(this.desiredTarget)
      this.fov = this.desiredFov
      this.shift.copy(this.desiredShift)
      this.snapNext = false
    } else {
      const k = 1 - Math.exp(-this.stiffness * dt)
      this.pos.lerp(this.desiredPos, k)
      this.target.lerp(this.desiredTarget, Math.min(1, k * 1.25))
      this.fov = damp(this.fov, this.desiredFov, this.stiffness, dt)
      this.shift.x = damp(this.shift.x, this.desiredShift.x, 3, dt)
      this.shift.y = damp(this.shift.y, this.desiredShift.y, 3, dt)
    }
    this.pointerSmooth.lerp(this.pointer, 1 - Math.exp(-3 * dt))

    const cam = this.camera
    cam.position.copy(this.pos)
    // portrait screens see far less sideways: back the camera off and widen a touch
    const aspect = cam.aspect
    let fov = this.fov
    if (aspect < 1.05) {
      const pull = 1 + (1.05 - aspect) * 1.25
      cam.position.sub(this.target).multiplyScalar(pull).add(this.target)
      fov += (1.05 - aspect) * 12
    }
    // keep the lens above the grass
    if (cam.position.y < 0.9) cam.position.y = 0.9

    // pointer parallax: orbit slightly around the target
    if (this.pointerSmooth.lengthSq() > 1e-6) {
      const toCam = tmpA.subVectors(cam.position, this.target)
      const right = tmpB.set(toCam.z, 0, -toCam.x).normalize()
      cam.position.addScaledVector(right, this.pointerSmooth.x * 0.9)
      cam.position.y += this.pointerSmooth.y * 0.35
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.12
      cam.position.x += Math.sin(elapsed * 61) * s
      cam.position.y += Math.sin(elapsed * 47 + 1) * s
      cam.position.z += Math.cos(elapsed * 53) * s
      this.shake = Math.max(0, this.shake - dt * 2.4)
    }
    cam.lookAt(this.target)
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov = fov
    this.applyShift()
  }
}

/** blend helper used by the story: shot A → chase → shot B over travel progress p */
export function blendTravel(a: Shot, chase: Shot, b: Shot, p: number, out: Shot) {
  const wa = 1 - smoothstep(0, 0.42, p)
  const wb = smoothstep(0.58, 1, p)
  const wc = Math.max(0, 1 - wa - wb)
  out.pos.set(0, 0, 0).addScaledVector(a.pos, wa).addScaledVector(chase.pos, wc).addScaledVector(b.pos, wb)
  out.target.set(0, 0, 0).addScaledVector(a.target, wa).addScaledVector(chase.target, wc).addScaledVector(b.target, wb)
  out.fov = a.fov * wa + chase.fov * wc + b.fov * wb
  return out
}
