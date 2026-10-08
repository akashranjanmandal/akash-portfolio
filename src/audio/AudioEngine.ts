import { storage } from '../utils/dom'

/* ──────────────────────────────────────────────────────────────
   SOUND
   Everything is synthesised with WebAudio — no files to download.
   An old diesel engine that chugs with speed, a two-tone horn,
   thuds, pickups, and birds by day / crickets by night.
────────────────────────────────────────────────────────────── */

export class AudioEngine {
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
    this.engineOsc.start()
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
    const s = Math.min(1, Math.abs(speed) / 22)
    const f = 40 + s * 70 + load * 18 + (boosting ? 18 : 0)
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08)
    this.engineSub.frequency.setTargetAtTime(f / 2, t, 0.08)
    this.chug.frequency.setTargetAtTime(7 + s * 26, t, 0.1)
    this.chugDepth.gain.setTargetAtTime(0.32 - s * 0.2, t, 0.2)
    this.engineFilter.frequency.setTargetAtTime(320 + load * 900 + s * 700, t, 0.1)
    const vol = (driving ? 0.05 : 0.028) + load * 0.05 + s * 0.04
    this.engineGain.gain.setTargetAtTime(vol, t, 0.12)
    this.windGain.gain.setTargetAtTime(s * s * (driving ? 0.09 : 0.05), t, 0.2)
    this.windFilter.frequency.setTargetAtTime(400 + s * 900, t, 0.2)

    if (t > this.nextAmbient) {
      this.nextAmbient = t + 1.4 + Math.random() * 3.2
      if (night > 0.6) this.cricket()
      else if (night < 0.3) this.bird()
    }
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
