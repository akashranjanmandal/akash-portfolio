import * as CANNON from 'cannon-es'
import * as THREE from 'three'

export const GROUP = { STATIC: 1, PROP: 2, CAR: 4 }

type Link = { body: CANNON.Body; object: THREE.Object3D; offset?: THREE.Vector3 }

/**
 * Thin wrapper around a cannon-es world: fixed 60 Hz steps with
 * interpolation, helpers for static colliders, and mesh syncing.
 */
export class Physics {
  readonly world: CANNON.World
  readonly propMaterial = new CANNON.Material('prop')
  readonly groundMaterial = new CANNON.Material('ground')
  private links: Link[] = []
  private readonly tmpQ = new THREE.Quaternion()

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0), allowSleep: true })
    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.defaultContactMaterial.friction = 0.35
    this.world.defaultContactMaterial.restitution = 0.12
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.groundMaterial, this.propMaterial, { friction: 0.45, restitution: 0.18 }))
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.propMaterial, this.propMaterial, { friction: 0.4, restitution: 0.12 }))
  }

  addStatic(shape: CANNON.Shape, x: number, y: number, z: number, yaw = 0) {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.groundMaterial, collisionFilterGroup: GROUP.STATIC })
    body.addShape(shape)
    body.position.set(x, y, z)
    if (yaw) body.quaternion.setFromEuler(0, yaw, 0)
    this.world.addBody(body)
    return body
  }

  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) {
    return this.addStatic(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), x, y, z, yaw)
  }

  cylinder(x: number, y: number, z: number, radius: number, height: number, segments = 10) {
    return this.addStatic(new CANNON.Cylinder(radius, radius, height, segments), x, y, z)
  }

  sphere(x: number, y: number, z: number, radius: number) {
    return this.addStatic(new CANNON.Sphere(radius), x, y, z)
  }

  /** static box given in an object's local frame (for landmark colliders) */
  localBox(parent: THREE.Object3D, local: THREE.Vector3, half: THREE.Vector3, localYaw = 0) {
    parent.updateWorldMatrix(true, false)
    const p = local.clone().applyMatrix4(parent.matrixWorld)
    const q = parent.getWorldQuaternion(this.tmpQ).clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), localYaw))
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.groundMaterial, collisionFilterGroup: GROUP.STATIC })
    body.addShape(new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)))
    body.position.set(p.x, p.y, p.z)
    body.quaternion.set(q.x, q.y, q.z, q.w)
    this.world.addBody(body)
    return body
  }

  localCylinder(parent: THREE.Object3D, local: THREE.Vector3, radius: number, height: number) {
    parent.updateWorldMatrix(true, false)
    const p = local.clone().applyMatrix4(parent.matrixWorld)
    return this.cylinder(p.x, p.y, p.z, radius, height)
  }

  /** keep a mesh glued to a dynamic body */
  link(body: CANNON.Body, object: THREE.Object3D, offset?: THREE.Vector3) {
    this.links.push({ body, object, offset })
  }

  step(dt: number) {
    this.world.step(1 / 60, dt, 4)
    for (const l of this.links) {
      const b = l.body
      if (b.sleepState === CANNON.Body.SLEEPING) continue
      l.object.position.set(b.interpolatedPosition.x, b.interpolatedPosition.y, b.interpolatedPosition.z)
      l.object.quaternion.set(b.interpolatedQuaternion.x, b.interpolatedQuaternion.y, b.interpolatedQuaternion.z, b.interpolatedQuaternion.w)
      if (l.offset) l.object.position.add(l.offset.clone().applyQuaternion(l.object.quaternion))
    }
  }

  /** force-sync every linked mesh (after resets) */
  syncAll() {
    for (const l of this.links) {
      l.object.position.set(l.body.position.x, l.body.position.y, l.body.position.z)
      l.object.quaternion.set(l.body.quaternion.x, l.body.quaternion.y, l.body.quaternion.z, l.body.quaternion.w)
    }
  }
}
