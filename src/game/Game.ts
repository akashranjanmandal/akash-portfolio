import { Engine } from './Engine'
import { Environment } from './Environment'
import { Assets } from './Assets'
import { Physics } from './Physics'
import { Input } from './Input'
import { Player } from './Player'
import { World } from './World'
import { Car, Bike, nearestVehicle, type Vehicle } from './Vehicles'
import { PLOTS, plotToWorld, plotFrame } from './city/Plan'
import { ESTATE } from './city/Landmarks'
import { GARAGE, buildSupercar } from './Supercar'
import * as THREE from 'three'

export const MODELS = [
  'avatar', 'xbot-anims', 'bike', 'tram', 'car-bugatti', 'car-jesko', 'car-lambo', 'car-bmw', 'bungalow', 'office', 'campus', 'island_tree_01', 'island_tree_02', 'street_lamp_01', 'shrub_01', 'shrub_03',
  'rollershutter_door', 'painted_wooden_bench', 'metal_trash_can', 'fire_hydrant', 'planter_box_01', 'concrete_road_barrier', 'potted_plant_01',
]
export const IMAGES = ['picaku', 'lifeapp', 'pizzahap', 'gobt', 'gharkamali', 'altaqwa', 'accurateastro', 'mastermind', 'gftd', 'agile', 'ideashapers']
  .map((s) => `img/tex/${s}.webp`)
  .concat(['pizzahap', 'gobt', 'gharkamali', 'altaqwa', 'accurateastro', 'gftd', 'agile'].map((s) => `img/logos/${s}.webp`))
export const TEXTURES = [
  'aerial_grass_rock', 'asphalt_02', 'concrete_tiles', 'red_brick_03', 'plastered_wall_02', 'coast_sand_rocks_02', 'forrest_ground_01', 'metal_plate', 'rocky_terrain_02',
  'beige_wall_001', 'painted_concrete', 'concrete_wall_008', 'white_plaster_02', 'brick_wall_10', 'corrugated_iron_02', 'wood_planks', 'granite_tile', 'marble_01', 'cobblestone_floor_08',
]

/** The open-world game: loads everything, then runs player / vehicles / camera each frame. */
export class Game {
  engine: Engine
  env!: Environment
  assets!: Assets
  physics = new Physics()
  input: Input
  player!: Player
  world!: World
  vehicles: Vehicle[] = []
  /** one pair of headlights, moved onto whichever car is being driven */
  private beams: THREE.SpotLight[] = []
  onPrompt?: (text: string | null) => void
  private prompt: string | null = null

  constructor(canvas: HTMLCanvasElement, ui: { stick: HTMLElement; knob: HTMLElement }) {
    this.engine = new Engine(canvas)
    this.input = new Input(canvas, ui)
  }

  async load(onProgress: (p: number) => void) {
    await this.physics.init()
    this.env = new Environment(this.engine.renderer, this.engine.scene, this.engine.quality.shadowSize, this.engine.quality.shadows)
    this.assets = new Assets((p) => onProgress(p * 0.85), this.engine.renderer, this.engine.renderer.capabilities.getMaxAnisotropy())
    await this.assets.load(MODELS, TEXTURES, IMAGES)
    this.world = new World(this.engine.scene, this.engine.renderer, this.physics, this.assets, this.engine.quality)
    this.world.build()
    onProgress(0.92)
    const spawn = this.world.spawn
    this.player = new Player(this.physics, this.assets.models.get('avatar')!, this.assets.models.get('xbot-anims')!, spawn.pos)
    this.player.teleport(spawn.pos, spawn.yaw)
    this.engine.scene.add(this.player.root)
    this.spawnVehicles()
    // one physics step so the controller has a ground contact before the first frame
    this.physics.world.step()
    await this.engine.renderer.compileAsync(this.engine.scene, this.engine.camera)
    onProgress(1)
  }

  /** the garage: the Ambassador taxi and Akash's supercars, all ready to drive; bicycles by the gate */
  private spawnVehicles() {
    const home = PLOTS.find((p) => p.id === 'home')!
    const f = plotFrame(home)
    // noses towards the street
    const yaw = Math.atan2(-f.fx, -f.fz)
    const bayZ = ESTATE.garageZ - 3
    const taxiPos = plotToWorld(home, ESTATE.bays[0], bayZ)
    this.vehicles.push(new Car(this.physics, new THREE.Vector3(taxiPos.x, 0.2, taxiPos.z), yaw))
    GARAGE.forEach((spec, i) => {
      const gltf = this.assets.models.get(spec.model)
      if (!gltf) return
      const p = plotToWorld(home, ESTATE.bays[i + 1], bayZ)
      const visual = buildSupercar(gltf, spec)
      this.vehicles.push(new Car(this.physics, new THREE.Vector3(p.x, 0.2, p.z), yaw, visual, { name: spec.name, max: 50, boost: 78, force: 6200 }))
    })
    for (const [i, lx] of [-1, 0.6].entries()) {
      const p = plotToWorld(home, lx, -10)
      this.vehicles.push(new Bike(this.physics, this.assets.models.get('bike')!, new THREE.Vector3(p.x, 0.2, p.z), f.yaw + Math.PI / 2 + i * 0.05))
    }
    for (const v of this.vehicles) this.engine.scene.add(v.root)
    this.world.obstacles = this.vehicles.map((v) => v.position)
    for (const x of [-0.6, 0.6]) {
      const s = new THREE.SpotLight('#fff1d2', 0, 50, 0.5, 0.55, 1.2)
      s.position.set(x, 0.7, -2.2)
      s.target.position.set(x * 1.6, 0, -16)
      this.beams.push(s)
      this.engine.scene.add(s, s.target)
    }
  }

  start() {
    this.engine.onTick((dt, t) => this.frame(dt, t))
    this.engine.start()
  }

  private setPrompt(text: string | null) {
    if (text === this.prompt) return
    this.prompt = text
    this.onPrompt?.(text)
  }

  private frame(dt: number, t: number) {
    const input = this.input
    input.update()
    const look = input.readLook()
    this.player.look(look.x, look.y)
    const p = this.player
    if (input.consume('KeyV') && !p.vehicle) p.view = p.view === 'third' ? 'first' : 'third'

    // get in / out
    const near = p.vehicle ? null : nearestVehicle(this.vehicles, p.position)
    if (input.consume('KeyF')) {
      if (p.vehicle) p.dismount()
      else if (near) p.mount(near)
    }
    this.setPrompt(p.vehicle ? (p.vehicle.kind === 'car' ? 'F · Get out of the taxi' : 'F · Get off the bike') : near ? (near.kind === 'car' ? 'F · Drive the taxi' : 'F · Ride the bicycle') : null)

    this.physics.update(dt, () => {
      if (!p.vehicle) p.stepPhysics(input, this.physics.step)
      for (const v of this.vehicles) v.stepPhysics(v === p.vehicle ? input : null, this.physics.step)
    })
    for (const v of this.vehicles) v.update(this.physics.alpha, dt)
    p.update(dt, this.physics.alpha)
    if (p.vehicle) p.placeVehicleCamera(this.engine.camera, dt)
    else p.placeCamera(this.engine.camera, dt)
    const focus = p.vehicle ? p.vehicle.position : p.position
    this.env.follow(focus)
    this.world.night = this.env.night
    for (const v of this.vehicles) if (v.kind === 'car') (v as Car).setLights(this.env.night)
    const driving = p.vehicle?.kind === 'car' ? p.vehicle : null
    for (const s of this.beams) {
      s.intensity = driving && this.env.night > 0.3 ? 70 * this.env.night : 0
      if (driving && s.parent !== driving.root) driving.root.add(s, s.target)
    }
    this.world.update(dt, t, focus)
  }
}
