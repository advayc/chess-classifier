import { Chess } from 'chess.js'
import { replayLine } from '../position'

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function materialFor(fen: string, color: 'w' | 'b'): number {
  const board = new Chess(fen)
  let total = 0
  for (const row of board.board()) {
    for (const square of row) {
      if (!square || square.color !== color) continue
      total += VALUE[square.type] || 0
    }
  }
  return total
}

// A sacrifice loses material after the opponent replies and the mover can recapture.
export function materialSacrifice(beforeFen: string, pv: string[], color: 'w' | 'b'): number {
  const line = replayLine(beforeFen, pv.slice(0, 3))
  if (line.length < 3) return 0
  const opponent = color === 'w' ? 'b' : 'w'
  const balance = (fen: string) => materialFor(fen, color) - materialFor(fen, opponent)
  return balance(beforeFen) - balance(line[2].fen)
}
