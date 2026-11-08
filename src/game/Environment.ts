import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

/* Physically based sky (Preetham), a sun that casts sharp shadows
   around the player, and image-based lighting baked from the same
   sky so every material is lit consistently. */

export class Environment {
  readonly sky = new Sky()
  readonly sun = new THREE.DirectionalLight('#fff4e5', 3.2)
  readonly hemi = new THREE.HemisphereLight('#bcd6ff', '#5b5040', 0.25)
  readonly sunDir = new THREE.Vector3()
  private pmrem: THREE.PMREMGenerator
  private envTarget: THREE.WebGLRenderTarget | null = null
  private envScene = new THREE.Scene()
  private envSky = new Sky()

  constructor(renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowSize: number, shadows: boolean) {
    this.sky.scale.setScalar(10000)
    this.scene.add(this.sky)
    this.envSky.scale.setScalar(10000)
    this.envScene.add(this.envSky)
    for (const s of [this.sky, this.envSky]) {
      // Sky outputs scene-referred radiance meant for exposure ~0.5; bake that in
      s.material.fragmentShader = s.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.42, 1.0 );')
      s.material.needsUpdate = true
      const u = s.material.uniforms
      u.turbidity.value = 4.5
      u.rayleigh.value = 1.6
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

    this.scene.fog = new THREE.FogExp2('#c9d8e6', 0.00042)
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.setSun(32, 135)
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
    ;(this.scene.fog as THREE.FogExp2).color.setRGB(0.62 + (1 - low) * 0.2, 0.7 - (1 - low) * 0.04, 0.8 - (1 - low) * 0.2)
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
  }
}
