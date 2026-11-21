import type { NextConfig } from 'next'

const isolation = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
]

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: isolation }]
  },
  turbopack: {
    // Keep ONNX Runtime's wasm out of the bundle. The vision worker loads it from /runtime.
    resolveAlias: {
      'onnxruntime-web/wasm': 'onnxruntime-web/dist/ort.wasm.min.mjs',
    },
  },
}

export default config
