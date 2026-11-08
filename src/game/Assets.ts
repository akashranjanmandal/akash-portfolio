import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

const BASE = import.meta.env.DEV ? '/assets/' : 'assets/'

export type PBR = { map: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture }

/** Loads every model and texture the world needs, reporting overall progress. */
export class Assets {
  readonly models = new Map<string, GLTF>()
  readonly textures = new Map<string, PBR>()
  /** plain images used on signs and screens, keyed by their public path */
  readonly images = new Map<string, THREE.Texture>()
  private gltf = new GLTFLoader()
  private tex = new THREE.TextureLoader()
  private done = 0
  private total = 0

  constructor(private onProgress: (p: number) => void, renderer: THREE.WebGLRenderer, private maxAniso = 8) {
    this.gltf.setMeshoptDecoder(MeshoptDecoder)
    this.gltf.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer))
  }

  private tick() {
    this.done++
    this.onProgress(this.total ? this.done / this.total : 1)
  }

  async load(models: string[], textures: string[], images: string[] = []) {
    this.total = models.length + textures.length * 3 + images.length
    const root = import.meta.env.DEV ? '/' : ''
    await Promise.all([
      ...images.map(async (path) => {
        try {
          const t = await this.tex.loadAsync(root + path)
          t.colorSpace = THREE.SRGBColorSpace
          t.anisotropy = this.maxAniso
          this.images.set(path, t)
        } catch {
          /* a missing screenshot just leaves the screen dark */
        }
        this.tick()
      }),
      ...models.map(async (name) => {
        try {
          this.models.set(name, await this.gltf.loadAsync(`${BASE}models/${name}.glb`))
        } catch (e) {
          console.warn('model failed', name, e)
        }
        this.tick()
      }),
      ...textures.map(async (id) => {
        const load = async (kind: string, srgb: boolean) => {
          try {
            const t = await this.tex.loadAsync(`${BASE}textures/${id}_${kind}.webp`)
            t.wrapS = t.wrapT = THREE.RepeatWrapping
            t.anisotropy = this.maxAniso
            if (srgb) t.colorSpace = THREE.SRGBColorSpace
            return t
          } catch {
            return undefined
          } finally {
            this.tick()
          }
        }
        const [map, normalMap, roughnessMap] = await Promise.all([load('diff', true), load('nor', false), load('rough', false)])
        if (map) this.textures.set(id, { map, normalMap, roughnessMap })
      }),
    ])
  }

  /** a standard material from a texture set, tiled `repeat` times */
  material(id: string, repeat: number | [number, number], params: THREE.MeshStandardMaterialParameters = {}) {
    const set = this.textures.get(id)
    const m = new THREE.MeshStandardMaterial({ roughness: 1, ...params })
    if (!set) return m
    const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat
    const clone = (t?: THREE.Texture) => {
      if (!t) return undefined
      const c = t.clone()
      c.repeat.set(rx, ry)
      c.needsUpdate = true
      return c
    }
    m.map = clone(set.map) ?? null
    m.normalMap = clone(set.normalMap) ?? null
    m.roughnessMap = clone(set.roughnessMap) ?? null
    return m
  }

  /** a fresh copy of a model's scene with shadows on */
  instance(name: string) {
    const g = this.models.get(name)
    if (!g) return new THREE.Group()
    const root = g.scene.clone(true)
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return root
  }
}
