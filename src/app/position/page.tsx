import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Position analysis',
  description:
    'Analyze any chess position from a screenshot, FEN, PGN, or a board you set up. Screenshot detection reads the board in the browser, then Stockfish finds the best moves.',
  openGraph: {
    title: 'Position analysis · Chess Engine',
    description:
      'Analyze any chess position from a screenshot, FEN, PGN, or a board you set up, then let Stockfish find the best moves.',
  },
}

export default function PositionPage() {
  return null
}
