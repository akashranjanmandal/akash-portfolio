import * as THREE from 'three'
import { damp } from '../utils/math'
import type { Sky } from './Sky'

/* ──────────────────────────────────────────────────────────────
   TIME OF DAY
   The ride starts at dawn in Egra and ends under the stars at the
   last stop. Every stop carries a time value; the palette below is
   blended between keys and pushed into the sky, fog and lights.
────────────────────────────────────────────────────────────── */

type Key = {
  t: number
  top: string
  horizon: string
  bottom: string
  fog: string
  sun: string
  sunI: number
  elev: number
  az: number
  hemiSky: string
  hemiGround: string
  hemiI: number
  night: number
  cloud: string
}

const KEYS: Key[] = [
  { t: 0.0, top: '#5f84cf', horizon: '#ffd2b0', bottom: '#f2b9a6', fog: '#f6d2bb', sun: '#ffcf9e', sunI: 2.3, elev: 14, az: 125, hemiSky: '#c4d6ff', hemiGround: '#d6a985', hemiI: 1.35, night: 0.05, cloud: '#ffd9c2' },
  { t: 0.14, top: '#3d8aea', horizon: '#d2ebff', bottom: '#b3d4f4', fog: '#d4e9fa', sun: '#fff1db', sunI: 2.9, elev: 36, az: 140, hemiSky: '#d2e6ff', hemiGround: '#a9c98b', hemiI: 1.35, night: 0, cloud: '#ffffff' },
  { t: 0.3, top: '#2f80ea', horizon: '#d9f0ff', bottom: '#a8ccf0', fog: '#d6ecfc', sun: '#fffaf0', sunI: 3.0, elev: 55, az: 165, hemiSky: '#dcecff', hemiGround: '#9fc382', hemiI: 1.3, night: 0, cloud: '#ffffff' },
  { t: 0.45, top: '#4f78d4', horizon: '#ffd59e', bottom: '#e8b892', fog: '#f5d4a8', sun: '#ffc47c', sunI: 2.7, elev: 22, az: 215, hemiSky: '#ffe3c0', hemiGround: '#b89d70', hemiI: 1.25, night: 0.04, cloud: '#ffe7c9' },
  { t: 0.6, top: '#3b4294', horizon: '#ff9f6e', bottom: '#d27f77', fog: '#efa684', sun: '#ff8f55', sunI: 2.1, elev: 9, az: 238, hemiSky: '#ffb995', hemiGround: '#8d6d6c', hemiI: 1.1, night: 0.22, cloud: '#ffc0a0' },
  { t: 0.72, top: '#20286e', horizon: '#a172ad', bottom: '#5d4f91', fog: '#8573a8', sun: '#d2a6e0', sunI: 1.0, elev: 4, az: 252, hemiSky: '#9a98ea', hemiGround: '#514a6e', hemiI: 1.05, night: 0.62, cloud: '#b9a5d8' },
  { t: 0.85, top: '#101746', horizon: '#3e438c', bottom: '#2c2f6c', fog: '#33397a', sun: '#b0c2ff', sunI: 0.85, elev: 42, az: 300, hemiSky: '#7a8ce0', hemiGround: '#35304f', hemiI: 1.0, night: 0.9, cloud: '#6d74b8' },
  { t: 1.0, top: '#090c2b', horizon: '#2a2f6e', bottom: '#1e2154', fog: '#252a5e', sun: '#a6b8ff', sunI: 0.75, elev: 48, az: 318, hemiSky: '#6474cc', hemiGround: '#2a2643', hemiI: 0.92, night: 1, cloud: '#565ca0' },
]

const col = (h: string) => new THREE.Color(h)
const WHITE = new THREE.Color(1, 1, 1)
const PALETTE = KEYS.map((k) => ({
  ...k,
  cTop: col(k.top),
  cHorizon: col(k.horizon),
  cBottom: col(k.bottom),
  cFog: col(k.fog),
  cSun: col(k.sun),
  cHemiSky: col(k.hemiSky),
  cHemiGround: col(k.hemiGround),
  cCloud: col(k.cloud),
}))

export class TimeOfDay {
  value = 0
  target = 0
  night = 0
  readonly sunDir = new THREE.Vector3()
  readonly fogColor = new THREE.Color()
  private readonly c = {
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
    sun: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    cloud: new THREE.Color(),
  }
  sunIntensity = 1
  hemiIntensity = 1
  private first = true

  constructor(
    private sky: Sky,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    private fog: THREE.Fog,
  ) {}

  update(dt: number) {
    this.value = this.first ? this.target : damp(this.value, this.target, 1.6, dt)
    this.first = false
    const t = Math.min(1, Math.max(0, this.value))
    let i = 0
    while (i < PALETTE.length - 2 && t > PALETTE[i + 1].t) i++
    const a = PALETTE[i]
    const b = PALETTE[i + 1]
    const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)))
    const c = this.c
    c.top.lerpColors(a.cTop, b.cTop, k)
    c.horizon.lerpColors(a.cHorizon, b.cHorizon, k)
    c.bottom.lerpColors(a.cBottom, b.cBottom, k)
    c.sun.lerpColors(a.cSun, b.cSun, k)
    c.hemiSky.lerpColors(a.cHemiSky, b.cHemiSky, k)
    c.hemiGround.lerpColors(a.cHemiGround, b.cHemiGround, k)
    c.cloud.lerpColors(a.cCloud, b.cCloud, k)
    this.fogColor.lerpColors(a.cFog, b.cFog, k)
    this.night = a.night + (b.night - a.night) * k
    this.sunIntensity = a.sunI + (b.sunI - a.sunI) * k
    this.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * k
    const elev = THREE.MathUtils.degToRad(a.elev + (b.elev - a.elev) * k)
    const az = THREE.MathUtils.degToRad(a.az + (b.az - a.az) * k)
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize()

    const u = this.sky.dome.material.uniforms
    u.uTop.value.copy(c.top)
    u.uHorizon.value.copy(c.horizon)
    u.uBottom.value.copy(c.bottom)
    u.uSunColor.value.copy(c.sun)
    // the dome shows the sun by day; at night the same light is the moon, drawn as a sprite
    const dayAmount = 1 - Math.min(1, this.night * 1.6)
    u.uSunDisc.value = dayAmount
    u.uSunDir.value.copy(this.sunDir)
    this.sky.stars.material.uniforms.uOpacity.value = Math.max(0, (this.night - 0.35) / 0.65)
    ;(this.sky.moon.material as THREE.SpriteMaterial).opacity = Math.max(0, (this.night - 0.55) / 0.45)
    // clouds glow with the sky so their shaded sides never turn into grey rocks
    this.sky.cloudMaterial.emissive.copy(c.cloud)
    this.sky.cloudMaterial.emissiveIntensity = 0.62
    this.sky.cloudMaterial.color.copy(c.cloud).lerp(WHITE, 0.5).multiplyScalar(0.55)

    this.fog.color.copy(this.fogColor)
    this.sun.color.copy(c.sun)
    this.sun.intensity = this.sunIntensity
    this.sun.shadow.intensity = 0.85 - this.night * 0.35
    this.hemi.color.copy(c.hemiSky)
    this.hemi.groundColor.copy(c.hemiGround)
    this.hemi.intensity = this.hemiIntensity
  }

  /** place the moon sprite opposite the camera's far plane in the light direction */
  placeMoon(camera: THREE.Camera) {
    this.sky.moon.position.copy(camera.position).addScaledVector(this.sunDir, 480)
  }
}
