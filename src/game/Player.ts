import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { Retargeter } from './Retarget'
import { RAPIER, type Physics } from './Physics'
import type { Input } from './Input'
import { damp, angleDelta, clamp } from '../utils/math'

const RADIUS = 0.32
const HALF = 0.56 // capsule half height (without the caps)
const EYE = 1.62
const HEAD_LAYER = 1

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
    this.controller.enableAutostep(0.45, 0.25, true)
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

  /** mouse / touch look */
  look(dx: number, dy: number) {
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
    this.speed = damp(this.speed, target, 10, dt)
    // camera-relative direction
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // forward is the camera's look direction on the ground plane (-Z rotated by yaw)
    const fx = -sin
    const fz = -cos
    const rx = cos
    const rz = -sin
    let dx = fx * my + rx * mx
    let dz = fz * my + rz * mx
    const l = Math.hypot(dx, dz)
    if (l > 0) {
      dx /= l
      dz /= l
      const want = Math.atan2(dx, dz)
      if (this.view === 'first') this.facing = this.yaw + Math.PI
      else this.facing += angleDelta(this.facing, want) * (1 - Math.exp(-12 * dt))
    } else if (this.view === 'first') this.facing = this.yaw + Math.PI

    if (this.grounded) {
      this.velocityY = -1
      if (input.jump) this.velocityY = 4.6
    } else this.velocityY -= 9.81 * dt

    const desired = { x: dx * this.speed * dt, y: this.velocityY * dt, z: dz * this.speed * dt }
    this.controller.computeColliderMovement(this.collider, desired)
    const m = this.controller.computedMovement()
    this.grounded = this.controller.computedGrounded()
    if (this.grounded && this.velocityY < 0) this.velocityY = -1
    this.body.setNextKinematicTranslation({ x: t0.x + m.x, y: t0.y + m.y, z: t0.z + m.z })
    this.curr.set(t0.x + m.x, t0.y + m.y, t0.z + m.z)
    // safety net: fell through the world
    if (this.curr.y < -30) this.teleport(new THREE.Vector3(this.curr.x, 5, this.curr.z))
  }

  /** visuals + animation, every frame */
  update(dt: number, alpha: number) {
    if (!this.active) return
    this.tmp.lerpVectors(this.prev, this.curr, alpha)
    this.root.position.set(this.tmp.x, this.tmp.y - HALF - RADIUS, this.tmp.z)
    this.root.rotation.y = this.facing

    const s = this.speed
    const air = !this.grounded
    const wIdle = air ? 0 : clamp(1 - s / 1.4)
    const wRun = air ? 0.6 : clamp((s - 2.2) / 1.6)
    const wWalk = air ? 0.4 : clamp(1 - wIdle - wRun)
    const set = (n: string, w: number, scale = 1) => {
      const a = this.actions[n]
      if (!a) return
      a.setEffectiveWeight(w)
      a.setEffectiveTimeScale(scale)
    }
    set('idle', wIdle)
    set('walk', wWalk, clamp(s / 1.6, 0.6, 1.6))
    set('run', wRun, clamp(s / 4.2, 0.8, 1.5))
    this.rig.update(dt)
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
    pivot.y += 1.55
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
