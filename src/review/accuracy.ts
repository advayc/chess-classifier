import type { Color } from 'chess.js'
import type { MoveClass } from './classify'

/** Estimate move quality from the loss in engine-evaluated winning chances.
 * This is a transparent approximation, not Chess.com's proprietary CAPS2 score.
 */
export function accuracyFor(moves: { dropPct: number; label: MoveClass }[]): number {
  if (!moves.length) return 0
  const scores = moves.map(move => {
    if (move.label === 'book') return 100
    const loss = Math.max(0, Math.min(100, move.dropPct))
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1668))
  })
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const harmonic = scores.some(score => score === 0) ? 0 : scores.length / scores.reduce((sum, score) => sum + 1 / score, 0)
  return Math.round((mean + harmonic) * 5) / 10
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
