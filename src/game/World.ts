import * as THREE from 'three'
import { RAPIER, type Physics } from './Physics'
import type { Assets } from './Assets'
import type { Quality } from './Engine'
import { noise2, rng } from '../utils/math'
import { Forest } from './Foliage'
import { Town } from './city/Town'
import { PLOTS, plotFrame, SPAWN } from './city/Plan'

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

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private physics: Physics, private assets: Assets, private quality: Quality) {
    scene.add(this.group)
  }

  build() {
    this.buildTerrain()
    this.buildSea()
    this.town = new Town(this.physics, this.assets)
    this.town.build()
    this.group.add(this.town.group)
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
      const town = Math.abs(x) < 215 && Math.abs(z) < 215
      if (town && !inBlockMiddle(x, z)) return false
      return !plots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r)
    }
    const d = this.quality.density
    const trees1 = pick(Math.round(220 * d), offRoad, 2.3)
    const trees2 = pick(Math.round(160 * d), offRoad, 2.4)
    const tree1 = this.assets.models.get('island_tree_01')?.scene
    const tree2 = this.assets.models.get('island_tree_02')?.scene
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
    const shrubs = pick(Math.round(420 * d), offRoad, 1.4)
    const shrub = this.assets.models.get('shrub_01')?.scene
    if (shrub) instanceModel(this.group, shrub, shrubs)
    const rocks = pick(Math.round(60 * d), offRoad)
    const boulder = this.assets.models.get('boulder_01')?.scene
    if (boulder) instanceModel(this.group, boulder, rocks)

  }

  update(_dt: number, t: number, player: THREE.Vector3) {
    this.forest?.update(player)
    const n = (this.sea.material as THREE.MeshStandardMaterial).normalMap
    if (n) n.offset.set(t * 0.002, t * 0.0014)
  }
}
