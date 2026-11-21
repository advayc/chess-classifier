/** Centipawn → expected White win probability (Lichess-style logistic). */
const CP_SCALE = 0.00368208

export function scoreToWhiteWin(type: 'cp' | 'mate', score: number): number {
  if (type === 'mate') {
    if (score === 0) return 0.5
    return score > 0 ? 1 : 0
  }
  return 1 / (1 + Math.exp(-CP_SCALE * score))
}

// UCI scores are relative to the side to move.
export const sideWinChance = scoreToWhiteWin

export function winLossPct(before: number, after: number): number {
  return (before - after) * 100
}
