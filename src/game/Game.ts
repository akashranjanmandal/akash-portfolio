import { Engine } from './Engine'
import { Environment } from './Environment'
import { Assets } from './Assets'
import { Physics } from './Physics'
import { Input } from './Input'
import { Player } from './Player'
import { World } from './World'
import { Car, Bike, nearestVehicle, type Vehicle } from './Vehicles'
import { PLOTS, plotToWorld, plotFrame } from './city/Plan'
import * as THREE from 'three'

export const MODELS = [
  'avatar', 'xbot-anims', 'bike', 'car', 'island_tree_01', 'island_tree_02', 'street_lamp_01', 'shrub_01', 'shrub_03', 'boulder_01',
  'rollershutter_door', 'painted_wooden_bench', 'metal_trash_can', 'fire_hydrant', 'planter_box_01', 'concrete_road_barrier', 'potted_plant_01',
]
export const TEXTURES = ['aerial_grass_rock', 'asphalt_02', 'concrete_tiles', 'red_brick_03', 'plastered_wall_02', 'coast_sand_rocks_02', 'forrest_ground_01', 'metal_plate', 'rocky_terrain_02']

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
    await this.assets.load(MODELS, TEXTURES)
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

  /** the taxi waits in the home garage; bicycles lean on a rack outside */
  private spawnVehicles() {
    const home = PLOTS.find((p) => p.id === 'home')!
    const f = plotFrame(home)
    const carPos = plotToWorld(home, 6, -7)
    const car = new Car(this.physics, this.assets.models.get('car')!, new THREE.Vector3(carPos.x, 0.2, carPos.z), f.yaw)
    this.vehicles.push(car)
    for (const [i, lx] of [-11, -12.6].entries()) {
      const p = plotToWorld(home, lx, 3)
      const bike = new Bike(this.physics, this.assets.models.get('bike')!, new THREE.Vector3(p.x, 0.2, p.z), f.yaw + Math.PI / 2 + i * 0.05)
      this.vehicles.push(bike)
    }
    for (const v of this.vehicles) this.engine.scene.add(v.root)
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
    this.world.update(dt, t, focus)
  }
}
