'use client'

import type { ReviewedPly } from '../review/analyze-game'

export function EvalGraph({
  graph,
  plies,
  currentPly,
  onSelect,
}: {
  graph: number[]
  plies: ReviewedPly[]
  currentPly: number
  onSelect: (ply: number) => void
}) {
  const width = 320
  const height = 132
  const mid = height / 2
  const points = graph.map((win, index) => {
    const x = graph.length <= 1 ? 0 : (index / (graph.length - 1)) * width
    const y = mid - (win - 0.5) * (height - 8)
    return `${x},${y}`
  }).join(' ')

  const markers = plies.filter(ply =>
    ['brilliant', 'great', 'mistake', 'blunder', 'miss'].includes(ply.label),
  )

  return (
    <div className="eval-graph" role="group" aria-label="Evaluation graph from White’s perspective">
      <div className="eval-graph-heading"><strong>Evaluation</strong><span>White advantage ↑</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none"
        aria-hidden="true" onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect()
          onSelect(Math.round((event.clientX - bounds.left) / bounds.width * (graph.length - 1)))
        }}>
        <rect x="0" y="0" width={width} height={mid} fill="rgba(245,243,237,.08)" />
        <rect x="0" y={mid} width={width} height={mid} fill="rgba(20,20,18,.12)" />
        <line x1="0" y1={height / 4} x2={width} y2={height / 4} stroke="var(--border)" strokeWidth=".6" />
        <line x1="0" y1={height * 3 / 4} x2={width} y2={height * 3 / 4} stroke="var(--border)" strokeWidth=".6" />
        <line x1="0" y1={mid} x2={width} y2={mid} stroke="var(--border)" strokeWidth="1" />
        <polyline fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" points={points} />
        {markers.map(ply => {
          const x = graph.length <= 1 ? 0 : (ply.ply / (graph.length - 1)) * width
          const y = mid - (graph[ply.ply] - 0.5) * (height - 8)
          return (
            <circle
              key={ply.ply}
              cx={x}
              cy={y}
              r="3.5"
              className={`graph-mark mark-${ply.label}`}

            />
          )
        })}
        {graph.length > 1 ? (
          <line
            x1={(Math.min(currentPly, graph.length - 1) / (graph.length - 1)) * width}
            y1="0"
            x2={(Math.min(currentPly, graph.length - 1) / (graph.length - 1)) * width}
            y2={height}
            stroke="var(--accent)"
            strokeWidth="1.2"
          />
        ) : null}
      </svg>
      <div className="eval-slider-label"><span>Move {Math.ceil(currentPly / 2)}{currentPly ? (currentPly % 2 ? ' · White' : ' · Black') : ' · Start'}</span><span>{plies.length} half-moves analyzed</span></div>
      <input type="range" min={0} max={Math.max(0, graph.length - 1)}
        value={Math.min(currentPly, graph.length - 1)} onChange={event => onSelect(Number(event.target.value))}
        aria-label="Jump to a move on the evaluation graph"
        aria-valuetext={currentPly === 0 ? 'Starting position' : `Move ${Math.ceil(currentPly / 2)}, ${currentPly % 2 ? 'White' : 'Black'}`}
        style={{ background: `linear-gradient(to right, var(--accent) ${graph.length > 1 ? Math.min(currentPly, graph.length - 1) / (graph.length - 1) * 100 : 0}%, var(--border) 0)` }} />
    </div>
  )
}
