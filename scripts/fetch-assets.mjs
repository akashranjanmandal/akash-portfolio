/* Downloads the realistic assets for the open world and optimises them:
   - Poly Haven CC0 models (glTF 1k) → simplified, meshopt-compressed GLB with WebP textures
   - Poly Haven CC0 PBR textures (1k) → WebP
   - three.js example models (Ready Player Me avatar, Xbot animations, carbon bike)
   Run once:  node scripts/fetch-assets.mjs   (re-run safely; existing files are skipped) */
import { mkdir, writeFile, access, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const out = (...p) => path.join(root, 'public/assets', ...p)
const tmp = path.join(os.tmpdir(), 'akash-assets')
const exists = (p) => access(p).then(() => true, () => false)
const UA = { headers: { 'User-Agent': 'akash-portfolio-asset-fetch' } }

async function get(url) {
  const r = await fetch(url, UA)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

/** id → [simplify ratio, max texture size] */
const MODELS = {
  island_tree_01: [0.04, 1024],
  island_tree_02: [0.04, 1024],
  street_lamp_01: [0.5, 512],
  shrub_01: [0.12, 512],
  shrub_03: [0.3, 512],
  boulder_01: [0.1, 512],
  rollershutter_door: [0.5, 1024],
  painted_wooden_bench: [0.4, 512],
  metal_trash_can: [0.3, 512],
  fire_hydrant: [0.3, 512],
  planter_box_01: [0.4, 512],
  concrete_road_barrier: [0.4, 512],
  potted_plant_01: [0.25, 512],
}

const TEXTURES = ['aerial_grass_rock', 'asphalt_02', 'concrete_tiles', 'red_brick_03', 'plastered_wall_02', 'coast_sand_rocks_02', 'forrest_ground_01', 'metal_plate', 'rocky_terrain_02']

const THREE_MODELS = { 'readyplayer.me.glb': 'avatar.glb', 'Xbot.glb': 'xbot-anims.glb', 'CarbonFrameBike.glb': 'bike.glb' }

async function model(id, [ratio, size]) {
  const dest = out('models', `${id}.glb`)
  if (await exists(dest)) return console.log('skip', id)
  const info = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString()).gltf['1k'].gltf
  const dir = path.join(tmp, id)
  await mkdir(dir, { recursive: true })
  const gltfPath = path.join(dir, path.basename(info.url))
  await writeFile(gltfPath, await get(info.url))
  for (const [rel, f] of Object.entries(info.include ?? {})) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await writeFile(path.join(dir, rel), await get(f.url))
  }
  execFileSync('npx', ['gltf-transform', 'optimize', gltfPath, dest, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size), '--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.01'], { cwd: root, stdio: 'pipe' })
  await rm(dir, { recursive: true, force: true })
  console.log('model', id)
}

async function texture(id) {
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString())
  const maps = { diff: files.Diffuse?.['1k']?.jpg?.url, nor: files.nor_gl?.['1k']?.jpg?.url, rough: files.Rough?.['1k']?.jpg?.url }
  for (const [k, url] of Object.entries(maps)) {
    if (!url) continue
    const dest = out('textures', `${id}_${k}.webp`)
    if (await exists(dest)) continue
    await sharp(await get(url)).resize(1024, 1024, { fit: 'cover' }).webp({ quality: k === 'diff' ? 82 : 88 }).toFile(dest)
  }
  console.log('texture', id)
}

async function run() {
  await mkdir(out('models'), { recursive: true })
  await mkdir(out('textures'), { recursive: true })
  for (const [src, name] of Object.entries(THREE_MODELS)) {
    const dest = out('models', name)
    if (await exists(dest)) continue
    const raw = path.join(tmp, src)
    await mkdir(tmp, { recursive: true })
    await writeFile(raw, await get(`https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/${src}`))
    execFileSync('npx', ['gltf-transform', 'optimize', raw, dest, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false'], { cwd: root, stdio: 'pipe' })
    console.log('three model', name)
  }
  for (const id of TEXTURES) await texture(id)
  for (const [id, opts] of Object.entries(MODELS)) {
    try {
      await model(id, opts)
    } catch (e) {
      console.warn('failed', id, e.message.slice(0, 200))
    }
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
