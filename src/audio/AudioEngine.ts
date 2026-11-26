import { storage } from '../utils/dom'

/* ──────────────────────────────────────────────────────────────
   SOUND
   Everything is synthesised with WebAudio — no files to download.
   An old diesel engine that chugs with speed, a two-tone horn,
   thuds, pickups, and birds by day / crickets by night.
────────────────────────────────────────────────────────────── */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** how each car sounds: cylinders set the firing rate, the rest shapes the timbre */
type Voice = { cyl: number; idle: number; red: number; gears: number; wave: OscillatorType; detune: number; cutoff: number; vol: number; whine: number; growl: number; lump: number; pops: number }

const VOICES: Record<string, Voice> = {
  // old diesel: slow, lumpy, low
  'Ambassador taxi': { cyl: 4, idle: 650, red: 3600, gears: 4, wave: 'sawtooth', detune: 0, cutoff: 700, vol: 1, whine: 0, growl: 0.5, lump: 0.45, pops: 0 },
  // quad-turbo W16: deep, smooth, big turbo whistle
  'Bugatti Bolide': { cyl: 16, idle: 900, red: 7200, gears: 7, wave: 'sawtooth', detune: 6, cutoff: 1500, vol: 1.1, whine: 0.9, growl: 0.35, lump: 0.05, pops: 0.4 },
  // twin-turbo V8: angry, flat-plane edge
  'Koenigsegg Jesko Attack': { cyl: 8, idle: 1000, red: 8500, gears: 9, wave: 'sawtooth', detune: 9, cutoff: 2300, vol: 1.15, whine: 0.5, growl: 0.8, lump: 0.12, pops: 1 },
  // naturally aspirated V12: high, shrieking, smooth
  'Lamborghini Centenario': { cyl: 12, idle: 900, red: 8400, gears: 7, wave: 'sawtooth', detune: 4, cutoff: 3200, vol: 1.1, whine: 0, growl: 0.3, lump: 0.04, pops: 0.7 },
  // straight six: silky, mid-range rasp
  'BMW 3.0 CSL Hommage R': { cyl: 6, idle: 800, red: 7000, gears: 6, wave: 'sawtooth', detune: 3, cutoff: 2000, vol: 1, whine: 0, growl: 0.4, lump: 0.08, pops: 0.5 },
}

export class AudioEngine {
  private voice: Voice = VOICES['Ambassador taxi']
  private voiceName = 'Ambassador taxi'
  private rpm = 800
  /** gearbox state: current gear, time left in a shift (throttle cut), turbo spool 0..1, last throttle */
  private gear = 0
  private shift = 0
  private spool = 0
  private lastLoad = 0
  private h3!: OscillatorNode
  private drive!: GainNode
  private intakeGain!: GainNode
  private intakeFilter!: BiquadFilterNode
  private tyreGain!: GainNode
  private skidGain!: GainNode
  private skidOsc!: OscillatorNode
  /** what the engine is doing, for tuning and tests */
  readonly state = { rpm: 0, gear: 1, spool: 0 }
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

    // engine. The exhaust: firing-rate saw, a sub at crank order, a rasp at 1.5 × firing, all through a
    // waveshaper (load drives it harder) and a low-pass that opens with rpm. Crank-rate amplitude
    // modulation gives an uneven engine its lope.
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 380
    this.engineFilter.Q.value = 1.6
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.drive = ctx.createGain()
    this.drive.gain.value = 1
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 2.2)
    }
    shaper.curve = curve
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 42
    this.engineOsc2 = ctx.createOscillator()
    this.engineOsc2.type = 'sawtooth'
    this.engineOsc2.frequency.value = 42
    this.engineSub = ctx.createOscillator()
    this.engineSub.type = 'square'
    this.engineSub.frequency.value = 21
    this.h3 = ctx.createOscillator()
    this.h3.type = 'sawtooth'
    this.h3.frequency.value = 63
    const mix = ctx.createGain()
    mix.gain.value = 0.5
    const twin = ctx.createGain()
    twin.gain.value = 0.55
    const subGain = ctx.createGain()
    subGain.gain.value = 0.35
    const raspGain = ctx.createGain()
    raspGain.gain.value = 0.18
    this.engineOsc.connect(mix)
    this.engineOsc2.connect(twin).connect(mix)
    this.engineSub.connect(subGain).connect(mix)
    this.h3.connect(raspGain).connect(mix)
    const lope = ctx.createGain()
    lope.gain.value = 0.7
    this.chug = ctx.createOscillator()
    this.chug.frequency.value = 9
    this.chugDepth = ctx.createGain()
    this.chugDepth.gain.value = 0.3
    this.chug.connect(this.chugDepth).connect(lope.gain)
    mix.connect(this.drive).connect(shaper).connect(this.engineFilter).connect(lope).connect(this.engineGain).connect(this.master)
    // intake roar: noise through a band-pass that tracks rpm, only on load
    const intake = ctx.createBufferSource()
    intake.buffer = this.noise
    intake.loop = true
    this.intakeFilter = ctx.createBiquadFilter()
    this.intakeFilter.type = 'bandpass'
    this.intakeFilter.Q.value = 1.4
    this.intakeGain = ctx.createGain()
    this.intakeGain.gain.value = 0
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master)
    intake.start()
    // turbo whistle and a rough mechanical layer
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
    // tyres on the road: a low rumble that grows with speed
    const tyre = ctx.createBufferSource()
    tyre.buffer = this.noise
    tyre.loop = true
    tyre.playbackRate.value = 0.7
    const tyreF = ctx.createBiquadFilter()
    tyreF.type = 'lowpass'
    tyreF.frequency.value = 520
    this.tyreGain = ctx.createGain()
    this.tyreGain.gain.value = 0
    tyre.connect(tyreF).connect(this.tyreGain).connect(this.master)
    tyre.start()
    // skid: a narrow squeal with a wobble, from sideways slip
    const squeal = ctx.createBufferSource()
    squeal.buffer = this.noise
    squeal.loop = true
    const squealF = ctx.createBiquadFilter()
    squealF.type = 'bandpass'
    squealF.frequency.value = 1700
    squealF.Q.value = 9
    this.skidOsc = ctx.createOscillator()
    this.skidOsc.type = 'triangle'
    this.skidOsc.frequency.value = 880
    const skidTone = ctx.createGain()
    skidTone.gain.value = 0.25
    this.skidGain = ctx.createGain()
    this.skidGain.gain.value = 0
    squeal.connect(squealF).connect(this.skidGain)
    this.skidOsc.connect(skidTone).connect(this.skidGain)
    this.skidGain.connect(this.master)
    squeal.start()
    for (const o of [this.engineOsc, this.engineOsc2, this.engineSub, this.h3, this.whineOsc, this.chug, this.skidOsc]) o.start()

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

  /**
   * call every frame. speed m/s (negative = reverse), load = throttle 0..1, slip = sideways speed m/s,
   * top = the car's top speed in m/s (the gearbox spreads its gears over it)
   */
  update(speed: number, load: number, boosting: boolean, driving: boolean, night: number, slip = 0, top = 0) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const t = ctx.currentTime
    const v = this.voice
    const dt = 1 / 60
    const topSpeed = top || (this.voiceName === 'Ambassador taxi' ? 32 : 85)
    const s = Math.min(1, Math.abs(speed) / topSpeed)
    // gearbox: lower gears are short, upper gears long; gear g reaches the red line at gearTop(g) of top speed
    const gearTop = (g: number) => Math.pow((g + 1) / v.gears, 0.72)
    const span = v.red - v.idle
    const rpmIn = (g: number) => v.idle * 0.9 + (v.red - v.idle * 0.9) * (s / gearTop(g))
    if (!driving || speed < -0.5) this.gear = 0
    else if (this.shift <= 0) {
      const upAt = v.idle + span * (0.55 + 0.38 * load + (boosting ? 0.05 : 0))
      if (this.gear < v.gears - 1 && rpmIn(this.gear) > upAt) {
        this.gear++
        this.shift = this.voiceName === 'Ambassador taxi' ? 0.42 : 0.14
        if (load > 0.5 && v.pops > 0) this.pop(0.6 * v.pops)
      } else if (this.gear > 0 && rpmIn(this.gear - 1) < v.idle + span * (0.5 + 0.25 * load) && rpmIn(this.gear) < v.idle + span * 0.3) {
        this.gear--
        this.shift = 0.1
      }
    }
    this.shift = Math.max(0, this.shift - dt)
    // the clutch slips at a standstill, so a launch revs the engine before the car moves
    const clutch = this.gear === 0 ? v.idle + span * 0.45 * load * (1 - Math.min(1, s / gearTop(0))) : 0
    let target = driving ? Math.max(v.idle, Math.min(v.red, Math.max(rpmIn(this.gear), clutch))) : v.idle * 0.85
    if (driving && this.shift > 0) target = Math.min(target, rpmIn(this.gear) + span * 0.04)
    this.rpm += (target - this.rpm) * (this.shift > 0 ? 0.35 : 0.22)
    const r = clamp01((this.rpm - v.idle) / span)
    const onLoad = driving && this.shift <= 0 ? load : 0
    this.spool += ((v.whine > 0 ? onLoad * clamp01(r * 1.4) : 0) - this.spool) * (onLoad > this.spool ? 0.04 : 0.12)
    if (v.whine > 0 && this.lastLoad > 0.6 && load < 0.15 && this.spool > 0.45) this.blowOff(this.spool * v.whine)
    if (v.pops > 0 && driving && load < 0.1 && r > 0.45 && Math.random() < 0.06 * v.pops * r) this.pop(0.35 * v.pops)
    this.lastLoad = load
    Object.assign(this.state, { rpm: Math.round(this.rpm), gear: this.gear + 1, spool: +this.spool.toFixed(2) })

    // four-stroke: one firing per cylinder every two revolutions
    const fire = (this.rpm / 60) * (v.cyl / 2)
    this.engineOsc.frequency.setTargetAtTime(fire, t, 0.02)
    this.engineOsc2.frequency.setTargetAtTime(fire * (1 + v.detune / 1000), t, 0.02)
    this.engineSub.frequency.setTargetAtTime(this.rpm / 60, t, 0.02)
    this.h3.frequency.setTargetAtTime(fire * 1.5, t, 0.02)
    this.chug.frequency.setTargetAtTime(this.rpm / 120, t, 0.03)
    this.chugDepth.gain.setTargetAtTime(v.lump * (1 - r * 0.6), t, 0.2)
    this.drive.gain.setTargetAtTime(0.6 + onLoad * (0.9 + v.growl), t, 0.05)
    this.engineFilter.frequency.setTargetAtTime(v.cutoff * (0.35 + 0.65 * r) * (0.6 + 0.55 * onLoad), t, 0.04)
    const vol = ((driving ? 0.045 : 0.024) + onLoad * 0.05 + r * 0.03) * v.vol * (this.shift > 0 ? 0.55 : 1)
    this.engineGain.gain.setTargetAtTime(vol, t, 0.04)
    this.intakeFilter.frequency.setTargetAtTime(300 + this.rpm * 0.35, t, 0.05)
    this.intakeGain.gain.setTargetAtTime(driving ? onLoad * (0.012 + r * 0.035) * v.vol : 0, t, 0.06)
    this.whineOsc.frequency.setTargetAtTime(2200 + this.spool * 4200, t, 0.05)
    this.whineGain.gain.setTargetAtTime(v.whine * 0.012 * this.spool, t, 0.08)
    this.growlGain.gain.setTargetAtTime(driving ? v.growl * 0.03 * (0.3 + onLoad) * (0.4 + r) : 0, t, 0.1)
    this.tyreGain.gain.setTargetAtTime(driving ? Math.min(0.06, s * 0.09) : 0, t, 0.2)
    const skid = driving ? clamp01((Math.abs(slip) - 2.5) / 6) : 0
    this.skidGain.gain.setTargetAtTime(skid * 0.09, t, 0.05)
    this.skidOsc.frequency.setTargetAtTime(820 + Math.sin(t * 23) * 40 + Math.abs(slip) * 12, t, 0.02)
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

  /** an exhaust crackle: a very short low noise burst */
  private pop(level: number) {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900 + Math.random() * 700
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.08 * level, now)
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.05 + Math.random() * 0.04)
    src.connect(lp).connect(g).connect(this.master)
    src.start(now, Math.random() * 1.5, 0.1)
  }

  /** the turbo's blow-off valve when the throttle snaps shut */
  private blowOff(level: number) {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'bandpass'
    hp.Q.value = 0.9
    hp.frequency.setValueAtTime(3200, now)
    hp.frequency.exponentialRampToValueAtTime(1100, now + 0.35)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.05 * level, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.4)
    src.connect(hp).connect(g).connect(this.master)
    src.start(now, Math.random(), 0.45)
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
