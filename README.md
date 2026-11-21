# Chess Engine

Review a full game with Stockfish 19, or open **Position** to analyze a screenshot, FEN, PGN position, or manually arranged board. Game review, screenshot recognition, and PGN parsing run in browser workers.

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the URL Next.js prints. Use `npm run build` and `npm start` for a production build.

## Game review

Import a Chess.com or Lichess username or game link, paste PGN, or choose a PGN file. When a site blocks a link import, paste its exported PGN. The board shows the players, ratings when available, and the engine's leading move and alternatives for the displayed position. Open **Game results and accuracy** below the board for the graph, classification totals, and estimated game rating.

Play or drag a legal move to branch from the current position. **Back to game** restores the original line. In **Position**, turn on **Edit board** to drag freely, including moves that would be illegal in a game.

### How classification works

Stockfish searches up to three lines per position with a depth target of 14 and a 350 ms time budget. If the played move is outside those lines, the engine searches that move separately. The classifier compares the estimated win chance for the player who moved against the engine's best line. Opening matches can earn Book, a uniquely strong move can earn Great, and a near-best sacrifice can earn Brilliant. Accuracy combines the move labels and feeds a rough game-rating estimate.

After the engine downloads and initializes, search usually takes a fraction of a second per ply. Game length, position complexity, and device speed affect the total. Live variations and position analysis use a deeper search, up to depth 24 or 20 seconds for the primary line. The displayed best move is Stockfish's choice at the completed search depth and can change with a longer search.

### Position analysis

Upload a full 2D board screenshot, paste FEN, load PGN, or start from an empty board. Check screenshot recognition and confirm whose turn it is before searching. Screenshot imports start with no castling or en passant rights. Expand **Historical game results** below the workspace for matching completed games from the imported PGN or the bundled Lichess opening sample. Those results are independent of Stockfish's estimates.

To rebuild the bundled opening sample, feed the decompressed October 2025 [Lichess standard rated PGN export](https://database.lichess.org/#standard_games) into `npx tsx scripts/build-opening-sample.ts > src/opening-sample.json`. Opening names and ECO codes come from the [Lichess opening dataset](https://github.com/lichess-org/chess-openings). See [open-source credits](public/licenses.html).
