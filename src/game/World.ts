import * as THREE from 'three'
import { RAPIER, type Physics } from './Physics'
import type { Assets } from './Assets'
import type { Quality } from './Engine'
import { noise2, rng } from '../utils/math'
import { Forest } from './Foliage'

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
  // the town is dead flat (roads and buildings sit on y = 0); undulation starts outside it
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
  spawn = { pos: new THREE.Vector3(0, 0, 40), yaw: 0 }
  private sea!: THREE.Mesh
  forest: Forest | null = null

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private physics: Physics, private assets: Assets, private quality: Quality) {
    scene.add(this.group)
  }

  build() {
    this.buildTerrain()
    this.buildSea()
    this.buildRoad()
    this.buildTestBlock()
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

  private buildRoad() {
    // a test boulevard; the full network comes with the city layout
    const asphalt = this.assets.material('asphalt_02', [3, 60], { roughness: 1 })
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 220).rotateX(-Math.PI / 2), asphalt)
    road.position.set(0, 0.06, -40)
    road.receiveShadow = true
    this.group.add(road)
    const kerbMat = this.assets.material('concrete_tiles', [1, 40])
    for (const sx of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 220), kerbMat)
      walk.position.set(sx * 6.1, 0.09, -40)
      walk.receiveShadow = true
      walk.castShadow = true
      this.group.add(walk)
      this.physics.fixedBox(sx * 6.1, 0.09, -40, 1.6, 0.09, 110)
    }
    // lane markings
    const dash = new THREE.MeshStandardMaterial({ color: '#e9e5d6', roughness: 0.6 })
    for (let z = -148; z < 68; z += 9) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4).rotateX(-Math.PI / 2), dash)
      d.position.set(0, 0.075, z)
      this.group.add(d)
    }
  }

  private buildTestBlock() {
    // a two-storey Kolkata shophouse to judge materials
    const brick = this.assets.material('red_brick_03', [4, 2.4])
    const plaster = this.assets.material('plastered_wall_02', [3, 2], { color: '#f2dcae' })
    const b = new THREE.Group()
    b.position.set(-16, 0, -30)
    this.group.add(b)
    const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 7.5, 10), [plaster, plaster, plaster, plaster, plaster, plaster])
    walls.position.y = 3.75
    walls.castShadow = walls.receiveShadow = true
    b.add(walls)
    const base = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.2, 10.2), brick)
    base.position.y = 0.6
    base.castShadow = base.receiveShadow = true
    b.add(base)
    const door = this.assets.instance('rollershutter_door')
    door.position.set(0, 0, 5.05)
    b.add(door)
    this.physics.fixedBox(-16, 3.75, -30, 6, 3.75, 5)
  }

  private scatter() {
    const r = rng(77)
    const pick = (count: number, test: (x: number, z: number) => boolean, scale = 1) => {
      const out: THREE.Matrix4[] = []
      for (let i = 0; i < count * 20 && out.length < count; i++) {
        const x = (r() - 0.5) * 900
        const z = (r() - 0.5) * 780
        if (!test(x, z)) continue
        const y = heightAt(x, z)
        if (y < SEA + 1.2) continue
        const s = (0.85 + r() * 0.5) * scale
        out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s, s, s)))
      }
      return out
    }
    const offRoad = (x: number, z: number) => Math.abs(x) > 12 && !(x < -8 && x > -25 && z < -22 && z > -38)
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

    // street lamps along the test boulevard
    const lamp = this.assets.models.get('street_lamp_01')?.scene
    if (lamp) {
      const mats: THREE.Matrix4[] = []
      for (let z = -140; z < 60; z += 24) {
        for (const sx of [-1, 1]) {
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(sx * 6.9, 0.18, z + (sx > 0 ? 12 : 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sx > 0 ? -Math.PI / 2 : Math.PI / 2), new THREE.Vector3(1, 1, 1)))
        }
      }
      instanceModel(this.group, lamp, mats)
    }
    const bench = this.assets.instance('painted_wooden_bench')
    bench.position.set(7.2, 0.18, 20)
    bench.rotation.y = -Math.PI / 2
    this.group.add(bench)
    const hydrant = this.assets.instance('fire_hydrant')
    hydrant.position.set(-5.4, 0.18, 10)
    this.group.add(hydrant)
    const bin = this.assets.instance('metal_trash_can')
    bin.position.set(5.2, 0.18, 4)
    this.group.add(bin)
  }

  update(_dt: number, t: number, player: THREE.Vector3) {
    this.forest?.update(player)
    const n = (this.sea.material as THREE.MeshStandardMaterial).normalMap
    if (n) n.offset.set(t * 0.002, t * 0.0014)
  }
}
