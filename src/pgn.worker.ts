import { parseGame, parseGames, split } from '@mliebelt/pgn-parser'
import type { ParseTree } from '@mliebelt/pgn-parser'
import { Chess, DEFAULT_POSITION } from 'chess.js'
import { recordMove } from './game'
import { MAX_PGN_GAMES, type PgnWorkerMessage } from './pgn-protocol'
import { fromFenInput } from './position'
import type { GameRecord } from './types'

const post = (message: PgnWorkerMessage) => self.postMessage(message)

function tag(tags: Record<string, unknown>, name: string): string | undefined {
  const value = tags[name]
  return value === undefined || value === null ? undefined : String(value)
}

function elo(tags: Record<string, unknown>, name: string): number | undefined {
  const value = Number(tag(tags, name))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function ratedGame(tags: Record<string, unknown>): boolean | undefined {
  const rated = tag(tags, 'Rated')?.toLowerCase()
  if (rated === 'true' || rated === 'false') return rated === 'true'
  const mode = tag(tags, 'Mode') ?? ''
  const event = tag(tags, 'Event') ?? ''
  if (/^(casual|unrated)$/i.test(mode) || /\b(casual|unrated)\b/i.test(event)) return false
  if (/^rated$/i.test(mode) || /^rated\b/i.test(event)) return true
  return undefined
}

function playedAt(tags: ParseTree['tags']): string | undefined {
  const date = tags?.UTCDate?.value ?? tags?.Date?.value
  if (!date || !/^\d{4}\.\d{2}\.\d{2}$/.test(date)) return undefined
  const time = tags?.UTCTime?.value ?? '00:00:00'
  const stamp = Date.parse(`${date.replaceAll('.', '-')}T${time}Z`)
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined
}

/** Returns null for games that are empty, not standard chess, or illegal. */
function toGame(tree: ParseTree): GameRecord | null {
  const tags = (tree.tags ?? {}) as Record<string, unknown>
  const variant = tag(tags, 'Variant')
  if (!tree.moves.length || (variant && !/^(standard|chess|normal)$/i.test(variant))) return null
  try {
    const startFen = tag(tags, 'FEN')?.trim().replace(/\s+/g, ' ') || DEFAULT_POSITION
    const { error } = fromFenInput(startFen)
    if (error) throw new Error(error)
    const chess = new Chess(startFen)
    const moves = tree.moves.map(({ notation }) => recordMove(chess, chess.move(notation.notation)))
    const whiteTag = tag(tags, 'White')
    const blackTag = tag(tags, 'Black')
    const white = whiteTag && whiteTag !== '?' ? whiteTag : 'White'
    const black = blackTag && blackTag !== '?' ? blackTag : 'Black'
    return {
      startFen, title: `${white} vs ${black}`, result: tag(tags, 'Result') || '*', moves,
      white, black, whiteElo: elo(tags, 'WhiteElo'), blackElo: elo(tags, 'BlackElo'), site: tag(tags, 'Site'),
      link: tag(tags, 'Link'), rated: ratedGame(tags),
      playedAt: playedAt(tree.tags), timeControl: tree.tags?.TimeControl?.value,
    }
  } catch {
    return null
  }
}

self.onmessage = async ({ data: source }: MessageEvent<string | File>) => {
  try {
    const text = (typeof source === 'string' ? source : await source.text()).trim()
    const games: GameRecord[] = []
    let skipped = 0
    let reported = 0
    let lastPost = 0
    const progress = (done: number, total: number) => {
      const now = performance.now()
      if (done !== total && now - lastPost < 25) return
      lastPost = now
      reported = done
      post({ type: 'progress', done, total })
    }
    const take = (tree: ParseTree) => {
      const game = toGame(tree)
      if (game) games.push(game)
      else skipped++
    }

    // Parse one game at a time so the page can show real progress.
    const chunks = split(text, { startRule: 'games' }).filter(chunk => chunk.all.trim())
    if (chunks.length > MAX_PGN_GAMES) throw new Error('Import up to 1,000 games at a time.')
    if (chunks.length > 1) {
      progress(0, chunks.length)
      for (const [index, chunk] of chunks.entries()) {
        take(parseGame(chunk.all.trim()))
        progress(index + 1, chunks.length)
      }
    } else {
      const parsed = parseGames(text)
      if (parsed.length > MAX_PGN_GAMES) throw new Error('Import up to 1,000 games at a time.')
      progress(0, parsed.length)
      for (const [index, tree] of parsed.entries()) {
        take(tree)
        progress(index + 1, parsed.length)
      }
    }
    if (!games.length) throw new Error('No complete move list for a standard chess game was found.')
    if (!reported) progress(1, 1)
    post({ type: 'done', games, skipped })
  } catch (error) {
    const failure = error as Error
    const message = failure.name === 'SyntaxError' ? 'Check the PGN notation and try again.' : failure.message
    post({ type: 'error', error: message || 'Could not load this PGN.' })
  }
}
