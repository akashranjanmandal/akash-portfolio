// Thin a foliage GLB: keep a share of leaf cards (enlarged to keep coverage), drop small twigs, simplify trunk/branches.
// usage: node scripts/thin-foliage.mjs in.glb out.glb 0.085 1.85, then gltf-transform resize (512 for trunk/branches) and meshopt
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer'
import { simplifyPrimitive, weld, prune, dedup } from '@gltf-transform/functions'
await MeshoptDecoder.ready; await MeshoptSimplifier.ready; await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const [src, dst, keepFrac, grow] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]]
const d = await io.read(src)
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const name = p.getMaterial()?.getName() ?? ''
  const idx = p.getIndices(), a = idx.getArray()
  if (/leaves/.test(name)) {
    // union-find leaf cards over shared vertices
    const n = p.getAttribute('POSITION').getCount(), par = new Int32Array(n).map((_, i) => i)
    const f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x }
    for (let t = 0; t < a.length; t += 3) { const r0 = f(a[t]); par[f(a[t + 1])] = r0; par[f(a[t + 2])] = r0 }
    const keep = new Map()
    const out = []
    for (let t = 0; t < a.length; t += 3) {
      const r = f(a[t])
      if (!keep.has(r)) keep.set(r, rnd() < keepFrac)
      if (keep.get(r)) out.push(a[t], a[t + 1], a[t + 2])
    }
    // grow each kept card about its centroid so the canopy keeps its coverage
    const pos = p.getAttribute('POSITION'), v = [0, 0, 0], cen = new Map(), cnt = new Map()
    const used = new Set(out)
    for (const i of used) { pos.getElement(i, v); const r = f(i); const c = cen.get(r) ?? [0, 0, 0]; c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; cen.set(r, c); cnt.set(r, (cnt.get(r) ?? 0) + 1) }
    // positions may be quantized; work through a float copy
    const fa = new Float32Array(pos.getCount() * 3)
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); fa.set(v, i * 3) }
    for (const i of used) { const r = f(i), c = cen.get(r), k = cnt.get(r); for (let j = 0; j < 3; j++) { const m0 = c[j] / k; fa[i * 3 + j] = m0 + (fa[i * 3 + j] - m0) * grow } }
    const np = d.createAccessor().setType('VEC3').setArray(fa)
    p.setAttribute('POSITION', np)
    idx.setArray(new Uint32Array(out))
    console.log('leaves', a.length / 3, '->', out.length / 3)
  } else {
    const before = a.length / 3
    if (/branches/.test(name)) {
      // twigs are thousands of tiny separate pieces: keep every big limb, only a few of the small ones
      const pos = p.getAttribute('POSITION'), n = pos.getCount(), par = new Int32Array(n).map((_, i) => i), v = [0, 0, 0]
      const f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x }
      for (let t = 0; t < a.length; t += 3) { const r0 = f(a[t]); par[f(a[t + 1])] = r0; par[f(a[t + 2])] = r0 }
      const lo = new Map(), hi = new Map()
      for (let i = 0; i < n; i++) { pos.getElement(i, v); const r = f(i); const l = lo.get(r) ?? [1e9, 1e9, 1e9], h = hi.get(r) ?? [-1e9, -1e9, -1e9]; for (let j = 0; j < 3; j++) { l[j] = Math.min(l[j], v[j]); h[j] = Math.max(h[j], v[j]) } lo.set(r, l); hi.set(r, h) }
      const keep = new Map(), out = []
      for (let t = 0; t < a.length; t += 3) {
        const r = f(a[t])
        if (!keep.has(r)) { const l = lo.get(r), h = hi.get(r); const diag = Math.hypot(h[0] - l[0], h[1] - l[1], h[2] - l[2]); keep.set(r, diag > 0.25 || rnd() < 0.15) }
        if (keep.get(r)) out.push(a[t], a[t + 1], a[t + 2])
      }
      idx.setArray(new Uint32Array(out))
      console.log('branch pieces kept', [...keep.values()].filter(Boolean).length, '/', keep.size, 'tris', out.length / 3)
    }
    {
      // the source lists many triangles twice; drop the copies before simplifying
      const cur = p.getIndices().getArray(), seen = new Set(), out = []
      for (let t = 0; t < cur.length; t += 3) { const k = [cur[t], cur[t + 1], cur[t + 2]].sort((x, y) => x - y).join(','); if (!seen.has(k)) { seen.add(k); out.push(cur[t], cur[t + 1], cur[t + 2]) } }
      p.getIndices().setArray(new Uint32Array(out))
    }
    await simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: /trunk/.test(name) ? 0.15 : 0.03, error: /trunk/.test(name) ? 0.3 : 0.08, lockBorder: false })
    console.log(name, before, '->', p.getIndices().getCount() / 3)
  }
}
// drop roughness maps (constant roughness is fine for foliage)
for (const mat of d.getRoot().listMaterials()) { mat.setMetallicRoughnessTexture(null); mat.setRoughnessFactor(0.85); mat.setMetallicFactor(0) }
await d.transform(prune(), dedup())
await io.write(dst, d)
