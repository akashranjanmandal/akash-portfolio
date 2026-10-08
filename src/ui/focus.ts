const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** keep Tab inside a dialog; returns a function that releases the trap */
export function trapFocus(root: HTMLElement) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  root.addEventListener('keydown', onKey)
  return () => root.removeEventListener('keydown', onKey)
}
