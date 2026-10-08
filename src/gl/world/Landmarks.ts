import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Physics } from '../Physics'
import { ANCHORS, ROAD_WIDTH, type StopAnchor } from './Layout'
import { billboardSpot } from './Zones'
import { STOPS, PROJECTS } from '../../content'
import { signTexture, canvas, toTexture, FONT, glowTexture } from '../textures'
import { Bridge } from './Bridge'
import { City } from './City'

/* ──────────────────────────────────────────────────────────────
   LANDMARKS
   One set piece per stop, a roadside milestone at every stop, and
   a hoarding showing each project's real website. Each landmark is
   built in its own local frame: +Z faces the road, the road centre
   is at z = offset.
────────────────────────────────────────────────────────────── */

type Updater = (dt: number, t: number, night: number, near: number) => void

type Ctx = {
  a: StopAnchor
  g: THREE.Group
  physics: Physics
  textures: Map<string, THREE.Texture>
  env: THREE.Texture | null
  /** register a per-frame animation */
  on: (fn: Updater) => void
}

const mats = new Map<string, THREE.MeshStandardMaterial>()
function M(color: string, rough = 0.7, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`
  let m = mats.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra })
    mats.set(key, m)
  }
  return m
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = shadow
  m.receiveShadow = true
  parent.add(m)
  return m
}
const box = (p: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z)
const rbox = (p: THREE.Object3D, w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) => mesh(p, new RoundedBoxGeometry(w, h, d, 2, r), mat, x, y, z)
const cyl = (p: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => mesh(p, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z)

function plane(p: THREE.Object3D, w: number, h: number, tex: THREE.Texture, x = 0, y = 0, z = 0, emissive = 0.0) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: emissive ? tex : null, emissiveIntensity: emissive, transparent: false })
  const m = mesh(p, new THREE.PlaneGeometry(w, h), mat, x, y, z, false)
  return m
}

/** a painted sign on two posts */
function signboard(p: THREE.Object3D, lines: Parameters<typeof signTexture>[3], bg: string, w: number, h: number, x: number, z: number, lift = 1.3, yaw = 0, border?: string) {
  const grp = new THREE.Group()
  grp.position.set(x, 0, z)
  grp.rotation.y = yaw
  p.add(grp)
  const px = 256
  const tex = signTexture(Math.round(px * w), Math.round(px * h), bg, lines.map((l) => ({ ...l, size: l.size * (px / 100) })), { border, borderWidth: 10 })
  plane(grp, w, h, tex, 0, lift + h / 2, 0.06, 0.15)
  box(grp, w + 0.1, h + 0.1, 0.1, M('#2b2830'), 0, lift + h / 2, 0)
  for (const sx of [-1, 1]) box(grp, 0.12, lift + h * 0.6, 0.12, M('#2b2830'), sx * (w / 2 - 0.25), (lift + h * 0.6) / 2, -0.02)
  return grp
}

/* ── milestone: the white-and-yellow roadside stone ─────────── */

function milestoneTexture(no: string, name: string) {
  const { c, g } = canvas(256, 384)
  g.fillStyle = '#f7f4ec'
  g.fillRect(0, 0, 256, 384)
  g.fillStyle = '#ffc61a'
  g.fillRect(0, 0, 256, 150)
  g.fillStyle = '#141218'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `700 30px ${FONT.mono}`
  g.fillText(no === 'END' ? 'LAST' : 'STOP', 128, 76)
  g.font = `800 112px ${FONT.display}`
  g.fillText(no === 'END' ? '★' : no, 128, 236)
  g.font = `700 30px ${FONT.display}`
  const words = name.length > 13 ? name.split(' ') : [name]
  if (words.length > 1 && name.length > 13) {
    const mid = Math.ceil(words.length / 2)
    g.fillText(words.slice(0, mid).join(' '), 128, 312, 236)
    g.fillText(words.slice(mid).join(' '), 128, 346, 236)
  } else g.fillText(name, 128, 324, 236)
  return toTexture(c, { aniso: 8 })
}

function milestone(scene: THREE.Group, physics: Physics, a: StopAnchor) {
  const grp = new THREE.Group()
  const side = a.place.side
  // just before the stop, on the far side of the road from the landmark when the landmark is on the right
  const lat = (ROAD_WIDTH / 2 + 1.1) * (a.id === 'howrah' ? -side : side)
  const pos = a.pos.clone().addScaledVector(a.tan, -5.5).addScaledVector(a.right, lat)
  grp.position.copy(pos)
  // face oncoming traffic, angled a little towards the road
  const face = a.tan.clone().multiplyScalar(-1).addScaledVector(a.right, -Math.sign(lat) * 0.45).normalize()
  grp.rotation.y = Math.atan2(face.x, face.z)
  const stop = STOPS[a.index]
  const no = a.index === STOPS.length - 1 ? 'END' : String(a.index).padStart(2, '0')
  const tex = milestoneTexture(no, stop.label.toUpperCase())
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.0, 0.3), [M('#e9e4d8'), M('#e9e4d8'), M('#e9e4d8'), M('#e9e4d8'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), M('#e9e4d8')])
  // map only the lower 60% of the texture onto the body front
  const uv = body.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 16; i < 20; i++) uv.setY(i, uv.getY(i) * 0.6)
  body.position.y = 0.5
  body.castShadow = true
  grp.add(body)
  const capTex = tex.clone()
  capTex.needsUpdate = true
  capTex.offset.set(0, 0.6)
  capTex.repeat.set(1, 0.4)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.3, 24, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M('#ffc61a', 0.6))
  cap.position.set(0, 1.0, 0)
  cap.castShadow = true
  grp.add(cap)
  const capFace = new THREE.Mesh(new THREE.CircleGeometry(0.39, 24, 0, Math.PI), new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.7 }))
  capFace.position.set(0, 1.0, 0.152)
  grp.add(capFace)
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.45), M('#b9b3a6'))
  base.position.y = 0.06
  grp.add(base)
  scene.add(grp)
  physics.cylinder(pos.x, 0.7, pos.z, 0.42, 1.4, 8)
}

/* ── hoarding with the project's real website ───────────────── */

function billboard(scene: THREE.Group, physics: Physics, a: StopAnchor, tex: THREE.Texture | undefined, label: string) {
  const spot = billboardSpot(a)
  const grp = new THREE.Group()
  grp.position.set(spot.x, 0, spot.z)
  // face the approaching taxi and the road
  const toRoad = a.right.clone().multiplyScalar(-a.place.side)
  const face = toRoad.multiplyScalar(0.75).addScaledVector(a.tan, -0.66).normalize()
  grp.rotation.y = Math.atan2(face.x, face.z)
  const W = 7.6
  const H = 3.8
  const lift = 2.4
  const frame = M('#1d1b22', 0.5, 0.3)
  box(grp, W + 0.36, H + 0.36, 0.3, frame, 0, lift + H / 2, -0.05)
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.55 }))
    screen.position.set(0, lift + H / 2, 0.115)
    grp.add(screen)
  }
  // name plate under the screen
  const plateTex = signTexture(1024, 96, '#ffc61a', [{ text: label, size: 54, y: 50, weight: 800, color: '#141218' }])
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.7), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 }))
  plate.position.set(0, lift - 0.42, 0.12)
  grp.add(plate)
  box(grp, W + 0.36, 0.78, 0.22, frame, 0, lift - 0.42, -0.02)
  for (const sx of [-1, 1]) {
    box(grp, 0.22, lift + H * 0.7, 0.22, frame, sx * (W / 2 - 0.9), (lift + H * 0.7) / 2, -0.3)
    physics.localBox(grp, new THREE.Vector3(sx * (W / 2 - 0.9), 1.5, -0.3), new THREE.Vector3(0.18, 1.5, 0.18))
  }
  // two lamps that light the hoarding at night
  for (const sx of [-1, 1]) {
    const arm = box(grp, 0.08, 0.08, 0.9, frame, sx * W * 0.28, lift + H + 0.35, 0.35)
    arm.rotation.x = 0.4
  }
  scene.add(grp)
  return grp
}

/* ── set pieces ─────────────────────────────────────────────── */

function boarding({ g }: Ctx) {
  // taxi stand sign
  signboard(g, [
    { text: 'AKASH', size: 40, y: 62, weight: 800, color: '#141218' },
    { text: 'TAXI STAND · ROUTE: THE SKY', size: 13, y: 132, font: FONT.mono, weight: 700, color: '#141218' },
  ], '#ffc61a', 2.6, 1.2, 8.2, 5.2, 1.6, -0.25)
  // chai stall: counter, striped awning, kettle and glasses
  const stall = new THREE.Group()
  stall.position.set(-9.4, 0, 3.6)
  stall.rotation.y = 0.35
  g.add(stall)
  rbox(stall, 2.6, 1.0, 1.1, 0.05, M('#9c5b2e'), 0, 0.5, 0)
  box(stall, 2.7, 0.08, 1.2, M('#6d3c1c'), 0, 1.04, 0)
  for (const sx of [-1, 1]) box(stall, 0.08, 2.4, 0.08, M('#4b3a2c'), sx * 1.25, 1.2, -0.5)
  const awnTex = (() => {
    const { c, g: x } = canvas(256, 64)
    for (let i = 0; i < 8; i++) {
      x.fillStyle = i % 2 ? '#f4efe4' : '#d6382b'
      x.fillRect(i * 32, 0, 32, 64)
    }
    return toTexture(c)
  })()
  const awn = mesh(stall, new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: awnTex, side: THREE.DoubleSide, roughness: 0.8 }), 0, 2.3, 0.1)
  awn.rotation.x = -1.1
  cyl(stall, 0.13, 0.17, 0.32, M('#c9ccd3', 0.3, 0.8), -0.6, 1.24, 0.1, 14)
  for (let i = 0; i < 4; i++) cyl(stall, 0.06, 0.05, 0.14, M('#f2d39a', 0.2, 0, { transparent: true, opacity: 0.85 }), 0.1 + i * 0.22, 1.15, 0.2, 10)
  const chai = signTexture(512, 128, '#141218', [{ text: 'CHAI ₹10', size: 70, y: 66, weight: 800, color: '#ffc61a' }])
  plane(stall, 1.6, 0.4, chai, 0, 0.62, 0.56)
  // bench
  rbox(g, 2.2, 0.12, 0.6, 0.04, M('#7a4a28'), -6, 0.55, 5.2)
  for (const sx of [-1, 1]) box(g, 0.1, 0.55, 0.5, M('#3b3640'), -6 + sx * 0.9, 0.27, 5.2)
}

function egra({ g, physics, on }: Ctx) {
  // school: cream walls, maroon bands, green shutters, veranda columns
  const school = new THREE.Group()
  school.position.set(0, 0, -2.5)
  g.add(school)
  const wallTex = (() => {
    const { c, g: x } = canvas(1024, 256)
    x.fillStyle = '#f1e2bd'
    x.fillRect(0, 0, 1024, 256)
    x.fillStyle = '#8c2f2f'
    x.fillRect(0, 222, 1024, 34)
    x.fillRect(0, 0, 1024, 18)
    for (let i = 0; i < 8; i++) {
      const wx = 50 + i * 124
      x.fillStyle = '#2f6b45'
      x.fillRect(wx, 70, 70, 100)
      x.fillStyle = '#244f35'
      x.fillRect(wx + 33, 70, 4, 100)
      x.fillRect(wx, 118, 70, 4)
    }
    return toTexture(c)
  })()
  const w = 13
  const h = 3.2
  const d = 5
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [M('#efe0ba'), M('#efe0ba'), M('#ddd2b8'), M('#efe0ba'), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 }), M('#efe0ba')])
  walls.position.y = h / 2
  walls.castShadow = true
  walls.receiveShadow = true
  school.add(walls)
  box(school, w + 0.6, 0.35, d + 0.6, M('#8c2f2f'), 0, h + 0.17, 0)
  // veranda
  box(school, w, 0.2, 2.2, M('#d8c9a6'), 0, 0.1, d / 2 + 1.1)
  box(school, w + 0.2, 0.18, 2.4, M('#8c2f2f'), 0, h - 0.1, d / 2 + 1.1)
  for (let i = 0; i < 7; i++) cyl(school, 0.13, 0.15, h - 0.2, M('#f5ecd6'), -w / 2 + 0.6 + i * ((w - 1.2) / 6), (h - 0.2) / 2 + 0.1, d / 2 + 2.05, 10)
  const name = signTexture(1300, 140, '#8c2f2f', [{ text: 'EGRA JHATULAL HIGH SCHOOL', size: 76, y: 74, weight: 800, color: '#fff3d6' }])
  plane(school, 9.5, 1.0, name, 0, h + 0.85, d / 2 + 0.25, 0.1)
  box(school, 9.7, 1.1, 0.2, M('#8c2f2f'), 0, h + 0.85, d / 2 + 0.1)
  physics.localBox(school, new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(w / 2, h / 2, d / 2))

  // village huts with thatched roofs
  const hut = (x: number, z: number, s: number, rot: number) => {
    const grp = new THREE.Group()
    grp.position.set(x, 0, z)
    grp.rotation.y = rot
    grp.scale.setScalar(s)
    g.add(grp)
    box(grp, 2.6, 1.6, 2.2, M('#c99c66', 0.95), 0, 0.8, 0)
    box(grp, 0.6, 1.1, 0.05, M('#5b3a22'), 0.4, 0.55, 1.11)
    const roof = mesh(grp, new THREE.ConeGeometry(2.2, 1.6, 4, 1), M('#d7b35e', 0.95), 0, 2.4, 0)
    roof.rotation.y = Math.PI / 4
    roof.scale.set(1.15, 1, 1)
    physics.localBox(grp, new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(1.3 * s, 0.8 * s, 1.1 * s))
  }
  hut(-10.5, -6, 1, 0.4)
  hut(9.5, -7.5, 0.9, -0.3)
  hut(12.5, -2, 0.8, 0.2)

  // the pond (pukur) with a bank
  const pond = new THREE.Group()
  pond.position.set(-9.5, 0, 4.5)
  g.add(pond)
  const waterMat = new THREE.MeshStandardMaterial({ color: '#3f9fc7', roughness: 0.15, metalness: 0.1 })
  const water = mesh(pond, new THREE.CircleGeometry(2.6, 32).rotateX(-Math.PI / 2), waterMat, 0, 0.05, 0, false)
  water.receiveShadow = true
  const bank = mesh(pond, new THREE.TorusGeometry(2.75, 0.32, 6, 32).rotateX(Math.PI / 2), M('#8a6a45', 0.95), 0, 0.06, 0)
  bank.scale.y = 0.4
  physics.localCylinder(pond, new THREE.Vector3(0, 0.3, 0), 2.6, 0.6)
  on((_dt, t) => {
    waterMat.color.setHSL(0.55, 0.5, 0.48 + Math.sin(t * 0.8) * 0.02)
  })
}

function neotia({ g, physics, on }: Ctx) {
  const uni = new THREE.Group()
  uni.position.set(0, 0, -3)
  g.add(uni)
  const facade = (() => {
    const { c, g: x } = canvas(1024, 512)
    x.fillStyle = '#e9e6df'
    x.fillRect(0, 0, 1024, 512)
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 10; i++) {
        const gx = 30 + i * 99
        const gy = 60 + f * 150
        const grd = x.createLinearGradient(gx, gy, gx + 80, gy + 100)
        grd.addColorStop(0, '#6fa9d6')
        grd.addColorStop(1, '#2d5f8f')
        x.fillStyle = grd
        x.fillRect(gx, gy, 80, 100)
      }
    }
    return toTexture(c)
  })()
  const W = 15
  const H = 7.2
  const D = 6.5
  const mats = [M('#e2dfd8'), M('#e2dfd8'), M('#cfcac0'), M('#e2dfd8'), new THREE.MeshStandardMaterial({ map: facade, roughness: 0.5, metalness: 0.1 }), M('#e2dfd8')]
  const block = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats)
  block.position.y = H / 2
  block.castShadow = true
  block.receiveShadow = true
  uni.add(block)
  box(uni, W + 0.5, 0.4, D + 0.5, M('#8d3a5b'), 0, H + 0.2, 0)
  // portico
  box(uni, 5, 0.35, 3, M('#8d3a5b'), 0, 3.6, D / 2 + 1.4)
  for (const sx of [-1, 1]) cyl(uni, 0.22, 0.22, 3.5, M('#f2efe8'), sx * 2.1, 1.75, D / 2 + 2.6, 14)
  const name = signTexture(1400, 150, '#8d3a5b', [{ text: 'THE NEOTIA UNIVERSITY', size: 84, y: 80, weight: 800, color: '#ffffff' }])
  plane(uni, 10, 1.07, name, 0, H + 1.05, D / 2 + 0.05, 0.25)
  box(uni, 10.2, 1.2, 0.2, M('#8d3a5b'), 0, H + 1.05, D / 2 - 0.08)
  physics.localBox(uni, new THREE.Vector3(0, H / 2, 0), new THREE.Vector3(W / 2, H / 2, D / 2))

  // giant graduation cap floating over a plinth
  const plinth = new THREE.Group()
  plinth.position.set(-5.5, 0, 7)
  g.add(plinth)
  cyl(plinth, 1.1, 1.25, 1.1, M('#ece7dc'), 0, 0.55, 0, 24)
  const cg = signTexture(512, 128, '#141218', [{ text: 'CGPA 8.59', size: 74, y: 66, weight: 800, color: '#ffc61a' }])
  const label = plane(plinth, 1.7, 0.42, cg, 0, 0.62, 1.2)
  label.rotation.x = -0.1
  physics.localCylinder(plinth, new THREE.Vector3(0, 0.55, 0), 1.25, 1.1)
  const cap = new THREE.Group()
  cap.position.y = 2.6
  plinth.add(cap)
  const black = M('#1b1a20', 0.6)
  cyl(cap, 0.75, 0.8, 0.6, black, 0, 0, 0, 24)
  const board = box(cap, 2.4, 0.12, 2.4, black, 0, 0.36, 0)
  board.rotation.y = Math.PI / 4
  cyl(cap, 0.1, 0.1, 0.08, M('#ffc61a', 0.4), 0, 0.46, 0, 12)
  const tassel = new THREE.Group()
  tassel.position.set(0, 0.46, 0)
  cap.add(tassel)
  box(tassel, 1.15, 0.04, 0.04, M('#ffc61a', 0.4), 0.575, 0, 0)
  cyl(tassel, 0.07, 0.12, 0.5, M('#ffc61a', 0.6), 1.15, -0.27, 0, 10)
  on((_dt, t) => {
    cap.position.y = 2.6 + Math.sin(t * 1.4) * 0.18
    cap.rotation.y = t * 0.4
    cap.rotation.z = Math.sin(t * 0.9) * 0.06
    tassel.rotation.z = Math.sin(t * 2.1) * 0.15 - 0.1
  })
}

function firstJobs({ g, physics }: Ctx) {
  // AILABS, Kolkata: a crisp little office with a blue sign
  const office = new THREE.Group()
  office.position.set(0, 0, -1)
  g.add(office)
  rbox(office, 6, 3.4, 4.6, 0.12, M('#eef0f4', 0.55), 0, 1.7, 0)
  box(office, 6.2, 0.25, 4.8, M('#2b5ca8', 0.5), 0, 3.5, 0)
  for (let i = 0; i < 3; i++) box(office, 1.3, 1.6, 0.06, M('#5b8fc9', 0.12, 0.35, { emissive: '#9cc4ff', emissiveIntensity: 0.12 }), -1.8 + i * 1.8, 1.8, 2.32)
  box(office, 1.1, 2.1, 0.06, M('#1d3e73', 0.4), 0, 1.05, 2.33)
  const ai = signTexture(900, 220, '#2b5ca8', [
    { text: 'AILABS', size: 100, y: 92, weight: 800, color: '#ffffff' },
    { text: 'KOLKATA · ENGINEERING TRAINEE · 2023', size: 30, y: 170, font: FONT.mono, color: '#dbe8ff' },
  ])
  plane(office, 4.6, 1.12, ai, 0, 4.3, 1.4, 0.35)
  box(office, 4.8, 1.25, 0.15, M('#2b5ca8'), 0, 4.3, 1.28)
  for (const sx of [-1, 1]) {
    cyl(office, 0.45, 0.35, 0.7, M('#c8673f', 0.85), sx * 3.6, 0.35, 2.4, 14)
    mesh(office, new THREE.IcosahedronGeometry(0.55, 0), M('#4f9a3c', 0.8), sx * 3.6, 1.1, 2.4)
  }
  physics.localBox(office, new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(3, 1.7, 2.3))
}

/** Xeta Labs HQ, Assam — the most decorated building on the island after GOBT */
function xeta({ g, physics, on }: Ctx) {
  const hq = new THREE.Group()
  hq.position.set(0, 0, -1.5)
  g.add(hq)
  const teal = '#3fe0b8'
  const neon = new THREE.MeshStandardMaterial({ color: teal, emissive: teal, emissiveIntensity: 0.6, roughness: 0.3 })
  const glassTex = (() => {
    const { c, g: x } = canvas(512, 512)
    const grd = x.createLinearGradient(0, 0, 512, 512)
    grd.addColorStop(0, '#2a5d74')
    grd.addColorStop(1, '#15283a')
    x.fillStyle = grd
    x.fillRect(0, 0, 512, 512)
    x.strokeStyle = '#0e1a26'
    x.lineWidth = 8
    for (let i = 0; i <= 8; i++) {
      x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 512); x.stroke()
      x.beginPath(); x.moveTo(0, i * 64); x.lineTo(512, i * 64); x.stroke()
    }
    x.fillStyle = 'rgba(255,255,255,0.08)'
    x.beginPath(); x.moveTo(0, 0); x.lineTo(220, 0); x.lineTo(0, 220); x.fill()
    const t = toTexture(c, { repeat: true })
    t.repeat.set(2, 2)
    return t
  })()
  const glass = new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.15, metalness: 0.45, emissive: '#7fe8ff', emissiveMap: glassTex, emissiveIntensity: 0 })
  const W = 8.4
  const D = 6.4
  // podium + three glass floors, each slightly set back
  rbox(hq, W + 1.2, 0.6, D + 1.2, 0.1, M('#d9d6cf', 0.8), 0, 0.3, 0)
  for (let f = 0; f < 3; f++) {
    const w = W - f * 0.7
    const d = D - f * 0.5
    const y = 0.6 + f * 3.2
    box(hq, w, 3.0, d, glass, 0, y + 1.5, 0)
    box(hq, w + 0.3, 0.2, d + 0.3, M('#f2f4f6', 0.5), 0, y + 3.1, 0)
    // neon edge strips on every corner
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(hq, 0.12, 3.0, 0.12, neon, (sx * w) / 2, y + 1.5, (sz * d) / 2)
  }
  const top = 0.6 + 3 * 3.2
  // rooftop: garden boxes, solar panels, a dish and an antenna with a beacon
  for (let i = 0; i < 3; i++) {
    box(hq, 1.4, 0.4, 0.8, M('#7a5236', 0.9), -2.4 + i * 1.6, top + 0.4, -1.6)
    mesh(hq, new THREE.IcosahedronGeometry(0.5, 0), M('#4f9a3c', 0.8), -2.4 + i * 1.6, top + 0.95, -1.6)
  }
  for (let i = 0; i < 3; i++) {
    const p = box(hq, 1.3, 0.06, 0.9, M('#1e3a6e', 0.2, 0.6), 1.2 + (i % 2) * 1.4, top + 0.55, -1.5 + Math.floor(i / 2) * 1.1)
    p.rotation.x = -0.35
  }
  const dish = new THREE.Group()
  dish.position.set(2.6, top + 0.3, 1.6)
  hq.add(dish)
  cyl(dish, 0.08, 0.12, 0.8, M('#d9dbe1', 0.4, 0.6), 0, 0.4, 0, 8)
  const bowl = mesh(dish, new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M('#eceef2', 0.35, 0.3), 0, 0.9, 0)
  bowl.rotation.x = Math.PI * 0.75
  cyl(hq, 0.05, 0.08, 3.4, M('#c9ccd3', 0.4, 0.7), -3.2, top + 1.7, 1.8, 8)
  const beacon = mesh(hq, new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }), -3.2, top + 3.5, 1.8, false)
  // the big rooftop sign
  const signTex = signTexture(1200, 260, '#0d1620', [
    { text: 'XETA LABS', size: 150, y: 120, weight: 800, color: teal },
    { text: 'ASSAM · ENGINEERING · AI · PRODUCTS', size: 34, y: 220, font: FONT.mono, color: '#d8fff4' },
  ])
  const sign = plane(hq, 7.4, 1.6, signTex, 0, top + 1.6, 1.0, 0.8)
  box(hq, 7.6, 1.8, 0.2, M('#0d1620'), 0, top + 1.6, 0.86)
  for (const sx of [-1, 1]) box(hq, 0.15, 1.2, 0.15, M('#0d1620'), sx * 3.2, top + 0.6, 0.86)
  // a hologram ring of little cubes orbiting above the roof
  const holo = new THREE.Group()
  holo.position.set(0, top + 4.6, -0.5)
  hq.add(holo)
  const holoMat = new THREE.MeshBasicMaterial({ color: '#7ff6d8', transparent: true, opacity: 0.85 })
  mesh(holo, new THREE.TorusGeometry(2.2, 0.05, 6, 64).rotateX(Math.PI / 2), holoMat, 0, 0, 0, false)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const cube = mesh(holo, new THREE.BoxGeometry(0.32, 0.32, 0.32), holoMat, Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2, false)
    cube.rotation.set(a, a, 0)
  }
  // entrance: canopy, steps, planters, bollard lights and a project banner
  box(hq, 3.6, 0.18, 2.4, M('#f2f4f6', 0.5), 0, 3.0, D / 2 + 1.1)
  for (const sx of [-1, 1]) cyl(hq, 0.08, 0.08, 2.4, M('#c9ccd3', 0.4, 0.7), sx * 1.6, 1.8, D / 2 + 2.1, 8)
  box(hq, 3.2, 0.22, 1.0, M('#cfcac0', 0.8), 0, 0.71, D / 2 + 0.9)
  box(hq, 1.6, 2.2, 0.06, M('#0d1620', 0.3, 0.3, { emissive: teal, emissiveIntensity: 0.15 }), 0, 1.7, D / 2 + 0.03)
  const banner = signTexture(400, 1000, '#0d1620', [
    { text: 'WE', size: 60, y: 120, weight: 800, color: teal },
    { text: 'BUILT', size: 60, y: 190, weight: 800, color: teal },
    { text: 'PICAKU', size: 64, y: 330, weight: 800, color: '#ffffff' },
    { text: '+', size: 60, y: 420, weight: 800, color: teal },
    { text: 'LIFE APP', size: 58, y: 510, weight: 800, color: '#ffffff' },
    { text: '+ MORE', size: 46, y: 640, font: FONT.mono, color: teal },
  ])
  for (const sx of [-1, 1]) plane(hq, 1.3, 3.25, banner, sx * (W / 2 - 1.1), 2.7, D / 2 + 0.08, 0.5)
  const bollards: THREE.Mesh[] = []
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue
    bollards.push(cyl(hq, 0.12, 0.14, 0.8, neon, i * 1.25, 0.4, D / 2 + 3.4, 10))
  }
  for (const sx of [-1, 1]) {
    cyl(hq, 0.5, 0.42, 0.8, M('#e8e3d8', 0.7), sx * 4.6, 0.4, D / 2 + 1.4, 16)
    mesh(hq, new THREE.ConeGeometry(0.6, 1.8, 6), M('#2f7d45', 0.8), sx * 4.6, 1.7, D / 2 + 1.4)
  }
  const ups = [-1, 1].map((sx) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(127,246,216,1)', 'rgba(127,246,216,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }))
    s.position.set(sx * (W / 2 + 0.4), 3, D / 2 + 0.6)
    s.scale.set(3, 7, 1)
    hq.add(s)
    return s
  })
  physics.localBox(hq, new THREE.Vector3(0, top / 2, 0), new THREE.Vector3(W / 2 + 0.6, top / 2, D / 2 + 0.6))
  on((dt, t, night, near) => {
    holo.rotation.y += dt * (0.5 + near)
    holo.position.y = top + 4.6 + Math.sin(t * 1.3) * 0.2
    dish.rotation.y = Math.sin(t * 0.4) * 1.2
    ;(beacon.material as THREE.MeshBasicMaterial).color.setRGB(Math.sin(t * 4) > 0.3 ? 1 : 0.25, 0.1, 0.1)
    const lit = 0.25 + night * 0.9
    neon.emissiveIntensity = 0.5 + night * 1.6
    glass.emissiveIntensity = night * 0.35
    holoMat.opacity = 0.55 + Math.sin(t * 3) * 0.15 + night * 0.25
    ;(sign.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + night * 1.2
    ups.forEach((u) => (u.material.opacity = lit * 0.6))
    bollards.forEach((b, i) => b.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.03))
  })
}

function picaku({ g, physics, on }: Ctx) {
  const red = '#e2312b'
  const base = new THREE.Group()
  g.add(base)
  cyl(base, 2.2, 2.4, 0.6, M('#f6f1ea', 0.6), 0, 0.3, 0, 32)
  cyl(base, 0.16, 0.2, 3.4, M('#2b2830', 0.4, 0.6), 0, 2.3, 0, 12)
  // a studio condenser microphone
  const mic = new THREE.Group()
  mic.position.set(0, 4.4, 0)
  base.add(mic)
  const yoke = mesh(mic, new THREE.TorusGeometry(1.15, 0.09, 8, 24, Math.PI), M('#2b2830', 0.4, 0.6), 0, 0.2, 0)
  yoke.rotation.z = Math.PI
  const body = mesh(mic, new THREE.CapsuleGeometry(0.85, 1.6, 8, 20), M('#c9ccd3', 0.25, 0.85))
  body.position.y = 0.7
  const gmat = new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.5, metalness: 0.5, wireframe: true })
  mesh(mic, new THREE.SphereGeometry(0.88, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), gmat, 0, 1.5, 0, false)
  mesh(mic, new THREE.TorusGeometry(0.87, 0.06, 6, 28).rotateX(Math.PI / 2), M(red, 0.4), 0, 0.95, 0)
  const dot = mesh(mic, new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff4d3a' }), 0, 0.3, 0.86, false)
  // sound-wave rings pulsing outwards
  const rings: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const r = mesh(base, new THREE.TorusGeometry(1.6, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: 0.6 }), 0, 5.2, 0, false)
    rings.push(r)
  }
  // floating transcript cards
  const card = (lines: string[], x: number, y: number, z: number) => {
    const tex = signTexture(512, 220, '#ffffff', lines.map((t, i) => ({ text: t, size: i ? 30 : 36, y: 60 + i * 60, weight: i ? 500 : 800, color: i ? '#4b4650' : red, align: 'left' as CanvasTextAlign, x: 30 })), { radius: 28 })
    const m = plane(base, 2.2, 0.95, tex, x, y, z, 0.4)
    return m
  }
  const cards = [card(['Transcript', 'Q3 sync · 42 min', '3 action items'], -2.6, 4.2, 0.8), card(['Summary', 'Ship the beta Friday', 'Owner: Akash'], 2.6, 5.4, 0.6)]
  const sign = signTexture(900, 200, red, [{ text: 'PICAKU', size: 110, y: 90, weight: 800, color: '#ffffff' }, { text: 'RECORD · TRANSCRIBE · NEVER FORGET', size: 28, y: 160, font: FONT.mono, color: '#ffe6e3' }])
  const plate = plane(g, 3.6, 0.8, sign, 0, 0.85, 2.7, 0.3)
  plate.rotation.x = -0.15
  physics.localCylinder(base, new THREE.Vector3(0, 2, 0), 2.4, 4)
  on((_dt, t, night, near) => {
    rings.forEach((r, i) => {
      const k = (t * 0.6 + i / 3) % 1
      r.scale.setScalar(1 + k * 2.4)
      ;(r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (0.55 + near * 0.3)
      r.rotation.x = Math.PI / 2
    })
    ;(dot.material as THREE.MeshBasicMaterial).color.setRGB(Math.sin(t * 5) > 0 ? 1 : 0.4, 0.2, 0.15)
    mic.rotation.y = Math.sin(t * 0.5) * 0.4
    cards.forEach((c, i) => {
      c.position.y = (i ? 5.4 : 4.2) + Math.sin(t * 1.2 + i * 2) * 0.15
      ;(c.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + night * 0.6
    })
  })
}

function lifeapp({ g, physics, textures, on }: Ctx) {
  const blue = '#1b8fe6'
  const stand = new THREE.Group()
  g.add(stand)
  cyl(stand, 2.3, 2.5, 0.5, M('#eef4fb', 0.6), 0, 0.25, 0, 32)
  // a giant phone showing the app
  const phone = new THREE.Group()
  phone.position.set(0, 3.9, 0)
  phone.rotation.x = -0.08
  stand.add(phone)
  rbox(phone, 3.1, 6.2, 0.3, 0.3, M('#16161c', 0.3, 0.4), 0, 0, 0)
  const tex = textures.get('img/tex/lifeapp.webp')
  if (tex) {
    const screenTex = tex.clone()
    screenTex.needsUpdate = true
    // show the phone mock-up on the right of the screenshot
    screenTex.offset.set(0.62, 0)
    screenTex.repeat.set(0.24, 1)
    plane(phone, 2.8, 5.8, screenTex, 0, 0, 0.16, 0.85)
  }
  cyl(phone, 0.06, 0.06, 0.02, M('#333'), 0, 2.85, 0.16, 12).rotation.x = Math.PI / 2
  // reward coins orbiting and a trophy
  const coins = new THREE.Group()
  coins.position.y = 4
  stand.add(coins)
  const gold = M('#f2b705', 0.25, 0.9)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const c = mesh(coins, new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24).rotateX(Math.PI / 2), gold, Math.cos(a) * 3.2, Math.sin(i * 1.3) * 1.2, Math.sin(a) * 3.2)
    c.userData.a = a
  }
  const trophy = new THREE.Group()
  trophy.position.set(-3.2, 0.5, 1.6)
  stand.add(trophy)
  cyl(trophy, 0.5, 0.6, 0.3, M('#3a3a44', 0.5), 0, 0.15, 0, 16)
  cyl(trophy, 0.08, 0.12, 0.8, gold, 0, 0.7, 0, 10)
  mesh(trophy, new THREE.LatheGeometry([new THREE.Vector2(0.1, 0), new THREE.Vector2(0.55, 0.4), new THREE.Vector2(0.65, 1.0), new THREE.Vector2(0.6, 1.05)], 20), gold, 0, 1.1, 0)
  const sign = signTexture(900, 200, blue, [{ text: 'LIFE APP', size: 110, y: 90, weight: 800, color: '#ffffff' }, { text: 'PLAY · LEARN · EARN · 140K+ USERS', size: 28, y: 160, font: FONT.mono, color: '#e3f2ff' }])
  const plate = plane(g, 3.6, 0.8, sign, 0, 0.85, 2.8, 0.3)
  plate.rotation.x = -0.15
  physics.localCylinder(stand, new THREE.Vector3(0, 2, 0), 2.5, 4)
  on((dt, t, _night, near) => {
    coins.rotation.y += dt * (0.6 + near * 1.2)
    coins.children.forEach((c, i) => {
      c.rotation.y += dt * 3
      c.position.y = Math.sin(t * 1.5 + i) * 1.1
    })
    phone.position.y = 3.9 + Math.sin(t * 1.1) * 0.12
    trophy.rotation.y = t * 0.8
  })
}

function gobt({ g, physics, textures, on }: Ctx) {
  const tower = new THREE.Group()
  tower.position.set(0, 0, -1.5)
  g.add(tower)
  const glass = M('#1c1b23', 0.25, 0.5)
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.3, metalness: 0.9, emissive: '#e8a313', emissiveIntensity: 0 })
  const windows = new THREE.MeshStandardMaterial({ color: '#2b2a35', roughness: 0.2, metalness: 0.6, emissive: '#ffd36b', emissiveIntensity: 0 })
  const ledMat = new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: '#ffc23a', emissiveIntensity: 0.4 })
  const floors = 6
  for (let i = 0; i < floors; i++) {
    const f = new THREE.Group()
    f.position.y = 0.6 + i * 3.1
    f.rotation.y = i * 0.1
    tower.add(f)
    const w = 6.6 - i * 0.32
    box(f, w, 2.7, w, glass, 0, 1.35, 0)
    box(f, w + 0.22, 0.16, w + 0.22, gold, 0, 2.75, 0)
    for (const s of [-1, 1]) {
      box(f, w + 0.02, 0.5, 0.04, windows, 0, 1.4, s * (w / 2))
      box(f, 0.04, 0.5, w + 0.02, windows, s * (w / 2), 1.4, 0)
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(f, 0.1, 2.7, 0.1, ledMat, (sx * w) / 2, 1.35, (sz * w) / 2)
  }
  rbox(tower, 8.4, 0.6, 8.4, 0.1, M('#2a2830', 0.7), 0, 0.3, 0)
  const top = 0.6 + floors * 3.1
  const gearGeo = (teeth: number, r: number, depth = 0.35) => {
    const s = new THREE.Shape()
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2
      const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2
      const rr = i % 2 ? r : r * 1.18
      if (i === 0) s.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr)
      else s.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr)
      s.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr)
    }
    s.closePath()
    const hole = new THREE.Path()
    hole.absarc(0, 0, r * 0.45, 0, Math.PI * 2, true)
    s.holes.push(hole)
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1, curveSegments: 18 }).translate(0, 0, -depth / 2)
  }
  const g1 = mesh(tower, gearGeo(12, 1.5), gold, -0.9, top + 2.2, 0)
  const g2 = mesh(tower, gearGeo(8, 1.0), gold, 1.35, top + 1.0, 0.1)
  box(tower, 0.3, 2.4, 0.3, M('#2b2a35'), 0, top + 0.9, -0.3)
  // a big flat gear ring turning around the tower's waist
  const ring = mesh(tower, gearGeo(36, 4.6, 0.25).rotateX(Math.PI / 2), gold, 0, 7.5, 0)
  // a drone circling the tower
  const drone = new THREE.Group()
  tower.add(drone)
  box(drone, 0.6, 0.15, 0.6, M('#1d1c22', 0.4, 0.4), 0, 0, 0)
  const props: THREE.Mesh[] = []
  for (const [x, z] of [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) {
    box(drone, 0.5, 0.05, 0.06, M('#1d1c22'), x / 2, 0, z / 2).rotation.y = Math.atan2(z, x)
    props.push(mesh(drone, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), new THREE.MeshBasicMaterial({ color: '#9aa', transparent: true, opacity: 0.45 }), x, 0.08, z, false))
  }
  const droneLight = mesh(drone, new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#3fff8a' }), 0, -0.1, 0.3, false)
  // logo over the entrance, plaque, planters
  const logo = textures.get('img/logos/gobt.webp')
  if (logo) {
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ map: logo, transparent: true, emissiveMap: logo, emissive: '#ffffff', emissiveIntensity: 0.3 }))
    lm.position.set(0, 3.2, 3.36)
    tower.add(lm)
  }
  const sign = signTexture(1200, 220, '#141218', [
    { text: 'GOBT HQ', size: 110, y: 96, weight: 800, color: '#e8b923' },
    { text: 'GROUP OF BLOOMING TECHNICIANS · KOLKATA', size: 34, y: 178, font: FONT.mono, color: '#f2e6c4' },
  ])
  const plate = plane(g, 5.2, 0.95, sign, 0, 0.8, 4.4, 0.5)
  plate.rotation.x = -0.25
  box(g, 5.4, 0.2, 1.2, M('#141218'), 0, 0.3, 4.2)
  const dpiit = signTexture(600, 160, '#e8b923', [{ text: 'DPIIT RECOGNISED', size: 58, y: 64, weight: 800, color: '#141218' }, { text: 'DEEP-TECH STARTUP', size: 34, y: 124, font: FONT.mono, color: '#141218' }])
  plane(tower, 1.8, 0.48, dpiit, 2.6, 1.6, 3.37, 0.3)
  for (const sx of [-1, 1]) {
    cyl(g, 0.6, 0.5, 0.9, M('#2a2830', 0.6), sx * 4.6, 0.45, 3.2, 16)
    mesh(g, new THREE.ConeGeometry(0.7, 2.2, 6), M('#3f8a3a', 0.8), sx * 4.6, 2.0, 3.2)
  }
  // a robot arm in the plaza (GOBT builds ROS & cyber-physical systems)
  const arm = new THREE.Group()
  arm.position.set(-5.2, 0, 1)
  g.add(arm)
  cyl(arm, 0.7, 0.8, 0.5, M('#2a2830', 0.5, 0.4), 0, 0.25, 0, 16)
  const j1 = new THREE.Group()
  j1.position.y = 0.5
  arm.add(j1)
  cyl(j1, 0.35, 0.4, 0.5, M('#e8b923', 0.35, 0.7), 0, 0.25, 0, 14)
  const j2 = new THREE.Group()
  j2.position.y = 0.55
  j1.add(j2)
  box(j2, 0.35, 2.0, 0.35, M('#e8b923', 0.35, 0.7), 0, 1, 0)
  const j3 = new THREE.Group()
  j3.position.y = 2.0
  j2.add(j3)
  mesh(j3, new THREE.SphereGeometry(0.28, 12, 8), M('#2a2830', 0.4, 0.5))
  box(j3, 0.28, 1.5, 0.28, M('#e8b923', 0.35, 0.7), 0, 0.75, 0)
  box(j3, 0.5, 0.18, 0.2, M('#2a2830', 0.4, 0.5), 0, 1.55, 0)
  physics.localCylinder(arm, new THREE.Vector3(0, 1, 0), 0.8, 2)
  physics.localBox(tower, new THREE.Vector3(0, top / 2, 0), new THREE.Vector3(3.4, top / 2, 3.4))
  on((dt, t, night, near) => {
    g1.rotation.z += dt * 0.5
    g2.rotation.z -= dt * 0.5 * (12 / 8)
    ring.rotation.y += dt * 0.15
    const a = t * 0.5
    drone.position.set(Math.cos(a) * 6.5, 9 + Math.sin(t * 1.7) * 1.2, Math.sin(a) * 6.5)
    drone.rotation.y = -a
    props.forEach((p) => (p.rotation.y += dt * 40))
    ;(droneLight.material as THREE.MeshBasicMaterial).color.setRGB(0.2, Math.sin(t * 6) > 0 ? 1 : 0.3, 0.4)
    j1.rotation.y = Math.sin(t * 0.7) * 1.2
    j2.rotation.z = -0.4 + Math.sin(t * 0.9) * 0.35 - near * 0.2
    j3.rotation.z = 0.8 + Math.sin(t * 1.1 + 1) * 0.4
    gold.emissiveIntensity = night * 0.35
    windows.emissiveIntensity = night * 1.4
    ledMat.emissiveIntensity = 0.4 + night * 1.8
  })
}

function pizzahap({ g, physics, on }: Ctx) {
  const oven = new THREE.Group()
  oven.position.set(-1.5, 0, -1)
  g.add(oven)
  const brick = (() => {
    const { c, g: x } = canvas(512, 256)
    x.fillStyle = '#7b3a26'
    x.fillRect(0, 0, 512, 256)
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 9; col++) {
        const off = row % 2 ? 28 : 0
        x.fillStyle = `hsl(${10 + Math.random() * 12}, ${55 + Math.random() * 15}%, ${36 + Math.random() * 10}%)`
        x.fillRect(col * 58 - off + 2, row * 32 + 2, 54, 28)
      }
    }
    const t = toTexture(c, { repeat: true })
    t.repeat.set(3, 1.5)
    return t
  })()
  cyl(oven, 2.6, 2.7, 1.0, M('#8a8178', 0.9), 0, 0.5, 0, 28)
  const dome = mesh(oven, new THREE.SphereGeometry(2.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }), 0, 1.0, 0)
  dome.scale.y = 0.95
  // mouth
  const mouth = mesh(oven, new THREE.CircleGeometry(0.85, 24, 0, Math.PI), M('#120807', 1), 0, 1.0, 2.24, false)
  mouth.scale.y = 1.1
  cyl(oven, 0.32, 0.38, 1.6, M('#7b3a26', 0.9), 0.9, 2.9, -0.6, 14)
  // flames
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb52e', transparent: true, opacity: 0.95 })
  const flameMat2 = new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.9 })
  const flames: THREE.Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const f = mesh(oven, new THREE.ConeGeometry(0.16 + (i % 2) * 0.06, 0.6, 8), i % 2 ? flameMat2 : flameMat, -0.45 + i * 0.22, 1.25, 1.75, false)
    flames.push(f)
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,140,40,1)', 'rgba(255,90,20,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }))
  glow.position.set(0, 1.3, 2.3)
  glow.scale.setScalar(3.4)
  oven.add(glow)
  const light = new THREE.PointLight('#ff8a2b', 0, 9, 1.6)
  light.position.set(0, 1.4, 2.8)
  oven.add(light)
  physics.localCylinder(oven, new THREE.Vector3(0, 1.4, 0), 2.6, 2.8)

  // giant pizza on a pole, slowly spinning like a sign
  const pizzaTex = (() => {
    const { c, g: x } = canvas(512, 512)
    x.fillStyle = '#d9913f'
    x.beginPath()
    x.arc(256, 256, 250, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#c4361f'
    x.beginPath()
    x.arc(256, 256, 214, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#f7d36b'
    for (let i = 0; i < 40; i++) {
      x.beginPath()
      x.arc(256 + (Math.random() - 0.5) * 360, 256 + (Math.random() - 0.5) * 360, 18 + Math.random() * 26, 0, Math.PI * 2)
      x.fill()
    }
    x.fillStyle = '#9e1f1a'
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 170
      x.beginPath()
      x.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 22, 0, Math.PI * 2)
      x.fill()
    }
    x.fillStyle = '#3f8a3a'
    for (let i = 0; i < 12; i++) {
      x.beginPath()
      x.ellipse(256 + (Math.random() - 0.5) * 330, 256 + (Math.random() - 0.5) * 330, 14, 8, Math.random() * 3, 0, Math.PI * 2)
      x.fill()
    }
    x.strokeStyle = 'rgba(80,40,10,0.35)'
    x.lineWidth = 4
    for (let i = 0; i < 4; i++) {
      x.beginPath()
      x.moveTo(256, 256)
      const a = (i / 4) * Math.PI * 2 + 0.3
      x.lineTo(256 + Math.cos(a) * 250, 256 + Math.sin(a) * 250)
      x.stroke()
    }
    return toTexture(c)
  })()
  const pole = new THREE.Group()
  pole.position.set(4.6, 0, 1.5)
  g.add(pole)
  cyl(pole, 0.12, 0.16, 4.2, M('#2b2830'), 0, 2.1, 0, 10)
  const pizza = new THREE.Group()
  pizza.position.y = 4.8
  pole.add(pizza)
  const disc = mesh(pizza, new THREE.CylinderGeometry(1.7, 1.7, 0.2, 40).rotateX(Math.PI / 2), [M('#c9873a', 0.8), new THREE.MeshStandardMaterial({ map: pizzaTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: pizzaTex, roughness: 0.7 })] as unknown as THREE.Material, 0, 0, 0)
  disc.castShadow = true
  physics.localCylinder(pole, new THREE.Vector3(0, 2.1, 0), 0.2, 4.2)
  on((dt, t, night, near) => {
    pizza.rotation.y += dt * (0.4 + near * 1.2)
    const flick = 0.75 + Math.sin(t * 17) * 0.12 + Math.sin(t * 29 + 1) * 0.08
    flames.forEach((f, i) => {
      f.scale.set(1, flick + Math.sin(t * 13 + i * 2) * 0.25 + near * 0.3, 1)
    })
    ;(glow.material as THREE.SpriteMaterial).opacity = 0.55 + flick * 0.3 + night * 0.2
    light.intensity = (2 + night * 6) * flick
  })
}

function gharkamali({ g, physics, on }: Ctx) {
  const terracotta = M('#c8673f', 0.85)
  const leaf = M('#3f8f3a', 0.7)
  const leaf2 = M('#2f6b2c', 0.7)
  const pot = (x: number, z: number, s: number, kind: 'monstera' | 'snake' | 'tree') => {
    const p = new THREE.Group()
    p.position.set(x, 0, z)
    p.scale.setScalar(s)
    g.add(p)
    const profile = [new THREE.Vector2(0.55, 0), new THREE.Vector2(0.75, 0.9), new THREE.Vector2(0.85, 1.0), new THREE.Vector2(0.85, 1.12), new THREE.Vector2(0.7, 1.12)]
    mesh(p, new THREE.LatheGeometry(profile, 20), terracotta)
    cyl(p, 0.7, 0.7, 0.06, M('#4b2f20', 1), 0, 1.05, 0, 20)
    if (kind === 'monstera') {
      for (let i = 0; i < 7; i++) {
        const st = new THREE.Group()
        st.rotation.set(0.5 + (i % 3) * 0.2, (i / 7) * Math.PI * 2, 0)
        st.position.y = 1.1
        p.add(st)
        cyl(st, 0.03, 0.04, 1.4, leaf2, 0, 0.7, 0, 5)
        const l = mesh(st, new THREE.SphereGeometry(0.55, 10, 6).scale(1, 0.12, 1.3), i % 2 ? leaf : leaf2, 0, 1.45, 0.2)
        l.rotation.x = 0.5
      }
    } else if (kind === 'snake') {
      for (let i = 0; i < 9; i++) {
        const b = mesh(p, new THREE.ConeGeometry(0.12, 2.1, 4), i % 2 ? leaf : M('#5c9a3a', 0.6), Math.cos(i) * 0.3, 2.05, Math.sin(i * 1.7) * 0.3)
        b.rotation.set((Math.random() - 0.5) * 0.3, i, (Math.random() - 0.5) * 0.3)
      }
    } else {
      cyl(p, 0.08, 0.1, 1.6, M('#6d4a2f'), 0, 1.9, 0, 6)
      mesh(p, new THREE.IcosahedronGeometry(0.9, 0), leaf, 0, 3.0, 0)
      mesh(p, new THREE.IcosahedronGeometry(0.6, 0), leaf2, 0.4, 3.4, 0.2)
    }
    physics.localCylinder(p, new THREE.Vector3(0, 0.6, 0), 0.85 * s, 1.2 * s)
  }
  pot(-4.5, -2.5, 1.5, 'monstera')
  pot(0, -3.6, 1.3, 'snake')
  pot(4.3, -2.6, 1.4, 'tree')

  // flower bed in rows
  const colors = ['#ff6b8b', '#ffd23f', '#ff8c42', '#ffffff', '#c17bff']
  const bloom = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 60)
  const o = new THREE.Object3D()
  const c = new THREE.Color()
  let k = 0
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 20; i++) {
      o.position.set(-5.2 + i * 0.55, 0.32 + Math.random() * 0.1, 1.2 + row * 0.9)
      o.updateMatrix()
      bloom.setMatrixAt(k, o.matrix)
      bloom.setColorAt(k, c.set(colors[(i + row) % colors.length]))
      k++
    }
  }
  g.add(bloom)
  const stems = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 2.6), M('#4f8f3a', 0.9))
  stems.position.set(0, 0.12, 2.1)
  g.add(stems)

  // the watering can, tipped and pouring
  const can = new THREE.Group()
  can.position.set(1.8, 3.3, 1.6)
  can.rotation.z = 0.5
  g.add(can)
  const green = M('#2f7d45', 0.45, 0.3)
  cyl(can, 0.75, 0.85, 1.4, green, 0, 0, 0, 24)
  const spout = cyl(can, 0.09, 0.14, 1.9, green, -1.05, 0.25, 0, 10)
  spout.rotation.z = 1.0
  cyl(can, 0.2, 0.12, 0.16, M('#e9cf87', 0.4, 0.6), -1.82, 0.78, 0, 12).rotation.z = 1.0
  const handle = mesh(can, new THREE.TorusGeometry(0.55, 0.07, 8, 16, Math.PI), green, 0.15, 0.7, 0)
  handle.rotation.z = -0.2
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: '#9fdcff' }), 26)
  g.add(drops)
  const spoutTip = new THREE.Vector3(1.8 - 1.9, 3.3 + 0.55, 1.6)
  on((_dt, t) => {
    can.rotation.z = 0.5 + Math.sin(t * 1.1) * 0.05
    for (let i = 0; i < 26; i++) {
      const life = (t * 0.9 + i / 26) % 1
      o.position.set(spoutTip.x - life * 0.6 + Math.sin(i * 7.3) * 0.12, spoutTip.y - life * life * 3.1, spoutTip.z + Math.cos(i * 3.1) * 0.12)
      o.scale.setScalar(1 - life * 0.5)
      o.updateMatrix()
      drops.setMatrixAt(i, o.matrix)
    }
    drops.instanceMatrix.needsUpdate = true
  })

  // shed with the brand sign
  const shed = new THREE.Group()
  shed.position.set(-7.5, 0, -6.5)
  shed.rotation.y = 0.5
  g.add(shed)
  box(shed, 3.2, 2.4, 2.6, M('#03411a', 0.8), 0, 1.2, 0)
  const roof = mesh(shed, new THREE.CylinderGeometry(1.85, 1.85, 3.4, 3, 1).rotateZ(Math.PI / 2), M('#edcf87', 0.7), 0, 2.75, 0)
  roof.scale.set(1, 0.45, 0.85)
  const gk = signTexture(800, 200, '#03411a', [
    { text: 'GHAR KA MALI', size: 86, y: 86, weight: 800, color: '#edcf87' },
    { text: 'YOUR GARDEN, OUR CARE', size: 30, y: 158, font: FONT.mono, color: '#ffffff' },
  ])
  plane(shed, 3.0, 0.75, gk, 0, 1.6, 1.31, 0.2)
  physics.localBox(shed, new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(1.6, 1.2, 1.3))
}

function altaqwa({ g, physics, env, on }: Ctx) {
  const base = new THREE.Group()
  g.add(base)
  const navy = M('#141a3a', 0.35, 0.2)
  const gold = new THREE.MeshStandardMaterial({ color: '#d6a842', roughness: 0.22, metalness: 1, envMap: env, envMapIntensity: 1.3 })
  cyl(base, 2.5, 2.7, 1.0, navy, 0, 0.5, 0, 36)
  mesh(base, new THREE.TorusGeometry(2.55, 0.07, 8, 48).rotateX(Math.PI / 2), gold, 0, 1.0, 0)
  mesh(base, new THREE.TorusGeometry(2.68, 0.06, 8, 48).rotateX(Math.PI / 2), gold, 0, 0.12, 0)
  physics.localCylinder(base, new THREE.Vector3(0, 2.5, 0), 2.7, 5)

  const bottle = new THREE.Group()
  bottle.position.y = 1.0
  base.add(bottle)
  const body = [
    [0.0, 0], [1.0, 0], [1.25, 0.2], [1.4, 0.8], [1.35, 1.6], [1.0, 2.3], [0.5, 2.7], [0.36, 3.0], [0.36, 3.3], [0, 3.3],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const glassMat = new THREE.MeshStandardMaterial({ color: '#c77d24', roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.88, envMap: env, envMapIntensity: 1.4, emissive: '#7a3d07', emissiveIntensity: 0.25 })
  mesh(bottle, new THREE.LatheGeometry(body, 32), glassMat)
  mesh(bottle, new THREE.TorusGeometry(1.36, 0.08, 8, 40).rotateX(Math.PI / 2), gold, 0, 1.2, 0)
  const cap = [[0, 3.25], [0.5, 3.25], [0.62, 3.6], [0.48, 4.1], [0.62, 4.6], [0.3, 5.3], [0.08, 5.9], [0, 6.1]].map(([x, y]) => new THREE.Vector2(x, y))
  mesh(bottle, new THREE.LatheGeometry(cap, 24), gold)
  mesh(bottle, new THREE.SphereGeometry(0.16, 12, 8), gold, 0, 6.15, 0)

  const sparkles = new THREE.Points(
    (() => {
      const geo = new THREE.BufferGeometry()
      const pos = new Float32Array(60 * 3)
      for (let i = 0; i < 60; i++) pos.set([(Math.random() - 0.5) * 6, 1 + Math.random() * 6, (Math.random() - 0.5) * 6], i * 3)
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      return geo
    })(),
    new THREE.PointsMaterial({ color: '#ffe3a1', size: 0.22, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  base.add(sparkles)
  const sign = signTexture(900, 220, '#141a3a', [
    { text: 'Al-Taqwa', size: 110, y: 90, font: FONT.serif, weight: 400, color: '#e7c06a' },
    { text: 'WHERE LUXURY MEETS ELEGANCE', size: 30, y: 172, font: FONT.mono, color: '#f3e6c4' },
  ])
  const plate = plane(g, 3.6, 0.88, sign, 0, 1.35, 2.82, 0.3)
  plate.rotation.x = -0.12
  on((dt, t, night, near) => {
    bottle.rotation.y += dt * (0.25 + near * 0.6)
    bottle.position.y = 1.0 + Math.sin(t * 1.2) * 0.06
    glassMat.emissiveIntensity = 0.25 + night * 0.6
    sparkles.rotation.y = t * 0.2
    ;(sparkles.material as THREE.PointsMaterial).opacity = 0.4 + night * 0.6
  })
}

function accurateastro({ g, physics, on }: Ctx) {
  const obs = new THREE.Group()
  obs.position.set(0, 0, -1)
  g.add(obs)
  cyl(obs, 3, 3.1, 3, M('#eef0f5', 0.6), 0, 1.5, 0, 36)
  const dome = new THREE.Group()
  dome.position.y = 3
  obs.add(dome)
  mesh(dome, new THREE.SphereGeometry(3.05, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), M('#b9c3d6', 0.3, 0.7))
  const slit = mesh(dome, new THREE.BoxGeometry(0.9, 3.2, 3.2), M('#141522', 0.8), 0, 1.3, 0.6, false)
  slit.rotation.x = -0.45
  const scope = cyl(dome, 0.32, 0.4, 3.4, M('#3c4f8a', 0.4, 0.5), 0, 2.3, 1.4, 16)
  scope.rotation.x = 0.85
  const door = box(obs, 1.2, 2, 0.1, M('#58b8ef', 0.4), 0, 1, 3.05)
  door.castShadow = false
  physics.localCylinder(obs, new THREE.Vector3(0, 2.5, 0), 3.1, 5)

  // orrery: a little sun and its planets above the dome
  const orrery = new THREE.Group()
  orrery.position.y = 9.4
  obs.add(orrery)
  const sunMat = new THREE.MeshBasicMaterial({ color: '#ffd36b' })
  mesh(orrery, new THREE.SphereGeometry(0.6, 20, 14), sunMat, 0, 0, 0, false)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,210,110,1)', 'rgba(255,180,80,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  halo.scale.setScalar(3.6)
  orrery.add(halo)
  const planets: { g: THREE.Group; speed: number }[] = []
  ;[[1.6, '#58b8ef', 0.22, 1.2], [2.4, '#ff8b5c', 0.3, 0.7], [3.3, '#c9a6ff', 0.26, 0.45]].forEach(([r, col, s, speed]) => {
    const pg = new THREE.Group()
    orrery.add(pg)
    mesh(pg, new THREE.SphereGeometry(s as number, 16, 10), M(col as string, 0.5), r as number, 0, 0)
    const ring = mesh(orrery, new THREE.TorusGeometry(r as number, 0.015, 4, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }), 0, 0, 0, false)
    ring.castShadow = false
    planets.push({ g: pg, speed: speed as number })
  })
  // zodiac ring on the ground
  const glyphs = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓']
  const { c, g: x } = canvas(1024, 96)
  x.fillStyle = 'rgba(0,0,0,0)'
  x.clearRect(0, 0, 1024, 96)
  x.fillStyle = '#ffe7a8'
  x.font = `48px ${FONT.display}`
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  glyphs.forEach((gl, i) => x.fillText(gl + '︎', 42 + i * 85.3, 50))
  const zt = toTexture(c)
  const zodiac = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.9, 96, 1), new THREE.MeshBasicMaterial({ map: zt, transparent: true, depthWrite: false, opacity: 0.85 }))
  // wrap the strip around the ring: remap uv by angle
  const zp = zodiac.geometry.attributes.position as THREE.BufferAttribute
  const zuv = zodiac.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < zp.count; i++) {
    const ang = Math.atan2(zp.getY(i), zp.getX(i))
    const rad = Math.hypot(zp.getX(i), zp.getY(i))
    zuv.setXY(i, (ang / (Math.PI * 2) + 1) % 1, (rad - 4.0) / 0.9)
  }
  zodiac.rotation.x = -Math.PI / 2
  zodiac.position.y = 0.08
  g.add(zodiac)
  on((dt, t, night, near) => {
    dome.rotation.y = Math.sin(t * 0.15) * 0.6
    planets.forEach((p, i) => (p.g.rotation.y += dt * p.speed * (1 + near * 2) * (i % 2 ? -1 : 1)))
    zodiac.rotation.z = t * 0.05
    ;(zodiac.material as THREE.MeshBasicMaterial).opacity = 0.35 + night * 0.6
    halo.material.opacity = 0.4 + night * 0.6
  })
}

function mastermind({ g, physics, on }: Ctx) {
  const ab = new THREE.Group()
  ab.position.set(0, 0, -1)
  g.add(ab)
  const wood = M('#a8642e', 0.6)
  const W = 8.4
  const H = 5
  for (const sx of [-1, 1]) {
    box(ab, 0.45, H + 1.2, 0.6, wood, sx * (W / 2 + 0.2), (H + 1.2) / 2, 0)
    box(ab, 1.2, 0.3, 1.6, wood, sx * (W / 2 + 0.2), 0.15, 0)
  }
  box(ab, W + 0.8, 0.45, 0.6, wood, 0, H + 0.95, 0)
  box(ab, W + 0.8, 0.4, 0.6, wood, 0, 0.95, 0)
  box(ab, W, 0.22, 0.5, M('#5b3418', 0.6), 0, 3.6, 0)
  const rods = 7
  const beadGeo = new THREE.LatheGeometry([new THREE.Vector2(0.02, -0.26), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.02, 0.26)], 18)
  const colors = ['#ff4d4d', '#ff8c42', '#ffd23f', '#3ec97a', '#4fb3ff', '#7a6bff', '#ff6bcb']
  const beads: { m: THREE.Mesh; rod: number; heaven: boolean; idx: number }[] = []
  for (let r = 0; r < rods; r++) {
    const x = -W / 2 + 0.75 + r * ((W - 1.5) / (rods - 1))
    cyl(ab, 0.05, 0.05, H - 0.2, M('#d7d2c8', 0.3, 0.6), x, 1.1 + (H - 0.2) / 2, 0, 8)
    const m = M(colors[r], 0.35)
    const hb = mesh(ab, beadGeo, m, x, 4.3, 0)
    beads.push({ m: hb, rod: r, heaven: true, idx: 0 })
    for (let k = 0; k < 4; k++) {
      const eb = mesh(ab, beadGeo, m, x, 1.45 + k * 0.53, 0)
      beads.push({ m: eb, rod: r, heaven: false, idx: k })
    }
  }
  physics.localBox(ab, new THREE.Vector3(0, H / 2 + 0.6, 0), new THREE.Vector3(W / 2 + 0.6, H / 2 + 0.6, 0.6))
  const sign = signTexture(1100, 220, '#f26b3a', [
    { text: 'MASTERMIND ABACUS', size: 92, y: 88, weight: 800, color: '#ffffff' },
    { text: 'ODISHA · THE BRAIN BOOSTER', size: 34, y: 168, font: FONT.mono, color: '#fff3e6' },
  ])
  plane(ab, 6, 1.2, sign, 0, H + 1.85, 0.32, 0.3)
  box(ab, 6.2, 1.35, 0.12, M('#f26b3a'), 0, H + 1.85, 0.24)
  // the abacus counts: rods are decimal digits (rightmost = ones), beads slide to the bar
  on((dt, t, _night, near) => {
    const value = Math.floor(t * (1.2 + near * 3)) * 137
    for (const b of beads) {
      const place = rods - 1 - b.rod
      const digit = Math.floor(value / Math.pow(10, place)) % 10
      const target = b.heaven ? (digit >= 5 ? 3.97 : 4.42) : 1.45 + b.idx * 0.53 + (b.idx >= 4 - (digit % 5) ? 0.26 : 0)
      b.m.position.y += (target - b.m.position.y) * (1 - Math.exp(-10 * dt))
    }
  })
}

function gftd({ g, physics, on }: Ctx) {
  const big = new THREE.Group()
  big.position.set(1.5, 0, -1.5)
  g.add(big)
  const navy = M('#1d2a6b', 0.5)
  const goldR = M('#e3b23c', 0.35, 0.6)
  rbox(big, 2.8, 2.6, 2.8, 0.08, navy, 0, 1.3, 0)
  box(big, 2.84, 2.62, 0.4, goldR, 0, 1.3, 0)
  box(big, 0.4, 2.62, 2.84, goldR, 0, 1.3, 0)
  const lid = new THREE.Group()
  lid.position.y = 2.6
  big.add(lid)
  rbox(lid, 3.0, 0.5, 3.0, 0.08, navy, 0, 0.25, 0)
  box(lid, 3.04, 0.52, 0.42, goldR, 0, 0.25, 0)
  box(lid, 0.42, 0.52, 3.04, goldR, 0, 0.25, 0)
  for (const s of [-1, 1]) {
    const loop = mesh(lid, new THREE.TorusGeometry(0.42, 0.11, 8, 18), goldR, s * 0.36, 0.86, 0)
    loop.rotation.y = s * 0.6
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,225,140,1)', 'rgba(255,200,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }))
  glow.position.y = 3.2
  glow.scale.setScalar(5)
  big.add(glow)
  physics.localBox(big, new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(1.45, 1.4, 1.45))
  const sign = signTexture(900, 220, '#1d2a6b', [
    { text: 'GFTD', size: 120, y: 92, font: FONT.serif, weight: 400, color: '#e3b23c' },
    { text: 'THE ART OF GIFTING', size: 32, y: 172, font: FONT.mono, color: '#f6ead0' },
  ])
  const plate = plane(g, 3.4, 0.83, sign, -3.2, 0.9, 2.2, 0.3)
  plate.rotation.set(-0.15, 0.3, 0)
  on((_dt, t, night, near) => {
    const cycle = (t * 0.35) % 1
    const open = cycle < 0.25 ? Math.sin((cycle / 0.25) * Math.PI) : 0
    const o = Math.max(open, near * 0.6)
    lid.position.y = 2.6 + o * 1.2
    lid.rotation.z = o * 0.35
    glow.material.opacity = o * (0.6 + night * 0.4)
  })
}

function agile({ g, physics, on }: Ctx) {
  const crane = new THREE.Group()
  crane.position.set(-2.5, 0, -2)
  g.add(crane)
  const yellow = M('#f2b705', 0.55, 0.2)

  const mastH = 15
  // lattice mast
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) box(crane, 0.12, mastH, 0.12, yellow, x, mastH / 2, z)
  for (let y = 1; y < mastH; y += 1.2) {
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const brace = box(crane, 1.0, 0.07, 0.07, yellow, 0, y, 0)
      brace.position.set(Math.sin(r) * 0.5, y, Math.cos(r) * 0.5)
      brace.rotation.set(0, r, 0.75)
    }
  }
  box(crane, 1.6, 0.4, 1.6, M('#3b3f48'), 0, 0.2, 0)
  const top = new THREE.Group()
  top.position.y = mastH
  crane.add(top)
  box(top, 1.4, 1.1, 1.3, M('#f4f4ee', 0.5), 0.9, 0.55, 0.9)
  box(top, 13, 0.5, 0.7, yellow, 4.6, 1.3, 0)
  box(top, 5, 0.5, 0.7, yellow, -3.1, 1.3, 0)
  box(top, 1.6, 1.4, 1.2, M('#6b6f78', 0.8), -4.6, 0.7, 0)
  const peak = box(top, 0.18, 3.2, 0.18, yellow, 0, 2.9, 0)
  peak.castShadow = true
  const trolley = new THREE.Group()
  trolley.position.set(7, 1, 0)
  top.add(trolley)
  const cable = box(trolley, 0.04, 6, 0.04, M('#1d1c21'), 0, -3, 0)
  cable.castShadow = false
  const beam = box(trolley, 3.4, 0.35, 0.3, M('#c0392b', 0.5, 0.4), 0, -6.2, 0)
  physics.localBox(crane, new THREE.Vector3(0, 4, 0), new THREE.Vector3(0.9, 4, 0.9))

  // a building in progress
  const site = new THREE.Group()
  site.position.set(4.5, 0, -2.5)
  g.add(site)
  box(site, 6, 0.3, 4.4, M('#b9b4aa', 0.9), 0, 0.15, 0)
  for (const [x, z] of [[-2.7, -2], [2.7, -2], [-2.7, 2], [2.7, 2], [0, -2], [0, 2]]) box(site, 0.3, 6, 0.3, M('#9aa0a8', 0.8), x, 3, z)
  box(site, 6, 0.25, 4.4, M('#b9b4aa', 0.9), 0, 3.1, 0)
  box(site, 6, 0.25, 4.4, M('#b9b4aa', 0.9), 0, 6.1, 0)
  physics.localBox(site, new THREE.Vector3(0, 3.1, 0), new THREE.Vector3(3, 3.1, 2.2))
  const sign = signTexture(1100, 220, '#1e5a2a', [
    { text: 'AGILE ENGINEERING', size: 88, y: 86, weight: 800, color: '#ffffff' },
    { text: 'CIVIL · MECH · ELECTRICAL · KOLKATA', size: 32, y: 168, font: FONT.mono, color: '#d9f0d9' },
  ])
  const plate = plane(g, 4.4, 0.88, sign, 4.6, 0.95, 2.4, 0.25)
  plate.rotation.x = -0.15
  on((_dt, t, _night, near) => {
    top.rotation.y = Math.sin(t * 0.18) * 1.1 + 0.4
    trolley.position.x = 5.5 + Math.sin(t * 0.4) * 2.2
    beam.rotation.y = Math.sin(t * 0.9) * 0.3 + near * 0.2
  })
}

function ideashapers({ g, physics, on }: Ctx) {
  const lamp = new THREE.Group()
  lamp.position.set(0, 0, -0.5)
  g.add(lamp)
  cyl(lamp, 1.6, 1.8, 0.8, M('#1e2a78', 0.4, 0.2), 0, 0.4, 0, 32)
  // screw base
  for (let i = 0; i < 5; i++) cyl(lamp, 0.95 - (i % 2) * 0.06, 0.95 - (i % 2) * 0.06, 0.24, M('#c9ccd3', 0.25, 0.9), 0, 1.0 + i * 0.24, 0, 24)
  const bulbProfile = [[0.9, 0], [1.0, 0.4], [1.9, 1.5], [2.2, 2.6], [1.9, 3.7], [1.1, 4.3], [0, 4.45]].map(([x, y]) => new THREE.Vector2(x, y))
  const glassMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, emissive: '#ffd36b', emissiveIntensity: 0.05, depthWrite: false })
  const bulb = mesh(lamp, new THREE.LatheGeometry(bulbProfile, 36), glassMat, 0, 2.15, 0, false)
  bulb.renderOrder = 3
  // an S-shaped filament: S for Shapers
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.5, 2.4, 0), new THREE.Vector3(-0.2, 3.0, 0), new THREE.Vector3(0.5, 3.4, 0), new THREE.Vector3(0.4, 4.0, 0),
    new THREE.Vector3(-0.4, 4.3, 0), new THREE.Vector3(-0.5, 4.9, 0), new THREE.Vector3(0.2, 5.2, 0), new THREE.Vector3(0.6, 5.0, 0),
  ])
  const filMat = new THREE.MeshBasicMaterial({ color: '#ffcf5a' })
  mesh(lamp, new THREE.TubeGeometry(curve, 64, 0.07, 8, false), filMat, 0, 0, 0, false)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,220,120,1)', 'rgba(255,190,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2 }))
  halo.position.y = 4.4
  halo.scale.setScalar(7)
  lamp.add(halo)
  physics.localCylinder(lamp, new THREE.Vector3(0, 2.5, 0), 2.0, 5)
  const sign = signTexture(1000, 220, '#ffffff', [
    { text: 'IDEA SHAPERS', size: 96, y: 88, weight: 800, color: '#1e2a78' },
    { text: 'BRANDS THE WORLD CAN’T IGNORE', size: 30, y: 168, font: FONT.mono, color: '#7a1f3d' },
  ])
  const plate = plane(g, 4, 0.88, sign, 0, 0.95, 2.3, 0.2)
  plate.rotation.x = -0.15
  on((_dt, t, night, near) => {
    const on = Math.max(night, near * 0.7)
    const flick = 1 + Math.sin(t * 23) * 0.03
    glassMat.emissiveIntensity = (0.05 + on * 0.9) * flick
    glassMat.opacity = 0.32 + on * 0.25
    halo.material.opacity = (0.15 + on * 0.85) * flick
    filMat.color.setHSL(0.12, 1, 0.55 + on * 0.25)
  })
}

function fuel({ g, physics, on, a }: Ctx) {
  const st = new THREE.Group()
  st.position.set(0, 0, 0.5)
  g.add(st)
  const canopyLights = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 0.2 })
  box(st, 12, 0.7, 7, M('#f4f2ee', 0.5), 0, 4.6, 0)
  const fascia = signTexture(1600, 100, '#ffc61a', [{ text: 'AKASH FUEL · OPEN 24×7 · NO REFUSAL', size: 58, y: 52, weight: 800, color: '#141218' }])
  plane(st, 12, 0.7, fascia, 0, 4.6, 3.51, 0.3)
  const under = mesh(st, new THREE.PlaneGeometry(10, 5).rotateX(Math.PI / 2), canopyLights, 0, 4.24, 0, false)
  under.receiveShadow = false
  for (const [x, z] of [[-4.5, -2.5], [4.5, -2.5], [-4.5, 2.5], [4.5, 2.5]]) {
    cyl(st, 0.22, 0.22, 4.25, M('#d6d2ca', 0.5), x, 2.12, z, 12)
    physics.localCylinder(st, new THREE.Vector3(x, 2.12, z), 0.24, 4.25)
  }
  for (const x of [-2.2, 2.2]) {
    const pump = new THREE.Group()
    pump.position.set(x, 0, 0)
    st.add(pump)
    rbox(pump, 0.9, 1.9, 0.6, 0.06, M('#d6382b', 0.5), 0, 0.95, 0)
    box(pump, 0.6, 0.4, 0.05, M('#141218', 0.3, 0, { emissive: '#ff4d3a', emissiveIntensity: 0.6 }), 0, 1.45, 0.31)
    box(pump, 1.1, 0.25, 0.8, M('#9a958c'), 0, 0.12, 0)
    physics.localBox(pump, new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0.5, 0.95, 0.35))
  }
  // price board listing skills instead of fuel
  const { c, g: x } = canvas(512, 900)
  x.fillStyle = '#141218'
  x.fillRect(0, 0, 512, 900)
  x.fillStyle = '#ffc61a'
  x.fillRect(0, 0, 512, 110)
  x.fillStyle = '#141218'
  x.font = `800 52px ${FONT.display}`
  x.textAlign = 'center'
  x.fillText("TODAY'S RATES", 256, 72)
  const rows = [['REACT', '99.9'], ['NEXT.JS', '99.5'], ['NODE.JS', '98.7'], ['THREE.JS', '97.2'], ['GSAP', '98.1'], ['FLUTTER', '95.4'], ['POSTGRES', '96.8'], ['DEVOPS', '99.0']]
  x.font = `700 44px ${FONT.mono}`
  rows.forEach(([k, v], i) => {
    const y = 180 + i * 90
    x.textAlign = 'left'
    x.fillStyle = '#ffffff'
    x.fillText(k, 32, y)
    x.textAlign = 'right'
    x.fillStyle = '#ff4d3a'
    x.fillText(v, 480, y)
  })
  const boardTex = toTexture(c)
  const board = new THREE.Group()
  // on the side the story camera looks towards, so the rates are readable
  board.position.set(7.6 * (a.place.side === 1 ? -1 : 1), 0, 2.6)
  board.rotation.y = -0.4 * (a.place.side === 1 ? -1 : 1)
  g.add(board)
  plane(board, 2.2, 3.87, boardTex, 0, 3.4, 0.08, 0.6)
  box(board, 2.4, 4.05, 0.14, M('#141218'), 0, 3.4, 0)
  box(board, 0.25, 1.4, 0.25, M('#3b3640'), 0, 0.7, 0)
  physics.localBox(board, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.3, 1, 0.3))
  on((_dt, _t, night) => {
    canopyLights.emissiveIntensity = 0.2 + night * 1.8
  })
}

function lastStop({ g, physics, textures, on }: Ctx) {
  // India Post pillar box
  const post = new THREE.Group()
  post.position.set(-3.2, 0, 2)
  g.add(post)
  const red = M('#d32323', 0.45)
  cyl(post, 0.62, 0.66, 1.9, red, 0, 0.95, 0, 28)
  mesh(post, new THREE.SphereGeometry(0.66, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 1.9, 0)
  cyl(post, 0.67, 0.67, 0.12, M('#1b1a20'), 0, 1.62, 0, 28)
  box(post, 0.6, 0.06, 0.2, M('#1b1a20'), 0, 1.45, 0.6)
  const plaque = signTexture(256, 128, '#f4f0e6', [{ text: 'POST', size: 64, y: 50, weight: 800, color: '#d32323' }, { text: 'LETTERS', size: 26, y: 100, font: FONT.mono, color: '#141218' }])
  const pl = plane(post, 0.6, 0.3, plaque, 0, 1.1, 0.66)
  pl.rotation.x = 0
  cyl(post, 0.72, 0.76, 0.14, M('#8f8a80'), 0, 0.07, 0, 28)
  physics.localCylinder(post, new THREE.Vector3(0, 1, 0), 0.7, 2)

  // shelter with a poster of Akash
  const sh = new THREE.Group()
  sh.position.set(2.2, 0, 0)
  g.add(sh)
  const steel = M('#2b2830', 0.5, 0.4)
  box(sh, 5, 0.18, 2.2, M('#ffc61a', 0.5), 0, 2.85, 0)
  for (const sx of [-1, 1]) box(sh, 0.14, 2.8, 0.14, steel, sx * 2.3, 1.4, -0.9)
  box(sh, 4.6, 2.2, 0.06, M('#9fd0f0', 0.1, 0.2, { transparent: true, opacity: 0.35 }), 0, 1.5, -1.0)
  rbox(sh, 3.4, 0.12, 0.6, 0.04, M('#7a4a28'), 0, 0.6, -0.5)
  for (const sx of [-1, 1]) box(sh, 0.1, 0.6, 0.5, steel, sx * 1.4, 0.3, -0.5)
  const photo = textures.get('img/people/akash-cutout.webp')
  const poster = (() => {
    const { c, g: x } = canvas(512, 720)
    const grd = x.createLinearGradient(0, 0, 0, 720)
    grd.addColorStop(0, '#ffc61a')
    grd.addColorStop(1, '#ff8a3a')
    x.fillStyle = grd
    x.fillRect(0, 0, 512, 720)
    x.fillStyle = '#141218'
    x.font = `800 64px ${FONT.display}`
    x.textAlign = 'center'
    x.fillText('LET’S BUILD', 256, 600)
    x.fillText('SOMETHING.', 256, 664)
    return c
  })()
  const posterTex = toTexture(poster)
  const img = photo?.image as HTMLImageElement | ImageBitmap | undefined
  if (img) {
    const x = poster.getContext('2d')!
    const w = 420
    const h = (img.height / img.width) * w
    x.drawImage(img as CanvasImageSource, 256 - w / 2, 40, w, Math.min(h, 520))
    posterTex.needsUpdate = true
  }
  const pm = plane(sh, 1.5, 2.1, posterTex, 1.4, 1.65, -0.94, 0.25)
  pm.castShadow = false
  physics.localBox(sh, new THREE.Vector3(0, 1.4, -0.9), new THREE.Vector3(2.4, 1.4, 0.2))
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }))
  lampGlow.position.set(0, 2.6, 0)
  lampGlow.scale.setScalar(4)
  sh.add(lampGlow)
  on((_dt, _t, night) => {
    lampGlow.material.opacity = night * 0.8
  })
}

const BUILDERS: Record<string, (ctx: Ctx) => void> = {
  boarding,
  egra,
  neotia,
  'first-jobs': firstJobs,
  xeta,
  picaku,
  lifeapp,
  gobt,
  pizzahap,
  gharkamali,
  altaqwa,
  accurateastro,
  mastermind,
  gftd,
  agile,
  ideashapers,
  fuel,
  'last-stop': lastStop,
}

export class Landmarks {
  readonly group = new THREE.Group()
  private updaters: { fn: Updater; anchor: StopAnchor }[] = []
  readonly bridge: Bridge
  readonly city: City

  constructor(physics: Physics, textures: Map<string, THREE.Texture>, env: THREE.Texture | null) {
    for (const a of ANCHORS) {
      const g = new THREE.Group()
      g.position.copy(a.landmark)
      g.rotation.y = a.faceYaw
      g.updateMatrixWorld(true)
      this.group.add(g)
      const build = BUILDERS[a.id]
      if (build) {
        build({ a, g, physics, textures, env, on: (fn) => this.updaters.push({ fn, anchor: a }) })
      }
      milestone(this.group, physics, a)
      const stop = STOPS[a.index]
      if (stop.kind === 'project' && stop.project) {
        const p = PROJECTS[stop.project]
        billboard(this.group, physics, a, textures.get(p.texture), p.name.toUpperCase())
      }
    }
    this.bridge = new Bridge(physics)
    this.group.add(this.bridge.group)
    this.city = new City(physics)
    this.group.add(this.city.group)
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.matrixAutoUpdate = true
    })
  }

  update(dt: number, t: number, night: number, car: THREE.Vector3) {
    for (const u of this.updaters) {
      const d = Math.hypot(car.x - u.anchor.landmark.x, car.z - u.anchor.landmark.z)
      const near = Math.max(0, Math.min(1, (24 - d) / 14))
      u.fn(dt, t, night, near)
    }
    this.bridge.update(night)
    this.city.update(night)
  }
}
