import * as THREE from 'three'
import { RAPIER, type Physics } from '../Physics'
import type { Player } from '../Player'
import { outfit } from './Pedestrians'
import { PLOTS, plotToWorld, plotFrame } from './Plan'
import { Loop, roundedLoop, offsetLoop } from './paths'

/* ──────────────────────────────────────────────────────────────
   THE CREW
   Named people the player knows: Suprime (CEO) and Subhodeep (CTO)
   at GOBT, Harshit and Yuvraj at Xeta Labs, Panda who lives at home
   and rides a scooty round the city, and Souvik who walks with you
   wherever you go. Each has a name tag and says hello when you
   walk up. None of them has a collider, so nobody blocks a door.
────────────────────────────────────────────────────────────── */

type Look = Parameters<typeof outfit>[1]

type Person = {
  name: string
  role: string
  hello: string
  root: THREE.Group
  limbs: THREE.Mesh[]
  tag: THREE.Sprite
  greeted: number
  phase: number
  region: 'city' | 'any'
}

const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })

function nameTag(name: string, role: string) {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 128
  const g = cv.getContext('2d')!
  g.fillStyle = 'rgba(14,16,20,0.82)'
  g.beginPath()
  g.roundRect(8, 16, 496, 96, 48)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = '600 44px sans-serif'
  g.textAlign = 'center'
  g.fillText(name, 256, 66)
  g.fillStyle = '#ffc61a'
  g.font = '500 26px sans-serif'
  g.fillText(role, 256, 98)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }))
  s.scale.set(1.7, 0.42, 1)
  s.position.y = 2.15
  s.renderOrder = 2
  return s
}

function person(name: string, role: string, hello: string, style: number, look: Look, region: Person['region'] = 'city'): Person {
  const root = new THREE.Group()
  const parts = outfit(style, look)
  const limbs = parts.map((g, i) => {
    const m = new THREE.Mesh(g, cloth)
    m.castShadow = true
    if (i > 0) {
      const arm = i > 2
      m.position.set((i % 2 ? -1 : 1) * (arm ? 0.204 : 0.09), arm ? 1.38 : 0.835, 0)
    }
    root.add(m)
    return m
  })
  const tag = nameTag(name, role)
  root.add(tag)
  return { name, role, hello, root, limbs, tag, greeted: -1e9, phase: Math.random() * 10, region }
}

/** a small two-wheeler: floorboard, apron, seat, handlebar, two wheels and a lamp */
function scooty() {
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: '#7fc9b7', roughness: 0.35, metalness: 0.3 })
  const black = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.7 })
  const chrome = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.25, metalness: 0.9 })
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    b.position.set(x, y, z)
    b.rotation.x = rx
    b.castShadow = true
    g.add(b)
  }
  box(0.34, 0.08, 0.7, black, 0, 0.32, 0.05)
  box(0.4, 0.42, 0.62, paint, 0, 0.55, -0.42)
  box(0.32, 0.1, 0.62, black, 0, 0.8, -0.38)
  box(0.36, 0.7, 0.12, paint, 0, 0.7, 0.46, -0.25)
  box(0.08, 0.5, 0.08, chrome, 0, 1.0, 0.56, -0.25)
  box(0.62, 0.05, 0.05, chrome, 0, 1.24, 0.62)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4d0', emissiveIntensity: 1.5 }))
  lamp.position.set(0, 1.12, 0.68)
  g.add(lamp)
  for (const z of [0.58, -0.62]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.07, 8, 16).rotateY(Math.PI / 2), black)
    w.position.set(0, 0.26, z)
    g.add(w)
  }
  return g
}

export class Characters {
  readonly group = new THREE.Group()
  /** called when the player walks up to someone */
  onGreet?: (icon: string, text: string) => void
  private people: Person[] = []
  private souvik: Person
  private panda: Person
  private ride: THREE.Group
  private rideBody: RAPIER.RigidBody
  private route: Loop
  private rideS = 0
  private rideV = 0
  private rideWait = 0
  private homeS: number
  private lastPlayer = new THREE.Vector3()
  private heading = new THREE.Vector3(0, 0, 1)
  private wasDriving = false
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  constructor(private physics: Physics) {
    const at = (id: string, lx: number, lz: number, yaw: number, y: number, p: Person) => {
      const plot = PLOTS.find((q) => q.id === id)!
      const w = plotToWorld(plot, lx, lz)
      p.root.position.set(w.x, y, w.z)
      p.root.rotation.y = plotFrame(plot).yaw + yaw
      p.root.userData.yaw = p.root.rotation.y
      this.add(p)
    }
    at('gobt', -2.5, -20.6, 0, 0.3, person('Suprime', 'CEO · GOBT', 'Suprime: Welcome to GOBT HQ. Take a look around — the team is upstairs.', 1, { kind: 'plain', top: '#1d2a44', pants: '#2b2d33', skin: '#a96d4e', hair: '#1c1a19' }))
    at('gobt', 0.6, -13.8, Math.PI / 2, 0.3, person('Subhodeep', 'CTO · GOBT', 'Subhodeep: Hey! Deploys are green today. Want the tour of the stack?', 4, { kind: 'plain', top: '#202226', pants: '#2f4b6e', skin: '#9c674c', hair: '#201d1c' }))
    at('xeta', -4.3, -12.4, -Math.PI / 2 - 0.2, 0.3, person('Harshit', 'Xeta Labs', 'Harshit: Yo! Pull up a chair — we are shipping a release.', 3, { kind: 'plain', top: '#1f8f7a', pants: '#283447', skin: '#b88059', hair: '#282322' }))
    at('xeta', 3.5, -20, Math.PI + 0.4, 0.3, person('Yuvraj', 'Xeta Labs', 'Yuvraj: Hi! Check the dashboard wall — numbers are up this week.', 5, { kind: 'plain', top: '#e8e6df', pants: '#1f2a44', skin: '#cd946e', hair: '#3f3029' }))

    this.souvik = person('Souvik', 'with you', 'Souvik: I’m right behind you. Lead the way.', 2, { kind: 'plain', top: '#a8322d', pants: '#b9a27a', skin: '#a96d4e', hair: '#201d1c' }, 'any')
    this.add(this.souvik)

    // Panda: home is the compound on the street at z = 100; the scooty does laps of the inner blocks, keeping left
    this.panda = person('Panda', 'lives at home', 'Panda: Oi! Hop on later — I know every shortcut in this city.', 0, { kind: 'plain', top: '#6a6f78', pants: '#1c1e22', skin: '#b88059', hair: '#201d1c' })
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: '#c1272d', roughness: 0.3, metalness: 0.2 }))
    helmet.position.set(0, 1.62, -0.01)
    this.panda.root.add(helmet)
    // seated: thighs forward, hands on the bars
    this.panda.limbs[1].rotation.x = this.panda.limbs[2].rotation.x = -1.35
    this.panda.limbs[3].rotation.x = this.panda.limbs[4].rotation.x = -1.05
    this.ride = scooty()
    this.panda.root.position.set(0, 0.0, -0.3)
    this.panda.root.rotation.y = 0
    this.ride.add(this.panda.root)
    this.people.push(this.panda)
    this.group.add(this.ride)
    const lane = offsetLoop(roundedLoop([[-100, -100], [200, -100], [200, 100], [-100, 100]], 9, 2), -2.6)
    this.route = new Loop(lane)
    this.homeS = this.route.nearestS(-50, 102)
    this.rideS = this.homeS + 1
    this.rideWait = 4
    this.rideBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.7, 0.85).setTranslation(0, 0.7, 0), this.rideBody)
  }

  private add(p: Person) {
    this.people.push(p)
    this.group.add(p.root)
  }

  private groundBelow(x: number, z: number, near: number) {
    this.ray.origin = { x, y: near + 1.6, z }
    const hit = this.physics.world.castRay(this.ray, 4, true, RAPIER.QueryFilterFlags.ONLY_FIXED)
    if (!hit) return near
    const y = near + 1.6 - hit.timeOfImpact
    return y > near + 0.6 ? near : y
  }

  private animate(p: Person, t: number, moving: number) {
    const stride = moving > 0.2 ? Math.sin((t + p.phase) * 6.3) * 0.37 * Math.min(1, moving / 2) : 0
    const breathe = Math.sin((t + p.phase) * 1.7)
    for (let i = 1; i <= 4; i++) {
      const arm = i > 2
      const side = i % 2 ? -1 : 1
      p.limbs[i].rotation.x = (arm ? -1 : 1) * side * stride + (arm ? -0.09 + (moving ? 0 : breathe * 0.04 * side) : 0)
    }
    p.limbs[0].scale.y = 1 + breathe * 0.006
  }

  update(dt: number, t: number, player: Player, region: 'city' | 'hills', traffic: THREE.Vector3[]) {
    const pp = player.position
    const driving = !!player.vehicle
    // the crew at their desks: turn to face you when you come close, say hello once in a while
    for (const p of this.people) {
      if (p === this.souvik || p === this.panda) continue
      p.root.visible = region === 'city'
      if (!p.root.visible) continue
      const d = p.root.position.distanceTo(pp)
      if (d < 6) {
        const want = Math.atan2(pp.x - p.root.position.x, pp.z - p.root.position.z)
        const da = Math.atan2(Math.sin(want - p.root.rotation.y), Math.cos(want - p.root.rotation.y))
        p.root.rotation.y += da * Math.min(1, dt * 3)
      } else {
        const da = Math.atan2(Math.sin(p.root.userData.yaw - p.root.rotation.y), Math.cos(p.root.userData.yaw - p.root.rotation.y))
        p.root.rotation.y += da * Math.min(1, dt * 1.5)
      }
      this.animate(p, t, 0)
      this.greet(p, d, t)
    }

    // Souvik: walks a step behind and to your right; waits by the car while you drive and is beside you when you get out
    const s = this.souvik.root
    if (driving) {
      s.visible = false
      this.wasDriving = true
    } else {
      s.visible = true
      const step = this.tmp.subVectors(pp, this.lastPlayer).setY(0)
      if (step.lengthSq() > 1e-4 && step.length() < 3) this.heading.lerp(step.normalize(), Math.min(1, dt * 4)).normalize()
      const right = this.tmp2.set(-this.heading.z, 0, this.heading.x)
      const target = right.multiplyScalar(1.1).addScaledVector(this.heading, -1.3).add(pp)
      const d = Math.hypot(target.x - s.position.x, target.z - s.position.z)
      let moving = 0
      if (this.wasDriving || d > 28 || Math.abs(s.position.y - pp.y) > 6) {
        s.position.copy(target).setY(pp.y)
        this.wasDriving = false
      } else if (d > 0.25) {
        const speed = Math.min(d * 2.2, 7.5)
        const k = Math.min(1, (speed * dt) / d)
        s.position.x += (target.x - s.position.x) * k
        s.position.z += (target.z - s.position.z) * k
        moving = speed
        const want = Math.atan2(target.x - s.position.x, target.z - s.position.z)
        s.rotation.y += Math.atan2(Math.sin(want - s.rotation.y), Math.cos(want - s.rotation.y)) * Math.min(1, dt * 8)
      } else {
        const want = Math.atan2(this.heading.x, this.heading.z)
        s.rotation.y += Math.atan2(Math.sin(want - s.rotation.y), Math.cos(want - s.rotation.y)) * Math.min(1, dt * 3)
      }
      const gy = this.groundBelow(s.position.x, s.position.z, pp.y)
      s.position.y += (gy - s.position.y) * Math.min(1, dt * 10)
      this.animate(this.souvik, t, moving)
      if (t > 8) this.greet(this.souvik, s.position.distanceTo(pp), t, 240)
    }
    this.lastPlayer.copy(pp)

    // Panda on the scooty: keeps left, stops for anything ahead, pauses at the home gate every lap
    this.ride.visible = region === 'city'
    if (region === 'city') {
      const L = this.route.length
      const here = this.route.sample(this.rideS, this.tmp).p.clone()
      const ahead = this.route.sample(this.rideS + 3, this.tmp2).p
      const fwd = this.tmp2.copy(ahead).sub(here).normalize()
      let block = false
      for (const o of [pp, ...traffic]) {
        const rx = o.x - here.x
        const rz = o.z - here.z
        const along = rx * fwd.x + rz * fwd.z
        if (Math.abs(o.y - here.y) < 3 && along > 0.8 && along < 9 && Math.abs(rx * fwd.z - rz * fwd.x) < 1.8) block = true
      }
      let target = block ? 0 : 9
      if (this.rideWait > 0) {
        this.rideWait -= dt
        target = 0
      } else {
        const toHome = (((this.homeS - this.rideS) % L) + L) % L
        if (toHome < 25) target = Math.min(target, Math.max(1.2, toHome * 0.4))
        if (toHome < 0.6 && this.rideV < 2) {
          this.rideWait = 7
          this.rideS = this.homeS + 0.7
        }
      }
      this.rideV += (target - this.rideV) * Math.min(1, dt * (target < this.rideV ? 4 : 1.2))
      this.rideS = (this.rideS + this.rideV * dt) % L
      const p = this.route.sample(this.rideS, this.tmp).p
      const q = this.route.sample(this.rideS + 1.5, this.tmp2).p
      const yaw = Math.atan2(q.x - p.x, q.z - p.z)
      this.ride.position.set(p.x, 0.02, p.z)
      // a little lean into the bends
      const q2 = this.route.sample(this.rideS + 5, new THREE.Vector3()).p
      const turn = Math.atan2(Math.sin(Math.atan2(q2.x - q.x, q2.z - q.z) - yaw), Math.cos(Math.atan2(q2.x - q.x, q2.z - q.z) - yaw))
      this.ride.rotation.set(0, yaw, -turn * Math.min(1, this.rideV / 6) * 0.6, 'YXZ')
      this.rideBody.setNextKinematicTranslation({ x: p.x, y: 0, z: p.z })
      this.rideBody.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)))
      this.greet(this.panda, this.ride.position.distanceTo(pp), t)
    }
    for (const p of this.people) p.tag.visible = p.root.getWorldPosition(this.tmp).distanceTo(pp) < 16
  }

  private greet(p: Person, d: number, t: number, every = 45) {
    if (d < 3.2 && t - p.greeted > every) {
      p.greeted = t
      this.onGreet?.('👋', p.hello)
    }
  }
}
