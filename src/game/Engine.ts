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
  high: { dprMax: 1.5, shadows: true, shadowSize: 4096, ao: true, bloom: true, drawDistance: 900, density: 1 },
  mid: { dprMax: 1.25, shadows: true, shadowSize: 2048, ao: false, bloom: true, drawDistance: 600, density: 0.6 },
  low: { dprMax: 1, shadows: true, shadowSize: 1024, ao: false, bloom: false, drawDistance: 400, density: 0.35 },
}

type Tick = (dt: number, t: number) => void

/** Renderer, camera, post-processing chain and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000)
  readonly quality: Quality
  readonly composer: EffectComposer
  private ao: N8AOPostPass | null = null
  private ticks: Tick[] = []
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
    if (this.quality.bloom) effects.push(new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, mipmapBlur: true }))
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }))
    effects.push(new VignetteEffect({ offset: 0.4, darkness: 0.28 }))
    effects.push(new SMAAEffect())
    this.composer.addPass(new EffectPass(this.camera, ...effects))

    this.resize()
    window.addEventListener('resize', () => this.resize(), { passive: true })
  }

  resize() {
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    this.width = w
    this.height = h
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprMax)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
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
      this.composer.render(dt)
    })
  }
}
