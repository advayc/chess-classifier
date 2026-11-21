# Quiet Square

Quiet Square turns a chess screenshot into an editable position and analyzes it with Stockfish 19. Recognition and search run in browser workers. The page serves the code and model files from the same origin. Screenshots stay on the device.

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Run `npm run build` to create the static site in `dist/` and `npm run preview` to serve that build locally. For static hosting, serve WebAssembly with the `application/wasm` MIME type. The full engine also works with one thread. Enable `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to allow multiple threads in supported browsers.

## Analyze a position

1. Choose, drop, or paste a screenshot of a complete 2D board. Use **Crop & rescan** if the screenshot includes other boards or the scanner misses.
2. Compare the result with the screenshot. Edit misread squares, confirm the coordinates and side to move, and fill in any known castling and en passant details. A complete FEN can also be loaded directly.
3. Select **Analyze position**. The first search uses the full Stockfish 19 neural network, up to depth 24 or 20 seconds, and then checks alternatives. The board previews the selected line. **Keep searching** lets Stockfish continue until you stop it. The engine is loaded on first use and is about 95 MB.

Scores are shown from White’s perspective. A screenshot usually cannot establish castling rights, en passant, or the draw and repetition history. Screenshot imports default to no castling rights, no en passant target, and a zero halfmove clock. Check the board before you search. Recognition works best with clear, axis-aligned 2D boards. The recommended move is the strongest found at the reported search depth, and can change with a deeper search.

Credits and license links are in [public/licenses.html](public/licenses.html).
