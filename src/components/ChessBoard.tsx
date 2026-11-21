'use client'

import { Chess } from 'chess.js'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { FILES, indexOfSquare, pieceName } from '../position'

const FILES_LIST = [...FILES]

export function ChessBoard({
  fen,
  orientation = 'white',
  lastMove,
  bestArrow,
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
  onMove?: (from: string, to: string) => void
  canDrag?: (square: string) => boolean
  onSquareClick?: (square: string) => void
  selected?: string | null
  targets?: string[]
}) {
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
    <div className="board-frame review-board-frame">
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
            const isTarget = targets.includes(square)
            const isLast = lastMove && (lastMove.from === square || lastMove.to === square)
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
              <marker id="review-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--arrow)" />
              </marker>
            </defs>
            <line
              x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}
              stroke="var(--arrow)" strokeWidth="28" strokeLinecap="round"
              markerEnd="url(#review-arrow)" opacity="0.85"
            />
          </svg>
        ) : null}
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
