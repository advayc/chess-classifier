'use client'

import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from 'react'
import './board-settings.css'
import { playChessSound, prepareChessAudio } from '../chess-sound'
import { icon } from '../icons'
import { FILES, indexOfSquare, pieceName } from '../position'
import { ClassIcon, classColor } from '../review/class-icons'
import { CLASS_LABEL, type MoveClass } from '../review/classify'
import type { GameRecord } from '../types'

const FILES_LIST = [...FILES]
const WOOD_THEME = ['Wood', '#f0dbb8', '#604025'] as const

const THEMES = [
  ['Green', '#ebecd0', '#739552'], ['Brown', '#f0d9b5', '#b58863'],
  ['Blue', '#dee3e6', '#8ca2ad'], ['Blue Marble', '#cbd8e3', '#5682a3'],
  WOOD_THEME, ['Walnut', '#e9cda5', '#76513c'],
  ['Maple', '#f2d7ad', '#c18c57'], ['Olive', '#e8e2c3', '#888b55'],
  ['Gray', '#e5e5e5', '#929292'], ['Slate', '#d7d9d4', '#708078'],
  ['Purple', '#e8dded', '#9577a5'], ['Ocean', '#d5e8e5', '#5b9493'],
  ['Sand', '#f2e4c8', '#c3a377'], ['Coral', '#f6ded4', '#c78070'],
] as const

const WOOD_THEMES = new Set(['Wood', 'Walnut', 'Maple'])
type BoardPreferences = { theme: string; coordinates: boolean; highlights: boolean; legalMoves: boolean; sounds: boolean }
const DEFAULTS: BoardPreferences = { theme: WOOD_THEME[0], coordinates: true, highlights: true, legalMoves: true, sounds: true }

export function ChessBoard({
  fen,
  orientation = 'white',
  lastMove,
  reviewGame,
  reviewPly = 0,
  moveClass,
  bestArrow,
  evalPercent,
  evalLabel,
  onSquareClick,
  onMove,
  canDrag,
  selected,
  targets = [],
}: {
  fen: string
  orientation?: 'white' | 'black'
  lastMove?: { from: string; to: string; san: string } | null
  reviewGame?: GameRecord
  reviewPly?: number
  moveClass?: MoveClass
  bestArrow?: { from: string; to: string } | null
  evalPercent?: number
  evalLabel?: string
  onMove?: (from: string, to: string) => void
  canDrag?: (square: string) => boolean
  onSquareClick?: (square: string) => void
  selected?: string | null
  targets?: string[]
}) {
  const [preferences, setPreferences] = useState<BoardPreferences>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('chess-board-preferences') || '{}')
      // Move users from the former default while honoring choices made with the new board.
      const theme = saved.theme === 'Green' && saved.version !== 2 ? DEFAULTS.theme : saved.theme
      setPreferences({
        theme: THEMES.some(t => t[0] === theme) ? theme : DEFAULTS.theme,
        coordinates: typeof saved.coordinates === 'boolean' ? saved.coordinates : true,
        highlights: typeof saved.highlights === 'boolean' ? saved.highlights : true,
        legalMoves: typeof saved.legalMoves === 'boolean' ? saved.legalMoves : true,
        sounds: typeof saved.sounds === 'boolean' ? saved.sounds : DEFAULTS.sounds,
      })
    } catch { /* Use defaults if saved settings are invalid. */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (loaded) localStorage.setItem('chess-board-preferences', JSON.stringify({ ...preferences, version: 2 }))
  }, [loaded, preferences])

  useEffect(() => {
    if (!loaded || !preferences.sounds) return
    const listeners = new AbortController()
    const unlock = (event: Event) => {
      if (!event.isTrusted) return
      void prepareChessAudio().then(ready => { if (ready) listeners.abort() })
    }
    window.addEventListener('pointerup', unlock, { signal: listeners.signal })
    window.addEventListener('keydown', unlock, { signal: listeners.signal })
    return () => listeners.abort()
  }, [loaded, preferences.sounds])

  const previousPosition = useRef({ game: reviewGame, fen, ply: reviewPly })
  const lastSan = lastMove?.san
  useEffect(() => {
    const previous = previousPosition.current
    previousPosition.current = { game: reviewGame, fen, ply: reviewPly }
    if (!loaded || !preferences.sounds || !reviewGame || previous.game !== reviewGame || previous.fen === fen) return
    playChessSound(reviewPly >= previous.ply ? lastSan : undefined)
  }, [fen, lastSan, loaded, preferences.sounds, reviewGame, reviewPly])

  const theme = THEMES.find(t => t[0] === preferences.theme) ?? WOOD_THEME
  const wood = WOOD_THEMES.has(theme[0])
  const highlightedMove = preferences.highlights ? lastMove : null
  const badgeIndex = highlightedMove && moveClass ? displaySquareIndex(highlightedMove.to, orientation) : null
  const placement = fen.split(' ')[0]
  const squares = useMemo(() => {
    const list: { square: string; piece: string; dark: boolean }[] = []
    const ranks = placement.split('/')
    for (let rank = 0; rank < 8; rank++) {
      let file = 0
      for (const ch of ranks[rank]) {
        if (/[1-8]/.test(ch)) {
          for (let i = 0; i < Number(ch); i++) {
            const square = FILES_LIST[file] + (8 - rank)
            list.push({ square, piece: '', dark: (file + rank) % 2 === 1 })
            file++
          }
        } else {
          const square = FILES_LIST[file] + (8 - rank)
          list.push({ square, piece: ch, dark: (file + rank) % 2 === 1 })
          file++
        }
      }
    }
    return orientation === 'white' ? list : [...list].reverse()
  }, [placement, orientation])

  const arrow = bestArrow ? arrowPath(bestArrow.from, bestArrow.to, orientation) : null

  const drag = useRef<{ square: string; piece: string; id: number; x: number; y: number; active: boolean } | null>(null)
  const ghost = useRef<HTMLImageElement>(null)
  const [dragSource, setDragSource] = useState<string | null>(null)
  const suppressClick = useRef(false)

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId || !ghost.current) return
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return
    if (!current.active) {
      current.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragSource(current.square)
      ghost.current.src = pieceSource(current.piece)
      ghost.current.style.width = `${event.currentTarget.clientWidth / 8}px`
    }
    ghost.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`
  }

  function endPointer(event: PointerEvent<HTMLDivElement>, dropped: boolean) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    setDragSource(null)
    if (!current.active) return
    suppressClick.current = true
    if (!dropped) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-square]')
    if (target?.dataset.square && event.currentTarget.contains(target) && target.dataset.square !== current.square) {
      onMove?.(current.square, target.dataset.square)
    }
  }

  return (
    <div className="board-settings-wrap">
      <details className="board-settings">
        <summary><span dangerouslySetInnerHTML={{ __html: icon('gear', 15) }} /> Board settings</summary>
        <div className="board-settings-panel">
          <h3>Board settings</h3>
          <p>Choose a board</p>
          <div className="theme-grid" role="group" aria-label="Board theme">
            {THEMES.map(([name, light, dark]) => (
              <button type="button" key={name} className="theme-choice" aria-pressed={preferences.theme === name} onClick={() => setPreferences(p => ({ ...p, theme: name }))}>
                <span className={`theme-preview${WOOD_THEMES.has(name) ? ' wood-preview' : ''}`} style={{ '--preview-light': light, '--preview-dark': dark } as CSSProperties} aria-hidden="true"><img src="/pieces/wN.svg" alt="" /><img src="/pieces/bK.svg" alt="" /></span>
                <span>{name}</span>
              </button>
            ))}
          </div>
          <div className="board-options">
            {([['coordinates', 'Show coordinates'], ['highlights', 'Highlight last move'], ['legalMoves', 'Show legal moves'], ['sounds', 'Play move sounds']] as const).map(([key, label]) => (
              <label key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences(p => ({ ...p, [key]: event.target.checked }))} /></label>
            ))}
          </div>
        </div>
      </details>
    <div className={`board-frame review-board-frame${wood ? ' wood-board' : ''}`} style={{
      '--light-square': theme[1],
      '--dark-square': theme[2],
      '--classification-color': moveClass ? classColor(moveClass) : undefined,
    } as CSSProperties}>
      {evalPercent !== undefined ? (
        <div className="eval-bar" aria-label={`Evaluation ${evalLabel ?? ''}`}>
          <div className="eval-bar-black" style={{ height: `${(1 - evalPercent) * 100}%` }} />
          <div className="eval-bar-white" style={{ height: `${evalPercent * 100}%` }} />
          {evalLabel ? <span>{evalLabel}</span> : null}
        </div>
      ) : null}
      <div className="board-surface">
        <div
          className={`chessboard ${onMove ? 'playable' : ''}`}
          role="group"
          aria-label="Chessboard"
          onPointerMove={movePointer}
          onPointerUp={event => endPointer(event, true)}
          onPointerCancel={event => endPointer(event, false)}
          onLostPointerCapture={event => endPointer(event, false)}
          onPointerLeave={event => {
            if (!drag.current?.active) endPointer(event, false)
          }}
        >
          {squares.map(({ square, piece, dark }) => {
            const isSelected = selected === square
            const isTarget = preferences.legalMoves && targets.includes(square)
            const isLast = highlightedMove?.from === square || highlightedMove?.to === square
            const classification = highlightedMove?.to === square ? moveClass : undefined
            return (
              <button
                key={square}
                type="button"
                className={[
                  'square',
                  dark ? 'dark' : 'light',
                  isSelected && 'selected-square',
                  isTarget && 'legal-target',
                  isLast && 'last-move',
                  isLast && moveClass && 'classified-move',
                  dragSource === square && 'drag-origin',
                ].filter(Boolean).join(' ')}
                data-square={square}
                data-piece={piece}
                aria-label={`${square}, ${pieceName(piece)}${classification ? `, ${CLASS_LABEL[classification]}` : ''}`}
                onPointerDown={event => {
                  suppressClick.current = false
                  if (!event.isPrimary || event.button !== 0 || !onMove || !piece || !canDrag?.(square)) return
                  drag.current = { square, piece, id: event.pointerId, x: event.clientX, y: event.clientY, active: false }
                }}
                onClick={event => {
                  if (event.detail === 0 || !suppressClick.current) onSquareClick?.(square)
                  suppressClick.current = false
                }}
              >
                {preferences.coordinates && (square[0] === (orientation === 'white' ? 'a' : 'h')) ? <span className="board-coordinate rank-coordinate">{square[1]}</span> : null}
                {preferences.coordinates && (square[1] === (orientation === 'white' ? '1' : '8')) ? <span className="board-coordinate file-coordinate">{square[0]}</span> : null}
                {piece ? (
                  <img
                    src={pieceSource(piece)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        <img ref={ghost} className="piece-ghost" alt="" hidden={!dragSource} />
        {arrow ? (
          <svg className="move-arrow review-arrow" viewBox="0 0 800 800" aria-hidden="true">
            <path d={arrow} />
          </svg>
        ) : null}
        {badgeIndex !== null && moveClass ? (
          <span className="board-move-class" aria-hidden="true" style={{
            '--badge-x': `${(badgeIndex % 8 + 1) * 12.5}%`,
            '--badge-y': `${Math.floor(badgeIndex / 8) * 12.5}%`,
          } as CSSProperties}>
            <ClassIcon label={moveClass} size={24} />
          </span>
        ) : null}
      </div>
    </div>
    </div>
  )
}

function pieceSource(piece: string) {
  return `/pieces/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`
}

function displaySquareIndex(square: string, orientation: 'white' | 'black') {
  const index = indexOfSquare(square)
  return orientation === 'black' ? 63 - index : index
}

function arrowPath(from: string, to: string, orientation: 'white' | 'black') {
  const center = (square: string) => {
    const index = displaySquareIndex(square, orientation)
    const file = index % 8
    const rank = Math.floor(index / 8)
    return { x: file * 100 + 50, y: rank * 100 + 50 }
  }
  const start = center(from)
  const end = center(to)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (!length) return null
  const point = (along: number, across: number) => {
    const x = start.x + (dx * along - dy * across) / length
    const y = start.y + (dy * along + dx * across) / length
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  const neck = length - 34
  return `M${point(19, -9)} L${point(neck, -9)} ${point(neck, -22)} ${point(length, 0)} ${point(neck, 22)} ${point(neck, 9)} ${point(19, 9)} Z`
}

export function fenAtPly(startFen: string, moves: { from: string; to: string; uci: string }[], ply: number): string {
  const chess = new Chess(startFen)
  for (let i = 0; i < ply; i++) {
    const move = moves[i]
    chess.move({ from: move.from, to: move.to, promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' | undefined })
  }
  return chess.fen()
}
