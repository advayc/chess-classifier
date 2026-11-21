import type { Color } from 'chess.js'
import { winLossPct } from './win-prob'

export type MoveClass =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss'

export const CLASS_ORDER: MoveClass[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'blunder', 'miss',
]

export const CLASS_LABEL: Record<MoveClass, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  miss: 'Miss',
}

/** Drop in side win% from best line → played move. */
const THRESHOLDS = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
}

export interface ClassInput {
  playedUci: string
  bestUci: string
  /** Side-to-move win chance if best move is played (0–1). */
  bestWin: number
  /** Side-to-move win chance after the move that was played (0–1). */
  playedWin: number
  /** Second-best win chance; used for “only move”. */
  secondWin?: number
  /** True when the move was still in the opening sample. */
  book?: boolean
  /** Material lost by the player (positive = sacrifice). */
  materialSacrifice?: number
  color: Color
  /** Previous opponent classification, for Miss detection. */
  priorOpponent?: MoveClass
}

export function classifyMove(input: ClassInput): MoveClass {
  if (input.book && input.playedUci === input.bestUci) return 'book'
  if (input.book && winLossPct(input.bestWin, input.playedWin) < THRESHOLDS.good) return 'book'

  const drop = winLossPct(input.bestWin, input.playedWin)
  const isBest = input.playedUci === input.bestUci || drop <= 0.5

  if (
    input.priorOpponent &&
    (input.priorOpponent === 'mistake' || input.priorOpponent === 'blunder') &&
    drop >= THRESHOLDS.mistake
  ) {
    return 'miss'
  }

  if (isBest) {
    const onlyMove =
      input.secondWin !== undefined &&
      winLossPct(input.bestWin, input.secondWin) >= THRESHOLDS.mistake
    if ((input.materialSacrifice ?? 0) >= 2 && input.playedWin >= 0.45) return 'brilliant'
    if (onlyMove) return 'great'
    return 'best'
  }

  if (drop < THRESHOLDS.excellent) return 'excellent'
  if (drop < THRESHOLDS.good) return 'good'
  if (drop < THRESHOLDS.inaccuracy) return 'inaccuracy'
  if (drop < THRESHOLDS.mistake) return 'mistake'
  return 'blunder'
}

export function emptyClassCounts(): Record<MoveClass, number> {
  return Object.fromEntries(CLASS_ORDER.map(key => [key, 0])) as Record<MoveClass, number>
}
