import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { Physics } from '../Physics'
import { GROUP } from '../Physics'
import { TAXI, type TaxiParts } from './TaxiModel'
import { damp, clamp } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   VEHICLE
   Two ways to move the taxi:
   • rail    — story mode; the scroll position decides where on the
               road it is. A kinematic proxy body still shoves props.
   • physics — drive mode; a cannon-es RaycastVehicle with arcade
               tuning (strong gravity, grippy tyres, speed-sensitive
               steering) so it feels like a toy, not a simulator.
   In this setup a negative engine force drives forward (+Z) and a
   positive steering value turns left; both were verified in Node.
────────────────────────────────────────────────────────────── */

export type DriveInput = { throttle: number; steer: number; brake: boolean; boost: boolean }

const CONNECT_Y = 0
const REST = 0.3
const MODEL_Y = -0.5 // model ground sits this far below the chassis origin
export const RIDE_HEIGHT = 0.5

export class Vehicle {
  readonly chassis: CANNON.Body
  readonly raycast: CANNON.RaycastVehicle
  readonly proxy: CANNON.Body
  mode: 'rail' | 'physics' = 'rail'

  /** signed speed along the car's forward axis (units/s) */
  speed = 0
  /** 0..1 how hard the engine is working, for sound */
  load = 0
  braking = false
  boosting = false
  airborne = false
  /** recent hard impact speed, for camera shake and sound */
  impact = 0

  private steerValue = 0
  private wheelSpin = 0
  private upsideDownTime = 0
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly fwd = new THREE.Vector3()
  private railPos = new THREE.Vector3()

  private lastRailPos = new THREE.Vector3()
  private bob = 0
  onImpact?: (speed: number) => void
  onFall?: () => void

  constructor(
    private physics: Physics,
    readonly parts: TaxiParts,
  ) {
    parts.body.position.y = MODEL_Y

    this.chassis = new CANNON.Body({
      mass: 40,
      angularDamping: 0.45,
      linearDamping: 0.04,
      collisionFilterGroup: GROUP.CAR,
      allowSleep: false,
    })
    this.chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.57, 0.3, 1.38)), new CANNON.Vec3(0, 0.04, 0))
    this.chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.46, 0.16, 0.6)), new CANNON.Vec3(0, 0.48, -0.08))

    this.raycast = new CANNON.RaycastVehicle({ chassisBody: this.chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 })
    const wheel = {
      radius: TAXI.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 50,
      suspensionRestLength: REST,
      frictionSlip: 4.2,
      dampingRelaxation: 2.4,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.02,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      maxSuspensionTravel: 0.25,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    }
    for (const [x, z] of [[TAXI.wheelX, TAXI.frontZ], [-TAXI.wheelX, TAXI.frontZ], [TAXI.wheelX, TAXI.rearZ], [-TAXI.wheelX, TAXI.rearZ]]) {
      this.raycast.addWheel({ ...wheel, chassisConnectionPointLocal: new CANNON.Vec3(x, CONNECT_Y, z) })
    }

    this.chassis.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const s = Math.abs(e.contact.getImpactVelocityAlongNormal())
      if (s > 2.5) {
        this.impact = Math.max(this.impact, s)
        this.onImpact?.(s)
      }
    })

    this.proxy = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: GROUP.CAR })
    this.proxy.addShape(new CANNON.Box(new CANNON.Vec3(0.57, 0.3, 1.38)), new CANNON.Vec3(0, 0.04, 0))
    this.proxy.addShape(new CANNON.Box(new CANNON.Vec3(0.46, 0.16, 0.6)), new CANNON.Vec3(0, 0.48, -0.08))
    physics.world.addBody(this.proxy)
  }

  get position() {
    return this.parts.root.position
  }

  get yaw() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.parts.root.quaternion)
    return Math.atan2(this.fwd.x, this.fwd.z)
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.parts.root.quaternion)
  }

  /* ── rail (story) ─────────────────────────────────────────── */

  setRail(pos: THREE.Vector3, yaw: number, dt: number) {
    this.lastRailPos.copy(this.railPos)
    this.railPos.copy(pos)

    if (this.mode !== 'rail') return
    const moved = dt > 0 ? this.lastRailPos.distanceTo(pos) : 0
    const target = moved / Math.max(dt, 1e-3)
    this.speed = damp(this.speed, target > 60 ? 0 : target, 10, dt)
    this.load = clamp(this.speed / 10)
    this.wheelSpin += moved / TAXI.wheelRadius

    // a little life: engine shiver when idling, gentle pitch when moving
    this.bob += dt * (8 + this.speed)
    const shiver = Math.sin(this.bob * 3.1) * 0.006 + Math.sin(this.bob * 1.7) * 0.004
    const root = this.parts.root
    root.position.set(pos.x, RIDE_HEIGHT + shiver, pos.z)
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)
    root.quaternion.copy(this.q)
    this.parts.body.rotation.x = -Math.min(0.03, this.speed * 0.002) + shiver * 0.5

    // steer the front wheels with the curve of the road
    this.layoutWheelsAtRest(0)
    for (const w of this.parts.wheels) (w.userData.spin as THREE.Object3D).rotation.x = this.wheelSpin

    // shove anything on the road
    this.proxy.position.set(pos.x, RIDE_HEIGHT, pos.z)
    this.proxy.quaternion.set(this.q.x, this.q.y, this.q.z, this.q.w)
    if (dt > 0) this.proxy.velocity.set((pos.x - this.lastRailPos.x) / dt, 0, (pos.z - this.lastRailPos.z) / dt)
  }

  private layoutWheelsAtRest(steer: number) {
    this.parts.wheels.forEach((w, i) => {
      const x = i % 2 === 0 ? TAXI.wheelX : -TAXI.wheelX
      const z = i < 2 ? TAXI.frontZ : TAXI.rearZ
      w.position.set(x, CONNECT_Y - (REST - 0.1), z)
      w.rotation.y = i < 2 ? steer : 0
    })
  }

  /* ── physics (drive) ──────────────────────────────────────── */

  enablePhysics(carry = true) {
    if (this.mode === 'physics') return
    const root = this.parts.root
    this.chassis.position.set(root.position.x, root.position.y + 0.05, root.position.z)
    this.chassis.quaternion.set(root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w)
    const f = this.forward(this.v)
    const s = carry ? this.speed : 0
    this.chassis.velocity.set(f.x * s, 0, f.z * s)
    this.chassis.angularVelocity.set(0, 0, 0)
    this.raycast.addToWorld(this.physics.world)
    this.physics.world.removeBody(this.proxy)
    this.chassis.previousPosition.copy(this.chassis.position)
    this.chassis.interpolatedPosition.copy(this.chassis.position)
    this.chassis.interpolatedQuaternion.copy(this.chassis.quaternion)
    this.mode = 'physics'
  }

  disablePhysics() {
    if (this.mode === 'rail') return
    this.raycast.removeFromWorld(this.physics.world)
    this.physics.world.addBody(this.proxy)
    this.mode = 'rail'
    this.braking = false
    this.boosting = false
  }

  /** put the car down upright at a spot, facing yaw */
  respawn(pos: THREE.Vector3, yaw: number) {
    this.chassis.position.set(pos.x, RIDE_HEIGHT + 0.6, pos.z)
    this.chassis.quaternion.setFromEuler(0, yaw, 0)
    this.chassis.velocity.set(0, 0, 0)
    this.chassis.angularVelocity.set(0, 0, 0)
    this.chassis.previousPosition.copy(this.chassis.position)
    this.chassis.interpolatedPosition.copy(this.chassis.position)
    this.chassis.interpolatedQuaternion.copy(this.chassis.quaternion)
    this.upsideDownTime = 0
    this.speed = 0
  }

  /** before the physics step: turn input into forces */
  drive(input: DriveInput, dt: number) {
    if (this.mode !== 'physics') return
    const fwd = this.v.set(0, 0, 1)
    const cq = this.chassis.quaternion
    this.q.set(cq.x, cq.y, cq.z, cq.w)
    fwd.applyQuaternion(this.q)
    const vel = this.chassis.velocity
    const speed = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z
    this.speed = speed

    const boost = input.boost && input.throttle > 0
    this.boosting = boost
    const maxFwd = boost ? 22 : 14.5
    const maxRev = 6.5
    const force = boost ? 330 : 230
    let engine = 0
    let brake = 0
    const t = input.throttle
    if (t > 0.05) {
      if (speed < -0.8) brake = 1.6 * t // moving backwards: brake first
      else if (speed < maxFwd) engine = -force * t
    } else if (t < -0.05) {
      if (speed > 0.8) brake = 1.6 * -t
      else if (speed > -maxRev) engine = force * 0.7 * -t
    } else {
      brake = 0.12 // rolling resistance
    }
    if (input.brake) brake = 2.4
    this.braking = brake > 1 || input.brake
    this.load = clamp(Math.abs(engine) / force)

    for (const i of [2, 3]) this.raycast.applyEngineForce(engine, i)
    for (let i = 0; i < 4; i++) this.raycast.setBrake(input.brake && i < 2 ? brake * 0.5 : brake, i)

    // speed-sensitive steering, smoothed
    const maxSteer = 0.55 / (1 + Math.abs(speed) * 0.075)
    this.steerValue = damp(this.steerValue, input.steer * maxSteer, 9, dt)
    this.raycast.setSteeringValue(this.steerValue, 0)
    this.raycast.setSteeringValue(this.steerValue, 1)

    // keep it planted: a little extra downforce at speed
    if (!this.airborne) this.chassis.applyForce(new CANNON.Vec3(0, -Math.abs(speed) * 6, 0))
  }

  /** after the physics step: sync visuals and check for trouble */
  sync(dt: number) {
    this.impact = Math.max(0, this.impact - dt * 30)
    if (this.mode !== 'physics') return
    const c = this.chassis
    const root = this.parts.root
    root.position.set(c.interpolatedPosition.x, c.interpolatedPosition.y, c.interpolatedPosition.z)
    root.quaternion.set(c.interpolatedQuaternion.x, c.interpolatedQuaternion.y, c.interpolatedQuaternion.z, c.interpolatedQuaternion.w)
    this.parts.body.rotation.x = 0

    let grounded = 0
    this.raycast.wheelInfos.forEach((info, i) => {
      const w = this.parts.wheels[i]
      const cp = info.chassisConnectionPointLocal
      w.position.set(cp.x, cp.y - info.suspensionLength, cp.z)
      w.rotation.y = info.steering
      ;(w.userData.spin as THREE.Object3D).rotation.x = -info.rotation
      if (info.isInContact) grounded++
    })
    this.airborne = grounded === 0

    // upside down or on its side for a while → flip it back
    const up = this.v.set(0, 1, 0).applyQuaternion(root.quaternion)
    if (up.y < 0.35 && Math.abs(this.speed) < 3) this.upsideDownTime += dt
    else this.upsideDownTime = 0
    if (this.upsideDownTime > 1.4) {
      this.respawn(root.position.clone().setY(0), this.yaw)
    }
    if (c.position.y < -14) this.onFall?.()
  }
}
