import * as THREE from 'three'
import { Batch, M } from './Batch'

export type Coach = THREE.Group & { setDoors(side: number, open: number): void }

const paint = (color: string, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.55 })
const steel = paint('#899397', 0.62)
const underframe = paint('#353a3c')
const rubber = paint('#242729')
const metroBlue = paint('#245392')
const localViolet = paint('#795976')
const cream = paint('#dfd9c5')
const silver = paint('#c6cfd2', 0.52)
const cabYellow = paint('#e4b13e')

export function buildCoach(kind: 'metro' | 'rail', len: number, cab: number, windows: THREE.Material, lamps: THREE.Material): Coach {
  const metro = kind === 'metro'
  const body = metro ? silver : cream
  const stripe = metro ? metroBlue : localViolet
  const b = new Batch()
  const group = new THREE.Group()
  const profile = new THREE.Shape()
  profile.moveTo(-1.35, 0.62)
  profile.lineTo(-1.56, 0.88)
  profile.lineTo(-1.56, 3.44)
  profile.quadraticCurveTo(-1.55, 3.95, -1.16, 4.05)
  profile.quadraticCurveTo(0, 4.24, 1.16, 4.05)
  profile.quadraticCurveTo(1.55, 3.95, 1.56, 3.44)
  profile.lineTo(1.56, 0.88)
  profile.lineTo(1.35, 0.62)
  profile.closePath()
  const shell = new THREE.ExtrudeGeometry(profile, { depth: len - 0.12, bevelEnabled: false, curveSegments: 5 })
  shell.translate(0, 0, -(len - 0.12) / 2).rotateY(Math.PI / 2)
  b.add(shell, body)
  b.box(len - 0.7, 0.32, 2.65, underframe, M(0, 0.64, 0))
  const doors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.61, 2.36, 0.06), body, 12)
  const doorGlass = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.9, 0.038), windows, 12)
  const axles = [-(len / 2 - 2.7), len / 2 - 2.7]
  for (const axle of axles) {
    b.box(2.35, 0.48, 2.05, underframe, M(axle, 0.47, 0))
    for (const end of [-0.76, 0.76]) for (const side of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.18, 12).rotateX(Math.PI / 2), steel, M(axle + end, 0.38, side * 0.72))
    }
    b.box(2, 0.32, 1.5, steel, M(axle, 4.23, 0))
    for (const slot of [-0.58, 0, 0.58]) b.box(0.28, 0.05, 1.14, underframe, M(axle + slot, 4.41, 0))
  }
  if (!metro && cab === 0) {
    for (const s of [-1, 1]) {
      for (const y of [4.77, 5.65]) b.box(1.62, 0.08, 0.08, steel, M(s * 0.65, y, 0).multiply(new THREE.Matrix4().makeRotationZ((y < 5 ? 1 : -1) * s * 0.58)))
    }
    b.box(0.12, 0.1, 1.9, underframe, M(0, 6.18, 0))
  }
  const spacing = len / 3.35
  for (const side of [-1, 1]) {
    b.box(len - 0.2, metro ? 0.27 : 0.5, 0.045, stripe, M(0, 1.43, side * 1.57))
    for (const door of [-spacing, 0, spacing]) {
      b.box(1.32, 2.44, 0.06, rubber, M(door, 2.05, side * 1.6))
      for (const sign of [-1, 1]) {
        const wx = door + sign * spacing * 0.31
        b.box(spacing * 0.28, 0.98, 0.055, rubber, M(wx, 2.65, side * 1.58))
        b.box(spacing * 0.25, 0.86, 0.045, windows, M(wx, 2.65, side * 1.615))
        if (!metro) for (const y of [2.43, 2.71]) b.box(spacing * 0.26, 0.035, 0.04, steel, M(wx, y, side * 1.65))
      }
    }
  }
  if (cab) {
    const end = cab * (len / 2 - 0.015)
    b.box(0.1, 2.52, 2.8, metro ? stripe : cabYellow, M(end, 2.29, 0))
    for (const side of [-1, 1]) {
      b.box(0.12, 1.09, 1.13, windows, M(end + cab * 0.09, 2.87, side * 0.63))
      b.add(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 12).rotateZ(Math.PI / 2), lamps, M(end + cab * 0.12, 1.56, side * 1.01))
    }
  }
  b.build(group)
  group.add(doors, doorGlass)
  const matrix = new THREE.Matrix4()
  let last = -10
  const setDoors = (platform: number, openness: number) => {
    const value = Math.round(openness * 32) * platform
    if (value === last) return
    last = value
    let i = 0
    for (const side of [-1, 1]) {
      const slide = side === platform ? Math.abs(value) / 32 * 0.61 : 0
      for (const x of [-spacing, 0, spacing]) for (const half of [-1, 1]) {
        const dx = x + half * (0.32 + slide)
        doors.setMatrixAt(i, matrix.makeTranslation(dx, 2.05, side * 1.65))
        doorGlass.setMatrixAt(i++, matrix.makeTranslation(dx, 2.61, side * 1.7))
      }
    }
    doors.instanceMatrix.needsUpdate = doorGlass.instanceMatrix.needsUpdate = true
  }
  setDoors(1, 0)
  return Object.assign(group, { setDoors })
}
