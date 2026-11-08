/* Unified input. Desktop: WASD + mouse look (pointer lock), Shift sprint,
   Space jump, V view, F enter/exit vehicle, E open nearby info.
   Touch: left stick moves, dragging anywhere on the right half looks,
   on-screen buttons for jump / sprint / view / interact. */

export class Input {
  readonly move = { x: 0, y: 0 } // x right, y forward, -1..1
  readonly look = { x: 0, y: 0 } // accumulated pixels since last read
  sprint = false
  jump = false
  brake = false
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private stick = { id: -1, cx: 0, cy: 0, r: 56, x: 0, y: 0 }
  private lookId = -1
  private lookLast = { x: 0, y: 0 }
  private touchSprint = false
  readonly touch = matchMedia('(pointer: coarse)').matches
  enabled = true

  constructor(canvas: HTMLCanvasElement, private ui: { stick: HTMLElement; knob: HTMLElement }) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target as HTMLElement).closest('input, textarea')) return
      const k = e.code
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(k)) e.preventDefault()
      if (!this.keys.has(k)) this.pressed.add(k)
      this.keys.add(k)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())

    // desktop mouse look
    canvas.addEventListener('click', () => {
      if (!this.touch && this.enabled && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()
    })
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX
        this.look.y += e.movementY
      }
    })

    // touch: stick + look area
    const { stick } = ui
    stick.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return
      this.stick.id = e.pointerId
      stick.setPointerCapture(e.pointerId)
      const r = stick.getBoundingClientRect()
      this.stick.cx = r.left + r.width / 2
      this.stick.cy = r.top + r.height / 2
      this.stick.r = r.width / 2 - 10
      this.moveStick(e.clientX, e.clientY)
    })
    stick.addEventListener('pointermove', (e) => e.pointerId === this.stick.id && this.moveStick(e.clientX, e.clientY))
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return
      this.stick.id = -1
      this.stick.x = this.stick.y = 0
      ui.knob.style.transform = ''
    }
    stick.addEventListener('pointerup', endStick)
    stick.addEventListener('pointercancel', endStick)

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.lookId !== -1) return
      this.lookId = e.pointerId
      this.lookLast = { x: e.clientX, y: e.clientY }
    })
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return
      this.look.x += (e.clientX - this.lookLast.x) * 1.6
      this.look.y += (e.clientY - this.lookLast.y) * 1.6
      this.lookLast = { x: e.clientX, y: e.clientY }
    })
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = -1
    }
    window.addEventListener('pointerup', endLook)
    window.addEventListener('pointercancel', endLook)
  }

  private moveStick(x: number, y: number) {
    let dx = (x - this.stick.cx) / this.stick.r
    let dy = (y - this.stick.cy) / this.stick.r
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    this.stick.x = dx
    this.stick.y = dy
    // pushing the stick right to the rim means sprint, like most mobile shooters
    this.touchSprint = len > 1.15
    this.ui.knob.style.transform = `translate(${dx * this.stick.r}px, ${dy * this.stick.r}px)`
  }

  /** press a virtual key from an on-screen button */
  tap(code: string) {
    this.pressed.add(code)
  }

  /** true once per key press */
  consume(code: string) {
    const had = this.pressed.has(code)
    this.pressed.delete(code)
    return had
  }

  update() {
    if (!this.enabled) {
      this.move.x = this.move.y = 0
      this.sprint = this.jump = this.brake = false
      this.look.x = this.look.y = 0
      return
    }
    const k = this.keys
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    if (Math.abs(this.stick.x) + Math.abs(this.stick.y) > 0.05) {
      x = this.stick.x
      y = -this.stick.y
    }
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    this.move.x = x
    this.move.y = y
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint
    this.jump = this.consume('Space')
    this.brake = k.has('Space')
  }

  readLook() {
    const l = { x: this.look.x, y: this.look.y }
    this.look.x = this.look.y = 0
    return l
  }

  clearPressed() {
    this.pressed.clear()
  }
}
