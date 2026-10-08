import type { DriveInput } from '../gl/car/Vehicle'
import { islandOutline, waterOutline, road, ANCHORS, ISLAND } from '../gl/world/Layout'
import { angleDelta, clamp } from '../utils/math'
import { STOPS } from '../content'

/* ──────────────────────────────────────────────────────────────
   DRIVE UI
   Keyboard: car-relative (W/S throttle, A/D steer).
   Touch:    camera-relative joystick — point where you want to go
             and the taxi steers there. Plus boost and horn.
────────────────────────────────────────────────────────────── */

export class DriveUI {
  readonly root = document.getElementById('drive')!
  private keys = new Set<string>()
  private stickEl = document.getElementById('stick')!
  private knob = document.getElementById('stick-knob')!
  private stick = { id: -1, x: 0, y: 0, cx: 0, cy: 0, r: 60 }
  private boostTouch = false
  private zoneEl = document.getElementById('zone')!
  private zoneK = document.getElementById('zone-k')!
  private zoneTitle = document.getElementById('zone-title')!
  private speedo = document.getElementById('speedo')!
  private bugNum = document.getElementById('bug-num')!
  private bugBox = document.getElementById('bug-count')!
  private keysHelp = document.getElementById('keys')!
  private minimap = document.getElementById('minimap') as HTMLCanvasElement
  private mapCtx = this.minimap.getContext('2d')!
  private mapBg: HTMLCanvasElement | null = null
  private mapScale = 1
  private mapW = 0
  private mapH = 0
  private zone = -1
  private lastSpeed = -1
  private frame = 0
  enabled = false
  readonly input: DriveInput = { throttle: 0, steer: 0, brake: false, boost: false }

  onHorn?: () => void
  onReset?: () => void
  onExit?: () => void
  onOpenZone?: (i: number) => void
  onZoom?: (delta: number) => void
  /** first real input, to fade the key help */
  private touched = false

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [role="dialog"]:not(#drive)') && !target.closest('#drive')) return
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd', 'shift'].includes(k)) {
        e.preventDefault()
        this.keys.add(k)
        this.markTouched()
      }
      if (k === 'h' && !e.repeat) this.onHorn?.()
      if (k === 'r' && !e.repeat) this.onReset?.()
      if (k === 'escape') this.onExit?.()
      if (k === 'enter' && this.zone >= 0 && !e.repeat) {
        e.preventDefault()
        this.onOpenZone?.(this.zone)
      }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

    // joystick
    this.stickEl.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return
      this.stick.id = e.pointerId
      this.stickEl.setPointerCapture(e.pointerId)
      const r = this.stickEl.getBoundingClientRect()
      this.stick.cx = r.left + r.width / 2
      this.stick.cy = r.top + r.height / 2
      this.stick.r = r.width / 2 - 14
      this.moveStick(e.clientX, e.clientY)
      this.markTouched()
    })
    this.stickEl.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) this.moveStick(e.clientX, e.clientY)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return
      this.stick.id = -1
      this.stick.x = this.stick.y = 0
      this.knob.style.transform = ''
    }
    this.stickEl.addEventListener('pointerup', end)
    this.stickEl.addEventListener('pointercancel', end)
    this.stickEl.addEventListener('lostpointercapture', end)

    const hold = (el: HTMLElement, on: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        el.classList.add('is-on')
        on(true)
      })
      const off = () => {
        el.classList.remove('is-on')
        on(false)
      }
      el.addEventListener('pointerup', off)
      el.addEventListener('pointercancel', off)
      el.addEventListener('lostpointercapture', off)
      el.addEventListener('contextmenu', (e) => e.preventDefault())
    }
    hold(document.getElementById('btn-boost')!, (v) => (this.boostTouch = v))
    hold(document.getElementById('btn-horn')!, (v) => v && this.onHorn?.())
    document.getElementById('btn-reset')!.addEventListener('click', () => this.onReset?.())
    document.getElementById('zone-open')!.addEventListener('click', () => this.zone >= 0 && this.onOpenZone?.(this.zone))

    window.addEventListener('wheel', (e) => {
      if (!this.enabled || (e.target as HTMLElement).closest('.modal, .resume, .sheet')) return
      this.onZoom?.(Math.sign(e.deltaY) * 0.08)
    }, { passive: true })
  }

  private markTouched() {
    if (this.touched) return
    this.touched = true
    window.setTimeout(() => this.keysHelp.classList.add('is-faded'), 4000)
  }

  private moveStick(x: number, y: number) {
    let dx = (x - this.stick.cx) / this.stick.r
    let dy = (y - this.stick.cy) / this.stick.r
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    this.stick.x = dx
    this.stick.y = dy
    this.knob.style.transform = `translate(${dx * this.stick.r}px, ${dy * this.stick.r}px)`
  }

  show() {
    this.enabled = true
    this.root.hidden = false
    this.keysHelp.classList.remove('is-faded')
    this.touched = false
    this.layoutMinimap()
  }

  hide() {
    this.enabled = false
    this.root.hidden = true
    this.keys.clear()
    this.stick.id = -1
    this.stick.x = this.stick.y = 0
    this.boostTouch = false
    this.knob.style.transform = ''
    this.setZone(-1)
  }

  /** turn raw input into throttle/steer; the stick is relative to the camera */
  read(carYaw: number, cameraYaw: number, speed: number): DriveInput {
    const k = this.keys
    let throttle = (k.has('arrowup') || k.has('w') ? 1 : 0) - (k.has('arrowdown') || k.has('s') ? 1 : 0)
    let steer = (k.has('arrowleft') || k.has('a') ? 1 : 0) - (k.has('arrowright') || k.has('d') ? 1 : 0)
    const sx = this.stick.x
    const sy = this.stick.y
    const m = Math.hypot(sx, sy)
    if (m > 0.18) {
      // screen up = where the camera looks
      const desired = cameraYaw + Math.atan2(-sx, -sy)
      const diff = angleDelta(carYaw, desired)
      const mag = clamp((m - 0.18) / 0.82)
      if (Math.abs(diff) < 2.0 || Math.abs(speed) > 4) {
        throttle = mag * (Math.abs(diff) > 1.6 ? 0.6 : 1)
        steer = clamp(diff * 1.9, -1, 1)
      } else {
        // target behind a slow car: back up while turning
        throttle = -mag * 0.8
        steer = -Math.sign(diff)
      }
    }
    this.input.throttle = throttle
    this.input.steer = steer
    this.input.brake = k.has(' ')
    this.input.boost = k.has('shift') || this.boostTouch
    return this.input
  }

  setSpeed(kmh: number) {
    const v = Math.round(Math.abs(kmh))
    if (v !== this.lastSpeed) {
      this.lastSpeed = v
      this.speedo.textContent = String(v)
    }
  }

  setBugs(found: number, total: number, bump = false) {
    this.bugNum.textContent = `${found}/${total}`
    if (bump) {
      this.bugBox.classList.remove('is-bump')
      void this.bugBox.offsetWidth
      this.bugBox.classList.add('is-bump')
    }
  }

  setZone(i: number) {
    if (i === this.zone) return
    this.zone = i
    if (i < 0) {
      this.zoneEl.hidden = true
      return
    }
    const s = STOPS[i]
    this.zoneK.textContent = i === STOPS.length - 1 ? 'Last stop' : `Stop ${String(i).padStart(2, '0')}`
    this.zoneTitle.textContent = s.label
    this.zoneEl.hidden = false
  }

  /* ── minimap ───────────────────────────────────────────── */

  layoutMinimap() {
    const rect = this.minimap.getBoundingClientRect()
    if (!rect.width) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.mapW = Math.round(rect.width * dpr)
    this.mapH = Math.round(rect.height * dpr)
    this.minimap.width = this.mapW
    this.minimap.height = this.mapH
    const pad = 8 * dpr
    this.mapScale = Math.min((this.mapW - pad * 2) / (ISLAND.halfX * 2), (this.mapH - pad * 2) / (ISLAND.halfZ * 2))
    const bg = document.createElement('canvas')
    bg.width = this.mapW
    bg.height = this.mapH
    const g = bg.getContext('2d')!
    const P = (x: number, z: number): [number, number] => [this.mapW / 2 + x * this.mapScale, this.mapH / 2 + z * this.mapScale]
    const poly = (pts: { x: number; y: number }[], fill: string) => {
      g.beginPath()
      pts.forEach((p, i) => (i ? g.lineTo(...P(p.x, p.y)) : g.moveTo(...P(p.x, p.y))))
      g.closePath()
      g.fillStyle = fill
      g.fill()
    }
    poly(islandOutline(), 'rgba(140,196,96,0.55)')
    poly(waterOutline(), 'rgba(80,170,230,0.8)')
    g.beginPath()
    road.points.forEach((p, i) => (i ? g.lineTo(...P(p.x, p.z)) : g.moveTo(...P(p.x, p.z))))
    g.closePath()
    g.strokeStyle = 'rgba(30,28,36,0.9)'
    g.lineWidth = Math.max(2, 5 * this.mapScale)
    g.stroke()
    for (const a of ANCHORS) {
      g.beginPath()
      g.arc(...P(a.landmark.x, a.landmark.z), 2.6 * dpr, 0, Math.PI * 2)
      g.fillStyle = '#ffc61a'
      g.fill()
    }
    this.mapBg = bg
  }

  drawMinimap(car: { x: number; z: number }, yaw: number, bugs: { x: number; z: number; found: boolean }[]) {
    if (!this.mapBg || !this.enabled) return
    if (this.frame++ % 2) return
    const g = this.mapCtx
    const dpr = this.mapW / (this.minimap.clientWidth || 1)
    g.clearRect(0, 0, this.mapW, this.mapH)
    g.drawImage(this.mapBg, 0, 0)
    const P = (x: number, z: number): [number, number] => [this.mapW / 2 + x * this.mapScale, this.mapH / 2 + z * this.mapScale]
    g.fillStyle = '#ff4d6d'
    for (const b of bugs) {
      if (b.found) continue
      g.beginPath()
      g.arc(...P(b.x, b.z), 2 * dpr, 0, Math.PI * 2)
      g.fill()
    }
    const [cx, cy] = P(car.x, car.z)
    g.save()
    g.translate(cx, cy)
    // canvas y is world z; yaw is atan2(x, z)
    g.rotate(-yaw + Math.PI)
    g.beginPath()
    g.moveTo(0, -6 * dpr)
    g.lineTo(4.5 * dpr, 5 * dpr)
    g.lineTo(-4.5 * dpr, 5 * dpr)
    g.closePath()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#141218'
    g.lineWidth = 1.5 * dpr
    g.fill()
    g.stroke()
    g.restore()
  }
}
