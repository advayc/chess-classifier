import type { GameRecord } from './types'

export const MAX_PGN_BYTES = 5 * 1024 * 1024
export const MAX_PGN_GAMES = 1000
export const PGN_TIMEOUT_MS = 30_000

export type PgnWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; games: GameRecord[]; skipped: number }
  | { type: 'error'; error: string }
