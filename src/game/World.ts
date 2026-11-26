import * as THREE from 'three'
import { RAPIER, type Physics } from './Physics'
import type { Assets } from './Assets'
import type { Quality } from './Engine'
import { noise2, rng } from '../utils/math'
import { Forest } from './Foliage'
import { Town } from './city/Town'
import { Howrah, riverDepth, STATION } from './city/Howrah'
import { Traffic, kerbSpots } from './Traffic'
import { FairyLights } from './city/Fairy'
import { buildPortal } from './hills/Portal'
import { Transit } from './city/Transit'
import { ChunkedTerrain, terrainMaterial, microDetail } from './Terrain'
import { smoothstep } from '../utils/math'
import { Landmarks } from './city/Landmarks'
import { PLOTS, plotFrame, SPAWN, SIGHTS, inTown, GRID, HIGHWAY, districtAt, railDist } from './city/Plan'

/* ──────────────────────────────────────────────────────────────
   WORLD (metres)
   A big island: a flat town core where the roads and buildings are,
   rolling hills towards the rim, beaches, then open sea.
────────────────────────────────────────────────────────────── */

export const SIZE = 1800 // terrain extent
export const SEA = -1.6
const SEG = 360

/** terrain height at (x, z) — flat town, hills at the rim, beach, seabed */
export function heightAt(x: number, z: number) {
  return groundAt(x, z) - riverDepth(x)
}

/** distance from (x, z) to the "land" rectangle: the town, the river, the station and the memorial road */
const LAND = { x0: -385, x1: 410, z0: -345, z1: 410 }
function landDist(x: number, z: number) {
  const dx = Math.max(LAND.x0 - x, 0, x - LAND.x1)
  const dz = Math.max(LAND.z0 - z, 0, z - LAND.z1)
  return Math.hypot(dx, dz)
}

function groundAt(x: number, z: number) {
  const g = baseGround(x, z)
  // the bypass is built on a flat strip that blends back into the land
  const hz = z > HIGHWAY.z0 - 120 && z < HIGHWAY.z1 + 40 ? Math.abs(x - HIGHWAY.x) : 999
  if (hz < 40) {
    const t = Math.min(1, Math.max(0, (hz - 24) / 14))
    return -0.08 * (1 - t) + g * t
  }
  // the ring flyover's ramps start at ground level just under the road surface, so grass never grows through them
  if (x > -230 && x < 420 && z > -236 && z < -194) {
    const dz = Math.max(0, -232 - z, z + 198)
    const t = Math.min(1, Math.max(0, (dz - 2) / 14))
    return -0.3 * (1 - t) + g * t
  }
  // the railway circuit sits on a flat strip all the way round
  const rd = railDist(x, z)
  if (rd < 26) {
    const t = Math.min(1, Math.max(0, (rd - 13) / 13))
    return -0.08 * (1 - t) + g * t
  }
  return g
}

function baseGround(x: number, z: number) {
  // r = 300 on the edge of the land, then hills, then the sea, wherever you leave it from
  const r = 300 + landDist(x, z)
  const n = noise2(x * 0.006 + 11, z * 0.006 - 4) * 0.65 + noise2(x * 0.02, z * 0.02) * 0.35
  // under the paved town the ground sits just below the asphalt; undulation starts outside it
  if (inTown(x, z)) return -0.08
  const flat = r < 300 ? 0 : (noise2(x * 0.01, z * 0.01) - 0.5) * 0.6 * Math.min(1, (r - 300) / 40)
  if (r < 360) return flat
  if (r < 470) {
    const t = (r - 360) / 110
    return flat + Math.pow(t, 1.6) * (14 + n * 46)
  }
  if (r < 560) {
    const t = (r - 470) / 90
    const top = 14 + n * 46
    return top * (1 - t) + (SEA - 2) * t
  }
  return SEA - 6 - (r - 560) * 0.05
}

/** Instance every mesh of a model, split into 120 m grid chunks so off-screen chunks are culled. */
function instanceModel(group: THREE.Group, src: THREE.Object3D, matrices: THREE.Matrix4[], cast = true) {
  if (!matrices.length) return
  src.updateMatrixWorld(true)
  const CHUNK = 120
  const cells = new Map<string, THREE.Matrix4[]>()
  const p = new THREE.Vector3()
  for (const m of matrices) {
    p.setFromMatrixPosition(m)
    const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`
    let arr = cells.get(key)
    if (!arr) cells.set(key, (arr = []))
    arr.push(m)
  }
  src.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const list of cells.values()) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length)
      list.forEach((mat, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mat, mesh.matrixWorld)))
      inst.castShadow = cast
      inst.receiveShadow = true
      inst.computeBoundingSphere()
      group.add(inst)
    }
  })
}

export class World {
  readonly group = new THREE.Group()
  spawn = { pos: new THREE.Vector3(SPAWN.x, 0.2, SPAWN.z), yaw: SPAWN.yaw }
  private sea!: THREE.Mesh
  forest: Forest | null = null
  town!: Town
  landmarks!: Landmarks
  howrah!: Howrah
  traffic!: Traffic
  fairy!: FairyLights
  transit!: Transit
  /** positions the traffic should brake for besides the player (e.g. the player's taxi) */
  obstacles: THREE.Vector3[] = []
  night = 0
  private lampGlow!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private lampLights: THREE.PointLight[] = []
  private lampTimer = 0
  /** static chunks that are switched off beyond the draw distance */
  private cullables: { m: THREE.Mesh; c: THREE.Vector3; r: number }[] = []
  private cullTimer = 0

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private physics: Physics, private assets: Assets, private quality: Quality) {
    scene.add(this.group)
  }

  build() {
    this.buildTerrain()
    this.buildSea()
    this.town = new Town(this.physics, this.assets)
    this.town.build()
    this.group.add(this.town.group)
    buildPortal(this.group, this.physics, this.town.mats, { x: HIGHWAY.x, z: HIGHWAY.z0, dir: -1, roadY: 0, width: 28, length: 80, title: 'NH-12 · TO THE HILLS', sub: 'Darjeeling · Singalila · Sandakphu', rock: this.assets.material('rocky_terrain_02', 1) })
    // lamp heads glow after dark; a small pool of real lights follows the player
    const heads = this.town.lampPositions.flatMap((p) => [p.x, 5.95, p.z])
    const hg = new THREE.BufferGeometry()
    hg.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3))
    const halo = document.createElement('canvas')
    halo.width = halo.height = 64
    const hc = halo.getContext('2d')!
    const hgrd = hc.createRadialGradient(32, 32, 0, 32, 32, 32)
    hgrd.addColorStop(0, 'rgba(255,238,205,0.9)')
    hgrd.addColorStop(0.12, 'rgba(255,214,150,0.45)')
    hgrd.addColorStop(0.4, 'rgba(255,190,110,0.1)')
    hgrd.addColorStop(1, 'rgba(255,180,90,0)')
    hc.fillStyle = hgrd
    hc.fillRect(0, 0, 64, 64)
    this.lampGlow = new THREE.Points(hg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(halo), color: '#ffffff', size: 1.7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    this.lampGlow.visible = false
    this.group.add(this.lampGlow)
    const count = this.quality.tier === 'high' ? 4 : this.quality.tier === 'mid' ? 2 : 0
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight('#ffc87a', 0, 26, 1.6)
      this.lampLights.push(l)
      this.group.add(l)
    }
    // an invisible fence along the hill crests (a rounded rectangle around the land) so nobody drives into the sea
    {
      const D = 150
      const pts: [number, number][] = []
      const x0 = LAND.x0 - D, x1 = LAND.x1 + D, z0 = LAND.z0 - D, z1 = LAND.z1 + D
      for (let x = x0; x < x1; x += 50) pts.push([x, z0])
      for (let z = z0; z < z1; z += 50) pts.push([x1, z])
      for (let x = x1; x > x0; x -= 50) pts.push([x, z1])
      for (let z = z1; z > z0; z -= 50) pts.push([x0, z])
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i]
        const [bx, bz] = pts[(i + 1) % pts.length]
        const mx = (ax + bx) / 2, mz = (az + bz) / 2
        // leave the tunnel to the hills open
        if (az === z0 && bz === z0 && mx > HIGHWAY.x - 60 && mx < HIGHWAY.x + 60) continue
        this.physics.fixedBox(mx, heightAt(mx, mz) + 5, mz, 0.5, 14, Math.hypot(bx - ax, bz - az) / 2 + 1, Math.atan2(bx - ax, bz - az))
      }
    }
    this.howrah = new Howrah(this.physics, this.town.mats)
    this.traffic = new Traffic(this.physics, this.quality.tier === 'low' ? 6 : 12)
    this.traffic.park(kerbSpots(PLOTS.map((p) => plotFrame(p)), 14), this.physics)
    this.group.add(this.traffic.group)
    this.group.add(this.howrah.group)
    this.landmarks = new Landmarks(this.physics, this.town.mats, this.assets.images, this.assets.models, this.quality.tier === 'high' ? 4 : this.quality.tier === 'mid' ? 3 : 2)
    this.landmarks.build()
    for (const s of SIGHTS) this.landmarks.spots.push({ id: s.id, title: s.label, sub: s.sub, pos: new THREE.Vector3(s.x, 0, s.z), yaw: 0 })
    this.group.add(this.landmarks.group)
    this.transit = new Transit(this.physics, this.town.mats)
    this.group.add(this.transit.group)
    for (const g of [this.town.group, this.landmarks.group]) {
      for (const o of g.children) {
        const m = o as THREE.Mesh
        if (!m.isMesh) continue
        m.updateMatrixWorld(true)
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
        const bs = m.geometry.boundingSphere!
        this.cullables.push({ m, c: bs.center.clone().applyMatrix4(m.matrixWorld), r: bs.radius })
      }
    }
    // one point cloud for every fairy-light string in town and on the landmarks
    this.fairy = new FairyLights({ pos: [...this.town.fairyBuf.pos, ...this.landmarks.fairy.pos], col: [...this.town.fairyBuf.col, ...this.landmarks.fairy.col] })
    this.group.add(this.fairy.points)
    this.scatter()
  }

  private terrain!: ChunkedTerrain

  private buildTerrain() {
    // visible ground: chunks at three levels of detail, with a little micro-relief on the hills
    const detailed = (x: number, z: number, detail: number) => {
      const h = heightAt(x, z)
      return h > 2 ? h + microDetail(x, z, detail * (0.2 + 0.9 * smoothstep(8, 50, h))) : h
    }
    this.terrain = new ChunkedTerrain({ x0: -SIZE / 2, z0: -SIZE / 2, x1: SIZE / 2, z1: SIZE / 2 }, 150, [{ cell: 3.75, dist: 230, detail: 1 }, { cell: 7.5, dist: 620, detail: 0.5 }, { cell: 18.75, dist: 1e9, detail: 0 }], detailed, terrainMaterial(this.assets, false))
    this.group.add(this.terrain.group)
    this.terrain.prime(new THREE.Vector3(SPAWN.x, 0, SPAWN.z))

    // heightfield collider (Rapier wants column-major heights)
    const n = SEG + 1
    const heights = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = -SIZE / 2 + (j / SEG) * SIZE
        const z = -SIZE / 2 + (i / SEG) * SIZE
        heights[j * n + i] = heightAt(x, z)
      }
    }
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.physics.world.createCollider(RAPIER.ColliderDesc.heightfield(SEG, SEG, heights, { x: SIZE, y: 1, z: SIZE }), body)
  }

  private buildSea() {
    const geo = new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ color: '#1f5f7a', roughness: 0.08, metalness: 0.2, normalMap: this.assets.textures.get('metal_plate')?.normalMap ?? null })
    if (mat.normalMap) {
      mat.normalMap = mat.normalMap.clone()
      mat.normalMap.repeat.set(900, 900)
      mat.normalMap.needsUpdate = true
      mat.normalScale.set(0.15, 0.15)
    }
    this.sea = new THREE.Mesh(geo, mat)
    this.sea.position.y = SEA
    this.group.add(this.sea)
  }

  private scatter() {
    const r = rng(77)
    const pick = (count: number, test: (x: number, z: number) => boolean, scale = 1) => {
      const out: THREE.Matrix4[] = []
      for (let i = 0; i < count * 20 && out.length < count; i++) {
        const x = -20 + (r() - 0.5) * 1300
        const z = 20 + (r() - 0.5) * 1200
        if (!test(x, z)) continue
        const y = heightAt(x, z)
        if (y < SEA + 1.2) continue
        const s = (0.85 + r() * 0.5) * scale
        out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s, s, s)))
      }
      return out
    }
    // trees grow outside the town, or in the green middle of a block away from landmarks
    const plots = PLOTS.map((p) => { const f = plotFrame(p); return { x: f.x - f.fx * p.d / 2, z: f.z - f.fz * p.d / 2, r: Math.max(p.w, p.d) / 2 + 6 } })
    const inBlockMiddle = (x: number, z: number) => {
      const bx = ((x % 100) + 100) % 100 - 50
      const bz = ((z % 100) + 100) % 100 - 50
      return Math.abs(bx) < 22 && Math.abs(bz) < 22
    }
    const offRoad = (x: number, z: number) => {
      if (riverDepth(x) > 0 || riverDepth(x - 6) > 0 || riverDepth(x + 6) > 0) return false
      if (x < -200 && Math.abs(z) < 12) return false
      if (Math.abs(x - STATION.x) < 26 && Math.abs(z - STATION.z) < 56) return false
      if (districtAt(x, z)) return false
      if (z > -240 && z < -190) return false
      if (railDist(x, z) < 16) return false
      if (Math.abs(x - HIGHWAY.x) < 90 && z > HIGHWAY.z0 - 120 && z < HIGHWAY.z1 + 30) return false
      const town = inTown(x, z, 5)
      if (town && !inBlockMiddle(x, z)) return false
      return !plots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r)
    }
    const d = this.quality.density
    const trees1 = pick(Math.round(220 * d), offRoad, 2.3)
    const trees2 = pick(Math.round(160 * d), offRoad, 2.4)
    const tree1 = this.assets.models.get('island_tree_01')?.scene
    const tree2 = this.assets.models.get('island_tree_02')?.scene
    // shade trees along the pavements, between the lamps — Kolkata's avenues are green tunnels
    const avenue: THREE.Matrix4[] = []
    const kerb = 50 - 5 - 1.0
    const centres = GRID.slice(0, -1).map((g, i) => (g + GRID[i + 1]) / 2)
    for (const cx of centres) {
      for (const cz of centres) {
        for (const t of [-23, 23]) {
          for (const [px, pz] of [[cx + t, cz + kerb], [cx + t, cz - kerb], [cx + kerb, cz + t], [cx - kerb, cz + t]]) {
            if (r() < 0.45) continue
            if (plots.some((p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < (p.r + 2) ** 2)) continue
            const s = 1.05 + r() * 0.25
            avenue.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.15, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s, s * 1.3, s)))
          }
        }
      }
    }
    trees1.push(...avenue, ...this.town.districts.trees)
    if (tree1 && tree2) {
      this.forest = new Forest(this.renderer, this.scene.environment, [tree1, tree2], [
        ...trees1.map((matrix) => ({ model: 0, matrix })),
        ...trees2.map((matrix) => ({ model: 1, matrix })),
      ], this.quality.tier === 'high' ? 45 : this.quality.tier === 'mid' ? 28 : -1)
      this.group.add(this.forest.group)
    }
    for (const m of [...trees1, ...trees2]) {
      const p = new THREE.Vector3().setFromMatrixPosition(m)
      this.physics.fixedCylinder(p.x, p.y + 2, p.z, 0.5, 4)
    }
    const shrubs = pick(Math.round(260 * d), offRoad, 1.4)
    const shrub = this.assets.models.get('shrub_01')?.scene
    if (shrub) instanceModel(this.group, shrub, shrubs, false)

  }

  update(dt: number, t: number, player: THREE.Vector3) {
    this.cullTimer -= dt
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.25
      const far = this.quality.tier === 'high' ? 250 : this.quality.tier === 'mid' ? 190 : 140
      for (const e of this.cullables) e.m.visible = Math.hypot(e.c.x - player.x, e.c.z - player.z) - e.r < far
    }
    this.terrain.update(player, dt)
    this.town.update(dt)
    this.transit.update(dt, this.night)
    this.town.tram?.setNight(this.night)
    const tram = this.town.tram?.group.position
    this.traffic.update(dt, player, tram ? [...this.obstacles, tram] : this.obstacles, this.night)
    this.forest?.update(player)
    this.landmarks.update(t, this.night, player)
    this.howrah.update(this.night)
    this.fairy.update(t, this.night)
    this.town.setNight(this.night)
    const lit = this.night > 0.3
    this.lampGlow.visible = lit
    this.lampTimer -= dt
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.4
      const near = lit ? [...this.town.lampPositions].sort((a, b) => a.distanceToSquared(player) - b.distanceToSquared(player)).slice(0, this.lampLights.length) : []
      this.lampLights.forEach((l, i) => {
        const p = near[i]
        // never toggle .visible on lights: it changes the light count and recompiles every shader
        l.intensity = p ? 26 * this.night : 0
        if (p) l.position.set(p.x, 5.6, p.z)
      })
    }
    const n = (this.sea.material as THREE.MeshStandardMaterial).normalMap
    if (n) n.offset.set(t * 0.002, t * 0.0014)
  }
}
