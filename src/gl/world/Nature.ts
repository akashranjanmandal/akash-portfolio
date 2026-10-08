import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Physics } from '../Physics'
import { onLand, roadDistance, LAKE, riverXAt, ANCHORS } from './Layout'
import { isClear, TEA, inRect, CLEARINGS, inCircle } from './Zones'
import { stopShot } from '../CameraRig'
import { rng } from '../../utils/math'

/* Every stop's camera looks along a line of sight; nothing tall may grow on it. */
const SIGHTLINES = ANCHORS.map((a) => {
  const s = stopShot(a)
  const t = s.pos.clone().lerp(s.target, 0.75)
  return { ax: s.pos.x, az: s.pos.z, bx: t.x, bz: t.z }
})

function nearSightline(x: number, z: number, r: number) {
  for (const l of SIGHTLINES) {
    const dx = l.bx - l.ax
    const dz = l.bz - l.az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / len2))
    const px = l.ax + dx * t
    const pz = l.az + dz * t
    // a wider berth around the camera itself (the shot pulls back on portrait screens)
    const rr = r + (1 - t) * 4
    if ((x - px) ** 2 + (z - pz) ** 2 < rr * rr) return true
  }
  return false
}

/* ──────────────────────────────────────────────────────────────
   NATURE
   Instanced scenery: round trees, coconut palms (thicker towards
   rural Bengal in the west), bushes, rocks, flowers, grass and the
   neat rows of an Assam tea garden.
────────────────────────────────────────────────────────────── */

const paint = (g: THREE.BufferGeometry, hex: string) => {
  const geo = g.index ? g.toNonIndexed() : g
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  geo.deleteAttribute('uv')
  return geo
}

function treeGeometry() {
  const parts = [
    paint(new THREE.CylinderGeometry(0.16, 0.26, 1.7, 6).translate(0, 0.85, 0), '#7b5236'),
    paint(new THREE.IcosahedronGeometry(1.25, 0).translate(0, 2.35, 0), '#5fae4a'),
    paint(new THREE.IcosahedronGeometry(0.95, 0).translate(0.55, 3.05, 0.2), '#73c257'),
    paint(new THREE.IcosahedronGeometry(0.8, 0).translate(-0.5, 2.95, -0.25), '#53a043'),
  ]
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = []
  // a gently curved trunk out of stacked, tilted segments
  let x = 0
  let y = 0
  const segs = 6
  for (let i = 0; i < segs; i++) {
    const h = 0.82
    const tilt = 0.06 + i * 0.035
    const seg = new THREE.CylinderGeometry(0.13 - i * 0.008, 0.16 - i * 0.008, h, 7).rotateZ(-tilt).translate(x + Math.sin(tilt) * h * 0.5, y + h / 2, 0)
    parts.push(paint(seg, i % 2 ? '#8a6a46' : '#7a5b3b'))
    x += Math.sin(tilt) * h
    y += Math.cos(tilt) * h * 0.98
  }
  // fronds: bent, tapered leaves radiating from the crown
  const fronds = 8
  for (let i = 0; i < fronds; i++) {
    const leaf = new THREE.PlaneGeometry(2.5, 0.55, 6, 1)
    const p = leaf.attributes.position as THREE.BufferAttribute
    for (let k = 0; k < p.count; k++) {
      const lx = p.getX(k) + 1.25 // 0 at the crown → 2.5 at the tip
      const taper = 1 - (lx / 2.5) * 0.85
      p.setY(k, p.getY(k) * taper)
      p.setZ(k, -0.32 * lx * lx * 0.45)
      p.setX(k, lx)
    }
    leaf.rotateX(-Math.PI / 2)
    leaf.rotateZ(0.25)
    leaf.rotateY((i / fronds) * Math.PI * 2 + (i % 2) * 0.2)
    leaf.translate(x, y + 0.05, 0)
    parts.push(paint(leaf, i % 2 ? '#4f9a3c' : '#5fb04a'))
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    parts.push(paint(new THREE.IcosahedronGeometry(0.13, 0).translate(x + Math.cos(a) * 0.17, y - 0.12, Math.sin(a) * 0.17), '#5b3f22'))
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

function bushGeometry() {
  const g = mergeGeometries([
    paint(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.75, 1).translate(0, 0.4, 0), '#5aa846'),
    paint(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.8, 1).translate(0.45, 0.35, 0.15), '#68b851'),
  ])!
  g.computeVertexNormals()
  return g
}

function teaGeometry() {
  const g = paint(new THREE.SphereGeometry(0.62, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.85, 1), '#3f8a3a')
  g.computeVertexNormals()
  return g
}

function grassGeometry() {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    parts.push(paint(new THREE.ConeGeometry(0.05, 0.42, 3).translate(Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07).rotateZ((i - 1) * 0.25), i ? '#4f9a3c' : '#6bb84f'))
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

export class Nature {
  readonly group = new THREE.Group()
  private grass?: THREE.InstancedMesh

  constructor(physics: Physics, density: number) {
    const r = rng(1234)
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    const leafMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true })
    const o = new THREE.Object3D()
    const tint = new THREE.Color()

    const scatter = (count: number, accept: (x: number, z: number) => boolean, roadClear = 5.2, tries = 30) => {
      const out: [number, number][] = []
      for (let i = 0; i < count * tries && out.length < count; i++) {
        const x = (r() - 0.5) * 206
        const z = (r() - 0.5) * 146
        if (!onLand(x, z, 2.5)) continue
        if (!accept(x, z)) continue
        if (roadDistance(x, z) < roadClear) continue
        if (out.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 4)) continue
        out.push([x, z])
      }
      return out
    }

    const nearWater = (x: number, z: number) => {
      const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.9
      const rx = riverXAt(z)
      return lake || (rx !== null && Math.abs(x - rx) < 14)
    }

    // trees: everywhere, a bit denser in the east and south — but never in a camera's way
    const treeSpots = scatter(Math.round(120 * density), (x, z) => isClear(x, z, 2) && !nearSightline(x, z, 5) && (x > -60 || r() < 0.35), 7.5)
    const trees = new THREE.InstancedMesh(treeGeometry(), mat, treeSpots.length)
    treeSpots.forEach(([x, z], i) => {
      const s = 0.8 + r() * 0.65
      o.position.set(x, 0, z)
      o.rotation.set(0, r() * Math.PI * 2, 0)
      o.scale.set(s, s * (0.9 + r() * 0.3), s)
      o.updateMatrix()
      trees.setMatrixAt(i, o.matrix)
      trees.setColorAt(i, tint.setHSL(0.27 + (r() - 0.5) * 0.05, 0.2 + r() * 0.15, 0.85 + r() * 0.15))
      physics.cylinder(x, 1, z, 0.32 * s, 2, 6)
    })
    trees.castShadow = true
    trees.receiveShadow = true
    this.group.add(trees)

    // palms: rural west, riverbanks, the lake
    const palmSpots = scatter(Math.round(70 * density), (x, z) => isClear(x, z, 1.5) && !nearSightline(x, z, 5) && (x < -45 || nearWater(x, z) || r() < 0.12), 7)
    const palms = new THREE.InstancedMesh(palmGeometry(), leafMat, palmSpots.length)
    palmSpots.forEach(([x, z], i) => {
      const s = 0.9 + r() * 0.5
      o.position.set(x, 0, z)
      o.rotation.set(0, r() * Math.PI * 2, 0)
      o.scale.setScalar(s)
      o.updateMatrix()
      palms.setMatrixAt(i, o.matrix)
      palms.setColorAt(i, tint.setRGB(0.92 + r() * 0.1, 0.95 + r() * 0.08, 0.9 + r() * 0.1))
      physics.cylinder(x, 1, z, 0.22 * s, 2, 6)
    })
    palms.castShadow = true
    this.group.add(palms)

    // bushes and rocks
    const bushSpots = scatter(Math.round(150 * density), (x, z) => isClear(x, z, 0.5) && !nearSightline(x, z, 2.5), 4.4)
    const bushes = new THREE.InstancedMesh(bushGeometry(), mat, bushSpots.length)
    bushSpots.forEach(([x, z], i) => {
      const s = 0.6 + r() * 0.8
      o.position.set(x, 0, z)
      o.rotation.set(0, r() * Math.PI * 2, 0)
      o.scale.setScalar(s)
      o.updateMatrix()
      bushes.setMatrixAt(i, o.matrix)
      bushes.setColorAt(i, tint.setHSL(0.28 + (r() - 0.5) * 0.06, 0.25, 0.85 + r() * 0.2))
    })
    bushes.castShadow = true
    this.group.add(bushes)

    const rockSpots = scatter(Math.round(46 * density), (x, z) => isClear(x, z, 0) || nearWater(x, z), 4.2)
    const rocks = new THREE.InstancedMesh(
      (() => {
        const g = paint(new THREE.DodecahedronGeometry(0.6, 0).scale(1.2, 0.6, 1), '#9a93a8')
        g.computeVertexNormals()
        return g
      })(),
      mat,
      rockSpots.length,
    )
    rockSpots.forEach(([x, z], i) => {
      const s = 0.5 + r() * 1.1
      o.position.set(x, 0.1 * s, z)
      o.rotation.set(r() * 0.4, r() * Math.PI * 2, r() * 0.4)
      o.scale.setScalar(s)
      o.updateMatrix()
      rocks.setMatrixAt(i, o.matrix)
      rocks.setColorAt(i, tint.setHSL(0.72, 0.06, 0.82 + r() * 0.18))
    })
    rocks.castShadow = true
    rocks.receiveShadow = true
    this.group.add(rocks)

    // flowers: little coloured dots in clusters
    const flowerColors = ['#ff6b8b', '#ffd23f', '#ffffff', '#ff8c42', '#c17bff', '#ff4d4d']
    const clusterSpots = scatter(Math.round(70 * density), (x, z) => isClear(x, z, 0), 3.8)
    const per = 9
    const flowers = new THREE.InstancedMesh(
      (() => {
        const g = paint(new THREE.IcosahedronGeometry(0.13, 0).translate(0, 0.2, 0), '#ffffff')
        g.computeVertexNormals()
        return g
      })(),
      mat,
      clusterSpots.length * per,
    )
    let fi = 0
    clusterSpots.forEach(([x, z]) => {
      const col = flowerColors[Math.floor(r() * flowerColors.length)]
      for (let k = 0; k < per; k++) {
        o.position.set(x + (r() - 0.5) * 2.2, 0, z + (r() - 0.5) * 2.2)
        o.rotation.set(0, 0, 0)
        o.scale.setScalar(0.8 + r() * 0.6)
        o.updateMatrix()
        flowers.setMatrixAt(fi, o.matrix)
        flowers.setColorAt(fi, tint.set(col))
        fi++
      }
    })
    this.group.add(flowers)

    // grass tufts
    const grassSpots = scatter(Math.round(700 * density), () => true, 3.6, 4)
    this.grass = new THREE.InstancedMesh(grassGeometry(), mat, grassSpots.length)
    grassSpots.forEach(([x, z], i) => {
      o.position.set(x, 0, z)
      o.rotation.set(0, r() * Math.PI * 2, 0)
      o.scale.setScalar(0.8 + r() * 0.9)
      o.updateMatrix()
      this.grass!.setMatrixAt(i, o.matrix)
      this.grass!.setColorAt(i, tint.setHSL(0.27, 0.2, 0.85 + r() * 0.25))
    })
    this.group.add(this.grass)

    // tea garden rows
    const tea: [number, number][] = []
    for (let z = TEA.z0 + 1.5; z < TEA.z1 - 1; z += 2.2) {
      for (let x = TEA.x0 + 1.4; x < TEA.x1 - 1; x += 1.7) {
        if (inRect(x, z, TEA) && onLand(x, z, 2) && !CLEARINGS.some((c) => inCircle(x, z, c, 1)) && roadDistance(x, z) > 5) tea.push([x + (r() - 0.5) * 0.3, z])
      }
    }
    const teaMesh = new THREE.InstancedMesh(teaGeometry(), mat, tea.length)
    tea.forEach(([x, z], i) => {
      o.position.set(x, 0, z)
      o.rotation.set(0, r() * 0.5, 0)
      o.scale.set(1, 0.9 + r() * 0.3, 1)
      o.updateMatrix()
      teaMesh.setMatrixAt(i, o.matrix)
      teaMesh.setColorAt(i, tint.setHSL(0.3, 0.3, 0.8 + r() * 0.2))
    })
    teaMesh.castShadow = true
    teaMesh.receiveShadow = true
    this.group.add(teaMesh)
  }

  update(_elapsed: number) {
    /* static for now */
  }
}
