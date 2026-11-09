import * as THREE from 'three'
import { Game } from './game/Game'
import { Loader } from './ui/Loader'
import { Phone, stopFor } from './ui/Phone'
import { Resume } from './ui/Resume'
import { Toasts } from './ui/Toasts'
import { AudioEngine } from './audio/AudioEngine'
import { ICONS, storage } from './utils/dom'
import { hasWebGL, isTouch } from './utils/device'
import { PLOTS, GRID } from './game/city/Plan'
import type { Spot } from './game/city/Landmarks'

const $ = (id: string) => document.getElementById(id)!

/* Glue between the 3D game and the page: loader, HUD, phone, sound. */
export class GameApp {
  private game!: Game
  private loader = new Loader()
  private phone = new Phone()
  private resume = new Resume()
  private toasts = new Toasts()
  private audio = new AudioEngine()
  private near: Spot | null = null
  private waypoint: Spot | null = null
  private beam: THREE.Mesh | null = null
  private visited = new Set<string>(JSON.parse(storage.get('akash:visited') ?? '[]') as string[])
  private mapCtx = ($('minimap') as HTMLCanvasElement).getContext('2d')!
  private mapBg: HTMLCanvasElement | null = null
  private frame = 0
  private helpTimer = 0
  private stepPhase = 0

  async boot() {
    this.renderIcons()
    const q = $('quality') as HTMLSelectElement
    q.value = storage.get('akash:quality') ?? 'auto'
    q.addEventListener('change', () => {
      if (q.value === 'auto') {
        try {
          localStorage.removeItem('akash:quality')
        } catch {
          /* ignore */
        }
      } else storage.set('akash:quality', q.value)
      location.reload()
    })
    if (!hasWebGL()) return this.noWebGL()
    const fonts = ['800 40px "Bricolage Grotesque Variable"', '700 40px "JetBrains Mono Variable"', '400 40px "Instrument Serif"']
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 3000))])
    const status = $('loader-status')
    const steps = ['Laying the roads…', 'Raising the buildings…', 'Planting trees…', 'Fuelling the taxi…', 'Switching on the street lights…']
    this.game = new Game($('gl') as HTMLCanvasElement, { stick: $('stick'), knob: $('stick-knob') })
    try {
      await this.game.load((p) => {
        this.loader.progress(p)
        status.textContent = steps[Math.min(steps.length - 1, Math.floor(p * steps.length))]
      })
    } catch (e) {
      console.error(e)
      return this.noWebGL()
    }
    status.textContent = 'Ready when you are.'
    this.phone.visited = this.visited
    this.wire()
    this.buildMinimap()
    this.game.engine.onTick((dt) => this.tick(dt))
    this.game.start()
    document.documentElement.classList.add('is-ready-to-start')
    await this.loader.ready()
    this.audio.init()
    this.audio.setEnabled(($('start-sound') as HTMLInputElement).checked)
    this.syncSound()
    await this.loader.hide()
    document.body.classList.add('is-ready')
    if (!isTouch) $('lockhint').classList.add('is-on')
    this.toasts.show('🏠', 'You’re home. The taxi is in the garage — bicycles are outside.', 5200)
    window.setTimeout(() => this.toasts.show('📱', isTouch ? 'Tap Phone for projects, the map and contact.' : 'Press Tab for your phone: projects, map, contact.', 5200), 5600)
  }

  private wire() {
    const g = this.game
    g.onPrompt = (text) => {
      const el = $('prompt')
      el.hidden = !text
      if (text) el.innerHTML = isTouch ? text.replace(/^F · /, '') : text.replace(/^F · /, '<kbd>F</kbd> ')
      $('touch-ride').classList.toggle('is-hot', !!text)
    }
    this.phone.onToggle = (open) => {
      document.body.classList.toggle('phone-open', open)
      if (open && document.pointerLockElement) document.exitPointerLock()
      g.input.enabled = !open || !isTouch
      this.audio.tick()
    }
    this.phone.onResume = () => {
      this.phone.toggle(false)
      this.resume.open()
    }
    this.phone.onWaypoint = (id) => this.setWaypoint(id)
    const tram = g.world.town.tram
    if (tram) tram.onBell = (pos) => this.audio.tramBell(Math.max(0, 1 - pos.distanceTo(g.player.position) / 140))
    const timeBtn = $('btn-time')
    const modes = ['day', 'golden', 'night'] as const
    const labels = { day: 'Day', golden: 'Golden hour', night: 'Night' }
    const saved = storage.get('akash:time') as (typeof modes)[number] | null
    if (saved && modes.includes(saved)) g.env.setTime(saved)
    const sync = () => ($('btn-time-label').textContent = labels[g.env.mode])
    sync()
    timeBtn.addEventListener('click', () => {
      const next = modes[(modes.indexOf(g.env.mode) + 1) % modes.length]
      g.env.setTime(next)
      storage.set('akash:time', next)
      sync()
      this.audio.tick()
    })
    this.resume.onOpen = () => {
      g.input.enabled = false
      if (document.pointerLockElement) document.exitPointerLock()
    }
    this.resume.onClose = () => (g.input.enabled = true)
    this.resume.onProject = (slug) => {
      this.resume.close()
      const plot = PLOTS.find((p) => stopFor(p.id)?.project === slug)
      if (plot) this.phone.show(plot.id)
    }

    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
      if (!el) return
      if (el.dataset.action === 'phone') this.phone.toggle()
      if (el.dataset.action === 'resume') this.resume.open()
    })
    $('near-btn').addEventListener('click', () => this.openNear())
    $('btn-sound').addEventListener('click', () => {
      this.audio.init()
      this.audio.setEnabled(!this.audio.enabled)
      this.syncSound()
    })
    // touch buttons press virtual keys
    document.querySelectorAll<HTMLElement>('#touch [data-key]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        g.input.tap(b.dataset.key!)
        if (b.dataset.key === 'Space') g.input.jump = true
      })
    })
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        this.phone.toggle()
      }
      if (e.code === 'KeyE' && !e.repeat && !this.phone.open) this.openNear()
    })
    document.addEventListener('pointerlockchange', () => $('lockhint').classList.toggle('is-on', !document.pointerLockElement && !this.phone.open))
  }

  private openNear() {
    if (!this.near) return
    this.phone.show(this.near.id)
  }

  private setWaypoint(id: string) {
    const spot = this.game.world.landmarks.spots.find((s) => s.id === id) ?? null
    this.waypoint = spot
    if (!spot) return
    if (!this.beam) {
      this.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 120, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffc61a', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      )
      this.game.engine.scene.add(this.beam)
    }
    this.beam.position.set(spot.pos.x, 60, spot.pos.z)
    this.beam.visible = true
    $('waypoint').hidden = false
    $('waypoint-name').textContent = spot.title
    this.toasts.show('📍', `Waypoint set: ${spot.title}`, 2400)
  }

  private tick(dt: number) {
    const g = this.game
    const p = g.player
    const focus = p.vehicle ? p.vehicle.position : p.position
    const cam = g.engine.camera
    const camYaw = Math.atan2(-Math.sin(cam.rotation.y), -Math.cos(cam.rotation.y))

    // nearest landmark entrance
    let best: Spot | null = null
    let bd = 6.5
    for (const s of g.world.landmarks.spots) {
      const d = Math.hypot(s.pos.x - focus.x, s.pos.z - focus.z)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    if (best !== this.near) {
      this.near = best
      const el = $('near')
      el.hidden = !best
      if (best) {
        $('near-title').textContent = best.title
        $('near-sub').textContent = best.sub
        if (!this.visited.has(best.id)) {
          this.visited.add(best.id)
          storage.set('akash:visited', JSON.stringify([...this.visited]))
          this.audio.pickup()
        }
        if (this.waypoint?.id === best.id) this.clearWaypoint()
      }
    }

    // waypoint direction
    if (this.waypoint) {
      const dx = this.waypoint.pos.x - focus.x
      const dz = this.waypoint.pos.z - focus.z
      const d = Math.hypot(dx, dz)
      $('waypoint-dist').textContent = d > 999 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`
      const ang = Math.atan2(dx, dz) - camYaw
      $('waypoint-arrow').style.transform = `rotate(${-ang}rad)`
      if (this.beam) (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.min(0.25, d / 600)
    }

    // speed and engine sound
    const v = p.vehicle
    const speedEl = $('speed')
    speedEl.hidden = !v
    if (v) $('speed-num').textContent = String(Math.round(Math.abs(v.speed) * 3.6))
    this.audio.update(v?.kind === 'car' ? v.speed : 0, v?.kind === 'car' ? Math.min(1, Math.abs(g.input.move.y)) : 0, false, v?.kind === 'car', g.env.night)
    // footsteps keep time with the stride
    const gait = p.gait
    if (!v && gait.grounded && gait.speed > 0.6) {
      this.stepPhase += dt * (gait.speed > 4.5 ? 3.1 : 1.9) * Math.min(1.4, gait.speed / 3)
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1
        this.audio.footstep(gait.speed > 4.5)
      }
    } else this.stepPhase = 0.8
    if (v && g.input.consume('KeyH')) this.audio.horn()

    // compass + minimap
    $('compass-strip').style.transform = `translateX(${(-camYaw / (Math.PI * 2)) * 480}px)`
    this.phone.where = { x: focus.x, z: focus.z, yaw: p.vehicle ? p.vehicle.yaw : p.yaw + Math.PI }
    if (this.frame++ % 3 === 0) this.drawMinimap(focus, camYaw)

    document.body.classList.toggle('first-person', p.view === 'first' && !p.vehicle)
    // fade the key help after a while
    this.helpTimer += dt
    if (this.helpTimer > 14) $('help').classList.add('is-faded')
  }

  private clearWaypoint() {
    this.waypoint = null
    this.phone.waypoint = null
    $('waypoint').hidden = true
    if (this.beam) this.beam.visible = false
  }

  private buildMinimap() {
    const S = 400
    const bg = document.createElement('canvas')
    bg.width = bg.height = S
    const g = bg.getContext('2d')!
    g.fillStyle = '#35553f'
    g.fillRect(0, 0, S, S)
    const span = 900
    const P = (v: number) => ((v + span / 2) / span) * S
    g.fillStyle = '#4f6d7a'
    g.fillRect(P(-312), 0, P(-232) - P(-312), S)
    g.fillStyle = '#d8d2c6'
    for (const v of GRID) {
      g.fillRect(P(v - 5), P(-205), P(v + 5) - P(v - 5), P(205) - P(-205))
      g.fillRect(P(-205), P(v - 5), P(205) - P(-205), P(v + 5) - P(v - 5))
    }
    g.fillRect(P(-400), P(-5), P(-205) - P(-400), P(5) - P(-5))
    g.fillRect(P(-5), P(-330), P(5) - P(-5), P(-205) - P(-330))
    this.mapBg = bg
  }

  private drawMinimap(focus: THREE.Vector3, camYaw: number) {
    const c = this.mapCtx
    const W = c.canvas.width
    if (!this.mapBg) return
    const span = 900
    const zoom = 2.2
    c.save()
    c.clearRect(0, 0, W, W)
    c.beginPath()
    c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2)
    c.clip()
    c.translate(W / 2, W / 2)
    // map rotates so "up" is where the camera looks
    c.rotate(camYaw + Math.PI)
    const scale = (W / span) * zoom
    c.scale(scale, scale)
    c.translate(-focus.x, -focus.z)
    c.drawImage(this.mapBg, -span / 2, -span / 2, span, span)
    for (const s of this.game.world.landmarks.spots) {
      c.fillStyle = this.waypoint?.id === s.id ? '#ffc61a' : this.visited.has(s.id) ? '#9be3b5' : '#ffffff'
      c.beginPath()
      c.arc(s.pos.x, s.pos.z, 4.5 / zoom * 2, 0, Math.PI * 2)
      c.fill()
    }
    for (const v of this.game.vehicles) {
      c.fillStyle = v.kind === 'car' ? '#f2b705' : '#4fb3ff'
      c.fillRect(v.position.x - 2, v.position.z - 2, 4, 4)
    }
    c.restore()
    // player arrow at the centre, always pointing up
    c.fillStyle = '#ff4d6d'
    c.beginPath()
    c.moveTo(W / 2, W / 2 - 10)
    c.lineTo(W / 2 + 7, W / 2 + 8)
    c.lineTo(W / 2 - 7, W / 2 + 8)
    c.closePath()
    c.fill()
  }

  private syncSound() {
    const b = $('btn-sound')
    b.setAttribute('aria-pressed', String(this.audio.enabled))
    b.querySelector('[data-icon]')!.innerHTML = this.audio.enabled ? ICONS.soundOn : ICONS.soundOff
  }

  private renderIcons() {
    document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
      const svg = ICONS[el.dataset.icon as keyof typeof ICONS]
      if (svg) el.innerHTML = svg
    })
  }

  /** without WebGL: skip the town, show the resume */
  private async noWebGL() {
    document.documentElement.classList.add('no-gl')
    this.loader.progress(1)
    await this.loader.ready()
    await this.loader.hide()
    this.resume.open()
  }
}
