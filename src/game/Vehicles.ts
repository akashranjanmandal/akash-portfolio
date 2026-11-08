import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RAPIER, type Physics } from './Physics'
import type { Input } from './Input'
import { damp, clamp, angleDelta } from '../utils/math'

export type Vehicle = Car | Bike

/* ── Car: a Rapier raycast vehicle wearing the Ferrari model, painted as a Kolkata taxi ── */

export class Car {
  readonly kind = 'car'
  readonly root = new THREE.Group()
  readonly body: RAPIER.RigidBody
  private ctrl: RAPIER.DynamicRayCastVehicleController
  private wheels: THREE.Object3D[] = []
  private wheelBase: THREE.Vector3[] = []
  private steer = 0
  speed = 0
  occupied = false
  private readonly prevP = new THREE.Vector3()
  private readonly currP = new THREE.Vector3()
  private readonly prevQ = new THREE.Quaternion()
  private readonly currQ = new THREE.Quaternion()
  readonly seat = new THREE.Vector3(-0.35, 0.55, 0.1)
  /** where the driver steps out (car-local) */
  readonly exit = new THREE.Vector3(-1.9, 0, 0.2)

  constructor(physics: Physics, gltf: GLTF, pos: THREE.Vector3, yaw: number) {
    const model = gltf.scene.clone(true)
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      const mat = m.material as THREE.MeshStandardMaterial
      if (mat?.name === 'Body_Color' || mat?.name === 'Ferrari_Yellow') {
        const paint = new THREE.MeshPhysicalMaterial({ color: '#f2b705', metalness: 0.4, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 })
        m.material = paint
      }
    })
    this.root.add(model)
    model.updateMatrixWorld(true)
    for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const w = model.getObjectByName(n)!
      this.wheels.push(w)
      this.wheelBase.push(w.position.clone())
    }

    const w = physics.world
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + 0.8, pos.z).setRotation(q).setLinearDamping(0.15).setAngularDamping(0.8).setCanSleep(true),
    )
    // chassis box (centre of mass lowered for stability)
    w.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 0.32, 2.2).setTranslation(0, 0.1, 0).setMass(1100).setFriction(0.4), this.body)
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.75, 0.22, 1.0).setTranslation(0, 0.5, -0.2).setMass(100), this.body)
    this.ctrl = w.createVehicleController(this.body)
    ;(this.ctrl as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2
    const radius = 0.34
    const rest = 0.3
    for (const wp of this.wheelBase) {
      // wheel connection points in chassis space (model origin is at ground level)
      this.ctrl.addWheel({ x: wp.x, y: 0.35 - 0.8 + rest, z: wp.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, radius)
    }
    for (let i = 0; i < 4; i++) {
      this.ctrl.setWheelSuspensionStiffness(i, 28)
      this.ctrl.setWheelSuspensionCompression(i, 3.6)
      this.ctrl.setWheelSuspensionRelaxation(i, 4.2)
      this.ctrl.setWheelFrictionSlip(i, 2.4)
      this.ctrl.setWheelSideFrictionStiffness(i, 1.2)
      this.ctrl.setWheelMaxSuspensionTravel(i, 0.25)
    }
    this.snap()
  }

  private snap() {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.prevP.set(t.x, t.y, t.z)
    this.currP.copy(this.prevP)
    this.prevQ.set(r.x, r.y, r.z, r.w)
    this.currQ.copy(this.prevQ)
  }

  /** heading of the car's nose (the model faces -Z) */
  get yaw() {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion)
    return Math.atan2(f.x, f.z)
  }

  get position() {
    return this.root.position
  }

  stepPhysics(input: Input | null, dt: number) {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.prevP.set(t.x, t.y, t.z)
    this.prevQ.set(r.x, r.y, r.z, r.w)
    // the controller measures along +Z, but the car's nose points along -Z
    const speed = -this.ctrl.currentVehicleSpeed()
    this.speed = speed
    let engine = 0
    let brake = 0
    let steerTarget = 0
    if (input && this.occupied) {
      const thr = input.move.y
      steerTarget = -input.move.x * 0.55 / (1 + Math.abs(speed) * 0.05)
      const max = input.sprint ? 42 : 28 // m/s
      if (thr > 0.05) {
        if (speed < -1) brake = 40 * thr
        else if (speed < max) engine = 3200 * thr * (input.sprint ? 1.4 : 1)
      } else if (thr < -0.05) {
        if (speed > 1) brake = 40 * -thr
        else if (speed > -10) engine = -2000 * -thr
      } else brake = 3
      if (input.brake) brake = 90
      this.body.wakeUp()
    } else brake = 30
    this.steer = damp(this.steer, steerTarget, 8, dt)
    for (const i of [0, 1]) this.ctrl.setWheelSteering(i, this.steer)
    for (const i of [2, 3]) this.ctrl.setWheelEngineForce(i, -engine)
    for (let i = 0; i < 4; i++) this.ctrl.setWheelBrake(i, brake)
    this.ctrl.updateVehicle(dt)
    const t2 = this.body.translation()
    const r2 = this.body.rotation()
    this.currP.set(t2.x, t2.y, t2.z)
    this.currQ.set(r2.x, r2.y, r2.z, r2.w)
    // tipped over? set it back on its wheels
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.currQ)
    if (up.y < 0.2 && Math.abs(speed) < 2) {
      const y = this.yaw
      this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y), true)
      this.body.setTranslation({ x: t2.x, y: t2.y + 1.2, z: t2.z }, true)
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }

  update(alpha: number, _dt?: number) {
    this.root.position.lerpVectors(this.prevP, this.currP, alpha)
    this.root.position.y -= 0.8 - 0.35
    this.root.quaternion.slerpQuaternions(this.prevQ, this.currQ, alpha)
    this.wheels.forEach((w, i) => {
      const len = this.ctrl.wheelSuspensionLength(i) ?? 0.3
      w.position.y = this.wheelBase[i].y + (0.3 - len)
      w.rotation.set(this.ctrl.wheelRotation(i) ?? 0, i < 2 ? this.steer : 0, 0, 'YXZ')
    })
  }
}

/* ── Bike: kinematic, so it never falls over; the rider is posed on it ── */

export class Bike {
  readonly kind = 'bike'
  readonly root = new THREE.Group()
  private model: THREE.Object3D
  private front: THREE.Object3D | null
  private rear: THREE.Object3D | null
  private pedals: THREE.Object3D | null
  private bars: THREE.Object3D | null
  speed = 0
  heading: number
  private lean = 0
  occupied = false
  private velY = 0
  readonly body: RAPIER.RigidBody
  private collider: RAPIER.Collider
  private ctrl: RAPIER.KinematicCharacterController
  private readonly prevP = new THREE.Vector3()
  private readonly currP = new THREE.Vector3()
  readonly seat = new THREE.Vector3(0, 1.0, -0.2)
  readonly exit = new THREE.Vector3(-1.1, 0, 0)

  constructor(physics: Physics, gltf: GLTF, pos: THREE.Vector3, yaw: number) {
    this.model = gltf.scene.clone(true)
    this.model.getObjectByName('Shadows')?.removeFromParent()
    // brake cables carry a ×100 node scale that breaks merging; they're too thin to notice
    const cables: THREE.Object3D[] = []
    this.model.traverse((o) => /^Schlauch/.test(o.name) && cables.push(o))
    cables.forEach((o) => o.removeFromParent())
    this.front = this.model.getObjectByName('RadVorn') ?? null
    this.rear = this.model.getObjectByName('RadHinten') ?? null
    this.pedals = this.model.getObjectByName('Pedale') ?? null
    this.bars = this.model.getObjectByName('Lenker') ?? null
    mergeStatic(this.model, [this.front, this.rear, this.pedals, this.bars].filter(Boolean) as THREE.Object3D[])
    // the model runs along X; turn it so the bike faces +Z
    this.model.rotation.y = -Math.PI / 2
    this.root.add(this.model)
    this.heading = yaw
    const w = physics.world
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.6, pos.z))
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(0.3, 0.3), this.body)
    this.ctrl = w.createCharacterController(0.02)
    this.ctrl.enableAutostep(0.3, 0.2, true)
    this.ctrl.enableSnapToGround(0.5)
    this.ctrl.setMaxSlopeClimbAngle(0.7)
    this.prevP.set(pos.x, pos.y + 0.6, pos.z)
    this.currP.copy(this.prevP)
  }

  get yaw() {
    return this.heading
  }

  get position() {
    return this.root.position
  }

  stepPhysics(input: Input | null, dt: number) {
    const t = this.body.translation()
    this.prevP.set(t.x, t.y, t.z)
    let target = 0
    let turn = 0
    if (input && this.occupied) {
      target = input.move.y > 0.05 ? (input.sprint ? 11 : 7) * input.move.y : input.move.y < -0.05 ? -1.5 : 0
      if (input.brake) target = 0
      turn = -input.move.x
    }
    this.speed = damp(this.speed, target, target === 0 ? 1.6 : 1.2, dt)
    this.heading += turn * dt * clamp(Math.abs(this.speed) / 3, 0, 1) * 1.6 * Math.sign(this.speed || 1)
    this.lean = damp(this.lean, -turn * clamp(this.speed / 8, 0, 1) * 0.35, 5, dt)
    this.velY = this.ctrl.computedGrounded() ? -1 : this.velY - 9.81 * dt
    const dx = Math.sin(this.heading) * this.speed * dt
    const dz = Math.cos(this.heading) * this.speed * dt
    this.ctrl.computeColliderMovement(this.collider, { x: dx, y: this.velY * dt, z: dz })
    const m = this.ctrl.computedMovement()
    // ran into something: stop
    if (Math.hypot(m.x, m.z) < Math.hypot(dx, dz) * 0.3 && Math.abs(this.speed) > 1) this.speed *= 0.3
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z })
    this.currP.set(t.x + m.x, t.y + m.y, t.z + m.z)
  }

  update(alpha: number, dt: number) {
    this.root.position.lerpVectors(this.prevP, this.currP, alpha)
    this.root.position.y -= 0.6
    this.root.rotation.set(0, this.heading, 0)
    this.root.rotateZ(this.lean)
    const spin = (this.speed / 0.36) * dt
    if (this.front) this.front.rotation.z -= spin
    if (this.rear) this.rear.rotation.z -= spin
    if (this.pedals) this.pedals.rotation.z -= spin * 0.4
    if (this.bars) this.bars.rotation.y = damp(this.bars.rotation.y, this.lean * -1.2, 8, dt)
  }

  setCollision(on: boolean) {
    this.collider.setEnabled(on)
  }
}

/** merge everything except the moving parts into one mesh per material (757 nodes → a handful of draws) */
function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[]) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const isKept = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o
    while (p) {
      if (keep.includes(p)) return true
      p = p.parent
    }
    return false
  }
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const remove: THREE.Object3D[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || isKept(m)) return
    // meshopt geometry is quantized; copy into plain floats before transforming
    const src = m.geometry
    const g = new THREE.BufferGeometry()
    for (const [k, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      const a = src.getAttribute(k)
      if (!a) continue
      const out = new Float32Array(a.count * size)
      for (let i = 0; i < a.count; i++) {
        out[i * size] = a.getX(i)
        out[i * size + 1] = a.getY(i)
        if (size === 3) out[i * size + 2] = a.getZ(i)
      }
      g.setAttribute(k, new THREE.BufferAttribute(out, size))
    }
    if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>))
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
    const mat = m.material as THREE.Material
    let list = byMat.get(mat)
    if (!list) byMat.set(mat, (list = []))
    list.push(g.index ? g.toNonIndexed() : g)
    remove.push(m)
  })
  for (const m of remove) m.removeFromParent()
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list.map((g) => (g.attributes.uv ? g : (g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)), g))))
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = true
    root.add(mesh)
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.castShadow = true
  })
}

export function nearestVehicle(list: Vehicle[], p: THREE.Vector3, max = 3.2) {
  let best: Vehicle | null = null
  let bd = max
  for (const v of list) {
    if (v.occupied) continue
    const d = v.position.distanceTo(p)
    if (d < bd) {
      bd = d
      best = v
    }
  }
  return best
}

export { angleDelta }
