import type { Color } from 'chess.js'
import type { MoveClass } from './classify'

/** Estimate move quality from the loss in engine-evaluated winning chances.
 * This is a transparent approximation, not Chess.com's proprietary CAPS2 score.
 */
export function accuracyFor(moves: { dropPct: number; label: MoveClass }[]): number {
  if (!moves.length) return 0
  const scores = moves.map(move => {
    if (move.label === 'book' || move.label === 'forced') return 100
    const loss = Math.max(0, Math.min(100, move.dropPct))
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1668))
  })
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const harmonic = scores.some(score => score === 0) ? 0 : scores.length / scores.reduce((sum, score) => sum + 1 / score, 0)
  return Math.round((mean + harmonic) * 5) / 10
}

const RATING_ACCURACY_ANCHORS = [
  [20, 250],
  [30, 450],
  [50, 700],
  [60, 900],
  [70, 1200],
  [80, 1600],
  [90, 2100],
  [95, 2400],
  [99.5, 2800],
] as const

function interpolateAccuracyRating(accuracy: number): number {
  const clamped = Math.max(20, Math.min(99.5, accuracy))
  for (let index = 1; index < RATING_ACCURACY_ANCHORS.length; index++) {
    const [nextAccuracy, nextRating] = RATING_ACCURACY_ANCHORS[index]
    const [previousAccuracy, previousRating] = RATING_ACCURACY_ANCHORS[index - 1]
    if (clamped <= nextAccuracy) {
      const fraction = (clamped - previousAccuracy) / (nextAccuracy - previousAccuracy)
      return previousRating + fraction * (nextRating - previousRating)
    }
  }
  return RATING_ACCURACY_ANCHORS[RATING_ACCURACY_ANCHORS.length - 1][1]
}

/**
 * Estimate game performance Elo from engine accuracy.
 *
 * This uses a calibrated, monotonic accuracy-to-rating curve rather than a
 * linear percentage shortcut. The confidence rises with move count. When an
 * actual imported Elo is available, it anchors the estimate; a small sample
 * is prevented from producing an extreme jump.
 */
export function estimatedRating(
  accuracy: number,
  moveCount: number,
  actualRating?: number | null,
): number | null {
  if (moveCount < 4) return null

  const performance = interpolateAccuracyRating(accuracy)
  if (!actualRating || !Number.isFinite(actualRating) || actualRating < 100) {
    const sampleConfidence = Math.min(0.35, moveCount / 80)
    return Math.round(performance * (0.65 + sampleConfidence) + 1200 * (0.35 - sampleConfidence))
  }

  const anchoringWeight = Math.min(0.55, 0.25 + moveCount / 200)
  const rating = actualRating * anchoringWeight + performance * (1 - anchoringWeight)
  return Math.round(rating)
}

export function splitByColor(
  classes: { color: Color; label: MoveClass }[],
): { w: MoveClass[]; b: MoveClass[] } {
  return {
    w: classes.filter(entry => entry.color === 'w').map(entry => entry.label),
    b: classes.filter(entry => entry.color === 'b').map(entry => entry.label),
  }
}
