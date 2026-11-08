import { Engine } from './Engine'
import { Environment } from './Environment'
import { Assets } from './Assets'
import { Physics } from './Physics'
import { Input } from './Input'
import { Player } from './Player'
import { World } from './World'

export const MODELS = [
  'avatar', 'xbot-anims', 'bike', 'island_tree_01', 'island_tree_02', 'street_lamp_01', 'shrub_01', 'shrub_03', 'boulder_01',
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
    // one physics step so the controller has a ground contact before the first frame
    this.physics.world.step()
    await this.engine.renderer.compileAsync(this.engine.scene, this.engine.camera)
    onProgress(1)
  }

  start() {
    this.engine.onTick((dt, t) => this.frame(dt, t))
    this.engine.start()
  }

  private frame(dt: number, t: number) {
    const input = this.input
    input.update()
    const look = input.readLook()
    this.player.look(look.x, look.y)
    if (input.consume('KeyV')) this.player.view = this.player.view === 'third' ? 'first' : 'third'
    this.physics.update(dt, () => this.player.stepPhysics(input, this.physics.step))
    this.player.update(dt, this.physics.alpha)
    this.player.placeCamera(this.engine.camera, dt)
    this.env.follow(this.player.position)
    this.world.update(dt, t, this.player.position)
  }
}
