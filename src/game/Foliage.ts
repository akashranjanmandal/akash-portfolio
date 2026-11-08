import * as THREE from 'three'

/* Trees: full meshes near the player, camera-facing impostors further
   away. The impostor texture is rendered from the real model at load
   time (4 views around the tree), so both LODs match. */

const CHUNK = 80
const NEAR = 95 // metres: full mesh inside, impostor outside

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

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture | null, models: THREE.Object3D[], placements: { model: number; matrix: THREE.Matrix4 }[]) {
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
      const near = d < NEAR
      for (const m of c.near) m.visible = near
      for (const m of c.far.userData.all as THREE.InstancedMesh[]) m.visible = !near
    }
  }
}
