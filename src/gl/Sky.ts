import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../utils/math'

/* ──────────────────────────────────────────────────────────────
   SKY
   A gradient dome that follows the camera, a star field, a moon,
   and a sea of low-poly clouds the island floats above.
────────────────────────────────────────────────────────────── */

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`

const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunDisc;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6))
      : mix(uHorizon, uBottom, pow(clamp(-h * 1.6, 0.0, 1.0), 0.7));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (smoothstep(0.9993, 0.9997, s) * 1.6 * uSunDisc + pow(s, 12.0) * 0.35 * uSunDisc + pow(s, 3.0) * 0.08);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const starVert = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTw;
  void main() {
    vTw = 0.55 + 0.45 * sin(uTime * (1.2 + aPhase) + aPhase * 30.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // sit on the far plane with the dome
    gl_PointSize = aSize * uPixelRatio;
  }
`
const starFrag = /* glsl */ `
  uniform float uOpacity;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), a * vTw * uOpacity);
  }
`

export class Sky {
  readonly group = new THREE.Group()
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  readonly moon: THREE.Sprite
  readonly clouds: THREE.InstancedMesh[] = []
  readonly cloudMaterial: THREE.MeshLambertMaterial
  private cloudData: { r: number; a: number; y: number; s: number; speed: number; mesh: number; idx: number; yaw: number; sy: number }[] = []
  private readonly tmp = new THREE.Object3D()

  constructor(density: number) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(600, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uBottom: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunDisc: { value: 1 },
        },
      }),
    )
    this.dome.renderOrder = -10
    this.dome.frustumCulled = false
    this.group.add(this.dome)

    // stars on the upper hemisphere
    const count = 900
    const r = rng(7)
    const pos = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    const size = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const u = r()
      const v = r() * 0.95 + 0.05
      const theta = u * Math.PI * 2
      const y = v
      const rad = Math.sqrt(1 - y * y)
      pos.set([Math.cos(theta) * rad * 550, y * 550, Math.sin(theta) * rad * 550], i * 3)
      phase[i] = r() * 3
      size[i] = 1 + Math.pow(r(), 6) * 3.2
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    this.stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        vertexShader: starVert,
        fragmentShader: starFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPixelRatio: { value: 1 } },
      }),
    )
    this.stars.renderOrder = -9
    this.stars.frustumCulled = false
    this.group.add(this.stars)

    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0 }),
    )
    this.moon.scale.setScalar(70)
    this.moon.renderOrder = -8
    this.group.add(this.moon)

    // clouds
    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.25 })
    const variants = [cloudGeometry(1), cloudGeometry(2), cloudGeometry(3)]
    const total = Math.round(70 * Math.max(0.45, density))
    const perVariant = Math.ceil(total / variants.length)
    variants.forEach((g) => {
      const m = new THREE.InstancedMesh(g, this.cloudMaterial, perVariant)
      m.frustumCulled = false
      this.clouds.push(m)
    })
    const cr = rng(42)
    for (let i = 0; i < perVariant * variants.length; i++) {
      const layer = cr()
      let radius: number, y: number, s: number
      if (layer < 0.55) {
        // fair-weather clouds drifting over the sea
        radius = 150 + cr() * 200
        y = 18 + cr() * 22
        s = 7 + cr() * 9
      } else if (layer < 0.85) {
        // a ring low over the horizon
        radius = 260 + cr() * 140
        y = 6 + cr() * 14
        s = 9 + cr() * 12
      } else {
        // a few high ones
        radius = 120 + cr() * 160
        y = 26 + cr() * 30
        s = 6 + cr() * 7
      }
      this.cloudData.push({
        r: radius,
        a: cr() * Math.PI * 2,
        y,
        s,
        speed: (0.004 + cr() * 0.006) * (cr() < 0.5 ? 1 : 0.7),
        mesh: i % variants.length,
        idx: Math.floor(i / variants.length),
        yaw: cr() * Math.PI * 2,
        sy: 0.55 + cr() * 0.25,
      })
    }
    this.clouds.forEach((m) => this.group.add(m))
    this.updateClouds(0)
  }

  updateClouds(dt: number) {
    const o = this.tmp
    for (const c of this.cloudData) {
      c.a += c.speed * dt
      o.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r * 0.8)
      o.rotation.set(0, c.yaw + c.a, 0)
      o.scale.set(c.s, c.s * c.sy, c.s)
      o.updateMatrix()
      this.clouds[c.mesh].setMatrixAt(c.idx, o.matrix)
    }
    for (const m of this.clouds) m.instanceMatrix.needsUpdate = true
  }

  update(dt: number, elapsed: number, camera: THREE.Camera, pixelRatio: number) {
    this.dome.position.copy(camera.position)
    this.stars.position.copy(camera.position)
    this.stars.material.uniforms.uTime.value = elapsed
    this.stars.material.uniforms.uPixelRatio.value = pixelRatio
    this.updateClouds(dt)
  }
}

function cloudGeometry(seed: number) {
  const r = rng(seed * 97)
  const parts: THREE.BufferGeometry[] = []
  const blobs = 6 + Math.floor(r() * 4)
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(0.55 + r() * 0.5, 1)
    const t = i / (blobs - 1) - 0.5
    g.translate(t * 2.6 + (r() - 0.5) * 0.4, Math.cos(t * Math.PI) * 0.35 + r() * 0.2, (r() - 0.5) * 0.9)
    parts.push(g)
  }
  const merged = mergeGeometries(parts)!
  // flatten the underside a little
  const p = merged.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    if (y < -0.1) p.setY(i, -0.1 + (y + 0.1) * 0.35)
  }
  merged.computeVertexNormals()
  return merged
}

function moonTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const glow = g.createRadialGradient(128, 128, 20, 128, 128, 128)
  glow.addColorStop(0, 'rgba(255,248,230,0.55)')
  glow.addColorStop(0.35, 'rgba(200,210,255,0.16)')
  glow.addColorStop(1, 'rgba(200,210,255,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#fff6df'
  g.beginPath()
  g.arc(128, 128, 30, 0, Math.PI * 2)
  g.fill()
  // a few soft craters
  g.fillStyle = 'rgba(210,200,180,0.55)'
  for (const [x, y, rr] of [[118, 120, 7], [138, 136, 5], [126, 142, 4], [140, 116, 3.5]]) {
    g.beginPath()
    g.arc(x, y, rr, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
