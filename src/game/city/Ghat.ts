import * as THREE from 'three'
import type { Physics } from '../Physics'
import { Batch, M } from './Batch'
import type { Materials } from './Town'
import { labelTexture } from '../hills/Portal'
import { GHAT } from './Plan'
import { Loop, roundedLoop } from './paths'

/* ──────────────────────────────────────────────────────────────
   THE GHAT
   A broad flight of stone steps down into the Hooghly, a paved
   plaza with a pavilion, two small temples and tea stalls, country
   boats moored at the bottom step, and ferries that circle the river
   all day.
────────────────────────────────────────────────────────────── */

type Ferry = { boat: THREE.Group; loop: Loop; s: number; speed: number }

function boatHull(L: number, B: number, wood: THREE.Material, rim: THREE.Material) {
  const g = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(-L / 2, 0)
  shape.lineTo(-L / 2 + 1, B / 2)
  shape.lineTo(L / 2 - 1, B / 2)
  shape.lineTo(L / 2, 0)
  shape.lineTo(L / 2 - 1, -B / 2)
  shape.lineTo(-L / 2 + 1, -B / 2)
  shape.closePath()
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.75, bevelEnabled: false }).rotateX(-Math.PI / 2), wood)
  hull.position.y = -0.35
  hull.castShadow = true
  g.add(hull)
  for (const s of [-1, 1]) {
    const gun = new THREE.Mesh(new THREE.BoxGeometry(L - 2, 0.12, 0.14), rim)
    gun.position.set(0, 0.42, s * (B / 2 - 0.05))
    g.add(gun)
  }
  for (let x = -L / 2 + 1.6; x < L / 2 - 1; x += 1.5) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, B - 0.3), rim)
    seat.position.set(x, 0.12, 0)
    g.add(seat)
  }
  return g
}

export class Ghat {
  readonly group = new THREE.Group()
  private ferries: Ferry[] = []
  private glow: { mat: THREE.MeshStandardMaterial; day: number; night: number }[] = []
  private tA = new THREE.Vector3()

  constructor(private physics: Physics, private m: Materials) {
    const b = new Batch()
    this.build(b)
    b.build(this.group)
  }

  private build(b: Batch) {
    const { m, physics } = this
    const { z0, z1 } = GHAT
    const zc = (z0 + z1) / 2
    const W = z1 - z0
    const stone = new THREE.MeshStandardMaterial({ color: '#c9bba0', roughness: 0.95 })
    const white = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.9 })
    const saffron = new THREE.MeshStandardMaterial({ color: '#e07b1a', roughness: 0.8 })
    const wood = new THREE.MeshStandardMaterial({ color: '#7a4a28', roughness: 0.9 })
    const blue = new THREE.MeshStandardMaterial({ color: '#2a5d9f', roughness: 0.8 })
    const bulb = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd79a', emissiveIntensity: 0.2 })
    this.glow.push({ mat: bulb, day: 0.2, night: 5 })

    // the plaza and the steps down to the water: 22 steps of 20 cm
    b.box(24, 0.25, W, stone, M(-217, 0, zc), 3)
    physics.fixedBox(-217, -0.02, zc, 12, 0.13, W / 2)
    for (let i = 0; i < 22; i++) {
      const top = 0.12 - (i + 1) * 0.2
      const h = top + 5.4
      const x = -229 - (i + 0.5) * 0.8
      b.box(0.8, h, W, stone, M(x, top - h / 2, zc), 3)
      physics.fixedBox(x, top - h / 2, zc, 0.4, h / 2, W / 2)
    }
    // low walls at both ends of the steps, a sign over the middle
    for (const s of [-1, 1]) {
      const z = zc + s * (W / 2 - 0.4)
      b.box(19, 1.1, 0.8, stone, M(-237.5, -1.8, z), 3)
      physics.fixedBox(-237.5, -1.8, z, 9.5, 0.55, 0.4)
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.8), new THREE.MeshStandardMaterial({ map: labelTexture(['HOOGHLY GHAT', 'Steps to the river'], '#10261d', '#f6efd9', 1024, 256, '#d8b25a'), roughness: 0.6 }))
    sign.position.set(-205.4, 3.2, zc)
    sign.rotation.y = -Math.PI / 2
    this.group.add(sign)
    for (const s of [-1, 1]) {
      b.box(0.3, 3, 0.3, m.frame, M(-205.4, 1.5, zc + s * 6.2), 1)
    }

    // the pavilion: four columns and a dome
    const px = -217
    b.box(8, 0.3, 8, white, M(px, 0.3, zc), 3)
    for (const dx of [-3.4, 3.4]) for (const dz of [-3.4, 3.4]) {
      b.add(new THREE.CylinderGeometry(0.3, 0.36, 4.6, 12), white, M(px + dx, 2.6, zc + dz))
      physics.fixedCylinder(px + dx, 2.4, zc + dz, 0.36, 4.8)
    }
    b.box(8.4, 0.4, 8.4, white, M(px, 5.0, zc), 3)
    b.add(new THREE.SphereGeometry(3.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), saffron, M(px, 5.2, zc))
    b.add(new THREE.ConeGeometry(0.25, 1.6, 8), m.frame, M(px, 9.5, zc))

    // two small temples with stepped spires
    for (const s of [-1, 1]) {
      const tz = zc + s * 30
      b.box(5.6, 0.8, 5.6, stone, M(-212, 0.4, tz), 3)
      b.box(4.2, 4.2, 4.2, white, M(-212, 2.9, tz), 3)
      b.box(4.4, 0.4, 4.4, saffron, M(-212, 4.9, tz), 3)
      b.add(new THREE.ConeGeometry(2.9, 3.6, 4).rotateY(Math.PI / 4), white, M(-212, 7.0, tz))
      b.add(new THREE.ConeGeometry(2.0, 2.8, 4).rotateY(Math.PI / 4), white, M(-212, 9.4, tz))
      b.add(new THREE.ConeGeometry(1.2, 2.2, 4).rotateY(Math.PI / 4), saffron, M(-212, 11.4, tz))
      b.add(new THREE.SphereGeometry(0.4, 10, 8), m.frame, M(-212, 12.7, tz))
      b.box(0.1, 2.4, 0.1, m.frame, M(-212, 13.8, tz))
      physics.fixedBox(-212, 2.4, tz, 2.8, 2.4, 2.8)
      // the doorway faces the river, a bell beside it
      b.box(1.2, 2.2, 0.1, wood, M(-214.15, 1.9, tz, Math.PI / 2), 1)
    }

    // tea stalls under tin roofs
    for (const dz of [-18, 0, 18]) {
      const sz = zc + dz
      b.box(3, 2.4, 2.4, wood, M(-207.5, 1.3, sz), 2)
      b.box(3.8, 0.12, 3.4, m.corrugated, M(-207.5, 2.7, sz), 2)
      b.box(0.6, 0.9, 2.2, blue, M(-209.2, 0.6, sz), 1)
      physics.fixedBox(-207.5, 1.3, sz, 1.5, 1.3, 1.2)
    }
    // lamps along the top of the steps
    for (let k = -3; k <= 3; k++) {
      const lz = zc + k * 11
      b.box(0.14, 3.4, 0.14, m.frame, M(-228.4, 1.7, lz), 1)
      b.add(new THREE.SphereGeometry(0.26, 10, 8), bulb, M(-228.4, 3.5, lz))
      physics.fixedCylinder(-228.4, 1.7, lz, 0.12, 3.4)
    }

    // country boats moored at the foot of the steps
    const water = -1.15
    for (const [k, dz] of [-22, 4, 24].entries()) {
      const boat = boatHull(6.5, 1.9, wood, blue)
      boat.position.set(-248.5 + (k % 2) * 1.2, water, zc + dz)
      boat.rotation.y = Math.PI / 2 + (k - 1) * 0.06
      this.group.add(boat)
    }

    // ferries going round and round the river
    const route = roundedLoop([[-293, 110], [-250, 110], [-250, 300], [-293, 300]], 16, 3).map((p) => p.setY(water))
    const loop = new Loop(route)
    for (const [i, kind] of (['ferry', 'boat', 'ferry', 'boat'] as const).entries()) {
      const big = kind === 'ferry'
      const boat = boatHull(big ? 11 : 6.5, big ? 3 : 1.9, wood, big ? blue : saffron)
      if (big) {
        for (const dx of [-3.6, 0, 3.6]) for (const dz of [-1.3, 1.3]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), wood)
          post.position.set(dx, 1.3, dz)
          boat.add(post)
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.12, 3.6), new THREE.MeshStandardMaterial({ color: '#2a5d9f', roughness: 0.8 }))
        roof.position.y = 2.4
        boat.add(roof)
        for (const dx of [-3.6, 3.6]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bulb)
          lamp.position.set(dx, 2.2, 0)
          boat.add(lamp)
        }
      }
      this.group.add(boat)
      this.ferries.push({ boat, loop, s: (i / 4) * loop.length, speed: big ? 2.6 : 3.4 })
    }
  }

  update(dt: number, night: number) {
    for (const f of this.ferries) {
      f.s += f.speed * dt
      const a = f.loop.sample(f.s - 2, this.tA)
      const ax = a.p.x
      const az = a.p.z
      const c = f.loop.sample(f.s + 2, this.tA).p
      f.boat.position.set((ax + c.x) / 2, c.y + Math.sin(f.s * 0.6) * 0.03, (az + c.z) / 2)
      f.boat.rotation.y = Math.atan2(-(c.z - az), c.x - ax)
      f.boat.rotation.z = Math.sin(f.s * 0.45) * 0.012
    }
    for (const g of this.glow) g.mat.emissiveIntensity = night > 0.3 ? g.night * night : g.day
  }
}
