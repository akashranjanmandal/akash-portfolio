import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { METRO, GHAT, RAIL_RECT, EDEN, inEden } from './Plan'
import { RAPIER, type Physics } from '../Physics'
import { rng } from '../../utils/math'

type Walker = { x: number; y: number; z: number; yaw: number; walk: number; phase: number; scale: number; width: number; look: number }
type Crowd = { people: Walker[]; parts: THREE.InstancedMesh[]; x: number; z: number }
const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 })
const skins = ['#9c674c', '#b88059', '#81513c', '#cd946e', '#a96d4e', '#744b39']
const fabrics = ['#16797a', '#e4bb68', '#a85050', '#6d8397', '#36566f', '#e0d5bc', '#724764', '#748356']
const hair = ['#282322', '#28201f', '#3f3029', '#d2c4ad', '#201d1c', '#535053']

// Bake each outfit once. Limbs have local pivots, so the whole crowd shares five instanced draws per outfit and area.
function outfit(style: number) {
  const skin = skins[style], top = fabrics[style], pants = ['#393e47', '#c8a478', '#625452'][style % 3]
  const shapes: THREE.BufferGeometry[][] = Array.from({ length: 5 }, () => [])
  function piece(part: number, geo: THREE.BufferGeometry, x: number, y: number, z: number, color: string, sx = 1, sy = 1, sz = 1, tilt = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo
    g.scale(sx, sy, sz).rotateZ(tilt).translate(x, y, z)
    g.deleteAttribute('uv')
    const c = new THREE.Color(color)
    const colors = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    shapes[part].push(g)
  }
  function form(part: number, profile: number[][], x: number, y: number, z: number, color: string, depth = 1) {
    piece(part, new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 12), x, y, z, color, 1, 1, depth)
  }
  const ball = () => new THREE.SphereGeometry(1, 12, 9)
  const sari = style === 0 || style === 2
  const tunic = style === 3 || style === 5
  form(0, [[0.13, 0.76], [0.182, 0.89], [0.15, 1.04], [0.202, 1.32], [0.185, 1.4], [0.075, 1.45]], 0, 0, 0, top, 0.7)
  form(0, [[0.07, 1.4], [0.068, 1.52]], 0, 0, 0, skin)
  piece(0, ball(), 0, 1.595, 0.01, skin, 0.106, 0.147, 0.105)
  piece(0, ball(), 0, 1.641, -0.012, hair[style], 0.11, 0.112, 0.103)
  piece(0, ball(), 0, 1.589, 0.105, skin, 0.027, 0.035, 0.028)
  for (const side of [-1, 1]) {
    piece(0, ball(), side * 0.04, 1.614, 0.104, '#38302b', 0.013, 0.007, 0.005)
    piece(0, ball(), side * 0.101, 1.588, -0.002, skin, 0.02, 0.032, 0.017)
  }
  if (sari || tunic) {
    form(0, [[0.205, sari ? 0.18 : 0.58], [0.195, 0.77], [0.155, 1.02]], 0, 0, 0, top, 0.79)
    form(0, [[0.207, sari ? 0.19 : 0.59], [0.206, sari ? 0.23 : 0.62]], 0, 0, 0, '#cfa45b', 0.8)
    if (sari) {
      piece(0, ball(), 0, 1.22, 0.111, fabrics[style + 5], 0.074, 0.265, 0.025, -0.57)
      piece(0, ball(), 0, 1.55, -0.102, hair[style], 0.078, 0.079, 0.061)
    }
  }
  if (style === 4 || style === 1) {
    piece(0, ball(), 0, 1.18, -0.16, '#424750', 0.15, 0.205, 0.085)
    for (const side of [-1, 1]) piece(0, ball(), side * 0.103, 1.29, 0.09, '#484945', 0.025, 0.15, 0.02)
  }
  for (const [index, side] of [-1, 1].entries()) {
    const leg = 1 + index, arm = 3 + index
    form(leg, [[0.052, -0.74], [0.065, -0.47], [0.072, -0.37], [0.09, -0.14], [0.087, 0]], 0, 0, 0, pants, 1.1)
    piece(leg, ball(), 0, -0.789, 0.037, '#443b36', 0.066, 0.052, 0.127)
    form(arm, [[0.047, -0.24], [0.064, -0.13], [0.067, -0.04], [0.04, 0.016]], 0, 0, 0, top)
    form(arm, [[0.032, -0.51], [0.05, -0.34], [0.047, -0.22]], 0, 0, 0.012, skin)
    piece(arm, ball(), 0, -0.546, 0.022, skin, 0.035, 0.055, 0.03)
    if (style === 5 && side === 1) piece(arm, new THREE.BoxGeometry(0.095, 0.25, 0.29), 0.02, -0.71, 0.04, '#764d32')
  }
  return shapes.map(parts => mergeGeometries(parts)!)
}

export class Pedestrians {
  readonly group = new THREE.Group()
  private crowds: Crowd[] = []
  private matrix = new THREE.Matrix4()
  private local = new THREE.Matrix4()
  private dt = 0

  constructor(physics: Physics, low: boolean) {
    const r = rng(1994)
    const outfits = Array.from({ length: 6 }, (_, i) => outfit(i))
    const cells = new Map<string, Walker[]>()
    const person = (x: number, y: number, z: number, yaw: number, walk = 0, child = false) => {
      if (low && r() < 0.28) return
      const position = { x: x + Math.sin(yaw) * walk / 2, y: y + 0.95, z: z + Math.cos(yaw) * walk / 2 }
      const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)
      if (physics.world.intersectionWithShape(position, rotation, new RAPIER.Cuboid(0.3, 0.72, walk / 2 + 0.22), RAPIER.QueryFilterFlags.ONLY_FIXED)) return
      const style = child ? 4 : Math.floor(r() * outfits.length)
      const key = [Math.floor(x / 85), Math.floor(z / 85), style].join(',')
      const people = cells.get(key) ?? []
      people.push({ x, y, z, yaw, walk, phase: r() * 65, scale: (child ? 0.72 : 0.98) + r() * 0.11, width: 0.87 + r() * 0.32, look: style })
      cells.set(key, people)
    }
    for (const station of METRO.stations) for (const side of [-1, 1]) {
      for (const [n, dz] of [-31, -26, -19, -12, -5, 1, 7].entries()) {
        person(METRO.x + side * (5.45 + r() * 0.9), METRO.platformY, station.z + dz, -side * Math.PI / 2 + (r() - 0.5) * 0.7, 0, n === 4)
      }
    }
    for (const side of [-1, 1]) {
      const z = RAIL_RECT.z1 + (side < 0 ? -5 : 11)
      for (let i = 0; i < 17; i++) person(64 + i * 8, 0.9, z + (r() - 0.5) * 0.8, i % 4 === 0 ? Math.PI / 2 : side < 0 ? 0 : Math.PI, i % 4 === 0 ? 4 : 0, i % 8 === 3)
      for (let i = 0; i < 10; i++) person(RAIL_RECT.x0 + (side < 0 ? -11 : 5), 0.9, -36 + i * 8, side > 0 ? -Math.PI / 2 : Math.PI / 2)
      for (let i = 0; i < 6; i++) person(88 + i * 16, 0.1, 414 + side * 1.5, side * Math.PI / 2, 6)
      for (let i = 0; i < 4; i++) person(-301 + i * 18, 0.445, side * 7.5, side * Math.PI / 2, 6)
      for (let i = 0; i < 9; i++) person(-88 + i * 21, 0.1, -262 + side * 1.65, side * Math.PI / 2, 6, i === 3)
      for (let i = 0; i < 5; i++) person(EDEN.x - 16 + i * 6, 0.19, EDEN.z + side * 86, side * Math.PI / 2, 2.2, i === 2)
    }
    for (const dx of [-12, 12]) {
      person(EDEN.x + dx, 0.27, EDEN.z + 1.6, dx < 0 ? Math.PI / 2 : -Math.PI / 2)
      person(EDEN.x + dx + 2.2, 0.23, EDEN.z + 3.6, Math.PI)
    }
    for (let i = 0; i < 14; i++) person(-225.6 + r() * 1.1, 0.125, GHAT.z0 + 4 + i * 5.4, i % 3 ? -Math.PI / 2 : 0, i % 3 ? 0 : 2, i % 6 === 2)
    for (const x of [-100, 0, 100, 200]) for (const z of [-150, -50, 50, 150, 250, 350]) {
      if (inEden(x, z)) continue
      person(x + 7.5, 0.15, z + 2, 0, 5)
      person(x - 7.6, 0.15, z + 15, Math.PI, 5)
    }
    for (const people of cells.values()) {
      const parts = outfits[people[0].look].map(g => {
        const mesh = new THREE.InstancedMesh(g, cloth, people.length)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        mesh.castShadow = mesh.receiveShadow = true
        this.group.add(mesh)
        return mesh
      })
      this.crowds.push({ people, parts, x: people[0].x, z: people[0].z })
    }
  }

  update(dt: number, time: number, player: THREE.Vector3) {
    this.dt -= dt
    if (this.dt > 0) return
    this.dt = 1 / 20
    for (const { people, parts, x, z } of this.crowds) {
      const near = Math.hypot(player.x - x, player.z - z) < 145
      for (const mesh of parts) mesh.visible = near
      if (!near) continue
      people.forEach((p, i) => {
        const t = time + p.phase
        const period = p.walk * 2 + 3
        const phase = t % period
        const distance = Math.min(p.walk, phase) - Math.min(p.walk, Math.max(0, phase - p.walk - 1.5))
        const backwards = phase > p.walk + 1.5
        const moving = p.walk > 0 && (phase < p.walk || (backwards && phase < period - 1.5))
        const yaw = p.yaw + (p.walk && backwards ? Math.PI : 0)
        const stride = moving ? Math.sin(t * 6.3) * 0.37 : 0
        this.matrix.makeRotationY(yaw).scale(this.scale.set(p.scale * p.width, p.scale, p.scale))
        this.matrix.setPosition(p.x + Math.sin(p.yaw) * distance, p.y + Math.abs(stride) * 0.035, p.z + Math.cos(p.yaw) * distance)
        parts[0].setMatrixAt(i, this.matrix)
        for (let limb = 1; limb <= 4; limb++) {
          const arm = limb > 2
          const side = limb % 2 ? -1 : 1
          this.local.makeRotationX((arm ? -1 : 1) * side * stride + (arm ? -0.09 : 0))
          this.local.setPosition(side * (arm ? 0.204 : 0.09), arm ? 1.38 : 0.835, 0)
          parts[limb].setMatrixAt(i, this.local.premultiply(this.matrix))
        }
      })
      for (const mesh of parts) mesh.instanceMatrix.needsUpdate = true
    }
  }

  private scale = new THREE.Vector3()
}
