import * as THREE from 'three'
import { road, ROAD_WIDTH, BRIDGE, ANCHORS } from './Layout'
import { roadTexture, kerbTexture, glowTexture } from '../textures'
import type { Physics } from '../Physics'

/* The road ribbon, the striped kerbs and the street lamps that
   switch on at dusk. */

type Profile = [number, number][] // [lateral, height] pairs; consecutive pairs form faces

function ribbon(profile: Profile, vScale: number, side: 1 | -1) {
  const n = road.count
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const k = profile.length
  for (let i = 0; i <= n; i++) {
    const p = road.points[i % n]
    const t = road.tangents[i % n]
    const rx = -t.z
    const rz = t.x
    const v = (i / n) * road.length * vScale
    for (let j = 0; j < k; j++) {
      const [lat, h] = profile[j]
      const o = side * (ROAD_WIDTH / 2) + side * lat
      positions.push(p.x + rx * o, h, p.z + rz * o)
      uvs.push(j / (k - 1), v)
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k - 1; j += 2) {
      const a = i * k + j
      const b = a + 1
      const c = a + k
      const d = b + k
      // winding depends on which edge we are on
      if (side === 1) indices.push(a, b, c, b, d, c)
      else indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export class RoadMesh {
  readonly group = new THREE.Group()
  readonly lampHeads: THREE.InstancedMesh
  private glow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private pools: THREE.InstancedMesh
  private headMaterial: THREE.MeshLambertMaterial
  readonly lampPositions: THREE.Vector3[] = []

  constructor() {
    // asphalt
    const n = road.count
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const p = road.points[i % n]
      const t = road.tangents[i % n]
      const rx = -t.z
      const rz = t.x
      const v = ((i / n) * road.length) / 8
      pos.push(p.x - rx * ROAD_WIDTH / 2, 0.04, p.z - rz * ROAD_WIDTH / 2, p.x + rx * ROAD_WIDTH / 2, 0.04, p.z + rz * ROAD_WIDTH / 2)
      uv.push(0, v, 1, v)
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const asphalt = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: roadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    asphalt.receiveShadow = true
    asphalt.name = 'road'
    this.group.add(asphalt)

    // kerbs: inner face, top, outer face
    const kerbProfile: Profile = [
      [0, 0.02], [0, 0.17],
      [0, 0.17], [0.42, 0.17],
      [0.42, 0.17], [0.42, 0.0],
    ]
    const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTexture() })
    for (const side of [1, -1] as const) {
      const k = new THREE.Mesh(ribbon(kerbProfile, 1 / 4, side), kerbMat)
      k.receiveShadow = true
      this.group.add(k)
    }

    // street lamps
    const stops = ANCHORS.map((a) => a.pos)
    const spots: { p: THREE.Vector3; yaw: number }[] = []
    let side = 1
    for (let d = 10; d < road.length - 4; d += 23) {
      const s = road.sample(d)
      side = -side
      const onBridge = s.pos.x > BRIDGE.x0 - 6 && s.pos.x < BRIDGE.x1 + 6 && Math.abs(s.pos.z - BRIDGE.z) < 8
      if (onBridge) continue
      if (stops.some((p) => p.distanceTo(s.pos) < 9)) continue
      const off = ROAD_WIDTH / 2 + 1.1
      const p = s.pos.clone().addScaledVector(s.right, side * off)
      // arm reaches towards the road
      const toRoad = s.right.clone().multiplyScalar(-side)
      spots.push({ p, yaw: Math.atan2(toRoad.x, toRoad.z) })
    }

    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 4.6, 8).translate(0, 2.3, 0)
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.35).translate(0, 4.5, 0.6)
    const baseGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.35, 8).translate(0, 0.17, 0)
    const poleMerged = mergeSimple([poleGeo, armGeo, baseGeo])
    const poles = new THREE.InstancedMesh(poleMerged, new THREE.MeshLambertMaterial({ color: '#3b3f4a' }), spots.length)
    this.headMaterial = new THREE.MeshLambertMaterial({ color: '#f2efe6', emissive: '#ffcf7a', emissiveIntensity: 0 })
    const headGeo = new THREE.BoxGeometry(0.34, 0.12, 0.62).translate(0, 4.44, 1.22)
    this.lampHeads = new THREE.InstancedMesh(headGeo, this.headMaterial, spots.length)
    const o = new THREE.Object3D()
    const glowPos: number[] = []
    const poolGeo = new THREE.PlaneGeometry(5.5, 5.5).rotateX(-Math.PI / 2)
    this.pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,214,150,1)', 'rgba(255,190,110,0)'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      spots.length,
    )
    spots.forEach((s, i) => {
      o.position.copy(s.p)
      o.rotation.set(0, s.yaw, 0)
      o.updateMatrix()
      poles.setMatrixAt(i, o.matrix)
      this.lampHeads.setMatrixAt(i, o.matrix)
      const head = new THREE.Vector3(0, 4.3, 1.22).applyMatrix4(o.matrix)
      glowPos.push(head.x, head.y, head.z)
      this.lampPositions.push(s.p.clone())
      o.position.set(head.x, 0.07, head.z)
      o.rotation.set(0, 0, 0)
      o.updateMatrix()
      this.pools.setMatrixAt(i, o.matrix)
    })
    poles.castShadow = true
    this.group.add(poles, this.lampHeads, this.pools)
    this.pools.renderOrder = 1

    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3))
    this.glow = new THREE.Points(
      gg,
      new THREE.PointsMaterial({ map: glowTexture(), size: 3.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    )
    this.glow.renderOrder = 4
    this.group.add(this.glow)
  }

  addColliders(physics: Physics) {
    for (const p of this.lampPositions) physics.cylinder(p.x, 2.3, p.z, 0.16, 4.6, 8)
  }

  update(night: number) {
    const on = Math.max(0, Math.min(1, (night - 0.25) / 0.4))
    this.headMaterial.emissiveIntensity = on * 2.2
    this.glow.material.opacity = on * 0.85
    ;(this.pools.material as THREE.MeshBasicMaterial).opacity = on * 0.42
    this.glow.visible = on > 0.01
    this.pools.visible = on > 0.01
  }
}

/** merge non-indexed-compatible geometries (all indexed or all not) */
export function mergeSimple(geos: THREE.BufferGeometry[]) {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let offset = 0
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute
    const nrm = g.attributes.normal as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset)
    else for (let i = 0; i < p.count; i++) indices.push(i + offset)
    offset += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  out.setIndex(indices)
  return out
}
