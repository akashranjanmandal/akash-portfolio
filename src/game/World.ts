import * as THREE from 'three'
import { RAPIER, type Physics } from './Physics'
import type { Assets } from './Assets'
import type { Quality } from './Engine'
import { noise2, rng } from '../utils/math'
import { Forest } from './Foliage'
import { Town } from './city/Town'
import { Howrah, riverDepth, STATION } from './city/Howrah'
import { Traffic, kerbSpots } from './Traffic'
import { Landmarks } from './city/Landmarks'
import { PLOTS, plotFrame, SPAWN, SIGHTS } from './city/Plan'

/* ──────────────────────────────────────────────────────────────
   WORLD (metres)
   A big island: a flat town core where the roads and buildings are,
   rolling hills towards the rim, beaches, then open sea.
────────────────────────────────────────────────────────────── */

export const SIZE = 1400 // terrain extent
export const SEA = -1.6
const SEG = 280

/** terrain height at (x, z) — flat town, hills at the rim, beach, seabed */
export function heightAt(x: number, z: number) {
  return groundAt(x, z) - riverDepth(x)
}

function groundAt(x: number, z: number) {
  const r = Math.hypot(x / 1.15, z)
  const n = noise2(x * 0.006 + 11, z * 0.006 - 4) * 0.65 + noise2(x * 0.02, z * 0.02) * 0.35
  // under the paved town the ground sits just below the asphalt; undulation starts outside it
  if (Math.abs(x) < 208 && Math.abs(z) < 208) return -0.08
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
  /** positions the traffic should brake for besides the player (e.g. the player's taxi) */
  obstacles: THREE.Vector3[] = []
  night = 0
  private lampGlow!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private lampLights: THREE.PointLight[] = []
  private lampTimer = 0

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private physics: Physics, private assets: Assets, private quality: Quality) {
    scene.add(this.group)
  }

  build() {
    this.buildTerrain()
    this.buildSea()
    this.town = new Town(this.physics, this.assets)
    this.town.build()
    this.group.add(this.town.group)
    // lamp heads glow after dark; a small pool of real lights follows the player
    const heads = this.town.lampPositions.flatMap((p) => [p.x, 5.95, p.z])
    const hg = new THREE.BufferGeometry()
    hg.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3))
    const halo = document.createElement('canvas')
    halo.width = halo.height = 64
    const hc = halo.getContext('2d')!
    const hgrd = hc.createRadialGradient(32, 32, 0, 32, 32, 32)
    hgrd.addColorStop(0, 'rgba(255,230,180,1)')
    hgrd.addColorStop(0.25, 'rgba(255,200,120,0.6)')
    hgrd.addColorStop(1, 'rgba(255,180,90,0)')
    hc.fillStyle = hgrd
    hc.fillRect(0, 0, 64, 64)
    this.lampGlow = new THREE.Points(hg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(halo), color: '#ffffff', size: 3.2, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    this.lampGlow.visible = false
    this.group.add(this.lampGlow)
    const count = this.quality.tier === 'high' ? 6 : this.quality.tier === 'mid' ? 4 : 0
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight('#ffc87a', 0, 26, 1.6)
      this.lampLights.push(l)
      this.group.add(l)
    }
    // an invisible fence along the hill crests so nobody drives off into the sea
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2
      const a1 = ((i + 1) / 64) * Math.PI * 2
      const R = 455
      const x0 = Math.cos(a0) * R * 1.15, z0 = Math.sin(a0) * R
      const x1 = Math.cos(a1) * R * 1.15, z1 = Math.sin(a1) * R
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
      const len = Math.hypot(x1 - x0, z1 - z0)
      this.physics.fixedBox(mx, heightAt(mx, mz) + 5, mz, 0.5, 12, len / 2 + 1, Math.atan2(x1 - x0, z1 - z0))
    }
    this.howrah = new Howrah(this.physics, this.town.mats)
    this.traffic = new Traffic(this.physics, this.quality.tier === 'low' ? 6 : 12)
    this.traffic.park(kerbSpots(PLOTS.map((p) => plotFrame(p)), 14), this.physics)
    this.group.add(this.traffic.group)
    this.group.add(this.howrah.group)
    this.landmarks = new Landmarks(this.physics, this.town.mats, this.assets.images)
    this.landmarks.build()
    for (const s of SIGHTS) this.landmarks.spots.push({ id: s.id, title: s.label, sub: s.sub, pos: new THREE.Vector3(s.x, 0, s.z), yaw: 0 })
    this.group.add(this.landmarks.group)
    this.scatter()
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
    geo.computeVertexNormals()

    const grass = this.assets.textures.get('aerial_grass_rock')
    const rock = this.assets.textures.get('rocky_terrain_02')
    const sand = this.assets.textures.get('coast_sand_rocks_02')
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, map: grass?.map ?? null, normalMap: grass?.normalMap ?? null, roughnessMap: grass?.roughnessMap ?? null })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tRock = { value: rock?.map }
      shader.uniforms.tSand = { value: sand?.map }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNrm;
          uniform sampler2D tRock; uniform sampler2D tSand;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `
          vec2 uvW = vWPos.xz / 7.0;
          // two scales of the same texture hide the tiling
          vec3 g1 = texture2D(map, uvW).rgb;
          vec3 g2 = texture2D(map, uvW * 0.23 + 0.37).rgb;
          vec3 grassC = mix(g1, g2, 0.45);
          float macro = vn(vWPos.xz * 0.012) * 0.6 + vn(vWPos.xz * 0.05) * 0.4;
          grassC *= mix(0.78, 1.12, macro);
          vec3 rockC = texture2D(tRock, vWPos.xz / 9.0).rgb;
          vec3 sandC = texture2D(tSand, vWPos.xz / 6.0).rgb;
          float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
          float rockW = smoothstep(0.18, 0.35, slope) + smoothstep(18.0, 38.0, vWPos.y) * 0.6;
          float sandW = 1.0 - smoothstep(-0.6, 1.4, vWPos.y);
          vec3 col = mix(grassC, rockC, clamp(rockW, 0.0, 1.0));
          col = mix(col, sandC, sandW);
          diffuseColor.rgb *= col;`)
        .replace('#include <normal_fragment_maps>', `
          vec3 mapN = texture2D( normalMap, vWPos.xz / 7.0 ).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;`)
    }
    // the normal-map chunk above needs tangent-free TBN; give the material a valid normalScale
    mat.normalScale.set(0.8, 0.8)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.name = 'terrain'
    this.group.add(mesh)

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
        const x = (r() - 0.5) * 920
        const z = (r() - 0.5) * 800
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
      const town = Math.abs(x) < 215 && Math.abs(z) < 215
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
    for (const cx of [-150, -50, 50, 150]) {
      for (const cz of [-150, -50, 50, 150]) {
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
    trees1.push(...avenue)
    if (tree1 && tree2) {
      this.forest = new Forest(this.renderer, this.scene.environment, [tree1, tree2], [
        ...trees1.map((matrix) => ({ model: 0, matrix })),
        ...trees2.map((matrix) => ({ model: 1, matrix })),
      ])
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
    this.town.update(dt)
    this.town.tram?.setNight(this.night)
    const tram = this.town.tram?.group.position
    this.traffic.update(dt, player, tram ? [...this.obstacles, tram] : this.obstacles, this.night)
    this.forest?.update(player)
    this.landmarks.update(t, this.night)
    this.howrah.update(this.night)
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
