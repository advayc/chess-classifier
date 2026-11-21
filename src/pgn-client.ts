import { MAX_PGN_BYTES, PGN_TIMEOUT_MS, type PgnWorkerMessage } from './pgn-protocol'
import type { GameRecord } from './types'

export interface PgnResult {
  games: GameRecord[]
  skipped: number
}

/** Returns an error message when the source is empty or too large, otherwise null. */
export function checkPgnSource(source: string | File): string | null {
  if (typeof source === 'string' && !source.trim()) return 'Paste a game or choose a PGN file first.'
  if ((typeof source === 'string' ? source.length : source.size) > MAX_PGN_BYTES) return 'Choose a PGN smaller than 5 MB.'
  return null
}

/**
 * Parses a PGN in a worker and reports progress as games are read.
 * Rejects with an Error whose message is safe to show to the user.
 */
export function parsePgn(source: string | File, onProgress: (done: number, total: number) => void): Promise<PgnResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error: string | null, result?: PgnResult) => {
      clearTimeout(timer)
      worker?.terminate()
      worker = null
      if (error || !result) reject(new Error(error || 'Could not load this PGN.'))
      else resolve(result)
    }
    try {
      worker = new Worker('/runtime/pgn-reader.js', { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<PgnWorkerMessage>) => {
        if (data.type === 'progress') onProgress(data.done, data.total)
        else if (data.type === 'done') finish(null, { games: data.games, skipped: data.skipped })
        else finish(data.error)
      }
      worker.onerror = () => finish('Could not open the PGN reader. Try again.')
      timer = setTimeout(() => finish('PGN import took too long. Try a smaller file.'), PGN_TIMEOUT_MS)
      worker.postMessage(source)
    } catch {
      finish('Could not open the PGN reader. Try again.')
    }
  })
}
