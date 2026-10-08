import * as THREE from 'three'
import { detectTier, type Tier } from '../utils/device'

export type Quality = {
  tier: Tier
  dprMax: number
  dprMin: number
  shadows: boolean
  shadowSize: number
  antialias: boolean
  /** multiplier for scattered scenery counts */
  density: number
  groundTexture: number
}

const PRESETS: Record<Tier, Omit<Quality, 'tier'>> = {
  high: { dprMax: 2, dprMin: 1, shadows: true, shadowSize: 2048, antialias: true, density: 1, groundTexture: 2048 },
  mid: { dprMax: 1.75, dprMin: 0.9, shadows: true, shadowSize: 1024, antialias: true, density: 0.65, groundTexture: 2048 },
  low: { dprMax: 1.3, dprMin: 0.75, shadows: false, shadowSize: 512, antialias: false, density: 0.4, groundTexture: 1024 },
}

type Tick = (dt: number, elapsed: number) => void

/**
 * Owns the renderer, scene, camera and the frame loop. It also keeps the
 * frame rate healthy by nudging the pixel ratio up or down.
 */
export class Experience {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.4, 1400)
  readonly quality: Quality
  width = 1
  height = 1
  /** subject framing: fraction of the viewport to shift the optical centre by */
  readonly viewShift = new THREE.Vector2()

  private dpr = 1
  private ticks: Tick[] = []
  private resizeHandlers: Array<(w: number, h: number) => void> = []
  private last = 0
  private elapsed = 0
  private slowFrames = 0
  private fastFrames = 0
  private frameAvg = 16.7
  private running = false

  constructor(readonly canvas: HTMLCanvasElement) {
    this.quality = { tier: 'high', ...PRESETS.high }
    // probe the GPU on a throwaway context: antialias must be decided before the real one exists
    const probe = document.createElement('canvas').getContext('webgl2')
    if (probe) {
      const tier = detectTier(probe)
      this.quality = { tier, ...PRESETS[tier] }
      probe.getExtension('WEBGL_lose_context')?.loseContext()
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprMax)

    this.resize()
    window.addEventListener('resize', this.onResize, { passive: true })
    window.visualViewport?.addEventListener('resize', this.onResize, { passive: true })
  }

  private resizeQueued = false
  private onResize = () => {
    if (this.resizeQueued) return
    this.resizeQueued = true
    requestAnimationFrame(() => {
      this.resizeQueued = false
      this.resize()
    })
  }

  resize() {
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.applyViewOffset()
    for (const fn of this.resizeHandlers) fn(w, h)
  }

  /** shift the optical centre so the subject sits beside (desktop) or above (mobile) the story panel */
  applyViewOffset() {
    const w = this.width
    const h = this.height
    const ox = -this.viewShift.x * w
    const oy = this.viewShift.y * h
    if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) this.camera.clearViewOffset()
    else this.camera.setViewOffset(w, h, ox, oy, w, h)
    this.camera.updateProjectionMatrix()
  }

  onResizeCallback(fn: (w: number, h: number) => void) {
    this.resizeHandlers.push(fn)
  }

  onTick(fn: Tick) {
    this.ticks.push(fn)
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.renderer.setAnimationLoop(this.frame)
  }

  stop() {
    this.running = false
    this.renderer.setAnimationLoop(null)
  }

  private frame = (now: number) => {
    // clamp dt so a backgrounded tab does not explode the physics on return
    const rawMs = now - this.last
    this.last = now
    const dt = Math.min(rawMs, 50) / 1000
    this.elapsed += dt
    for (const fn of this.ticks) fn(dt, this.elapsed)
    this.renderer.render(this.scene, this.camera)
    this.adapt(rawMs)
  }

  /** keep ~60fps: drop the pixel ratio when frames are slow, raise it back when there is headroom */
  private adapt(ms: number) {
    if (ms > 250) return // tab switch or debugger pause, not a real frame
    this.frameAvg += (ms - this.frameAvg) * 0.05
    if (this.frameAvg > 24) {
      this.slowFrames++
      this.fastFrames = 0
    } else if (this.frameAvg < 14) {
      this.fastFrames++
      this.slowFrames = 0
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1)
      this.fastFrames = Math.max(0, this.fastFrames - 1)
    }
    const deviceMax = Math.min(window.devicePixelRatio || 1, this.quality.dprMax)
    if (this.slowFrames > 90 && this.dpr > this.quality.dprMin) {
      this.dpr = Math.max(this.quality.dprMin, this.dpr - 0.25)
      this.slowFrames = 0
      this.resize()
    } else if (this.fastFrames > 300 && this.dpr < deviceMax) {
      this.dpr = Math.min(deviceMax, this.dpr + 0.25)
      this.fastFrames = 0
      this.resize()
    }
  }

  get pixelRatio() {
    return this.dpr
  }
}
