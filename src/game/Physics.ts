import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

export { RAPIER }

/** Rapier world with a fixed 60 Hz step and helpers for static scenery. */
export class Physics {
  world!: RAPIER.World
  private acc = 0
  readonly step = 1 / 60
  alpha = 0

  async init() {
    await RAPIER.init()
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = this.step
  }

  /** advance in fixed steps; returns how many steps ran */
  update(dt: number, beforeStep?: () => void) {
    this.acc += Math.min(dt, 0.1)
    let n = 0
    while (this.acc >= this.step && n < 5) {
      beforeStep?.()
      this.world.step()
      this.acc -= this.step
      n++
    }
    this.alpha = this.acc / this.step
    return n
  }

  fixedBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q))
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body)
    return body
  }

  fixedCylinder(x: number, y: number, z: number, r: number, h: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z))
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r), body)
    return body
  }

  /** static trimesh collider from a mesh (use for terrain and buildings) */
  fixedMesh(mesh: THREE.Mesh) {
    mesh.updateWorldMatrix(true, false)
    const geo = mesh.geometry.index ? mesh.geometry : mesh.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    const verts = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      verts.set([v.x, v.y, v.z], i * 3)
    }
    const idx = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i)
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx), body)
    return body
  }

  /** height of the ground below (x, z), or null */
  groundAt(x: number, z: number, from = 200) {
    const ray = new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(ray, from * 2, true)
    return hit ? from - hit.timeOfImpact : null
  }
}
