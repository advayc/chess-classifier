import { CONFIDENCE_FLOOR, extractTiles, probsToPlacement, recognizeGray, resolveOrientation, rgbaToGray } from '@scoriiu/fenshot'
import * as ort from 'onnxruntime-web/wasm'

let sessionPromise

function loadModel(runtime) {
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

function toGray(bitmap, crop) {
  const x = crop ? Math.round(crop.x * bitmap.width) : 0
  const y = crop ? Math.round(crop.y * bitmap.height) : 0
  const width = crop ? Math.round(crop.w * bitmap.width) : bitmap.width
  const height = crop ? Math.round(crop.h * bitmap.height) : bitmap.height
  if (Math.min(width, height) < 80) throw new Error('The board area is too small. Try a larger screenshot or crop.')
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height)
  return rgbaToGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
}

self.onmessage = async ({ data: { id, file, crop, runtime } }) => {
  const status = (label, value) => self.postMessage({ id, label, value })
  let bitmap
  try {
    status('Opening screenshot', 1)
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      throw new Error('This image could not be opened. Try a PNG, JPEG, or WebP screenshot.')
    }
    const gray = toGray(bitmap, crop)
    bitmap.close()
    bitmap = null

    status('Finding the board', 2)
    let announced = false
    const classify = async corners => {
      if (!announced) {
        status('Reading pieces', 3)
        announced = true
      }
      let session
      try {
        session = await loadModel(runtime)
      } catch {
        throw new Error('The vision model could not start. Try scanning again or enter the position as FEN.')
      }
      const tiles = extractTiles(gray, corners)
      const output = await session.run({ tiles: new ort.Tensor('float32', tiles, [64, 1024]) })
      return probsToPlacement(output.probs.data)
    }
    let scan = await recognizeGray(gray, classify)
    if ((!scan || !scan.reliable) && crop) {
      const cropRead = await classify({ x0: 0, y0: 0, x1: gray.width, y1: gray.height })
      const plausible = [...cropRead.placement].filter(piece => piece === 'K').length === 1 &&
        [...cropRead.placement].filter(piece => piece === 'k').length === 1
      if (!scan || (plausible && (!scan.plausible || cropRead.meanConfidence >= scan.meanConfidence))) {
        scan = { ...cropRead, plausible, reliable: plausible && cropRead.minConfidence >= CONFIDENCE_FLOOR }
      }
    }
    if (!scan || (!scan.plausible && !crop)) {
      throw new Error('Couldn’t find a complete board. Crop close to all 64 squares and try again.')
    }
    const { placement, orientation } = resolveOrientation(scan.placement)
    // Model confidences start at a1; the board array starts at a8.
    const confidences = orientation === 'black' ? [...scan.confidences].reverse() : scan.confidences
    const uncertain = confidences.flatMap((value, index) =>
      value < CONFIDENCE_FLOOR ? [((7 - Math.floor(index / 8)) * 8) + index % 8] : [],
    )
    self.postMessage({ id, result: { placement, orientation, uncertain, reliable: scan.reliable } })
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Couldn’t read this screenshot.' })
  } finally {
    bitmap?.close()
  }
}
