import gsap from 'gsap'
import { PROFILE, PROJECTS, STOPS, SKILLS, TESTIMONIALS, EXPERIENCE, EDUCATION } from '../content'
import { ICONS, escapeHtml } from '../utils/dom'
import { reviewCard } from './Panels'
import { trapFocus } from './focus'
import { reducedMotion } from '../utils/device'

/** the express route: everything on one calm, printable, accessible page */
export class Resume {
  private root = document.getElementById('resume')!
  private release: (() => void) | null = null
  private opener: HTMLElement | null = null
  onOpen?: () => void
  onClose?: () => void
  onProject?: (slug: string) => void

  constructor() {
    const work = STOPS.filter((s) => s.project).map((s) => PROJECTS[s.project!])
    const neotia = STOPS.find((s) => s.id === 'neotia')!
    const jobs = STOPS.find((s) => s.id === 'first-jobs')!
    this.root.innerHTML = `
      <button class="overlay-close" type="button" data-close aria-label="Close resume">${ICONS.close}<span>Close</span></button>
      <div class="resume__inner">
        <div class="resume__bar">
          <span class="modal__kind">Resume · the express route</span>
          <div class="actions">
            <a class="btn btn--ink btn--sm" href="${PROFILE.cv}" download>${ICONS.doc}<span>CV (PDF)</span></a>
            
          </div>
        </div>
        <div class="resume__intro">
          <img class="resume__photo" src="${PROFILE.photo}" alt="Akash Ranjan Mandal" loading="lazy" width="200" height="200">
          <div>
            <h1>${escapeHtml(PROFILE.name)}</h1>
            <p class="resume__role">${escapeHtml(PROFILE.role)} <span>· ${escapeHtml(PROFILE.location)}</span></p>
            <div class="resume__links">
              <a class="btn btn--primary btn--sm" href="mailto:${PROFILE.email}">${ICONS.mail}<span>${PROFILE.email}</span></a>
              <a class="btn btn--paper btn--sm" href="${PROFILE.phoneHref}">${ICONS.phone}<span>${PROFILE.phone}</span></a>
              ${PROFILE.socials.map((s) => `<a class="btn btn--paper btn--sm" href="${s.href}" target="_blank" rel="noopener">${s.label} ↗</a>`).join('')}
            </div>
          </div>
        </div>
        <section>
          <h2>Experience</h2>
          <ul class="timeline">${EXPERIENCE.map((e) => `<li><span class="when">${escapeHtml(e.when)}</span><span><span class="what">${escapeHtml(e.what)}</span> · <span class="where">${escapeHtml(e.where)}</span></span></li>`).join('')}</ul>
        </section>
        <section>
          <h2>Selected work</h2>
          <div class="work-grid">${work
            .map((p) => `<button class="work-card" type="button" data-project="${p.slug}"><img src="${p.imageSm}" alt="" loading="lazy" width="800" height="425"><div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.kind)} · ${escapeHtml(p.tech.slice(0, 3).join(', '))}</span></div></button>`)
            .join('')}</div>
        </section>
        <section>
          <h2>Earlier builds</h2>
          <ul class="timeline">
            ${(neotia.list ?? []).concat(jobs.list ?? []).map((l) => `<li><span class="when">${escapeHtml(l.title)}</span><span class="where">${escapeHtml(l.text)}${l.href ? ` <a href="${l.href}" target="_blank" rel="noopener">↗</a>` : ''}</span></li>`).join('')}
            <li><span class="when">Client sites</span><span class="where">${(jobs.links ?? []).map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join(' · ')}</span></li>
          </ul>
        </section>
        <section>
          <h2>Skills</h2>
          <div class="skills-grid">${SKILLS.map((g) => `<div><h3>${escapeHtml(g.group)}</h3><ul class="chips chips--light">${g.items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`).join('')}</div>
        </section>
        <section>
          <h2>Education</h2>
          <ul class="timeline">${EDUCATION.map((e) => `<li><span class="when">${escapeHtml(e.when)}</span><span><span class="what">${escapeHtml(e.what)}</span> · <span class="where">${escapeHtml(e.where)}</span></span></li>`).join('')}</ul>
        </section>
        <section>
          <h2>Kind words</h2>
          <div class="quotes">${TESTIMONIALS.map(reviewCard).join('')}</div>
        </section>
      </div>`

    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-close]')) return this.close()
      const card = t.closest<HTMLElement>('[data-project]')
      if (card) this.onProject?.(card.dataset.project!)
    })
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
  }

  get isOpen() {
    return !this.root.hidden
  }

  open() {
    if (this.isOpen) return
    this.opener = document.activeElement as HTMLElement
    this.root.hidden = false
    this.root.scrollTop = 0
    this.release = trapFocus(this.root)
    ;(this.root.querySelector('[data-close]') as HTMLElement).focus({ preventScroll: true })
    this.onOpen?.()
    if (!reducedMotion) gsap.fromTo(this.root, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' })
  }

  close() {
    if (!this.isOpen) return
    const done = () => {
      this.root.hidden = true
      this.release?.()
      this.onClose?.()
      this.opener?.focus?.({ preventScroll: true })
    }
    if (reducedMotion) return done()
    gsap.to(this.root, { opacity: 0, y: 20, duration: 0.25, ease: 'power2.in', onComplete: done })
  }
}
