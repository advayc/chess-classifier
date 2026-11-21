import { useMemo } from 'react'
import { MIN_PERFORMANCE_GAMES, PERFORMANCE_WINDOW, pgnPlayers, recentPerformance } from '../review/history-performance'
import { listedClockLabel, type ListedGame } from '../review/import-games'

export type PerformanceSelection = { player: string; pool: string }

const dates = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function HistoryPerformance({ games, username, selection, onSelect }: {
  games: ListedGame[]
  username: string
  selection: PerformanceSelection | null
  onSelect: (selection: PerformanceSelection) => void
}) {
  const pgn = games[0]?.source === 'pgn'
  const players = useMemo(() => pgn ? pgnPlayers(games) : [], [games, pgn])
  const player = username || selection?.player || players[0] || ''
  const samples = useMemo(() => recentPerformance(games, player), [games, player])
  const sample = samples.find(entry => entry.key === selection?.pool)
    ?? samples.reduce((best, entry) => entry.count > best.count ? entry : best, samples[0])
  const fit = sample?.fit
  const estimate = fit && (fit.rating ?? (fit.low !== null ? `≥ ${fit.low}` : `≤ ${fit.high}`))
  const period = sample?.oldest && sample.newest
    ? dates.formatRange(new Date(sample.oldest), new Date(sample.newest))
    : null

  function poolLabel({ speed, platform }: (typeof samples)[number]) {
    const clock = speed === '?' ? 'Unknown clock' : speed === '-' ? 'Untimed' : listedClockLabel(speed, speed)
    if (pgn && platform) return `${platform === 'chesscom' ? 'Chess.com' : 'Lichess'} · ${clock}`
    return clock
  }

  return (
    <div className="history-performance">
      <div className="history-performance-heading">
        <h3>Estimated Elo</h3>
        {players.length ? (
          <label className="history-sort">
            <span className="visually-hidden">Player for Elo estimate</span>
            <select value={player} onChange={event => onSelect({ player: event.target.value, pool: '' })}>
              {players.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        ) : null}
        {sample && samples.length > 1 ? (
          <label className="history-sort">
            <span className="visually-hidden">Rating pool for Elo estimate</span>
            <select value={sample.key} onChange={event => onSelect({ player, pool: event.target.value })}>
              {samples.map(entry => <option key={entry.key} value={entry.key}>{poolLabel(entry)}</option>)}
            </select>
          </label>
        ) : sample ? <span>{poolLabel(sample)}</span> : null}
      </div>
      <div aria-live="polite">
        {sample ? (
          <>
            <div className="history-performance-score">
              {estimate !== null && estimate !== undefined ? <strong>{estimate}</strong> : null}
              {fit ? (
                <span>{fit.rating === null ? '95% model bound' : `95% model range ${fit.low}–${fit.high}`}</span>
              ) : null}
            </div>
            <div className="history-performance-sample">
              {sample.count} {pgn ? 'PGN' : 'rated'} {sample.count === 1 ? 'game' : 'games'}{sample.count < PERFORMANCE_WINDOW ? ` of ${PERFORMANCE_WINDOW}` : ''}{period ? ` · ${period}` : ''}
            </div>
            <div className="history-performance-bar" aria-hidden="true">
              {Object.entries(sample.record).map(([outcome, count]) => (
                count > 0 ? <span key={outcome} className={outcome} style={{ flexGrow: count }} /> : null
              ))}
            </div>
            <div className="history-performance-record">
              <span>{sample.record.win} {sample.record.win === 1 ? 'win' : 'wins'}</span>
              <span>{sample.record.draw} {sample.record.draw === 1 ? 'draw' : 'draws'}</span>
              <span>{sample.record.loss} {sample.record.loss === 1 ? 'loss' : 'losses'}</span>
            </div>
            <p>
              {!fit
                ? `At least ${MIN_PERFORMANCE_GAMES} games with opponent ratings are needed.`
                : 'Results are adjusted for color. The model assumes stable strength and independent games.'}
            </p>
          </>
        ) : <p>{pgn ? 'The PGN needs finished games with opponent ratings.' : 'No finished rated games with established opponent ratings in this history.'}</p>}
      </div>
    </div>
  )
}
