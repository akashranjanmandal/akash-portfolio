import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { clamp } from '../utils/math'

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
  private moon: THREE.Mesh
  /** the real night sky: NASA/ESA Gaia star map on a dome tilted to the local celestial pole */
  private skyRoot = new THREE.Group()
  private dome!: THREE.Mesh
  private domeMat!: THREE.ShaderMaterial
  private spin0 = 0
  /** how clear the sky is: 1 = a mountain top far from any town, 0 = a bright city centre */
  private clarity = 0.8
  private latitude = 22.6 // Kolkata
  private shooting: { mesh: THREE.Mesh; t: number; dir: THREE.Vector3 } | null = null
  private nextMeteor = 6
  private clock = 0

  constructor(renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowSize: number, shadows: boolean, skyUrl = '') {
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

    // the night sky and a moon, only visible at night
    this.buildDome(skyUrl)
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(34, 24, 12), new THREE.MeshBasicMaterial({ color: '#e6e2d6', fog: false, toneMapped: false }))
    this.moon.visible = false
    this.scene.add(this.skyRoot, this.moon)
    this.setTime('day')
  }

  private buildDome(skyUrl: string) {
    const tex = new THREE.Texture()
    tex.colorSpace = THREE.SRGBColorSpace
    tex.generateMipmaps = false
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.RepeatWrapping
    if (skyUrl) {
      new THREE.TextureLoader().load(skyUrl, (t) => {
        tex.image = t.image
        tex.needsUpdate = true
      })
    }
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uAmount: { value: 0 }, uExposure: { value: 7.0 } },
      vertexShader: `
        varying vec3 vObj; varying vec3 vWorld;
        void main() {
          vObj = normalize(position);
          vWorld = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform float uAmount; uniform float uExposure;
        varying vec3 vObj; varying vec3 vWorld;
        void main() {
          // direction in the celestial frame -> right ascension / declination -> star map
          float dec = asin(clamp(vObj.y, -1.0, 1.0));
          float ra = atan(-vObj.z, vObj.x);
          float u = ra / 6.2831853 + 0.5;
          float v = 0.5 + dec / 3.14159265;
          // near the celestial pole the map is hugely stretched: average across the pixel's footprint
          float du = min(min(fwidth(u), fwidth(fract(u + 0.5))), 0.2);
          vec3 c = vec3(0.0);
          for (int k = 0; k < 8; k++) c += texture2D(map, vec2(u + ((float(k) + 0.5) / 8.0 - 0.5) * du, v)).rgb;
          c /= 8.0;
          // a little contrast: deep dark background, bright band and stars
          c = pow(c, vec3(1.32));
          // thicker air near the horizon dims everything
          float up = smoothstep(-0.02, 0.32, vWorld.y);
          gl_FragColor = vec4(c * uExposure * uAmount * up, 1.0);
        }`,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), this.domeMat)
    this.dome.frustumCulled = false
    this.dome.renderOrder = 1
    this.skyRoot.add(this.dome)
    this.skyRoot.visible = false
    this.applyLatitude()
    // a shooting star: one thin streak, re-used
    const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 1.6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }))
    m.visible = false
    m.frustumCulled = false
    this.scene.add(m)
    this.shooting = { mesh: m, t: 0, dir: new THREE.Vector3() }
  }

  /** the celestial pole sits at an altitude equal to the latitude, due north (-Z) */
  private applyLatitude() {
    this.skyRoot.rotation.set(THREE.MathUtils.degToRad(this.latitude) - Math.PI / 2, 0, 0)
    // spin the dome so the galactic centre (RA 266 deg, Dec -29) crosses due south, high up
    const ra = THREE.MathUtils.degToRad(266.4)
    const dec = THREE.MathUtils.degToRad(-29)
    const x = Math.cos(dec) * Math.cos(ra)
    const z = -Math.cos(dec) * Math.sin(ra)
    const tilt = new THREE.Quaternion().setFromEuler(this.skyRoot.rotation)
    let best = 0
    let bestScore = -Infinity
    for (const t of [Math.atan2(-x, z), Math.atan2(-x, z) + Math.PI]) {
      const v = new THREE.Vector3(x * Math.cos(t) + z * Math.sin(t), Math.sin(dec), -x * Math.sin(t) + z * Math.cos(t)).applyQuaternion(tilt)
      const score = v.z - Math.abs(v.x) // south (+Z) and on the meridian
      if (score > bestScore) { bestScore = score; best = t }
    }
    this.spin0 = best
    this.dome.rotation.y = best
  }

  /** place the sky for a region: its latitude and how dark it is */
  setSkyConditions(latitude: number, clarity: number) {
    this.latitude = latitude
    this.clarity = clamp(clarity, 0, 1)
    this.applyLatitude()
    this.domeMat.uniforms.uExposure.value = 3 + this.clarity * 5
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
      // a properly dark sky for the backdrop and reflections…
      this.setSun(-24, 255)
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
    this.skyRoot.visible = this.moon.visible = mode === 'night'
    this.domeMat.uniforms.uAmount.value = mode === 'night' ? 1 : 0
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

  /** per-frame sky animation: the slow turn of the stars and a shooting star now and then */
  update(dt: number) {
    this.clock += dt
    const t = this.clock
    if (this.night < 0.5) return
    // one full turn in about 40 minutes: slow enough to feel real, fast enough to notice
    this.dome.rotation.y = this.spin0 + t * 0.0026
    const sh = this.shooting
    if (!sh) return
    this.nextMeteor -= dt
    if (this.nextMeteor <= 0 && sh.t <= 0) {
      this.nextMeteor = 14 + Math.random() * 22
      sh.t = 0.0001
      const az = Math.random() * Math.PI * 2
      const el = 0.35 + Math.random() * 0.8
      sh.dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
    }
    if (sh.t > 0) {
      sh.t += dt / 0.7
      const k = sh.t
      const pos = this.skyRoot.position
      sh.mesh.visible = true
      sh.mesh.position.copy(pos).addScaledVector(sh.dir, 3000).add(new THREE.Vector3(-k * 300, -k * 160, 0))
      sh.mesh.lookAt(pos)
      ;(sh.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.9
      if (k >= 1) {
        sh.t = 0
        sh.mesh.visible = false
      }
    }
  }

  /** keep the shadow frustum centred on the player, snapped to texels to stop shimmering */
  follow(p: THREE.Vector3) {
    const size = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x
    const x = Math.round(p.x / size) * size
    const z = Math.round(p.z / size) * size
    this.sun.target.position.set(x, 0, z)
    this.sun.position.set(x, 0, z).addScaledVector(this.sunDir, 250)
    if (this.night > 0.5) {
      this.skyRoot.position.set(p.x, 0, p.z)
      this.moon.position.copy(this.sunDir).multiplyScalar(2600).add(this.skyRoot.position)
    }
  }
}
