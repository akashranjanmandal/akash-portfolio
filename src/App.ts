import * as THREE from 'three'
import gsap from 'gsap'
import { STOPS, PROJECTS } from './content'
import { Story, type StoryState } from './ui/Story'
import { Panels } from './ui/Panels'
import { Hud } from './ui/Hud'
import { Modal } from './ui/Modal'
import { Resume } from './ui/Resume'
import { Toasts } from './ui/Toasts'
import { Cursor } from './ui/Cursor'
import { Loader } from './ui/Loader'
import { DriveUI } from './ui/DriveUI'
import { AudioEngine } from './audio/AudioEngine'
import { Experience } from './gl/Experience'
import { World } from './gl/World'
import { CameraRig, stopShot, chaseShot, blendTravel, type Shot } from './gl/CameraRig'
import { ANCHORS, road, storyToRoad, roadToStory } from './gl/world/Layout'
import { ICONS, storage } from './utils/dom'
import { hasWebGL, isTouch, reducedMotion } from './utils/device'
import { clamp, easeInOutCubic } from './utils/math'

type Mode = 'loading' | 'intro' | 'story' | 'drive'

/* ──────────────────────────────────────────────────────────────
   APP
   The conductor: scroll → story state → taxi on the road + camera
   shot + ticket on screen. "Take the wheel" swaps the scroll for
   physics and a follow camera. Everything else (sound, meter,
   bugs, achievements) listens in.
────────────────────────────────────────────────────────────── */

const ACH_KEY = 'akash:achievements'
const ROUTE_KM = 17 // a pretend fare distance for the whole ride

export class App {
  private story = new Story(document.getElementById('track')!)
  private panels = new Panels(document.getElementById('panels')!)
  private hud = new Hud((i) => this.goTo(i))
  private modal = new Modal()
  private resume = new Resume()
  private toasts = new Toasts()
  private cursor = new Cursor()
  private loader = new Loader()
  private drive = new DriveUI()
  private audio = new AudioEngine()
  private exp: Experience | null = null
  private world: World | null = null
  private rig: CameraRig | null = null
  private mode: Mode = 'loading'
  private gl = hasWebGL()
  private achievements = new Set<string>(JSON.parse(storage.get(ACH_KEY) ?? '[]') as string[])
  private odometer = 0
  private lastCar = new THREE.Vector3()
  private introT = 0
  private introFrom: Shot | null = null
  private introTween: gsap.core.Tween | null = null
  private shotA: Shot = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 }
  private chase: Shot = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }
  private shotOut: Shot = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 }
  private shots: Shot[] = []
  private visited = new Set<number>()
  private puffTimer = 0
  private respawning = false
  private lastFrame = performance.now()
  private overlayOpen = 0

  async boot() {
    this.bindUI()
    this.renderIcons()
    if (!this.gl) document.documentElement.classList.add('no-gl')

    // fonts first: canvas signage is painted with them
    const fonts = [
      '800 40px "Bricolage Grotesque Variable"',
      '400 40px "Instrument Serif"',
      '700 40px "JetBrains Mono Variable"',
    ]
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f, 'Aa'))), new Promise((r) => setTimeout(r, 3500))])
    this.loader.progress(0.12)
    this.panels.prepare()

    if (this.gl) {
      try {
        await this.buildWorld()
      } catch (err) {
        console.error(err)
        this.gl = false
        document.documentElement.classList.add('no-gl')
      }
    }
    if (!this.gl) this.startPlainLoop()

    await this.loader.ready()
    this.audio.init()
    this.audio.setEnabled(this.loader.soundWanted)
    this.syncSoundButton()
    document.body.classList.add('is-ready')
    await this.start()
  }

  private async buildWorld() {
    const exp = new Experience(document.getElementById('gl') as HTMLCanvasElement)
    this.exp = exp
    const urls = new Set<string>()
    for (const p of Object.values(PROJECTS)) {
      urls.add(p.texture)
      if (p.logo) urls.add(p.logo)
    }
    urls.add('img/people/akash-cutout.webp')
    const textures = new Map<string, THREE.Texture>()
    const loader = new THREE.TextureLoader()
    let done = 0
    await Promise.all(
      [...urls].map(
        (u) =>
          new Promise<void>((resolve) => {
            loader.load(
              u,
              (t) => {
                t.colorSpace = THREE.SRGBColorSpace
                t.anisotropy = 4
                textures.set(u, t)
                this.loader.progress(0.12 + (++done / urls.size) * 0.3)
                resolve()
              },
              undefined,
              () => {
                done++
                resolve()
              },
            )
          }),
      ),
    )

    const world = new World(exp)
    this.world = world
    await world.build(textures, (p) => this.loader.progress(0.42 + p * 0.5))
    this.shots = ANCHORS.map((a) => stopShot(a))
    this.rig = new CameraRig(exp.camera, exp.viewShift, () => exp.applyViewOffset())

    world.vehicle.onImpact = (s) => {
      this.audio.impact(s)
      this.rig?.addShake(Math.min(1, s / 10))
    }
    world.vehicle.onFall = () => this.respawn(true)

    // first frame: park the taxi at the start, camera high above for the intro
    const first = ANCHORS[0]
    world.vehicle.setRail(road.sample(first.roadD).pos, Math.atan2(first.tan.x, first.tan.z), 0)
    const hero = this.shots[0]
    this.introFrom = {
      pos: hero.pos.clone().add(new THREE.Vector3(-30, 70, 60)),
      target: first.pos.clone().add(new THREE.Vector3(10, -10, -40)),
      fov: 55,
    }
    this.rig.setStory(this.introFrom)
    this.rig.snap()
    world.tod.target = 0
    exp.onResizeCallback(() => {
      if (this.story.needsLayout()) {
        this.story.layout()
        this.panels.measure()
      }
      this.drive.layoutMinimap()
    })
    exp.onTick((dt, elapsed) => this.frame(dt, elapsed))
    await world.warmup()
    exp.start()
    this.loader.progress(1)
  }

  /** a minimal loop when there is no WebGL: just the story UI */
  private startPlainLoop() {
    window.addEventListener('resize', () => {
      if (this.story.needsLayout()) {
        this.story.layout()
        this.panels.measure()
      }
    })
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
      this.lastFrame = now
      this.story.raf(now)
      if (this.mode === 'story') {
        const st = this.story.update(dt)
        this.panels.setActive(this.overlayOpen ? this.panels.current : st.panel)
        this.hud.update(st.current, st.total * ROUTE_KM)
      }
      this.cursor.update(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  private async start() {
    await this.loader.hide()
    if (!this.world || !this.rig || reducedMotion) {
      this.mode = 'story'
      this.rig?.snap()
      this.unlockAchievement('start', '🚕', 'Meter down! Scroll to ride.')
      return
    }
    this.mode = 'intro'
    await new Promise<void>((resolve) => {
      this.introTween = gsap.to(this, {
        introT: 1,
        duration: 3.4,
        ease: 'power2.inOut',
        onComplete: () => resolve(),
      })
    })
    if (this.mode === 'intro') this.mode = 'story'
    this.unlockAchievement('start', '🚕', isTouch ? 'Meter down! Swipe up to ride.' : 'Meter down! Scroll to ride.')
  }

  /* ── per-frame ──────────────────────────────────────────── */

  private frame(dt: number, elapsed: number) {
    const world = this.world!
    const rig = this.rig!
    const v = world.vehicle
    this.story.raf(performance.now())
    const mobile = this.exp!.width < 700 || this.exp!.width / this.exp!.height < 0.9
    const desktopPanels = this.exp!.width >= 1024 && this.exp!.width / this.exp!.height >= 1

    if (this.mode === 'intro' || this.mode === 'loading') {
      const t = easeInOutCubic(this.introT)
      const a = this.introFrom!
      const b = this.shots[0]
      this.shotOut.pos.lerpVectors(a.pos, b.pos, t)
      this.shotOut.target.lerpVectors(a.target, b.target, t)
      this.shotOut.fov = a.fov + (b.fov - a.fov) * t
      rig.setStory(this.shotOut)
      rig.snap()
      rig.desiredShift.set(desktopPanels ? 0.14 * t : 0, mobile ? 0.2 * t : 0)
      world.tod.target = 0
      if (this.introT > 0.55) this.panels.setActive(0)
      world.physics.step(dt)
      v.setRail(road.sample(ANCHORS[0].roadD).pos, Math.atan2(ANCHORS[0].tan.x, ANCHORS[0].tan.z), dt)
    } else if (this.mode === 'story') {
      const st = this.story.update(dt)
      this.storyFrame(st, dt, mobile, desktopPanels)
      world.physics.step(dt)
    } else if (this.mode === 'drive') {
      this.driveFrame(dt, mobile)
    }

    v.sync(dt)
    rig.update(dt, elapsed)
    // the shadow box follows whatever the camera frames
    world.update(dt, elapsed, this.mode === 'drive' ? v.position : rig.target)
    this.audio.update(v.speed, v.load, v.boosting, this.mode === 'drive', world.tod.night)
    this.cursor.update(dt)

    // exhaust puffs when the engine works
    this.puffTimer -= dt
    if (this.puffTimer <= 0 && (v.load > 0.2 || Math.abs(v.speed) > 1)) {
      this.puffTimer = 0.12 - Math.min(0.08, v.load * 0.08)
      const ex = v.parts.exhaust.clone()
      ex.y += -0.5
      v.parts.root.localToWorld(ex)
      const back = v.forward().multiplyScalar(-1.2 - Math.abs(v.speed) * 0.05)
      world.effects.puff(ex, back.setY(0.4), v.boosting ? '#ffd0a0' : '#d8d4cc', 0.16 + v.load * 0.1, 0.7)
    }
  }

  private storyFrame(st: StoryState, dt: number, mobile: boolean, desktopPanels: boolean) {
    const world = this.world!
    const rig = this.rig!
    const v = world.vehicle

    // taxi on the road
    const s = road.sample(storyToRoad(st.d))
    v.setRail(s.pos, Math.atan2(s.tan.x, s.tan.z), dt)

    // camera: hold a stop's shot (with a slow push-in) or blend through a chase shot
    if (st.kind === 'dwell') {
      this.pushIn(this.shots[st.i], st.p, this.shotOut)
    } else {
      this.pushIn(this.shots[st.i], 1, this.shotA)
      chaseShot(v.position, v.yaw, this.chase)
      blendTravel(this.shotA, this.chase, this.shots[st.i + 1], st.p, this.shotOut)
    }
    rig.setStory(this.shotOut)
    rig.stiffness = 4.2
    const panelShown = st.panel >= 0 && !this.overlayOpen
    rig.desiredShift.set(desktopPanels ? 0.13 : 0, mobile ? (panelShown ? 0.2 : 0.06) : 0)

    // time of day follows the story
    const a = STOPS[st.i]
    const b = STOPS[Math.min(STOPS.length - 1, st.i + 1)]
    world.tod.target = st.kind === 'dwell' ? a.time : a.time + (b.time - a.time) * st.p

    this.panels.setActive(this.overlayOpen ? -1 : st.panel)
    this.hud.update(st.current, st.total * ROUTE_KM)
    document.getElementById('scroll-cue')!.style.opacity = st.total < 0.01 && this.mode === 'story' ? '1' : '0'
  }

  /** shot with a gentle dolly towards the subject as the reader scrolls through a stop */
  private pushIn(shot: Shot, p: number, out: Shot) {
    const k = reducedMotion ? 0 : easeInOutCubic(clamp(p)) * 1.4
    out.target.copy(shot.target)
    out.pos.copy(shot.pos).add(new THREE.Vector3().subVectors(shot.target, shot.pos).normalize().multiplyScalar(k))
    out.fov = shot.fov
    return out
  }

  private driveFrame(dt: number, mobile: boolean) {
    const world = this.world!
    const rig = this.rig!
    const v = world.vehicle
    const cam = this.exp!.camera
    const camYaw = Math.atan2(rig.target.x - cam.position.x, rig.target.z - cam.position.z)
    const input = this.drive.read(v.yaw, camYaw, v.speed)
    if (this.overlayOpen) {
      input.throttle = 0
      input.steer = 0
    }
    v.drive(input, dt)
    world.physics.step(dt)
    rig.setDrive(v.position, v.yaw, v.speed, v.boosting, dt)
    rig.stiffness = 5
    rig.desiredShift.set(0, mobile ? 0.04 : 0)

    // odometer → fare
    const moved = this.lastCar.distanceTo(v.position)
    if (moved < 5) this.odometer += moved
    this.lastCar.copy(v.position)
    this.drive.setSpeed(v.speed * 6)

    // time of day follows the car around the loop
    const near = road.nearest(v.position.x, v.position.z)
    const sd = roadToStory(near.d)
    let i = 0
    while (i < ANCHORS.length - 1 && ANCHORS[i + 1].d <= sd) i++
    const j = Math.min(ANCHORS.length - 1, i + 1)
    const span = ANCHORS[j].d - ANCHORS[i].d
    const k = span > 0 ? clamp((sd - ANCHORS[i].d) / span) : 0
    world.tod.target = i === ANCHORS.length - 1 ? STOPS[i].time * (1 - clamp((sd - ANCHORS[i].d) / 20)) : STOPS[i].time + (STOPS[j].time - STOPS[i].time) * k

    // which stop are we at?
    let zone = -1
    let best = 13
    for (const a of ANCHORS) {
      const d = Math.min(a.landmark.distanceTo(v.position) - 2, a.pos.distanceTo(v.position))
      if (d < best) {
        best = d
        zone = a.index
      }
    }
    this.drive.setZone(zone)
    if (zone >= 0 && !this.visited.has(zone)) {
      this.visited.add(zone)
      const projects = ANCHORS.filter((a) => STOPS[a.index].kind === 'project').map((a) => a.index)
      if (projects.every((p) => this.visited.has(p))) this.unlockAchievement('tour', '🗺️', 'Grand tour: you visited every project!')
    }
    this.hud.update(zone >= 0 ? zone : this.story.stopForDistance(sd), this.odometer / 30)

    // bugs
    const got = world.bugs.collect(v.position.x, v.position.z)
    if (got >= 0) {
      const n = world.bugs.foundCount
      const total = world.bugs.spots.length
      this.audio.pickup()
      world.effects.confetti(v.position.clone().setY(1), 24, ['#ff4d6d', '#ffffff', '#ffc61a'])
      this.drive.setBugs(n, total, true)
      if (n === total) {
        world.effects.confetti(v.position.clone().setY(2), 150)
        this.unlockAchievement('bugs', '🏆', 'Zero bugs in production. Hire me?', true)
      } else this.toasts.show('🐞', `Bug fixed! ${n}/${total}`, 1800)
    }
    this.drive.drawMinimap(v.position, v.yaw, world.bugs.spots)

    // little achievements
    if (Math.abs(v.speed) * 6 > 125) this.unlockAchievement('speed', '💨', 'Easy now, it’s an Ambassador.')
    if (world.props.toppled(world.props.letters) >= 3) this.unlockAchievement('letters', '😅', 'You knocked my name over. Rude.')
    if (world.props.toppled(world.props.stumps) >= 1) this.unlockAchievement('stumps', '🏏', 'HOWZAT! Clean bowled.')

    // dust when tearing across grass
    if (Math.abs(v.speed) > 6 && near.dist > 4.5 && Math.random() < 0.5) {
      const p = v.position.clone().addScaledVector(v.forward(), -1.2)
      p.y = 0.2
      world.effects.puff(p, new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5), '#c9b48a', 0.3, 0.8, 2.4)
    }
  }

  /* ── modes ──────────────────────────────────────────────── */

  enterDrive() {
    // impatient? skip the intro flight and hand over the wheel
    if (this.mode === 'intro') {
      this.introTween?.progress(1)
      this.mode = 'story'
    }
    if (this.mode !== 'story' || !this.world) return
    this.mode = 'drive'
    this.story.lock()
    this.panels.hideAll()
    this.drive.show()
    document.body.classList.add('is-driving')
    const v = this.world.vehicle
    v.enablePhysics(true)
    this.lastCar.copy(v.position)
    this.rig!.resetFollow(v.yaw)
    this.world.bugs.setBeacons(true)
    this.drive.setBugs(this.world.bugs.foundCount, this.world.bugs.spots.length)
    this.setModeButton()
    this.audio.tick()
    this.unlockAchievement('drive', '🛞', isTouch ? 'You have the wheel. Drag the stick to drive.' : 'You have the wheel. WASD or arrows to drive.')
    if (this.world.bugs.foundCount < this.world.bugs.spots.length) {
      window.setTimeout(() => this.mode === 'drive' && this.toasts.show('🐞', '12 bugs are hiding on the island. Fix them all!', 3600), 2200)
    }
  }

  async exitDrive() {
    if (this.mode !== 'drive' || !this.world) return
    const v = this.world.vehicle
    const near = road.nearest(v.position.x, v.position.z)
    const target = this.story.stopForDistance(roadToStory(near.d))
    await this.fade(async () => {
      this.mode = 'story'
      v.disablePhysics()
      this.drive.hide()
      this.world!.bugs.setBeacons(false)
      document.body.classList.remove('is-driving')
      this.story.unlock()
      this.story.goTo(target, true)
      const st = this.story.update(0)
      this.storyFrame(st, 0, this.exp!.width < 700, this.exp!.width >= 1024)
      this.rig!.snap()
      this.setModeButton()
    })
  }

  private respawn(fell: boolean) {
    if (this.respawning || !this.world) return
    this.respawning = true
    const v = this.world.vehicle
    const near = road.nearest(v.position.x, v.position.z)
    const s = road.sample(near.d)
    void this.fade(async () => {
      v.respawn(s.pos, Math.atan2(s.tan.x, s.tan.z))
      this.rig!.resetFollow(Math.atan2(s.tan.x, s.tan.z))
      this.rig!.snap()
      this.lastCar.copy(s.pos)
      this.respawning = false
      if (fell) this.unlockAchievement('fall', '☁️', 'Akash means sky. Now you know why.', false, true)
    }, '#ffffff')
  }

  private async fade(mid: () => Promise<void> | void, color = '#fff8ea') {
    const f = document.getElementById('fader')!
    f.style.background = color
    if (reducedMotion) {
      await mid()
      return
    }
    await gsap.to(f, { opacity: 1, duration: 0.32, ease: 'power2.in' })
    await mid()
    await gsap.to(f, { opacity: 0, duration: 0.55, ease: 'power2.out', delay: 0.05 })
  }

  /** dev/test helper: jump straight to a stop */
  jump(i: number) {
    if (this.mode === 'drive') return
    this.story.goTo(i, true)
    this.rig?.snap()
  }

  /** dev/test helper */
  get debug() {
    return { mode: this.mode, story: this.story.state, world: this.world, rig: this.rig, enterDrive: () => this.enterDrive(), exitDrive: () => this.exitDrive() }
  }

  private goTo(i: number) {
    this.audio.tick()
    if (this.mode === 'drive' && this.world) {
      const a = ANCHORS[i]
      const v = this.world.vehicle
      void this.fade(() => {
        v.respawn(a.pos.clone().addScaledVector(a.tan, -6), Math.atan2(a.tan.x, a.tan.z))
        this.rig!.resetFollow(Math.atan2(a.tan.x, a.tan.z))
        this.rig!.snap()
        this.lastCar.copy(v.position)
      })
      return
    }
    if (this.mode === 'story') this.story.goTo(i)
  }

  /* ── UI wiring ──────────────────────────────────────────── */

  private bindUI() {
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-goto]')
      if (!el) return
      if (el.dataset.goto !== undefined) {
        e.preventDefault()
        if (this.mode === 'drive') void this.exitDrive().then(() => this.story.goTo(0))
        else this.goTo(Number(el.dataset.goto))
        return
      }
      const action = el.dataset.action
      switch (action) {
        case 'ride':
          this.audio.tick()
          this.goTo(1)
          break
        case 'drive':
          this.enterDrive()
          break
        case 'toggle-mode':
          if (this.mode === 'drive') void this.exitDrive()
          else this.enterDrive()
          break
        case 'stops':
          this.hud.openSheet()
          break
        case 'resume':
          e.preventDefault()
          this.resume.open()
          break
        case 'project':
          this.modal.openProject(el.dataset.project!)
          break
        case 'restart':
          this.goTo(0)
          break
      }
    })

    const overlayOn = () => {
      this.overlayOpen++
      if (this.mode === 'story') this.story.lock()
    }
    const overlayOff = () => {
      this.overlayOpen = Math.max(0, this.overlayOpen - 1)
      if (!this.overlayOpen && this.mode === 'story') this.story.unlock()
    }
    this.modal.onOpen = overlayOn
    this.modal.onClose = overlayOff
    this.resume.onOpen = overlayOn
    this.resume.onClose = overlayOff
    this.resume.onProject = (slug) => this.modal.openProject(slug)

    this.drive.onHorn = () => {
      this.audio.horn()
      this.unlockAchievement('honk', '📯', 'Pom pom! Kolkata approves.')
    }
    this.drive.onReset = () => this.respawn(false)
    this.drive.onExit = () => {
      if (!this.modal.isOpen && !this.resume.isOpen) void this.exitDrive()
    }
    this.drive.onOpenZone = (i) => this.modal.openStop(i)
    this.drive.onZoom = (d) => {
      if (this.rig) this.rig.zoom = clamp(this.rig.zoom + d, 0.7, 1.7)
    }

    document.getElementById('btn-sound')!.addEventListener('click', () => {
      this.audio.init()
      this.audio.setEnabled(!this.audio.enabled)
      this.syncSoundButton()
    })

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.hud.sheetOpen) this.hud.closeSheet()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.setEnabled(false)
      else if (storage.get('akash:sound') !== 'off' || this.audio.enabled) this.audio.setEnabled(storage.get('akash:sound') !== 'off')
    })
  }

  private syncSoundButton() {
    const b = document.getElementById('btn-sound')!
    b.setAttribute('aria-pressed', String(this.audio.enabled))
    b.setAttribute('aria-label', this.audio.enabled ? 'Mute sound' : 'Turn sound on')
    b.querySelector('[data-icon]')!.innerHTML = this.audio.enabled ? ICONS.soundOn : ICONS.soundOff
  }

  private setModeButton() {
    const label = document.getElementById('btn-mode-label')!
    const icon = document.querySelector('#btn-mode [data-icon]')!
    if (this.mode === 'drive') {
      label.textContent = 'Back to story'
      icon.innerHTML = ICONS.book
    } else {
      label.textContent = 'Take the wheel'
      icon.innerHTML = ICONS.wheel
    }
  }

  private renderIcons() {
    document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
      const name = el.dataset.icon as keyof typeof ICONS
      if (ICONS[name]) el.innerHTML = ICONS[name]
    })
  }

  private unlockAchievement(id: string, icon: string, text: string, big = false, always = false) {
    if (this.achievements.has(id) && !always) return
    this.achievements.add(id)
    storage.set(ACH_KEY, JSON.stringify([...this.achievements]))
    this.toasts.show(icon, text, big ? 5200 : 3200)
  }
}
