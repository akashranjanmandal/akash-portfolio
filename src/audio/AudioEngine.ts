import { storage } from '../utils/dom'

/* ──────────────────────────────────────────────────────────────
   SOUND
   Everything is synthesised with WebAudio — no files to download.
   An old diesel engine that chugs with speed, a two-tone horn,
   thuds, pickups, and birds by day / crickets by night.
────────────────────────────────────────────────────────────── */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** how each car sounds: cylinders set the firing rate, the rest shapes the timbre */
type Voice = { cyl: number; idle: number; red: number; gears: number; wave: OscillatorType; detune: number; cutoff: number; vol: number; whine: number; growl: number }

const VOICES: Record<string, Voice> = {
  // old diesel: slow, lumpy, low
  'Ambassador taxi': { cyl: 4, idle: 650, red: 3600, gears: 4, wave: 'sawtooth', detune: 0, cutoff: 700, vol: 1, whine: 0, growl: 0.5 },
  // quad-turbo W16: deep, smooth, big turbo whistle
  'Bugatti Bolide': { cyl: 16, idle: 900, red: 7200, gears: 7, wave: 'sawtooth', detune: 6, cutoff: 1500, vol: 1.1, whine: 0.9, growl: 0.35 },
  // twin-turbo V8: angry, flat-plane edge
  'Koenigsegg Jesko Attack': { cyl: 8, idle: 1000, red: 8500, gears: 9, wave: 'sawtooth', detune: 9, cutoff: 2300, vol: 1.15, whine: 0.5, growl: 0.8 },
  // naturally aspirated V12: high, shrieking, smooth
  'Lamborghini Centenario': { cyl: 12, idle: 900, red: 8400, gears: 7, wave: 'sawtooth', detune: 4, cutoff: 3200, vol: 1.1, whine: 0, growl: 0.3 },
  // straight six: silky, mid-range rasp
  'BMW 3.0 CSL Hommage R': { cyl: 6, idle: 800, red: 7000, gears: 6, wave: 'sawtooth', detune: 3, cutoff: 2000, vol: 1, whine: 0, growl: 0.4 },
}

export class AudioEngine {
  private voice: Voice = VOICES['Ambassador taxi']
  private voiceName = 'Ambassador taxi'
  private rpm = 800
  private engineOsc2!: OscillatorNode
  private whineOsc!: OscillatorNode
  private whineGain!: GainNode
  private growlGain!: GainNode
  private ctx: AudioContext | null = null
  private master!: GainNode
  private engineGain!: GainNode
  private engineOsc!: OscillatorNode
  private engineSub!: OscillatorNode
  private engineFilter!: BiquadFilterNode
  private chug!: OscillatorNode
  private chugDepth!: GainNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private noise!: AudioBuffer
  private nextAmbient = 0
  private nextHorn = 4
  private cityGain: GainNode | null = null
  private region: 'city' | 'hills' = 'city'
  private altitude = 0
  enabled = storage.get('akash:sound') !== 'off'

  /** must run inside a user gesture */
  init() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 0.9 : 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)

    // white noise buffer shared by wind and thuds
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

    // engine: saw + sub through a low-pass, amplitude-modulated for the diesel chug
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 380
    this.engineFilter.Q.value = 2.5
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 42
    this.engineSub = ctx.createOscillator()
    this.engineSub.type = 'square'
    this.engineSub.frequency.value = 21
    const subGain = ctx.createGain()
    subGain.gain.value = 0.35
    const chugGain = ctx.createGain()
    chugGain.gain.value = 0.7
    this.chug = ctx.createOscillator()
    this.chug.frequency.value = 9
    this.chugDepth = ctx.createGain()
    this.chugDepth.gain.value = 0.3
    this.chug.connect(this.chugDepth).connect(chugGain.gain)
    this.engineOsc.connect(this.engineFilter)
    this.engineSub.connect(subGain).connect(this.engineFilter)
    this.engineFilter.connect(chugGain).connect(this.engineGain).connect(this.master)
    // a detuned twin for width, a sine "turbo whistle", and a rough noise layer for growl
    this.engineOsc2 = ctx.createOscillator()
    this.engineOsc2.type = 'sawtooth'
    this.engineOsc2.frequency.value = 42
    const twin = ctx.createGain()
    twin.gain.value = 0.6
    this.engineOsc2.connect(twin).connect(this.engineFilter)
    this.whineOsc = ctx.createOscillator()
    this.whineOsc.type = 'sine'
    this.whineGain = ctx.createGain()
    this.whineGain.gain.value = 0
    this.whineOsc.connect(this.whineGain).connect(this.master)
    const rough = ctx.createBufferSource()
    rough.buffer = this.noise
    rough.loop = true
    const roughF = ctx.createBiquadFilter()
    roughF.type = 'bandpass'
    roughF.frequency.value = 260
    roughF.Q.value = 0.8
    this.growlGain = ctx.createGain()
    this.growlGain.gain.value = 0
    rough.connect(roughF).connect(this.growlGain).connect(this.master)
    rough.start()
    this.engineOsc.start()
    this.engineOsc2.start()
    this.whineOsc.start()
    this.engineSub.start()
    this.chug.start()

    // wind
    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 500
    this.windFilter.Q.value = 0.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master)
    wind.start()

    // a low city murmur: brown-ish noise, heavily low-passed
    const city = ctx.createBufferSource()
    city.buffer = this.noise
    city.loop = true
    city.playbackRate.value = 0.5
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    this.cityGain = ctx.createGain()
    this.cityGain.gain.value = 0.05
    city.connect(lp).connect(this.cityGain).connect(this.master)
    city.start()
  }

  /** pick the engine voice for the car being driven */
  setVoice(name: string) {
    if (name === this.voiceName) return
    this.voiceName = name
    this.voice = VOICES[name] ?? VOICES['Ambassador taxi']
    this.engineOsc.type = this.voice.wave
    this.engineOsc2.type = this.voice.wave
  }

  /** the hills are quiet, windy and cold: no city murmur, a steady wind that grows with height */
  setRegion(r: 'city' | 'hills') {
    this.region = r
  }

  setAltitude(a: number) {
    this.altitude = a
  }

  setEnabled(on: boolean) {
    this.enabled = on
    storage.set('akash:sound', on ? 'on' : 'off')
    if (!this.ctx) return
    if (on) void this.ctx.resume()
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.08)
  }

  /** call every frame */
  update(speed: number, load: number, boosting: boolean, driving: boolean, night: number) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const t = ctx.currentTime
    const v = this.voice
    const top = this.voiceName === 'Ambassador taxi' ? 28 : 60
    const s = Math.min(1, Math.abs(speed) / top)
    // a gearbox: rpm climbs through each gear then drops on the shift
    const g = Math.min(v.gears - 1, Math.floor(s * v.gears))
    const within = s * v.gears - g
    const target = driving
      ? v.idle + (v.red - v.idle) * clamp01(0.18 + within * 0.8 + load * 0.15 + (boosting ? 0.05 : 0))
      : v.idle * 0.85
    this.rpm += (target - this.rpm) * Math.min(1, 0.18 + (driving ? 0.1 : 0))
    // four-stroke: one firing per cylinder every two revolutions
    const fire = (this.rpm / 60) * (v.cyl / 2)
    this.engineOsc.frequency.setTargetAtTime(fire, t, 0.03)
    this.engineOsc2.frequency.setTargetAtTime(fire * (1 + v.detune / 1000), t, 0.03)
    this.engineSub.frequency.setTargetAtTime(fire / 2, t, 0.03)
    this.chug.frequency.setTargetAtTime(Math.min(40, fire / 4), t, 0.05)
    this.chugDepth.gain.setTargetAtTime(this.voiceName === 'Ambassador taxi' ? 0.3 : 0.08, t, 0.2)
    this.engineFilter.frequency.setTargetAtTime(v.cutoff * (0.45 + 0.55 * clamp01((this.rpm - v.idle) / (v.red - v.idle)) + load * 0.4), t, 0.05)
    const vol = ((driving ? 0.05 : 0.026) + load * 0.05 + s * 0.035) * v.vol
    this.engineGain.gain.setTargetAtTime(vol, t, 0.08)
    this.whineOsc.frequency.setTargetAtTime(1400 + this.rpm * 0.55, t, 0.05)
    this.whineGain.gain.setTargetAtTime(driving ? v.whine * 0.008 * (0.3 + load) * (0.4 + s) : 0, t, 0.1)
    this.growlGain.gain.setTargetAtTime(driving ? v.growl * 0.04 * (0.3 + load) : 0, t, 0.1)
    const wind = s * s * (driving ? 0.09 : 0.05) + (this.region === 'hills' ? 0.03 + 0.085 * this.altitude : 0)
    this.windGain.gain.setTargetAtTime(wind, t, 0.4)
    this.windFilter.frequency.setTargetAtTime(400 + s * 900, t, 0.2)

    if (this.cityGain) this.cityGain.gain.setTargetAtTime(this.region === 'hills' ? 0 : 0.04 + (1 - night) * 0.03, t, 1)
    if (t > this.nextHorn) {
      this.nextHorn = t + 5 + Math.random() * 12 * (1 + night)
      this.distantHorn()
    }
    if (t > this.nextAmbient) {
      this.nextAmbient = t + 1.4 + Math.random() * 3.2
      if (night > 0.6) this.cricket()
      else if (night < 0.3) this.bird()
    }
  }

  /** one footstep: a short filtered thump with a little grit */
  footstep(run: boolean) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 380 + Math.random() * 220
    bp.Q.value = 1.2
    const g = ctx.createGain()
    const v = run ? 0.16 : 0.1
    g.gain.setValueAtTime(v, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
    src.connect(bp).connect(g).connect(this.master)
    src.start(now, Math.random(), 0.1)
  }

  /** the tram's double ding */
  tramBell(volume = 1) {
    const ctx = this.ctx
    if (!ctx || !this.enabled || volume < 0.02) return
    const now = ctx.currentTime
    for (const t of [0, 0.32]) {
      for (const [hz, a] of [[1320, 1], [2640, 0.35], [3960, 0.15]]) {
        const o = ctx.createOscillator()
        o.frequency.value = hz
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, now + t)
        g.gain.exponentialRampToValueAtTime(0.12 * a * volume, now + t + 0.005)
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.9)
        o.connect(g).connect(this.master)
        o.start(now + t)
        o.stop(now + t + 1)
      }
    }
  }

  /** a far-off honk somewhere in town, now and then */
  private distantHorn() {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    const len = 0.18 + Math.random() * 0.3
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.025, now + 0.02)
    g.gain.setValueAtTime(0.025, now + len)
    g.gain.linearRampToValueAtTime(0, now + len + 0.05)
    const base = 300 + Math.random() * 250
    for (const hz of [base, base * 1.26]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz
      o.connect(lp)
      o.start(now)
      o.stop(now + len + 0.1)
    }
    lp.connect(g).connect(this.master)
  }

  /** pom-pom */
  horn() {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const now = ctx.currentTime
    for (const [start, len] of [[0, 0.16], [0.22, 0.32]]) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, now + start)
      g.gain.linearRampToValueAtTime(0.16, now + start + 0.015)
      g.gain.setValueAtTime(0.16, now + start + len - 0.04)
      g.gain.linearRampToValueAtTime(0, now + start + len)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 900
      bp.Q.value = 0.9
      for (const hz of [370, 465]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz
        o.connect(bp)
        o.start(now + start)
        o.stop(now + start + len + 0.02)
      }
      bp.connect(g).connect(this.master)
    }
  }

  impact(strength: number) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 280 + Math.min(strength, 12) * 60
    const g = ctx.createGain()
    const v = Math.min(0.5, 0.06 + strength * 0.035)
    g.gain.setValueAtTime(v, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
    src.connect(lp).connect(g).connect(this.master)
    src.start(now, Math.random() * 1.5, 0.3)
  }

  /** squash! */
  pickup() {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const now = ctx.currentTime
    for (const [i, base] of [[0, 520], [1, 780]]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      const g = ctx.createGain()
      const t0 = now + i * 0.07
      o.frequency.setValueAtTime(base, t0)
      o.frequency.exponentialRampToValueAtTime(base * 2.2, t0 + 0.12)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      o.connect(g).connect(this.master)
      o.start(t0)
      o.stop(t0 + 0.25)
    }
  }

  /** soft UI tick */
  tick() {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(1300, now)
    o.frequency.exponentialRampToValueAtTime(700, now + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.05, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
    o.connect(g).connect(this.master)
    o.start(now)
    o.stop(now + 0.08)
  }

  private bird() {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const notes = 2 + Math.floor(Math.random() * 3)
    const base = 2400 + Math.random() * 1400
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      const g = ctx.createGain()
      const t0 = now + i * 0.11
      o.frequency.setValueAtTime(base, t0)
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.06)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.018, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09)
      o.connect(g).connect(this.master)
      o.start(t0)
      o.stop(t0 + 0.1)
    }
  }

  private cricket() {
    const ctx = this.ctx!
    const now = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = 4300 + Math.random() * 300
      const g = ctx.createGain()
      const t0 = now + i * 0.07
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.006, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045)
      o.connect(g).connect(this.master)
      o.start(t0)
      o.stop(t0 + 0.05)
    }
  }
}
