# Akash Ranjan Mandal: realistic open-world portfolio

An interactive 3D Kolkata that doubles as a portfolio. You walk or drive around a city built to scale, enter landmark buildings that represent real projects, open a phone and a map, and can travel through a tunnel to a Darjeeling-style hill region ending at the Sandakphu viewpoint. Branch `realistic-open-world`. The old taxi-ride site lives in `legacy-site/` and on `main`.

## Run, check, deploy

```
npm install
npm run dev            # vite on :5173
npm run typecheck      # tsc --noEmit (run before every commit)
npm run build          # typecheck + vite build into dist/
```

- Debug page: `http://localhost:5173/debug/game.html` sets `document.title = 'ready'` and exposes `window.__game` (player, engine, env, world, vehicles, `travel('hills')`). `?quality=high|mid|low` forces a tier. Set `__game.engine.perfWarm = 1e9` to freeze the auto quality governor while profiling.
- The full app exposes `window.__app` in dev or with `?debug`.
- Visual tests were done with headless Chrome through `playwright-core` (`channel: 'chrome'`, `--use-angle=metal`): teleport the player with `g.player.teleport(new THREE.Vector3(x, y, z))`, set `g.player.yaw` (0 faces -z/north, 1.57 faces -x/west), screenshot.
- Deploy draft: `npm run build && npx netlify-cli deploy --dir=dist --site=5ff69fa5-c0d7-4175-b3ce-463b868a525a --alias=open-world` (https://open-world--akash-jsx.netlify.app). Production is the same command with `--prod` (https://akash-jsx.netlify.app). Git remote: github.com/akashranjanmandal/akash-portfolio.

## Stack

TypeScript, Vite, three.js 0.186, Rapier3D (`@dimforge/rapier3d-compat`), `postprocessing` (bloom, tone mapping, SMAA, vignette) with N8AO ambient occlusion, GSAP for UI, WebAudio for synthesized engine/bell sounds. Models are GLB (meshopt compressed, simplified with `gltf-transform`); textures from Poly Haven (CC0); credits only in a `<meta name="credits">` tag. Content (projects, roles) is in `src/content.ts`.

## Code map

| Path | What it holds |
|---|---|
| `src/GameApp.ts` | glue: HUD, phone, map, minimap, audio, waypoint, loading |
| `src/game/Game.ts` | main loop, regions (`city` / `hills`), travel through the tunnel portal |
| `src/game/Engine.ts` | renderer, post chain, **quality tiers and the auto governor** |
| `src/game/Physics.ts` | Rapier world, fixed-step loop, collider helpers |
| `src/game/Player.ts`, `Vehicles.ts`, `Supercar.ts` | on-foot controller, raycast vehicle, the four supercars (Bugatti, Jesko, Lambo, BMW) |
| `src/game/Traffic.ts` | Ambassador taxis on closed loops (left-hand traffic), kinematic bodies |
| `src/game/World.ts` | terrain height function, flat pads, forest, sea, wiring of every city module |
| `src/game/Terrain.ts` | chunked 3-LOD terrain + the shared ground shader (grass, triplanar rock, snow) |
| `src/game/city/Plan.ts` | **single source of truth for the layout**: grid, plots, districts, sights, rail rectangle, ghat, narrow lanes |
| `src/game/city/Town.ts` | roads, blocks, filler buildings, lanes, lamps, night glow |
| `src/game/city/Landmarks.ts` | enterable project buildings (Xeta Labs, GOBT campus, home), shared night-light pool |
| `src/game/city/Districts.ts` | lake, Shaheed Minar plaza, Eden Gardens, Victoria Memorial gardens, Eastern Bypass |
| `src/game/city/Kolkata.ts` | trams, wires, Victoria Memorial building |
| `src/game/city/Howrah.ts` | river, Howrah Bridge, Howrah Station, embankments |
| `src/game/city/Transit.ts` | metro loop, suburban rail loops, rail bridges, level crossing, ring flyover mesh, road signs |
| `src/game/city/Flyover.ts` | ring flyover centreline, two ramps, traffic loops |
| `src/game/city/paths.ts` | `roundedLoop`, `offsetLoop`, `Loop` (arc-length sampling), `sweep` (extrude a section along a path) |
| `src/game/city/Ghat.ts` | ghat steps, temples, boats, ferries on a river loop |
| `src/game/hills/*` | hill region: `Route.ts` (road + height grid), `Hills.ts` (terrain chunks, forest, viewpoint), `Panorama.ts` (Himalaya layers), `Portal.ts` (tunnel, label textures) |
| `src/ui/*` | loader, phone, resume, toasts, full-screen map |

Coordinates: metres, x east, z south (so -z is north), y up. Grid lines every 100 m at -200..400 (`GRID`), roads 10 m wide, buildable block half-size 41.5 m.

## Physics

- Rapier world stepped at a fixed 1/60 s (`Physics.update`), rendering interpolated by `alpha`.
- Static geometry is added as fixed colliders: `fixedBox` (optional yaw), `fixedCylinder`, and `fixedMesh(mesh)` which bakes a mesh's world matrix into a trimesh (flyover decks, metro viaduct, stair ramps, stadium bowl). Mesh must have `updateMatrixWorld(true)` called first.
- The terrain is a heightfield collider built from the same `heightAt` function the visuals use (hills use a 10 m `HeightGrid`).
- The player is a kinematic character controller. Vehicles use Rapier's raycast vehicle with per-supercar tuning in `Supercar.ts` (wheels are auto-detected from the model).
- Traffic cars, rail coaches and ferries are kinematic position-based bodies moved along precomputed `Loop` paths; cars on different levels (ring flyover vs street) ignore each other when |dy| > 3 m.
- Stairs and ramps use one smooth inclined trimesh with visual steps a few cm above it.

## Performance rules (hard-won, keep them)

1. Real `PointLight`s are the biggest fragment cost. Night lighting is ground decals (`nightLight` in Districts) plus a shared pool of 2-4 lights that follow the player (`Landmarks.update`).
2. Static geometry goes through `Batch` (merged per material per 100 m cell so culling works). Never add thousands of separate meshes.
3. Terrain is `ChunkedTerrain` (150 m chunks, three LODs with skirts). Hills add an outer ring of coarse chunks for the snow ranges.
4. Shadows update every other frame, the shadow box is 110 m, no moon shadows at night.
5. `Engine.govern()` lowers quality automatically if fps < 38 (AO, then resolution, then bloom, then shadows) and restores resolution when there is headroom.
6. Simplify heavy GLBs (`npx gltf-transform simplify`); supercars were 100k triangles each.
7. Measured on a Mac in headless Chrome: mid tier ~60 fps city day and night; check again after adding anything big.

## What has been built (all on this branch)

- People: ~700 instanced pedestrians (`Pedestrians.ts`) on every pavement, station platforms and forecourts, Eden apron, Memorial paths, ghat steps and the bridge footway.
- Scale-correct town (character, doors, floors, roads share `Scale.ts`), enterable Xeta Labs office, GOBT campus and home, project buildings per `Plan.ts`, phone UI, minimap and full map (map marker follows the vehicle when driving).
- Day / golden / night cycle, glowing lamps, fairy lights, procedural star sky.
- Hooghly river, Howrah Bridge and Station; **Hooghly ghat** (22 stone steps, pavilion, two temples, tea stalls, moored boats, ferries looping the river).
- **Victoria Memorial district**: lit monument, striped lawns, two fountains, Queen's pavilion, gate with name board, cypress avenue, paths, lamps.
- **Narrow lanes**: through-lanes that connect two streets across every other block, lined with small houses, a shrine and lamps (`LANES` in `Plan.ts`; none is a dead end).
- **Ring flyover** (13 m wide deck at 9.2 m) above the whole outer road ring, up-ramp at the north-west junction, down-ramp at the north-east, ring traffic both ways, parapets removed near merges, direction signs.
- **Metro**: closed viaduct loop over four blocks, three climbable stations (Esplanade, Park Street, Maidan) with covered three-flight stairs, landings and fare gates, two tracks, articulated coaches.
- **Suburban railway**: double-track circuit around the city (Howrah in the west, over two girder bridges across the Hooghly, Sealdah in the south, east leg along the Bypass), platforms at both stations, overhead wires, level crossing with barriers, bells and lamps; trains stop and continue, never reverse.
- **Eden Gardens**: two-tier coloured bowl with aisles, ribbed concrete facade with lit windows, cantilever roof with trusses, clubhouse, sightscreen, scoreboard, ad boards, floodlight towers, vomitory gates.
- **Hills**: tunnel portal on the Eastern Bypass, hairpin road with painted parapets, mixed spruce / fir / pine / broadleaf forest, shrubs and rocks, tea terraces, Sandakphu viewpoint, Kanchenjunga panorama, snow-capped outer ranges, expedition trail.
- Performance pass described above.

## Testing

`npm run test:city` (scripts/test-city.mjs, pass a folder to save screenshots) boots the real app in headless Chrome and asserts: map + waypoints, fps on the metro platform, no fixed object inside any train envelope, every train serves every stop, crossing gates cycle, population > 500 with all outfits, **no two solid buildings intersect**, all six metro entrances walkable up through fare control and back, a steered supercar drives ramp → ring → exit, city/hills round trip, low and high tiers, zero browser errors. Run it after any layout change.

Placement rule learned the hard way: buildings are spaced with a circle of radius `hypot(w, d) / 2` (the box's half-diagonal), never `max(w, d) / 2`, and lane houses must stay inside their block's buildable square, or corners poke into neighbours and the road under the ring.

## Open work

- Hill bike physics for long rides; expedition trail polish.
- Portals to friends' worlds (needs their URLs; same stack).
- Ring flyover: verify a steered drive up the ramp and onto the ring end to end; consider traffic entering from the ramps.
- Stadium: an even larger footprint would need closing two grid roads; Eden's Burmese pagoda is not built.
- Realism backlog the user flagged (do in this order): GOBT office as a top-notch hero building; filler buildings have blank rear walls (perf choice `sides: false`), give them windows or real backs; tree and grass assets look stylised (swap to better GLB/foliage); road edges vs ground need kerb/verge texture; lamps and flyover need detail (expansion joints, drainage, signage); car engine sound and character movement feel.
- Narrow lanes only exist in 9 of 36 blocks (plots and districts reject the rest).
- Production deploy is still the draft site until the user approves.

## Conventions

No comments unless the why is non-obvious; keep layout constants in `Plan.ts`; run `npm run typecheck` before committing; do not add visible asset credits; never claim projects the user did not build (see `src/content.ts`).
