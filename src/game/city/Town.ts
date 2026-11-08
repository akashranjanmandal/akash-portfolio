import * as THREE from 'three'
import type { Physics } from '../Physics'
import type { Assets } from '../Assets'
import { Batch, M } from './Batch'
import { GRID, ROAD_W, WALK_W, PLOTS, BLOCK_HALF, plotFrame } from './Plan'
import { rng } from '../../utils/math'

/* Roads, kerbs, pavements, street lights and the ordinary buildings
   that make the town feel lived in. Landmarks are built separately. */

const CURB = 0.15
const FLOOR = 3.2

export type Materials = ReturnType<typeof townMaterials>

/** grime near the ground, rain streaks under ledges and patchy discolouration */
export function weather(mat: THREE.MeshStandardMaterial, strength = 1) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldW;
        float wh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float s = ${strength.toFixed(2)};
          float ground = mix(0.62, 1.0, smoothstep(0.0, 2.4, vWorldW.y));
          float along = vWorldW.x + vWorldW.z;
          float streak = wn(vec2(along * 1.7, vWorldW.y * 0.25)) * wn(vec2(along * 0.31, 1.0));
          float blotch = wn(vec2(along * 0.08, vWorldW.y * 0.12));
          float k = mix(1.0, ground * (1.0 - streak * 0.28) * mix(0.82, 1.06, blotch), s);
          diffuseColor.rgb *= k;
        }`)
  }
  mat.customProgramCacheKey = () => 'weather' + strength
  return mat
}

export function townMaterials(a: Assets) {
  const glass = new THREE.MeshStandardMaterial({ color: '#1c2833', metalness: 0.9, roughness: 0.06 })
  const glassLit = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.4, roughness: 0.2, emissive: '#ffd59a', emissiveIntensity: 0 })
  return {
    asphalt: a.material('asphalt_02', 1, { roughness: 1 }),
    pavement: a.material('concrete_tiles', 1),
    kerb: a.material('painted_concrete', 1, { color: '#bdb7ad' }),
    paving: a.material('cobblestone_floor_08', 1),
    grass: a.material('aerial_grass_rock', 1),
    plaster: [
      weather(a.material('beige_wall_001', 1, { color: '#d9be8f' })),
      weather(a.material('white_plaster_02', 1, { color: '#cbc3b4' })),
      weather(a.material('plastered_wall_02', 1, { color: '#c99b74' })),
      weather(a.material('white_plaster_02', 1, { color: '#a9bfae' })),
      weather(a.material('beige_wall_001', 1, { color: '#d6a07e' })),
      weather(a.material('plastered_wall_02', 1, { color: '#b8b9c9' })),
    ],
    brick: weather(a.material('brick_wall_10', 1), 0.6),
    redBrick: weather(a.material('red_brick_03', 1), 0.6),
    concrete: weather(a.material('concrete_wall_008', 1, { color: '#b8b4ac' })),
    shutter: new THREE.MeshStandardMaterial({ color: '#2f5d43', roughness: 0.7 }),
    rail: new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.5, metalness: 0.6 }),
    corrugated: a.material('corrugated_iron_02', 1),
    wood: a.material('wood_planks', 1),
    granite: a.material('granite_tile', 1),
    marble: a.material('marble_01', 1),
    roof: a.material('painted_concrete', 1, { color: '#a49e94' }),
    trim: weather(new THREE.MeshStandardMaterial({ color: '#d8d1c4', roughness: 0.85 })),
    frame: new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.5, metalness: 0.4 }),
    tank: new THREE.MeshStandardMaterial({ color: '#1d1d22', roughness: 0.6 }),
    line: new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.7 }),
    yellowLine: new THREE.MeshStandardMaterial({ color: '#e4b42c', roughness: 0.7 }),
    glass,
    glassLit,
  }
}

/** a mid-rise town building with windows, cornices, a parapet and roof clutter */
export function townBuilding(b: Batch, m: Materials, x: number, z: number, yaw: number, w: number, d: number, floors: number, wall: THREE.Material, r: () => number, opts: { shop?: boolean } = {}) {
  const h = floors * FLOOR + 0.4
  const base = M(x, 0, z, yaw)
  const at = (lx: number, ly: number, lz: number, ryaw = 0) => base.clone().multiply(M(lx, ly, lz, ryaw))
  b.box(w, h, d, wall, at(0, h / 2, 0), 2.5)
  // cornice per floor and a parapet
  for (let f = 1; f <= floors; f++) b.box(w + 0.24, 0.16, d + 0.24, m.trim, at(0, f * FLOOR + 0.2, 0))
  b.box(w + 0.3, 0.9, 0.25, m.trim, at(0, h + 0.45, d / 2))
  b.box(w + 0.3, 0.9, 0.25, m.trim, at(0, h + 0.45, -d / 2))
  b.box(0.25, 0.9, d, m.trim, at(w / 2, h + 0.45, 0))
  b.box(0.25, 0.9, d, m.trim, at(-w / 2, h + 0.45, 0))
  b.box(w - 0.2, 0.05, d - 0.2, m.roof, at(0, h + 0.03, 0), 3)
  // windows on all four faces
  const faces: [number, number, number, number][] = [
    [0, d / 2, 0, w],
    [0, -d / 2, Math.PI, w],
    [w / 2, 0, Math.PI / 2, d],
    [-w / 2, 0, -Math.PI / 2, d],
  ]
  const green = r() < 0.55
  const balconies = r() < 0.6
  for (const [fx, fz, fy, len] of faces) {
    const cols = Math.max(1, Math.floor((len - 1.2) / 3))
    const step = len / cols
    for (let f = 0; f < floors; f++) {
      if (f === 0 && opts.shop && fy === 0) continue
      for (let c = 0; c < cols; c++) {
        const off = -len / 2 + step * (c + 0.5)
        const y = f * FLOOR + 1.75
        const wx = fx + Math.cos(fy) * off
        const wz = fz - Math.sin(fy) * off
        const lit = r() < 0.38
        // frame proud of the wall, glass recessed inside it
        b.box(1.5, 1.75, 0.1, m.frame, at(wx, y, wz, fy).multiply(M(0, 0, 0.03)))
        b.add(new THREE.PlaneGeometry(1.3, 1.55), lit ? m.glassLit : m.glass, at(wx, y, wz, fy).multiply(M(0, 0, 0.085)))
        b.box(1.7, 0.08, 0.22, m.trim, at(wx, y - 0.92, wz, fy).multiply(M(0, 0, 0.08)))
        if (green) {
          // louvred shutters folded open either side
          b.box(0.6, 1.6, 0.05, m.shutter, at(wx, y, wz, fy).multiply(M(-1.06, 0, 0.06)))
          b.box(0.6, 1.6, 0.05, m.shutter, at(wx, y, wz, fy).multiply(M(1.06, 0, 0.06)))
        }
        if (balconies && f > 0 && c % 2 === 0 && fy === 0) {
          b.box(2.2, 0.14, 1.0, m.trim, at(wx, y - 1.0, wz, fy).multiply(M(0, 0, 0.5)))
          b.box(2.2, 0.06, 0.06, m.rail, at(wx, y - 0.0, wz, fy).multiply(M(0, 0, 0.98)))
          for (let k = -5; k <= 5; k++) b.box(0.03, 0.9, 0.03, m.rail, at(wx, y - 0.48, wz, fy).multiply(M(k * 0.2, 0, 0.98)))
        }
      }
    }
  }
  if (opts.shop) {
    // a glazed shopfront with a canopy on the street side
    b.box(w - 1, 2.8, 0.1, m.frame, at(0, 1.5, d / 2 + 0.02))
    b.add(new THREE.PlaneGeometry(w - 1.4, 2.5), m.glassLit, at(0, 1.5, d / 2 + 0.08))
    b.box(w, 0.18, 1.6, m.frame, at(0, 3.1, d / 2 + 0.8))
  }
  // roof clutter: water tanks and a stair head
  const tanks = 1 + Math.floor(r() * 2)
  for (let i = 0; i < tanks; i++) {
    const g = new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14)
    b.add(g, m.tank, at((r() - 0.5) * (w - 3), h + 0.7, (r() - 0.5) * (d - 3)))
  }
  if (r() < 0.6) b.box(2.4, 2.4, 2.6, wall, at(-w / 2 + 2, h + 1.2, -d / 2 + 2), 2.5)
}

export class Town {
  readonly group = new THREE.Group()
  readonly mats: Materials
  readonly lampPositions: THREE.Vector3[] = []

  constructor(private physics: Physics, private assets: Assets) {
    this.mats = townMaterials(assets)
  }

  build() {
    const b = new Batch()
    this.roads(b)
    this.blocks(b)
    this.fillers(b)
    b.build(this.group)
    this.lamps()
  }

  private roads(b: Batch) {
    const m = this.mats
    const min = GRID[0] - ROAD_W / 2
    const max = GRID[GRID.length - 1] + ROAD_W / 2
    const span = max - min
    // one big asphalt sheet under the whole grid; blocks sit on top as raised islands
    const sheet = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2)
    const uv = sheet.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * span / 6, uv.getY(i) * span / 6)
    b.add(sheet, m.asphalt, M((min + max) / 2, 0.02, (min + max) / 2))
    this.physics.fixedBox((min + max) / 2, -0.25, (min + max) / 2, span / 2, 0.27, span / 2)

    // centre lines (dashed) and zebra crossings near each junction
    for (const g of GRID) {
      for (let i = 0; i < GRID.length - 1; i++) {
        const a = GRID[i] + ROAD_W / 2 + 6
        const c = GRID[i + 1] - ROAD_W / 2 - 6
        for (let t = a; t < c; t += 6) {
          b.add(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), m.line, M(g, 0.035, t + 1.5))
          b.add(new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), m.line, M(t + 1.5, 0.035, g))
        }
      }
      for (const h of GRID) {
        for (const [dx, dz, rot] of [[0, ROAD_W / 2 + 2.2, 0], [0, -ROAD_W / 2 - 2.2, 0], [ROAD_W / 2 + 2.2, 0, 1], [-ROAD_W / 2 - 2.2, 0, 1]] as const) {
          for (let k = -4; k <= 4; k++) {
            const geo = new THREE.PlaneGeometry(0.5, 3).rotateX(-Math.PI / 2)
            if (rot) b.add(geo, m.line, M(g + dx, 0.036, h + dz + k * 1, Math.PI / 2))
            else b.add(geo, m.line, M(g + dx + k * 1, 0.036, h + dz))
          }
        }
      }
    }
  }

  private blocks(b: Batch) {
    const m = this.mats
    const size = 100 - ROAD_W
    for (let i = 0; i < GRID.length - 1; i++) {
      for (let j = 0; j < GRID.length - 1; j++) {
        const cx = (GRID[i] + GRID[i + 1]) / 2
        const cz = (GRID[j] + GRID[j + 1]) / 2
        // pavement ring + kerb, then the block interior
        b.box(size, CURB, size, m.pavement, M(cx, CURB / 2, cz), 2)
        for (const [dx, dz, w, d] of [[0, size / 2, size + 0.3, 0.3], [0, -size / 2, size + 0.3, 0.3], [size / 2, 0, 0.3, size], [-size / 2, 0, 0.3, size]]) {
          b.box(w, CURB + 0.02, d, m.kerb, M(cx + dx, (CURB + 0.02) / 2, cz + dz), 1)
        }
        const inner = size - WALK_W * 2
        b.box(inner, 0.02, inner, m.grass, M(cx, CURB + 0.01, cz), 6)
        this.physics.fixedBox(cx, CURB / 2, cz, size / 2, CURB / 2, size / 2)
      }
    }
  }

  /** ordinary buildings lining the streets wherever no landmark stands */
  private fillers(b: Batch) {
    const m = this.mats
    const r = rng(9001)
    const occupied: { x: number; z: number; r: number }[] = PLOTS.map((p) => {
      const f = plotFrame(p)
      return { x: f.x - f.fx * p.d / 2, z: f.z - f.fz * p.d / 2, r: Math.max(p.w, p.d) / 2 + 8 }
    })
    for (let i = 0; i < GRID.length - 1; i++) {
      for (let j = 0; j < GRID.length - 1; j++) {
        const cx = (GRID[i] + GRID[i + 1]) / 2
        const cz = (GRID[j] + GRID[j + 1]) / 2
        for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          // walk along this block edge placing buildings of random width
          let t = -BLOCK_HALF + 2
          while (t < BLOCK_HALF - 8) {
            const w = 9 + r() * 9
            const d = 10 + r() * 8
            const along = t + w / 2
            const yaw = Math.atan2(fx, fz)
            const ox = cx + fx * (BLOCK_HALF - d / 2) + (fz !== 0 ? along : 0)
            const oz = cz + fz * (BLOCK_HALF - d / 2) + (fx !== 0 ? along : 0)
            t += w + 1.5 + r() * 3
            if (occupied.some((o) => (o.x - ox) ** 2 + (o.z - oz) ** 2 < (o.r + Math.max(w, d) / 2) ** 2)) continue
            // corners: keep the very ends clear so perpendicular rows don't collide
            if (Math.abs(along) > BLOCK_HALF - 9 - w / 2) continue
            const floors = 2 + Math.floor(r() * 4)
            const wall = r() < 0.2 ? m.brick : r() < 0.15 ? m.concrete : m.plaster[Math.floor(r() * m.plaster.length)]
            townBuilding(b, m, ox, oz, yaw, w, d, floors, wall, r, { shop: r() < 0.55 })
            this.physics.fixedBox(ox, (floors * FLOOR) / 2, oz, (fz !== 0 ? w : d) / 2, (floors * FLOOR) / 2, (fz !== 0 ? d : w) / 2)
            occupied.push({ x: ox, z: oz, r: Math.max(w, d) / 2 })
          }
        }
      }
    }
  }

  private lamps() {
    const lamp = this.assets.models.get('street_lamp_01')?.scene
    if (!lamp) return
    const mats: THREE.Matrix4[] = []
    const edge = 50 - ROAD_W / 2 - 0.8
    for (let i = 0; i < GRID.length - 1; i++) {
      for (let j = 0; j < GRID.length - 1; j++) {
        const cx = (GRID[i] + GRID[i + 1]) / 2
        const cz = (GRID[j] + GRID[j + 1]) / 2
        for (const t of [-30, 0, 30]) {
          for (const [px, pz, yaw] of [[cx + t, cz + edge, 0], [cx + t, cz - edge, Math.PI], [cx + edge, cz + t, Math.PI / 2], [cx - edge, cz + t, -Math.PI / 2]] as const) {
            mats.push(M(px, CURB, pz, yaw, 1.6, 1.6, 1.6))
            this.lampPositions.push(new THREE.Vector3(px, 0, pz))
            this.physics.fixedCylinder(px, 2.5, pz, 0.18, 5)
          }
        }
      }
    }
    lamp.updateMatrixWorld(true)
    lamp.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length)
      mats.forEach((mat, k) => inst.setMatrixAt(k, mat.clone().multiply(mesh.matrixWorld)))
      inst.castShadow = true
      inst.computeBoundingSphere()
      this.group.add(inst)
    })
  }

  setNight(n: number) {
    this.mats.glassLit.emissiveIntensity = n * 1.6
  }
}
