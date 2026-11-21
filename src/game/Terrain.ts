import * as THREE from 'three'
import type { Assets } from './Assets'
import { noise2 } from '../utils/math'

/* ──────────────────────────────────────────────────────────────
   TERRAIN
   The ground is cut into square chunks, each drawn at one of three
   levels of detail depending on how far you are: fine, with real
   micro-relief, close by; coarse out in the distance. Skirts hide the
   cracks between levels. Normals come from the height function, so
   every level shades the same. One material, with triplanar rock on
   steep faces, serves the city's outskirts and the mountains.
────────────────────────────────────────────────────────────── */

export type HeightFn = (x: number, z: number, detail: number) => number

type Lod = { cell: number; dist: number; detail: number }

type Chunk = {
  cx: number
  cz: number
  x: number
  z: number
  mesh: (THREE.Mesh | null)[]
  shown: number
}

export class ChunkedTerrain {
  readonly group = new THREE.Group()
  private chunks: Chunk[] = []
  private timer = 0

  constructor(
    bounds: { x0: number; z0: number; x1: number; z1: number },
    private size: number,
    private lods: Lod[],
    private height: HeightFn,
    private material: THREE.Material,
    /** chunks wholly inside this rectangle are left to another terrain (the playable area) */
    skip?: { x0: number; z0: number; x1: number; z1: number },
  ) {
    const nx = Math.ceil((bounds.x1 - bounds.x0) / size)
    const nz = Math.ceil((bounds.z1 - bounds.z0) / size)
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = bounds.x0 + i * size
      const z = bounds.z0 + j * size
      if (skip && x >= skip.x0 - 0.01 && z >= skip.z0 - 0.01 && x + size <= skip.x1 + 0.01 && z + size <= skip.z1 + 0.01) continue
      this.chunks.push({ cx: i, cz: j, x, z, mesh: [null, null, null], shown: -1 })
    }
  }

  /** build the chunks around a point right away (a loading screen is the place for this) */
  prime(focus: THREE.Vector3) {
    this.update(focus, 0, true)
  }

  private build(c: Chunk, lod: number) {
    const L = this.lods[lod]
    const n = Math.round(this.size / L.cell)
    const stride = n + 1
    const pos = new Float32Array((stride * stride + 4 * stride) * 3)
    const nor = new Float32Array((stride * stride + 4 * stride) * 3)
    const E = 3
    const put = (k: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[k * 3 + 2] = z
      nor[k * 3] = nx
      nor[k * 3 + 1] = ny
      nor[k * 3 + 2] = nz
    }
    const h = this.height
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = c.x + i * L.cell
        const z = c.z + j * L.cell
        const y = h(x, z, L.detail)
        // the normal always comes from the finest sensible sampling, so every level shades alike
        const dx = h(x - E, z, L.detail) - h(x + E, z, L.detail)
        const dz = h(x, z - E, L.detail) - h(x, z + E, L.detail)
        const l = Math.hypot(dx, 2 * E, dz)
        put(j * stride + i, x, y, z, dx / l, (2 * E) / l, dz / l)
      }
    }
    // skirts: a strip dropping below each edge, so a coarser neighbour never shows a crack
    let k = stride * stride
    const skirtIdx: number[] = []
    const vert = (i: number, j: number) => j * stride + i
    const drop = Math.max(6, L.cell * 0.6)
    // (i, j) pairs along each of the four edges
    const runs: [number, number][][] = [
      Array.from({ length: stride }, (_, i) => [i, 0] as [number, number]),
      Array.from({ length: stride }, (_, i) => [i, n] as [number, number]),
      Array.from({ length: stride }, (_, j) => [0, j] as [number, number]),
      Array.from({ length: stride }, (_, j) => [n, j] as [number, number]),
    ]
    for (const run of runs) {
      const first = k
      for (const [i, j] of run) {
        const v = vert(i, j)
        put(k, pos[v * 3], pos[v * 3 + 1] - drop, pos[v * 3 + 2], nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2])
        k++
      }
      for (let t = 0; t < run.length - 1; t++) {
        const [ai, aj] = run[t]
        const [bi, bj] = run[t + 1]
        const a = vert(ai, aj)
        const b2 = vert(bi, bj)
        skirtIdx.push(a, b2, first + t, b2, first + t + 1, first + t)
        skirtIdx.push(a, first + t, b2, b2, first + t, first + t + 1) // both faces: the skirt is seen from either side
      }
    }
    const idx = new Uint32Array(n * n * 6 + skirtIdx.length)
    let t = 0
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = vert(i, j)
        const b = vert(i + 1, j)
        const cc = vert(i, j + 1)
        const d = vert(i + 1, j + 1)
        idx[t++] = a
        idx[t++] = cc
        idx[t++] = b
        idx[t++] = b
        idx[t++] = cc
        idx[t++] = d
      }
    }
    for (const s of skirtIdx) idx[t++] = s
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    const m = new THREE.Mesh(g, this.material)
    m.receiveShadow = true
    m.visible = false
    m.matrixAutoUpdate = false
    this.group.add(m)
    c.mesh[lod] = m
  }

  /** choose each chunk's level of detail from its distance to the focus; build lazily, a couple per call */
  update(focus: THREE.Vector3, dt: number, all = false) {
    this.timer -= dt
    if (this.timer > 0 && !all) return
    this.timer = 0.2
    const half = this.size / 2
    let budget = all ? 400 : 2
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.x + half - focus.x, c.z + half - focus.z) - half * 1.4)
      let lod = this.lods.length - 1
      for (let i = 0; i < this.lods.length - 1; i++) if (d < this.lods[i].dist) { lod = i; break }
      if (!c.mesh[lod]) {
        if (budget <= 0) continue
        // far chunks are only worth building when they are visible at all
        if (all && this.lods.length > 1 && d > this.lods[1].dist * 1.4 && lod !== this.lods.length - 1) continue
        this.build(c, lod)
        budget--
      }
      if (c.shown !== lod && c.mesh[lod]) {
        if (c.shown >= 0 && c.mesh[c.shown]) c.mesh[c.shown]!.visible = false
        c.mesh[lod]!.visible = true
        c.shown = lod
      }
    }
  }
}

/** value-noise relief: ridged, domain-warped, with an amplitude the caller controls */
export function relief(x: number, z: number) {
  const wx = x + 38 * noise2(x * 0.011 + 5, z * 0.011)
  const wz = z + 38 * noise2(x * 0.011 - 9, z * 0.011 + 2)
  let a = 0
  let w = 0.5
  let f = 0.014
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(noise2(wx * f + i * 7.1, wz * f - i * 3.3) * 2 - 1)
    a += w * (0.55 * n + 0.45 * n * n)
    w *= 0.5
    f *= 2.1
  }
  return a // 0..~1
}

/** fine ground detail in metres: bumps and rocks, never more than `amp` */
export function microDetail(x: number, z: number, amp: number) {
  if (amp <= 0) return 0
  const a = noise2(x * 0.21, z * 0.21) - 0.5
  const b = noise2(x * 0.53 + 3, z * 0.53 - 1) - 0.5
  const c = 1 - Math.abs(noise2(x * 0.09 + 11, z * 0.09) * 2 - 1)
  return amp * (a * 1.2 + b * 0.5 + (c - 0.5) * 1.6)
}

/** one ground material for city outskirts and mountains */
export function terrainMaterial(assets: Assets, hills: boolean) {
  const grass = assets.textures.get('aerial_grass_rock')
  const rock = assets.textures.get('rocky_terrain_02')
  const sand = assets.textures.get('coast_sand_rocks_02')
  const forest = assets.textures.get('forrest_ground_01')
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, map: grass?.map ?? null, normalMap: grass?.normalMap ?? null })
  mat.normalScale.set(0.8, 0.8)
  mat.customProgramCacheKey = () => (hills ? 'terrain-hills' : 'terrain-city')
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tRock = { value: rock?.map }
    shader.uniforms.tSand = { value: sand?.map }
    shader.uniforms.tForest = { value: forest?.map }
    shader.uniforms.uHills = { value: hills ? 1 : 0 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tRock; uniform sampler2D tSand; uniform sampler2D tForest; uniform float uHills;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        vec3 tri(sampler2D t, vec3 p, vec3 n, float s){
          vec3 w = pow(abs(n), vec3(5.0)); w /= (w.x + w.y + w.z + 1e-4);
          return texture2D(t, p.zy / s).rgb * w.x + texture2D(t, p.xz / s).rgb * w.y + texture2D(t, p.xy / s).rgb * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec3 N = normalize(vWNrm);
        vec2 xz = vWPos.xz;
        float slope = 1.0 - clamp(N.y, 0.0, 1.0);
        float alt = vWPos.y;
        // three scales of the same grass hide the tiling
        vec3 g1 = texture2D(map, xz / 6.0).rgb;
        vec3 g2 = texture2D(map, xz * 0.21 / 6.0 + 0.37).rgb;
        vec3 g3 = texture2D(map, xz * 0.047 / 6.0 + 0.11).rgb;
        vec3 grassC = mix(mix(g1, g2, 0.5), g3, 0.3);
        float macro = vn(xz * 0.01) * 0.6 + vn(xz * 0.04) * 0.4;
        vec3 rockC = tri(tRock, vWPos, N, 7.0);
        vec3 col;
        if (uHills > 0.5) {
          vec3 floorC = texture2D(tForest, xz / 5.0).rgb * vec3(0.62, 0.74, 0.5);
          vec3 forest = mix(grassC * vec3(0.5, 0.74, 0.42), floorC, 0.5) * mix(0.7, 1.12, macro);
          vec3 meadow = grassC * vec3(0.95, 0.86, 0.58) * mix(0.8, 1.15, macro);
          col = mix(forest, meadow, smoothstep(300.0, 480.0, alt + (macro - 0.5) * 90.0));
          // tea gardens: contour terraces on the gentler lower slopes, in patches
          float tea = smoothstep(0.08, 0.16, slope) * (1.0 - smoothstep(0.34, 0.5, slope)) * smoothstep(40.0, 110.0, alt) * (1.0 - smoothstep(330.0, 420.0, alt)) * smoothstep(0.5, 0.62, vn(xz * 0.005 + 3.0));
          float row = smoothstep(0.3, 0.7, abs(fract(alt * 0.4) - 0.5) * 2.0);
          vec3 teaC = mix(vec3(0.13, 0.3, 0.1), vec3(0.22, 0.43, 0.15), row) * mix(0.8, 1.2, vn(xz * 0.8));
          col = mix(col, teaC, tea * 0.9);
          float rockW = smoothstep(0.24, 0.42, slope) + smoothstep(480.0, 620.0, alt) * 0.5;
          col = mix(col, rockC * 1.5 * vec3(1.0, 0.97, 0.93), clamp(rockW, 0.0, 1.0));
          float snowLine = 610.0 + (macro - 0.5) * 150.0;
          float snow = smoothstep(snowLine - 40.0, snowLine + 70.0, alt) * (1.0 - smoothstep(0.55, 0.9, slope) * 0.7);
          float drift = vn(xz * 0.22) * 0.6 + vn(xz * 1.1) * 0.4;
          vec3 snowC = mix(vec3(0.70, 0.77, 0.92), vec3(0.98, 0.97, 0.98), clamp(drift * 0.9 + (N.y - 0.6) * 0.8, 0.0, 1.0));
          col = mix(col, snowC, snow);
        } else {
          vec3 dry = grassC * vec3(1.08, 0.94, 0.66);
          col = mix(grassC, dry, smoothstep(0.35, 0.7, macro)) * mix(0.78, 1.12, macro);
          float rockW = smoothstep(0.2, 0.4, slope) + smoothstep(22.0, 55.0, alt) * 0.5;
          col = mix(col, rockC * 0.95, clamp(rockW, 0.0, 1.0));
          vec3 sandC = texture2D(tSand, xz / 6.0).rgb;
          col = mix(col, sandC, 1.0 - smoothstep(-0.6, 1.4, alt));
        }
        diffuseColor.rgb *= col;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        vec3 mapN = texture2D( normalMap, vWPos.xz / 6.0 ).xyz * 2.0 - 1.0;
        // the flat-projected normal map is only right on gentle ground
        mapN.xy *= normalScale * smoothstep(0.55, 0.9, normalize(vWNrm).y);
        normal = normalize( tbn * mapN );`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;')
  }
  return mat
}
