import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { Retargeter } from './Retarget'
import type { Vehicle } from './Vehicles'
import { RAPIER, type Physics } from './Physics'
import type { Input } from './Input'
import { damp, angleDelta, clamp } from '../utils/math'

const RADIUS = 0.32
const HALF = 0.56 // capsule half height (without the caps)
const EYE = 1.62
const HEAD_LAYER = 1
/** how fast the feet move over the ground in each clip at time-scale 1 (measured from planted-foot motion) */
const WALK_CLIP = 1.43
const RUN_CLIP = 2.85

export type View = 'third' | 'first'

export class Player {
  readonly root = new THREE.Group()
  readonly avatar: THREE.Object3D
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  private controller: RAPIER.KinematicCharacterController
  private rig: Retargeter
  private actions: Record<string, THREE.AnimationAction> = {}
  private velocityY = 0
  private speed = 0
  private grounded = true
  private facing = 0
  yaw = 0
  pitch = -0.12
  view: View = 'third'
  /** when riding or driving the player is parked and hidden */
  active = true
  private camDist = 3.4
  private readonly tmp = new THREE.Vector3()
  private readonly prev = new THREE.Vector3()
  private readonly curr = new THREE.Vector3()
  private head: THREE.Object3D | null
  /** vehicle being driven or ridden */
  vehicle: Vehicle | null = null
  private pedal = 0
  private lastLook = 0
  /** ground-plane velocity (m/s); speed and facing follow it so starts, stops and turns have weight */
  private vel = new THREE.Vector2()
  private airTime = 0
  /** coyote time and jump buffering, so jumps at an edge or slightly early still count */
  private sinceGround = 0
  private jumpQueued = 0
  /** camera: smoothed pivot height (stairs and kerbs do not jolt it) and a dip when landing */
  private camY = NaN
  private landDip = 0

  constructor(private physics: Physics, avatarGltf: GLTF, animGltf: GLTF, spawn: THREE.Vector3) {
    this.avatar = avatarGltf.scene
    this.avatar.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      // the body is hidden from the first-person camera
      m.layers.set(HEAD_LAYER)
      // everyday clothes instead of the default costume
      const mat = m.material as THREE.MeshStandardMaterial
      if (/Outfit_Top/i.test(m.name)) mat.color.set('#4a5a78')
      if (/Outfit_Bottom/i.test(m.name)) mat.color.set('#3a4258')
      if (/Footwear/i.test(m.name)) mat.color.set('#b8b2a8')
    })
    this.root.add(this.avatar)
    this.head = this.avatar.getObjectByName('Head') ?? null

    // only locomotion clips; drop the Xbot hips translation so clips play in place
    const clips = animGltf.animations.filter((c) => ['idle', 'walk', 'run'].includes(c.name))
    this.rig = new Retargeter(animGltf.scene, this.avatar, clips)
    this.rig.clips.forEach((a, i) => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.play()
      this.actions[clips[i].name] = a
    })
    this.actions.idle?.setEffectiveWeight(1)

    const w = physics.world
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + HALF + RADIUS + 0.05, spawn.z))
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), this.body)
    this.controller = w.createCharacterController(0.02)
    this.controller.setUp({ x: 0, y: 1, z: 0 })
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(48))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(55))
    this.controller.enableAutostep(0.6, 0.2, true)
    this.controller.enableSnapToGround(0.4)
    this.controller.setApplyImpulsesToDynamicBodies(true)
    const t = this.body.translation()
    this.prev.set(t.x, t.y, t.z)
    this.curr.copy(this.prev)
  }

  get position() {
    return this.root.position
  }

  /** feet position */
  get feet() {
    return this.root.position
  }

  /** walking speed in m/s and whether the feet are on the ground */
  get gait() {
    return { speed: this.speed, grounded: this.grounded }
  }

  get moving() {
    return this.speed > 0.2
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    const y = p.y + HALF + RADIUS + 0.05
    this.body.setTranslation({ x: p.x, y, z: p.z }, true)
    this.body.setNextKinematicTranslation({ x: p.x, y, z: p.z })
    this.prev.set(p.x, y, p.z)
    this.curr.copy(this.prev)
    this.velocityY = 0
    this.vel.set(0, 0)
    this.speed = 0
    this.camY = NaN
    if (yaw !== undefined) {
      this.yaw = yaw
      this.facing = yaw
    }
  }

  setActive(on: boolean) {
    this.active = on
    this.root.visible = on
    this.collider.setEnabled(on)
  }

  /** get on / in a vehicle */
  mount(v: Vehicle) {
    this.vehicle = v
    v.occupied = true
    this.collider.setEnabled(false)
    if (v.kind === 'car') this.root.visible = false
    else (v as import('./Vehicles').Bike).setCollision(false)
  }

  /** step off at the vehicle's exit point */
  dismount() {
    const v = this.vehicle
    if (!v) return
    v.occupied = false
    if (v.kind === 'bike') (v as import('./Vehicles').Bike).setCollision(true)
    const exit = v.exit.clone().applyQuaternion(v.root.quaternion).add(v.position)
    this.vehicle = null
    this.root.visible = true
    this.collider.setEnabled(true)
    this.teleport(new THREE.Vector3(exit.x, v.position.y + 0.2, exit.z), this.yaw)
    this.facing = v.yaw
  }

  /** mouse / touch look */
  look(dx: number, dy: number) {
    if (dx || dy) this.lastLook = performance.now()
    this.yaw -= dx * 0.0024
    this.pitch = clamp(this.pitch - dy * 0.0022, -1.25, 0.95)
  }

  /** one physics step of movement */
  stepPhysics(input: Input, dt: number) {
    if (!this.active) return
    const t0 = this.body.translation()
    this.prev.set(t0.x, t0.y, t0.z)
    const mx = input.move.x
    const my = input.move.y
    const mag = Math.min(1, Math.hypot(mx, my))
    const target = mag < 0.05 ? 0 : input.sprint ? 6.2 : mag < 0.6 && input.touch ? 1.7 : 3.9
    // camera-relative direction: forward is the camera's look direction on the ground plane (-Z rotated by yaw)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let dx = -sin * my + cos * mx
    let dz = -cos * my - sin * mx
    const l = Math.hypot(dx, dz)
    if (l > 0) {
      dx /= l
      dz /= l
    }
    // accelerate towards the wanted velocity: brisk on the ground, a little steering in the air
    const want = this.tmp.set(dx * target, 0, dz * target)
    const rate = !this.grounded ? 3 : target > this.speed ? 16 : 22
    const ex = want.x - this.vel.x
    const ez = want.z - this.vel.y
    const err = Math.hypot(ex, ez)
    const step = Math.min(err, rate * dt)
    if (err > 1e-5) this.vel.add(new THREE.Vector2((ex / err) * step, (ez / err) * step))
    this.speed = this.vel.length()
    if (this.view === 'first') this.facing = this.yaw + Math.PI
    else if (this.speed > 0.3) {
      // the body turns towards where it is going, quicker at walking pace than at a sprint
      const head = Math.atan2(this.vel.x, this.vel.y)
      this.facing += angleDelta(this.facing, head) * (1 - Math.exp(-(this.speed > 5 ? 9 : 13) * dt))
    }
    dx = this.vel.x / Math.max(this.speed, 1e-6)
    dz = this.vel.y / Math.max(this.speed, 1e-6)

    if (input.jump) this.jumpQueued = 0.15
    this.jumpQueued = Math.max(0, this.jumpQueued - dt)
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt
    if (this.grounded) this.velocityY = -1
    else this.velocityY -= 9.81 * dt
    if (this.jumpQueued > 0 && this.sinceGround < 0.12 && this.velocityY <= 0) {
      this.velocityY = 4.6
      this.jumpQueued = 0
      this.sinceGround = 1
    }

    const desired = { x: dx * this.speed * dt, y: this.velocityY * dt, z: dz * this.speed * dt }
    this.controller.computeColliderMovement(this.collider, desired)
    const m = this.controller.computedMovement()
    const was = this.grounded
    this.grounded = this.controller.computedGrounded() && this.velocityY <= 0
    if (!this.grounded) this.airTime += dt
    else {
      // a real fall bends the knees: the camera dips with the height fallen
      if (!was && this.airTime > 0.3) this.landDip = Math.min(0.35, this.airTime * 0.25)
      this.airTime = 0
    }

    if (this.grounded && this.velocityY < 0) this.velocityY = -1
    this.body.setNextKinematicTranslation({ x: t0.x + m.x, y: t0.y + m.y, z: t0.z + m.z })
    this.curr.set(t0.x + m.x, t0.y + m.y, t0.z + m.z)
    // safety net: fell through the world
    if (this.curr.y < -30) this.teleport(new THREE.Vector3(this.curr.x, 5, this.curr.z))
  }

  /** visuals + animation, every frame */
  update(dt: number, alpha: number) {
    if (!this.active) return
    if (this.vehicle) return this.updateRiding(dt)
    this.tmp.lerpVectors(this.prev, this.curr, alpha)
    this.root.position.set(this.tmp.x, this.tmp.y - HALF - RADIUS, this.tmp.z)
    this.root.rotation.y = this.facing

    const s = this.speed
    const air = !this.grounded && this.airTime > 0.12
    const wIdle = air ? 0 : clamp(1 - s / 1.2)
    const wRun = air ? 0.6 : clamp((s - 2.4) / 1.4)
    const wWalk = air ? 0.4 : clamp(1 - wIdle - wRun)
    const set = (n: string, w: number, scale = 1) => {
      const a = this.actions[n]
      if (!a) return
      a.setEffectiveWeight(w)
      a.setEffectiveTimeScale(scale)
    }
    // play each clip so the planted foot moves at the ground speed: no skating
    set('idle', wIdle)
    set('walk', wWalk, clamp(s / WALK_CLIP, 0.55, 1.9))
    set('run', wRun, clamp(s / RUN_CLIP, 0.9, 2.2))
    // keep the two gaits in step while they blend, so the feet do not scissor
    const w = this.actions.walk
    const r = this.actions.run
    if (w && r && wWalk > 0.02 && wRun > 0.02) r.time = (w.time / w.getClip().duration) * r.getClip().duration
    this.rig.update(dt)
  }

  private updateRiding(dt: number) {
    const v = this.vehicle!
    if (v.kind === 'car') return
    // sit on the saddle, follow the bike exactly
    const seat = v.seat.clone().applyQuaternion(v.root.quaternion).add(v.position)
    this.root.position.copy(seat).setY(seat.y - 1.0)
    this.root.quaternion.copy(v.root.quaternion)
    this.facing = v.yaw
    for (const n of ['idle', 'walk', 'run']) this.actions[n]?.setEffectiveWeight(n === 'idle' ? 1 : 0)
    this.rig.update(dt)
    this.pedal += v.speed * dt * 1.6
    const s = Math.sin(this.pedal)
    const c = Math.cos(this.pedal)
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    this.rig.aim({
      Spine: V(0, 0.82, 0.42),
      Spine1: V(0, 0.8, 0.5),
      Spine2: V(0, 0.78, 0.55),
      LeftUpLeg: V(0.12, -0.5 + s * 0.22, 0.85 + c * 0.15),
      RightUpLeg: V(-0.12, -0.5 - s * 0.22, 0.85 - c * 0.15),
      LeftLeg: V(0.03, -1, -0.2 + s * 0.25),
      RightLeg: V(-0.03, -1, -0.2 - s * 0.25),
      LeftArm: V(0.3, -0.45, 0.85),
      RightArm: V(-0.3, -0.45, 0.85),
      LeftForeArm: V(0.05, -0.35, 1),
      RightForeArm: V(-0.05, -0.35, 1),
    })
  }

  /** orbit camera around a vehicle; drifts back behind it while moving */
  placeVehicleCamera(cam: THREE.PerspectiveCamera, dt: number) {
    const v = this.vehicle!
    const moving = Math.abs(v.speed) > 1.5
    if (moving && performance.now() - this.lastLook > 1600) {
      const behind = v.yaw + Math.PI
      this.yaw += angleDelta(this.yaw, behind) * (1 - Math.exp(-2.5 * dt))
      this.pitch = damp(this.pitch, -0.18, 2, dt)
    }
    const car = v.kind === 'car'
    const pivot = this.tmp.copy(v.position)
    pivot.y += car ? 1.4 : 1.6
    const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    const want = car ? 7 : 4.2
    const ray = new RAPIER.Ray({ x: pivot.x, y: pivot.y, z: pivot.z }, { x: back.x, y: back.y, z: back.z })
    const hit = this.physics.world.castRay(ray, want + 0.3, true, undefined, undefined, undefined, car ? (v as import('./Vehicles').Car).body : undefined)
    const target = hit ? Math.max(1.2, hit.timeOfImpact - 0.3) : want
    this.camDist = target < this.camDist ? target : damp(this.camDist, target, 3, dt)
    cam.layers.enable(HEAD_LAYER)
    cam.position.copy(pivot).addScaledVector(back, this.camDist)
    if (cam.position.y < v.position.y + 0.4) cam.position.y = v.position.y + 0.4
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  /** position the camera for the current view */
  placeCamera(cam: THREE.PerspectiveCamera, dt: number) {
    if (this.view === 'first') {
      cam.layers.disable(HEAD_LAYER)
      if (this.head) this.head.getWorldPosition(this.tmp)
      else this.tmp.copy(this.root.position).setY(this.root.position.y + EYE)
      this.tmp.y += 0.08
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
      this.tmp.addScaledVector(fwd, 0.14)
      cam.position.copy(this.tmp)
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
      return
    }
    cam.layers.enable(HEAD_LAYER)
    const pivot = this.tmp.copy(this.root.position)
    const py = this.root.position.y + 1.55
    this.camY = Number.isNaN(this.camY) || Math.abs(this.camY - py) > 3 ? py : damp(this.camY, py, 12, dt)
    this.landDip = damp(this.landDip, 0, 6, dt)
    pivot.y = this.camY - this.landDip
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // over the right shoulder
    pivot.x += cos * 0.45
    pivot.z += -sin * 0.45
    const back = new THREE.Vector3(sin * Math.cos(this.pitch), -Math.sin(this.pitch), cos * Math.cos(this.pitch))
    // spring arm: pull in when something is behind us
    const want = 3.4
    const ray = new RAPIER.Ray({ x: pivot.x, y: pivot.y, z: pivot.z }, { x: back.x, y: back.y, z: back.z })
    const hit = this.physics.world.castRay(ray, want + 0.3, true, undefined, undefined, this.collider)
    const target = hit ? Math.max(0.6, hit.timeOfImpact - 0.3) : want
    this.camDist = target < this.camDist ? target : damp(this.camDist, target, 4, dt)
    cam.position.copy(pivot).addScaledVector(back, this.camDist)
    if (cam.position.y < this.root.position.y + 0.3) cam.position.y = this.root.position.y + 0.3
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }
}
