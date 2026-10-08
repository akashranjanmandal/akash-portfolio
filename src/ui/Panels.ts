import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { STOPS, PROJECTS, PROFILE, SKILLS, TESTIMONIALS, type Stop } from '../content'
import { ICONS, escapeHtml } from '../utils/dom'
import { reducedMotion } from '../utils/device'

gsap.registerPlugin(SplitText)

const pad = (n: number) => String(n).padStart(2, '0')
const domain = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

function head(stop: Stop, index: number, extra = '') {
  const no = index === STOPS.length - 1 ? 'LAST' : `STOP ${pad(index)}`
  const place = stop.eyebrow.replace(/^(Stop \d+|Last stop) · /, '')
  return `<header class="ticket__head"><span class="ticket__no">${no}</span><span class="ticket__place">${escapeHtml(place)}${extra}</span><span class="ticket__barcode" aria-hidden="true"></span></header>`
}

function chips(items: string[], light = false) {
  return `<ul class="chips${light ? ' chips--light' : ''}" data-reveal>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
}

function meta(stop: Stop) {
  if (!stop.meta?.length) return ''
  return `<dl class="ticket__meta">${stop.meta.map((m) => `<div><dt>${escapeHtml(m.k)}</dt><dd>${escapeHtml(m.v)}</dd></div>`).join('')}</dl>`
}

function stats(list: { v: string; k: string }[]) {
  return `<div class="ticket__stats" data-reveal>${list.map((s) => `<div><b>${escapeHtml(s.v)}</b><span>${escapeHtml(s.k)}</span></div>`).join('')}</div>`
}

export function shotFrame(url: string, src: string, alt: string, eager = false) {
  return `<figure class="shot" data-reveal><div class="shot__bar"><i></i><i></i><i></i><span>${escapeHtml(domain(url))}</span></div><img src="${src}" alt="${escapeHtml(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async" width="800" height="370"></figure>`
}

function heroPanel(stop: Stop) {
  return `
  <section class="hero" data-panel="0" aria-label="Introduction" aria-hidden="true">
    <h2 class="hero__name"><span class="hero__first" data-split>Akash</span><span class="hero__last" data-reveal>Ranjan Mandal</span></h2>
    <p class="hero__lede" data-reveal>${escapeHtml(stop.body ?? '')}</p>
    <div class="hero__ctas" data-reveal>
      <button class="btn btn--primary btn--xl" type="button" data-action="ride">Scroll to ride <span aria-hidden="true">↓</span></button>
      <button class="btn btn--xl" type="button" data-action="drive">${ICONS.wheel}<span>Take the wheel</span></button>
    </div>
    <div class="hero__meta" data-reveal>${(stop.meta ?? []).map((m) => `<span><b>${escapeHtml(m.k)}</b> ${escapeHtml(m.v)}</span>`).join('')}</div>
  </section>`
}

function chapterTicket(stop: Stop, i: number) {
  const list = stop.list?.length
    ? `<ul class="ticket__list" data-reveal>${stop.list
        .map((l) => `<li><span><strong>${l.href ? `<a href="${l.href}" target="_blank" rel="noopener">${escapeHtml(l.title)}</a>` : escapeHtml(l.title)}</strong> — ${escapeHtml(l.text)}</span></li>`)
        .join('')}</ul>`
    : ''
  const links = stop.links?.length
    ? `<div class="ticket__links" data-reveal>${stop.links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${escapeHtml(l.label)} ↗</a>`).join('')}</div>`
    : ''
  const st = stop.stats ? stats(stop.stats) : ''
  return `
    ${head(stop, i)}
    <div class="ticket__body">
      <h2 class="ticket__title" data-split>${stop.title}</h2>
      ${stop.body ? `<p class="ticket__text" data-reveal>${escapeHtml(stop.body)}</p>` : ''}
      ${st}${list}${links}
    </div>
    ${stop.meta?.length ? `<div class="ticket__tear" aria-hidden="true"></div><div class="ticket__foot" data-reveal>${meta(stop)}</div>` : ''}`
}

function projectTicket(stop: Stop, i: number) {
  const p = PROJECTS[stop.project!]
  const isHQ = stop.id === 'gobt'
  const title = isHQ ? stop.title : escapeHtml(p.tagline)
  const text = isHQ ? stop.body! : p.summary
  return `
    ${head(stop, i, ` · ${escapeHtml(p.kind)}`)}
    <div class="ticket__body">
      ${isHQ ? '' : shotFrame(p.live, p.imageSm, `${p.name} website`)}
      <h2 class="ticket__title" data-split>${title}</h2>
      <p class="ticket__text" data-reveal>${escapeHtml(text)}</p>
      ${isHQ && stop.quote ? `<blockquote class="ticket__quote" data-reveal>“${escapeHtml(stop.quote)}”</blockquote>` : ''}
      ${chips(p.tech.slice(0, 7))}
    </div>
    <div class="ticket__tear" aria-hidden="true"></div>
    <div class="ticket__foot ticket__actions" data-reveal>
      <a class="btn btn--ink" href="${p.live}" target="_blank" rel="noopener">${isHQ ? 'Visit gobt.in' : `Visit ${escapeHtml(domain(p.live))}`} ${ICONS.external}</a>
      <button class="btn btn--paper" type="button" data-action="project" data-project="${p.slug}">Case notes</button>
    </div>`
}

function skillsTicket(stop: Stop, i: number) {
  return `
    ${head(stop, i)}
    <div class="ticket__body">
      <h2 class="ticket__title" data-split>${stop.title}</h2>
      <p class="ticket__text" data-reveal>${escapeHtml(stop.body ?? '')}</p>
      <div class="board" data-reveal>
        ${SKILLS.map((g) => `<div class="board__row"><h3>${escapeHtml(g.group)}</h3><ul>${g.items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </div>`
}

export function reviewCard(t: (typeof TESTIMONIALS)[number]) {
  const initials = t.name.split(' ').map((w) => w[0]).join('').slice(0, 2)
  const avatar = t.photo ? `<img class="avatar" src="${t.photo}" alt="" loading="lazy" width="34" height="34">` : `<span class="avatar" aria-hidden="true">${initials}</span>`
  return `<figure class="review"><p>“${escapeHtml(t.text)}”</p><footer>${avatar}<span><b>${escapeHtml(t.name)}</b>${escapeHtml(t.role)}</span></footer></figure>`
}

function contactTicket(stop: Stop, i: number) {
  return `
    ${head(stop, i)}
    <div class="ticket__body">
      <h2 class="ticket__title" data-split>${stop.title}</h2>
      <p class="ticket__text" data-reveal>${escapeHtml(stop.body ?? '')}</p>
      <div class="contact-grid" data-reveal>
        <a class="btn btn--primary" href="mailto:${PROFILE.email}">${ICONS.mail}<span>${PROFILE.email}</span></a>
        <a class="btn btn--paper" href="${PROFILE.whatsapp}" target="_blank" rel="noopener">${ICONS.phone}<span>WhatsApp</span></a>
        <a class="btn btn--paper" href="${PROFILE.cv}" download>${ICONS.doc}<span>Download CV</span></a>
      </div>
      <div class="reviews" data-reveal aria-label="What people say">${TESTIMONIALS.map(reviewCard).join('')}</div>
    </div>
    <div class="ticket__tear" aria-hidden="true"></div>
    <div class="ticket__foot" data-reveal>
      <div class="socials">${PROFILE.socials.map((s) => `<a href="${s.href}" target="_blank" rel="noopener">${s.label} ↗</a>`).join('')}<a href="${PROFILE.phoneHref}">${PROFILE.phone}</a></div>
      <div class="ticket__actions" style="margin-top:10px">
        <button class="btn btn--ink btn--sm" type="button" data-action="restart">Ride again ↺</button>
        <button class="btn btn--paper btn--sm" type="button" data-action="drive">Take the wheel</button>
      </div>
    </div>`
}

export function ticketHTML(stop: Stop, i: number) {
  switch (stop.kind) {
    case 'project':
      return projectTicket(stop, i)
    case 'skills':
      return skillsTicket(stop, i)
    case 'contact':
      return contactTicket(stop, i)
    default:
      return chapterTicket(stop, i)
  }
}

function panelHTML(stop: Stop, i: number) {
  if (stop.kind === 'intro') return heroPanel(stop)
  const wide = stop.stats ? ' ticket--wide' : ''
  return `<section class="panel" data-panel="${i}" aria-label="${escapeHtml(stop.label)}" aria-hidden="true"><div class="ticket-wrap"><article class="ticket${wide}">${ticketHTML(stop, i)}</article></div></section>`
}

/* ── controller ─────────────────────────────────────────────── */

type View = { el: HTMLElement; split?: SplitText; tl?: gsap.core.Timeline; shown: boolean }

export class Panels {
  private views: View[] = []
  private active = -1
  private mobile = window.innerWidth < 700

  constructor(root: HTMLElement) {
    root.innerHTML = STOPS.map(panelHTML).join('')
    this.views = Array.from(root.querySelectorAll<HTMLElement>('[data-panel]')).map((el) => ({ el, shown: false }))
  }

  /** split headlines once fonts are in, then measure ticket tears */
  prepare() {
    for (const v of this.views) {
      const target = v.el.querySelector<HTMLElement>('[data-split]')
      if (target && !reducedMotion) {
        v.split = SplitText.create(target, { type: 'lines', mask: 'lines', autoSplit: true, linesClass: 'split-line' })
      }
    }
    this.measure()
  }

  /** position the punched notches of each ticket on its tear line */
  measure() {
    this.mobile = window.innerWidth < 700
    for (const v of this.views) {
      const ticket = v.el.querySelector<HTMLElement>('.ticket')
      const tear = v.el.querySelector<HTMLElement>('.ticket__tear')
      if (ticket && tear) ticket.style.setProperty('--tear', `${tear.offsetTop}px`)
      else if (ticket) ticket.style.setProperty('--tear', '-40px')
    }
  }

  get current() {
    return this.active
  }

  setActive(i: number) {
    if (i === this.active) return
    if (this.active >= 0) this.hide(this.views[this.active])
    this.active = i
    if (i >= 0) this.show(this.views[i])
  }

  private show(v: View) {
    v.tl?.kill()
    v.shown = true
    v.el.classList.add('is-active')
    v.el.setAttribute('aria-hidden', 'false')
    const wrap = v.el.querySelector('.ticket-wrap') ?? v.el
    const reveals = v.el.querySelectorAll('[data-reveal]')
    const lines = v.split?.lines ?? []
    if (v.el.querySelector('.ticket')) this.measure()

    if (reducedMotion) {
      v.tl = gsap.timeline().fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 })
      gsap.set(reveals, { opacity: 1, y: 0 })
      return
    }
    const fromY = this.mobile ? 70 : 40
    const tl = gsap.timeline()
    if (wrap !== v.el) {
      tl.fromTo(wrap, { y: fromY, opacity: 0, rotate: this.mobile ? 0 : -1.4 }, { y: 0, opacity: 1, rotate: 0, duration: 0.8, ease: 'expo.out' }, 0)
    } else {
      tl.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0)
    }
    if (lines.length) tl.fromTo(lines, { yPercent: 108 }, { yPercent: 0, duration: 0.85, ease: 'expo.out', stagger: 0.07 }, 0.08)
    if (reveals.length) tl.fromTo(reveals, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.05 }, 0.2)
    v.tl = tl
  }

  private hide(v: View) {
    v.tl?.kill()
    v.shown = false
    const wrap = v.el.querySelector('.ticket-wrap') ?? v.el
    v.el.setAttribute('aria-hidden', 'true')
    // keep focus out of a panel that is leaving
    if (v.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    v.tl = gsap.timeline({
      onComplete: () => {
        if (!v.shown) v.el.classList.remove('is-active')
      },
    })
    v.tl.to(wrap, { y: this.mobile ? 40 : -26, opacity: 0, duration: reducedMotion ? 0.15 : 0.34, ease: 'power2.in' })
  }

  /** hide everything immediately (drive mode) */
  hideAll() {
    this.setActive(-1)
  }
}
