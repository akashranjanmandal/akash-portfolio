import { reducedMotion } from '../utils/device'

/** a soft yellow ring that trails the mouse and swells over anything clickable */
export class Cursor {
  private el = document.getElementById('cursor')!
  private x = -100
  private y = -100
  private tx = -100
  private ty = -100
  private enabled = matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion

  constructor() {
    if (!this.enabled) return
    document.body.classList.add('has-cursor')
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.tx = e.clientX
      this.ty = e.clientY
      const hit = (e.target as HTMLElement).closest?.('a, button, label, [role="button"], input')
      this.el.classList.toggle('is-hover', !!hit)
    }, { passive: true })
    document.addEventListener('mouseleave', () => {
      this.tx = this.ty = -100
    })
  }

  update(dt: number) {
    if (!this.enabled) return
    const k = 1 - Math.exp(-22 * dt)
    this.x += (this.tx - this.x) * k
    this.y += (this.ty - this.y) * k
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0)`
  }
}
