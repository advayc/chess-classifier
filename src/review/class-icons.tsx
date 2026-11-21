import type { MoveClass } from './classify'

const COLORS: Record<MoveClass, string> = {
  brilliant: '#1baca6',
  great: '#5c8fd6',
  best: '#96bc4b',
  excellent: '#9bc53d',
  good: '#8fa888',
  book: '#c4a07a',
  inaccuracy: '#f0c040',
  mistake: '#e8923a',
  miss: '#e05a4f',
  blunder: '#d0312d',
}

/** Classification marks drawn to match the usual chess-review set. */
export function ClassIcon({ label, size = 18 }: { label: MoveClass; size?: number }) {
  const color = COLORS[label]
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  const mark = (text: string, ink = '#fff', fontSize = 11) => (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" fill={color} />
      <text x="12" y="16" textAnchor="middle" fill={ink} fontSize={fontSize} fontWeight="700" fontFamily="ui-sans-serif, system-ui, sans-serif">{text}</text>
    </svg>
  )
  switch (label) {
    case 'brilliant':
      return mark('!!', '#fff', 10)
    case 'great':
      return mark('!', '#fff', 14)
    case 'best':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M12 6.2 13.5 10h3.9l-3.2 2.3 1.2 3.8L12 13.8 8.6 16.1 9.8 12.3 6.6 10h3.9Z" fill="#fff" />
        </svg>
      )
    case 'excellent':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M9 10.2V15a1.2 1.2 0 0 0 1.2 1.2h4.2A1.6 1.6 0 0 0 16 14.6v-2.2a1.4 1.4 0 0 0-1.1-1.4l-1.6-.3.5-1.6A1.3 1.3 0 0 0 12.5 8H12L9.8 10H8.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'good':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M7.5 12.2 10.4 15.1 16.6 8.8" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="M7 8.2h4.2c.6 1 .6 1 .6 1s0 0 .6-1H16.5V16h-4.1s-.2 0-.4.6c-.2-.6-.4-.6-.4-.6H7V8.2Z" fill="#fff" />
          <path d="M12 9.2v6.2" stroke={color} strokeWidth="1" />
        </svg>
      )
    case 'inaccuracy':
      return mark('?!', '#1a1a18', 9)
    case 'mistake':
      return mark('?', '#fff', 14)
    case 'miss':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={color} />
          <path d="m8.2 8.2 7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
        </svg>
      )
    case 'blunder':
      return mark('??', '#fff', 10)
  }
}

export function classColor(label: MoveClass): string {
  return COLORS[label]
}
