import * as THREE from 'three'
import { noise2 } from '../../utils/math'

/* ──────────────────────────────────────────────────────────────
   THE RANGE
   The Himalaya are 100 km away, so they are not terrain: they are
   layered ridgelines on a ring that follows the camera. Azimuth is
   measured from north, clockwise (east = 90°).

   Heights are real metres (peaks drawn at a vertical exaggeration so
   they stand up over the horizon like they do in photographs).
────────────────────────────────────────────────────────────── */

/** [azimuth °, height m]: Kanchenjunga and the Sleeping Buddha to the east, the Everest group to the north-west */
const HIMALAYA: [number, number][] = [
  [0, 5200], [15, 5900], [30, 5400], [44, 4700], [52, 5500], [58, 6800],
  [62, 7710], // Jannu: the feet
  [66, 6400], [70, 7000], [74, 6300],
  [78, 7900], [82, 8586], // Kanchenjunga: the chest and belly
  [86, 8100], [90, 7400], [94, 7100],
  [97, 7412], // Kabru: the crown of the head
  [99, 6900], [101, 6300], // forehead
  [103, 6900], // the nose
  [105, 6000], [108, 6600], [112, 5600], [120, 4300], [135, 2600], [160, 1200], [180, 800], [200, 1300], [225, 3500], [250, 5200], [270, 6200], [285, 6500],
  [292, 5600], [297, 7600], // Makalu
  [301, 6500], [305, 8100], // Lhotse
  [308, 7200], [312, 8700], // Everest
  [316, 7300], [320, 6500], [330, 5900], [345, 5400], [360, 5200],
]

export const PEAKS = [
  { name: 'Kanchenjunga', alt: '8,586 m', az: 82 },
  { name: 'Kabru (the Buddha’s head)', alt: '7,412 m', az: 97 },
  { name: 'Jannu', alt: '7,710 m', az: 62 },
  { name: 'Makalu', alt: '8,485 m', az: 297 },
  { name: 'Lhotse', alt: '8,516 m', az: 305 },
  { name: 'Everest', alt: '8,849 m', az: 312 },
]

function profile(az: number) {
  const a = ((az % 360) + 360) % 360
  let i = 0
  while (i < HIMALAYA.length - 2 && HIMALAYA[i + 1][0] <= a) i++
  const [a0, h0] = HIMALAYA[i]
  const [a1, h1] = HIMALAYA[i + 1]
  const t = (a - a0) / (a1 - a0)
  // straight slopes between the control points give pointed peaks, not rolling hills
  const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65
  const base = h0 + (h1 - h0) * s
  // jagged crests: ridged noise on top
  const j = 1 - Math.abs(noise2(az * 1.3, 3.3) * 2 - 1)
  const k = 1 - Math.abs(noise2(az * 4.1 + 9, 1.1) * 2 - 1)
  return base * (0.86 + 0.16 * j + 0.1 * k)
}

const VERT = /* glsl */ `
  attribute float aV;
  varying float vV;
  varying vec3 vPos;
  varying float vAz;
  void main() {
    vV = aV;
    vPos = position;
    vAz = atan(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uTint;      // rock / forest colour of this layer
  uniform vec3 uSnow;
  uniform float uSnowLine; // world y above which there is snow
  uniform vec3 uHaze;      // colour of the air
  uniform float uHazeAmt;
  uniform float uAlpen;    // 0..1 first light on the peaks
  uniform float uNight;
  uniform vec3 uSun;       // sun direction
  uniform float uDetail;
  varying float vV;
  varying vec3 vPos;
  varying float vAz;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
  float ridged(vec2 p){
    float a = 0.0, w = 0.55;
    for (int i = 0; i < 4; i++) { a += w * (1.0 - abs(vn(p) * 2.0 - 1.0)); p *= 2.07; w *= 0.5; }
    return a;
  }
  void main() {
    // ridged rock texture drawn in (azimuth, height) space; its slope shades the faces
    vec2 uv = vec2(vAz * 70.0 * uDetail, vPos.y * 0.014 * uDetail);
    float n = ridged(uv);
    float n2 = ridged(uv * 2.3 + 3.0);
    // faces: ridged noise gradients lit from the side give crags, gullies and sunlit slabs
    float dn = n - ridged(uv + vec2(0.05, 0.0));
    float face = clamp(0.5 + dn * 9.0 + (n2 - 0.5) * 0.5, 0.0, 1.0);
    float snowMask = smoothstep(uSnowLine - 160.0, uSnowLine + 160.0, vPos.y + (n - 0.5) * 760.0 + (n2 - 0.5) * 320.0);
    vec3 rock = uTint * (0.3 + 0.9 * face);
    // lower slopes lie in blue shadow; only the high snow catches the light
    float lit = smoothstep(0.25, 1.0, vV);
    vec3 snow = mix(vec3(0.34, 0.42, 0.64), uSnow * 0.92, face * (0.45 + 0.55 * lit));
    vec3 col = mix(rock, snow, snowMask);
    // first light: gold-pink on the topmost snow and ridges
    float tip = smoothstep(0.68, 1.0, vV + (n - 0.5) * 0.12);
    col = mix(col, vec3(1.0, 0.6, 0.4) * (0.55 + 0.6 * face), clamp(uAlpen * tip * snowMask * 0.85, 0.0, 1.0));
    // air: the lower and further, the paler and bluer
    float haze = clamp(uHazeAmt + (1.0 - vV) * 0.55, 0.0, 1.0);
    col = mix(col, uHaze, haze);
    // at night only the snow glows faintly in starlight
    vec3 night = uSnow * vec3(0.07, 0.09, 0.15) * snowMask + uTint * 0.012;
    col = mix(col, night + uHaze * 0.5, uNight);
    gl_FragColor = vec4(col, 1.0);
  }
`

type Layer = { R: number; tint: string; snowLine: number; haze: number; detail: number; top: (az: number) => number; scale: number }

export class Panorama {
  readonly group = new THREE.Group()
  private mats: THREE.ShaderMaterial[] = []
  /** 0 = at the viewpoint; 1 = at the base camp (the range rises as you approach) */
  approach = 0

  constructor(private sun: THREE.Vector3) {
    const layers: Layer[] = [
      // the great range: 130 km away, drawn tall
      { R: 3700, tint: '#4e5a70', snowLine: 900, haze: 0.14, detail: 1.0, top: (az) => 330 + profile(az) * 0.09, scale: 1 },
      // dark foothills and ridges nearer
      { R: 3000, tint: '#2c3a4c', snowLine: 9999, haze: 0.42, detail: 1.6, top: (az) => 250 + 150 * noise2(az * 0.12 + 4, 1.7) + 60 * noise2(az * 0.5, 9), scale: 1 },
      { R: 2300, tint: '#25402f', snowLine: 9999, haze: 0.3, detail: 2.2, top: (az) => 120 + 140 * noise2(az * 0.1 + 11, 5.1) + 40 * noise2(az * 0.6 + 2, 8), scale: 1 },
    ]
    layers.forEach((l, li) => {
      const N = 720
      const pos: number[] = []
      const v: number[] = []
      const idx: number[] = []
      for (let i = 0; i <= N; i++) {
        const az = (i / N) * 360
        const rad = (az * Math.PI) / 180
        const x = Math.sin(rad) * l.R
        const z = -Math.cos(rad) * l.R
        const top = l.top(az)
        pos.push(x, -120, z, x, top, z)
        v.push(0, 1)
        if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1))
      g.setIndex(idx)
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTint: { value: new THREE.Color(l.tint) },
          uSnow: { value: new THREE.Color('#e9f0ff') },
          uSnowLine: { value: l.snowLine },
          uHaze: { value: new THREE.Color('#b9c8e0') },
          uHazeAmt: { value: l.haze },
          uAlpen: { value: 0 },
          uNight: { value: 0 },
          uSun: { value: this.sun },
          uDetail: { value: l.detail },
        },
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: true,
      })
      const mesh = new THREE.Mesh(g, m)
      mesh.frustumCulled = false
      mesh.renderOrder = -2 + li * 0.1
      mesh.userData.R = l.R
      this.group.add(mesh)
      this.mats.push(m)
    })
    this.group.visible = false
  }

  /** follow the camera; haze colour from the sky; light on the peaks from the time of day */
  update(cam: THREE.Vector3, haze: THREE.Color, alpenglow: number, night: number) {
    this.group.position.set(cam.x, 0, cam.z)
    // approaching the range: it grows (heights scale up, the whole ring comes in a little)
    const s = 1 + this.approach * 0.9
    this.group.scale.set(1 + this.approach * 0.1, s, 1 + this.approach * 0.1)
    for (const m of this.mats) {
      m.uniforms.uHaze.value.copy(haze)
      m.uniforms.uAlpen.value = alpenglow
      m.uniforms.uNight.value = night
    }
  }
}
