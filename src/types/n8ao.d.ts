declare module 'n8ao' {
  import type { Camera, Scene, Color } from 'three'
  import { Pass } from 'postprocessing'
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: {
      aoRadius: number
      distanceFalloff: number
      intensity: number
      color: Color
      halfRes: boolean
      aoSamples: number
      denoiseSamples: number
      denoiseRadius: number
      screenSpaceRadius: boolean
      gammaCorrection: boolean
    }
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void
    setSize(width: number, height: number): void
  }
}
