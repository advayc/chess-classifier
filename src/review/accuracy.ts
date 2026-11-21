import type { Color } from 'chess.js'
import type { MoveClass } from './classify'

/** Cap accuracy contribution by classification (Chess.com-inspired weights). */
const WEIGHT: Record<MoveClass, number> = {
  brilliant: 1,
  great: 1,
  best: 1,
  excellent: 0.9,
  good: 0.7,
  book: 1,
  inaccuracy: 0.4,
  mistake: 0.15,
  blunder: 0,
  miss: 0.1,
}

export function accuracyFor(classes: MoveClass[]): number {
  if (!classes.length) return 100
  const sum = classes.reduce((total, label) => total + WEIGHT[label], 0)
  return Math.round((1000 * sum) / classes.length) / 10
}

/** Rough performance rating from accuracy; not a true Elo. */
export function estimatedRating(accuracy: number, moveCount: number): number | null {
  if (moveCount < 4) return null
  const clamped = Math.min(99.5, Math.max(20, accuracy))
  return Math.round(400 + (clamped / 100) * 2400)
}

export function splitByColor(
  classes: { color: Color; label: MoveClass }[],
): { w: MoveClass[]; b: MoveClass[] } {
  return {
    w: classes.filter(entry => entry.color === 'w').map(entry => entry.label),
    b: classes.filter(entry => entry.color === 'b').map(entry => entry.label),
  }
}
