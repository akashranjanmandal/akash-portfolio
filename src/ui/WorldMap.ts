import { GRID } from '../game/city/Plan'
import { ICONS, escapeHtml } from '../utils/dom'
import { trapFocus } from './focus'

/* The full-screen map: roads, river, every place with its name, your position and heading,
   your cars. Tap a place (on the map or in the list) to set a waypoint to it. */

export type MapState = {
  spots: { id: string; title: string; sub: string; x: number; z: number }[]
  player: { x: number; z: number; yaw: number }
  vehicles: { kind: string; x: number; z: number }[]
  waypoint: string | null
  visited: Set<string>
}

// the view covers the river, the station on the far bank, the town and the memorial to the north
const SPAN = 880
const CX = 10
const CZ = 35

export class WorldMap {
  private root = document.getElementById('worldmap')!
  private canvas!: HTMLCanvasElement
  private list!: HTMLElement
  private release: (() => void) | null = null
  private timer = 0
  private opener: HTMLElement | null = null
  private hits: { id: string; x: number; y: number }[] = []
  onOpen?: () => void
  onClose?: () => void
  onPick?: (id: string) => void

  constructor(private state: () => MapState) {
    this.root.innerHTML = `
      <button class="overlay-close" type="button" data-close aria-label="Close map">${ICONS.close}<span>Close</span></button>
      <div class="wmap__inner">
        <div class="wmap__stage"><canvas id="wmap-canvas" aria-label="Map of the town"></canvas></div>
        <aside class="wmap__side" data-lenis-prevent>
          <h2>Map <small>tap a place to set a waypoint</small></h2>
          <ul class="wmap__list" id="wmap-list"></ul>
        </aside>
      </div>`
    this.canvas = this.root.querySelector('#wmap-canvas')!
    this.list = this.root.querySelector('#wmap-list')!
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-close]')) return this.close()
      const li = t.closest<HTMLElement>('[data-id]')
      if (li) return this.pick(li.dataset.id!)
    })
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * this.canvas.width
      const y = ((e.clientY - r.top) / r.height) * this.canvas.height
      let best: { id: string; d: number } | null = null
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y)
        if (d < 26 * (this.canvas.width / r.width) && (!best || d < best.d)) best = { id: h.id, d }
      }
      if (best) this.pick(best.id)
    })
    addEventListener('resize', () => this.isOpen && this.draw())
  }

  get isOpen() {
    return !this.root.hidden
  }

  toggle() {
    this.isOpen ? this.close() : this.open()
  }

  private pick(id: string) {
    this.onPick?.(id)
    this.close()
  }

  open() {
    if (this.isOpen) return
    this.opener = document.activeElement as HTMLElement
    this.root.hidden = false
    this.release = trapFocus(this.root)
    ;(this.root.querySelector('[data-close]') as HTMLElement).focus({ preventScroll: true })
    this.onOpen?.()
    this.fillList()
    this.draw()
    this.timer = window.setInterval(() => this.draw(), 500)
  }

  close() {
    if (!this.isOpen) return
    clearInterval(this.timer)
    this.root.hidden = true
    this.release?.()
    this.onClose?.()
    this.opener?.focus?.({ preventScroll: true })
  }

  private fillList() {
    const s = this.state()
    const d = (x: number, z: number) => Math.round(Math.hypot(x - s.player.x, z - s.player.z))
    const items = [...s.spots].sort((a, b) => d(a.x, a.z) - d(b.x, b.z))
    this.list.innerHTML = items
      .map((p) => `<li><button type="button" data-id="${p.id}"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.sub)}</small><span>${d(p.x, p.z)} m</span></button></li>`)
      .join('')
  }

  private draw() {
    const stage = this.canvas.parentElement!
    const px = Math.max(320, Math.min(stage.clientWidth, stage.clientHeight))
    const dpr = Math.min(2, devicePixelRatio || 1)
    const S = Math.round(px * dpr)
    if (this.canvas.width !== S) {
      this.canvas.width = this.canvas.height = S
      this.canvas.style.width = this.canvas.style.height = px + 'px'
    }
    const c = this.canvas.getContext('2d')!
    const k = S / SPAN
    const PX = (v: number) => (v - CX + SPAN / 2) * k
    const PZ = (v: number) => (v - CZ + SPAN / 2) * k
    c.clearRect(0, 0, S, S)
    c.fillStyle = '#2f4a38'
    c.fillRect(0, 0, S, S)
    // river
    c.fillStyle = '#3f6a80'
    c.fillRect(PX(-312), 0, PX(-232) - PX(-312), S)
    c.fillStyle = 'rgba(255,255,255,0.07)'
    for (let y = 0; y < S; y += 40 * k) c.fillRect(PX(-312), y, PX(-232) - PX(-312), 2)
    // blocks and roads
    c.fillStyle = '#3d5a45'
    for (let i = 0; i < GRID.length - 1; i++) for (let j = 0; j < GRID.length - 1; j++) c.fillRect(PX(GRID[i] + 6), PZ(GRID[j] + 6), (GRID[i + 1] - GRID[i] - 12) * k, (GRID[j + 1] - GRID[j] - 12) * k)
    c.fillStyle = '#cfc9bb'
    for (const v of GRID) {
      c.fillRect(PX(v - 5), PZ(GRID[0] - 5), 10 * k, (GRID[GRID.length - 1] - GRID[0] + 10) * k)
      c.fillRect(PX(GRID[0] - 5), PZ(v - 5), (GRID[GRID.length - 1] - GRID[0] + 10) * k, 10 * k)
    }
    c.fillRect(PX(-400), PZ(-5), (GRID[0] - 5 + 400) * k, 10 * k)
    c.fillRect(PX(-5), PZ(-330), 10 * k, (GRID[0] - 5 + 330) * k)
    // bridge
    c.fillStyle = '#8a8478'
    c.fillRect(PX(-318), PZ(-6), 92 * k, 12 * k)

    const s = this.state()
    this.hits = []
    const fs = (px < 520 ? 10.5 : 12.5) * dpr
    c.font = `600 ${fs}px system-ui, sans-serif`
    const taken: [number, number, number, number][] = []
    c.textBaseline = 'middle'
    for (const p of s.spots) {
      const x = PX(p.x)
      const y = PZ(p.z)
      const wp = s.waypoint === p.id
      c.fillStyle = wp ? '#ffc61a' : s.visited.has(p.id) ? '#9be3b5' : '#ffffff'
      c.strokeStyle = '#141218'
      c.lineWidth = 2 * dpr
      c.beginPath()
      c.arc(x, y, (wp ? 7 : 5) * dpr, 0, Math.PI * 2)
      c.fill()
      c.stroke()
      const right = x < S * 0.78
      const tw = c.measureText(p.title).width
      const tx = x + (right ? 10 : -10) * dpr
      const box: [number, number, number, number] = [right ? tx : tx - tw, y - fs / 2, right ? tx + tw : tx, y + fs / 2]
      const clash = taken.some((t) => box[0] < t[2] + 4 && box[2] > t[0] - 4 && box[1] < t[3] + 2 && box[3] > t[1] - 2)
      if (!clash || wp) {
        taken.push(box)
        c.textAlign = right ? 'left' : 'right'
        c.lineWidth = 3.5 * dpr
        c.strokeStyle = 'rgba(15,13,20,0.85)'
        c.strokeText(p.title, tx, y)
        c.fillStyle = '#fff'
        c.fillText(p.title, tx, y)
      }
      this.hits.push({ id: p.id, x, y })
    }
    for (const v of s.vehicles) {
      c.fillStyle = v.kind === 'car' ? '#f2b705' : '#4fb3ff'
      c.fillRect(PX(v.x) - 2.5 * dpr, PZ(v.z) - 2.5 * dpr, 5 * dpr, 5 * dpr)
    }
    // you
    c.save()
    c.translate(PX(s.player.x), PZ(s.player.z))
    c.rotate(-s.player.yaw + Math.PI)
    c.fillStyle = '#ff4d6d'
    c.strokeStyle = '#fff'
    c.lineWidth = 2 * dpr
    c.beginPath()
    c.moveTo(0, -12 * dpr)
    c.lineTo(8 * dpr, 9 * dpr)
    c.lineTo(0, 5 * dpr)
    c.lineTo(-8 * dpr, 9 * dpr)
    c.closePath()
    c.fill()
    c.stroke()
    c.restore()
    // north marker
    c.fillStyle = '#fff'
    c.textAlign = 'center'
    c.fillText('N ↑', S - 30 * dpr, 20 * dpr)
  }
}
