import type { NextConfig } from 'next'

const isolation = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
]

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: isolation },
      {
        // Stockfish and ONNX binaries are version-pinned; cache them so repeat visits skip the download.
        source: '/runtime/:file(.*\\.(?:wasm|onnx))',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=86400' }],
      },
    ]
  },
  turbopack: {
    // Keep ONNX Runtime's wasm out of the bundle. The vision worker loads it from /runtime.
    resolveAlias: {
      'onnxruntime-web/wasm': 'onnxruntime-web/dist/ort.wasm.min.mjs',
    },
  },
}

export default config
