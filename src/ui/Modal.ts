import gsap from 'gsap'
import { PROJECTS, STOPS } from '../content'
import { ICONS, escapeHtml } from '../utils/dom'
import { shotFrame, ticketHTML } from './Panels'
import { trapFocus } from './focus'
import { reducedMotion } from '../utils/device'

const ORDER = STOPS.filter((s) => s.project).map((s) => s.project!)

/** case notes for a project, or a chapter's ticket shown large (from drive mode) */
export class Modal {
  private root = document.getElementById('modal')!
  private release: (() => void) | null = null
  private opener: HTMLElement | null = null
  onOpen?: () => void
  onClose?: () => void

  constructor() {
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === this.root || t.closest('[data-close]')) return this.close()
      const nav = t.closest<HTMLElement>('[data-goto-project]')
      if (nav) this.openProject(nav.dataset.gotoProject!, false)
    })
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.close()
      }
    })
  }

  get isOpen() {
    return !this.root.hidden
  }

  openProject(slug: string, animate = true) {
    const p = PROJECTS[slug]
    if (!p) return
    const idx = ORDER.indexOf(slug)
    const prev = ORDER[(idx - 1 + ORDER.length) % ORDER.length]
    const next = ORDER[(idx + 1) % ORDER.length]
    const extra = slug === 'gharkamali'
      ? `<div class="modal__extra"><img src="img/work/gharkamali-alt-sm.webp" alt="GharKaMali — why choose us section" loading="lazy" width="800" height="377"></div>`
      : ''
    this.render(`
      <button class="overlay-close" type="button" data-close aria-label="Close">${ICONS.close}<span>Close</span></button>
      <div class="modal__card">
        <div class="modal__media">${shotFrame(p.live, p.image, `${p.name} — homepage`, true)}${extra}</div>
        <div class="modal__content">
          <div class="modal__top"><span class="modal__kind">${escapeHtml(p.kind)} · ${escapeHtml(p.where)}</span></div>
          <h2 class="modal__title" id="modal-title">${escapeHtml(p.name)}</h2>
          <p class="modal__tagline">${escapeHtml(p.tagline)}</p>
          <p class="modal__summary">${escapeHtml(p.summary)}</p>
          <div class="ticket__stats">${p.stats.map((s) => `<div><b>${escapeHtml(s.v)}</b><span>${escapeHtml(s.k)}</span></div>`).join('')}</div>
          <h3>What I built</h3>
          <ul class="modal__features">${p.features.map((f) => `<li><span>${escapeHtml(f)}</span></li>`).join('')}</ul>
          <h3>Stack</h3>
          <ul class="chips chips--light">${p.tech.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
          <div class="modal__actions">
            <a class="btn btn--ink" href="${p.live}" target="_blank" rel="noopener">Visit the live site ${ICONS.external}</a>
          </div>
          <nav class="modal__nav" aria-label="More projects">
            <button class="btn btn--paper btn--sm" type="button" data-goto-project="${prev}">← ${escapeHtml(PROJECTS[prev].name)}</button>
            <button class="btn btn--paper btn--sm" type="button" data-goto-project="${next}">${escapeHtml(PROJECTS[next].name)} →</button>
          </nav>
        </div>
      </div>`, animate)
  }

  /** a story chapter as a big ticket */
  openStop(i: number) {
    const stop = STOPS[i]
    if (stop.project && stop.id !== 'gobt') return this.openProject(stop.project)
    this.render(`
      <button class="overlay-close" type="button" data-close aria-label="Close">${ICONS.close}<span>Close</span></button>
      <div class="modal__card modal__card--ticket" style="display:block;max-width:560px">
        <article class="ticket ticket--modal" id="modal-title">${ticketHTML(stop, i)}</article>
      </div>`)
  }

  private render(markup: string, animate = true) {
    const wasOpen = this.isOpen
    if (!wasOpen) this.opener = document.activeElement as HTMLElement
    this.root.innerHTML = markup
    this.root.hidden = false
    const card = this.root.querySelector<HTMLElement>('.modal__card')!
    card.scrollTop = 0
    const ticket = card.querySelector<HTMLElement>('.ticket')
    const tear = card.querySelector<HTMLElement>('.ticket__tear')
    if (ticket) ticket.style.setProperty('--tear', tear ? `${tear.offsetTop}px` : '-40px')
    this.release?.()
    this.release = trapFocus(this.root)
    ;(this.root.querySelector('[data-close]') as HTMLElement).focus({ preventScroll: true })
    if (!wasOpen) {
      this.onOpen?.()
      if (animate && !reducedMotion) {
        gsap.fromTo(this.root, { opacity: 0 }, { opacity: 1, duration: 0.3 })
        gsap.fromTo(card, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' })
      }
    }
  }

  close() {
    if (!this.isOpen) return
    const card = this.root.querySelector<HTMLElement>('.modal__card')
    const done = () => {
      this.root.hidden = true
      this.root.innerHTML = ''
      this.release?.()
      this.release = null
      this.onClose?.()
      this.opener?.focus?.({ preventScroll: true })
    }
    if (reducedMotion || !card) return done()
    gsap.to(card, { y: 40, opacity: 0, duration: 0.25, ease: 'power2.in' })
    gsap.to(this.root, { opacity: 0, duration: 0.28, onComplete: done })
  }
}
