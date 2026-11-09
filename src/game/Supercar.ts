import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { mergeByMaterial } from './merge'

/* ──────────────────────────────────────────────────────────────
   SUPERCARS
   Sketchfab cars come in all sizes, units and orientations. This
   normalises one into what the vehicle code expects: real length,
   wheels on y = 0, nose along -Z, and the four wheels found by
   shape and re-parented into holders named wheel_fl/fr/rl/rr so
   they can spin and steer.
────────────────────────────────────────────────────────────── */

export type CarSpec = {
  id: string
  name: string
  model: string
  /** real length in metres */
  length: number
  /** set when the model's nose points the other way */
  flip?: boolean
  credit: string
}

export const GARAGE: CarSpec[] = [
  { id: 'bugatti', name: 'Bugatti Bolide', model: 'car-bugatti', length: 4.76, flip: true, credit: 'Kevin Love SketchFab, CC BY 4.0' },
  { id: 'jesko', name: 'Koenigsegg Jesko Attack', model: 'car-jesko', length: 4.61, credit: 'amogusstrikesback2, CC BY 4.0' },
  { id: 'lambo', name: 'Lamborghini Centenario', model: 'car-lambo', length: 4.92, flip: true, credit: 'amogusstrikesback2, CC BY 4.0' },
  { id: 'bmw', name: 'BMW 3.0 CSL Hommage R', model: 'car-bmw', length: 4.6, flip: true, credit: 'Ddiaz Design, CC BY-NC-SA 4.0' },
]

export type Supercar = {
  model: THREE.Group
  width: number
  height: number
  setNight: (n: number, braking?: boolean) => void
}

const NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']

export function buildSupercar(gltf: GLTF, spec: CarSpec): Supercar {
  const src = gltf.scene.clone(true)
  // drop lower LODs, damaged-panel variants, fake shadow planes and armature helpers
  const drop: THREE.Object3D[] = []
  src.traverse((o) => {
    if (/LOD_[B-Z]|_LOD[1-9]|DAMAGE|BROKEN|shattered|_Glow_|shadow|plane_ao|ground/i.test(o.name)) drop.push(o)
  })
  for (const o of drop) if (o.parent) o.removeFromParent()

  const holder = new THREE.Group() // orientation + scale
  holder.add(src)
  src.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(src)
  let size = box.getSize(new THREE.Vector3())
  // long side onto Z
  if (size.x > size.z) holder.rotation.y = Math.PI / 2
  if (spec.flip) holder.rotation.y += Math.PI
  holder.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(holder)
  size = box.getSize(new THREE.Vector3())
  const s = spec.length / size.z
  holder.scale.setScalar(s)
  holder.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(holder)
  const c = box.getCenter(new THREE.Vector3())
  holder.position.set(-c.x, -box.min.y, -c.z)

  const model = new THREE.Group()
  model.add(holder)
  model.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(model)
  size = box.getSize(new THREE.Vector3())

  // find the wheels: round in side view, near the ground, out at the corners
  const groups: THREE.Mesh[][] = [[], [], [], []]
  const lamps: THREE.MeshStandardMaterial[] = []
  const tails: THREE.MeshStandardMaterial[] = []
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    const mat = m.material as THREE.MeshStandardMaterial
    if (mat && /head|lamp|light|led|drl/i.test(mat.name + m.name) && !/tail|rear|brake/i.test(mat.name + m.name)) lamps.push(mat)
    if (mat && /tail|rear_?light|brake/i.test(mat.name + m.name)) tails.push(mat)
    const b = new THREE.Box3().setFromObject(m)
    const bs = b.getSize(new THREE.Vector3())
    const bc = b.getCenter(new THREE.Vector3())
    const round = bs.y > 0.35 && bs.y < 1.0 && Math.abs(bs.y - bs.z) < bs.y * 0.3 && bs.x < 0.6
    const corner = Math.abs(bc.x) > size.x * 0.22 && Math.abs(bc.z) > size.z * 0.18 && b.min.y < 0.15
    if (round && corner) groups[(bc.z < 0 ? 0 : 2) + (bc.x < 0 ? 0 : 1)].push(m)
  })
  const found = groups.every((g) => g.length > 0)
  if (!found) {
    // wheels merged into shared meshes: carve them out by geometry
    const split = splitWheels(model, size)
    if (split) {
      for (let i = 0; i < 4; i++) model.add(split[i])
      return finish()
    }
  }
  for (let i = 0; i < 4; i++) {
    const h = new THREE.Group()
    h.name = NAMES[i]
    if (found) {
      const b = new THREE.Box3()
      for (const m of groups[i]) b.expandByObject(m)
      b.getCenter(h.position)
      model.add(h)
      h.updateMatrixWorld(true)
      for (const m of groups[i]) h.attach(m)
    } else {
      // no separable wheels: estimate the axles so the physics still has four corners
      h.position.set((i % 2 ? 1 : -1) * (size.x / 2 - 0.3), 0.36, (i < 2 ? -1 : 1) * size.z * 0.31)
      model.add(h)
    }
  }
  return finish()

  function finish(): Supercar {
  const holders = NAMES.map((n) => model.getObjectByName(n)!).filter(Boolean)
  mergeByMaterial(model, holders)
  for (const h of holders) mergeByMaterial(h)
  for (const m of lamps) {
    if (!m.emissive) continue
    m.emissive.set('#fff3dd')
  }
  return {
    model,
    width: size.x,
    height: size.y,
    setNight(n: number, braking = false) {
      for (const m of lamps) if (m.emissive) m.emissiveIntensity = 0.3 + (n > 0.3 ? n * 3 : 0)
      for (const m of tails) if (m.emissive) {
        m.emissive.set('#ff2a1a')
        m.emissiveIntensity = (braking ? 3 : 0.3) + (n > 0.3 ? n * 1.5 : 0)
      }
    },
  }
  }
}

/** geometry in the model's frame, non-indexed, with just position / normal / uv */
function bake(m: THREE.Mesh, root: THREE.Object3D) {
  const inv = root.matrixWorld.clone().invert()
  const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
  // expand quantized / interleaved attributes to plain floats FIRST: transforming a
  // normalized int16 attribute in place would clamp every coordinate to [-1, 1]
  const g = new THREE.BufferGeometry()
  for (const k of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(k) as THREE.BufferAttribute | undefined
    if (!a) continue
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) out[i * a.itemSize + j] = a.getComponent(i, j)
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize))
  }
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
  return g
}

function pick(g: THREE.BufferGeometry, tris: number[]) {
  const out = new THREE.BufferGeometry()
  for (const k of Object.keys(g.attributes)) {
    const a = g.getAttribute(k) as THREE.BufferAttribute
    const n = a.itemSize
    const arr = new Float32Array(tris.length * 3 * n)
    tris.forEach((t, i) => arr.set((a.array as Float32Array).subarray(t * 3 * n, t * 3 * n + 3 * n), i * 3 * n))
    out.setAttribute(k, new THREE.BufferAttribute(arr, n))
  }
  return out
}

/**
 * For cars whose four wheels live inside shared meshes: find the axles from the tyre
 * mesh, then move every low-slung triangle inside a wheel's cylinder into that wheel.
 */
function splitWheels(model: THREE.Group, size: THREE.Vector3): THREE.Group[] | null {
  model.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  model.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh))
  const tyre = meshes.find((m) => /tire|tyre/i.test(m.name + ' ' + (m.material as THREE.Material).name))
  if (!tyre) return null
  const tg = bake(tyre, model)
  const p = tg.getAttribute('position') as THREE.BufferAttribute
  const boxes = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3(), new THREE.Box3()]
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    // only the tyres themselves: low down and out towards the axles
    if (v.y > 0.9 || Math.abs(v.z) < size.z * 0.2 || Math.abs(v.x) < size.x * 0.2) continue
    boxes[(v.z < 0 ? 0 : 2) + (v.x < 0 ? 0 : 1)].expandByPoint(v)
  }
  if (boxes.some((b) => b.isEmpty())) return null
  const wheels = boxes.map((b) => ({ c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).y / 2 }))
  const top = Math.max(...wheels.map((w) => w.c.y + w.r)) + 0.06
  const holders = wheels.map((w, i) => {
    const h = new THREE.Group()
    h.name = NAMES[i]
    h.position.copy(w.c)
    return h
  })
  const tri = new THREE.Vector3()
  for (const m of meshes) {
    const b = new THREE.Box3().setFromObject(m)
    if (b.max.y > top || /calli/i.test(m.name + (m.material as THREE.Material).name)) continue
    const g = bake(m, model)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const buckets: number[][] = [[], [], [], []]
    const rest: number[] = []
    for (let t = 0; t < pos.count / 3; t++) {
      tri.set(0, 0, 0)
      for (let k = 0; k < 3; k++) tri.add(v.fromBufferAttribute(pos, t * 3 + k))
      tri.multiplyScalar(1 / 3)
      const w = wheels.findIndex((w) => Math.hypot(tri.y - w.c.y, tri.z - w.c.z) < w.r * 1.02 && Math.abs(tri.x - w.c.x) < 0.42)
      if (w >= 0) buckets[w].push(t)
      else rest.push(t)
    }
    if (rest.length === pos.count / 3) continue
    buckets.forEach((list, i) => {
      if (!list.length) return
      const part = pick(g, list)
      part.translate(-wheels[i].c.x, -wheels[i].c.y, -wheels[i].c.z)
      const wm = new THREE.Mesh(part, m.material)
      wm.castShadow = true
      holders[i].add(wm)
    })
    // what's left stays on the body, now expressed in the model's frame
    const body = new THREE.Mesh(pick(g, rest), m.material)
    body.castShadow = true
    body.receiveShadow = true
    m.removeFromParent()
    model.add(body)
  }
  return holders
}
