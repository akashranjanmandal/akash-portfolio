import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/* Trees: full meshes near the player, camera-facing impostors further
   away. The impostor texture is rendered from the real model at load
   time (4 views around the tree), so both LODs match. */

const CHUNK = 60
/** metres from a chunk's edge within which trees are full meshes (impostor billboards beyond) */

type Chunk = { cx: number; cz: number; near: THREE.InstancedMesh[]; far: THREE.InstancedMesh }

/** cutout leaves render faster than blended ones, sort correctly and cast leaf-shaped shadows */
export function prepareFoliage(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      if (mat.transparent || /leaf|leaves|foliage/i.test(mat.name)) {
        mat.transparent = false
        mat.alphaTest = 0.45
        mat.side = THREE.DoubleSide
        mat.depthWrite = true
        // a touch of translucency feel
        mat.roughness = Math.max(mat.roughness, 0.7)
      }
    }
    m.castShadow = true
    m.receiveShadow = true
  })
}

function bakeImpostor(renderer: THREE.WebGLRenderer, model: THREE.Object3D, env: THREE.Texture | null) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const views = 4
  const res = 256
  const target = new THREE.WebGLRenderTarget(res * views, res, { samples: 4 })
  target.texture.colorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.environment = env
  scene.environmentIntensity = 0.7
  const sun = new THREE.DirectionalLight('#fff3e0', 2.4)
  sun.position.set(0.6, 1, 0.4)
  scene.add(sun, new THREE.AmbientLight('#bcd2ff', 0.5))
  const clone = model.clone(true)
  clone.position.sub(center)
  scene.add(clone)
  const half = Math.max(size.x, size.z, size.y) / 2
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, half * 6)
  const prevTarget = renderer.getRenderTarget()
  const prevViewport = renderer.getViewport(new THREE.Vector4())
  const prevScissor = renderer.getScissor(new THREE.Vector4())
  const prevClear = renderer.getClearAlpha()
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  for (let i = 0; i < views; i++) {
    const a = (i / views) * Math.PI * 2
    cam.position.set(Math.sin(a) * half * 3, 0, Math.cos(a) * half * 3)
    cam.lookAt(0, 0, 0)
    renderer.setViewport(i * res, 0, res, res)
    renderer.setScissor(i * res, 0, res, res)
    renderer.setScissorTest(true)
    renderer.render(scene, cam)
  }
  renderer.setScissorTest(false)
  renderer.setRenderTarget(prevTarget)
  renderer.setViewport(prevViewport)
  renderer.setScissor(prevScissor)
  renderer.setClearAlpha(prevClear)
  renderer.toneMapping = prevTone
  return { texture: target.texture, width: half * 2, height: half * 2, centerY: center.y - box.min.y, views }
}

function impostorMaterial(tex: THREE.Texture, views: number) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: new THREE.Color(0.62, 0.66, 0.6) })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uViews = { value: views }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uViews;\nvarying float vView;')
      .replace(
        '#include <begin_vertex>',
        `
        // billboard around Y: face the camera, keep upright
        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sc = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
        vec3 toCam = cameraPosition - (modelMatrix * vec4(instPos, 1.0)).xyz;
        toCam.y = 0.0;
        toCam = normalize(toCam);
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        vec3 transformed = right * position.x * sc + vec3(0.0, position.y * sc, 0.0);
        // choose which baked view to show from the angle to the camera, in the tree's own frame
        float yaw = atan(instanceMatrix[2][0], instanceMatrix[2][2]);
        float ang = atan(toCam.x, toCam.z) - yaw;
        vView = mod(floor(ang / (6.2831853 / uViews) + 0.5), uViews);
        `,
      )
      .replace('#include <project_vertex>', `
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(instPos + transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uViews;\nvarying float vView;')
      .replace('#include <map_fragment>', `
        vec2 auv = vec2((vView + vMapUv.x) / uViews, vMapUv.y);
        vec4 sampledDiffuseColor = texture2D(map, auv);
        diffuseColor *= sampledDiffuseColor;`)
  }
  return mat
}

export class Forest {
  readonly group = new THREE.Group()
  private chunks: Chunk[] = []
  private lastCell = ''

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture | null, models: THREE.Object3D[], placements: { model: number; matrix: THREE.Matrix4 }[], private near = 45) {
    const baked = models.map((m) => {
      prepareFoliage(m)
      m.updateMatrixWorld(true)
      return bakeImpostor(renderer, m, env)
    })
    const byChunk = new Map<string, { model: number; matrix: THREE.Matrix4 }[]>()
    const p = new THREE.Vector3()
    for (const pl of placements) {
      p.setFromMatrixPosition(pl.matrix)
      const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`
      let arr = byChunk.get(key)
      if (!arr) byChunk.set(key, (arr = []))
      arr.push(pl)
    }
    const impMats = baked.map((b) => impostorMaterial(b.texture, b.views))
    for (const [key, list] of byChunk) {
      const [cx, cz] = key.split(',').map(Number)
      const near: THREE.InstancedMesh[] = []
      models.forEach((model, mi) => {
        const mine = list.filter((l) => l.model === mi)
        if (!mine.length) return
        model.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mine.length)
          mine.forEach((l, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(l.matrix, mesh.matrixWorld)))
          inst.castShadow = true
          inst.receiveShadow = true
          inst.computeBoundingSphere()
          inst.visible = false
          this.group.add(inst)
          near.push(inst)
        })
      })
      // one impostor mesh per chunk per tree type (merged into a single draw by using per-type meshes)
      const farGroup: THREE.InstancedMesh[] = []
      baked.forEach((b, mi) => {
        const mine = list.filter((l) => l.model === mi)
        if (!mine.length) return
        const geo = new THREE.PlaneGeometry(b.width, b.height).translate(0, b.centerY, 0)
        const inst = new THREE.InstancedMesh(geo, impMats[mi], mine.length)
        mine.forEach((l, i) => inst.setMatrixAt(i, l.matrix))
        inst.castShadow = false
        inst.receiveShadow = false
        inst.computeBoundingSphere()
        // the billboard spans more than the plane's bounds once rotated
        inst.boundingSphere!.radius += b.width
        this.group.add(inst)
        farGroup.push(inst)
      })
      const far = farGroup[0]
      far.userData.all = farGroup
      this.chunks.push({ cx, cz, near, far })
    }
  }

  /** swap LODs as the player moves (only when they cross into a new 20 m cell) */
  update(player: THREE.Vector3) {
    const cell = `${Math.round(player.x / 20)},${Math.round(player.z / 20)}`
    if (cell === this.lastCell) return
    this.lastCell = cell
    for (const c of this.chunks) {
      const x = (c.cx + 0.5) * CHUNK
      const z = (c.cz + 0.5) * CHUNK
      const d = Math.hypot(x - player.x, z - player.z) - CHUNK * 0.7
      const near = d < this.near
      for (const m of c.near) m.visible = near
      for (const m of c.far.userData.all as THREE.InstancedMesh[]) m.visible = !near
    }
  }
}

/** a clump of grass: three crossed cards with a painted blade texture */
function grassClump() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')!
  for (let i = 0; i < 90; i++) {
    const x = 4 + Math.random() * 120
    const h = 40 + Math.random() * 86
    const lean = (Math.random() - 0.5) * 30
    const k = Math.random()
    // dry olive to fresh green, darker at the root
    const grd = g.createLinearGradient(0, 128, 0, 128 - h)
    grd.addColorStop(0, `rgb(${40 + k * 20}, ${55 + k * 25}, ${25 + k * 10})`)
    grd.addColorStop(1, `rgb(${105 + k * 50}, ${125 + k * 45}, ${55 + k * 20})`)
    g.fillStyle = grd
    g.beginPath()
    g.moveTo(x - 1.4, 128)
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h)
    g.lineTo(x + 1.4, 128)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 })
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k++) parts.push(new THREE.PlaneGeometry(0.55, 0.3).translate(0, 0.15, 0).rotateY((k * Math.PI) / 3))
  const geo = mergeGeometries(parts)!
  // bend normals upwards so the cards shade like a lawn, not like walls
  const n = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3)
  geo.normalizeNormals()
  return { geo, mat }
}

/** grass clumps on lawns, built lazily in 30 m cells and shown only near the player */
export class GrassField {
  readonly group = new THREE.Group()
  private cells = new Map<string, THREE.InstancedMesh | null>()
  private clump = grassClump()
  private lastCell = ''
  private pending = false
  constructor(private grassy: (x: number, z: number) => boolean, private perCell: number, private y: number, private radius = 60) {}

  update(player: THREE.Vector3) {
    if (this.perCell <= 0) return
    const C = 30
    const cell = `${Math.floor(player.x / 10)},${Math.floor(player.z / 10)}`
    if (cell === this.lastCell && !this.pending) return
    this.lastCell = cell
    // build the missing cells nearest first, three per frame, until the area round the player is done
    const r0 = Math.ceil(this.radius / C)
    const pcx = Math.floor(player.x / C)
    const pcz = Math.floor(player.z / C)
    const todo: [number, number, number][] = []
    for (let i = -r0; i <= r0; i++) for (let j = -r0; j <= r0; j++) if (!this.cells.has(`${pcx + i},${pcz + j}`)) todo.push([i * i + j * j, pcx + i, pcz + j])
    todo.sort((a, b) => a[0] - b[0])
    for (const [, x, z] of todo.slice(0, 3)) this.cells.set(`${x},${z}`, this.build(x, z, C))
    this.pending = todo.length > 3
    for (const [key, mesh] of this.cells) {
      if (!mesh) continue
      const [cx, cz] = key.split(',').map(Number)
      mesh.visible = Math.hypot((cx + 0.5) * C - player.x, (cz + 0.5) * C - player.z) < this.radius + C * 0.7
    }
  }

  private build(cx: number, cz: number, C: number) {
    let seed = (cx * 73856093) ^ (cz * 19349663)
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const m: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (let k = 0; k < this.perCell; k++) {
      const x = (cx + rnd()) * C
      const z = (cz + rnd()) * C
      if (!this.grassy(x, z)) continue
      const s = 0.7 + rnd() * 0.8
      m.push(new THREE.Matrix4().compose(new THREE.Vector3(x, this.y, z), q.setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s)))
    }
    if (!m.length) return null
    const inst = new THREE.InstancedMesh(this.clump.geo, this.clump.mat, m.length)
    const col = new THREE.Color()
    m.forEach((mx, i) => {
      inst.setMatrixAt(i, mx)
      inst.setColorAt(i, col.setHSL(0.2 + rnd() * 0.06, 0.25 + rnd() * 0.15, 0.55 + rnd() * 0.2))
    })
    inst.receiveShadow = true
    inst.computeBoundingSphere()
    this.group.add(inst)
    return inst
  }
}
