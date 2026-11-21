import { Chess } from 'chess.js'
import { Engine } from '../engine'
import { positionKey, uciMove } from '../game'
import type { EngineInfo, GameRecord, OpeningSample, RecordedMove } from '../types'
import { accuracyFor, estimatedRating, splitByColor } from './accuracy'
import { classifyMove, emptyClassCounts, type MoveClass } from './classify'
import openings from './openings.json'
import { materialSacrifice } from './material'
import { sideWinChance, scoreToWhiteWin } from './win-prob'

export interface ReviewedPly {
  ply: number
  move: RecordedMove
  label: MoveClass
  bestUci: string
  bestSan: string
  whiteWinBefore: number
  whiteWinAfter: number
  dropPct: number
  best: EngineInfo
  lines: EngineInfo[]
}

export interface ReviewSummary {
  whiteAccuracy: number
  blackAccuracy: number
  whiteRating: number | null
  blackRating: number | null
  counts: { w: Record<MoveClass, number>; b: Record<MoveClass, number> }
  keyMoments: number[]
}

export interface GameReview {
  game: GameRecord
  plies: ReviewedPly[]
  summary: ReviewSummary
  /** White win probability after each ply (index 0 = start). */
  graph: number[]
  opening: { eco: string; name: string; ply: number } | null
}

export interface AnalyzeProgress {
  done: number
  total: number
  ply?: ReviewedPly
  initialWin?: number
}

const namedPositions: Record<string, string[]> = openings

function legalUcis(chess: Chess): string[] {
  return chess.moves({ verbose: true }).map(move => uciMove(move))
}

export function sanForUci(chess: Chess, uci: string): string {
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci[4] as 'q' | 'r' | 'b' | 'n' | undefined
  const copy = new Chess(chess.fen())
  try {
    return copy.move({ from, to, promotion }).san
  } catch {
    return uci
  }
}

export function evaluateOnce(
  engine: Engine,
  fen: string,
  history: { startFen: string; moves: string[] },
  legalMoves: string[],
  playedOnly?: string,
): Promise<EngineInfo[]> {
  return new Promise((resolve, reject) => {
    engine.evaluate({
      fen,
      history,
      legalMoves,
      multipv: playedOnly ? 1 : 3,
      searchMoves: playedOnly ? [playedOnly] : undefined,
      depth: 14,
      movetime: 350,
      complete: ({ lines, stopped }) => {
        if (stopped) reject(new Error('cancelled'))
        else resolve(lines)
      },
      fail: message => reject(new Error(message)),
    })
  })
}

export async function analyzeGame(
  engine: Engine,
  game: GameRecord,
  opening: OpeningSample | null,
  onProgress: (progress: AnalyzeProgress) => void,
  signal?: { cancelled: boolean },
): Promise<GameReview> {
  const total = game.moves.length
  const plies: ReviewedPly[] = []
  const graph = [0.5]
  let priorWhite: MoveClass | undefined
  let priorBlack: MoveClass | undefined

  const chess = new Chess(game.startFen)
  const historyMoves: string[] = []

  for (let index = 0; index < game.moves.length; index++) {
    if (signal?.cancelled) throw new Error('cancelled')
    const move = game.moves[index]
    const beforeFen = chess.fen()
    const legal = legalUcis(chess)
    const lines = await evaluateOnce(
      engine,
      beforeFen,
      { startFen: game.startFen, moves: [...historyMoves] },
      legal,
    )
    if (signal?.cancelled) throw new Error('cancelled')

    const best = lines[0]
    const second = lines[1]
    if (!best) throw new Error('Stockfish returned no scored line for move ' + (index + 1) + '.')
    const turn = move.color
    const bestWin = sideWinChance(best.type, best.score)
    const playedLine = lines.find(line => line.pv[0] === move.uci) ??
      (await evaluateOnce(engine, beforeFen, { startFen: game.startFen, moves: historyMoves }, legal, move.uci))[0]
    if (signal?.cancelled) throw new Error('cancelled')
    if (!playedLine) throw new Error('Stockfish could not score ' + move.san + '.')
    const playedWin = sideWinChance(playedLine.type, playedLine.score)

    const bookRows = opening?.positions[positionKey(beforeFen)]
    const book = Boolean(namedPositions[positionKey(move.fen)] || bookRows?.some(row => row[0] === move.uci))
    const priorOpponent = turn === 'w' ? priorBlack : priorWhite

    const label = classifyMove({
      playedUci: move.uci,
      bestUci: best.pv[0],
      bestWin,
      playedWin,
      secondWin: second ? sideWinChance(second.type, second.score) : undefined,
      book,
      materialSacrifice: materialSacrifice(beforeFen, playedLine.pv, turn),
      color: turn,
      priorOpponent,
    })

    chess.move({ from: move.from, to: move.to, promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' | undefined })
    historyMoves.push(move.uci)

    // White win after the played move ≈ invert side win if Black just moved.
    const whiteAfter = turn === 'w' ? playedWin : 1 - playedWin
    const whiteBefore = scoreToWhiteWin(best.type, turn === 'w' ? best.score : -best.score)
    if (index === 0) graph[0] = whiteBefore
    graph.push(whiteAfter)

    const ply: ReviewedPly = {
      ply: index + 1,
      move,
      label,
      bestUci: best.pv[0],
      bestSan: sanForUci(new Chess(beforeFen), best.pv[0]),
      whiteWinBefore: whiteBefore,
      whiteWinAfter: whiteAfter,
      dropPct: (bestWin - playedWin) * 100,
      best,
      lines,
    }
    plies.push(ply)
    if (turn === 'w') priorWhite = label
    else priorBlack = label
    onProgress({ done: index + 1, total, ply, initialWin: graph[0] })
  }

  return makeReview(game, plies, graph)
}

export function makeReview(game: GameRecord, plies: ReviewedPly[], graph: number[]): GameReview {
  const labeled = plies.map(ply => ({ color: ply.move.color, label: ply.label }))
  const byColor = splitByColor(labeled)
  const counts = { w: emptyClassCounts(), b: emptyClassCounts() }
  for (const ply of plies) counts[ply.move.color][ply.label]++

  const swings = plies
    .map(ply => ({ ply: ply.ply, swing: Math.abs(ply.whiteWinAfter - ply.whiteWinBefore) }))
    .filter(entry => entry.swing >= 0.08)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 8)
    .sort((a, b) => a.ply - b.ply)
    .map(entry => entry.ply)

  let opening: GameReview['opening'] = null
  for (let i = plies.length - 1; i >= 0; i--) {
    const match = namedPositions[positionKey(plies[i].move.fen)]
    if (!match) continue
    const [eco, name] = match
    opening = { eco, name, ply: i + 1 }
    break
  }

  return {
    game,
    plies,
    graph,
    opening,
    summary: {
      whiteAccuracy: accuracyFor(byColor.w),
      blackAccuracy: accuracyFor(byColor.b),
      whiteRating: estimatedRating(accuracyFor(byColor.w), byColor.w.length),
      blackRating: estimatedRating(accuracyFor(byColor.b), byColor.b.length),
      counts,
      keyMoments: swings,
    },
  }
}

export function coachLine(ply: ReviewedPly): string {
  const { label, move, bestSan, dropPct } = ply
  if (label === 'book') return `${move.san} is a book move in this opening.`
  if (label === 'best' || label === 'brilliant' || label === 'great') {
    return `${move.san} was ${label === 'best' ? 'the best move' : `a ${label} move`}.`
  }
  if (label === 'miss') {
    return `${move.san} missed the chance to punish the previous mistake. ${bestSan} was stronger.`
  }
  const lost = Math.abs(dropPct).toFixed(1)
  return `${move.san} was a ${label} (about ${lost}% win chance). ${bestSan} was better.`
}
