export type Tier = 'low' | 'mid' | 'high'

const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches

export const reducedMotion = mq('(prefers-reduced-motion: reduce)')
export const coarsePointer = mq('(pointer: coarse)')
export const isTouch = coarsePointer || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && mq('(hover: none)'))

export const params = new URLSearchParams(location.search)

export function hasWebGL(): boolean {
  if (params.has('nogl')) return false
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

/** Guess a quality tier from the device and the GPU string. Overridable with ?quality=low|mid|high */
export function detectTier(gl: WebGL2RenderingContext): Tier {
  const forced = params.get('quality')
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced

  let renderer = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  } catch {
    /* some browsers hide the GPU string; fall back to the device heuristics */
  }
  const r = renderer.toLowerCase()
  const software = /swiftshader|llvmpipe|software|basic render/.test(r)
  const weakGpu = /mali-[gt]?[0-7]\d\b|mali-4|adreno \(tm\) [2-5]\d\d|powervr|sgx|intel.*hd graphics [2-5]\d{2,3}\b/.test(r)
  const small = Math.min(screen.width, screen.height) < 768
  const cores = navigator.hardwareConcurrency || 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8

  if (software || weakGpu || cores <= 4 && memory <= 3) return 'low'
  if (isTouch || small) return 'mid'
  return 'high'
}
