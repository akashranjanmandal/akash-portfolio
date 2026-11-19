import * as THREE from 'three'
import type { Physics } from '../Physics'
import type { Materials } from '../city/Town'
import { noise2 } from '../../utils/math'

/* A tunnel through a hill: the way between the city and the mountains.
   A concrete portal wall, a lit bore you can drive into, and a rock mound
   behind it. Driving to the far end of the bore moves you to the other region. */

export type PortalOpts = {
  /** centre x and z of the mouth */
  x: number
  z: number
  /** +1 if the tunnel body runs towards +z from the mouth, -1 towards -z */
  dir: 1 | -1
  roadY: number
  width: number
  length: number
  title: string
  sub: string
  rock: THREE.Material
}

export function labelTexture(lines: string[], bg: string, fg: string, w = 1024, h = 256, accent = '#ffc61a') {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.fillStyle = accent
  g.fillRect(0, h - 10, w, 10)
  g.fillStyle = fg
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  const sizes = [h * 0.36, h * 0.17, h * 0.14]
  const ys = lines.length > 1 ? [h * 0.34, h * 0.64, h * 0.82] : [h * 0.5]
  lines.forEach((t, i) => {
    g.font = `800 ${sizes[Math.min(i, 2)]}px system-ui, "Helvetica Neue", Arial, sans-serif`
    g.fillText(t, w / 2, ys[i], w - 40)
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function buildPortal(group: THREE.Group, physics: Physics, m: Materials, o: PortalOpts) {
  const { x, z, dir, roadY, width, length } = o
  const H = 7.6
  const out = -dir // the way the facade faces
  const z1 = z + dir * length
  const zc = (z + z1) / 2
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: THREE.Material, collide = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(px, py, pz)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    if (collide) physics.fixedBox(px, py, pz, w / 2, h / 2, d / 2)
    return mesh
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffe2b0', emissiveIntensity: 2.2 })
  const dark = new THREE.MeshStandardMaterial({ color: '#17171b', roughness: 0.9, side: THREE.DoubleSide })
  // the bore is seen from inside: its walls must draw on both faces
  const inner = (m.concrete as THREE.MeshStandardMaterial).clone()
  inner.side = THREE.DoubleSide

  // the bore: floor, walls, ceiling, a dark end wall, strip lights
  box(width, 0.5, length, x, roadY - 0.25 + 0.02, zc, m.asphalt)
  for (const s of [-1, 1]) box(1, H, length, x + s * (width / 2 + 0.5), roadY + H / 2, zc, inner)
  box(width + 2, 1, length, x, roadY + H + 0.5, zc, inner)
  box(width + 2, H + 1, 1, x, roadY + H / 2, z1 + dir * 0.5, dark)
  for (let d = 6; d < length - 2; d += 9) box(width - 6, 0.12, 0.5, x, roadY + H - 0.15, z + dir * d, lampMat, false)
  for (const s of [-1, 1]) for (let d = 4; d < length; d += 12) box(0.4, 0.5, 0.2, x + s * (width / 2 - 0.2), roadY + 1.4, z + dir * d, lampMat, false)
  // dashed centre line along the floor
  const line = new THREE.MeshBasicMaterial({ color: '#e8e4d8' })
  for (let d = 3; d < length - 3; d += 6) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), line)
    l.position.set(x, roadY + 0.04, z + dir * d)
    group.add(l)
  }

  // the portal wall: two flanks and a lintel, with a sign
  const fw = 46
  box(fw - width / 2, 22, 2.4, x - width / 2 - (fw - width / 2) / 2, roadY + 11, z, m.concrete)
  box(fw - width / 2, 22, 2.4, x + width / 2 + (fw - width / 2) / 2, roadY + 11, z, m.concrete)
  box(width + 2, 22 - H, 2.4, x, roadY + H + (22 - H) / 2, z, m.concrete)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshStandardMaterial({ map: labelTexture([o.title, o.sub], '#0e3b2e', '#ffffff', 1024, 256), emissiveMap: null, roughness: 0.6 }))
  sign.position.set(x, roadY + H + 3.6, z + out * 1.25)
  if (out < 0) sign.rotation.y = Math.PI
  group.add(sign)
  for (const s of [-1, 1]) box(0.7, H, 1, x + s * (width / 2 + 0.3), roadY + H / 2, z + out * 0.8, m.frame, false)

  // the rock mound over the bore: the back half of an ellipsoid, roughened
  const rx = fw + 14
  const rz = length + 24
  const geo = new THREE.SphereGeometry(1, 36, 16, dir > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2)
  const p = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i)
    const vy = p.getY(i)
    const vz = p.getZ(i)
    const n = 0.88 + 0.22 * noise2(vx * 3.1 + x * 0.01, vz * 3.1 + z * 0.01) + 0.08 * noise2(vx * 9, vz * 9)
    p.setXYZ(i, vx * rx * n, vy * (24 + 10 * noise2(vx * 2, vz * 2)) * n, vz * rz * n)
  }
  geo.computeVertexNormals()
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 9, p.getZ(i) / 9)
  const mound = new THREE.Mesh(geo, o.rock)
  mound.position.set(x, roadY - 1, z + dir * 1.2)
  mound.castShadow = mound.receiveShadow = true
  group.add(mound)
  mound.updateMatrixWorld(true)
  physics.fixedMesh(mound)
  return { zFar: z1 }
}
