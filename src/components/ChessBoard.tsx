'use client'

import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from 'react'
import './board-settings.css'
import { FILES, indexOfSquare, pieceName } from '../position'

const FILES_LIST = [...FILES]

const THEMES = [
  ['Green', '#ebecd0', '#739552'], ['Brown', '#f0d9b5', '#b58863'],
  ['Blue', '#dee3e6', '#8ca2ad'], ['Blue Marble', '#cbd8e3', '#5682a3'],
  ['Wood', '#e8c790', '#a66d42'], ['Walnut', '#e9cda5', '#76513c'],
  ['Maple', '#f2d7ad', '#c18c57'], ['Olive', '#e8e2c3', '#888b55'],
  ['Gray', '#e5e5e5', '#929292'], ['Slate', '#d7d9d4', '#708078'],
  ['Purple', '#e8dded', '#9577a5'], ['Ocean', '#d5e8e5', '#5b9493'],
  ['Sand', '#f2e4c8', '#c3a377'], ['Coral', '#f6ded4', '#c78070'],
] as const

type BoardPreferences = { theme: string; coordinates: boolean; highlights: boolean; legalMoves: boolean }
const DEFAULTS: BoardPreferences = { theme: 'Green', coordinates: true, highlights: true, legalMoves: true }

export function ChessBoard({
  fen,
  orientation = 'white',
  lastMove,
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
  lastMove?: { from: string; to: string } | null
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
      setPreferences({
        theme: THEMES.some(t => t[0] === saved.theme) ? saved.theme : DEFAULTS.theme,
        coordinates: typeof saved.coordinates === 'boolean' ? saved.coordinates : true,
        highlights: typeof saved.highlights === 'boolean' ? saved.highlights : true,
        legalMoves: typeof saved.legalMoves === 'boolean' ? saved.legalMoves : true,
      })
    } catch { /* Use defaults if saved settings are invalid. */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (loaded) localStorage.setItem('chess-board-preferences', JSON.stringify(preferences))
  }, [loaded, preferences])
  const theme = THEMES.find(t => t[0] === preferences.theme) ?? THEMES[0]
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

  const arrow = bestArrow ? arrowPoints(bestArrow.from, bestArrow.to, orientation) : null

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
        <summary aria-label="Board settings" title="Board settings">⚙ <span>Board settings</span></summary>
        <div className="board-settings-panel">
          <h3>Board settings</h3>
          <p>Choose a board</p>
          <div className="theme-grid" role="group" aria-label="Board theme">
            {THEMES.map(([name, light, dark]) => (
              <button type="button" key={name} className="theme-choice" aria-pressed={preferences.theme === name} onClick={() => setPreferences(p => ({ ...p, theme: name }))}>
                <span className="theme-preview" style={{ '--preview-light': light, '--preview-dark': dark } as CSSProperties} aria-hidden="true"><img src="/pieces/wN.svg" alt="" /><img src="/pieces/bK.svg" alt="" /></span>
                <span>{name}</span>
              </button>
            ))}
          </div>
          <div className="board-options">
            {([['coordinates', 'Show coordinates'], ['highlights', 'Highlight last move'], ['legalMoves', 'Show legal moves']] as const).map(([key, label]) => (
              <label key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences(p => ({ ...p, [key]: event.target.checked }))} /></label>
            ))}
          </div>
        </div>
      </details>
    <div className="board-frame review-board-frame" style={{ '--light-square': theme[1], '--dark-square': theme[2] } as CSSProperties}>
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
            const isLast = preferences.highlights && lastMove && (lastMove.from === square || lastMove.to === square)
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
                  dragSource === square && 'drag-origin',
                ].filter(Boolean).join(' ')}
                data-square={square}
                data-piece={piece}
                aria-label={`${square}, ${pieceName(piece)}`}
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
          <svg className="move-arrow" viewBox="0 0 800 800" aria-hidden="true">
            <defs>
              <marker id="review-arrow" markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--arrow)" />
              </marker>
            </defs>
            <line
              x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}
              stroke="var(--arrow)" strokeWidth="16" strokeLinecap="round"
              markerEnd="url(#review-arrow)" opacity="0.85"
            />
          </svg>
        ) : null}
      </div>
    </div>
    </div>
  )
}

function pieceSource(piece: string) {
  return `/pieces/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`
}

function arrowPoints(from: string, to: string, orientation: 'white' | 'black') {
  const center = (square: string) => {
    let index = indexOfSquare(square)
    if (orientation === 'black') index = 63 - index
    const file = index % 8
    const rank = Math.floor(index / 8)
    return { x: file * 100 + 50, y: rank * 100 + 50 }
  }
  const a = center(from)
  const b = center(to)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

export function fenAtPly(startFen: string, moves: { from: string; to: string; uci: string }[], ply: number): string {
  const chess = new Chess(startFen)
  for (let i = 0; i < ply; i++) {
    const move = moves[i]
    chess.move({ from: move.from, to: move.to, promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' | undefined })
  }
  return chess.fen()
}
