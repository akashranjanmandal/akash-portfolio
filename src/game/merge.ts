import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** expand an attribute to plain floats (meshopt data is quantized and often interleaved) */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const out = new Float32Array(a.count * a.itemSize)
  for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) out[i * a.itemSize + j] = a.getComponent(i, j)
  return new THREE.BufferAttribute(out, a.itemSize)
}

/**
 * Collapse every mesh under `root` into one mesh per material, expressed in root's frame.
 * Meshes under any object in `keep` (moving parts) are left alone.
 */
export function mergeByMaterial(root: THREE.Object3D, keep: THREE.Object3D[] = []) {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const kept = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.includes(p)) return true
    return false
  }
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const remove: THREE.Mesh[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || kept(m) || Array.isArray(m.material)) return
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    const g = new THREE.BufferGeometry()
    const pos = src.getAttribute('position')
    if (!pos) return
    g.setAttribute('position', floats(pos))
    const nrm = src.getAttribute('normal')
    g.setAttribute('normal', nrm ? floats(nrm) : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3))
    const uv = src.getAttribute('uv')
    g.setAttribute('uv', uv ? floats(uv) : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2))
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
    let list = byMat.get(m.material as THREE.Material)
    if (!list) byMat.set(m.material as THREE.Material, (list = []))
    list.push(g)
    remove.push(m)
  })
  if (remove.length < 2) return
  for (const m of remove) m.removeFromParent()
  for (const [mat, list] of byMat) {
    const geo = list.length === 1 ? list[0] : mergeGeometries(list)
    if (!geo) continue
    geo.computeBoundingSphere()
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
}
