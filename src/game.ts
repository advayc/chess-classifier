import type { Chess, Move } from 'chess.js'
import type { GameRecord, OpeningRow, RecordedMove } from './types'

export const RESULT_INDEX: Record<string, number> = { '1-0': 0, '1/2-1/2': 1, '0-1': 2 }

export function positionKey(fen: string): string {
  return fen.split(' ', 4).join(' ')
}

export function uciMove(move: { from: string; to: string; promotion?: string }): string {
  return move.from + move.to + (move.promotion || '')
}

export function recordMove(chess: Chess, move: Move): RecordedMove {
  return {
    from: move.from, to: move.to, color: move.color, san: move.san, piece: move.piece,
    uci: uciMove(move), before: positionKey(move.before), fen: chess.fen(),
    moveNumber: chess.moveNumber() - (move.color === 'b' ? 1 : 0),
  }
}

export function gameResults(games: GameRecord[], key: string): OpeningRow[] {
  const results = new Map<string, [number, number, number]>()
  for (const game of games) {
    const result = RESULT_INDEX[game.result ?? '']
    if (result === undefined) continue
    // Count the game only once if the same position recurs.
    const move = game.moves.find(ply => ply.before === key)
    if (!move) continue
    if (!results.has(move.uci)) results.set(move.uci, [0, 0, 0])
    results.get(move.uci)![result]++
  }
  return [...results.entries()].map(([move, counts]) => [move, ...counts] as OpeningRow)
}
