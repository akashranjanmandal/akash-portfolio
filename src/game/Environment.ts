import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

/* Physically based sky (Preetham), a sun that casts sharp shadows
   around the player, and image-based lighting baked from the same
   sky so every material is lit consistently. */

export type TimeMode = 'day' | 'golden' | 'night'

export class Environment {
  readonly sky = new Sky()
  readonly sun = new THREE.DirectionalLight('#fff4e5', 3.2)
  readonly hemi = new THREE.HemisphereLight('#bcd6ff', '#5b5040', 0.25)
  readonly sunDir = new THREE.Vector3()
  private pmrem: THREE.PMREMGenerator
  private envTarget: THREE.WebGLRenderTarget | null = null
  private envScene = new THREE.Scene()
  private envSky = new Sky()
  /** 0 = day, 1 = full night */
  night = 0
  mode: TimeMode = 'day'
  private stars: THREE.Points
  private moon: THREE.Mesh

  constructor(renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowSize: number, shadows: boolean) {
    this.sky.scale.setScalar(10000)
    this.scene.add(this.sky)
    this.envSky.scale.setScalar(10000)
    this.envScene.add(this.envSky)
    for (const s of [this.sky, this.envSky]) {
      // Sky outputs scene-referred radiance meant for exposure ~0.5; bake that in
      s.material.fragmentShader = s.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * 0.42, vec3( 1.6 ) ) + vec3( 0.006, 0.011, 0.032 ) * uNight, 1.0 );').replace('void main() {', 'uniform float uNight;\nvoid main() {')
      s.material.uniforms.uNight = { value: 0 }
      s.material.needsUpdate = true
      const u = s.material.uniforms
      // humid Bengal air: hazier, warmer sky
      u.turbidity.value = 7
      u.rayleigh.value = 1.9
      u.mieCoefficient.value = 0.004
      u.mieDirectionalG.value = 0.82
    }

    this.sun.castShadow = shadows
    this.sun.shadow.mapSize.set(shadowSize, shadowSize)
    const c = this.sun.shadow.camera
    c.left = -70
    c.right = 70
    c.top = 70
    c.bottom = -70
    c.near = 1
    c.far = 600
    this.sun.shadow.bias = -0.0002
    this.sun.shadow.normalBias = 0.04
    this.sun.shadow.radius = 2
    this.scene.add(this.sun, this.sun.target, this.hemi)

    this.scene.fog = new THREE.FogExp2('#d8cdb8', 0.0009)
    this.pmrem = new THREE.PMREMGenerator(renderer)

    // stars and a moon, only visible at night
    const sp: number[] = []
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * Math.PI * 2
      const v = 0.08 + Math.random() * 0.92
      const r = Math.sqrt(1 - v * v)
      sp.push(Math.cos(u) * r * 3000, v * 3000, Math.sin(u) * r * 3000)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false }))
    this.stars.visible = false
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), new THREE.MeshBasicMaterial({ color: '#f4efe0', fog: false, toneMapped: false }))
    this.moon.visible = false
    this.scene.add(this.stars, this.moon)
    this.setTime('day')
  }

  setTime(mode: TimeMode) {
    this.mode = mode
    if (mode === 'day') {
      this.night = 0
      this.setSun(28, 235)
    } else if (mode === 'golden') {
      this.night = 0.35
      this.setSun(5, 255)
      this.sun.color.set('#ffb070')
      this.sun.intensity = 1.6
    } else {
      this.night = 1
      // a sky just after dusk for the backdrop and reflections…
      this.setSun(-5, 255)
      // …and the moon as the light that casts shadows
      this.sunDir.set(-0.35, 0.75, 0.55).normalize()
      this.sun.color.set('#8fa6e0')
      this.sun.intensity = 0.35
      this.hemi.color.set('#3b4c7a')
      this.hemi.groundColor.set('#1c1a22')
      this.hemi.intensity = 0.5
      this.scene.environmentIntensity = 0.12
      ;(this.scene.fog as THREE.FogExp2).color.set('#131a2c')
    }
    if (mode !== 'night') {
      this.hemi.color.set('#bcd6ff')
      this.hemi.groundColor.set('#5b5040')
      this.hemi.intensity = 0.25
    }
    if (mode === 'golden') (this.scene.fog as THREE.FogExp2).color.set('#d9a77a')
    this.stars.visible = this.moon.visible = mode === 'night'
    for (const s of [this.sky, this.envSky]) s.material.uniforms.uNight.value = mode === 'night' ? 1 : 0
    this.moon.position.copy(this.sunDir).multiplyScalar(2600)
  }

  /** elevation and azimuth in degrees */
  setSun(elevation: number, azimuth: number) {
    const phi = THREE.MathUtils.degToRad(90 - elevation)
    const theta = THREE.MathUtils.degToRad(azimuth)
    this.sunDir.setFromSphericalCoords(1, phi, theta)
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir)
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir)
    const low = THREE.MathUtils.clamp(elevation / 25, 0, 1)
    this.sun.color.setRGB(1, 0.78 + low * 0.18, 0.6 + low * 0.32)
    this.sun.intensity = 0.8 + low * 1.9
    // warm dusty haze close to the ground, the way Kolkata afternoons look
    ;(this.scene.fog as THREE.FogExp2).color.setRGB(0.78, 0.72 - (1 - low) * 0.05, 0.62 - (1 - low) * 0.12)
    this.envTarget?.dispose()
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02)
    this.scene.environment = this.envTarget.texture
    this.scene.environmentIntensity = 0.55
  }

  /** keep the shadow frustum centred on the player, snapped to texels to stop shimmering */
  follow(p: THREE.Vector3) {
    const size = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x
    const x = Math.round(p.x / size) * size
    const z = Math.round(p.z / size) * size
    this.sun.target.position.set(x, 0, z)
    this.sun.position.set(x, 0, z).addScaledVector(this.sunDir, 250)
    if (this.night > 0.5) {
      this.stars.position.set(p.x, 0, p.z)
      this.moon.position.copy(this.sunDir).multiplyScalar(2600).add(this.stars.position)
    }
  }
}
