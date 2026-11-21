import { Chess, validateFen } from 'chess.js'
import type { Position, ValidatedPosition } from './types'

export const FILES = 'abcdefgh'
export const PIECE_NAMES: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }
export const CASTLING: Record<string, [string, string][]> = {
  K: [['e1', 'K'], ['h1', 'R']],
  Q: [['e1', 'K'], ['a1', 'R']],
  k: [['e8', 'k'], ['h8', 'r']],
  q: [['e8', 'k'], ['a8', 'r']],
}

export function fromPlacement(placement: string): string[] {
  return placement.split('/').flatMap(rank =>
    [...rank].flatMap(symbol => /[1-8]/.test(symbol) ? Array<string>(Number(symbol)).fill('') : [symbol]),
  )
}

export function toPlacement(squares: string[]): string {
  return Array.from({ length: 8 }, (_, row) =>
    squares.slice(row * 8, row * 8 + 8).map(piece => piece || '1').join('')
      .replace(/1+/g, run => String(run.length)),
  ).join('/')
}

export function squareAt(index: number): string {
  return FILES[index % 8] + (8 - Math.floor(index / 8))
}

export function indexOfSquare(square: string): number {
  return (8 - Number(square[1])) * 8 + FILES.indexOf(square[0])
}

export function pieceName(piece: string): string {
  return piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${PIECE_NAMES[piece.toLowerCase()]}` : 'empty'
}

export function fromFen(fen: string): Position {
  const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/)
  return { squares: fromPlacement(placement), turn, castling, ep, halfmove, fullmove }
}

export function toFen(position: Position): string {
  return [
    toPlacement(position.squares), position.turn, position.castling || '-',
    position.ep || '-', position.halfmove, position.fullmove,
  ].join(' ')
}

export function canCastle(squares: string[], right: string): boolean {
  return CASTLING[right].every(([square, piece]) => squares[indexOfSquare(square)] === piece)
}

export function validatePosition(position: Position): ValidatedPosition {
  if (!position.turn) return { error: 'Choose who moves next.' }
  if (!/^\d+$/.test(position.halfmove) || !/^\d+$/.test(position.fullmove) ||
      Number(position.halfmove) > 9999 || Number(position.fullmove) > 9999) {
    return { error: 'Enter valid whole numbers for the move counters.' }
  }

  const fen = toFen(position)
  const validation = validateFen(fen)
  if (!validation.ok) return { error: (validation.error ?? '').replace(/^Invalid FEN: /, '').replace(/^./, s => s.toUpperCase()) }

  for (const color of ['w', 'b']) {
    const pieces = position.squares.filter(piece => piece && (piece === piece.toUpperCase()) === (color === 'w'))
    if (pieces.length > 16 || pieces.filter(piece => piece.toLowerCase() === 'p').length > 8) {
      return { error: `${color === 'w' ? 'White' : 'Black'} has too many pieces or pawns.` }
    }
  }
  if ([...position.castling].some(right => right !== '-' && !canCastle(position.squares, right))) {
    return { error: 'A castling right needs its king and rook on their starting squares.' }
  }

  const chess = new Chess(fen)
  const otherKing = position.squares.indexOf(position.turn === 'w' ? 'k' : 'K')
  if (chess.isAttacked(squareAt(otherKing) as never, position.turn as never)) {
    return { error: 'The side that just moved is in check. Check the pieces and side to move.' }
  }

  if (position.ep && position.ep !== '-') {
    const target = indexOfSquare(position.ep)
    const step = position.turn === 'w' ? 8 : -8
    const pawn = position.turn === 'w' ? 'p' : 'P'
    if (position.squares[target] || position.squares[target + step] !== pawn ||
        position.squares[target - step] || Number(position.halfmove) !== 0) {
      return { error: 'The en passant square must match the last pawn move. Its halfmove clock must be zero.' }
    }
  }
  return { fen, chess }
}

export function fromFenInput(value: string): { error: string; position?: undefined } | { error?: undefined; position: Position } {
  const fen = value.trim().replace(/\s+/g, ' ')
  if (fen.split(' ').length !== 6) return { error: 'Paste a complete FEN with all six fields.' }
  const validation = validateFen(fen)
  if (!validation.ok) return { error: validation.error ?? 'Invalid FEN.' }
  const position = fromFen(fen)
  const { error } = validatePosition(position)
  return error ? { error } : { position }
}

export interface LineMove {
  from: string
  to: string
  color: 'w' | 'b'
  san: string
  piece: import('chess.js').PieceSymbol
  uci: string
  fen: string
  before: string
  moveNumber: number
}

export function replayLine(fen: string, uciMoves: string[]): LineMove[] {
  const chess = new Chess(fen)
  const line: LineMove[] = []
  for (const uci of uciMoves) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      line.push({
        from: move.from, to: move.to, color: move.color, san: move.san, piece: move.piece, uci, before: move.before,
        fen: chess.fen(), moveNumber: chess.moveNumber() - (move.color === 'b' ? 1 : 0),
      })
    } catch {
      break
    }
  }
  return line
}

export function lineNotation(line: LineMove[]): string {
  return line.map((move, index) => {
    if (move.color === 'w') return `${move.moveNumber}.${move.san}`
    if (index === 0) return `${move.moveNumber}…${move.san}`
    return move.san
  }).join(' ')
}
