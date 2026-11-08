import * as THREE from 'three'

/* Runtime retargeting: plays Mixamo clips on an invisible source rig
   (Xbot, T-pose) and drives a Ready Player Me avatar (A-pose) so every
   bone points the same way as the source. For each bone we precompute
   an offset that first aligns the target's rest direction with the
   source's, then each frame: targetModel = sourceModel × offset. */

type Pair = { src: THREE.Object3D; dst: THREE.Object3D; offset: THREE.Quaternion; parent: Pair | null }

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()
const va = new THREE.Vector3()
const vb = new THREE.Vector3()

function modelQuat(bone: THREE.Object3D, root: THREE.Object3D, out: THREE.Quaternion) {
  // rotation relative to the rig root (root transforms ignored)
  out.identity()
  const chain: THREE.Object3D[] = []
  let o: THREE.Object3D | null = bone
  while (o && o !== root) {
    chain.push(o)
    o = o.parent
  }
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion)
  return out
}

function modelPos(bone: THREE.Object3D, root: THREE.Object3D, out: THREE.Vector3) {
  const m = new THREE.Matrix4()
  const chain: THREE.Object3D[] = []
  let o: THREE.Object3D | null = bone
  while (o && o !== root) {
    chain.push(o)
    o = o.parent
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix()
    m.multiply(chain[i].matrix)
  }
  return out.setFromMatrixPosition(m)
}

export class Retargeter {
  readonly mixer: THREE.AnimationMixer
  private pairs: Pair[] = []
  private hips: Pair | null = null
  private hipScale = 1
  private hipRestY = 0
  private srcHipRestY = 0

  constructor(private srcRoot: THREE.Object3D, private dstRoot: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(srcRoot)
    const byName = new Map<string, Pair>()
    dstRoot.traverse((dst) => {
      if (!(dst as THREE.Bone).isBone) return
      const src = srcRoot.getObjectByName('mixamorig' + dst.name)
      if (!src) return
      byName.set(dst.name, { src, dst, offset: new THREE.Quaternion(), parent: null })
    })
    for (const p of byName.values()) {
      let o = p.dst.parent
      while (o && !byName.has(o.name)) o = o.parent
      p.parent = o ? byName.get(o.name)! : null
    }
    // depth-first order so parents are solved before children
    const order: Pair[] = []
    const visit = (p: Pair) => {
      if (order.includes(p)) return
      if (p.parent) visit(p.parent)
      order.push(p)
    }
    byName.forEach(visit)
    this.pairs = order

    for (const p of this.pairs) {
      const srcRest = modelQuat(p.src, srcRoot, new THREE.Quaternion())
      const dstRest = modelQuat(p.dst, dstRoot, new THREE.Quaternion())
      // align rest directions using the first child bone
      const childDst = p.dst.children.find((c) => (c as THREE.Bone).isBone)
      const childSrc = childDst ? srcRoot.getObjectByName('mixamorig' + childDst.name) : undefined
      const align = new THREE.Quaternion()
      if (childDst && childSrc && !/Hips|Spine|Neck|Head|Hand|Foot|Toe|Shoulder/.test(p.dst.name)) {
        const ds = modelPos(childSrc, srcRoot, va).sub(modelPos(p.src, srcRoot, vb)).normalize().clone()
        const dt = modelPos(childDst, dstRoot, va).sub(modelPos(p.dst, dstRoot, vb)).normalize().clone()
        align.setFromUnitVectors(dt, ds)
      }
      // offset = srcRest⁻¹ · align · dstRest
      p.offset.copy(srcRest).invert().multiply(align).multiply(dstRest)
    }
    this.hips = byName.get('Hips') ?? null
    if (this.hips) {
      // both in each rig's own local units (Xbot is in centimetres under a 0.01 armature)
      this.hipScale = this.hips.dst.position.y / (this.hips.src.position.y || 1)
      this.hipRestY = this.hips.dst.position.y
      this.srcHipRestY = this.hips.src.position.y
    }
    this.clips = clips.map((c) => this.mixer.clipAction(c))
  }

  readonly clips: THREE.AnimationAction[]

  update(dt: number) {
    this.mixer.update(dt)
    const srcModel = new Map<Pair, THREE.Quaternion>()
    for (const p of this.pairs) {
      const sm = p.parent ? srcModel.get(p.parent)!.clone().multiply(p.src.quaternion) : modelQuat(p.src, this.srcRoot, new THREE.Quaternion())
      srcModel.set(p, sm)
    }
    const dstModel = new Map<Pair, THREE.Quaternion>()
    for (const p of this.pairs) {
      const want = qa.copy(srcModel.get(p)!).multiply(p.offset)
      const parentModel = p.parent ? dstModel.get(p.parent)! : modelQuat(p.dst.parent!, this.dstRoot, qb)
      p.dst.quaternion.copy(parentModel).invert().multiply(want)
      dstModel.set(p, want.clone())
    }
    if (this.hips) {
      // vertical bob only; horizontal motion comes from the character controller
      this.hips.dst.position.y = this.hipRestY + (this.hips.src.position.y - this.srcHipRestY) * this.hipScale
    }
  }
}
