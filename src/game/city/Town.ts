import * as THREE from 'three'
import type { Physics } from '../Physics'
import type { Assets } from '../Assets'
import { Batch, M } from './Batch'
import { GRID, ROAD_W, WALK_W, PLOTS, BLOCK_HALF, plotFrame } from './Plan'
import { rng } from '../../utils/math'
import { kerbStripes, wires, tramLine, Tram, streetLife, victoriaMemorial } from './Kolkata'

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
          float mould = smoothstep(0.55, 0.85, wn(vec2(along * 0.6, vWorldW.y * 0.9))) * 0.22;
          float k = mix(1.0, ground * (1.0 - streak * 0.42 - mould) * mix(0.74, 1.04, blotch), s);
          diffuseColor.rgb *= k;
        }`)
  }
  mat.customProgramCacheKey = () => 'weather' + strength
  return mat
}

const SIGNS: [string, string, string][] = [
  ['SHARMA SWEETS', '#b71c1c', '#fff3c4'],
  ['GHOSH TEA HOUSE', '#1b5e20', '#ffffff'],
  ['BANERJEE MEDICAL HALL', '#ffffff', '#c62828'],
  ['NEW BENGAL TAILORS', '#0d47a1', '#ffee58'],
  ['CALCUTTA BIRYANI HOUSE', '#4e342e', '#ffcc80'],
  ['DAS PHOTO STUDIO', '#212121', '#ffd54f'],
  ['MAA TARA HARDWARE', '#f9a825', '#1a237e'],
  ['COLLEGE STREET BOOKS', '#3e2723', '#fff8e1'],
  ['PAL & SONS JEWELLERS', '#880e4f', '#ffe082'],
  ['BOSE ELECTRICALS', '#00695c', '#ffffff'],
  ['MITRA CYBER CAFE', '#1565c0', '#ffffff'],
  ['ROY BROS. GROCERY', '#e65100', '#ffffff'],
]

function signAtlas() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 128 * SIGNS.length
  const g = c.getContext('2d')!
  SIGNS.forEach(([text, bg, ink], i) => {
    const y = i * 128
    g.fillStyle = bg
    g.fillRect(0, y, 1024, 128)
    g.strokeStyle = ink
    g.globalAlpha = 0.5
    g.lineWidth = 6
    g.strokeRect(10, y + 10, 1004, 108)
    g.globalAlpha = 1
    g.fillStyle = ink
    g.font = '800 68px "Bricolage Grotesque Variable", system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 512, y + 68, 960)
    // sun-faded paint and grime
    for (let k = 0; k < 220; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,30,20'},${Math.random() * 0.12})`
      g.fillRect(Math.random() * 1024, y + Math.random() * 128, 2 + Math.random() * 30, 2 + Math.random() * 6)
    }
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.08 })
}

/** green louvred 'khorkhori' shutters: one texture metre = ~22 slats */
function louvreMaterial() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#2f5d43'
  g.fillRect(0, 0, 64, 256)
  for (let y = 0; y < 256; y += 11.6) {
    const grd = g.createLinearGradient(0, y, 0, y + 11.6)
    grd.addColorStop(0, '#4a7d5f')
    grd.addColorStop(0.6, '#2c5640')
    grd.addColorStop(1, '#14291e')
    g.fillStyle = grd
    g.fillRect(0, y, 64, 11.6)
  }
  g.fillStyle = '#21402f'
  g.fillRect(0, 0, 5, 256)
  g.fillRect(59, 0, 5, 256)
  // weathering
  for (let k = 0; k < 160; k++) {
    g.fillStyle = `rgba(${Math.random() < 0.6 ? '210,200,170' : '20,20,15'},${Math.random() * 0.18})`
    g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 6, 1 + Math.random() * 3)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 })
}

function awningMaterial() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 32
  const g = c.getContext('2d')!
  const cols = ['#2e7d6f', '#e8e2d0']
  for (let i = 0; i < 8; i++) {
    g.fillStyle = cols[i % 2]
    g.fillRect(i * 16, 0, 16, 32)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide })
}

export function townMaterials(a: Assets) {
  const glass = new THREE.MeshStandardMaterial({ color: '#5d7488', metalness: 0.95, roughness: 0.04, envMapIntensity: 1.6 })
  const glassLit = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.4, roughness: 0.2, emissive: '#ffd59a', emissiveIntensity: 0 })
  return {
    asphalt: a.material('asphalt_02', 1, { roughness: 1 }),
    pavement: a.material('concrete_tiles', 1),
    kerb: kerbStripes(),
    signs: signAtlas(),
    awning: awningMaterial(),
    cloth: ['#c2185b', '#f9a825', '#1e88e5', '#43a047', '#ffffff', '#6a1b9a', '#ef6c00'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide })),
    paving: a.material('cobblestone_floor_08', 1),
    grass: a.material('aerial_grass_rock', 1),
    plaster: [
      weather(a.material('beige_wall_001', 1, { color: '#d4a85c' }), 1.2),
      weather(a.material('white_plaster_02', 1, { color: '#c7bba4' }), 1.2),
      weather(a.material('plastered_wall_02', 1, { color: '#c98a6a' }), 1.2),
      weather(a.material('white_plaster_02', 1, { color: '#8fb3c2' }), 1.2),
      weather(a.material('beige_wall_001', 1, { color: '#a9c49a' }), 1.2),
      weather(a.material('plastered_wall_02', 1, { color: '#b5574a' }), 1.2),
      weather(a.material('white_plaster_02', 1, { color: '#d9c7a1' }), 1.2),
    ],
    brick: weather(a.material('brick_wall_10', 1), 0.6),
    redBrick: weather(a.material('red_brick_03', 1), 0.6),
    concrete: weather(a.material('concrete_wall_008', 1, { color: '#b8b4ac' })),
    shutter: louvreMaterial(),
    aircon: new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.5, metalness: 0.2 }),
    rail: new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.5, metalness: 0.6 }),
    corrugated: a.material('corrugated_iron_02', 1),
    wood: a.material('wood_planks', 1),
    granite: a.material('granite_tile', 1),
    marble: a.material('marble_01', 1, { color: '#ece6da' }),
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
  if (r() < 0.5) {
    // balustered parapet on the street side
    b.box(w + 0.3, 0.14, 0.32, m.trim, at(0, h + 0.07, d / 2))
    b.box(w + 0.3, 0.14, 0.32, m.trim, at(0, h + 0.88, d / 2))
    for (let k = -w / 2 + 0.2; k <= w / 2 - 0.2; k += 0.32) b.add(new THREE.CylinderGeometry(0.06, 0.09, 0.66, 6), m.trim, at(k, h + 0.47, d / 2))
  } else b.box(w + 0.3, 0.9, 0.25, m.trim, at(0, h + 0.45, d / 2))
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
  const green = r() < 0.7
  const balconies = r() < 0.6
  const arched = r() < 0.45
  const pilasters = r() < 0.5
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
        if (arched) {
          // a semicircular fanlight over the window, framed in plaster trim
          b.add(new THREE.CircleGeometry(0.75, 16, 0, Math.PI), m.glass, at(wx, y + 0.875, wz, fy).multiply(M(0, 0, 0.07)))
          b.add(new THREE.RingGeometry(0.75, 0.9, 16, 1, 0, Math.PI), m.trim, at(wx, y + 0.875, wz, fy).multiply(M(0, 0, 0.09)))
        }
        if (pilasters && c > 0) b.box(0.35, FLOOR - 0.2, 0.12, m.trim, at(wx, f * FLOOR + FLOOR / 2 + 0.2, wz, fy).multiply(M(-step / 2, 0, 0.05)))
        if (f > 0 && r() < 0.07) {
          // a window air-conditioner box, the unofficial Kolkata facade ornament
          b.box(0.75, 0.5, 0.55, m.aircon, at(wx, y - 1.25, wz, fy).multiply(M(0.2, 0, 0.3)))
        }
        if (green) {
          // louvred shutters folded open either side
          b.box(0.6, 1.6, 0.05, m.shutter, at(wx, y, wz, fy).multiply(M(-1.06, 0, 0.06)), 1)
          b.box(0.6, 1.6, 0.05, m.shutter, at(wx, y, wz, fy).multiply(M(1.06, 0, 0.06)), 1)
        }
        if (balconies && f > 0 && c % 2 === 0 && fy === 0) {
          b.box(2.2, 0.14, 1.0, m.trim, at(wx, y - 1.0, wz, fy).multiply(M(0, 0, 0.5)))
          b.box(2.2, 0.06, 0.06, m.rail, at(wx, y - 0.0, wz, fy).multiply(M(0, 0, 0.98)))
          for (let k = -5; k <= 5; k++) b.box(0.03, 0.9, 0.03, m.rail, at(wx, y - 0.48, wz, fy).multiply(M(k * 0.2, 0, 0.98)))
          // washing hung out to dry
          if (r() < 0.45) {
            b.box(2.0, 0.015, 0.015, m.rail, at(wx, y + 0.55, wz, fy).multiply(M(0, 0, 0.9)))
            for (let k = 0; k < 3 + Math.floor(r() * 3); k++) {
              const cw = 0.35 + r() * 0.5
              b.add(new THREE.PlaneGeometry(cw, 0.5 + r() * 0.6), m.cloth[Math.floor(r() * m.cloth.length)], at(wx, y + 0.25, wz, fy).multiply(M(-0.8 + k * 0.42, -r() * 0.15, 0.92)))
            }
          }
        }
      }
    }
  }
  if (opts.shop) {
    // a glazed shopfront with a canopy on the street side
    b.box(w - 1, 2.8, 0.1, m.frame, at(0, 1.5, d / 2 + 0.02))
    b.add(new THREE.PlaneGeometry(w - 1.4, 2.5), m.glassLit, at(0, 1.5, d / 2 + 0.08))
    // a hand-painted signboard and a faded canvas awning
    const sw = Math.min(w - 0.6, 9)
    const sign = new THREE.PlaneGeometry(sw, 1.05)
    const row = Math.floor(r() * SIGNS.length)
    const uv = sign.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, (SIGNS.length - 1 - row + uv.getY(i)) / SIGNS.length)
    b.add(sign, m.signs, at(0, 3.75, d / 2 + 0.12))
    b.box(sw + 0.2, 1.2, 0.1, m.frame, at(0, 3.75, d / 2 + 0.05))
    const awn = new THREE.Matrix4().makeRotationX(0.42)
    b.box(w - 0.4, 0.04, 1.8, m.awning, at(0, 2.95, d / 2 + 0.85).multiply(awn), 1.2)
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

  tram: Tram | null = null
  update(dt: number) {
    this.tram?.update(dt)
  }

  build() {
    const b = new Batch()
    this.roads(b)
    this.blocks(b)
    this.fillers(b)
    tramLine(b)
    streetLife(b, this.mats, this.physics)
    victoriaMemorial(b, this.mats, this.physics)
    b.build(this.group)
    this.lamps()
    this.buildPools()
    this.group.add(wires(this.lampPositions))
    this.tram = new Tram(this.physics, this.assets.models.get('tram')?.scene)
    this.group.add(this.tram.group)
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
        // kerbs are always built along their local x so the stripes run the right way
        for (const [dx, dz, yaw] of [[0, size / 2, 0], [0, -size / 2, 0], [size / 2, 0, Math.PI / 2], [-size / 2, 0, Math.PI / 2]]) {
          b.box(size + 0.3, CURB + 0.02, 0.3, m.kerb, M(cx + dx, (CURB + 0.02) / 2, cz + dz, yaw), 1)
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
        for (const t of [-34, -12, 12, 34]) {
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
      let material = mesh.material as THREE.MeshStandardMaterial
      if (/glass/i.test(material.name)) {
        // the lantern glass becomes the light source after dark
        material = material.clone()
        material.emissive = new THREE.Color('#ffc979')
        material.emissiveIntensity = 0
        material.transparent = false
        material.opacity = 1
        this.lampGlass = material
      }
      const inst = new THREE.InstancedMesh(mesh.geometry, material, mats.length)
      mats.forEach((mat, k) => inst.setMatrixAt(k, mat.clone().multiply(mesh.matrixWorld)))
      inst.castShadow = true
      inst.computeBoundingSphere()
      this.group.add(inst)
    })
  }

  private lampGlass: THREE.MeshStandardMaterial | null = null
  private pools: THREE.InstancedMesh | null = null

  /** soft light pools on the ground under every lamp (cheap: one instanced decal) */
  buildPools() {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grd.addColorStop(0, 'rgba(255,200,120,0.85)')
    grd.addColorStop(0.45, 'rgba(255,180,100,0.35)')
    grd.addColorStop(1, 'rgba(255,170,90,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 128)
    const tex = new THREE.CanvasTexture(c)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 })
    const geo = new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2)
    this.pools = new THREE.InstancedMesh(geo, mat, this.lampPositions.length)
    this.lampPositions.forEach((p, i) => this.pools!.setMatrixAt(i, M(p.x, CURB + 0.03, p.z)))
    this.pools.renderOrder = 1
    this.pools.visible = false
    this.group.add(this.pools)
  }

  setNight(n: number) {
    if (this.lampGlass) this.lampGlass.emissiveIntensity = n > 0.3 ? 9 * n : 0
    if (this.pools) {
      this.pools.visible = n > 0.3
      ;(this.pools.material as THREE.MeshBasicMaterial).opacity = n * 0.55
    }
    this.mats.glassLit.emissiveIntensity = n * 0.75
  }
}
