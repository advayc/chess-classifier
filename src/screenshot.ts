import type { CropRect } from './crop'
import type { Detection } from './detection-view'

export const SCREENSHOT_EVENT = 'position-screenshot'

export function clipboardImage(clipboard: DataTransfer | null): File | null {
  if (!clipboard) return null
  for (const item of clipboard.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return Array.from(clipboard.files).find(file => file.type.startsWith('image/')) ?? null
}

export type ScanRequest = { type: 'scan'; id: number; sourceId: number; file: File; crop?: CropRect }
export type VisionRequest = ScanRequest | { type: 'prepare' } | { type: 'clear' }
export type ScanResult = {
  orientation: 'white' | 'black'
  uncertain: number[]
  placement: string
  detection: Detection
  reliable: boolean
}
export type VisionResponse =
  | { type: 'progress'; id: number; label: string; value: number }
  | { type: 'result'; id: number; result: ScanResult }
  | { type: 'error'; id: number; message: string }
