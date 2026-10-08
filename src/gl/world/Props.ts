import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Physics } from '../Physics'
import { GROUP } from '../Physics'
import { ANCHORS } from './Layout'
import { nearStop, PITCH, RAMP } from './Zones'
import { canvas, toTexture, FONT } from '../textures'

/* ──────────────────────────────────────────────────────────────
   PROPS
   Things with mass that the taxi can bowl over: the letters of
   Akash's name, a wall of Bengal bricks, pizza boxes, gift boxes,
   traffic cones, cricket stumps and a giant ball. Plus the ramp.
────────────────────────────────────────────────────────────── */

type Dyn = { body: CANNON.Body; mesh: THREE.Object3D; home: { p: CANNON.Vec3; q: CANNON.Quaternion } }

/* ── letter outlines (units: letter height 2.4) ─────────────── */

function polyShape(pts: [number, number][], holes: [number, number][][] = []) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
  return s
}

function letterS() {
  const w = 0.58
  const r = 0.455
  const pts: { p: THREE.Vector2; n: THREE.Vector2 }[] = []
  const N = 26
  for (let i = 0; i <= N; i++) {
    const th = THREE.MathUtils.degToRad(25 + (245 * i) / N)
    const t = new THREE.Vector2(-Math.sin(th), Math.cos(th))
    pts.push({ p: new THREE.Vector2(r * Math.cos(th), 1.655 + r * Math.sin(th)), n: new THREE.Vector2(-t.y, t.x) })
  }
  for (let i = 1; i <= N; i++) {
    const th = THREE.MathUtils.degToRad(90 - (245 * i) / N)
    const t = new THREE.Vector2(Math.sin(th), -Math.cos(th))
    pts.push({ p: new THREE.Vector2(r * Math.cos(th), 0.745 + r * Math.sin(th)), n: new THREE.Vector2(-t.y, t.x) })
  }
  const left = pts.map(({ p, n }) => p.clone().addScaledVector(n, w / 2))
  const right = pts.map(({ p, n }) => p.clone().addScaledVector(n, -w / 2)).reverse()
  return new THREE.Shape([...left, ...right])
}

const LETTERS: Record<string, { shape: () => THREE.Shape; w: number }> = {
  A: {
    w: 2.2,
    shape: () => polyShape(
      [[-1.1, 0], [-0.48, 0], [-0.33, 0.52], [0.33, 0.52], [0.48, 0], [1.1, 0], [0.4, 2.4], [-0.4, 2.4]],
      [[[-0.18, 1.1], [0.18, 1.1], [0, 1.72]]],
    ),
  },
  K: {
    w: 2.06,
    shape: () => polyShape([[-0.95, 0], [-0.33, 0], [-0.33, 0.75], [0.36, 0], [1.1, 0], [0.25, 1.25], [1.05, 2.4], [0.33, 2.4], [-0.33, 1.55], [-0.33, 2.4], [-0.95, 2.4]]),
  },
  S: { w: 1.49, shape: letterS },
  H: {
    w: 1.9,
    shape: () => polyShape([[-0.95, 0], [-0.33, 0], [-0.33, 0.92], [0.33, 0.92], [0.33, 0], [0.95, 0], [0.95, 2.4], [0.33, 2.4], [0.33, 1.5], [-0.33, 1.5], [-0.33, 2.4], [-0.95, 2.4]]),
  },
}

function letterGeometry(ch: string) {
  const geo = new THREE.ExtrudeGeometry(LETTERS[ch].shape(), {
    depth: 0.8,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 4,
  })
  // centre: x already centred, y from 0, z centred; lift by the bevel
  geo.translate(0, 0.06 - 1.26, -0.4)
  geo.computeVertexNormals()
  return geo
}

/* ── textures ───────────────────────────────────────────────── */

function brickTexture() {
  const { c, g } = canvas(128, 64)
  g.fillStyle = '#a8442c'
  g.fillRect(0, 0, 128, 64)
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${90 + Math.random() * 60},${30 + Math.random() * 20},${20},${0.25})`
    g.fillRect(Math.random() * 128, Math.random() * 64, 3, 2)
  }
  g.fillStyle = 'rgba(0,0,0,0.12)'
  g.fillRect(0, 60, 128, 4)
  return toTexture(c)
}

function pizzaBoxTexture() {
  const { c, g } = canvas(256, 256)
  g.fillStyle = '#f4ead8'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#e2531f'
  g.lineWidth = 10
  g.strokeRect(14, 14, 228, 228)
  g.fillStyle = '#e2531f'
  g.font = `800 44px ${FONT.display}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('PIZZA', 128, 104)
  g.fillText('HAP', 128, 150)
  g.font = `600 16px ${FONT.mono}`
  g.fillStyle = '#2b1a12'
  g.fillText('CRAFTED FIRE', 128, 196)
  return toTexture(c)
}

function cricketBallTexture() {
  const { c, g } = canvas(256, 128)
  g.fillStyle = '#b3141f'
  g.fillRect(0, 0, 256, 128)
  g.strokeStyle = '#f4f0e6'
  g.lineWidth = 3
  for (const y of [58, 70]) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(256, y)
    g.stroke()
  }
  g.setLineDash([4, 5])
  for (const y of [52, 76]) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(256, y)
    g.stroke()
  }
  return toTexture(c)
}

function hazardTexture() {
  const { c, g } = canvas(256, 256)
  g.fillStyle = '#ffc61a'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#17151b'
  for (let i = -256; i < 512; i += 64) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 32, 0)
    g.lineTo(i + 32 + 256, 256)
    g.lineTo(i + 256, 256)
    g.closePath()
    g.fill()
  }
  const t = toTexture(c, { repeat: true })
  t.repeat.set(2, 2)
  return t
}

export class Props {
  readonly group = new THREE.Group()
  readonly dynamics: Dyn[] = []
  readonly letters: Dyn[] = []
  readonly stumps: Dyn[] = []

  constructor(private physics: Physics) {
    this.buildLetters()
    this.buildBricks()
    this.buildPizzaBoxes()
    this.buildGifts()
    this.buildCones()
    this.buildCricket()
    this.buildRamp()
  }

  private add(mesh: THREE.Object3D, shape: CANNON.Shape, mass: number, pos: THREE.Vector3, yaw: number, offset?: CANNON.Vec3) {
    const body = new CANNON.Body({
      mass,
      material: this.physics.propMaterial,
      collisionFilterGroup: GROUP.PROP,
      sleepSpeedLimit: 0.25,
      sleepTimeLimit: 0.6,
      linearDamping: 0.08,
      angularDamping: 0.12,
    })
    body.addShape(shape, offset)
    body.position.set(pos.x, pos.y, pos.z)
    body.quaternion.setFromEuler(0, yaw, 0)
    body.allowSleep = true
    this.physics.world.addBody(body)
    body.sleep()
    mesh.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    this.group.add(mesh)
    this.physics.link(body, mesh)
    mesh.position.copy(pos)
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
    const d: Dyn = { body, mesh, home: { p: body.position.clone(), q: body.quaternion.clone() } }
    this.dynamics.push(d)
    return d
  }

  /** put every prop back where it started */
  reset() {
    for (const d of this.dynamics) {
      d.body.position.copy(d.home.p)
      d.body.quaternion.copy(d.home.q)
      d.body.velocity.set(0, 0, 0)
      d.body.angularVelocity.set(0, 0, 0)
      d.body.sleep()
    }
    this.physics.syncAll()
  }

  /** how many of a set have been knocked over (tilted more than ~50°) */
  toppled(set: Dyn[]) {
    let n = 0
    const up = new CANNON.Vec3()
    for (const d of set) {
      d.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0), up)
      if (up.y < 0.64) n++
    }
    return n
  }

  private buildLetters() {
    const a = ANCHORS.find((s) => s.id === 'boarding')!
    const word = 'AKASH'
    const colors = ['#ffc61a', '#ff6b4a', '#4fb3ff', '#3ec97a', '#fff4dc']
    const gap = 0.42
    const total = word.split('').reduce((s, ch) => s + LETTERS[ch].w, 0) + gap * (word.length - 1)
    // letters stand in a row facing the road; local +x runs along the row
    const toRoad = a.right.clone().multiplyScalar(-a.place.side)
    const along = new THREE.Vector3(toRoad.z, 0, -toRoad.x)
    const yaw = Math.atan2(toRoad.x, toRoad.z)
    let x = -total / 2
    word.split('').forEach((ch, i) => {
      const w = LETTERS[ch].w
      const cx = x + w / 2
      x += w + gap
      const geo = letterGeometry(ch)
      const mat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.45, metalness: 0.02 })
      const mesh = new THREE.Mesh(geo, mat)
      // slight fan so the word reads like a little arc
      const arc = -(cx / total) * 0.35
      const pos = a.landmark.clone().addScaledVector(along, cx).addScaledVector(toRoad, Math.abs(cx) * 0.18)
      pos.y = 1.26
      const d = this.add(mesh, new CANNON.Box(new CANNON.Vec3(w / 2 + 0.04, 1.26, 0.47)), 3.2, pos, yaw + arc)
      this.letters.push(d)
    })
  }

  private buildBricks() {
    const a = ANCHORS.find((s) => s.id === 'egra')!
    const base = nearStop('egra', -9, -7.5)
    const yaw = Math.atan2(a.tan.x, a.tan.z) + Math.PI / 2
    const along = a.tan.clone()
    const geo = new RoundedBoxGeometry(0.9, 0.42, 0.44, 2, 0.04)
    const mat = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.9 })
    for (let row = 0; row < 4; row++) {
      const n = row % 2 ? 3 : 4
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.94
        const pos = new THREE.Vector3(base.x, 0.21 + row * 0.43, base.z).addScaledVector(along, off)
        this.add(new THREE.Mesh(geo, mat), new CANNON.Box(new CANNON.Vec3(0.45, 0.21, 0.22)), 0.7, pos, yaw)
      }
    }
  }

  private buildPizzaBoxes() {
    const geo = new THREE.BoxGeometry(0.92, 0.14, 0.92)
    const top = new THREE.MeshStandardMaterial({ map: pizzaBoxTexture(), roughness: 0.8 })
    const side = new THREE.MeshStandardMaterial({ color: '#efe3cc', roughness: 0.9 })
    const mats = [side, side, top, side, side, side]
    for (const [along, lat] of [[7, 6.2], [8.4, 7.4]]) {
      const p = nearStop('pizzahap', along, lat)
      for (let k = 0; k < 5; k++) {
        const pos = new THREE.Vector3(p.x, 0.07 + k * 0.145, p.z)
        this.add(new THREE.Mesh(geo, mats), new CANNON.Box(new CANNON.Vec3(0.46, 0.07, 0.46)), 0.35, pos, (k * 0.13) % 0.5)
      }
    }
  }

  private buildGifts() {
    const p = nearStop('gftd', -7, 6.5)
    const a = ANCHORS.find((s) => s.id === 'gftd')!
    const along = a.tan.clone()
    const palette: [string, string][] = [
      ['#1d2a6b', '#e3b23c'], ['#8a1c3a', '#f3d27a'], ['#e3b23c', '#1d2a6b'], ['#0f6e6a', '#f6e7c1'], ['#f4f0e6', '#c8263c'],
    ]
    const layout: [number, number, number][] = [
      [-1.4, 0, 1.0], [0, 0, 1.2], [1.4, 0, 0.9], [-0.7, 1, 0.85], [0.7, 1, 0.95], [0, 2, 0.75],
    ]
    let y0 = [0, 0, 0]
    layout.forEach(([x, row, s], i) => {
      const [boxC, ribC] = palette[i % palette.length]
      const geo = giftGeometry(s, boxC, ribC)
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }))
      const yBase = row === 0 ? 0 : row === 1 ? 1.15 : 2.2
      y0 = y0.map((v) => v)
      const pos = new THREE.Vector3(p.x, yBase + s / 2, p.z).addScaledVector(along, x)
      this.add(mesh, new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), 0.8 * s, pos, i * 0.3)
    })
  }

  private buildCones() {
    const geo = coneGeometry()
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
    for (let i = 0; i < 6; i++) {
      const p = nearStop('agile', -9 + i * 2.4, 4.7)
      this.add(new THREE.Mesh(geo, mat), new CANNON.Cylinder(0.1, 0.34, 0.84, 10), 0.5, new THREE.Vector3(p.x, 0.42, p.z), 0, new CANNON.Vec3(0, 0, 0))
    }
  }

  private buildCricket() {
    const sx = PITCH.x + PITCH.l / 2 - 1.2
    const wood = new THREE.MeshStandardMaterial({ color: '#f1e4c3', roughness: 0.6 })
    const stumpGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.3, 10)
    for (const dz of [-0.26, 0, 0.26]) {
      const d = this.add(new THREE.Mesh(stumpGeo, wood), new CANNON.Cylinder(0.07, 0.07, 1.3, 8), 0.25, new THREE.Vector3(sx, 0.65, PITCH.z + dz), 0)
      this.stumps.push(d)
    }
    const bailGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8).rotateX(Math.PI / 2)
    for (const dz of [-0.13, 0.13]) {
      this.add(new THREE.Mesh(bailGeo, wood), new CANNON.Box(new CANNON.Vec3(0.035, 0.035, 0.14)), 0.05, new THREE.Vector3(sx, 1.34, PITCH.z + dz), 0)
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 28, 18), new THREE.MeshStandardMaterial({ map: cricketBallTexture(), roughness: 0.35 }))
    const d = this.add(ball, new CANNON.Sphere(0.55), 2.2, new THREE.Vector3(PITCH.x - PITCH.l / 2 + 2, 0.55, PITCH.z), 0)
    d.body.linearDamping = 0.25
    d.body.angularDamping = 0.25
  }

  private buildRamp() {
    const L = 7.2
    const W = 5
    const H = 2.1
    const v: [number, number, number][] = [
      [-W / 2, 0, L / 2], [W / 2, 0, L / 2], [-W / 2, 0, -L / 2], [W / 2, 0, -L / 2], [-W / 2, H, -L / 2], [W / 2, H, -L / 2],
    ]
    const faces = [[0, 2, 3, 1], [0, 1, 5, 4], [2, 4, 5, 3], [0, 4, 2], [1, 3, 5]]
    const shape = new CANNON.ConvexPolyhedron({ vertices: v.map(([x, y, z]) => new CANNON.Vec3(x, y, z)), faces })
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.physics.groundMaterial, collisionFilterGroup: GROUP.STATIC })
    body.addShape(shape)
    body.position.set(RAMP.x, 0, RAMP.z)
    this.physics.world.addBody(body)

    // visual: slope with hazard stripes, painted sides
    const geo = new THREE.BufferGeometry()
    const P = (i: number) => v[i]
    const tri: number[] = []
    const uv: number[] = []
    const quad = (a: number, b: number, c: number, d: number, uvs = [0, 0, 1, 0, 1, 1, 0, 1]) => {
      for (const [i, k] of [[a, 0], [b, 1], [c, 2], [a, 0], [c, 2], [d, 3]] as const) {
        tri.push(...P(i))
        uv.push(uvs[k * 2], uvs[k * 2 + 1])
      }
    }
    const triangle = (a: number, b: number, c: number) => {
      for (const i of [a, b, c]) {
        tri.push(...P(i))
        uv.push(0, 0)
      }
    }
    quad(0, 1, 5, 4)
    quad(2, 4, 5, 3, [0, 0, 0, 0, 0, 0, 0, 0])
    triangle(0, 4, 2)
    triangle(1, 3, 5)
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.computeVertexNormals()
    geo.addGroup(0, 6, 0)
    geo.addGroup(6, tri.length / 3 - 6, 1)
    const ramp = new THREE.Mesh(geo, [
      new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#3a3842', roughness: 0.8 }),
    ])
    ramp.position.set(RAMP.x, 0, RAMP.z)
    ramp.castShadow = true
    ramp.receiveShadow = true
    this.group.add(ramp)
  }
}

function giftGeometry(s: number, box: string, ribbon: string) {
  const color = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.deleteAttribute('uv')
    return g.index ? g.toNonIndexed() : g
  }
  const parts = [
    color(new RoundedBoxGeometry(s, s, s, 2, s * 0.04), box),
    color(new THREE.BoxGeometry(s * 1.02, s * 1.02, s * 0.16), ribbon),
    color(new THREE.BoxGeometry(s * 0.16, s * 1.02, s * 1.02), ribbon),
    color(new THREE.TorusGeometry(s * 0.14, s * 0.045, 6, 14).rotateY(0.6).translate(-s * 0.12, s * 0.56, 0), ribbon),
    color(new THREE.TorusGeometry(s * 0.14, s * 0.045, 6, 14).rotateY(-0.6).translate(s * 0.12, s * 0.56, 0), ribbon),
  ]
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

function coneGeometry() {
  const color = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.deleteAttribute('uv')
    return g.index ? g.toNonIndexed() : g
  }
  const parts = [
    color(new THREE.BoxGeometry(0.72, 0.06, 0.72).translate(0, -0.39, 0), '#2a2830'),
    color(new THREE.CylinderGeometry(0.1, 0.3, 0.78, 14, 1, true).translate(0, 0.0, 0), '#ff6a1a'),
    color(new THREE.CylinderGeometry(0.17, 0.215, 0.16, 14, 1, true).translate(0, 0.04, 0).scale(1.02, 1, 1.02), '#f6f3ea'),
  ]
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}
