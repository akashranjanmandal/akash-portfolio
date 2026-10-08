import * as THREE from 'three'
import { ISLAND, ROAD_WIDTH, road, islandOutline, waterOutline, ANCHORS } from './world/Layout'
import { MAIDAN, PITCH, PADDY, TEA, CITY, nearStop } from './world/Zones'
import { noise2, rng } from '../utils/math'

/* Canvas-painted textures: the ground, the road, signage. Everything
   is generated at load time, so the site ships no texture files for
   the world itself. */

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  return { c, g }
}

export function toTexture(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c)
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = opts.aniso ?? 4
  return t
}

/* ── ground ─────────────────────────────────────────────────── */

export function groundTexture(size: number) {
  const W = size
  const H = Math.round(size * (ISLAND.halfZ / ISLAND.halfX))
  const { c, g } = canvas(W, H)
  const sx = W / (ISLAND.halfX * 2)
  const sz = H / (ISLAND.halfZ * 2)
  const X = (x: number) => (x + ISLAND.halfX) * sx
  const Z = (z: number) => (z + ISLAND.halfZ) * sz
  const U = (u: number) => u * sx // world units → pixels

  // base: blotchy grass from a small value-noise image scaled up smoothly
  const nW = 220
  const nH = Math.round(nW * (H / W))
  const { c: nc, g: ng } = canvas(nW, nH)
  const img = ng.createImageData(nW, nH)
  const low = [124, 182, 86]
  const high = [150, 201, 98]
  const dark = [104, 160, 74]
  for (let j = 0; j < nH; j++) {
    for (let i = 0; i < nW; i++) {
      const n1 = noise2(i * 0.08, j * 0.08)
      const n2 = noise2(i * 0.31 + 40, j * 0.31 + 11)
      const n = n1 * 0.72 + n2 * 0.28
      const k = (j * nW + i) * 4
      const t = Math.min(1, Math.max(0, (n - 0.3) / 0.45))
      const d = Math.max(0, 0.35 - n1) * 1.4
      for (let ch = 0; ch < 3; ch++) img.data[k + ch] = (low[ch] + (high[ch] - low[ch]) * t) * (1 - d) + dark[ch] * d
      img.data[k + 3] = 255
    }
  }
  ng.putImageData(img, 0, 0)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(nc, 0, 0, W, H)

  const path = (pts: { x: number; y: number }[]) => {
    g.beginPath()
    pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.y)) : g.moveTo(X(p.x), Z(p.y))))
    g.closePath()
  }

  // sandy banks around the river and lake
  const water = waterOutline()
  g.lineJoin = 'round'
  path(water)
  g.strokeStyle = '#d8c58e'
  g.lineWidth = U(7)
  g.stroke()
  g.strokeStyle = '#b79f6a'
  g.lineWidth = U(3)
  g.stroke()

  // road shoulder
  g.beginPath()
  road.points.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))))
  g.closePath()
  g.strokeStyle = 'rgba(122,140,84,0.85)'
  g.lineWidth = U(ROAD_WIDTH + 4)
  g.stroke()
  g.strokeStyle = 'rgba(176,160,112,0.9)'
  g.lineWidth = U(ROAD_WIDTH + 1.6)
  g.stroke()

  // paddy fields: plots separated by raised earth bunds
  const r = rng(11)
  for (const p of PADDY) {
    g.fillStyle = '#c9b27a'
    g.fillRect(X(p.x0), Z(p.z0), U(p.x1 - p.x0), U(p.z1 - p.z0))
    const cols = Math.max(2, Math.round((p.x1 - p.x0) / 6.5))
    const rows = Math.max(2, Math.round((p.z1 - p.z0) / 5.5))
    const pw = (p.x1 - p.x0) / cols
    const ph = (p.z1 - p.z0) / rows
    const greens = ['#8fcf4f', '#a3d95e', '#7fc04a', '#b6e07a', '#98cf6a']
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        g.fillStyle = greens[Math.floor(r() * greens.length)]
        g.fillRect(X(p.x0 + i * pw + 0.35), Z(p.z0 + j * ph + 0.35), U(pw - 0.7), U(ph - 0.7))
        // rows of seedlings
        g.strokeStyle = 'rgba(70,120,40,0.28)'
        g.lineWidth = Math.max(1, U(0.18))
        for (let k = 0.8; k < pw - 0.5; k += 0.9) {
          g.beginPath()
          g.moveTo(X(p.x0 + i * pw + k), Z(p.z0 + j * ph + 0.6))
          g.lineTo(X(p.x0 + i * pw + k), Z(p.z0 + (j + 1) * ph - 0.6))
          g.stroke()
        }
      }
    }
  }

  // tea garden soil
  g.fillStyle = '#5d8a45'
  roundRect(g, X(TEA.x0), Z(TEA.z0), U(TEA.x1 - TEA.x0), U(TEA.z1 - TEA.z0), U(3))
  g.fill()

  // the maidan: mown stripes, boundary rope and the pitch
  g.save()
  g.beginPath()
  g.ellipse(X(MAIDAN.x), Z(MAIDAN.z), U(MAIDAN.rx), U(MAIDAN.rz), 0, 0, Math.PI * 2)
  g.fillStyle = '#9ccf62'
  g.fill()
  g.clip()
  for (let i = -MAIDAN.rx; i < MAIDAN.rx; i += 3) {
    if (Math.round(i / 3) % 2) continue
    g.fillStyle = 'rgba(255,255,255,0.07)'
    g.fillRect(X(MAIDAN.x + i), Z(MAIDAN.z - MAIDAN.rz), U(3), U(MAIDAN.rz * 2))
  }
  g.restore()
  g.beginPath()
  g.ellipse(X(MAIDAN.x), Z(MAIDAN.z), U(MAIDAN.rx - 1), U(MAIDAN.rz - 1), 0, 0, Math.PI * 2)
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = U(0.25)
  g.stroke()
  g.fillStyle = '#d9c590'
  g.fillRect(X(PITCH.x - PITCH.l / 2), Z(PITCH.z - PITCH.w / 2), U(PITCH.l), U(PITCH.w))
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = Math.max(1, U(0.1))
  for (const dx of [-PITCH.l / 2 + 1.2, PITCH.l / 2 - 1.2]) {
    g.beginPath()
    g.moveTo(X(PITCH.x + dx), Z(PITCH.z - PITCH.w / 2 - 0.4))
    g.lineTo(X(PITCH.x + dx), Z(PITCH.z + PITCH.w / 2 + 0.4))
    g.stroke()
  }

  // city: pavements under the blocks
  g.fillStyle = '#c9c1b2'
  roundRect(g, X(CITY.x0 - 1), Z(CITY.z0 - 1), U(CITY.x1 - CITY.x0 + 2), U(CITY.z1 - CITY.z0 + 2), U(2))
  g.fill()

  // paved forecourts in front of landmarks
  const pave = (id: string, w: number, d: number, color: string, extra = 0) => {
    const a = ANCHORS.find((s) => s.id === id)!
    g.save()
    const cx = X(a.landmark.x - a.right.x * a.place.side * extra)
    const cz = Z(a.landmark.z - a.right.z * a.place.side * extra)
    g.translate(cx, cz)
    g.rotate(Math.atan2(a.tan.z, a.tan.x))
    g.fillStyle = color
    roundRect(g, -U(w / 2), -U(d / 2), U(w), U(d), U(1.2))
    g.fill()
    g.restore()
  }
  pave('boarding', 26, 12, '#d6cbb4', 3)
  pave('egra', 18, 13, '#d2b88a', 2)
  pave('neotia', 22, 15, '#d9d3c6', 3)
  pave('gobt', 16, 14, '#2c2a31', 3)
  pave('pizzahap', 15, 13, '#cbb79c', 2)
  pave('altaqwa', 11, 11, '#e2d6bd', 1)
  pave('accurateastro', 14, 13, '#c9cbd6', 2)
  pave('mastermind', 16, 11, '#e9d7b6', 2)
  pave('gftd', 15, 13, '#d9cdb8', 1)
  pave('agile', 18, 16, '#b9aa8f', 2)
  pave('ideashapers', 12, 12, '#d4d3df', 1)
  pave('fuel', 22, 14, '#bdb9b0', 4)
  pave('last-stop', 12, 8, '#d6cbb4', 3)

  // flower bed soil at the garden
  const gk = nearStop('gharkamali', 0, 14)
  g.fillStyle = '#6e4b33'
  roundRect(g, X(gk.x - 6), Z(gk.z - 3), U(12), U(6), U(1.5))
  g.fill()

  // a few dusty footpaths into the village
  const r2 = rng(5)
  g.strokeStyle = 'rgba(205,178,124,0.9)'
  g.lineCap = 'round'
  g.lineWidth = U(1.4)
  for (let i = 0; i < 3; i++) {
    const a = nearStop('egra', -8 + i * 8, 4)
    const b = nearStop('egra', -12 + i * 10 + r2() * 4, 18 + r2() * 4)
    g.beginPath()
    g.moveTo(X(a.x), Z(a.z))
    g.quadraticCurveTo(X((a.x + b.x) / 2 + 3), Z((a.z + b.z) / 2), X(b.x), Z(b.z))
    g.stroke()
  }

  // the island rim gets a slightly darker, sun-dried edge
  const rim = islandOutline()
  path(rim)
  g.strokeStyle = 'rgba(96,140,60,0.45)'
  g.lineWidth = U(2.5)
  g.stroke()

  const t = toTexture(c, { aniso: 8 })
  t.repeat.set(1 / (ISLAND.halfX * 2), 1 / (ISLAND.halfZ * 2))
  t.offset.set(0.5, 0.5)
  return t
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

/* ── road ───────────────────────────────────────────────────── */

/** asphalt tile: u across the road, v along it (one tile = 8 world units) */
export function roadTexture() {
  const { c, g } = canvas(256, 512)
  g.fillStyle = '#5a5966'
  g.fillRect(0, 0, 256, 512)
  const r = rng(3)
  for (let i = 0; i < 2600; i++) {
    const v = 70 + r() * 36
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.25 + r() * 0.3})`
    g.fillRect(r() * 256, r() * 512, 1 + r() * 2, 1 + r() * 2)
  }
  // tyre-worn lanes
  g.fillStyle = 'rgba(0,0,0,0.07)'
  g.fillRect(40, 0, 40, 512)
  g.fillRect(176, 0, 40, 512)
  // edge lines
  g.fillStyle = '#ece8dc'
  g.fillRect(14, 0, 7, 512)
  g.fillRect(235, 0, 7, 512)
  // dashed centre line
  g.fillStyle = '#ffd23f'
  g.fillRect(124, 40, 8, 200)
  g.fillRect(124, 296, 8, 200)
  return toTexture(c, { repeat: true, aniso: 8 })
}

/** kerb stones painted in the black-and-yellow stripes of Kolkata roads */
export function kerbTexture() {
  const { c, g } = canvas(64, 256)
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#1d1c22' : '#f2c21b'
    g.fillRect(0, i * 64, 64, 64)
  }
  g.fillStyle = 'rgba(0,0,0,0.18)'
  for (let i = 0; i < 4; i++) g.fillRect(0, i * 64, 64, 3)
  return toTexture(c, { repeat: true })
}

/* ── glow sprites ───────────────────────────────────────────── */

export function glowTexture(inner = 'rgba(255,236,190,1)', outer = 'rgba(255,200,120,0)') {
  const { c, g } = canvas(128, 128)
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'))
  grd.addColorStop(1, outer)
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return toTexture(c)
}

/* ── signage ────────────────────────────────────────────────── */

export const FONT = {
  display: '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  serif: '"Instrument Serif", Georgia, serif',
}

type Line = { text: string; size: number; font?: string; weight?: number; color?: string; y: number; x?: number; align?: CanvasTextAlign; spacing?: number; maxWidth?: number }

export function signTexture(w: number, h: number, bg: string | ((g: CanvasRenderingContext2D) => void), lines: Line[], opts: { radius?: number; border?: string; borderWidth?: number } = {}) {
  const { c, g } = canvas(w, h)
  if (typeof bg === 'string') {
    g.fillStyle = bg
    if (opts.radius) {
      roundRect(g, 0, 0, w, h, opts.radius)
      g.fill()
    } else g.fillRect(0, 0, w, h)
  } else bg(g)
  if (opts.border) {
    g.strokeStyle = opts.border
    g.lineWidth = opts.borderWidth ?? 8
    roundRect(g, g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, opts.radius ?? 0)
    g.stroke()
  }
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ${l.font ?? FONT.display}`
    g.fillStyle = l.color ?? '#141218'
    g.textAlign = l.align ?? 'center'
    g.textBaseline = 'middle'
    if ('letterSpacing' in g && l.spacing) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.spacing}px`
    else if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
    g.fillText(l.text, l.x ?? w / 2, l.y, l.maxWidth ?? w * 0.92)
  }
  return toTexture(c, { aniso: 8 })
}
