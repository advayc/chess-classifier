import { copyFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const runtime = new URL('public/runtime/', root)
await mkdir(runtime, { recursive: true })

const assets = {
  'stockfish/bin': ['stockfish-19.js', 'stockfish-19.wasm', 'stockfish-19-single.js', 'stockfish-19-single.wasm'],
  'onnxruntime-web/dist': ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'],
  '@scoriiu/fenshot/model': ['chess-tiles-v2.onnx'],
}
await Promise.all(Object.entries(assets).flatMap(([directory, files]) =>
  files.map(file => copyFile(new URL(`node_modules/${directory}/${file}`, root), new URL(file, runtime))),
))
await copyFile(new URL('node_modules/stockfish/Copying.txt', root), new URL('stockfish-license.txt', runtime))
await copyFile(new URL('node_modules/@scoriiu/fenshot/LICENSE', root), new URL('fenshot-license.txt', runtime))
