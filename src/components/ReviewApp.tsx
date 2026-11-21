'use client'

import { Chess, DEFAULT_POSITION, type Move } from 'chess.js'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from '../engine'
import { uciMove } from '../game'
import { icon } from '../icons'
import openingSample from '../opening-sample.json'
import type { EngineInfo, GameRecord, OpeningSample } from '../types'
import { analyzeGame, coachLine, makeReview, type GameReview } from '../review/analyze-game'
import { CLASS_LABEL, CLASS_ORDER, classifyMove } from '../review/classify'
import { sideWinChance } from '../review/win-prob'
import { ClassIcon } from '../review/class-icons'
import {
  listedToRecord,
  listChessComMonth,
  listLichessGames,
  resolveImport,
  type GameColor,
  type GameFilter,
  type GameSpeed,
  type ListedGame,
} from '../review/import-games'
import { ChessBoard, fenAtPly } from './ChessBoard'
import { lineNotation, replayLine } from '../position'
import { EvalGraph } from './EvalGraph'

type VariationMove = { from: string; to: string; uci: string; san: string; lines: EngineInfo[] }
type ImportSource = 'lichess' | 'chesscom' | 'pgn' | 'file'

function ChoiceRow<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string; icon?: string; brand?: string }[]
  onChange: (value: T) => void
}) {
  const groupId = `import-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="choice-setup">
      <span className="choice-label" id={groupId}>{label}</span>
      <div className="choice-row" role="group" aria-labelledby={groupId}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            className="choice-button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? (
              <span className={option.brand ? `brand-mark ${option.brand}` : 'brand-mark'} dangerouslySetInnerHTML={{ __html: icon(option.icon, 16) }} />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function clockLabel(pgn: string | undefined, fallback?: string): string {
  const header = pgn?.match(/\[TimeControl "([^"]+)"\]/)?.[1]
  if (header && header !== '-' && header !== '?') {
    if (header.startsWith('1/')) return 'Daily'
    const [baseRaw, incRaw] = header.split('+')
    const base = Number(baseRaw)
    const inc = incRaw ? Number(incRaw) : 0
    if (Number.isFinite(base) && base > 0) {
      if (base >= 60 && base % 60 === 0) return inc ? `${base / 60}+${inc}` : `${base / 60} min`
      return inc ? `${base}s+${inc}` : `${base}s`
    }
  }
  if (!fallback) return '—'
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

function plyCount(pgn?: string): number | null {
  if (!pgn) return null
  const body = pgn.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  const tokens = body.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/)
  let count = 0
  for (const token of tokens) {
    if (/^(?:O-O-O|O-O|0-0-0|0-0)[+#]?$/.test(token)) count++
    else if (/^[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?[+#]?$/.test(token)) count++
  }
  return count || null
}

function formatPlayedAt(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function scorePair(result: string): [string, string] {
  if (result === '1-0') return ['1', '0']
  if (result === '0-1') return ['0', '1']
  if (result === '1/2-1/2') return ['½', '½']
  return ['–', '–']
}

function userOutcome(item: ListedGame, username: string): 'win' | 'loss' | 'draw' | null {
  const me = username.trim().toLowerCase()
  if (!me) return null
  const asWhite = item.white.toLowerCase() === me
  const asBlack = item.black.toLowerCase() === me
  if (!asWhite && !asBlack) return null
  if (item.result === '1/2-1/2') return 'draw'
  if (item.result === '1-0') return asWhite ? 'win' : 'loss'
  if (item.result === '0-1') return asBlack ? 'win' : 'loss'
  return null
}

function scoreTone(result: string, side: 'white' | 'black'): string {
  if (result === '1/2-1/2') return 'score-draw'
  if (result === '1-0') return side === 'white' ? 'score-win' : 'score-loss'
  if (result === '0-1') return side === 'black' ? 'score-win' : 'score-loss'
  return 'score-unknown'
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 2" strokeLinecap="round" />
    </svg>
  )
}

export function ReviewApp() {
  const engineRef = useRef<Engine | null>(null)
  const liveEngineRef = useRef<Engine | null>(null)
  const importedGames = useRef<GameRecord[]>([])
  const loadMoreButton = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cancelRef = useRef({ cancelled: false })

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ImportSource>('lichess')
  const [speed, setSpeed] = useState<GameSpeed>('all')
  const [color, setColor] = useState<GameColor>('either')
  const [appliedFilter, setAppliedFilter] = useState<GameFilter>({ speed: 'all', color: 'either' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [list, setList] = useState<ListedGame[]>([])
  const [listNext, setListNext] = useState<string | null>(null)
  const [listUser, setListUser] = useState('')
  const [listSource, setListSource] = useState<'pgn' | 'lichess' | 'chesscom'>('pgn')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [archives, setArchives] = useState<string[]>([])
  const [parseProgress, setParseProgress] = useState('')
  const [review, setReview] = useState<GameReview | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [ply, setPly] = useState(0)
  const [showArrow, setShowArrow] = useState(true)
  const [exploring, setExploring] = useState(false)
  const [variation, setVariation] = useState<{ from: number; moves: VariationMove[] } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<string[]>([])
  const [promotion, setPromotion] = useState<Move[]>([])
  const [liveLines, setLiveLines] = useState<{ fen: string; lines: EngineInfo[] } | null>(null)
  const [searchError, setSearchError] = useState<{ fen: string; message: string } | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  useEffect(() => {
    const runtime = `${window.location.origin}/runtime/`
    engineRef.current = new Engine(runtime)
    liveEngineRef.current = new Engine(runtime)
    return () => {
      cancelRef.current.cancelled = true
      engineRef.current?.stop()
      engineRef.current?.dispose()
      liveEngineRef.current?.dispose()
    }
  }, [])

  const game = review?.game
  const maxPly = variation ? variation.from + variation.moves.length : review?.plies.length ?? 0
  const playedMoves = useMemo(() => {
    if (!game) return []
    if (!variation || ply <= variation.from) return game.moves.slice(0, ply)
    return [...game.moves.slice(0, variation.from), ...variation.moves.slice(0, ply - variation.from)]
  }, [game, ply, variation])
  const currentFen = useMemo(() => game ? fenAtPly(game.startFen, playedMoves, playedMoves.length) : DEFAULT_POSITION, [game, playedMoves])
  const chess = useMemo(() => new Chess(currentFen), [currentFen])
  const currentPlyReview = exploring ? undefined : review?.plies[ply - 1]
  const lastMove = playedMoves.at(-1)
  const cachedLines = exploring ? undefined : review?.plies[ply]?.lines
  const needsSearch = Boolean(game && !busy && !cachedLines)
  const legalMoves = useMemo(() => chess.moves({ verbose: true }), [chess])
  const candidates = cachedLines ?? (liveLines?.fen === currentFen ? liveLines.lines : [])
  const bestUci = candidates[0]?.pv[0]
  const variationMove = variation && ply > variation.from ? variation.moves[ply - variation.from - 1] : undefined
  const variationBest = variationMove?.lines[0]
  const variationPlayed = variationMove?.lines.find(line => line.pv[0] === variationMove.uci)
  const variationBestWin = variationBest ? sideWinChance(variationBest.type, variationBest.score) : null
  const variationPlayedWin = variationPlayed ? sideWinChance(variationPlayed.type, variationPlayed.score)
    : chess.isCheckmate() ? 1
      : chess.isStalemate() || chess.isInsufficientMaterial() ? 0.5
        : candidates[0] ? 1 - sideWinChance(candidates[0].type, candidates[0].score) : null
  const variationLabel = variationMove && variationBest && variationBestWin !== null && variationPlayedWin !== null
    ? classifyMove({
      playedUci: variationMove.uci,
      bestUci: variationBest.pv[0],
      bestWin: variationBestWin,
      playedWin: variationPlayedWin,
      color: chess.turn() === 'w' ? 'b' : 'w',
    }) : null
  const bestArrow = showArrow && bestUci ? { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) } : null

  useEffect(() => {
    if (!needsSearch || !legalMoves.length || !game) return
    const engine = liveEngineRef.current
    if (!engine) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLiveLines(null)
      setSearchError(null)
      engine.start({
        fen: currentFen,
        history: { startFen: game.startFen, moves: playedMoves.map(move => move.uci) },
        legalMoves: legalMoves.map(uciMove),
        update: ({ stage, best, alternatives }) => {
          if (!cancelled && stage === 'alternatives' && best) {
            setLiveLines({ fen: currentFen, lines: [best, ...(alternatives ?? [])] })
          }
        },
        complete: ({ best, alternatives }) => {
          if (cancelled) return
          if (best) setLiveLines({ fen: currentFen, lines: [best, ...alternatives] })
          else setSearchError({ fen: currentFen, message: 'Stockfish returned no scored move.' })
        },
        fail: message => { if (!cancelled) setSearchError({ fen: currentFen, message }) },
      })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      engine.cancel()
    }
  }, [currentFen, game, legalMoves, needsSearch, playedMoves])

  const runReview = useCallback(async (record: GameRecord) => {
    const engine = engineRef.current
    if (!engine) return
    const signal = { cancelled: false }
    cancelRef.current = signal
    engine.cancel()
    setBusy(true)
    setError('')
    setReview(makeReview(record, [], [0.5]))
    setShowSummary(false)
    setPromotion([])
    setProgress({ done: 0, total: record.moves.length })
    setPly(0)
    setExploring(false)
    setVariation(null)
    setSelected(null)
    setTargets([])
    const plies: GameReview['plies'] = []
    const graph = [0.5]
    try {
      const result = await analyzeGame(
        engine,
        record,
        openingSample as unknown as OpeningSample,
        ({ done, total, ply: entry, initialWin }) => {
          setProgress({ done, total })
          if (entry) {
            plies.push(entry)
            graph[0] = initialWin ?? 0.5
            graph.push(entry.whiteWinAfter)
            setReview(makeReview(record, [...plies], [...graph]))
          }
        },
        signal,
      )
      setReview(result)
      setPly(result.plies.length)
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') setError('Review cancelled.')
      else setError(err instanceof Error ? err.message : 'Review failed.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [])

  async function runImport(text: string, forcePgn = false) {
    const filter = { speed, color }
    setBusy(true)
    setError('')
    setParseProgress('')
    setList([])
    setListNext(null)
    setArchives([])
    setOpenKey(null)
    setAppliedFilter(filter)
    try {
      const result = await resolveImport(text, {
        site: source === 'chesscom' ? 'chesscom' : 'lichess',
        filter,
        forcePgn: forcePgn || source === 'pgn',
        onProgress: (done, total) => setParseProgress(`Reading game ${done} / ${total}`),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.games?.length === 1) {
        await runReview(result.games[0])
        return
      }
      if (result.games && result.games.length > 1) {
        setList(result.games.map((gameRecord, index) => ({
          id: String(index),
          source: 'lichess' as const,
          white: gameRecord.white || 'White',
          black: gameRecord.black || 'Black',
          whiteElo: gameRecord.whiteElo,
          blackElo: gameRecord.blackElo,
          result: gameRecord.result || '*',
          url: '',
          pgn: undefined,
          moves: gameRecord.moves.length,
        })))
        importedGames.current = result.games
        setListSource('pgn')
        return
      }
      if (result.list) {
        if (!result.list.length && !result.archives?.length && !result.next) {
          setError('No games matched that username and setup.')
        }
        setList(result.list)
        setListSource(result.kind === 'chesscom-user' ? 'chesscom' : 'lichess')
        setArchives(result.archives ?? [])
        setListNext(result.next ?? null)
        setListUser(text.trim())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  function onImport(event: React.FormEvent) {
    event.preventDefault()
    if (source === 'file') {
      fileInput.current?.click()
      return
    }
    void runImport(query)
  }

  const loadMore = useCallback(async () => {
    if (busy || (!listNext && !archives.length)) return
    setBusy(true)
    try {
      if (listSource === 'lichess') {
        const { list: more, next } = await listLichessGames(listUser, listNext, appliedFilter)
        setList(current => [...current, ...more])
        setListNext(next)
      } else {
        const remaining = [...archives]
        let more: ListedGame[] = []
        while (!more.length && remaining.length) more = await listChessComMonth(remaining.shift()!, listUser, appliedFilter)
        setList(current => [...current, ...more])
        setArchives(remaining)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more games.')
    } finally {
      setBusy(false)
    }
  }, [appliedFilter, archives, busy, listNext, listSource, listUser])

  useEffect(() => {
    const button = loadMoreButton.current
    if (!button || busy || error) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        void loadMore()
      }
    }, { root: button.closest('.game-browser') })
    observer.observe(button)
    return () => observer.disconnect()
  }, [busy, error, loadMore])

  async function openListed(item: ListedGame) {
    if (busy) return
    setOpenKey(`${item.source}-${item.id}`)
    try {
      if (listSource === 'pgn') {
        const record = importedGames.current[Number(item.id)]
        if (record) await runReview(record)
        return
      }
      setBusy(true)
      const record = await listedToRecord(item)
      await runReview(record)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that game.')
      setBusy(false)
    }
  }

  function cancelReview() {
    cancelRef.current.cancelled = true
    engineRef.current?.stop()
  }

  function goPly(next: number) {
    if (!review) return
    const max = exploring && variation
      ? variation.from + variation.moves.length
      : review.plies.length
    setPly(Math.max(variation?.from ?? 0, Math.min(max, next)))
    setPromotion([])
    setSelected(null)
    setTargets([])
  }

  function jumpKeyMoment(direction: 1 | -1) {
    if (!review) return
    const moments = review.summary.keyMoments
    if (direction > 0) {
      const next = moments.find(moment => moment > ply)
      if (next !== undefined) goPly(next)
    } else {
      const prev = [...moments].reverse().find(moment => moment < ply)
      if (prev !== undefined) goPly(prev)
    }
  }

  function startExplore(from = ply) {
    if (!review || busy) return
    setPly(from)
    setExploring(true)
    setVariation({ from, moves: [] })
    setSelected(null)
    setTargets([])
    setPromotion([])
  }

  function leaveExplore() {
    if (variation) setPly(variation.from)
    setExploring(false)
    setVariation(null)
    setSelected(null)
    setTargets([])
    setPromotion([])
  }

  function playVariation(move: Move) {
    const from = variation?.from ?? ply
    const moves = variation?.moves.slice(0, ply - from) ?? []
    setExploring(true)
    setVariation({ from, moves: [...moves, { from: move.from, to: move.to, uci: uciMove(move), san: move.san, lines: candidates }] })
    setPly(ply + 1)
    setSelected(null)
    setTargets([])
    setPromotion([])
  }

  function onBoardMove(from: string, to: string) {
    if (!review || busy) return
    const moves = legalMoves.filter(move => move.from === from && move.to === to)
    if (moves.length > 1) setPromotion(moves)
    else if (moves[0]) playVariation(moves[0])
  }

  function onSquareClick(square: string) {
    if (!review || busy) return
    if (selected && legalMoves.some(move => move.from === selected && move.to === square)) {
      onBoardMove(selected, square)
      return
    }
    const next = legalMoves.filter(move => move.from === square && square !== selected)
    setSelected(next.length ? square : null)
    setTargets(next.map(move => move.to))
  }

  const summary = review?.summary
  const boardEnabled = Boolean(review && !busy)
  const originPly = variation?.from ?? 0

  return (
    <div className="review-page">
      <div className="workspace review-workspace">
        <section className="board-panel" aria-labelledby="board-heading" onKeyDown={event => {
          const keys: Record<string, number> = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: originPly, End: maxPly }
          if (!(event.key in keys)) return
          event.preventDefault()
          goPly(keys[event.key])
        }}>
          <div className="board-heading-row">
            <div>
              <h2 id="board-heading">
                {game ? `${game.white || 'White'} vs ${game.black || 'Black'}` : 'Game review'}
              </h2>
              {game ? (
                <p className="board-subtitle">
                  {[game.whiteElo && game.blackElo && `${game.whiteElo} · ${game.blackElo}`]
                    .filter(Boolean).join(' · ')}
                  {exploring ? ' · exploring variation' : ''}
                </p>
              ) : (
                <p className="board-subtitle">Load a game to analyze every move with Stockfish.</p>
              )}
            </div>
            <div className="board-actions">
              <button
                type="button"
                className="icon-button"
                title="Toggle best-move arrow"
                aria-pressed={showArrow}
                onClick={() => setShowArrow(value => !value)}
              >
                →
              </button>
            </div>
          </div>

          <ChessBoard
            fen={currentFen}
            lastMove={lastMove}
            bestArrow={bestArrow}
            onSquareClick={boardEnabled ? onSquareClick : undefined}
            onMove={boardEnabled ? onBoardMove : undefined}
            canDrag={square => legalMoves.some(move => move.from === square)}
            selected={selected}
            targets={targets}
          />

          {promotion.length ? (
            <div className="source-actions" role="group" aria-label="Promote pawn">
              {promotion.map(move => (
                <button key={move.promotion} className="text-button" type="button" onClick={() => playVariation(move)}>{move.san}</button>
              ))}
              <button className="text-button" type="button" onClick={() => setPromotion([])}>Cancel</button>
            </div>
          ) : null}
          <div className="board-footer review-footer">
            <div className="line-controls">
              <button type="button" className="icon-button" aria-label="First move" disabled={!review || ply <= originPly} onClick={() => goPly(originPly)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-left') }} />
              <button type="button" className="icon-button" aria-label="Previous move" disabled={!review || ply <= originPly} onClick={() => goPly(ply - 1)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-left') }} />
              <span>{review ? `${ply} / ${exploring ? maxPly : review.game.moves.length}` : '—'}</span>
              <button type="button" className="icon-button" aria-label="Next move" disabled={!review || ply >= maxPly} onClick={() => goPly(ply + 1)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-right') }} />
              <button type="button" className="icon-button" aria-label="Last move" disabled={!review} onClick={() => goPly(maxPly)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-right') }} />
            </div>
            <div className="line-controls">
              <button type="button" className="text-button" disabled={exploring || !summary?.keyMoments.some(moment => moment < ply)} onClick={() => jumpKeyMoment(-1)}>Prev key</button>
              <button type="button" className="text-button" disabled={exploring || !summary?.keyMoments.some(moment => moment > ply)} onClick={() => jumpKeyMoment(1)}>Next key</button>
              {!exploring ? (
                <button type="button" className="text-button" disabled={!boardEnabled} onClick={() => startExplore()}>Explore</button>
              ) : (
                <button type="button" className="text-button" onClick={leaveExplore}>Back to game</button>
              )}
            </div>
          </div>
        </section>

        <div className="analysis-rail">
          <section className="panel">
            <h2>Load a game</h2>
            <form className="source-form" onSubmit={onImport}>
              <ChoiceRow
                label="Import from"
                value={source}
                onChange={setSource}
                options={[
                  { value: 'lichess', label: 'Lichess', icon: 'lichess' },
                  { value: 'chesscom', label: 'Chess.com', icon: 'chesscom', brand: 'chesscom' },
                  { value: 'pgn', label: 'PGN' },
                  { value: 'file', label: 'File' },
                ]}
              />
              {source === 'file' ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}>
                  {busy ? parseProgress || 'Loading…' : 'Choose PGN file'}
                </button>
              ) : (
                <>
                  <label htmlFor="review-import">
                    {source === 'pgn' ? 'PGN' : source === 'lichess' ? 'Lichess username or game URL' : 'Chess.com username or game URL'}
                  </label>
                  {source === 'pgn' ? (
                    <textarea
                      id="review-import"
                      rows={4}
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="Paste one or more games"
                      spellCheck={false}
                    />
                  ) : (
                    <input
                      id="review-import"
                      type="text"
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder={source === 'lichess' ? 'username or https://lichess.org/…' : 'username or https://www.chess.com/game/…'}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  )}
                  {source === 'pgn' ? null : (
                    <>
                      <ChoiceRow
                        label="Speed"
                        value={speed}
                        onChange={setSpeed}
                        options={[
                          { value: 'all', label: 'All' },
                          { value: 'bullet', label: 'Bullet' },
                          { value: 'blitz', label: 'Blitz' },
                          { value: 'rapid', label: 'Rapid' },
                          { value: 'classical', label: 'Classical' },
                        ]}
                      />
                      <ChoiceRow
                        label="Played as"
                        value={color}
                        onChange={setColor}
                        options={[
                          { value: 'either', label: 'Either' },
                          { value: 'white', label: 'White' },
                          { value: 'black', label: 'Black' },
                        ]}
                      />
                    </>
                  )}
                  <div className="source-actions">
                    <button type="submit" className="primary-button" disabled={busy || !query.trim()}>
                      {busy && progress ? `Analyzed ${progress.done} / ${progress.total}` : busy ? parseProgress || 'Loading…' : source === 'pgn' ? 'Review PGN' : 'Load games'}
                    </button>
                    {busy && progress ? (
                      <button type="button" className="text-button" onClick={cancelReview}>Cancel</button>
                    ) : null}
                  </div>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".pgn,.txt,application/x-chess-pgn,text/plain"
                hidden
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void file.text().then(text => {
                    setQuery(text)
                    return runImport(text, true)
                  })
                }}
              />
              {error ? <p className="inline-message error" role="alert">{error}</p> : null}
            </form>
          </section>

          {review ? (
            <section className="panel">
              <h2>Engine lines</h2>
              {candidates.length ? (
                <ol className="review-lines">
                  {candidates.map((candidate, index) => {
                    const line = replayLine(currentFen, candidate.pv)
                    const score = chess.turn() === 'w' ? candidate.score : -candidate.score
                    return (
                      <li key={candidate.pv[0]} className="move-row">
                        <div className="move-heading">
                          <span className="move-rank">{index === 0 ? 'Best move' : `Alternative ${index}`}</span>
                          <strong>{line[0]?.san ?? candidate.pv[0]}</strong>
                          <span className="move-score" title={`White evaluation at depth ${candidate.depth}`}>
                            {candidate.type === 'mate' ? `${score < 0 ? '−' : '+'}M${Math.abs(score)}` : (score / 100).toFixed(2)}
                          </span>
                        </div>
                        <span className="move-sequence" title={lineNotation(line)}>{lineNotation(line.slice(0, 8))}</span>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="outcome-caption" role="status">
                  {chess.isCheckmate() ? 'Checkmate' : !legalMoves.length ? 'Stalemate' : (searchError?.fen === currentFen ? searchError.message : 'Analyzing this position…')}
                </p>
              )}
            </section>
          ) : null}

          {variationMove && variationLabel && variationBestWin !== null && variationPlayedWin !== null ? (
            <section className="panel">
              <h2 className="coach-heading">
                <ClassIcon label={variationLabel} /> {variationMove.san} · {CLASS_LABEL[variationLabel]}
              </h2>
              <p className="coach-line">
                Estimated win chance {(variationPlayedWin * 100).toFixed(0)}% for the mover.
                {' '}The engine's top move was {(variationBestWin * 100).toFixed(0)}%.
              </p>
            </section>
          ) : null}

          {currentPlyReview ? (
            <section className="panel">
              <h2 className="coach-heading">
                <ClassIcon label={currentPlyReview.label} />
                {CLASS_LABEL[currentPlyReview.label]}
              </h2>
              <p className="coach-line">{coachLine(currentPlyReview)}</p>
              {['mistake', 'blunder', 'miss'].includes(currentPlyReview.label) && !exploring ? (
                <button type="button" className="text-button" disabled={busy} onClick={() => startExplore(currentPlyReview.ply - 1)}>
                  Retry this position
                </button>
              ) : null}
            </section>
          ) : null}

          {review ? (
            <section className="panel">
              <h2>Moves</h2>
              <p className="outcome-caption">{review.opening ? `${review.opening.eco} · ${review.opening.name}` : 'No named opening'}</p>
              {variation?.moves.length ? (
                <div className="source-actions" aria-label="Variation moves">
                  {variation.moves.map((move, index) => (
                    <button
                      className="text-button" key={index} type="button"
                      aria-pressed={ply === variation.from + index + 1}
                      onClick={() => goPly(variation.from + index + 1)}
                    >{move.san}</button>
                  ))}
                </div>
              ) : null}
              <div className="review-moves" role="list">
                <button type="button" className={ply === 0 ? 'history-move active' : 'history-move'} onClick={() => { if (exploring) leaveExplore(); setPly(0); setSelected(null); setTargets([]) }}>Start</button>
                {review.plies.map(entry => (
                  <button
                    key={entry.ply}
                    type="button"
                    className={ply === entry.ply ? 'history-move active' : 'history-move'}
                    onClick={() => { if (exploring) leaveExplore(); setPly(entry.ply); setSelected(null); setTargets([]) }}
                    title={[
                      CLASS_LABEL[entry.label],
                      entry.ply === review.opening?.ply && 'Last named opening move',
                      entry.ply === (review.opening?.ply ?? -2) + 1 && 'First move outside named theory',
                    ].filter(Boolean).join(' · ')}
                  >
                    <span className="move-num">{entry.move.color === 'w' ? `${entry.move.moveNumber}.` : ''}</span>
                    <span>{entry.move.san}</span>
                    <ClassIcon label={entry.label} size={14} />
                  </button>
                ))}
              </div>

            </section>
          ) : null}
        </div>
      </div>

          {summary ? (
            <details className="panel review-summary" open={showSummary} onToggle={event => setShowSummary(event.currentTarget.open)}>
              <summary>Game results and accuracy</summary>
              <p className="outcome-caption">{game?.result === '*' ? 'Unfinished game' : game?.result}</p>
              <div className="accuracy-row">
                <div>
                  <strong>{summary.whiteAccuracy}%</strong>
                  <span>White</span>
                  {summary.whiteRating !== null ? <span className="rating-est">~{summary.whiteRating}</span> : null}
                </div>
                <div>
                  <strong>{summary.blackAccuracy}%</strong>
                  <span>Black</span>
                  {summary.blackRating !== null ? <span className="rating-est">~{summary.blackRating}</span> : null}
                </div>
              </div>
              <div className="class-summary">
                {CLASS_ORDER.map(label => {
                  const white = summary.counts.w[label]
                  const black = summary.counts.b[label]
                  return white || black ? (
                    <span key={label} className="class-chip">
                      <ClassIcon label={label} size={14} /> {CLASS_LABEL[label]} {white} / {black}
                    </span>
                  ) : null
                })}
              </div>
              <p className="outcome-caption">Estimated rating is from this game only and can differ from your usual rating.</p>
              {review ? <EvalGraph graph={review.graph} plies={review.plies} currentPly={ply} onSelect={goPly} /> : null}
            </details>
          ) : null}

      {list.length ? (
        <section className="panel history-panel" aria-label="Game history">
          <h2>Game history <span className="history-count">({list.length})</span></h2>
          <div className="history-scroll">
            <div className="history-table" role="table">
              <div className="history-head" role="row">
                <span>Time</span>
                <span>Players</span>
                <span>Result</span>
                <span>Accuracy</span>
                <span>Moves</span>
                <span>Date</span>
              </div>
              {list.map(item => {
                const key = `${item.source}-${item.id}`
                const active = openKey === key
                const plies = item.moves ?? plyCount(item.pgn)
                const moves = plies == null ? '—' : String(Math.ceil(plies / 2))
                const [whiteScore, blackScore] = scorePair(item.result)
                const outcome = userOutcome(item, listUser)
                const showAccuracy = active && review && !progress && (
                  (item.url && review.game.site === item.url) ||
                  (listSource === 'pgn' && review.game.white === item.white && review.game.black === item.black)
                )
                return (
                  <button
                    key={key}
                    type="button"
                    className="history-row"
                    role="row"
                    aria-current={active ? 'true' : undefined}
                    aria-disabled={busy || undefined}
                    onClick={() => openListed(item)}
                  >
                    <span className="history-clock">
                      <ClockIcon />
                      {clockLabel(item.pgn, item.timeControl)}
                    </span>
                    <span className="history-players">
                      <span className="history-player">
                        <span className="history-pip white" aria-hidden="true" />
                        <span className="history-name">{item.white}</span>
                        {item.whiteElo ? <span className="history-rating">({item.whiteElo})</span> : null}
                      </span>
                      <span className="history-player">
                        <span className="history-pip black" aria-hidden="true" />
                        <span className="history-name">{item.black}</span>
                        {item.blackElo ? <span className="history-rating">({item.blackElo})</span> : null}
                      </span>
                    </span>
                    <span className="history-result">
                      <span className="history-score">
                        <span className={scoreTone(item.result, 'white')}>{whiteScore}</span>
                        <span className={scoreTone(item.result, 'black')}>{blackScore}</span>
                      </span>
                      {outcome === 'win' ? <span className="history-badge win" aria-label="Win">+</span> : null}
                      {outcome === 'loss' ? <span className="history-badge loss" aria-label="Loss">−</span> : null}
                      {outcome === 'draw' ? <span className="history-badge draw" aria-label="Draw">=</span> : null}
                    </span>
                    <span className="history-acc">
                      {showAccuracy && review ? (
                        <>
                          <span className="known">{review.summary.whiteAccuracy.toFixed(1)}</span>
                          <span className="known">{review.summary.blackAccuracy.toFixed(1)}</span>
                        </>
                      ) : (
                        <span className="history-review">{active && progress ? '…' : 'Review'}</span>
                      )}
                    </span>
                    <span className="history-moves">{moves}</span>
                    <span className="history-date">{formatPlayedAt(item.playedAt)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {listNext || archives.length ? (
            <button ref={loadMoreButton} type="button" className="text-button history-more" onClick={loadMore} disabled={busy}>Load more</button>
          ) : null}
        </section>
      ) : null}

      <footer className="site-footer">
        <span>Full-game Stockfish review in your browser.</span>
        <Link href="/licenses.html">Open-source credits</Link>
      </footer>
    </div>
  )
}
