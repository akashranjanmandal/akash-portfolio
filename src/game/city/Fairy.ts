import * as THREE from 'three'

/* Strings of tiny bulbs — the way Kolkata dresses its balconies and shopfronts
   for every festival. Collected into one point cloud, drawn only after dark. */

export type FairyBuffer = { pos: number[]; col: number[] }

const WARM = [1, 0.82, 0.55]
const FESTIVE = [[1, 0.25, 0.3], [1, 0.75, 0.2], [0.35, 0.9, 0.45], [0.35, 0.6, 1], [1, 0.4, 0.85]]

export function addFairy(buf: FairyBuffer, a: THREE.Vector3, b: THREE.Vector3, sag: number, colour: boolean) {
  const len = a.distanceTo(b)
  const n = Math.max(4, Math.round(len / 0.45))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    buf.pos.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t)
    const c = colour ? FESTIVE[i % FESTIVE.length] : WARM
    buf.col.push(c[0], c[1], c[2])
  }
}

export class FairyLights {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>

  constructor(buf: FairyBuffer) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3))
    const seed = new Float32Array(buf.pos.length / 3).map(() => Math.random() * 6.28)
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float seed; attribute vec3 color;
          uniform float uTime; varying vec3 vC; varying float vA;
          void main() {
            vC = color;
            vA = 0.7 + 0.3 * sin(uTime * 2.2 + seed * 3.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(160.0 / -mv.z, 1.5, 9.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOn; varying vec3 vC; varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float core = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vC * (1.0 + core * 1.5), core * vA * uOn);
          }`,
      }),
    )
    this.points.frustumCulled = false
    this.points.visible = false
  }

  update(t: number, night: number) {
    const on = night > 0.3 ? night : 0
    this.points.visible = on > 0
    this.points.material.uniforms.uTime.value = t
    this.points.material.uniforms.uOn.value = on
  }
}
