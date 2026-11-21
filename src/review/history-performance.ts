import type { ListedGame } from './import-games'

export const PERFORMANCE_WINDOW = 50
export const MIN_PERFORMANCE_GAMES = 5

type Outcome = 'win' | 'draw' | 'loss'
type RatedResult = { opponent: number; outcome: Outcome; playedAt?: string }
type Platform = 'lichess' | 'chesscom'
type Pool = { key: string; speed: string; platform?: Platform }
type RatingFit = { rating: number | null; low: number | null; high: number | null }

const POINTS: Record<Outcome, number> = { win: 1, draw: 0.5, loss: 0 }
const LOG_ODDS_PER_POINT = Math.LN10 / 400
// Chess.com: Rosenthal et al., HDSR 2025, equation 4.1.
// A smaller default held up across samples from the Lichess Aug–Oct 2026 exports.
const CHESSCOM_WHITE_ADVANTAGE = 18
const DEFAULT_WHITE_ADVANTAGE = 12
const DISPLAY_STEP = 10
const RATING_SEARCH_MARGIN = 3200

function playerSide(game: ListedGame, username: string): 'white' | 'black' | null {
  if (!username) return null
  if (game.white.toLowerCase() === username) return 'white'
  if (game.black.toLowerCase() === username) return 'black'
  return null
}

function outcomeFor(result: string, side: 'white' | 'black'): Outcome | null {
  if (result === '1/2-1/2') return 'draw'
  if (result === '1-0') return side === 'white' ? 'win' : 'loss'
  if (result === '0-1') return side === 'black' ? 'win' : 'loss'
  return null
}

function hasRating(rating: number | undefined): rating is number {
  return rating !== undefined && Number.isFinite(rating) && rating > 0
}

export function userOutcome(game: ListedGame, username: string): Outcome | null {
  const side = playerSide(game, username.trim().toLowerCase())
  return side ? outcomeFor(game.result, side) : null
}

function solveIncreasing(low: number, high: number, atOrAbove: (rating: number) => boolean): number {
  for (let step = 0; step < 32 && high - low > 0.01; step++) {
    const rating = low + (high - low) / 2
    if (atOrAbove(rating)) high = rating
    else low = rating
  }
  return low + (high - low) / 2
}

function softplus(x: number): number {
  return Math.max(0, x) + Math.log1p(Math.exp(-Math.abs(x)))
}

function estimateRating(sample: RatedResult[], points: number): RatingFit | null {
  if (sample.length < MIN_PERFORMANCE_GAMES) return null
  const opponents = sample.map(game => game.opponent)
  const low = Math.min(...opponents) - RATING_SEARCH_MARGIN
  const high = Math.max(...opponents) + RATING_SEARCH_MARGIN
  const allWins = points === sample.length
  const allLosses = points === 0
  const fit = allWins || allLosses ? null : solveIncreasing(low, high, rating =>
    opponents.reduce((sum, opponent) => sum + 1 / (1 + Math.exp((opponent - rating) * LOG_ODDS_PER_POINT)), 0) >= points,
  )
  const logScore = (rating: number) => sample.reduce((sum, game) => {
    const z = (rating - game.opponent) * LOG_ODDS_PER_POINT
    const result = POINTS[game.outcome]
    return sum - result * softplus(-z) - (1 - result) * softplus(z)
  }, 0)

  // Invert Chernoff bounds for independent scores in [0, 1]. The Bernoulli
  // log score bounds the tails even with draws, without assuming a draw rate.
  // Use 2.5% per tail, including at the boundary, for 95% coverage.
  const cutoff = (fit === null ? 0 : logScore(fit)) - Math.log(40)
  const lower = allLosses ? null : solveIncreasing(low, fit ?? high, rating => logScore(rating) >= cutoff)
  const upper = allWins ? null : solveIncreasing(fit ?? low, high, rating => logScore(rating) <= cutoff)
  return {
    rating: fit === null ? null : Math.round(fit / DISPLAY_STEP) * DISPLAY_STEP,
    low: lower === null ? null : Math.floor(lower / DISPLAY_STEP) * DISPLAY_STEP,
    high: upper === null ? null : Math.ceil(upper / DISPLAY_STEP) * DISPLAY_STEP,
  }
}

function platformFromSite(site?: string): Platform | undefined {
  const host = site?.trim().match(/^(?:https?:\/\/)?(?:www\.)?(lichess\.org|chess\.com)(?:\/|$)/i)?.[1].toLowerCase()
  if (host === 'lichess.org') return 'lichess'
  if (host === 'chess.com') return 'chesscom'
  return undefined
}

function speedFromClock(clock: string, platform: Platform): string {
  if (clock === '-' && platform === 'lichess') return 'correspondence'
  if (/^1\/\d+$/.test(clock)) return platform === 'chesscom' ? 'daily' : 'correspondence'
  const parts = clock.match(/^(\d+)(?:\+(\d+))?$/)
  if (!parts) return clock
  const length = Number(parts[1]) + 40 * Number(parts[2] ?? 0)
  if (platform === 'lichess' && length < 30) return 'ultraBullet'
  if (length < 180) return 'bullet'
  if (length < (platform === 'lichess' ? 480 : 600)) return 'blitz'
  return platform === 'lichess' && length >= 1500 ? 'classical' : 'rapid'
}

function poolFor(game: ListedGame): Pool | null {
  const clock = game.timeControl ?? '?'
  if (game.source !== 'pgn') {
    return game.timeControl ? { key: game.source + ':' + clock, speed: clock, platform: game.source } : null
  }
  const platform = platformFromSite(game.site) ?? platformFromSite(game.url)
  const speed = platform ? speedFromClock(clock, platform) : clock
  return { key: (platform ?? 'pgn') + ':' + speed, platform, speed }
}

function gameKey(game: ListedGame): string {
  if (game.source === 'pgn') {
    for (const link of [game.url, game.site]) {
      const lichess = link?.match(/^https?:\/\/(?:www\.)?lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:[/?#]|$)/i)
      if (lichess) return 'lichess:' + lichess[1]
      const chesscom = link?.match(/^https?:\/\/(?:www\.)?chess\.com\/(?:analysis\/)?game\/(live|daily)\/(\d+)(?:[/?#]|$)/i)
      if (chesscom) return 'chesscom:' + chesscom[1].toLowerCase() + ':' + chesscom[2]
    }
  }
  return game.source === 'pgn' ? 'pgn:' + game.id : game.url || game.source + ':' + game.id
}

export function pgnPlayers(games: readonly ListedGame[]): string[] {
  const players = new Map<string, { name: string; count: number }>()
  for (const game of games) {
    if (game.ratedStandard === false || !outcomeFor(game.result, 'white')) continue
    for (const [name, rating] of [[game.white, game.blackElo], [game.black, game.whiteElo]] as const) {
      if (!hasRating(rating)) continue
      const key = name.toLowerCase()
      const player = players.get(key) ?? { name, count: 0 }
      player.count++
      players.set(key, player)
    }
  }
  return Array.from(players.values()).sort((a, b) => b.count - a.count).map(player => player.name)
}

/** Read newest-first and keep an independent sample for each rating pool. */
export function recentPerformance(games: readonly ListedGame[], username: string) {
  const player = username.trim().toLowerCase()
  if (!player) return []
  const groups = new Map<string, { pool: Pool; sample: RatedResult[] }>()
  const seen = new Set<string>()
  for (const game of games) {
    if (game.source === 'pgn' ? game.ratedStandard === false : !game.ratedStandard) continue
    const pool = poolFor(game)
    if (!pool) continue
    const group = groups.get(pool.key) ?? { pool, sample: [] }
    if (group.sample.length >= PERFORMANCE_WINDOW) continue
    const side = playerSide(game, player)
    if (!side) continue
    const opponent = side === 'white' ? game.blackElo : game.whiteElo
    const provisional = side === 'white' ? game.blackProvisional : game.whiteProvisional
    const outcome = outcomeFor(game.result, side)
    if (!outcome || provisional || !hasRating(opponent)) continue
    const id = gameKey(game)
    if (seen.has(id)) continue

    const whiteAdvantage = pool.platform === 'chesscom' ? CHESSCOM_WHITE_ADVANTAGE : DEFAULT_WHITE_ADVANTAGE
    const adjustedOpponent = opponent + (side === 'white' ? -whiteAdvantage : whiteAdvantage)
    seen.add(id)
    group.sample.push({ opponent: adjustedOpponent, outcome, playedAt: game.playedAt })
    groups.set(pool.key, group)
  }

  return Array.from(groups.values(), ({ pool, sample }) => {
    const record = { win: 0, draw: 0, loss: 0 }
    for (const game of sample) record[game.outcome]++
    const count = sample.length
    const points = record.win + record.draw / 2
    return {
      ...pool, record, count, fit: estimateRating(sample, points),
      newest: sample[0].playedAt,
      oldest: sample.at(-1)?.playedAt,
    }
  })
}
