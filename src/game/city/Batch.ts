import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Collects geometry per material and merges it into one mesh per material (few draw calls). */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
    if (matrix) g.applyMatrix4(matrix)
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    list.push(g)
  }

  /** a box whose UVs are in metres / texScale, so textures keep real-world size */
  box(w: number, h: number, d: number, mat: THREE.Material, matrix: THREE.Matrix4, texScale = 2) {
    const g = new THREE.BoxGeometry(w, h, d)
    const uv = g.attributes.uv as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(n.getX(i))
      const ny = Math.abs(n.getY(i))
      const x = p.getX(i) + w / 2
      const y = p.getY(i) + h / 2
      const z = p.getZ(i) + d / 2
      if (ny > 0.5) uv.setXY(i, x / texScale, z / texScale)
      else if (nx > 0.5) uv.setXY(i, z / texScale, y / texScale)
      else uv.setXY(i, x / texScale, y / texScale)
    }
    this.add(g, mat, matrix)
  }

  build(group: THREE.Group, opts: { cast?: boolean; receive?: boolean } = {}) {
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list, false)
      if (!geo) continue
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = opts.cast ?? true
      mesh.receiveShadow = opts.receive ?? true
      group.add(mesh)
    }
    this.parts.clear()
  }
}

/** matrix from position, yaw and optional scale */
export function M(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz))
}
