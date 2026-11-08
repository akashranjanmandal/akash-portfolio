import * as THREE from 'three'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import { townBuilding, type Materials } from './Town'
import { PLOTS, plotFrame, type Plot } from './Plan'
import { rng } from '../../utils/math'

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

const SPECS: Record<string, Spec> = {
  home: {
    title: 'Akash', sub: 'Home · Garage', accent: '#141218', ink: '#ffc61a',
    build(c) {
      const { b, m } = c
      // a two-storey house on the left, a garage with the shutter up on the right
      const house = c.at(-6, 0, -8)
      const hp = new THREE.Vector3().setFromMatrixPosition(house)
      townBuilding(b, m, hp.x, hp.z, plotFrame(c.plot).yaw, 12, 14, 2, m.plaster[0], c.r)
      collider(c, -6, -8, 12, 14, 7)
      const gw = 9
      const gd = 12
      b.box(gw, 0.3, gd, m.concrete, c.at(7, 0.15, -6), 2)
      b.box(0.3, 4.2, gd, m.brick, c.at(7 - gw / 2, 2.1, -6), 2.5)
      b.box(0.3, 4.2, gd, m.brick, c.at(7 + gw / 2, 2.1, -6), 2.5)
      b.box(gw, 4.2, 0.3, m.brick, c.at(7, 2.1, -6 - gd / 2), 2.5)
      b.box(gw + 0.6, 0.35, gd + 0.6, m.roof, c.at(7, 4.35, -6), 3)
      b.box(gw, 0.6, 0.3, m.brick, c.at(7, 3.9, -6 + gd / 2), 2.5)
      for (const [lx, w, d] of [[7 - gw / 2, 0.3, gd], [7 + gw / 2, 0.3, gd]] as const) collider(c, lx, -6, w, d, 4.2)
      collider(c, 7, -6 - gd / 2, gw, 0.3, 4.2)
      sign(c, 5.5, -6, 4.1, -0.9)
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
      const { b, m } = c
      const neon = new THREE.MeshStandardMaterial({ color: '#3fe0b8', emissive: '#3fe0b8', emissiveIntensity: 1.2 })
      const h = glassTower(c, 26, 18, 7, m.glass, m.frame)
      for (const [x, z] of [[-13, 0], [13, 0], [-13, -18], [13, -18]]) b.box(0.18, h, 0.18, neon, c.at(x, h / 2, z))
      for (let f = 1; f < 7; f++) b.box(26.2, 0.08, 0.08, neon, c.at(0, f * 3.6, 0.06))
      b.box(10, 0.3, 6, m.frame, c.at(0, 4.2, 3))
      collider(c, 0, -9, 26, 18, h)
      sign(c, 14, 0, h + 1.8, -1)
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
      const { b, m } = c
      const gold = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.9, roughness: 0.3 })
      const h = glassTower(c, 22, 22, 12, m.glass, gold)
      b.box(24, 1.2, 24, gold, c.at(0, h + 0.6, -11))
      collider(c, 0, -11, 22, 22, h)
      sign(c, 14, 0, 5.2, 0.3)
      screen(c, 12, 0, 12, 0.3)
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

  constructor(private physics: Physics, private mats: Materials, private tex: Map<string, THREE.Texture>) {}

  build() {
    const b = new Batch()
    const r = rng(42)
    for (const plot of PLOTS) {
      const spec = SPECS[plot.id]
      if (!spec) continue
      const f = plotFrame(plot)
      const base = M(f.x, 0.15, f.z, f.yaw)
      const at = (lx: number, ly: number, lz: number, yaw = 0) => base.clone().multiply(M(lx, ly, lz, yaw))
      const ctx: Ctx = { b, m: this.mats, plot, at, physics: this.physics, group: this.group, tex: this.tex, spec, r }
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
    for (const [i, mk] of this.markers.entries()) {
      const s = 1 + Math.sin(t * 2.4 + i) * 0.06
      mk.scale.set(s, 1, s)
      ;(mk.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2.4 + i) * 0.25
    }
    for (const m of this.signMats) m.emissiveIntensity = 0.5 + night * 0.9
  }
}
