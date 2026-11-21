'use client'

import { Chess, DEFAULT_POSITION, type Move } from 'chess.js'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from '../engine'
import { uciMove } from '../game'
import { icon } from '../icons'
import openingSample from '../opening-sample.json'
import type { EngineInfo, GameRecord, OpeningSample } from '../types'
import { analyzeGame, coachLine, evaluateOnce, makeReview, type GameReview, type ReviewedPly } from '../review/analyze-game'
import { CLASS_LABEL, CLASS_ORDER, classifyMove, type MoveClass } from '../review/classify'
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

type VariationMove = { id: string; from: string; to: string; uci: string; san: string; label?: MoveClass; bestWin?: number; playedWin?: number; error?: string }
type Variation = { from: number; returnPly: number; moves: VariationMove[] }
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
  const boardPanel = useRef<HTMLElement>(null)
  const moveList = useRef<HTMLDivElement>(null)
  const cancelRef = useRef({ cancelled: false })

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ImportSource>('chesscom')
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
  const [showHistory, setShowHistory] = useState(true)
  const [archives, setArchives] = useState<string[]>([])
  const [parseProgress, setParseProgress] = useState('')
  const [review, setReview] = useState<GameReview | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [ply, setPly] = useState(0)
  const [showArrow, setShowArrow] = useState(true)
  const [reviewStarted, setReviewStarted] = useState(false)
  const [exploring, setExploring] = useState(false)
  const [variation, setVariation] = useState<Variation | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<string[]>([])
  const [promotion, setPromotion] = useState<Move[]>([])
  const [liveLines, setLiveLines] = useState<{ fen: string; lines: EngineInfo[] } | null>(null)
  const [searchError, setSearchError] = useState<{ fen: string; message: string } | null>(null)

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
  const originPly = variation?.from ?? 0
  const maxPly = variation ? variation.from + variation.moves.length : review?.plies.length ?? 0
  const playedMoves = useMemo(() => {
    if (!game) return []
    if (!variation || ply <= variation.from) return game.moves.slice(0, ply)
    return [...game.moves.slice(0, variation.from), ...variation.moves.slice(0, ply - variation.from)]
  }, [game, ply, variation])
  const currentFen = useMemo(() => game ? fenAtPly(game.startFen, playedMoves, playedMoves.length) : DEFAULT_POSITION, [game, playedMoves])
  const chess = useMemo(() => new Chess(currentFen), [currentFen])
  const currentPlyReview = exploring ? undefined : review?.plies[ply - 1]
  const reviewedPlies = review?.plies
  const pairedMoves = useMemo(() => {
    const rows = new Map<number, { w?: ReviewedPly; b?: ReviewedPly }>()
    for (const entry of reviewedPlies ?? []) {
      const number = entry.move.moveNumber
      const row = rows.get(number) ?? {}
      row[entry.move.color] = entry
      rows.set(number, row)
    }
    return [...rows]
  }, [reviewedPlies])
  useEffect(() => {
    const list = moveList.current
    const active = list?.querySelector<HTMLButtonElement>('[aria-current="step"]')
    if (!list || !active) return
    const viewport = list.getBoundingClientRect()
    const move = active.getBoundingClientRect()
    if (move.top < viewport.top) list.scrollTop += move.top - viewport.top
    else if (move.bottom > viewport.bottom) list.scrollTop += move.bottom - viewport.bottom
  }, [ply, exploring, reviewStarted])
  const lastMove = playedMoves.at(-1)
  const cachedLines = exploring ? undefined : review?.plies[ply]?.lines
  const needsSearch = Boolean(game && !busy && !cachedLines)
  const legalMoves = useMemo(() => chess.moves({ verbose: true }), [chess])
  const candidates = cachedLines ?? (liveLines?.fen === currentFen ? liveLines.lines : [])
  const bestUci = candidates[0]?.pv[0]
  const variationMove = variation && ply > variation.from ? variation.moves[ply - variation.from - 1] : undefined
  const variationLabel = variationMove?.label
  const moveClass = currentPlyReview?.label ?? variationLabel
  const variationBestWin = variationMove?.bestWin
  const variationPlayedWin = variationMove?.playedWin
  const bestArrow = showArrow && bestUci ? { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) } : null
  const currentEval = exploring && candidates[0]
    ? (chess.turn() === 'w' ? sideWinChance(candidates[0].type, candidates[0].score) : 1 - sideWinChance(candidates[0].type, candidates[0].score))
    : review
    ? review.graph[Math.min(ply, review.graph.length - 1)] ?? 0.5
    : candidates[0]
      ? chess.turn() === 'w'
        ? sideWinChance(candidates[0].type, candidates[0].score)
        : 1 - sideWinChance(candidates[0].type, candidates[0].score)
      : 0.5
  const evalLabel = (() => {
    const candidate = candidates[0]
    if (!candidate) return '0.0'
    if (candidate.type === 'mate') {
      const signed = chess.turn() === 'w' ? candidate.score : -candidate.score
      return `${signed >= 0 ? '+' : '-'}M${Math.abs(candidate.score)}`
    }
    const signed = chess.turn() === 'w' ? candidate.score : -candidate.score
    return `${signed >= 0 ? '+' : ''}${(signed / 100).toFixed(1)}`
  })()

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
    setShowHistory(false)
    setReviewStarted(false)
    setReview(makeReview(record, [], [0.5]))
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
      setPly(0)
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
    setShowHistory(true)
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
        const entered = text.trim()
        const fromProfile = entered.match(/chess\.com\/(?:member|play|profile)\/([A-Za-z0-9_-]+)/i)?.[1]
          || entered.match(/lichess\.org\/@\/([^/?#]+)/i)?.[1]
        const username = (fromProfile || entered).replace(/^@/, '')
        setListUser(username)
        let next = result.next ?? null
        const remaining = [...(result.archives ?? [])]
        let count = result.list.length
        while (next || remaining.length) {
          setParseProgress(`Loading games… ${count} found`)
          if (result.kind === 'chesscom-user') {
            const more = await listChessComMonth(remaining[0], username, filter)
            remaining.shift()
            setArchives([...remaining])
            count += more.length
            setList(current => [...current, ...more])
          } else {
            const page = await listLichessGames(username, next, filter)
            next = page.next
            setListNext(next)
            count += page.list.length
            setList(current => [...current, ...page.list])
          }
        }
        if (!count) setError('No games matched that username and setup.')
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
    setShowHistory(false)
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
      setShowHistory(true)
      setBusy(false)
    }
  }

  function cancelReview() {
    cancelRef.current.cancelled = true
    engineRef.current?.stop()
  }

  const goPly = useCallback((next: number | ((current: number) => number)) => {
    setPly(current => Math.max(originPly, Math.min(maxPly, typeof next === 'number' ? next : next(current))))
    setPromotion([])
    setSelected(null)
    setTargets([])
  }, [originPly, maxPly])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || maxPly <= originPly) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const panel = document.getElementById('mode-panel-review')
      if (!panel || panel.hidden) return
      const target = event.target
      if (target instanceof HTMLElement && target.isContentEditable) return
      if (target instanceof Element && target.closest('input, textarea, select, .mode-switch')) return

      if (event.key === 'Home' || event.key === 'End') {
        if (!(target instanceof Node && boardPanel.current?.contains(target))) return
        event.preventDefault()
        goPly(event.key === 'Home' ? originPly : maxPly)
        return
      }

      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      goPly(current => current + direction)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPly, originPly, maxPly])

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
    if (!review || !reviewStarted || busy) return
    setPly(from)
    setExploring(true)
    setVariation({ from, returnPly: ply, moves: [] })
    setSelected(null)
    setTargets([])
    setPromotion([])
  }

  function leaveExplore() {
    if (variation) setPly(variation.returnPly)
    setExploring(false)
    setVariation(null)
    setSelected(null)
    setTargets([])
    setPromotion([])
  }

  function playVariation(move: Move, position = ply, knownLines?: EngineInfo[]) {
    if (!game) return
    const from = variation?.from ?? position
    const returnPly = variation?.returnPly ?? ply
    const moves = variation?.moves.slice(0, position - from) ?? []
    const id = crypto.randomUUID()
    const uci = uciMove(move)
    const fen = move.before
    const precedingMoves = position === ply ? playedMoves : game.moves.slice(0, position)
    const history = { startFen: game.startFen, moves: precedingMoves.map(entry => entry.uci) }
    setExploring(true)
    setVariation({ from, returnPly, moves: [...moves, { id, from: move.from, to: move.to, uci, san: move.san }] })
    setPly(position + 1)
    setSelected(null)
    setTargets([])
    setPromotion([])
    void (async () => {
      const engine = new Engine(`${window.location.origin}/runtime/`)
      try {
        const legal = new Chess(fen).moves({ verbose: true }).map(uciMove)
        const lines = knownLines ?? await evaluateOnce(engine, fen, history, legal)
        const best = lines[0]
        const played = lines.find(line => line.pv[0] === uci) ?? (await evaluateOnce(engine, fen, history, legal, uci))[0]
        if (!best || !played) throw new Error('Could not evaluate this move.')
        const bestWin = sideWinChance(best.type, best.score)
        const playedWin = sideWinChance(played.type, played.score)
        const label = classifyMove({ playedUci: uci, bestUci: best.pv[0], bestWin, playedWin, secondWin: lines[1] ? sideWinChance(lines[1].type, lines[1].score) : undefined, color: move.color })
        setVariation(current => current ? { ...current, moves: current.moves.map(entry => entry.id === id ? { ...entry, label, bestWin, playedWin } : entry) } : current)
      } catch {
        setVariation(current => current ? { ...current, moves: current.moves.map(entry => entry.id === id ? { ...entry, error: 'Could not evaluate this move.' } : entry) } : current)
      } finally { engine.dispose() }
    })()
  }

  function showBestMove(entry: ReviewedPly) {
    if (!game || busy) return
    const position = entry.ply - 1
    const before = new Chess(game.moves[position - 1]?.fen ?? game.startFen)
    const best = before.moves({ verbose: true }).find(move => uciMove(move) === entry.bestUci)
    if (best) playVariation(best, position, entry.lines)
  }

  function onBoardMove(from: string, to: string) {
    if (!review || !reviewStarted || busy) return
    const moves = legalMoves.filter(move => move.from === from && move.to === to)
    if (moves.length > 1) setPromotion(moves)
    else if (moves[0]) playVariation(moves[0])
  }

  function onSquareClick(square: string) {
    if (!review || !reviewStarted || busy) return
    if (selected && legalMoves.some(move => move.from === selected && move.to === square)) {
      onBoardMove(selected, square)
      return
    }
    const next = legalMoves.filter(move => move.from === square && square !== selected)
    setSelected(next.length ? square : null)
    setTargets(next.map(move => move.to))
  }

  const summary = review?.summary
  const boardEnabled = Boolean(review && reviewStarted && !busy)
  const previousKeyMove = summary?.keyMoments.some(moment => moment < ply) ?? false
  const nextKeyMove = summary?.keyMoments.some(moment => moment > ply) ?? false
  const hasAlternative = currentPlyReview && currentPlyReview.bestUci !== currentPlyReview.move.uci
  const resultLabel = game?.result === '1-0' ? 'White won · 1–0'
    : game?.result === '0-1' ? 'Black won · 0–1'
      : game?.result === '1/2-1/2' ? 'Draw · ½–½' : null

  return (
    <div className="review-page">
      <div className="workspace review-workspace">
        <section className="board-panel" aria-labelledby="board-heading" ref={boardPanel} tabIndex={-1}>
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
            reviewGame={game}
            reviewPly={ply}
            moveClass={moveClass}
            bestArrow={bestArrow}
            evalPercent={currentEval}
            evalLabel={evalLabel}
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
                dangerouslySetInnerHTML={{ __html: icon('chevrons-left') }} />
              <button type="button" className="icon-button" aria-label="Previous move" aria-keyshortcuts="ArrowLeft" disabled={!review || ply <= originPly} onClick={() => goPly(ply - 1)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-left') }} />
              <span>{review ? `${ply} / ${exploring ? maxPly : review.game.moves.length}` : '—'}</span>
              <button type="button" className="icon-button" aria-label="Next move" aria-keyshortcuts="ArrowRight" disabled={!review || ply >= maxPly} onClick={() => goPly(ply + 1)}
                dangerouslySetInnerHTML={{ __html: icon('chevron-right') }} />
              <button type="button" className="icon-button" aria-label="Last move" disabled={!review} onClick={() => goPly(maxPly)}
                dangerouslySetInnerHTML={{ __html: icon('chevrons-right') }} />
            </div>
            <div className="line-controls">
              {!exploring ? (
                <button type="button" className="text-button" disabled={!boardEnabled} onClick={() => startExplore()}>Explore</button>
              ) : (
                <button type="button" className="text-button" onClick={leaveExplore}>Back to game</button>
              )}
            </div>
          </div>
        </section>

        <div className="analysis-rail">
          {showHistory ? <section className="panel">
            <form className="source-form" onSubmit={onImport}>
              <div className="review-load-heading">
                <h2>Load a game</h2>
                {source !== 'file' ? (
                  <button type="submit" className="primary-button" disabled={busy || !query.trim()}>
                    {busy && progress ? `Analyzed ${progress.done} / ${progress.total}` : busy ? parseProgress || 'Loading…' : source === 'pgn' ? 'Review PGN' : 'Load games'}
                  </button>
                ) : null}
              </div>
              <ChoiceRow
                label="Import from"
                value={source}
                onChange={setSource}
                options={[
                  { value: 'chesscom', label: 'Chess.com', icon: 'chesscom', brand: 'chesscom' },
                  { value: 'lichess', label: 'Lichess', icon: 'lichess' },
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
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          if (!busy && query.trim()) event.currentTarget.form?.requestSubmit()
                        }
                      }}
                      placeholder={source === 'lichess' ? 'username or https://lichess.org/…' : 'username or https://www.chess.com/member/…'}
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
                  {busy && progress ? (
                    <div className="source-actions">
                      <button type="button" className="text-button" onClick={cancelReview}>Cancel</button>
                    </div>
                  ) : null}
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
          </section> : null}

          {list.length > 0 && showHistory ? (
            <section className="panel sidebar-history" aria-label="Game history">
              <h2>Game history <span className="history-count">({list.length})</span></h2>
              <div className="sidebar-history-list">
                {list.map(item => {
                  const key = `${item.source}-${item.id}`
                  const active = openKey === key
                  const [whiteScore, blackScore] = scorePair(item.result)
                  const outcome = userOutcome(item, listUser)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={active ? 'sidebar-history-row active' : 'sidebar-history-row'}
                      aria-disabled={busy || undefined}
                      onClick={() => openListed(item)}
                    >
                      <span className="sidebar-history-meta">
                        <span>{clockLabel(item.pgn, item.timeControl)}{item.playedAt ? ` · ${new Date(item.playedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
                        {outcome ? <span className={`sidebar-history-outcome ${outcome}`}>{outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Draw'}</span> : null}
                      </span>
                      <span className="sidebar-history-players">
                        <span className="sidebar-history-player"><span className="history-piece white" aria-label="White" /><span className="history-name">{item.white} {item.whiteElo ? <span className="history-rating">{item.whiteElo}</span> : null}</span><span className={scoreTone(item.result, 'white')}>{whiteScore}</span></span>
                        <span className="sidebar-history-player"><span className="history-piece black" aria-label="Black" /><span className="history-name">{item.black} {item.blackElo ? <span className="history-rating">{item.blackElo}</span> : null}</span><span className={scoreTone(item.result, 'black')}>{blackScore}</span></span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {listNext || archives.length ? (
                <button ref={loadMoreButton} type="button" className="text-button history-more" onClick={loadMore} disabled={busy}>Load more</button>
              ) : null}
            </section>
          ) : null}

          {!showHistory || review ? (
            <div className="panel review-toolbar">
              {!showHistory ? (
                <button type="button" className="text-button history-return" onClick={() => setShowHistory(true)}>
                  {list.length ? `← Game history (${list.length})` : '← Load another game'}
                </button>
              ) : <h2>Game review</h2>}
              {reviewStarted ? (
                <button type="button" className="text-button" onClick={() => { if (exploring) leaveExplore(); setReviewStarted(false) }}>Review summary</button>
              ) : null}
            </div>
          ) : null}
          {!showHistory && busy ? (
            <div className="panel review-loading" role="status">
              <span>{progress ? `Analyzed ${progress.done} / ${progress.total} moves` : 'Opening game…'}</span>
              {progress ? <button type="button" className="text-button" onClick={cancelReview}>Cancel</button> : null}
            </div>
          ) : null}
          {!showHistory && error ? <p className="inline-message error" role="alert">{error}</p> : null}

          {summary && !reviewStarted ? (
            <section className="panel review-scorecard" aria-labelledby="review-summary-heading">
              <div className="review-summary-heading">
                <h2 id="review-summary-heading">Game summary</h2>
                {resultLabel ? <span>{resultLabel}</span> : null}
              </div>
              <div className="review-stats" aria-label="Game statistics">
                <div className="review-stats-header"><span></span><span>{game?.white || 'White'}</span><span>{game?.black || 'Black'}</span></div>
                <div className="review-stats-row"><span>Accuracy</span><strong className="stat-white">{summary.whiteAccuracy.toFixed(1)}%</strong><strong className="stat-black">{summary.blackAccuracy.toFixed(1)}%</strong></div>
                <div className="review-stats-row"><span>Estimated rating</span><strong className="stat-white">{summary.whiteRating ?? '—'}</strong><strong className="stat-black">{summary.blackRating ?? '—'}</strong></div>
              </div>
              <p className="rating-note">Accuracy is an engine-based estimate. Rating is a rough estimate, not an official Elo.{busy && progress ? ' Values update during analysis.' : ''}</p>
              <EvalGraph graph={review.graph} plies={review.plies} currentPly={ply} onSelect={goPly} />
              <div className="review-class-table" role="region" aria-label="Move classifications" tabIndex={0}>
                {CLASS_ORDER.map(label => {
                  const white = summary.counts.w[label]
                  const black = summary.counts.b[label]
                  return (
                    <div className="review-class-row" key={label}>
                      <span>{CLASS_LABEL[label]}</span>
                      <strong><span className="visually-hidden">White: </span>{white}</strong>
                      <span className="review-class-icon"><ClassIcon label={label} size={18} /></span>
                      <strong><span className="visually-hidden">Black: </span>{black}</strong>
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                className="primary-button start-review-button"
                disabled={busy || !review.plies.length}
                onClick={() => {
                  setShowHistory(false)
                  setReviewStarted(true)
                  goPly(ply || 1)
                  boardPanel.current?.focus()
                }}
              >Start review</button>
            </section>
          ) : null}

          {review && reviewStarted ? (
            <section className="panel review-guide" aria-label="Move review">
              <div className="review-guide-position" aria-live="polite">
                <div className="review-guide-heading">
                  <h2>{currentPlyReview
                    ? `${currentPlyReview.move.moveNumber}${currentPlyReview.move.color === 'w' ? '.' : '…'} ${currentPlyReview.move.san}`
                    : variationMove?.san ?? (exploring ? 'Try an alternative' : 'Starting position')}</h2>
                  {moveClass ? (
                    <span className="review-guide-class"><ClassIcon label={moveClass} />{CLASS_LABEL[moveClass]}</span>
                  ) : null}
                </div>
                <p className="coach-line">
                  {currentPlyReview ? coachLine(currentPlyReview)
                    : variationMove && variationBestWin !== undefined && variationPlayedWin !== undefined
                      ? `${Math.round(variationPlayedWin * 100)}% estimated win chance for the mover. The best move offered ${Math.round(variationBestWin * 100)}%.`
                      : variationMove ? variationMove.error ?? 'Evaluating this alternative…'
                        : exploring ? 'Play a different move on the board to see how it scores.'
                          : 'Step through the game or jump to its next key move.'}
                </p>
              </div>
              {hasAlternative || exploring ? (
                <div className="review-guide-actions">
                  {hasAlternative ? (
                    <>
                      <button type="button" className="small-button" disabled={busy} onClick={() => startExplore(currentPlyReview.ply - 1)}>Retry move</button>
                      <button type="button" className="small-button" disabled={busy} onClick={() => showBestMove(currentPlyReview)}>Show best move</button>
                    </>
                  ) : <button type="button" className="small-button" onClick={leaveExplore}>Back to game</button>}
                </div>
              ) : null}
              <div className="review-guide-nav">
                <div className="line-controls">
                  <button type="button" className="icon-button" aria-label="Previous move" disabled={ply <= originPly} onClick={() => goPly(ply - 1)} dangerouslySetInnerHTML={{ __html: icon('chevron-left') }} />
                  <span>{exploring ? `${ply - originPly} / ${maxPly - originPly}` : `${ply} / ${maxPly}`}</span>
                  <button type="button" className="icon-button" aria-label="Next move" disabled={ply >= maxPly} onClick={() => goPly(ply + 1)} dangerouslySetInnerHTML={{ __html: icon('chevron-right') }} />
                </div>
                {!exploring && (previousKeyMove || nextKeyMove) ? (
                  <div className="review-guide-key-nav">
                    <button type="button" className="text-button" disabled={!previousKeyMove} onClick={() => jumpKeyMoment(-1)}>Previous key</button>
                    <button type="button" className="small-button" disabled={!nextKeyMove} onClick={() => jumpKeyMoment(1)}>Next key move</button>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {review && reviewStarted ? (
            <section className="panel">
              <h2>Moves</h2>
              <p className="outcome-caption">{review.opening ? `${review.opening.eco} · ${review.opening.name}` : 'No named opening'}</p>
              {variation?.moves.length ? (
                <div className="source-actions" aria-label="Variation moves">
                  {variation.moves.map((move, index) => (
                    <button
                      className="text-button" key={move.id} type="button"
                      aria-pressed={ply === variation.from + index + 1}
                      onClick={() => goPly(variation.from + index + 1)}
                    >{move.san} {move.label ? <ClassIcon label={move.label} size={14} /> : <span>{move.error ? 'Evaluation failed' : 'Analyzing…'}</span>}</button>
                  ))}
                </div>
              ) : null}
              <button type="button" className={ply === 0 ? 'review-start active' : 'review-start'} onClick={() => { if (exploring) leaveExplore(); setPly(0); setSelected(null); setTargets([]) }}>Start</button>
              <div className="review-moves-paired" ref={moveList} role="group" aria-label="Game move list">
                {pairedMoves.map(([moveNumber, { w: white, b: black }]) => {
                  const renderMove = (entry?: ReviewedPly) => entry ? (
                    <button
                      key={entry.ply}
                      type="button"
                      className={!exploring && ply === entry.ply ? 'paired-move active' : 'paired-move'}
                      aria-current={!exploring && ply === entry.ply ? 'step' : undefined}
                      onClick={() => { if (exploring) leaveExplore(); setPly(entry.ply); setSelected(null); setTargets([]) }}
                      title={CLASS_LABEL[entry.label]}
                    >
                      <span>{entry.move.san}</span>
                      <ClassIcon label={entry.label} size={14} />
                    </button>
                  ) : <span className="paired-move empty" aria-hidden="true" />
                  return (
                    <div className="paired-move-row" key={moveNumber}>
                      <span className="paired-move-number">{moveNumber}.</span>
                      {renderMove(white)}
                      {renderMove(black)}
                    </div>
                  )
                })}
              </div>

            </section>
          ) : null}

          {review && reviewStarted ? (
            <details className="panel review-engine-lines">
              <summary>Engine lines</summary>
              {candidates.length ? (
                <ol className="review-lines">
                  {candidates.map((candidate, index) => {
                    const line = replayLine(currentFen, candidate.pv)
                    const score = chess.turn() === 'w' ? candidate.score : -candidate.score
                    const moverWin = sideWinChance(candidate.type, candidate.score)
                    const whiteWin = chess.turn() === 'w' ? moverWin : 1 - moverWin
                    const blackWin = 1 - whiteWin
                    const whitePct = Math.round(whiteWin * 100)
                    const blackPct = 100 - whitePct
                    const winLabel = whitePct >= blackPct ? `White ${whitePct}%` : `Black ${blackPct}%`
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
                        <div className="outcome-bar" aria-label={winLabel}>
                          {whitePct > 0 ? (
                            <span
                              className="outcome-segment white"
                              style={{ width: `${whitePct}%` }}
                            >{winLabel.startsWith('White') ? winLabel : ''}</span>
                          ) : null}
                          {blackPct > 0 ? (
                            <span
                              className="outcome-segment black"
                              style={{ width: `${blackPct}%` }}
                            >{winLabel.startsWith('Black') ? winLabel : ''}</span>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="outcome-caption" role="status">
                  {chess.isCheckmate() ? 'Checkmate' : !legalMoves.length ? 'Stalemate' : (searchError?.fen === currentFen ? searchError.message : 'Analyzing this position…')}
                </p>
              )}
            </details>
          ) : null}

        </div>
      </div>

      <footer className="site-footer">
        <span>Full-game Stockfish review in your browser.</span>
        <Link href="/licenses.html">Open-source credits</Link>
      </footer>
    </div>
  )
}
