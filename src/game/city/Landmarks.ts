import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import { townBuilding, type Materials } from './Town'
import { PLOTS, plotFrame, type Plot } from './Plan'
import { rng } from '../../utils/math'
import { mergeByMaterial } from '../merge'
import { addFairy, type FairyBuffer } from './Fairy'

/* ──────────────────────────────────────────────────────────────
   LANDMARKS
   Every stop of the story is a real building in town: a lit sign
   with the brand, a big facade screen showing the actual website,
   and a glowing marker at the entrance. Walk onto the marker and
   press E to open the details on the phone.
────────────────────────────────────────────────────────────── */

export type Spot = { id: string; title: string; sub: string; pos: THREE.Vector3; yaw: number }

type Spec = {
  title: string
  sub: string
  accent: string
  /** text colour on the sign */
  ink?: string
  screen?: string
  logo?: string
  build: (ctx: Ctx) => void
}

type Ctx = {
  b: Batch
  m: Materials
  plot: Plot
  at: (lx: number, ly: number, lz: number, yaw?: number) => THREE.Matrix4
  physics: Physics
  group: THREE.Group
  tex: Map<string, THREE.Texture>
  spec: Spec
  r: () => number
  models: Map<string, GLTF>
  nightLights: { light: THREE.PointLight; power: number }[]
  lampMat: THREE.MeshStandardMaterial
  fairy: FairyBuffer
}

const FONT = '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif'
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace'

function signTexture(title: string, sub: string, bg: string, ink: string, logo?: HTMLImageElement) {
  const c = document.createElement('canvas')
  c.width = 1536
  c.height = 288
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, c.width, c.height)
  let x = 70
  if (logo) {
    const h = 190
    const w = (logo.width / logo.height) * h
    g.drawImage(logo, 50, (c.height - h) / 2, w, h)
    x = 50 + w + 40
  }
  g.fillStyle = ink
  g.textBaseline = 'middle'
  g.font = `800 120px ${FONT}`
  g.fillText(title, x, 120, c.width - x - 40)
  g.globalAlpha = 0.85
  g.font = `600 44px ${MONO}`
  g.fillText(sub.toUpperCase(), x + 4, 222, c.width - x - 40)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** a backlit sign box */
function sign(ctx: Ctx, w: number, lx: number, ly: number, lz: number) {
  const { spec, tex } = ctx
  const logo = spec.logo ? (tex.get(spec.logo)?.image as HTMLImageElement | undefined) : undefined
  const t = signTexture(spec.title, spec.sub, spec.accent, spec.ink ?? '#ffffff', logo)
  const h = w * (288 / 1536)
  const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.4 })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  mesh.applyMatrix4(ctx.at(lx, ly, lz + 0.16))
  ctx.group.add(mesh)
  ctx.b.box(w + 0.3, h + 0.3, 0.3, ctx.m.frame, ctx.at(lx, ly, lz))
  return mat
}

/** a large LED screen showing the project's website */
function screen(ctx: Ctx, w: number, lx: number, ly: number, lz: number) {
  const t = ctx.spec.screen ? ctx.tex.get(ctx.spec.screen) : undefined
  if (!t) return
  const h = w / 2
  const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.75, roughness: 0.3 })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  mesh.applyMatrix4(ctx.at(lx, ly, lz + 0.18))
  ctx.group.add(mesh)
  ctx.b.box(w + 0.5, h + 0.5, 0.25, ctx.m.frame, ctx.at(lx, ly, lz))
}

/** curtain-wall tower: glass with a mullion grid and slab edges */
function glassTower(ctx: Ctx, w: number, d: number, floors: number, glass: THREE.Material, edge: THREE.Material, lx = 0, lz = 0) {
  const h = floors * 3.6
  const { b, at } = ctx
  b.box(w, h, d, glass, at(lx, h / 2, lz - d / 2), 3)
  for (let f = 0; f <= floors; f++) b.box(w + 0.12, 0.28, d + 0.12, edge, at(lx, f * 3.6, lz - d / 2))
  for (const [ax, az, len, rot] of [[0, 0, w, 0], [0, -d, w, 0], [-w / 2, -d / 2, d, 1], [w / 2, -d / 2, d, 1]] as const) {
    const n = Math.round(len / 1.8)
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (len / n) * i
      if (rot) b.box(0.1, h, 0.1, edge, at(lx + ax, h / 2, lz + az + t))
      else b.box(0.1, h, 0.1, edge, at(lx + ax + t, h / 2, lz + az))
    }
  }
  return h
}

function collider(ctx: Ctx, lx: number, lz: number, w: number, d: number, h: number) {
  const m = ctx.at(lx, h / 2, lz)
  const p = new THREE.Vector3().setFromMatrixPosition(m)
  const f = plotFrame(ctx.plot)
  ctx.physics.fixedBox(p.x, p.y, p.z, w / 2, h / 2, d / 2, f.yaw)
}

/** a glowing ring on the pavement marking the entrance */
function marker(group: THREE.Group, pos: THREE.Vector3, color: string) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.15, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
  )
  ring.position.copy(pos).setY(0.2)
  ring.renderOrder = 2
  group.add(ring)
  return ring
}


/* ── models placed on plots ─────────────────────────────────── */

type PlaceOpts = {
  /** names (regex) of parts to throw away, e.g. sky domes */
  drop?: RegExp
  /** parts that should not block the player (glass, doors) */
  passable?: RegExp
  /** world height the model's lowest walkable floor should sit at */
  floor?: number
}

/**
 * Put a downloaded building on a plot (plot-local x, z, extra yaw), sitting on the street,
 * with every non-glass part turned into a trimesh collider so it can be walked through.
 */
function placeModel(ctx: Ctx, name: string, lx: number, lz: number, yaw: number, opts: PlaceOpts = {}) {
  const gltf = ctx.models.get(name)
  if (!gltf) return null
  const root = gltf.scene.clone(true)
  if (opts.drop) {
    const drop: THREE.Object3D[] = []
    root.traverse((o) => opts.drop!.test(o.name) && drop.push(o))
    drop.forEach((o) => o.removeFromParent())
  }
  const holder = new THREE.Group()
  holder.add(root)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  // floor: the model's own y = 0 is its ground floor in these scenes
  root.position.y = opts.floor ?? 0.16
  holder.applyMatrix4(ctx.at(lx, -0.15, lz, yaw))
  ctx.group.add(holder)
  holder.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    const mat = m.material as THREE.MeshStandardMaterial
    const pass = opts.passable?.test(m.name + ' ' + (mat?.name ?? '')) || (mat?.transparent && mat.opacity < 0.9) || ((mat as THREE.MeshPhysicalMaterial)?.transmission ?? 0) > 0
    if (!pass) ctx.physics.fixedMesh(m)
  })
  // hundreds of small parts → one draw per material (the colliders were made above)
  mergeByMaterial(root)
  return { holder, box }
}

/** a simple point light that only shines after dark (kept in the scene at 0 so shaders never recompile) */
function nightLight(ctx: Ctx, lx: number, ly: number, lz: number, color = '#ffd8a8', power = 30, range = 18) {
  const l = new THREE.PointLight(color, 0, range, 1.6)
  l.position.setFromMatrixPosition(ctx.at(lx, ly, lz))
  ctx.group.add(l)
  ctx.nightLights.push({ light: l, power })
}

/** low wall around a compound, with a gap for the gate at local x in [g0, g1] on the front */
function compoundWall(ctx: Ctx, x0: number, x1: number, zBack: number, g0: number, g1: number) {
  const { b, m } = ctx
  const h = 2.0
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const cx = (ax + bx) / 2
    const cz = (az + bz) / 2
    const yaw = Math.atan2(bx - ax, bz - az)
    b.box(0.35, h, len, m.plaster[1], ctx.at(cx, h / 2, cz, yaw), 2.5)
    b.box(0.5, 0.12, len + 0.2, m.trim, ctx.at(cx, h + 0.06, cz, yaw))
    const p = new THREE.Vector3().setFromMatrixPosition(ctx.at(cx, h / 2, cz))
    ctx.physics.fixedBox(p.x, h / 2, p.z, 0.2, h / 2, len / 2, plotFrame(ctx.plot).yaw + yaw)
  }
  seg(x0, -0.5, g0, -0.5)
  seg(g1, -0.5, x1, -0.5)
  seg(x0, -0.5, x0, zBack)
  seg(x1, -0.5, x1, zBack)
  seg(x0, zBack, x1, zBack)
  fairy(ctx, x0, h + 0.15, -0.5, g0, h + 0.15, -0.5, 0.25, false)
  fairy(ctx, g1, h + 0.15, -0.5, x1, h + 0.15, -0.5, 0.25, false)
  // gate pillars with lamps
  for (const gx of [g0, g1]) {
    b.box(0.8, 2.6, 0.8, m.plaster[1], ctx.at(gx, 1.3, -0.5), 2)
    b.box(1.0, 0.15, 1.0, m.trim, ctx.at(gx, 2.67, -0.5))
    b.add(new THREE.SphereGeometry(0.22, 16, 10), ctx.lampMat, ctx.at(gx, 2.95, -0.5))
  }
}

/** a sagging string of little bulbs between two plot-local points (shown after dark) */
function fairy(ctx: Ctx, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, colour: boolean) {
  const a = new THREE.Vector3().setFromMatrixPosition(ctx.at(ax, ay, az))
  const b = new THREE.Vector3().setFromMatrixPosition(ctx.at(bx, by, bz))
  addFairy(ctx.fairy, a, b, sag, colour)
}

export const ESTATE = {
  /** plot-local positions of the garage bays (x), all at z = GARAGE_Z, cars facing the street */
  bays: [10, 15, 20, 25, 30],
  garageZ: -12,
  villa: { x: -18, z: -24 },
  spawn: { x: 0, z: -6 },
}

const SPECS: Record<string, Spec> = {
  home: {
    title: 'Akash', sub: 'Home · Garage', accent: '#141218', ink: '#ffc61a',
    build(c) {
      const { b, m } = c
      // the compound: wall, gate, a lawn and a paved drive
      compoundWall(c, -38, 38, -70, -4, 35)
      b.box(75, 0.03, 68, m.grass, c.at(0, 0.02, -36), 6)
      b.box(39, 0.04, 6, m.paving, c.at(15.5, 0.035, -3), 2)
      b.box(30, 0.04, 8, m.paving, c.at(20, 0.035, -8), 2)
      b.box(6, 0.04, 16, m.paving, c.at(-14, 0.035, -12), 2)

      // garage: polished floor, back and side walls, slim roof on columns, open to the drive
      const gx = 20
      const gz = ESTATE.garageZ - 3
      const W = 28
      const D = 9
      const H = 3.6
      const floor = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.18, metalness: 0.05 })
      b.box(W, 0.06, D, floor, c.at(gx, 0.03, gz), 3)
      b.box(W + 0.6, 0.35, D + 0.6, m.plaster[6], c.at(gx, H + 0.17, gz), 3)
      b.box(W, H, 0.3, m.plaster[6], c.at(gx, H / 2, gz - D / 2), 3)
      for (const sx of [-1, 1]) b.box(0.3, H, D, m.plaster[6], c.at(gx + (sx * W) / 2, H / 2, gz), 3)
      for (const bx of ESTATE.bays) {
        b.box(0.08, 0.005, 5.5, m.line, c.at(bx - 2.5, 0.065, gz))
        // LED strip over each bay
        b.box(3.2, 0.05, 0.2, c.lampMat, c.at(bx, H - 0.03, gz))
      }
      b.box(0.08, 0.005, 5.5, m.line, c.at(ESTATE.bays[ESTATE.bays.length - 1] + 2.5, 0.065, gz))
      for (const lx of [gx - W / 2, gx + W / 2]) {
        const p = new THREE.Vector3().setFromMatrixPosition(c.at(lx, H / 2, gz))
        c.physics.fixedBox(p.x, H / 2, p.z, 0.15, H / 2, D / 2, plotFrame(c.plot).yaw)
      }
      {
        const p = new THREE.Vector3().setFromMatrixPosition(c.at(gx, H / 2, gz - D / 2))
        c.physics.fixedBox(p.x, H / 2, p.z, W / 2, H / 2, 0.15, plotFrame(c.plot).yaw)
      }
      nightLight(c, gx, H - 0.4, gz, '#f4f1ff', 40, 20)

      // the bungalow: the downloaded villa, closed with a glass front and a clad shell
      const v = ESTATE.villa
      const placed = placeModel(c, 'bungalow', v.x, v.z, 0, { drop: /^Sphere/, passable: /glass|window/i, floor: 0.24 })
      if (placed) {
        // villa interior spans x -3.3..7.8, z -6.1..6.1 in its own frame
        const x0 = v.x - 3.5
        const x1 = v.x + 8.1
        const zf = v.z + 6.3
        const zb = v.z - 6.3
        const cx = (x0 + x1) / 2
        const w = x1 - x0
        const stone = m.granite
        // roof slab with overhang, back wall, stone-clad side walls
        b.box(w + 2, 0.45, zf - zb + 2.4, m.trim, c.at(cx, 5.25, (zf + zb) / 2 + 0.6), 3)
        b.box(w, 5, 0.3, stone, c.at(cx, 2.5, zb), 2)
        for (const sx of [x0, x1]) b.box(0.3, 5, zf - zb, stone, c.at(sx, 2.5, (zf + zb) / 2), 2)
        // glass front with an open sliding door in the middle
        const glass = new THREE.MeshStandardMaterial({ color: '#a9c4d6', metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false })
        const door = 2.2
        for (const [a, bb] of [[x0, cx - door / 2], [cx + door / 2, x1]]) {
          b.add(new THREE.PlaneGeometry(bb - a, 4.8), glass, c.at((a + bb) / 2, 2.4, zf))
          for (let x = a; x <= bb + 0.01; x += (bb - a) / 3) b.box(0.08, 4.8, 0.12, m.frame, c.at(x, 2.4, zf))
          const p = new THREE.Vector3().setFromMatrixPosition(c.at((a + bb) / 2, 2.4, zf))
          c.physics.fixedBox(p.x, 2.4, p.z, (bb - a) / 2, 2.4, 0.1, plotFrame(c.plot).yaw)
        }
        b.box(w, 0.1, 0.14, m.frame, c.at(cx, 4.8, zf))
        for (const [lx, lz] of [[cx, zb], [x0, (zf + zb) / 2], [x1, (zf + zb) / 2]]) {
          const p = new THREE.Vector3().setFromMatrixPosition(c.at(lx, 2.5, lz))
          const along = lz === zb
          c.physics.fixedBox(p.x, 2.5, p.z, along ? w / 2 : 0.15, 2.5, along ? 0.15 : (zf - zb) / 2, plotFrame(c.plot).yaw)
        }
        // a step and a porch light
        b.box(door + 1.4, 0.12, 1.2, m.granite, c.at(cx, 0.06, zf + 0.6), 2)
        fairy(c, x0 - 1, 5.0, zf + 1.4, x1 + 1, 5.0, zf + 1.4, 0.35, true)
        nightLight(c, cx + 2, 4.2, (zf + zb) / 2, '#ffd8a8', 34, 16)
      }
      sign(c, 5.5, -26, 2.4, -0.1)
    },
  },
  egra: {
    title: 'Egra Jhatulal High School', sub: 'Egra · 2018 & 2020', accent: '#7c2a2a',
    build(c) {
      const { b, m } = c
      b.box(30, 7, 12, m.plaster[0], c.at(0, 3.5, -8), 2.5)
      b.box(30.4, 1.2, 12.4, m.redBrick, c.at(0, 0.6, -8), 2)
      for (const y of [3.3, 6.9]) b.box(30.6, 0.3, 12.6, m.trim, c.at(0, y, -8))
      for (let i = 0; i < 9; i++) {
        b.box(1.6, 1.8, 0.1, m.shutter, c.at(-12 + i * 3, 1.9, -1.95))
        b.box(1.6, 1.8, 0.1, m.shutter, c.at(-12 + i * 3, 5.2, -1.95))
      }
      for (let i = 0; i < 8; i++) b.add(new THREE.CylinderGeometry(0.22, 0.25, 3.2, 12), m.trim, c.at(-13.5 + i * 3.85, 1.6, -0.6))
      b.box(30, 0.25, 2.4, m.trim, c.at(0, 3.3, -0.9))
      b.add(new THREE.CylinderGeometry(0.06, 0.08, 9, 8), m.rail, c.at(-17, 4.5, 3))
      collider(c, 0, -8, 30, 12, 7)
      sign(c, 14, 0, 8.4, -1.9)
    },
  },
  neotia: {
    title: 'The Neotia University', sub: 'B.Tech CSE · 2020–24 · CGPA 8.59', accent: '#7a2346',
    build(c) {
      const { b, m } = c
      const h = glassTower(c, 40, 18, 4, m.glass, m.concrete)
      b.box(42, 0.6, 20, m.concrete, c.at(0, h + 0.3, -9))
      b.box(12, 0.4, 6, m.concrete, c.at(0, 4, 2))
      for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.3, 0.3, 4, 16), m.concrete, c.at(sx * 5, 2, 4.6))
      collider(c, 0, -9, 40, 18, h)
      sign(c, 18, 0, h + 2.2, -0.2)
    },
  },
  'first-jobs': {
    title: 'AILABS', sub: 'Kolkata · Engineering trainee · 2023', accent: '#1f4e9a',
    build(c) {
      const { b, m } = c
      const p = new THREE.Vector3().setFromMatrixPosition(c.at(0, 0, -7))
      townBuilding(b, m, p.x, p.z, plotFrame(c.plot).yaw, 18, 13, 3, m.plaster[3], c.r, { shop: true })
      collider(c, 0, -7, 18, 13, 10)
      sign(c, 9, 0, 3.9, -0.3)
    },
  },
  xeta: {
    title: 'Xeta Labs', sub: 'Assam · Intern 2024 → Full-stack 2025', accent: '#0d1620', ink: '#3fe0b8',
    build(c) {
      const placed = placeModel(c, 'office', 0, -12, 0, { passable: /glass|window|door/i })
      const { b } = c
      const neon = new THREE.MeshStandardMaterial({ color: '#3fe0b8', emissive: '#3fe0b8', emissiveIntensity: 1.2 })
      if (placed) {
        // teal neon outline along the roof edge and a rooftop sign
        b.box(15.6, 0.12, 0.12, neon, c.at(0.4, 5.55, -12 + 7.3))
        b.box(15.6, 0.12, 0.12, neon, c.at(0.4, 5.55, -12 - 4.6))
        nightLight(c, 0, 3.6, -12, '#d8fff4', 30, 18)
      }
      sign(c, 12, 0, 7.4, -6)
      screen(c, 8, -10, 3.4, -3)
    },
  },
  picaku: {
    title: 'Picaku', sub: 'Record · Transcribe · Never forget', accent: '#e2312b', screen: 'img/tex/picaku.webp',
    build(c) {
      const { b, m } = c
      b.box(12, 4.5, 9, m.glass, c.at(0, 2.25, -5), 3)
      b.box(12.6, 0.4, 9.6, m.trim, c.at(0, 4.7, -5))
      collider(c, 0, -5, 12, 9, 4.5)
      screen(c, 7, 0, 7.4, -0.3)
      sign(c, 6, 0, 3.2, -0.4)
    },
  },
  lifeapp: {
    title: 'Life App', sub: 'Play · Learn · Earn · 140K+ users', accent: '#1b8fe6', screen: 'img/tex/lifeapp.webp',
    build(c) {
      const { b, m } = c
      b.box(12, 4.5, 9, m.glass, c.at(0, 2.25, -5), 3)
      b.box(12.6, 0.4, 9.6, m.trim, c.at(0, 4.7, -5))
      collider(c, 0, -5, 12, 9, 4.5)
      screen(c, 7, 0, 7.4, -0.3)
      sign(c, 6, 0, 3.2, -0.4)
    },
  },
  pizzahap: {
    title: 'PizzaHap', sub: 'Crafted fire · Real flavor', accent: '#c4381b', logo: 'img/logos/pizzahap.webp', screen: 'img/tex/pizzahap.webp',
    build(c) {
      const { b, m } = c
      b.box(18, 7, 14, m.redBrick, c.at(0, 3.5, -7), 2)
      b.box(18.4, 0.4, 14.4, m.trim, c.at(0, 7.2, -7))
      b.add(new THREE.PlaneGeometry(14, 2.6), m.glassLit, c.at(0, 1.6, 0.03))
      b.box(18, 0.2, 2, m.frame, c.at(0, 3.2, 1))
      collider(c, 0, -7, 18, 14, 7)
      sign(c, 12, 0, 4.4, 0.05)
      screen(c, 9, 0, 9.8, -0.2)
    },
  },
  gobt: {
    title: 'GOBT', sub: 'Group Of Blooming Technicians · HQ', accent: '#141218', ink: '#e8b923', logo: 'img/logos/gobt.webp', screen: 'img/tex/gobt.webp',
    build(c) {
      // the GOBT campus: HQ office in the middle, apartment towers around a landscaped court
      const placed = placeModel(c, 'campus', 0, -40, 0, { passable: /glass|window|door/i, floor: 0.66 })
      const { b } = c
      const gold = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.9, roughness: 0.3, emissive: '#e8a313', emissiveIntensity: 0.2 })
      if (placed) {
        b.box(16, 0.18, 0.18, gold, c.at(0.4, 5.75, -40 + 7.4))
        nightLight(c, 0, 3.6, -40, '#ffe6b0', 30, 18)
      }
      sign(c, 14, 0, 3.2, -8)
      screen(c, 12, 14, 4.2, -9)
    },
  },
  gharkamali: {
    title: 'GharKaMali', sub: 'Gardening, made simple', accent: '#03411a', ink: '#edcf87', logo: 'img/logos/gharkamali.webp', screen: 'img/tex/gharkamali.webp',
    build(c) {
      const { b, m } = c
      // a glasshouse garden centre
      const glass = new THREE.MeshStandardMaterial({ color: '#cfe8d8', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.35 })
      b.box(26, 5, 16, glass, c.at(0, 2.5, -9), 3)
      for (let i = 0; i <= 13; i++) b.box(0.12, 5, 16, m.rail, c.at(-13 + i * 2, 2.5, -9))
      for (let i = 0; i <= 8; i++) b.box(26, 0.12, 0.12, m.rail, c.at(0, 5, -17 + i * 2))
      collider(c, 0, -9, 26, 16, 5)
      sign(c, 12, 0, 6.6, -1)
      screen(c, 8, -9, 2.6, 1.6)
    },
  },
  altaqwa: {
    title: 'Al-Taqwa', sub: 'Where luxury meets elegance', accent: '#141a3a', ink: '#e7c06a', logo: 'img/logos/altaqwa.webp', screen: 'img/tex/altaqwa.webp',
    build(c) {
      const { b, m } = c
      b.box(16, 8, 12, m.marble, c.at(0, 4, -6), 3)
      b.add(new THREE.PlaneGeometry(10, 3), m.glassLit, c.at(0, 1.8, 0.03))
      b.box(16.4, 0.5, 12.4, new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 1, roughness: 0.25 }), c.at(0, 8.2, -6))
      collider(c, 0, -6, 16, 12, 8)
      sign(c, 10, 0, 4.6, 0.04)
      screen(c, 8, 0, 10.8, -0.2)
    },
  },
  accurateastro: {
    title: 'Accurate Astro', sub: 'Talk to an expert astrologer', accent: '#123a63', logo: 'img/logos/accurateastro.webp', screen: 'img/tex/accurateastro.webp',
    build(c) {
      const { b, m } = c
      b.add(new THREE.CylinderGeometry(8, 8, 7, 40), m.concrete, c.at(0, 3.5, -9))
      b.add(new THREE.SphereGeometry(8.1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: 0.85, roughness: 0.25 }), c.at(0, 7, -9))
      const p = new THREE.Vector3().setFromMatrixPosition(c.at(0, 0, -9))
      c.physics.fixedCylinder(p.x, 6, p.z, 8, 12)
      sign(c, 11, 0, 3.4, -0.9)
      screen(c, 9, 13, 3, -6)
    },
  },
  mastermind: {
    title: 'Mastermind Abacus', sub: 'Odisha · faster math, stronger focus', accent: '#e8632d', screen: 'img/tex/mastermind.webp',
    build(c) {
      const { b, m } = c
      const p = new THREE.Vector3().setFromMatrixPosition(c.at(0, 0, -8))
      townBuilding(b, m, p.x, p.z, plotFrame(c.plot).yaw, 24, 14, 3, m.plaster[4], c.r, { shop: true })
      collider(c, 0, -8, 24, 14, 10)
      sign(c, 13, 0, 3.9, -0.6)
      screen(c, 10, 0, 12.6, -1.6)
    },
  },
  gftd: {
    title: 'GFTD', sub: 'The art of gifting', accent: '#1d2a6b', ink: '#e3b23c', logo: 'img/logos/gftd.webp', screen: 'img/tex/gftd.webp',
    build(c) {
      const { b, m } = c
      b.box(18, 7, 13, m.granite, c.at(0, 3.5, -6.5), 3)
      b.add(new THREE.PlaneGeometry(14, 2.8), m.glassLit, c.at(0, 1.7, 0.03))
      collider(c, 0, -6.5, 18, 13, 7)
      sign(c, 11, 0, 4.6, 0.04)
      screen(c, 10, 0, 10, -0.2)
    },
  },
  agile: {
    title: 'AGILE Engineering', sub: 'Civil · Mechanical · Electrical', accent: '#1e5a2a', logo: 'img/logos/agile.webp', screen: 'img/tex/agile.webp',
    build(c) {
      const { b, m } = c
      const h = glassTower(c, 24, 16, 6, m.glass, m.concrete)
      // scaffolding on one side: the firm builds things
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) b.box(0.08, 3.6, 0.08, m.rail, c.at(13.2 + (i % 2) * 1.4, 1.8 + j * 3.6, -2 - i * 2.4))
      collider(c, 0, -8, 24, 16, h)
      sign(c, 13, 0, 4.4, 0.3)
      screen(c, 10, 0, h - 5, 0.3)
    },
  },
  ideashapers: {
    title: 'Idea Shapers', sub: 'Brands the world can’t ignore', accent: '#ffffff', ink: '#1e2a78', screen: 'img/tex/ideashapers.webp',
    build(c) {
      const { b, m } = c
      b.box(16, 10, 13, m.trim, c.at(0, 5, -6.5), 3)
      b.add(new THREE.PlaneGeometry(12, 6), m.glass, c.at(0, 5, 0.03))
      collider(c, 0, -6.5, 16, 13, 10)
      sign(c, 9, 0, 1.6, 0.05)
      screen(c, 9, 0, 12.6, -0.2)
    },
  },
  fuel: {
    title: 'Skills · Fuel', sub: 'React · Next.js · Node · Flutter · DevOps', accent: '#ffc61a', ink: '#141218',
    build(c) {
      const { b, m } = c
      b.box(24, 0.8, 12, m.trim, c.at(0, 6, -6))
      for (const [x, z] of [[-10, -1], [10, -1], [-10, -11], [10, -11]]) {
        b.add(new THREE.CylinderGeometry(0.3, 0.3, 6, 12), m.trim, c.at(x, 3, z))
        const p = new THREE.Vector3().setFromMatrixPosition(c.at(x, 0, z))
        c.physics.fixedCylinder(p.x, 3, p.z, 0.35, 6)
      }
      for (const x of [-4, 4]) {
        b.box(1.2, 2, 0.8, new THREE.MeshStandardMaterial({ color: '#c4381b', roughness: 0.5 }), c.at(x, 1, -6))
        collider(c, x, -6, 1.2, 0.8, 2)
      }
      sign(c, 14, 0, 6.6, 0.1)
    },
  },
  'last-stop': {
    title: 'Let’s build something', sub: 'akashranjanmandal@gmail.com', accent: '#141218', ink: '#ffc61a',
    build(c) {
      const { b, m } = c
      const p = new THREE.Vector3().setFromMatrixPosition(c.at(0, 0, -6))
      townBuilding(b, m, p.x, p.z, plotFrame(c.plot).yaw, 16, 12, 2, m.plaster[2], c.r, { shop: true })
      collider(c, 0, -6, 16, 12, 7)
      sign(c, 12, 0, 3.9, -0.3)
    },
  },
}

export class Landmarks {
  readonly group = new THREE.Group()
  readonly spots: Spot[] = []
  private markers: THREE.Mesh[] = []
  private signMats: THREE.MeshStandardMaterial[] = []

  readonly nightLights: { light: THREE.PointLight; power: number }[] = []
  readonly fairy: FairyBuffer = { pos: [], col: [] }
  private lampMat = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffe2b0', emissiveIntensity: 0.2 })

  constructor(private physics: Physics, private mats: Materials, private tex: Map<string, THREE.Texture>, private models: Map<string, GLTF>) {}

  build() {
    const b = new Batch()
    const r = rng(42)
    for (const plot of PLOTS) {
      const spec = SPECS[plot.id]
      if (!spec) continue
      const f = plotFrame(plot)
      const base = M(f.x, 0.15, f.z, f.yaw)
      const at = (lx: number, ly: number, lz: number, yaw = 0) => base.clone().multiply(M(lx, ly, lz, yaw))
      const ctx: Ctx = { b, m: this.mats, plot, at, physics: this.physics, group: this.group, tex: this.tex, spec, r, models: this.models, nightLights: this.nightLights, lampMat: this.lampMat, fairy: this.fairy }
      const before = this.group.children.length
      spec.build(ctx)
      for (const o of this.group.children.slice(before)) {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
        if (mat?.emissiveMap) this.signMats.push(mat)
      }
      const entrance = new THREE.Vector3().setFromMatrixPosition(at(0, 0, 3.2))
      this.markers.push(marker(this.group, entrance, spec.accent === '#ffffff' ? '#1e2a78' : spec.accent === '#141218' ? '#ffc61a' : spec.accent))
      this.spots.push({ id: plot.id, title: spec.title, sub: spec.sub, pos: entrance, yaw: f.yaw })
    }
    b.build(this.group)
  }

  update(t: number, night: number) {
    for (const n of this.nightLights) n.light.intensity = night > 0.3 ? n.power * night : 0
    this.lampMat.emissiveIntensity = 0.2 + (night > 0.3 ? night * 4 : 0)
    for (const [i, mk] of this.markers.entries()) {
      const s = 1 + Math.sin(t * 2.4 + i) * 0.06
      mk.scale.set(s, 1, s)
      ;(mk.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2.4 + i) * 0.25
    }
    for (const m of this.signMats) m.emissiveIntensity = 0.5 + night * 0.9
  }
}
