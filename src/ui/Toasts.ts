import gsap from 'gsap'
import { escapeHtml } from '../utils/dom'
import { reducedMotion } from '../utils/device'

export class Toasts {
  private root = document.getElementById('toasts')!
  private queue: string[] = []

  show(icon: string, text: string, ms = 3200) {
    // never stack the same message twice
    if (this.queue.includes(text)) return
    this.queue.push(text)
    const el = document.createElement('div')
    el.className = 'toast'
    el.innerHTML = `<span class="toast__icon" aria-hidden="true">${icon}</span><span>${escapeHtml(text)}</span>`
    this.root.appendChild(el)
    while (this.root.children.length > 3) this.root.firstElementChild?.remove()
    if (!reducedMotion) gsap.fromTo(el, { y: -16, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' })
    window.setTimeout(() => {
      const done = () => {
        el.remove()
        this.queue = this.queue.filter((t) => t !== text)
      }
      if (reducedMotion) return done()
      gsap.to(el, { y: -10, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: done })
    }, ms)
  }
}
