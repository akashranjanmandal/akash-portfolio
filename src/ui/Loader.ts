import gsap from 'gsap'
import { reducedMotion } from '../utils/device'

/** the taxi-meter loading screen and the "meter down" start button */
export class Loader {
  private root = document.getElementById('loader')!
  private count = document.getElementById('loader-count')!
  private button = document.getElementById('start') as HTMLButtonElement
  private sound = document.getElementById('start-sound') as HTMLInputElement
  private shown = 0
  private target = 0
  private raf = 0

  constructor() {
    const tick = () => {
      this.shown += (this.target - this.shown) * 0.12
      if (this.target - this.shown < 0.2) this.shown = this.target
      this.count.textContent = String(Math.floor(this.shown)).padStart(3, '0')
      if (this.shown < 100) this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  progress(p: number) {
    this.target = Math.max(this.target, Math.min(100, p * 100))
  }

  get soundWanted() {
    return this.sound.checked
  }

  /** resolves when the visitor presses the start button */
  ready(): Promise<void> {
    this.progress(1)
    this.button.disabled = false
    this.button.focus({ preventScroll: true })
    return new Promise((resolve) => {
      this.button.addEventListener('click', () => resolve(), { once: true })
    })
  }

  hide() {
    cancelAnimationFrame(this.raf)
    document.body.classList.remove('is-loading')
    if (reducedMotion) {
      this.root.remove()
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: () => { this.root.remove(); resolve() } })
      tl.to(this.root.querySelector('.loader__inner'), { y: -40, opacity: 0, duration: 0.5, ease: 'power2.in' })
      tl.to(this.root, { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, 0.25)
    })
  }
}
