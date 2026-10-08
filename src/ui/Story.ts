import Lenis from 'lenis'
import { STOPS } from '../content'
import { ANCHORS } from '../gl/world/Layout'
import { clamp, easeInOutSine } from '../utils/math'
import { reducedMotion } from '../utils/device'

/* ──────────────────────────────────────────────────────────────
   STORY
   The page scroll is a timeline. Each stop gets a "dwell" stretch
   (taxi parked, ticket on screen) and each gap between stops a
   "travel" stretch (taxi driving, camera following). Scroll position
   → which segment → where the taxi is and which panel shows.
────────────────────────────────────────────────────────────── */

export type Segment = { kind: 'dwell' | 'travel'; i: number; start: number; end: number }

export type StoryState = {
  kind: 'dwell' | 'travel'
  /** stop index of the dwell, or the stop the taxi left from */
  i: number
  /** progress through the current segment */
  p: number
  /** route distance of the taxi (0 at the first stop) */
  d: number
  /** stop whose panel should be on screen, or -1 */
  panel: number
  /** overall progress 0..1 */
  total: number
  /** nearest stop, for the meter and the rail */
  current: number
}

const DWELL = (i: number) => (i === 0 ? 0.62 : i === STOPS.length - 1 ? 1.0 : 0.82)

export class Story {
  readonly lenis: Lenis | null = null
  segments: Segment[] = []
  dwellStart: number[] = []
  dwellEnd: number[] = []
  state: StoryState = { kind: 'dwell', i: 0, p: 0, d: 0, panel: 0, total: 0, current: 0 }
  private vh = window.innerHeight
  private vw = window.innerWidth
  private max = 1
  private lastY = 0
  private dir = 1
  private idle = 0
  private touching = false
  private snapping = false
  private locked = false

  constructor(private track: HTMLElement) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    if (!reducedMotion) {
      this.lenis = new Lenis({
        lerp: 0.085,
        smoothWheel: true,
        wheelMultiplier: 0.85,
        touchMultiplier: 1.1,
        syncTouch: false,
        autoRaf: false,
        // overlays scroll natively; Lenis must never swallow their wheel/touch events
        prevent: (node: HTMLElement) => node.matches?.('.modal, .resume, .sheet, .reviews, [data-lenis-prevent]') ?? false,
      })
    }
    window.addEventListener('touchstart', () => (this.touching = true), { passive: true })
    window.addEventListener('touchend', () => {
      this.touching = false
      this.idle = 0
    }, { passive: true })
    this.layout()
  }

  /** rebuild the track from the viewport size; keeps the reader on the same stop */
  layout() {
    const prev = this.state
    this.vh = window.innerHeight
    this.vw = window.innerWidth
    const unit = this.vh
    this.segments = []
    this.dwellStart = []
    this.dwellEnd = []
    let y = 0
    for (let i = 0; i < STOPS.length; i++) {
      const dw = DWELL(i) * unit
      this.dwellStart.push(y)
      this.segments.push({ kind: 'dwell', i, start: y, end: y + dw })
      y += dw
      this.dwellEnd.push(y)
      if (i < STOPS.length - 1) {
        const dist = ANCHORS[i + 1].d - ANCHORS[i].d
        const tl = clamp(dist / 34, 0.62, 1.15) * unit
        this.segments.push({ kind: 'travel', i, start: y, end: y + tl })
        y += tl
      }
    }
    this.max = y
    this.track.style.height = `${Math.round(y + this.vh)}px`
    this.lenis?.resize()
    // keep the position meaningful after a resize
    const seg = this.segments.find((s) => s.kind === prev.kind && s.i === prev.i)
    if (seg && (prev.p > 0 || prev.i > 0)) {
      const target = seg.start + (seg.end - seg.start) * prev.p
      this.scrollTo(target, true)
    }
  }

  /** viewport width changed enough to need a relayout (ignores mobile URL-bar height jitter) */
  needsLayout() {
    return Math.abs(window.innerWidth - this.vw) > 2 || Math.abs(window.innerHeight - this.vh) > 140
  }

  get scrollY() {
    return this.lenis ? this.lenis.scroll : window.scrollY
  }

  raf(time: number) {
    this.lenis?.raf(time)
  }

  update(dt: number): StoryState {
    const y = clamp(this.scrollY, 0, this.max)
    if (Math.abs(y - this.lastY) > 0.5) {
      this.dir = y > this.lastY ? 1 : -1
      this.idle = 0
    } else this.idle += dt
    this.lastY = y

    let seg = this.segments[this.segments.length - 1]
    for (const s of this.segments) {
      if (y < s.end) {
        seg = s
        break
      }
    }
    const p = clamp((y - seg.start) / Math.max(1, seg.end - seg.start))
    const st = this.state
    st.kind = seg.kind
    st.i = seg.i
    st.p = p
    st.total = clamp(y / this.max)
    if (seg.kind === 'dwell') {
      st.d = ANCHORS[seg.i].d
      st.panel = seg.i
      st.current = seg.i
    } else {
      const a = ANCHORS[seg.i].d
      const b = ANCHORS[seg.i + 1].d
      st.d = a + (b - a) * easeInOutSine(p)
      // the old ticket leaves early, the next one arrives as the taxi pulls in
      st.panel = p < 0.14 ? seg.i : p > 0.86 ? seg.i + 1 : -1
      st.current = p < 0.5 ? seg.i : seg.i + 1
    }

    this.maybeSnap()
    return st
  }

  /** after the reader stops mid-road, roll on to the nearest stop in the direction they were going */
  private maybeSnap() {
    if (this.locked || this.snapping || this.touching || !this.lenis) return
    if (this.idle < 0.42) return
    const st = this.state
    if (st.kind !== 'travel' || st.p <= 0.02 || st.p >= 0.98) return
    const forward = this.dir > 0 ? st.p > 0.18 : st.p > 0.82
    const target = forward ? this.dwellStart[st.i + 1] + 2 : this.dwellEnd[st.i] - 2
    this.snapping = true
    this.lenis.scrollTo(target, {
      duration: 1.1,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      onComplete: () => (this.snapping = false),
    })
    // safety: never stay stuck in snapping mode
    window.setTimeout(() => (this.snapping = false), 1600)
  }

  /** scroll so stop i's panel is on screen */
  goTo(i: number, immediate = false) {
    const idx = clamp(i, 0, STOPS.length - 1)
    const target = idx === 0 ? 0 : this.dwellStart[idx] + Math.min(40, (this.dwellEnd[idx] - this.dwellStart[idx]) * 0.15)
    if (immediate || !this.lenis) return this.scrollTo(target, true)
    const distance = Math.abs(target - this.scrollY)
    const duration = clamp(0.8 + distance / (this.vh * 6), 0.9, 3.2)
    this.snapping = true
    this.lenis.scrollTo(target, { duration, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), onComplete: () => (this.snapping = false) })
    window.setTimeout(() => (this.snapping = false), duration * 1000 + 300)
  }

  scrollTo(y: number, immediate: boolean) {
    if (this.lenis) this.lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo({ top: y, behavior: immediate ? 'auto' : 'smooth' })
    this.lastY = y
  }

  /** freeze scrolling (drive mode, open overlays) */
  lock() {
    this.locked = true
    this.lenis?.stop()
    document.body.classList.add('is-locked')
  }

  unlock() {
    this.locked = false
    this.lenis?.start()
    document.body.classList.remove('is-locked')
  }

  get isLocked() {
    return this.locked
  }

  /** stop index whose dwell contains or follows route distance d */
  stopForDistance(d: number) {
    let best = 0
    for (let i = 0; i < ANCHORS.length; i++) if (ANCHORS[i].d <= d + 1) best = i
    return best
  }
}
