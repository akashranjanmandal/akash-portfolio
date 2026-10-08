import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { canvas, toTexture, FONT } from '../textures'

/* ──────────────────────────────────────────────────────────────
   THE TAXI
   A toy-scale Hindustan Ambassador in Kolkata yellow. Built from a
   side-profile silhouette extruded across its width, with a narrower
   glasshouse on top. Local frame: +Z forward, +Y up, ground at y=0.
────────────────────────────────────────────────────────────── */

export const TAXI = {
  wheelRadius: 0.3,
  wheelX: 0.53,
  frontZ: 0.86,
  rearZ: -0.84,
  bodyWidth: 1.14,
  cabinWidth: 0.98,
}

export type TaxiParts = {
  root: THREE.Group
  body: THREE.Group
  wheels: THREE.Group[]
  headlightMaterial: THREE.MeshStandardMaterial
  tailMaterial: THREE.MeshStandardMaterial
  beams: THREE.Mesh
  exhaust: THREE.Vector3
  lampMaterial: THREE.MeshStandardMaterial
}

const M2 = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.5 })

function bodyShape() {
  const s = new THREE.Shape()
  const arch = (zc: number) => {
    const r = 0.37
    const dy = 0.24 - 0.3
    const dz = Math.sqrt(r * r - dy * dy)
    s.lineTo(zc - dz, 0.24)
    s.absarc(zc, 0.3, r, Math.atan2(dy, -dz), Math.atan2(dy, dz), true)
  }
  s.moveTo(-1.37, 0.46)
  s.lineTo(-1.37, 0.31)
  s.quadraticCurveTo(-1.36, 0.24, -1.29, 0.24)
  arch(TAXI.rearZ)
  arch(TAXI.frontZ)
  s.lineTo(1.3, 0.24)
  s.quadraticCurveTo(1.38, 0.25, 1.38, 0.33)
  s.lineTo(1.39, 0.52)
  s.quadraticCurveTo(1.38, 0.64, 1.27, 0.68)
  // long bonnet rising gently to the windscreen
  s.quadraticCurveTo(0.95, 0.76, 0.58, 0.79)
  // beltline
  s.lineTo(-0.74, 0.8)
  // rounded boot
  s.quadraticCurveTo(-1.14, 0.8, -1.3, 0.7)
  s.quadraticCurveTo(-1.38, 0.64, -1.37, 0.46)
  return s
}

function cabinShape(scaleZ = 1, scaleY = 1) {
  const cz = -0.08
  const cy = 0.93
  const P = (z: number, y: number) => new THREE.Vector2(cz + (z - cz) * scaleZ, cy + (y - cy) * scaleY)
  const s = new THREE.Shape()
  const p0 = P(0.6, 0.77)
  s.moveTo(p0.x, p0.y)
  const p1 = P(0.25, 1.1)
  const c1 = P(0.42, 0.98)
  s.quadraticCurveTo(c1.x, c1.y, p1.x, p1.y)
  const p2 = P(-0.44, 1.11)
  const c2 = P(-0.1, 1.17)
  s.quadraticCurveTo(c2.x, c2.y, p2.x, p2.y)
  const p3 = P(-0.76, 0.78)
  const c3 = P(-0.66, 1.0)
  s.quadraticCurveTo(c3.x, c3.y, p3.x, p3.y)
  const p4 = P(0.6, 0.75)
  s.lineTo(p4.x, p4.y)
  s.closePath()
  return s
}

/** extrude a side profile across the car's width, centred on x=0, profile z → +Z */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 18,
  })
  geo.translate(0, 0, -(width - bevel * 2) / 2)
  // shape x is the car's length: rotate so shape-x → +Z and extrusion → X
  geo.rotateY(-Math.PI / 2)
  geo.computeVertexNormals()
  return geo
}

/** door seams, handles and the famous promise. `side` decides how car z maps to texture u. */
function sideDecalTexture(side: 1 | -1) {
  const { c, g } = canvas(1024, 256)
  const u = (z: number) => ((side === 1 ? -z : z) + 1.05) / 2.1 * 1024
  g.strokeStyle = 'rgba(40,30,0,0.55)'
  g.lineWidth = 4
  for (const z of [0.55, -0.08, -0.72]) {
    const x = u(z)
    g.beginPath()
    g.moveTo(x, 18)
    g.quadraticCurveTo(x + 4, 130, x, 240)
    g.stroke()
  }
  g.fillStyle = '#d5d8de'
  for (const z of [0.07, -0.6]) g.fillRect(u(z) - 19, 58, 38, 10)
  g.fillStyle = '#17151b'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `800 48px ${FONT.display}`
  g.fillText('NO REFUSAL', u(-0.08), 160)
  g.font = `600 21px ${FONT.mono}`
  g.fillText('FULL-STACK · DEVOPS', u(-0.08), 206)
  return toTexture(c, { aniso: 8 })
}

function plateTexture() {
  const { c, g } = canvas(256, 64)
  g.fillStyle = '#ffd21a'
  g.fillRect(0, 0, 256, 64)
  g.strokeStyle = '#141218'
  g.lineWidth = 5
  g.strokeRect(4, 4, 248, 56)
  g.fillStyle = '#141218'
  g.font = `800 34px ${FONT.mono}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('WB 04 AK 24', 128, 34)
  return toTexture(c, { aniso: 8 })
}

export function buildTaxi(envMap: THREE.Texture | null): TaxiParts {
  const root = new THREE.Group()
  root.name = 'taxi'
  const body = new THREE.Group()
  root.add(body)

  const paint = new THREE.MeshPhysicalMaterial({ color: '#ffc414', roughness: 0.38, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, envMap, envMapIntensity: 0.6 })
  const chrome = new THREE.MeshStandardMaterial({ color: '#e9ebf0', roughness: 0.18, metalness: 1, envMap, envMapIntensity: 1.1 })
  const glass = new THREE.MeshStandardMaterial({ color: '#172030', roughness: 0.05, metalness: 0.35, envMap, envMapIntensity: 1.6 })
  const dark = new THREE.MeshStandardMaterial({ color: '#17161b', roughness: 0.7 })
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d1c21', roughness: 0.9 })
  const headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff1c4', emissiveIntensity: 0.2, roughness: 0.2 })
  const tailMaterial = new THREE.MeshStandardMaterial({ color: '#c41a1a', emissive: '#ff2a1a', emissiveIntensity: 0.25, roughness: 0.3 })
  const amber = new THREE.MeshStandardMaterial({ color: '#ff9d1a', emissive: '#ff8a00', emissiveIntensity: 0.3, roughness: 0.3 })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast
    body.add(m)
    return m
  }

  // shell
  add(extrudeAcross(bodyShape(), TAXI.bodyWidth, 0.06), paint)
  // glasshouse: painted cabin + glass inset proud of the sides
  add(extrudeAcross(cabinShape(), TAXI.cabinWidth, 0.07), paint)
  const glassHouse = add(extrudeAcross(cabinShape(0.9, 0.78), TAXI.cabinWidth + 0.02, 0.06), glass, false)
  glassHouse.renderOrder = 2

  // windscreen and rear glass laid along the chord of each slope, nudged outward
  const pane = (z0: number, y0: number, z1: number, y1: number, width: number) => {
    const dz = z1 - z0
    const dy = y1 - y0
    const len = Math.hypot(dz, dy)
    const mz = (z0 + z1) / 2
    const my = (y0 + y1) / 2
    let nz = dy / len
    let ny = -dz / len
    // point the normal away from the middle of the cabin
    if ((mz - -0.08) * nz + (my - 0.93) * ny < 0) {
      nz = -nz
      ny = -ny
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len * 0.82), glass)
    m.position.set(0, my + ny * 0.03, mz + nz * 0.03)
    m.lookAt(0, my + ny * 2, mz + nz * 2)
    body.add(m)
  }
  pane(0.6, 0.77, 0.25, 1.1, 0.8)
  pane(-0.44, 1.11, -0.76, 0.78, 0.78)

  // B-pillars splitting the side glass into two windows
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.27, 0.07), paint)
    p.position.set(sx * (TAXI.cabinWidth / 2 + 0.005), 0.93, -0.08)
    body.add(p)
  }

  // side decals: door seams, handles, NO REFUSAL (alpha-tested, so no sorting issues)
  for (const sx of [-1, 1] as const) {
    const decal = new THREE.MeshStandardMaterial({ map: sideDecalTexture(sx), alphaTest: 0.35, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 })
    const d = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.52), decal)
    d.position.set(sx * (TAXI.bodyWidth / 2 + 0.004), 0.53, 0)
    d.rotation.y = (sx * Math.PI) / 2
    body.add(d)
  }

  // grille, headlights, indicators
  const grilleBack = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.18, 0.05, 2, 0.02), dark)
  grilleBack.position.set(0, 0.5, 1.375)
  body.add(grilleBack)
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.018, 0.03), chrome)
    bar.position.set(0, 0.43 + i * 0.045, 1.4)
    body.add(bar)
  }
  const grilleFrame = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 24), chrome)
  grilleFrame.scale.set(3.3, 1.05, 1)
  grilleFrame.position.set(0, 0.5, 1.4)
  body.add(grilleFrame)
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 20).rotateX(Math.PI / 2), headlightMaterial)
    lamp.position.set(sx * 0.42, 0.53, 1.37)
    body.add(lamp)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 24), chrome)
    ring.position.set(sx * 0.42, 0.53, 1.4)
    body.add(ring)
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.04), amber)
    ind.position.set(sx * 0.42, 0.39, 1.385)
    body.add(ind)
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.05, 2, 0.02), tailMaterial)
    tail.position.set(sx * 0.42, 0.56, -1.375)
    body.add(tail)
    // side mirror
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.07, 0.1, 2, 0.02), dark)
    mirror.position.set(sx * (TAXI.bodyWidth / 2 + 0.05), 0.86, 0.5)
    body.add(mirror)
  }

  // bumpers
  for (const z of [1.43, -1.43]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.1, 0.1, 3, 0.04), chrome)
    b.position.set(0, 0.31, z)
    b.castShadow = true
    body.add(b)
  }
  // number plates
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 })
  for (const [z, ry] of [[1.485, 0], [-1.485, Math.PI]] as const) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.09), plate)
    p.position.set(0, 0.31, z)
    p.rotation.y = ry
    body.add(p)
  }

  // roof rack with a suitcase strapped on
  const rack = new THREE.Group()
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.62), chrome)
    rail.position.set(sx * 0.36, 1.2, -0.1)
    rack.add(rail)
  }
  for (const z of [-0.36, 0.16]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.025, 0.03), chrome)
    bar.position.set(0, 1.2, z)
    rack.add(bar)
    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), chrome)
      foot.position.set(sx * 0.36, 1.15, z)
      rack.add(foot)
    }
  }
  const suitcase = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.17, 0.36, 3, 0.04), new THREE.MeshStandardMaterial({ color: '#8a4b2a', roughness: 0.6 }))
  suitcase.position.set(0.04, 1.3, -0.12)
  suitcase.rotation.y = 0.12
  suitcase.castShadow = true
  rack.add(suitcase)
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.37), new THREE.MeshStandardMaterial({ color: '#2b2622' }))
  strap.position.copy(suitcase.position)
  strap.rotation.y = 0.12
  rack.add(strap)
  body.add(rack)

  // interior seen through the glass: bench seats, a steering wheel on the right (Indian taxi), a driver
  const seat = new THREE.MeshStandardMaterial({ color: '#5a2a24', roughness: 0.8 })
  for (const z of [0.22, -0.42]) {
    const sb = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.12, 0.42, 2, 0.04), seat)
    sb.position.set(0, 0.62, z)
    body.add(sb)
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.36, 0.1, 2, 0.04), seat)
    back.position.set(0, 0.8, z - 0.2)
    body.add(back)
  }
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 18), dark)
  wheelRing.position.set(-0.24, 0.86, 0.46)
  wheelRing.rotation.x = -0.9
  body.add(wheelRing)
  const driver = new THREE.Group()
  driver.position.set(-0.24, 0.94, 0.2)
  body.add(driver)
  const skin = new THREE.MeshStandardMaterial({ color: '#8d5a3b', roughness: 0.7 })
  const shirt = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.8 })
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.12, 4, 8), shirt)
  torso.position.y = -0.06
  driver.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), skin)
  head.position.y = 0.15
  driver.add(head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark)
  hair.position.y = 0.165
  driver.add(hair)

  // chrome side trims and beltline
  for (const sx of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 2.05), chrome)
    trim.position.set(sx * (TAXI.bodyWidth / 2 + 0.012), 0.6, 0.02)
    body.add(trim)
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.25), chrome)
    belt.position.set(sx * (TAXI.cabinWidth / 2 + 0.03), 0.79, -0.08)
    body.add(belt)
    // mud flaps behind each wheel
    for (const z of [TAXI.frontZ - 0.42, TAXI.rearZ - 0.42]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.02), dark)
      flap.position.set(sx * TAXI.wheelX, 0.17, z)
      body.add(flap)
    }
  }
  // wipers resting on the windscreen
  for (const x of [-0.2, 0.22]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.02), dark)
    w.position.set(x, 0.82, 0.6)
    w.rotation.set(-0.7, 0, x > 0 ? 0.1 : -0.1)
    body.add(w)
  }
  // bonnet emblem
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), chrome)
  emblem.position.set(0, 0.72, 1.24)
  emblem.rotation.x = -0.35
  body.add(emblem)
  // roof TAXI lamp, lit at night
  const taxiSign = (() => {
    const { c, g } = canvas(256, 80)
    g.fillStyle = '#141218'
    g.fillRect(0, 0, 256, 80)
    g.fillStyle = '#ffe28a'
    g.font = `800 52px ${FONT.display}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('TAXI', 128, 44)
    return toTexture(c)
  })()
  const lampMat = new THREE.MeshStandardMaterial({ map: taxiSign, emissive: '#ffffff', emissiveMap: taxiSign, emissiveIntensity: 0.3, roughness: 0.4 })
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.16), [M2('#141218'), M2('#141218'), M2('#141218'), M2('#141218'), lampMat, lampMat])
  lamp.position.set(0, 1.25, 0.22)
  body.add(lamp)

  // exhaust pipe
  const exhaust = new THREE.Vector3(-0.38, 0.27, -1.42)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8).rotateX(Math.PI / 2), chrome)
  pipe.position.copy(exhaust)
  body.add(pipe)

  // wheels
  const tyreProfile = [
    new THREE.Vector2(0.16, -0.115),
    new THREE.Vector2(0.255, -0.115),
    new THREE.Vector2(0.295, -0.085),
    new THREE.Vector2(0.302, 0),
    new THREE.Vector2(0.295, 0.085),
    new THREE.Vector2(0.255, 0.115),
    new THREE.Vector2(0.16, 0.115),
  ]
  const tyreGeo = new THREE.LatheGeometry(tyreProfile, 22).rotateZ(Math.PI / 2)
  const hubGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.24, 18).rotateZ(Math.PI / 2)
  const whitewall = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.6 })
  const capGeo = new THREE.SphereGeometry(0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2)
  const wheels: THREE.Group[] = []
  for (const [sx, z] of [[1, TAXI.frontZ], [-1, TAXI.frontZ], [1, TAXI.rearZ], [-1, TAXI.rearZ]] as const) {
    const w = new THREE.Group()
    const spin = new THREE.Group()
    const tyre = new THREE.Mesh(tyreGeo, rubber)
    tyre.castShadow = true
    spin.add(tyre)
    const hub = new THREE.Mesh(hubGeo, chrome)
    spin.add(hub)
    const wall = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.028, 6, 24).rotateY(Math.PI / 2), whitewall)
    wall.position.x = sx * 0.112
    spin.add(wall)
    const cap = new THREE.Mesh(capGeo, chrome)
    cap.position.x = sx * 0.12
    cap.scale.x = sx
    spin.add(cap)
    // a dark spoke mark so the spin is readable
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.245, 0.2, 0.03), dark)
    spin.add(mark)
    w.add(spin)
    w.position.set(sx * TAXI.wheelX, TAXI.wheelRadius, z)
    w.userData.spin = spin
    root.add(w)
    wheels.push(w)
  }

  // soft headlight beams for the night drive
  const beamGeo = new THREE.ConeGeometry(1.5, 6, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 4.4)
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff3c9', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, map: beamTexture() })
  const beams = new THREE.Mesh(beamGeo, beamMat)
  beams.position.set(0, 0.5, 0.9)
  beams.rotation.x = 0.1
  beams.renderOrder = 5
  body.add(beams)

  return { root, body, wheels, headlightMaterial, tailMaterial, beams, exhaust, lampMaterial: lampMat }
}

function beamTexture() {
  const { c, g } = canvas(64, 256)
  const grd = g.createLinearGradient(0, 0, 0, 256)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,1)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 256)
  return toTexture(c, { srgb: false })
}
