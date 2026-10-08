import { STOPS } from '../content'
import { ICONS, escapeHtml } from '../utils/dom'
import { trapFocus } from './focus'

const pad = (n: number) => String(n).padStart(2, '0')

/** taxi meter, progress rail and the stops sheet */
export class Hud {
  private stopEl = document.getElementById('meter-stop')!
  private fareEl = document.getElementById('meter-fare')!
  private kmEl = document.getElementById('meter-km')!
  private nextEl = document.getElementById('meter-next')!
  private rail = document.getElementById('rail')!
  private sheet = document.getElementById('stops-sheet')!
  private railButtons: HTMLButtonElement[] = []
  private last = { stop: -1, fare: -1, km: -1, label: '' }
  private release: (() => void) | null = null
  private opener: HTMLElement | null = null

  constructor(private onGoto: (i: number) => void) {
    this.rail.innerHTML = STOPS.map(
      (s, i) => `<button type="button" data-i="${i}" aria-label="Go to ${escapeHtml(s.label)}"><span>${pad(i)} · ${escapeHtml(s.label)}</span></button>`,
    ).join('')
    this.railButtons = Array.from(this.rail.querySelectorAll('button'))
    this.rail.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button')
      if (b) this.onGoto(Number(b.dataset.i))
    })

    this.sheet.innerHTML = `
      <button class="overlay-close" type="button" data-close aria-label="Close">${ICONS.close}<span>Close</span></button>
      <div class="sheet__panel">
        <div class="sheet__head"><h2>The route</h2></div>
        <ol class="route">${STOPS.map(
          (s, i) => `<li><button type="button" data-i="${i}"><span class="dot">${i === STOPS.length - 1 ? 'END' : pad(i)}</span><span><span class="name">${escapeHtml(s.label)}</span><br><span class="kind">${s.kind === 'project' ? 'Project' : s.kind === 'intro' ? 'Start' : s.kind === 'skills' ? 'Skills' : s.kind === 'contact' ? 'Contact' : 'Chapter'}</span></span><span aria-hidden="true">→</span></button></li>`,
        ).join('')}</ol>
      </div>`
    this.sheet.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === this.sheet || t.closest('[data-close]')) return this.closeSheet()
      const b = t.closest<HTMLButtonElement>('button[data-i]')
      if (b) {
        this.closeSheet()
        this.onGoto(Number(b.dataset.i))
      }
    })
    this.sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSheet()
    })
  }

  openSheet() {
    this.opener = document.activeElement as HTMLElement
    this.sheet.hidden = false
    this.sheet.querySelectorAll('.route button').forEach((b, i) => b.classList.toggle('is-current', i === this.last.stop))
    this.release = trapFocus(this.sheet)
    ;(this.sheet.querySelector('.route .is-current') as HTMLElement | null)?.focus()
  }

  closeSheet() {
    if (this.sheet.hidden) return
    this.sheet.hidden = true
    this.release?.()
    this.opener?.focus?.()
  }

  get sheetOpen() {
    return !this.sheet.hidden
  }

  update(stop: number, km: number) {
    const fare = 30 + Math.round(km * 14)
    if (stop !== this.last.stop) {
      this.last.stop = stop
      this.stopEl.textContent = `${pad(stop)}/${pad(STOPS.length - 1)}`
      const next = STOPS[Math.min(STOPS.length - 1, stop + 1)]
      const label = stop >= STOPS.length - 1 ? 'Thanks for riding' : `Next · ${next.label}`
      if (label !== this.last.label) {
        this.last.label = label
        this.nextEl.textContent = label
      }
      this.railButtons.forEach((b, i) => {
        b.classList.toggle('is-current', i === stop)
        b.classList.toggle('is-done', i < stop)
        if (i === stop) b.setAttribute('aria-current', 'step')
        else b.removeAttribute('aria-current')
      })
    }
    if (fare !== this.last.fare) {
      this.last.fare = fare
      this.fareEl.textContent = String(fare)
    }
    const k = Math.round(km * 10)
    if (k !== this.last.km) {
      this.last.km = k
      this.kmEl.textContent = (k / 10).toFixed(1)
    }
  }
}
