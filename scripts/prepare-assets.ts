import { copyFile, mkdir, writeFile } from 'node:fs/promises'

import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { siChessdotcom, siLichess } from 'simple-icons'

const root = new URL('../', import.meta.url)
const runtime = new URL('public/runtime/', root)
await mkdir(runtime, { recursive: true })

const assets: Record<string, string[]> = {
  'stockfish/bin': [
    'stockfish-19.js', 'stockfish-19.wasm', 'stockfish-19-single.js', 'stockfish-19-single.wasm',
    'stockfish-19-lite.js', 'stockfish-19-lite.wasm', 'stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm',
  ],
  'onnxruntime-web/dist': ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'],
  '@scoriiu/fenshot/model': ['chess-tiles-v2.onnx'],
}
await Promise.all(Object.entries(assets).flatMap(([directory, files]) =>
  files.map(file => copyFile(new URL(`node_modules/${directory}/${file}`, root), new URL(file, runtime))),
))
await copyFile(new URL('node_modules/stockfish/Copying.txt', root), new URL('stockfish-license.txt', runtime))
await copyFile(new URL('node_modules/@scoriiu/fenshot/LICENSE', root), new URL('fenshot-license.txt', runtime))
await copyFile(new URL('node_modules/@mliebelt/pgn-parser/LICENSE', root), new URL('pgn-parser-license.txt', runtime))

await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: {
    'position-app': 'src/main.ts',
    'position-vision': 'src/vision.worker.ts',
    'pgn-reader': 'src/pgn.worker.ts',
  },
  outdir: fileURLToPath(runtime),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['./ort-wasm-simd-threaded.mjs', './ort-wasm-simd-threaded.wasm'],
})
for (const mark of [siChessdotcom, siLichess]) {
  await writeFile(new URL(`${mark.slug}.svg`, runtime), mark.svg.replace('<svg ', `<svg fill="#${mark.hex}" `))
}
