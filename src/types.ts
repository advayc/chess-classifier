import type { Chess, Color, Move, PieceSymbol } from 'chess.js'

export type { Chess, Color, Move, PieceSymbol }

/** A board position in the editable form the UI keeps (one entry per square, a8 first). */
export interface Position {
  squares: string[]
  turn: string
  castling: string
  ep: string
  halfmove: string
  fullmove: string
}

/** One played move with the data the UI and the review need. */
export interface RecordedMove {
  from: string
  to: string
  color: Color
  san: string
  piece: PieceSymbol
  uci: string
  /** Position key (first four FEN fields) before the move. */
  before: string
  /** Full FEN after the move. */
  fen: string
  moveNumber: number
}

export interface GameRecord {
  startFen: string
  moves: RecordedMove[]
  ply?: number
  title?: string
  result?: string
  white?: string
  black?: string
  whiteElo?: number
  blackElo?: number
  site?: string
  link?: string
  rated?: boolean
  playedAt?: string
  timeControl?: string
  /** Set while the board shows a review variation that left the played game. */
  variationFrom?: number
}

export type OutcomeCounts = [number, number, number]
export type OpeningRow = [uci: string, white: number, draw: number, black: number]
export interface OpeningSample {
  games: number
  positions: Record<string, OpeningRow[]>
}

export interface EngineInfo {
  depth: number
  type: 'cp' | 'mate'
  score: number
  pv: string[]
  wdl: number[] | null
  rank: number
  bound: boolean
}

export type ValidatedPosition =
  | { error: string; fen?: undefined; chess?: undefined }
  | { error?: undefined; fen: string; chess: Chess }
