import gsap from 'gsap'
import { PROFILE, PROJECTS, STOPS, SKILLS, TESTIMONIALS } from '../content'
import { ICONS, escapeHtml } from '../utils/dom'
import { reducedMotion } from '../utils/device'
import { PLOTS, GRID } from '../game/city/Plan'

/* ──────────────────────────────────────────────────────────────
   THE PHONE
   Everything that used to be a big popup lives on an in-game phone
   that slides up from the corner and never covers the whole world.
   Apps: Work, Map, Story, Skills, Contact.
────────────────────────────────────────────────────────────── */

type Route = { app: 'home' } | { app: 'work' } | { app: 'project'; id: string } | { app: 'map' } | { app: 'story' } | { app: 'skills' } | { app: 'contact' }

/** landmark id → story stop (the house is "boarding" in the story) */
export const stopFor = (id: string) => STOPS.find((s) => s.id === (id === 'home' ? 'boarding' : id))

const domain = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '')

export class Phone {
  private root = document.getElementById('phone')!
  private screen = document.getElementById('phone-screen')!
  private route: Route = { app: 'home' }
  private history: Route[] = []
  open = false
  onWaypoint?: (id: string) => void
  onResume?: () => void
  onToggle?: (open: boolean) => void
  /** player position for the map */
  where = { x: 0, z: 0, yaw: 0 }
  visited = new Set<string>()
  waypoint: string | null = null

  constructor() {
    document.getElementById('phone-home')!.addEventListener('click', () => (this.route.app === 'home' ? this.toggle(false) : this.go({ app: 'home' }, true)))
    this.screen.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const el = t.closest<HTMLElement>('[data-go], [data-way], [data-back], [data-resume], [data-close]')
      if (!el) return
      if (el.dataset.back !== undefined) return this.back()
      if (el.dataset.close !== undefined) return this.toggle(false)
      if (el.dataset.resume !== undefined) return this.onResume?.()
      if (el.dataset.way) {
        this.waypoint = el.dataset.way
        this.onWaypoint?.(el.dataset.way)
        return this.toggle(false)
      }
      const [app, id] = el.dataset.go!.split(':')
      this.go(id ? ({ app, id } as Route) : ({ app } as Route))
    })
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.toggle(false)
    })
    setInterval(() => this.clock(), 15000)
    this.clock()
    this.render()
  }

  private clock() {
    const d = new Date()
    document.getElementById('phone-time')!.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  toggle(open = !this.open) {
    if (open === this.open) return
    this.open = open
    this.root.classList.toggle('is-open', open)
    this.root.setAttribute('aria-hidden', String(!open))
    if (open) {
      this.render()
      if (!reducedMotion) gsap.fromTo(this.root.querySelector('.phone__frame'), { y: 60, rotate: 4, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.5, ease: 'expo.out' })
    }
    this.onToggle?.(open)
  }

  /** open straight onto a landmark's page */
  show(id: string) {
    this.history = [{ app: 'home' }]
    const stop = stopFor(id)
    this.route = stop?.project ? { app: 'project', id: stop.project } : { app: 'story' }
    if (id === 'fuel') this.route = { app: 'skills' }
    if (id === 'last-stop' || id === 'home') this.route = id === 'home' ? { app: 'home' } : { app: 'contact' }
    if (!this.open) this.toggle(true)
    else this.render()
  }

  private go(r: Route, reset = false) {
    if (reset) this.history = []
    else this.history.push(this.route)
    this.route = r
    this.render()
    this.screen.scrollTop = 0
  }

  private back() {
    this.route = this.history.pop() ?? { app: 'home' }
    this.render()
  }

  private bar(title: string) {
    return `<div class="app-bar"><button type="button" data-back aria-label="Back">${ICONS.arrow}</button><span>${escapeHtml(title)}</span><button type="button" data-close aria-label="Close phone">${ICONS.close}</button></div>`
  }

  render() {
    const r = this.route
    let html = ''
    if (r.app === 'home') html = this.home()
    else if (r.app === 'work') html = this.work()
    else if (r.app === 'project') html = this.project(r.id)
    else if (r.app === 'map') html = this.map()
    else if (r.app === 'story') html = this.story()
    else if (r.app === 'skills') html = this.skills()
    else html = this.contact()
    this.screen.innerHTML = html
    if (r.app === 'map') this.drawMap()
  }

  private home() {
    const apps: [string, string, string, string][] = [
      ['work', 'Work', '#ffc61a', '▦'],
      ['map', 'Map', '#3fb27f', '⌖'],
      ['story', 'Story', '#ff7a59', '✦'],
      ['skills', 'Skills', '#5aa9ff', '⚙'],
      ['contact', 'Contact', '#b07cff', '✉'],
    ]
    const n = PLOTS.filter((p) => stopFor(p.id)?.project).length
    const seen = PLOTS.filter((p) => stopFor(p.id)?.project && this.visited.has(p.id)).length
    return `
      <div class="ph-home">
        <div class="ph-hello"><small>Welcome to</small><strong>${escapeHtml(PROFILE.first)}’s town</strong><span>${escapeHtml(PROFILE.role)}</span></div>
        <div class="ph-grid">${apps.map(([id, label, color, glyph]) => `<button type="button" class="ph-app" data-go="${id}"><span style="background:${color}">${glyph}</span>${label}</button>`).join('')}
          <button type="button" class="ph-app" data-resume><span style="background:#e9e5dc;color:#141218">${ICONS.doc}</span>Resume</button>
        </div>
        <div class="ph-progress"><span>Projects visited</span><b>${seen}/${n}</b><i style="--p:${n ? seen / n : 0}"></i></div>
        <p class="ph-tip">Walk up to any building and press <kbd>E</kbd> (or tap Open) to read about it here.</p>
      </div>`
  }

  private work() {
    const items = PLOTS.map((p) => ({ plot: p, stop: stopFor(p.id) })).filter((x) => x.stop?.project)
    return `${this.bar('Work')}
      <div class="ph-list">${items
        .map(({ plot, stop }) => {
          const pr = PROJECTS[stop!.project!]
          return `<button type="button" class="ph-card" data-go="project:${pr.slug}">
            <img src="${pr.imageSm}" alt="" loading="lazy" width="800" height="380">
            <span><b>${escapeHtml(pr.name)}${this.visited.has(plot.id) ? ' <em>✓</em>' : ''}</b><small>${escapeHtml(pr.kind)}</small></span></button>`
        })
        .join('')}</div>`
  }

  private project(slug: string) {
    const p = PROJECTS[slug]
    if (!p) return this.work()
    const plot = PLOTS.find((x) => stopFor(x.id)?.project === slug)
    return `${this.bar(p.name)}
      <div class="ph-detail">
        <figure class="ph-shot"><img src="${p.imageSm}" alt="${escapeHtml(p.name)} website" width="800" height="380"><figcaption>${escapeHtml(domain(p.live))}</figcaption></figure>
        <p class="ph-kind">${escapeHtml(p.kind)} · ${escapeHtml(p.where)}</p>
        <h3>${escapeHtml(p.tagline)}</h3>
        <p>${escapeHtml(p.summary)}</p>
        <div class="ph-stats">${p.stats.map((s) => `<div><b>${escapeHtml(s.v)}</b><small>${escapeHtml(s.k)}</small></div>`).join('')}</div>
        <h4>What I built</h4>
        <ul class="ph-feat">${p.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <h4>Stack</h4>
        <ul class="ph-chips">${p.tech.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
        <div class="ph-actions">
          <a class="ph-btn ph-btn--main" href="${p.live}" target="_blank" rel="noopener">Visit ${escapeHtml(domain(p.live))} ${ICONS.external}</a>
          ${plot ? `<button type="button" class="ph-btn" data-way="${plot.id}">Take me there</button>` : ''}
        </div>
      </div>`
  }

  private story() {
    const chapters = STOPS.filter((s) => s.kind === 'chapter' || s.kind === 'intro')
    const strip = (h: string) => h.replace(/<[^>]+>/g, '')
    return `${this.bar('Story')}
      <ol class="ph-story">${chapters
        .map((s) => {
          const plot = PLOTS.find((p) => stopFor(p.id) === s)
          return `<li><span class="ph-k">${escapeHtml(s.label)}</span><h4>${escapeHtml(strip(s.title || s.label))}</h4>${s.body ? `<p>${escapeHtml(s.body)}</p>` : ''}${
            s.list ? `<ul>${s.list.map((l) => `<li><b>${escapeHtml(l.title)}</b> — ${escapeHtml(l.text)}</li>`).join('')}</ul>` : ''
          }${s.meta ? `<p class="ph-meta">${s.meta.map((m) => `<span>${escapeHtml(m.k)} · ${escapeHtml(m.v)}</span>`).join('')}</p>` : ''}${
            plot ? `<button type="button" class="ph-link" data-way="${plot.id}">Show on the map →</button>` : ''
          }</li>`
        })
        .join('')}</ol>`
  }

  private skills() {
    return `${this.bar('Skills')}
      <div class="ph-skills">${SKILLS.map((g) => `<section><h4>${escapeHtml(g.group)}</h4><ul class="ph-chips">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></section>`).join('')}</div>`
  }

  private contact() {
    return `${this.bar('Contact')}
      <div class="ph-contact">
        <h3>The meter’s still running.<br>Let’s build something.</h3>
        <a class="ph-btn ph-btn--main" href="mailto:${PROFILE.email}">${ICONS.mail}${PROFILE.email}</a>
        <a class="ph-btn" href="${PROFILE.whatsapp}" target="_blank" rel="noopener">${ICONS.phone}WhatsApp</a>
        <a class="ph-btn" href="${PROFILE.cv}" download>${ICONS.doc}Download CV</a>
        <div class="ph-socials">${PROFILE.socials.map((s) => `<a href="${s.href}" target="_blank" rel="noopener">${s.label} ↗</a>`).join('')}</div>
        <h4>Kind words</h4>
        ${TESTIMONIALS.map((t) => `<blockquote>“${escapeHtml(t.text)}”<cite>${escapeHtml(t.name)} · ${escapeHtml(t.role)}</cite></blockquote>`).join('')}
      </div>`
  }

  private map() {
    return `${this.bar('Map')}
      <div class="ph-map"><canvas id="ph-map" width="600" height="600"></canvas><p>Tap a place to set a waypoint.</p>
      <ul class="ph-places">${PLOTS.map((p) => `<li><button type="button" data-way="${p.id}"><span>${escapeHtml(stopFor(p.id)?.label ?? p.id)}</span>${this.waypoint === p.id ? '<em>●</em>' : ''}</button></li>`).join('')}</ul></div>`
  }

  private drawMap() {
    const c = this.screen.querySelector<HTMLCanvasElement>('#ph-map')
    if (!c) return
    const g = c.getContext('2d')!
    const S = c.width
    const span = 470
    const P = (x: number, z: number): [number, number] => [((x + span / 2) / span) * S, ((z + span / 2) / span) * S]
    g.fillStyle = '#2a4d3a'
    g.fillRect(0, 0, S, S)
    g.fillStyle = '#3a3a40'
    for (const v of GRID) {
      const [a] = P(v - 5, 0)
      const [b] = P(v + 5, 0)
      g.fillRect(a, 0, b - a, S)
      g.fillRect(0, a, S, b - a)
    }
    g.font = '600 15px system-ui, sans-serif'
    g.textAlign = 'center'
    for (const p of PLOTS) {
      const face = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[p.face]
      const [x, y] = P(p.cx + face[0] * 33, p.cz + face[1] * 33)
      g.fillStyle = this.waypoint === p.id ? '#ffc61a' : this.visited.has(p.id) ? '#9be3b5' : '#ffffff'
      g.beginPath()
      g.arc(x, y, 7, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.fillText(stopFor(p.id)?.label ?? p.id, x, y - 12)
    }
    const [px, py] = P(this.where.x, this.where.z)
    g.save()
    g.translate(px, py)
    g.rotate(-this.where.yaw + Math.PI)
    g.fillStyle = '#ff4d6d'
    g.beginPath()
    g.moveTo(0, -11)
    g.lineTo(8, 8)
    g.lineTo(-8, 8)
    g.closePath()
    g.fill()
    g.restore()
    c.onclick = (e) => {
      const r = c.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * span - span / 2
      const z = ((e.clientY - r.top) / r.height) * span - span / 2
      let best = PLOTS[0]
      let bd = Infinity
      for (const p of PLOTS) {
        const d = (p.cx - x) ** 2 + (p.cz - z) ** 2
        if (d < bd) {
          bd = d
          best = p
        }
      }
      this.waypoint = best.id
      this.onWaypoint?.(best.id)
      this.toggle(false)
    }
  }
}
