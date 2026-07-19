declare module 'gifenc' {
  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: number[][]
        delay?: number
        repeat?: number
        transparent?: boolean
        dispose?: number
        first?: boolean
      },
    ): void
    finish(): void
    bytes(): Uint8Array<ArrayBuffer>
  }
  export type PaletteFormat = 'rgb565' | 'rgb444' | 'rgba4444'
  export function GIFEncoder(): GIFEncoderInstance
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: PaletteFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): number[][]
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: PaletteFormat,
  ): Uint8Array
}
