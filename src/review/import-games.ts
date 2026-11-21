import { checkPgnSource, parsePgn } from '../pgn-client'
import type { GameRecord } from '../types'

export type ImportKind = 'pgn' | 'lichess-game' | 'chesscom-game' | 'lichess-user' | 'chesscom-user'
export type GameSpeed = 'all' | 'bullet' | 'blitz' | 'rapid' | 'classical'
export type GameColor = 'either' | 'white' | 'black'

export interface GameFilter {
  speed: GameSpeed
  color: GameColor
}

/** How much history to load at once: a number of recent games, or a window of days. */
export type GameLimit = { by: 'games'; count: number } | { by: 'time'; days: number }
export const DEFAULT_LIMIT: GameLimit = { by: 'games', count: 100 }

export interface ListedGame {
  id: string
  source: 'lichess' | 'chesscom'
  white: string
  black: string
  whiteElo?: number
  blackElo?: number
  result: string
  playedAt?: string
  timeControl?: string
  url: string
  pgn?: string
  /** Half-moves, when already known (pasted PGN). */
  moves?: number
  /** Wall-clock length of the game, first move to last, when the provider reports it. */
  durationMs?: number
}

export interface ImportResult {
  kind: ImportKind
  games?: GameRecord[]
  list?: ListedGame[]
  pager?: GamePager
  error?: string
}

const DAY = 86_400_000

/**
 * Pages through a player's history newest-first without downloading all of it.
 * Chess.com serves whole months, so extra games from a month wait in a buffer for the next page.
 */
export class GamePager {
  readonly username: string
  readonly limit: GameLimit
  #site: 'lichess' | 'chesscom'
  #filter?: GameFilter
  #buffer: ListedGame[] = []
  #archives: string[] | null = null
  #lichessNext: string | null = null
  #exhausted = false
  #cutoff = Date.now()
  #pages = 0

  constructor(site: 'lichess' | 'chesscom', username: string, limit: GameLimit, filter?: GameFilter) {
    this.#site = site
    this.username = username
    this.limit = limit
    this.#filter = filter
  }

  get unlimited(): boolean {
    return !Number.isFinite(this.limit.by === 'games' ? this.limit.count : this.limit.days)
  }

  get hasMore(): boolean {
    return this.#buffer.length > 0 || !this.#exhausted
  }

  /** Next page: `count` games, or the next `days` window. Later windows skip empty stretches. */
  async next(onProgress?: (found: number) => void): Promise<ListedGame[]> {
    this.#pages += 1
    if (this.unlimited) {
      // "All" streams one provider batch at a time so the list can grow while it loads.
      while (!this.#buffer.length && !this.#exhausted) await this.#fetch()
      return this.#buffer.splice(0)
    }
    if (this.limit.by === 'games') {
      while (this.#buffer.length < this.limit.count && !this.#exhausted) {
        await this.#fetch()
        onProgress?.(this.#buffer.length)
      }
      return this.#buffer.splice(0, this.limit.count)
    }
    const first = this.#pages === 1
    let page: ListedGame[] = []
    do {
      this.#cutoff -= this.limit.days * DAY
      while (!this.#exhausted && (!this.#buffer.length || playedAt(this.#buffer.at(-1)!) >= this.#cutoff)) {
        await this.#fetch()
        onProgress?.(this.#buffer.length)
      }
      const split = this.#buffer.findIndex(game => playedAt(game) < this.#cutoff)
      page = this.#buffer.splice(0, split < 0 ? this.#buffer.length : split)
    } while (!first && !page.length && this.hasMore)
    return page
  }

  async #fetch() {
    if (this.#site === 'lichess') {
      const { list, next } = await listLichessGames(this.username, this.#lichessNext, this.#filter)
      this.#buffer.push(...list)
      this.#lichessNext = next
      if (!next) this.#exhausted = true
      return
    }
    this.#archives ??= await listChessComArchives(this.username)
    const archive = this.#archives.shift()
    if (archive) this.#buffer.push(...await listChessComMonth(archive, this.username, this.#filter))
    if (!this.#archives.length) this.#exhausted = true
  }
}

function playedAt(game: ListedGame): number {
  return game.playedAt ? Date.parse(game.playedAt) : 0
}

const LICHESS_GAME = /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/(?:embed\/)?([a-zA-Z0-9]{8,12})(?:[/#?]|$)/i
const CHESSCOM_GAME = /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:game\/|analysis\/game\/)(?:(live|daily)\/)?(\d+)(?:[/#?]|$)/i
const CHESSCOM_USER = /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:member|play|profile)\/([A-Za-z0-9_-]{2,30})\/?(?:[?#].*)?$/i
const USERNAME = /^@?[A-Za-z0-9_-]{2,30}$/

export function detectImport(raw: string): { kind: ImportKind; value: string } | { error: string } {
  const text = raw.trim()
  if (!text) return { error: 'Paste a game URL, username, or PGN.' }

  const lichess = text.match(LICHESS_GAME)
  if (lichess) return { kind: 'lichess-game', value: lichess[1].slice(0, 8) }

  const chesscom = text.match(CHESSCOM_GAME)
  if (chesscom) return { kind: 'chesscom-game', value: `${chesscom[1]?.toLowerCase() || 'live'}/${chesscom[2]}` }

  const chesscomUser = text.match(CHESSCOM_USER)
  if (chesscomUser) return { kind: 'chesscom-user', value: chesscomUser[1] }

  if (/^https?:\/\//i.test(text)) {
    return { error: 'Use a Lichess or Chess.com game URL, a username, or paste PGN.' }
  }

  if (USERNAME.test(text) && !text.includes('[') && !/\d\./.test(text)) {
    return { kind: 'lichess-user', value: text.replace(/^@/, '') }
  }

  return { kind: 'pgn', value: text }
}

async function parsePgnText(text: string, onProgress: (done: number, total: number) => void = () => {}) {
  const problem = checkPgnSource(text)
  if (problem) throw new Error(problem)
  return parsePgn(text, onProgress)
}

async function readError(response: Response, site: string): Promise<never> {
  throw new Error(
    `${site} blocked or failed this request (${response.status}). Paste the PGN instead.`,
  )
}

export async function fetchLichessGame(id: string): Promise<GameRecord> {
  const response = await fetch(`https://lichess.org/game/export/${id}?clocks=false&evals=false`, {
    headers: { Accept: 'application/x-chess-pgn' },
  })
  if (!response.ok) await readError(response, 'Lichess')
  const text = await response.text()
  const { games } = await parsePgnText(text)
  games[0].site = `https://lichess.org/${id}`
  return games[0]
}

export async function fetchChessComGame(path: string): Promise<GameRecord> {
  const [mode, id] = path.split('/')
  if (!/^(live|daily)$/.test(mode) || !/^\d+$/.test(id)) throw new Error('Use a Chess.com game URL.')
  const url = `https://www.chess.com/game/${mode}/${id}`
  const response = await fetch(`https://www.chess.com/callback/${mode}/game/${id}`)
  if (!response.ok) await readError(response, 'Chess.com')
  const { game } = await response.json() as {
    game?: { pgn?: string; pgnUrl?: string; pgnHeaders?: { White?: string; EndDate?: string; Date?: string } }
  }
  if (game?.pgn) return (await parsePgnText(game.pgn)).games[0]
  if (game?.pgnUrl) {
    const download = new URL(game.pgnUrl, url)
    if (download.protocol === 'https:' && /^(?:www\.|api\.)?chess\.com$/.test(download.hostname)) {
      const pgnResponse = await fetch(download)
      if (pgnResponse.ok) return (await parsePgnText(await pgnResponse.text())).games[0]
    }
  }
  const player = game?.pgnHeaders?.White
  const month = (game?.pgnHeaders?.EndDate ?? game?.pgnHeaders?.Date)?.match(/^(\d{4})[.-](\d{2})/)
  if (player && month) {
    const archive = await listChessComMonth(`https://api.chess.com/pub/player/${encodeURIComponent(player)}/games/${month[1]}/${month[2]}`)
    const item = archive.find(entry => entry.id === id && new URL(entry.url).pathname.includes(`/${mode}/`))
    if (item) return listedToRecord(item)
  }
  throw new Error('Chess.com returned no PGN. Paste the PGN from the game share menu instead.')
}

function matchesFilter(game: ListedGame, username: string, site: 'lichess' | 'chesscom', filter?: GameFilter): boolean {
  if (!filter || filter.speed === 'all' && filter.color === 'either') return true
  const pace = (game.timeControl || '').toLowerCase()
  if (filter.speed !== 'all') {
    const expected = filter.speed === 'classical' && site === 'chesscom' ? ['daily', 'classical'] : [filter.speed]
    if (!expected.includes(pace)) return false
  }
  if (filter.color === 'either') return true
  const played = filter.color === 'white' ? game.white : game.black
  return played.toLowerCase() === username.toLowerCase()
}

const LICHESS_PAGE = 50

export async function listLichessGames(username: string, until?: string | null, filter?: GameFilter): Promise<{
  list: ListedGame[]
  next: string | null
}> {
  const params = new URLSearchParams({
    max: String(LICHESS_PAGE),
    pgnInJson: 'true',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
  })
  if (until) params.set('until', until)
  if (filter?.speed && filter.speed !== 'all') params.set('perfType', filter.speed)
  if (filter?.color === 'white' || filter?.color === 'black') params.set('color', filter.color)
  const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
  })
  if (!response.ok) await readError(response, 'Lichess')
  const text = await response.text()
  const list: ListedGame[] = []
  let oldest: number | null = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const game = JSON.parse(line) as {
      id: string
      createdAt: number
      lastMoveAt?: number
      status: string
      winner?: string
      players: { white: { user?: { name: string }; rating?: number }; black: { user?: { name: string }; rating?: number } }
      speed?: string
      pgn?: string
    }
    const result = game.winner === 'white' ? '1-0' : game.winner === 'black' ? '0-1' :
      game.status === 'draw' || game.status === 'stalemate' ? '1/2-1/2' : '*'
    list.push({
      id: game.id,
      source: 'lichess',
      white: game.players.white.user?.name || 'White',
      black: game.players.black.user?.name || 'Black',
      whiteElo: game.players.white.rating,
      blackElo: game.players.black.rating,
      result,
      playedAt: new Date(game.createdAt).toISOString(),
      timeControl: game.speed,
      url: `https://lichess.org/${game.id}`,
      pgn: game.pgn,
      durationMs: game.lastMoveAt && game.lastMoveAt > game.createdAt ? game.lastMoveAt - game.createdAt : undefined,
    })
    oldest = oldest === null ? game.createdAt : Math.min(oldest, game.createdAt)
  }
  return { list, next: list.length >= LICHESS_PAGE && oldest ? String(oldest - 1) : null }
}

export async function listChessComArchives(username: string): Promise<string[]> {
  const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`)
  if (!response.ok) await readError(response, 'Chess.com')
  const data = await response.json() as { archives: string[] }
  return [...(data.archives || [])].reverse()
}

export async function listChessComMonth(archiveUrl: string, username = '', filter?: GameFilter): Promise<ListedGame[]> {
  const archive = new URL(archiveUrl)
  if (archive.origin !== 'https://api.chess.com' || !/^\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(archive.pathname)) {
    throw new Error('Chess.com returned an invalid archive address.')
  }
  const response = await fetch(archive)
  if (!response.ok) await readError(response, 'Chess.com')
  const data = await response.json() as {
    games: {
      url: string
      pgn?: string
      end_time: number
      time_class?: string
      rules?: string
      white: { username: string; rating?: number; result: string }
      black: { username: string; rating?: number; result: string }
    }[]
  }
  return (data.games || []).filter(game => !game.rules || game.rules === 'chess').reverse().map(game => {
    const id = game.url.match(/\/(\d+)$/)?.[1] || game.url
    const result = chessComResult(game.white.result, game.black.result)
    return {
      id,
      source: 'chesscom' as const,
      white: game.white.username,
      black: game.black.username,
      whiteElo: game.white.rating,
      blackElo: game.black.rating,
      result,
      playedAt: new Date(game.end_time * 1000).toISOString(),
      timeControl: game.time_class,
      url: game.url,
      pgn: game.pgn,
      durationMs: pgnDuration(game.pgn),
    }
  }).filter(game => matchesFilter(game, username, 'chesscom', filter))
}

/** Chess.com PGNs carry start and end stamps: [Date]/[StartTime] and [EndDate]/[EndTime]. */
function pgnDuration(pgn?: string): number | undefined {
  if (!pgn) return undefined
  const tag = (name: string) => pgn.match(new RegExp(`\\[${name} "([^"]+)"\\]`))?.[1]
  const stamp = (date?: string, time?: string) =>
    date && time && /^\d{4}\.\d{2}\.\d{2}$/.test(date) && /^\d{2}:\d{2}:\d{2}$/.test(time)
      ? Date.parse(`${date.replaceAll('.', '-')}T${time}Z`) : NaN
  const start = stamp(tag('UTCDate') ?? tag('Date'), tag('UTCTime') ?? tag('StartTime'))
  const end = stamp(tag('EndDate'), tag('EndTime'))
  const length = end - start
  return Number.isFinite(length) && length >= 0 ? length : undefined
}

function chessComResult(white: string, black: string): string {
  if (white === 'win') return '1-0'
  if (black === 'win') return '0-1'
  if (['agreed', 'stalemate', 'repetition', 'insufficient', '50move', 'timevsinsufficient'].includes(white)) {
    return '1/2-1/2'
  }
  return '*'
}

export async function resolveImport(
  raw: string,
  options: {
    site?: 'lichess' | 'chesscom'
    filter?: GameFilter
    forcePgn?: boolean
    limit?: GameLimit
    onProgress?: (done: number, total: number) => void
    onListProgress?: (found: number) => void
  } = {},
): Promise<ImportResult> {
  if (options.forcePgn) {
    const text = raw.trim()
    if (!text) return { kind: 'pgn', error: 'Paste a PGN.' }
    try {
      const { games } = await parsePgnText(text, options.onProgress)
      return { kind: 'pgn', games }
    } catch (error) {
      return { kind: 'pgn', error: error instanceof Error ? error.message : 'Could not read the PGN.' }
    }
  }

  const detected = detectImport(raw)
  if ('error' in detected) return { kind: 'pgn', error: detected.error }

  try {
    if (detected.kind === 'pgn') {
      const { games } = await parsePgnText(detected.value, options.onProgress)
      return { kind: 'pgn', games }
    }
    if (detected.kind === 'lichess-game') {
      return { kind: 'lichess-game', games: [await fetchLichessGame(detected.value)] }
    }
    if (detected.kind === 'chesscom-game') {
      return { kind: 'chesscom-game', games: [await fetchChessComGame(detected.value)] }
    }
    if (detected.kind === 'lichess-user' || detected.kind === 'chesscom-user') {
      const site = detected.kind === 'chesscom-user' ? 'chesscom' : options.site || 'lichess'
      const pager = new GamePager(site, detected.value, options.limit ?? DEFAULT_LIMIT, options.filter)
      const list = await pager.next(options.onListProgress)
      return { kind: site === 'chesscom' ? 'chesscom-user' : 'lichess-user', list, pager }
    }
  } catch (error) {
    return {
      kind: detected.kind,
      error: error instanceof Error && error.message !== 'Failed to fetch'
        ? error.message
        : detected.kind === 'pgn' ? 'Could not read the PGN.'
        : 'Could not reach the game provider. Check your connection or paste the PGN instead.',
    }
  }
  return { kind: detected.kind, error: 'Could not import that game.' }
}

export async function listedToRecord(game: ListedGame): Promise<GameRecord> {
  if (!game.pgn && game.source === 'lichess') return fetchLichessGame(game.id)
  if (!game.pgn) throw new Error('This listing has no PGN. Open the game URL and paste PGN instead.')
  const { games } = await parsePgnText(game.pgn)
  const record = games[0]
  record.white = game.white
  record.black = game.black
  record.whiteElo = game.whiteElo
  record.blackElo = game.blackElo
  record.site = game.url
  record.result = game.result
  record.title = `${game.white} vs ${game.black}`
  return record
}
