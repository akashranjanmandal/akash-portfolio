import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { storage } from '../../utils/dom'
import { glowTexture } from '../textures'

/* ──────────────────────────────────────────────────────────────
   BUGS
   Twelve glowing ladybugs hide around the island. Drive over one to
   fix it. Find them all: zero bugs in production.
────────────────────────────────────────────────────────────── */

export const BUG_SPOTS: [number, number][] = [
  [-62, 40], // behind the letters
  [-70, 13], // by the village pond
  [-66, -27], // in the paddy field
  [-96, -52], // deep in the tea garden
  [-24, -49], // under the bridge's east end
  [-6, -72], // behind GOBT HQ, right on the edge
  [38, -20], // in a city alley
  [24, 6], // on the cricket pitch
  [-52, -71], // at the waterfall lip
  [101, -10], // behind the observatory
  [60, 2], // on top of the stunt ramp
  [-30, 29], // on the lake's south shore
]

function bugGeometry() {
  const shell = new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.78, 1.22)
  const color = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return g
  }
  const parts: THREE.BufferGeometry[] = [color(shell.toNonIndexed(), '#ff3b4e')]
  const head = new THREE.SphereGeometry(0.2, 12, 8).scale(1, 0.8, 0.9).translate(0, 0.06, 0.52)
  parts.push(color(head.toNonIndexed(), '#16131a'))
  const seam = new THREE.BoxGeometry(0.035, 0.34, 1.0).translate(0, 0.17, 0)
  parts.push(color(seam.toNonIndexed(), '#16131a'))
  for (const [x, z, r] of [[0.2, 0.18, 0.08], [-0.2, 0.18, 0.08], [0.22, -0.2, 0.07], [-0.22, -0.2, 0.07], [0.12, -0.38, 0.05], [-0.12, -0.38, 0.05]]) {
    const y = Math.sqrt(Math.max(0, 1 - (x / 0.42) ** 2 - (z / 0.51) ** 2)) * 0.33
    parts.push(color(new THREE.SphereGeometry(r, 8, 6).scale(1, 0.4, 1).translate(x, y, z).toNonIndexed(), '#16131a'))
  }
  for (const sx of [-1, 1]) {
    for (const z of [-0.22, 0, 0.22]) {
      const leg = new THREE.BoxGeometry(0.3, 0.035, 0.035).translate(sx * 0.48, 0.02, z)
      parts.push(color(leg.toNonIndexed(), '#16131a'))
    }
    const ant = new THREE.BoxGeometry(0.025, 0.025, 0.3).rotateY(sx * 0.4).rotateX(-0.6).translate(sx * 0.1, 0.2, 0.72)
    parts.push(color(ant.toNonIndexed(), '#16131a'))
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

export class Bugs {
  readonly group = new THREE.Group()
  readonly spots = BUG_SPOTS.map(([x, z]) => ({ x, z, found: false }))
  private mesh: THREE.InstancedMesh
  private rings: THREE.InstancedMesh
  private beams: THREE.InstancedMesh
  private pop: number[] = BUG_SPOTS.map(() => 0)
  private readonly o = new THREE.Object3D()
  private beamMaterial: THREE.MeshBasicMaterial

  constructor() {
    const saved = storage.get('akash:bugs')
    if (saved) {
      try {
        const arr = JSON.parse(saved) as number[]
        arr.forEach((i) => this.spots[i] && (this.spots[i].found = true))
      } catch {
        /* ignore corrupt progress */
      }
    }
    const n = BUG_SPOTS.length
    this.mesh = new THREE.InstancedMesh(bugGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, emissive: '#ff2040', emissiveIntensity: 0.15 }), n)
    this.mesh.castShadow = true
    this.rings = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,80,110,1)', 'rgba(255,60,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }),
      n,
    )
    this.beamMaterial = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0, side: THREE.DoubleSide })
    this.beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 14, 8, 1, true).translate(0, 7, 0), this.beamMaterial, n)
    this.rings.renderOrder = 1
    this.beams.renderOrder = 6
    this.group.add(this.mesh, this.rings, this.beams)
    this.layout(0)
  }

  get foundCount() {
    return this.spots.filter((s) => s.found).length
  }

  /** beacons only make sense while driving */
  setBeacons(on: boolean) {
    this.beamMaterial.opacity = on ? 0.55 : 0
    this.beams.visible = on
  }

  /** returns the index of a bug the car just touched, or -1 */
  collect(x: number, z: number): number {
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i]
      if (s.found) continue
      if ((s.x - x) ** 2 + (s.z - z) ** 2 < 2.3 * 2.3) {
        s.found = true
        this.pop[i] = 1
        storage.set('akash:bugs', JSON.stringify(this.spots.map((b, k) => (b.found ? k : -1)).filter((k) => k >= 0)))
        return i
      }
    }
    return -1
  }

  reset() {
    this.spots.forEach((s) => (s.found = false))
    storage.set('akash:bugs', '[]')
  }

  update(dt: number, elapsed: number) {
    this.layout(elapsed, dt)
  }

  private layout(t: number, dt = 0) {
    const o = this.o
    this.spots.forEach((s, i) => {
      let scale = s.found ? 0 : 1
      if (this.pop[i] > 0) {
        this.pop[i] = Math.max(0, this.pop[i] - dt * 2.5)
        scale = this.pop[i] > 0.6 ? 1 + (1 - this.pop[i]) * 2 : this.pop[i] * 2
      }
      const y = s.x === 60 && s.z === 2 ? 2.6 : 0.32
      o.position.set(s.x, y + Math.sin(t * 3 + i) * 0.08, s.z)
      o.rotation.set(0, t * 0.8 + i, 0)
      o.scale.setScalar(Math.max(0.0001, scale * 1.15))
      o.updateMatrix()
      this.mesh.setMatrixAt(i, o.matrix)
      o.position.set(s.x, y - 0.25 + 0.02, s.z)
      o.rotation.set(0, 0, 0)
      o.scale.setScalar(s.found ? 0.0001 : 1 + Math.sin(t * 4 + i) * 0.12)
      o.updateMatrix()
      this.rings.setMatrixAt(i, o.matrix)
      o.position.set(s.x, y - 0.3, s.z)
      o.scale.setScalar(s.found ? 0.0001 : 1)
      o.updateMatrix()
      this.beams.setMatrixAt(i, o.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
    this.rings.instanceMatrix.needsUpdate = true
    this.beams.instanceMatrix.needsUpdate = true
  }
}

function beamTexture() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 0, 128)
  grd.addColorStop(0, 'rgba(255,90,120,0)')
  grd.addColorStop(1, 'rgba(255,90,120,0.9)')
  g.fillStyle = grd
  g.fillRect(0, 0, 16, 128)
  const t = new THREE.CanvasTexture(c)
  return t
}
