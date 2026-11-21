import type { MoveClass } from './classify'

const COLORS: Record<MoveClass, string> = {
  brilliant: '#1baca6',
  great: '#5b8c5a',
  best: '#8090b0',
  excellent: '#6a8fbf',
  good: '#7a8a7a',
  book: '#a67c52',
  inaccuracy: '#e0b040',
  mistake: '#e08a3a',
  blunder: '#c74a4a',
  miss: '#c74a4a',
}

/** Chess.com-inspired classification glyphs (original SVGs, not copied assets). */
export function ClassIcon({ label, size = 18 }: { label: MoveClass; size?: number }) {
  const color = COLORS[label]
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  switch (label) {
    case 'brilliant':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M12 5.5 13.8 10h4.5l-3.6 2.8 1.4 4.5L12 14.8 7.9 17.3l1.4-4.5L5.7 10h4.5Z" fill="#fff" />
        </svg>
      )
    case 'great':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M8 12.5 10.8 15.2 16.5 9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'best':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <circle cx="12" cy="12" r="4" fill="#fff" />
        </svg>
      )
    case 'excellent':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'good':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M8 12h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" fill={color} />
          <path d="M12 5v14M7 9h3M7 12h3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'inaccuracy':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <text x="12" y="16" textAnchor="middle" fill="#1a1a18" fontSize="12" fontWeight="700">?</text>
        </svg>
      )
    case 'mistake':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">??</text>
        </svg>
      )
    case 'blunder':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'miss':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M8 12h8M12 8v8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3.5" fill="none" stroke="#fff" strokeWidth="1.5" />
        </svg>
      )
  }
}

export function classColor(label: MoveClass): string {
  return COLORS[label]
}
