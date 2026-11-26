import { METRO } from '../game/city/Plan'
import { suburbanPath } from '../game/city/RailLines'
import { rampDown, rampUp, ringPath } from '../game/city/Flyover'

const ring = ringPath()
const tracks = suburbanPath()
const routes = [
  { points: [...ring, ring[0]], color: '#ab8756' },
  { points: rampUp(), color: '#ab8756' },
  { points: rampDown(), color: '#ab8756' },
  { points: [...tracks, tracks[0]], color: '#dfb5dc' },
  { points: [METRO.z0, METRO.z1].map(z => ({ x: METRO.x, z })), color: '#387bbd' },
]

export function drawTransit(c: CanvasRenderingContext2D, px: (x: number) => number, pz: (z: number) => number) {
  c.save()
  const scale = px(1) - px(0)
  for (const route of routes) {
    c.beginPath()
    route.points.forEach((p, i) => i ? c.lineTo(px(p.x), pz(p.z)) : c.moveTo(px(p.x), pz(p.z)))
    c.strokeStyle = route.color
    c.lineWidth = Math.max(1.25, 3.5 * scale)
    c.stroke()
  }
  for (const station of METRO.stations) {
    c.beginPath()
    c.arc(px(METRO.x), pz(station.z), Math.max(2, 4 * scale), 0, Math.PI * 2)
    c.fillStyle = '#f1f3e8'
    c.fill()
    c.stroke()
  }
  c.restore()
}
