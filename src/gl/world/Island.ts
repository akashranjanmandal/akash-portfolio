import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { ISLAND, WATER_LEVEL, BRIDGE, islandOutline, waterOutline, roundedRect, riverBanks, lakeOutline, LAKE, ROAD_WIDTH } from './Layout'
import { groundTexture } from '../textures'
import type { Physics } from '../Physics'
import { rng, noise2 } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   ISLAND
   The island slab (grass on top), a sandy beach running down into
   the sea that surrounds it, a ring of hills out in the water, the
   river and lake, and boulders along the rim that keep the taxi on land.
────────────────────────────────────────────────────────────── */

const waterVert = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const noiseGLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`

const waterFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uGlint;
  uniform float uFlow;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  void main() {
    vec2 p = vWorld.xz;
    // the river flows north; the lake and the sea only breathe
    float flow = smoothstep(4.0, -2.0, p.y) * uFlow;
    float offshore = smoothstep(110.0, 260.0, length(p * vec2(0.8, 1.1)));
    vec2 q = p * 0.16 + vec2(uTime * 0.015, uTime * -0.32 * flow);
    float n = vnoise(q) * 0.62 + vnoise(q * 2.4 + 7.0) * 0.38;
    vec3 col = mix(uDeep, uShallow, smoothstep(0.3, 0.85, n) * (1.0 - offshore * 0.7));
    float streak = smoothstep(0.74, 0.84, vnoise(vec2(p.x * 0.55, p.y * 0.07 + uTime * 0.8 * flow)));
    col = mix(col, uFoam, streak * 0.32 * (0.35 + flow) * uFlow);
    // gentle swell lines on the open sea, sun glints only close to shore
    float swell = smoothstep(0.62, 0.7, vnoise(vec2(p.x * 0.05 + uTime * 0.05, p.y * 0.18 - uTime * 0.12)));
    col = mix(col, uShallow, swell * 0.25 * (1.0 - uFlow) * (1.0 - offshore));
    float glint = pow(vnoise(p * 0.9 + vec2(uTime * 0.5, -uTime * 0.4)), 18.0) * 2.0 * (1.0 - offshore);
    col += uGlint * glint;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export class Island {
  readonly group = new THREE.Group()
  readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  readonly sea: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly dayDeep = new THREE.Color('#2a86bd')
  private readonly dayShallow = new THREE.Color('#5cc4e4')
  private readonly nightDeep = new THREE.Color('#121f48')
  private readonly nightShallow = new THREE.Color('#284886')

  constructor(textureSize: number, private density = 1) {
    this.group.add(this.buildSlab(textureSize))
    this.group.add(this.buildBeach())
    this.water = this.buildWater()
    this.group.add(this.water)
    this.sea = this.buildSea()
    this.group.add(this.sea)
    this.group.add(this.buildHills())
    this.group.add(this.buildBoulders())
  }

  private buildSlab(textureSize: number) {
    const outline = islandOutline()
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y)))
    const bevel = 0.7
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: ISLAND.depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 1,
      steps: 1,
    })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, -(ISLAND.depth + bevel), 0)

    // sides: grass lip, then soil strata darkening downwards
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const grass = new THREE.Color('#78ad52')
    const soil = new THREE.Color('#b0814f')
    const soil2 = new THREE.Color('#946640')
    const deep = new THREE.Color('#6f4d35')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const x = pos.getX(i)
      const z = pos.getZ(i)
      if (y > -0.35) c.copy(grass)
      else {
        const band = noise2(x * 0.15, z * 0.15) * 0.8
        const t = (-y - 0.35) / (ISLAND.depth + bevel)
        c.copy(soil).lerp(soil2, Math.min(1, t * 1.6 + band * 0.3))
        if (t > 0.55) c.lerp(deep, (t - 0.55) / 0.45)
        // a darker seam between strata
        if (Math.abs(((-y + band) % 1.6) - 0.8) < 0.08) c.multiplyScalar(0.86)
      }
      colors.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const top = new THREE.MeshLambertMaterial({ map: groundTexture(textureSize) })
    const side = new THREE.MeshLambertMaterial({ vertexColors: true })
    const mesh = new THREE.Mesh(geo, [top, side])
    mesh.receiveShadow = true
    mesh.name = 'island'
    return mesh
  }

  private buildWater() {
    const outline = waterOutline()
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y)))
    const geo = new THREE.ShapeGeometry(shape, 1)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, WATER_LEVEL, 0)
    const mat = this.waterMaterial(1)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'water'
    return mesh
  }

  private waterMaterial(flow: number) {
    return new THREE.ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uFlow: { value: flow },
          uDeep: { value: this.dayDeep.clone() },
          uShallow: { value: this.dayShallow.clone() },
          uFoam: { value: new THREE.Color('#e9f8ff') },
          uGlint: { value: new THREE.Color('#ffffff') },
        },
      ]),
    })
  }

  /** the open sea, reaching to the horizon */
  private buildSea() {
    const geo = new THREE.PlaneGeometry(2600, 2600, 1, 1).rotateX(-Math.PI / 2)
    geo.translate(0, WATER_LEVEL - 0.05, 0)
    const mesh = new THREE.Mesh(geo, this.waterMaterial(0))
    mesh.name = 'sea'
    mesh.renderOrder = -1
    return mesh
  }

  /** sand sloping from the grass down under the waves */
  private buildBeach() {
    const rim = roundedRect(ISLAND.halfX, ISLAND.halfZ, ISLAND.corner, 14)
    const n = rim.length
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const dry = new THREE.Color('#e6d39c')
    const wet = new THREE.Color('#b99f6b')
    const rings: [number, number][] = [[0.15, 0.02], [3.5, -0.55], [7, -1.25], [12, -2.6]]
    for (let i = 0; i < n; i++) {
      const p = rim[i]
      const q = rim[(i + 1) % n]
      const r = rim[(i - 1 + n) % n]
      const tx = q.x - r.x
      const tz = q.y - r.y
      const len = Math.hypot(tx, tz) || 1
      // outward normal of a clockwise (x,z) outline
      const nx = tz / len
      const nz = -tx / len
      rings.forEach(([out, y], k) => {
        const jitter = k === 0 ? 0 : Math.sin(i * 1.3 + k) * 0.6
        pos.push(p.x + nx * (out + jitter), y, p.y + nz * (out + jitter))
        const c = dry.clone().lerp(wet, k / (rings.length - 1))
        col.push(c.r, c.g, c.b)
      })
    }
    const R = rings.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      for (let k = 0; k < R - 1; k++) {
        const a = i * R + k
        const b = j * R + k
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    // if the winding came out facing down, flip it
    const nrm = geo.attributes.normal as THREE.BufferAttribute
    if (nrm.getY(0) < 0) {
      geo.setIndex(idx.map((_, i) => idx[i - (i % 3) + (2 - (i % 3))]))
      geo.computeVertexNormals()
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
    mesh.receiveShadow = true
    mesh.name = 'beach'
    return mesh
  }

  /** green hills rising out of the sea all around the island, and far mountains */
  private buildHills() {
    const group = new THREE.Group()
    const r = rng(404)
    const base = new THREE.IcosahedronGeometry(1, 2)
    const pos = base.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const grass = new THREE.Color('#5f9e45')
    const grass2 = new THREE.Color('#7bb456')
    const rock = new THREE.Color('#8b8597')
    const sand = new THREE.Color('#d9c58f')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const wobble = noise2(pos.getX(i) * 2.1 + 3, pos.getZ(i) * 2.1) - 0.5
      pos.setXYZ(i, pos.getX(i) * (1 + wobble * 0.18), y, pos.getZ(i) * (1 + wobble * 0.18))
      if (y < -0.05) c.copy(sand)
      else if (y < 0.25) c.copy(rock).lerp(grass, (y + 0.05) / 0.3)
      else c.copy(grass).lerp(grass2, Math.min(1, (y - 0.25) * 1.6))
      if (wobble > 0.28 && y > 0.1) c.lerp(rock, 0.6)
      colors.set([c.r, c.g, c.b], i * 3)
    }
    // polyhedra are already non-indexed: one colour per corner is enough for flat shading
    const geo = base
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })

    const spots: { x: number; z: number; s: number; h: number }[] = []
    const rim = roundedRect(ISLAND.halfX, ISLAND.halfZ, ISLAND.corner, 10)
    const step = Math.max(1, Math.round(2 / Math.max(0.5, this.density)))
    for (let i = 0; i < rim.length; i += step) {
      if (r() < 0.25) continue // leave gaps so the sea shows through
      const p = rim[i]
      const q = rim[(i + 1) % rim.length]
      const tx = q.x - p.x
      const tz = q.y - p.y
      const len = Math.hypot(tx, tz) || 1
      const out = 22 + r() * 26
      const s = 10 + r() * 16
      spots.push({ x: p.x + (tz / len) * out, z: p.y - (tx / len) * out, s, h: 0.5 + r() * 0.7 })
    }
    // distant mountains on the horizon
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2
      const d = 330 + r() * 120
      spots.push({ x: Math.cos(a) * d * 1.15, z: Math.sin(a) * d, s: 40 + r() * 50, h: 0.55 + r() * 0.6 })
    }
    const hills = new THREE.InstancedMesh(geo, mat, spots.length)
    const o = new THREE.Object3D()
    spots.forEach((h, i) => {
      o.position.set(h.x, WATER_LEVEL - h.s * 0.12, h.z)
      o.rotation.set(0, r() * Math.PI * 2, 0)
      o.scale.set(h.s, h.s * h.h, h.s * (0.8 + r() * 0.4))
      o.updateMatrix()
      hills.setMatrixAt(i, o.matrix)
    })
    hills.receiveShadow = true
    group.add(hills)
    return group
  }

  /** a line of boulders along the rim: the visible reason the taxi stays on land */
  private buildBoulders() {
    const rim = roundedRect(ISLAND.halfX - 0.6, ISLAND.halfZ - 0.6, ISLAND.corner - 0.6, 14)
    const pts: THREE.Vector2[] = []
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i]
      const b = rim[(i + 1) % rim.length]
      const len = a.distanceTo(b)
      const steps = Math.max(1, Math.round(len / 2.3))
      for (let k = 0; k < steps; k++) pts.push(a.clone().lerp(b, k / steps))
    }
    // leave the river mouth open to the sea
    const keep = pts.filter((p) => !(p.y < -ISLAND.halfZ + 2 && p.x > -47 && p.x < -33))
    const r = rng(77)
    const geo = new THREE.DodecahedronGeometry(1, 0)
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#a39cad', flatShading: true }), keep.length)
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    keep.forEach((p, i) => {
      const s = 0.8 + r() * 0.75
      o.position.set(p.x, 0.15, p.y)
      o.rotation.set(r() * 2, r() * 6, r() * 2)
      o.scale.set(s * 1.2, s * 0.85, s)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, c.setHSL(0.7, 0.06, 0.62 + r() * 0.16))
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  /** colliders: the rounded slab, and walls along the river and lake banks (gap at the bridge) */
  addColliders(physics: Physics) {
    const { halfX, halfZ, corner } = ISLAND
    const h = 2
    physics.box(0, -h / 2, 0, halfX - corner, h / 2, halfZ)
    physics.box(0, -h / 2, 0, halfX, h / 2, halfZ - corner)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      physics.addStatic(new CANNON.Cylinder(corner, corner, h, 24), sx * (halfX - corner), -h / 2, sz * (halfZ - corner))
    }

    // walls along the rim, behind the boulders
    const rim = roundedRect(ISLAND.halfX - 0.4, ISLAND.halfZ - 0.4, ISLAND.corner - 0.4, 10)
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i]
      const b = rim[(i + 1) % rim.length]
      const len = a.distanceTo(b)
      if (len < 0.01) continue
      physics.box((a.x + b.x) / 2, 1, (a.y + b.y) / 2, 0.5, 2, len / 2 + 0.4, Math.atan2(b.x - a.x, b.y - a.y))
    }

    const { west, east } = riverBanks(60)
    const lake = lakeOutline(36)
    const inLake = (p: THREE.Vector2) => ((p.x - LAKE.x) / (LAKE.rx * 1.02)) ** 2 + ((p.y - LAKE.z) / (LAKE.rz * 1.02)) ** 2 < 1
    const chains: THREE.Vector2[][] = [
      west.filter((p) => !inLake(p) && p.y > -halfZ - 1),
      east.filter((p) => !inLake(p) && p.y > -halfZ - 1),
      [...lake, lake[0]],
    ]
    const gap = ROAD_WIDTH / 2 + 1.6
    // where the river leaves the lake there is water on both sides: no lake wall between the two bank exits
    const mouthW = chains[0][0].x
    const mouthE = chains[1][0].x
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i]
        const b = chain[i + 1]
        const mx = (a.x + b.x) / 2
        const mz = (a.y + b.y) / 2
        if (Math.abs(mz - BRIDGE.z) < gap && mx > BRIDGE.x0 && mx < BRIDGE.x1) continue
        if (chain === chains[2] && mz < LAKE.z && mx > mouthW && mx < mouthE) continue
        const dx = b.x - a.x
        const dz = b.y - a.y
        const len = Math.hypot(dx, dz)
        if (len < 0.01) continue
        physics.box(mx, 0.6, mz, 0.35, 1.4, len / 2 + 0.3, Math.atan2(dx, dz))
      }
    }
  }

  update(elapsed: number, night: number, sunColor: THREE.Color) {
    for (const m of [this.water.material, this.sea.material]) {
      const u = m.uniforms
      u.uTime.value = elapsed
      u.uDeep.value.copy(this.dayDeep).lerp(this.nightDeep, night)
      u.uShallow.value.copy(this.dayShallow).lerp(this.nightShallow, night)
      u.uGlint.value.copy(sunColor).multiplyScalar(1 - night * 0.6)
    }
  }
}

let dot: THREE.Texture | null = null
export function softDot() {
  if (dot) return dot
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  dot = new THREE.CanvasTexture(c)
  return dot
}
