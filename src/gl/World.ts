import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Experience } from './Experience'
import { Physics } from './Physics'
import { Sky } from './Sky'
import { TimeOfDay } from './TimeOfDay'
import { Island } from './world/Island'
import { RoadMesh } from './world/RoadMesh'
import { Nature } from './world/Nature'
import { Landmarks } from './world/Landmarks'
import { Props } from './world/Props'
import { Bugs } from './world/Bugs'
import { Effects } from './Effects'
import { buildTaxi } from './car/TaxiModel'
import { Vehicle } from './car/Vehicle'
import { ANCHORS } from './world/Layout'

export type Progress = (p: number) => void

/* Everything in the 3D world, built in steps so the loader can breathe between them. */
export class World {
  readonly scene: THREE.Scene
  readonly physics = new Physics()
  readonly fog = new THREE.Fog('#ffffff', 70, 420)
  readonly sun = new THREE.DirectionalLight('#ffffff', 3)
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1)
  readonly headlight = new THREE.SpotLight('#fff2c8', 0, 26, 0.55, 0.6, 1.2)
  sky!: Sky
  tod!: TimeOfDay
  island!: Island
  road!: RoadMesh
  nature!: Nature
  landmarks!: Landmarks
  props!: Props
  bugs!: Bugs
  effects!: Effects
  vehicle!: Vehicle
  env: THREE.Texture | null = null
  private readonly focus = new THREE.Vector3()

  constructor(private exp: Experience) {
    this.scene = exp.scene
    this.scene.fog = this.fog
  }

  async build(textures: Map<string, THREE.Texture>, progress: Progress) {
    const q = this.exp.quality
    const step = async (p: number) => {
      progress(p)
      // yield so the loader keeps animating while geometry is generated
      await new Promise((r) => setTimeout(r, 0))
    }

    const pmrem = new THREE.PMREMGenerator(this.exp.renderer)
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    // lights
    this.sun.castShadow = q.shadows
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize)
    const sc = this.sun.shadow.camera
    sc.left = -36
    sc.right = 36
    sc.top = 36
    sc.bottom = -36
    sc.near = 1
    sc.far = 300
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.035
    this.sun.shadow.radius = 2.5
    this.scene.add(this.sun, this.sun.target, this.hemi)

    this.sky = new Sky(q.density)
    this.scene.add(this.sky.group)
    this.tod = new TimeOfDay(this.sky, this.sun, this.hemi, this.fog)
    await step(0.08)

    this.island = new Island(q.groundTexture, q.density)
    this.island.addColliders(this.physics)
    this.scene.add(this.island.group)
    await step(0.18)

    this.road = new RoadMesh()
    this.road.addColliders(this.physics)
    this.scene.add(this.road.group)
    await step(0.26)

    this.effects = new Effects()
    this.scene.add(this.effects.group)

    this.landmarks = new Landmarks(this.physics, textures, this.env)
    this.scene.add(this.landmarks.group)
    await step(0.5)

    this.nature = new Nature(this.physics, q.density)
    this.scene.add(this.nature.group)
    await step(0.66)

    this.props = new Props(this.physics)
    this.scene.add(this.props.group)
    await step(0.74)

    this.bugs = new Bugs()
    this.scene.add(this.bugs.group)

    const taxi = buildTaxi(this.env)
    this.scene.add(taxi.root)
    this.vehicle = new Vehicle(this.physics, taxi)
    // headlights light the road at night
    this.headlight.position.set(0, 0.1, 1.2)
    this.headlight.target.position.set(0, -0.6, 9)
    taxi.root.add(this.headlight, this.headlight.target)
    await step(0.82)
  }

  /** compile shaders and upload textures so the first real frame doesn't stutter */
  async warmup() {
    const r = this.exp.renderer
    const cam = this.exp.camera
    const prev = cam.position.clone()
    const a = ANCHORS[0]
    cam.position.set(a.pos.x - 20, 30, a.pos.z + 30)
    cam.lookAt(a.pos)
    await r.compileAsync(this.scene, cam)
    r.render(this.scene, cam)
    cam.position.copy(prev)
  }

  update(dt: number, elapsed: number, focus: THREE.Vector3) {
    const tod = this.tod
    tod.update(dt)
    const night = tod.night

    // keep the sun's shadow box centred on what the camera is looking at
    this.focus.lerp(focus, 1 - Math.exp(-6 * dt))
    const snap = 4
    const fx = Math.round(this.focus.x / snap) * snap
    const fz = Math.round(this.focus.z / snap) * snap
    this.sun.target.position.set(fx, 0, fz)
    this.sun.position.set(fx, 0, fz).addScaledVector(tod.sunDir, 150)
    if (this.sun.position.y < 20) this.sun.position.y = 20

    tod.placeMoon(this.exp.camera)
    this.sky.update(dt, elapsed, this.exp.camera, this.exp.pixelRatio)
    this.island.update(elapsed, night, tod.fogColor)
    this.road.update(night)
    this.landmarks.update(dt, elapsed, night, this.vehicle.position)
    this.nature.update(elapsed)
    this.bugs.update(dt, elapsed)
    this.effects.update(dt)

    const lights = Math.max(0, (night - 0.3) / 0.5)
    const parts = this.vehicle.parts
    parts.headlightMaterial.emissiveIntensity = 0.25 + lights * 3.2
    ;(parts.beams.material as THREE.MeshBasicMaterial).opacity = lights * 0.16
    parts.beams.visible = lights > 0.02
    this.headlight.intensity = lights * 60
    parts.lampMaterial.emissiveIntensity = 0.3 + lights * 2.2
    parts.tailMaterial.emissiveIntensity = (this.vehicle.braking ? 2.5 : 0.3) + lights * 0.8
  }
}
