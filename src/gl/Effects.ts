import * as THREE from 'three'

/* Pooled particles: exhaust and dust puffs, and confetti bursts. */

type Puff = { alive: boolean; p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; grow: number }
type Bit = { alive: boolean; p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number; max: number }

const PUFFS = 64
const BITS = 160

export class Effects {
  readonly group = new THREE.Group()
  private puffMesh: THREE.InstancedMesh
  private bitMesh: THREE.InstancedMesh
  private puffs: Puff[] = []
  private bits: Bit[] = []
  private next = 0
  private nextBit = 0
  private readonly o = new THREE.Object3D()
  private readonly c = new THREE.Color()

  constructor() {
    this.puffMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.85, depthWrite: false }),
      PUFFS,
    )
    this.puffMesh.frustumCulled = false
    this.bitMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.22, 0.12),
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
      BITS,
    )
    this.bitMesh.frustumCulled = false
    for (let i = 0; i < PUFFS; i++) {
      this.puffs.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 1 })
      this.puffMesh.setColorAt(i, this.c.set('#ffffff'))
    }
    for (let i = 0; i < BITS; i++) {
      this.bits.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0, max: 1 })
      this.bitMesh.setColorAt(i, this.c.set('#ffc61a'))
    }
    this.hideAll()
    this.group.add(this.puffMesh, this.bitMesh)
  }

  private hideAll() {
    this.o.scale.setScalar(0)
    this.o.updateMatrix()
    for (let i = 0; i < PUFFS; i++) this.puffMesh.setMatrixAt(i, this.o.matrix)
    for (let i = 0; i < BITS; i++) this.bitMesh.setMatrixAt(i, this.o.matrix)
  }

  puff(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, size = 0.4, life = 0.9, grow = 1.8) {
    const i = this.next
    this.next = (this.next + 1) % PUFFS
    const p = this.puffs[i]
    p.alive = true
    p.p.copy(pos)
    p.v.copy(vel)
    p.life = 0
    p.max = life
    p.size = size
    p.grow = grow
    this.puffMesh.setColorAt(i, this.c.set(color))
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true
  }

  confetti(pos: THREE.Vector3, count = 60, colors = ['#ffc61a', '#ff4d6d', '#4fb3ff', '#3ec97a', '#ffffff', '#b07cff']) {
    for (let k = 0; k < count; k++) {
      const i = this.nextBit
      this.nextBit = (this.nextBit + 1) % BITS
      const b = this.bits[i]
      b.alive = true
      b.p.copy(pos)
      const a = Math.random() * Math.PI * 2
      const s = 2 + Math.random() * 5
      b.v.set(Math.cos(a) * s * 0.6, 5 + Math.random() * 7, Math.sin(a) * s * 0.6)
      b.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      b.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16)
      b.life = 0
      b.max = 2.2 + Math.random() * 1.2
      this.bitMesh.setColorAt(i, this.c.set(colors[k % colors.length]))
    }
    if (this.bitMesh.instanceColor) this.bitMesh.instanceColor.needsUpdate = true
  }

  update(dt: number) {
    const o = this.o
    let anyPuff = false
    for (let i = 0; i < PUFFS; i++) {
      const p = this.puffs[i]
      if (!p.alive) continue
      anyPuff = true
      p.life += dt
      const t = p.life / p.max
      if (t >= 1) {
        p.alive = false
        o.scale.setScalar(0)
      } else {
        p.p.addScaledVector(p.v, dt)
        p.v.multiplyScalar(1 - dt * 2.2)
        p.v.y += dt * 0.6
        o.position.copy(p.p)
        o.rotation.set(t * 2, t * 3, 0)
        const s = p.size * (1 + t * p.grow) * (1 - t * t)
        o.scale.setScalar(Math.max(0.0001, s))
      }
      o.updateMatrix()
      this.puffMesh.setMatrixAt(i, o.matrix)
    }
    if (anyPuff) this.puffMesh.instanceMatrix.needsUpdate = true

    let anyBit = false
    for (let i = 0; i < BITS; i++) {
      const b = this.bits[i]
      if (!b.alive) continue
      anyBit = true
      b.life += dt
      if (b.life >= b.max) {
        b.alive = false
        o.scale.setScalar(0)
      } else {
        b.v.y -= 14 * dt
        b.v.multiplyScalar(1 - dt * 1.4)
        b.p.addScaledVector(b.v, dt)
        if (b.p.y < 0.05) {
          b.p.y = 0.05
          b.v.set(0, 0, 0)
          b.w.multiplyScalar(0.9)
        }
        b.r.x += b.w.x * dt
        b.r.y += b.w.y * dt
        b.r.z += b.w.z * dt
        o.position.copy(b.p)
        o.rotation.copy(b.r)
        const fade = Math.min(1, (b.max - b.life) * 2)
        o.scale.setScalar(fade)
      }
      o.updateMatrix()
      this.bitMesh.setMatrixAt(i, o.matrix)
    }
    if (anyBit) this.bitMesh.instanceMatrix.needsUpdate = true
  }
}
