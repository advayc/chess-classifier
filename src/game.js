export const RESULT_INDEX = { '1-0': 0, '1/2-1/2': 1, '0-1': 2 }

export function positionKey(fen) {
  return fen.split(' ', 4).join(' ')
}

export function uciMove(move) {
  return move.from + move.to + (move.promotion || '')
}

export function recordMove(chess, move) {
  return {
    from: move.from, to: move.to, color: move.color, san: move.san, piece: move.piece,
    uci: uciMove(move), before: positionKey(move.before), fen: chess.fen(),
    moveNumber: chess.moveNumber() - (move.color === 'b' ? 1 : 0),
  }
}

export function gameResults(games, key) {
  const results = new Map()
  for (const game of games) {
    const result = RESULT_INDEX[game.result]
    if (result === undefined) continue
    // Count the game only once if the same position recurs.
    const move = game.moves.find(ply => ply.before === key)
    if (!move) continue
    if (!results.has(move.uci)) results.set(move.uci, [0, 0, 0])
    results.get(move.uci)[result]++
  }
  return [...results.entries()].map(([move, counts]) => [move, ...counts])
}
