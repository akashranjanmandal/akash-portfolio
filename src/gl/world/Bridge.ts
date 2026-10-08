import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Physics } from '../Physics'
import { BRIDGE, WATER_LEVEL } from './Layout'
import { glowTexture } from '../textures'

/* ──────────────────────────────────────────────────────────────
   HOWRAH BRIDGE
   A toy version of Kolkata's cantilever bridge: two tall towers on
   the banks, the top chord swooping down to the suspended span in
   the middle, K-truss webbing, portal beams over the road — and a
   necklace of lights along the top at night.
────────────────────────────────────────────────────────────── */

const X0 = -57
const X1 = -23
const HALF = 4.7 // distance of each truss from the road centre line

function strut(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const len = a.distanceTo(b)
  const g = new THREE.BoxGeometry(t, t, len)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize())
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))
  g.applyMatrix4(m)
  return g
}

export class Bridge {
  readonly group = new THREE.Group()
  private lights: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private lampMat: THREE.MeshStandardMaterial

  constructor(physics: Physics) {
    const z0 = BRIDGE.z
    const top = new THREE.SplineCurve([
      new THREE.Vector2(X0, 1.6), new THREE.Vector2(-52, 6.5), new THREE.Vector2(-47, 15.5), new THREE.Vector2(-43.6, 10.2),
      new THREE.Vector2(-40, 8.6), new THREE.Vector2(-36.4, 10.2), new THREE.Vector2(-33, 15.5), new THREE.Vector2(-28, 6.5), new THREE.Vector2(X1, 1.6),
    ])
    const yTop = (x: number) => {
      // sample the spline by x
      let best = top.getPoint(0)
      let bd = Infinity
      for (let i = 0; i <= 200; i++) {
        const p = top.getPoint(i / 200)
        const d = Math.abs(p.x - x)
        if (d < bd) {
          bd = d
          best = p
        }
      }
      return best.y
    }
    const parts: THREE.BufferGeometry[] = []
    const lightPts: number[] = []
    const step = 1.7
    const xs: number[] = []
    for (let x = X0; x <= X1 + 0.01; x += step) xs.push(x)
    for (const side of [-1, 1]) {
      const z = z0 + side * HALF
      const bottomY = 0.35
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const yt = yTop(x)
        const isTower = Math.abs(x + 47) < 0.9 || Math.abs(x + 33) < 0.9
        // vertical
        parts.push(strut(new THREE.Vector3(x, bottomY, z), new THREE.Vector3(x, yt, z), isTower ? 0.75 : 0.22))
        if (i < xs.length - 1) {
          const xn = xs[i + 1]
          const ytn = yTop(xn)
          // top and bottom chords
          parts.push(strut(new THREE.Vector3(x, yt, z), new THREE.Vector3(xn, ytn, z), 0.42))
          parts.push(strut(new THREE.Vector3(x, bottomY, z), new THREE.Vector3(xn, bottomY, z), 0.5))
          // K-truss diagonals
          const midY = (yt + ytn) / 2
          if (midY > 2.2) {
            parts.push(strut(new THREE.Vector3(x, bottomY, z), new THREE.Vector3(xn, ytn * 0.55 + bottomY * 0.45, z), 0.16))
            parts.push(strut(new THREE.Vector3(x, yt * 0.55 + bottomY * 0.45, z), new THREE.Vector3(xn, ytn, z), 0.16))
          }
        }
        if (i % 2 === 0) lightPts.push(x, yt + 0.35, z)
      }
      // towers rise above the chord
      for (const tx of [-47, -33]) {
        parts.push(strut(new THREE.Vector3(tx, 15, z), new THREE.Vector3(tx, 18.2, z), 0.6))
        const spire = new THREE.ConeGeometry(0.5, 1.4, 4).translate(tx, 18.9, z)
        parts.push(spire)
        lightPts.push(tx, 19.8, z)
      }
    }
    // portal beams and lateral bracing over the road (only where it clears the taxi)
    for (const x of xs) {
      const yt = yTop(x)
      if (yt < 7) continue
      parts.push(strut(new THREE.Vector3(x, yt, z0 - HALF), new THREE.Vector3(x, yt, z0 + HALF), 0.2))
    }
    for (const tx of [-47, -33]) {
      for (const y of [12.5, 17.6]) parts.push(strut(new THREE.Vector3(tx, y, z0 - HALF), new THREE.Vector3(tx, y, z0 + HALF), 0.55))
      parts.push(strut(new THREE.Vector3(tx, 12.5, z0 - HALF), new THREE.Vector3(tx, 17.6, z0 + HALF), 0.25))
      parts.push(strut(new THREE.Vector3(tx, 12.5, z0 + HALF), new THREE.Vector3(tx, 17.6, z0 - HALF), 0.25))
    }
    // deck girder under the road, visible from the river
    parts.push(new THREE.BoxGeometry(X1 - X0 + 2, 1.1, HALF * 2 + 1.2).translate((X0 + X1) / 2, -0.58, z0))
    // footpaths outside the trusses
    for (const side of [-1, 1]) {
      parts.push(new THREE.BoxGeometry(X1 - X0, 0.2, 1.4).translate((X0 + X1) / 2, 0.1, z0 + side * (HALF + 0.8)))
      parts.push(new THREE.BoxGeometry(X1 - X0, 0.5, 0.08).translate((X0 + X1) / 2, 0.55, z0 + side * (HALF + 1.45)))
    }
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!
    merged.computeVertexNormals()
    const steel = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.55, metalness: 0.55 })
    const mesh = new THREE.Mesh(merged, steel)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    // stone piers on the banks
    for (const tx of [-47, -33]) {
      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6, 2.2), new THREE.MeshStandardMaterial({ color: '#8e8576', roughness: 0.9 }))
        pier.position.set(tx, WATER_LEVEL - 2.4, z0 + side * HALF)
        pier.castShadow = true
        this.group.add(pier)
      }
    }

    // lamps along the chords
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPts, 3))
    this.lights = new THREE.Points(lg, new THREE.PointsMaterial({ color: '#ffe2a6', size: 1.6, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }))
    this.lights.renderOrder = 4
    this.group.add(this.lights)
    this.lampMat = steel

    // colliders: railings along the deck and the tower legs
    for (const side of [-1, 1]) {
      physics.box((X0 + X1) / 2, 0.8, z0 + side * (HALF - 0.1), (X1 - X0) / 2, 0.8, 0.2)
      for (const tx of [-47, -33]) physics.box(tx, 4, z0 + side * HALF, 0.45, 4, 0.45)
    }
  }

  update(night: number) {
    const on = Math.max(0, (night - 0.3) / 0.5)
    this.lights.material.opacity = Math.min(1, on)
    this.lights.visible = on > 0.01
    this.lampMat.emissive.setRGB(0.05 * on, 0.06 * on, 0.08 * on)
  }
}
