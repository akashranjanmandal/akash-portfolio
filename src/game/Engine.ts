import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { detectTier, type Tier } from '../utils/device'

export type Quality = {
  tier: Tier
  dprMax: number
  shadows: boolean
  shadowSize: number
  ao: boolean
  bloom: boolean
  /** how far scattered scenery is drawn */
  drawDistance: number
  density: number
}

const PRESETS: Record<Tier, Omit<Quality, 'tier'>> = {
  high: { dprMax: 1.5, shadows: true, shadowSize: 2048, ao: true, bloom: true, drawDistance: 900, density: 1 },
  mid: { dprMax: 1.25, shadows: true, shadowSize: 1024, ao: false, bloom: true, drawDistance: 600, density: 0.6 },
  low: { dprMax: 1, shadows: true, shadowSize: 1024, ao: false, bloom: false, drawDistance: 400, density: 0.35 },
}

type Tick = (dt: number, t: number) => void

/** Renderer, camera, post-processing chain and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000)
  readonly quality: Quality
  readonly composer: EffectComposer
  ao: N8AOPostPass | null = null
  private ticks: Tick[] = []
  private bloom: BloomEffect | null = null
  /** the governor: resolution scale, and how many effects have been switched off (0 = all on) */
  private scale = 1
  private level = 0
  private perfT = 0
  private perfN = 0
  private perfWarm = 3
  private frameNo = 0
  private last = 0
  private elapsed = 0
  width = 1
  height = 1

  constructor(canvas: HTMLCanvasElement) {
    const probe = document.createElement('canvas').getContext('webgl2')
    const tier = probe ? detectTier(probe) : 'low'
    probe?.getExtension('WEBGL_lose_context')?.loseContext()
    this.quality = { tier, ...PRESETS[tier] }

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // tone mapping happens in the post chain
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // the sun shadow map is re-drawn every other frame: it barely moves, and it is a big share of the cost
    this.renderer.shadowMap.autoUpdate = false

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    if (this.quality.ao) {
      this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1)
      this.ao.configuration.aoRadius = 2.2
      this.ao.configuration.distanceFalloff = 1.2
      this.ao.configuration.intensity = 2.2
      this.ao.configuration.halfRes = true
      this.ao.setQualityMode('Medium')
      this.composer.addPass(this.ao)
    }
    const effects = []
    if (this.quality.bloom) {
      this.bloom = new BloomEffect({ intensity: 0.35, luminanceThreshold: 1.05, luminanceSmoothing: 0.15, mipmapBlur: true, radius: 0.6 })
      effects.push(this.bloom)
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }))
    effects.push(new VignetteEffect({ offset: 0.4, darkness: 0.28 }))
    effects.push(new SMAAEffect())
    this.composer.addPass(new EffectPass(this.camera, ...effects))

    this.resize()
    window.addEventListener('resize', () => this.resize(), { passive: true })
  }

  /** ambient occlusion is a city luxury: the mountains are too far and too large for it */
  setAO(on: boolean) {
    if (this.ao) this.ao.enabled = on && this.level < 1
  }

  resize() {
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    this.width = w
    this.height = h
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprMax) * this.scale
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /**
   * Keeps the game smooth on any machine: if the frame rate sags, drop the render resolution a step,
   * then switch off ambient occlusion, bloom and shadows one by one; when there is plenty of headroom, give resolution back.
   */
  private govern(dt: number) {
    if (this.perfWarm > 0) {
      this.perfWarm -= dt // loading and shader compiles are not the game's steady speed
      return
    }
    this.perfT += dt
    this.perfN++
    if (this.perfT < 2) return
    const fps = this.perfN / this.perfT
    this.perfT = 0
    this.perfN = 0
    if (fps < 38) {
      // cheapest-to-lose first: ambient occlusion (it draws the whole scene again), then resolution, bloom, shadows
      if (this.level < 1) {
        this.level = 1
        if (this.ao) this.ao.enabled = false
      } else if (this.scale > 0.6) {
        this.scale = Math.max(0.6, this.scale * 0.85)
        this.resize()
      } else if (this.level < 2) {
        this.level = 2
        if (this.bloom) this.bloom.blendMode.opacity.value = 0
      } else if (this.level < 3) {
        this.level = 3
        this.renderer.shadowMap.enabled = false
      }
    } else if (fps > 57 && this.scale < 1 && this.level <= 1) {
      this.scale = Math.min(1, this.scale * 1.06)
      this.resize()
    }
  }

  onTick(fn: Tick) {
    this.ticks.push(fn)
  }

  start() {
    this.last = performance.now()
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min(now - this.last, 50) / 1000
      this.last = now
      this.elapsed += dt
      for (const fn of this.ticks) fn(dt, this.elapsed)
      this.renderer.shadowMap.needsUpdate = (this.frameNo++ & 1) === 0
      this.composer.render(dt)
      this.govern(dt)
    })
  }
}
