import * as THREE from 'three'
import type { Physics } from '../Physics'
import { CITY } from './Zones'
import { canvas, toTexture } from '../textures'
import { rng } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   CITY
   A block of old Kolkata: pastel walls, green louvred shutters,
   black water tanks on the roofs, and windows that light up one by
   one as dusk falls.
────────────────────────────────────────────────────────────── */

const PASTELS = ['#f2d48a', '#f3b8a0', '#bcd9b4', '#a9cbe0', '#efe6d2', '#e7c3d9', '#f6c96b', '#d9e3a6']

function facadeTextures() {
  // 8 × 8 window cells; each cell = one window on one floor
  const N = 8
  const S = 64
  const { c, g } = canvas(N * S, N * S)
  const { c: ec, g: eg } = canvas(N * S, N * S)
  eg.fillStyle = '#000'
  eg.fillRect(0, 0, N * S, N * S)
  const r = rng(99)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i * S
      const y = j * S
      g.fillStyle = '#ffffff'
      g.fillRect(x, y, S, S)
      // ledge
      g.fillStyle = 'rgba(0,0,0,0.12)'
      g.fillRect(x, y + S - 6, S, 6)
      // window with green shutters
      g.fillStyle = '#2b3240'
      g.fillRect(x + 20, y + 14, 24, 34)
      g.fillStyle = '#3f7a4f'
      g.fillRect(x + 10, y + 14, 10, 34)
      g.fillRect(x + 44, y + 14, 10, 34)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      for (let k = 0; k < 6; k++) {
        g.fillRect(x + 10, y + 17 + k * 5, 10, 1.5)
        g.fillRect(x + 44, y + 17 + k * 5, 10, 1.5)
      }
      if (r() < 0.42) {
        eg.fillStyle = r() < 0.7 ? '#ffd88a' : '#fff1cf'
        eg.fillRect(x + 20, y + 14, 24, 34)
      }
    }
  }
  const map = toTexture(c, { repeat: true })
  const emissive = toTexture(ec, { repeat: true })
  return { map, emissive, cells: N }
}

export class City {
  readonly group = new THREE.Group()
  private mat: THREE.MeshStandardMaterial

  constructor(physics: Physics) {
    const { map, emissive, cells } = facadeTextures()
    this.mat = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0, vertexColors: true, roughness: 0.85 })
    const roofMat = new THREE.MeshStandardMaterial({ color: '#b8b0a4', roughness: 0.95 })
    const tankMat = new THREE.MeshStandardMaterial({ color: '#1f1e24', roughness: 0.6 })
    const r = rng(2024)
    const positions: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    const roofs: THREE.BufferGeometry[] = []
    const tanks: THREE.Vector3[] = []

    const winW = 2.4 // metres per window column
    const floorH = 3.0
    const addFace = (corners: THREE.Vector3[], uMax: number, vMax: number, col: THREE.Color, u0: number, v0: number) => {
      // corners: bl, br, tr, tl
      const [bl, br, tr, tl] = corners
      const quad = [bl, br, tr, bl, tr, tl]
      const uv = [[0, 0], [uMax, 0], [uMax, vMax], [0, 0], [uMax, vMax], [0, vMax]]
      quad.forEach((p, k) => {
        positions.push(p.x, p.y, p.z)
        uvs.push((u0 + uv[k][0]) / cells, (v0 + uv[k][1]) / cells)
        colors.push(col.r, col.g, col.b)
      })
    }

    // two rows of buildings, facing north and south, with alleys between
    for (const [rowZ0, rowZ1] of [[CITY.z0, CITY.z0 + 6], [CITY.z1 - 6, CITY.z1]]) {
      let x = CITY.x0
      while (x < CITY.x1 - 4) {
        const w = 5 + r() * 4
        const d = rowZ1 - rowZ0 - r() * 1.2
        const h = floorH * (2 + Math.floor(r() * 3)) + 0.4
        const cx = x + w / 2
        const cz = rowZ1 === CITY.z1 ? rowZ1 - d / 2 : rowZ0 + d / 2
        const col = new THREE.Color(PASTELS[Math.floor(r() * PASTELS.length)])
        const x0 = cx - w / 2
        const x1 = cx + w / 2
        const z0 = cz - d / 2
        const z1 = cz + d / 2
        const u0 = Math.floor(r() * cells)
        const v0 = Math.floor(r() * cells)
        const cu = (len: number) => Math.max(1, Math.round(len / winW))
        const cv = h / floorH
        const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c)
        addFace([V(x0, 0, z1), V(x1, 0, z1), V(x1, h, z1), V(x0, h, z1)], cu(w), cv, col, u0, v0) // south
        addFace([V(x1, 0, z0), V(x0, 0, z0), V(x0, h, z0), V(x1, h, z0)], cu(w), cv, col, u0, v0) // north
        addFace([V(x1, 0, z1), V(x1, 0, z0), V(x1, h, z0), V(x1, h, z1)], cu(d), cv, col, u0, v0) // east
        addFace([V(x0, 0, z0), V(x0, 0, z1), V(x0, h, z1), V(x0, h, z0)], cu(d), cv, col, u0, v0) // west
        roofs.push(new THREE.BoxGeometry(w + 0.3, 0.5, d + 0.3).translate(cx, h + 0.25, cz))
        if (r() < 0.75) tanks.push(new THREE.Vector3(cx + (r() - 0.5) * (w - 2), h + 0.5, cz + (r() - 0.5) * (d - 2)))
        physics.box(cx, h / 2, cz, w / 2, h / 2, d / 2)
        x += w + 2 + r() * 2.5
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const walls = new THREE.Mesh(geo, this.mat)
    walls.castShadow = true
    walls.receiveShadow = true
    this.group.add(walls)
    for (const rg of roofs) {
      const m = new THREE.Mesh(rg, roofMat)
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
    }
    const tankGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14).translate(0, 0.55, 0)
    const tankMesh = new THREE.InstancedMesh(tankGeo, tankMat, tanks.length)
    const o = new THREE.Object3D()
    tanks.forEach((p, i) => {
      o.position.copy(p)
      o.updateMatrix()
      tankMesh.setMatrixAt(i, o.matrix)
    })
    tankMesh.castShadow = true
    this.group.add(tankMesh)
  }

  update(night: number) {
    this.mat.emissiveIntensity = Math.max(0, (night - 0.25) / 0.5) * 1.2
  }
}
