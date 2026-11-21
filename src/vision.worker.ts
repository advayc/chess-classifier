import { CONFIDENCE_FLOOR, extractTiles, probsToPlacement, recognizeGray, resolveOrientation, rgbaToGray } from '@scoriiu/fenshot'
import * as ort from 'onnxruntime-web/wasm'

let sessionPromise: Promise<ort.InferenceSession> | null = null

function loadModel(runtime: string): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = {
      mjs: new URL('ort-wasm-simd-threaded.mjs', runtime).href,
      wasm: new URL('ort-wasm-simd-threaded.wasm', runtime).href,
    }
    sessionPromise = ort.InferenceSession.create(new URL('chess-tiles-v2.onnx', runtime).href, {
      executionProviders: ['wasm'],
    }).catch(error => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

interface Crop { x: number; y: number; w: number; h: number }

function toGray(bitmap: ImageBitmap, crop?: Crop | null) {
  const x = crop ? Math.round(crop.x * bitmap.width) : 0
  const y = crop ? Math.round(crop.y * bitmap.height) : 0
  const width = crop ? Math.round(crop.w * bitmap.width) : bitmap.width
  const height = crop ? Math.round(crop.h * bitmap.height) : bitmap.height
  if (Math.min(width, height) < 80) throw new Error('The board area is too small. Try a larger screenshot or crop.')
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot read images in the background.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height)
  return {
    gray: rgbaToGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height),
    source: { width: bitmap.width, height: bitmap.height },
    region: { x, y, width, height },
  }
}

interface ScanRequest { id: number; file: File; crop?: Crop | null; runtime: string }

self.onmessage = async ({ data: { id, file, crop, runtime } }: MessageEvent<ScanRequest>) => {
  const status = (label: string, value: number) => self.postMessage({ id, label, value })
  let bitmap: ImageBitmap | null = null
  try {
    status('Opening screenshot', 1)
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      throw new Error('This image could not be opened. Try a PNG, JPEG, or WebP screenshot.')
    }
    const { gray, source, region } = toGray(bitmap, crop)
    bitmap.close()
    bitmap = null

    status('Finding the board', 2)
    let announced = false
    const classify = async (corners: { x0: number; y0: number; x1: number; y1: number }) => {
      if (!announced) {
        status('Reading pieces', 3)
        announced = true
      }
      let session: ort.InferenceSession
      try {
        session = await loadModel(runtime)
      } catch {
        throw new Error('The vision model could not start. Try scanning again or enter the position as FEN.')
      }
      const tiles = extractTiles(gray, corners)
      const output = await session.run({ tiles: new ort.Tensor('float32', tiles, [64, 1024]) })
      return probsToPlacement(output.probs.data as Float32Array)
    }
    let scan = await recognizeGray(gray, classify)
    if ((!scan || !scan.reliable) && crop) {
      const corners = { x0: 0, y0: 0, x1: gray.width, y1: gray.height }
      const cropRead = await classify(corners)
      const plausible = [...cropRead.placement].filter(piece => piece === 'K').length === 1 &&
        [...cropRead.placement].filter(piece => piece === 'k').length === 1
      if (!scan || (plausible && (!scan.plausible || cropRead.meanConfidence >= scan.meanConfidence))) {
        scan = { ...cropRead, corners, plausible, reliable: plausible && cropRead.minConfidence >= CONFIDENCE_FLOOR }
      }
    }
    if (!scan || (!scan.plausible && !crop)) {
      throw new Error('Couldn’t find a complete board. Crop close to all 64 squares and try again.')
    }
    const { placement, orientation } = resolveOrientation(scan.placement)
    // Keep a visual copy in screenshot order, independent of the inferred board orientation.
    const tiles = Array.from({ length: 64 }, (_, index) => {
      const confidence = scan.confidences[(7 - Math.floor(index / 8)) * 8 + index % 8]
      return { confidence, uncertain: confidence < CONFIDENCE_FLOOR }
    })
    const uncertain = tiles.flatMap((tile, index) =>
      tile.uncertain ? [orientation === 'black' ? 63 - index : index] : [],
    )
    const scaleX = region.width / gray.width
    const scaleY = region.height / gray.height
    const { x0, y0, x1, y1 } = scan.corners
    const bounds = {
      x: region.x + x0 * scaleX, y: region.y + y0 * scaleY,
      width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY,
    }
    const detection = { source, bounds, placement: scan.placement, tiles }
    self.postMessage({ id, result: { placement, orientation, uncertain, reliable: scan.reliable, detection } })
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message || 'Couldn’t read this screenshot.' })
  } finally {
    bitmap?.close()
  }
}
