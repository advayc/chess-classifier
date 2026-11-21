import type { MoveClass } from './classify'
import { CLASS_LABEL } from './classify'

const COLORS: Record<MoveClass, string> = {
  brilliant: '#26c2a3',
  great: '#749bbf',
  best: '#81b64c',
  excellent: '#81b64c',
  good: '#95b776',
  book: '#d5a47d',
  forced: '#81b64c',
  inaccuracy: '#f7c631',
  mistake: '#ffa459',
  miss: '#ff7769',
  blunder: '#fa412d',
}

/** Classification badges from Chess.com's move review set, served from /classes. */
export function ClassIcon({ label, size = 18 }: { label: MoveClass; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="class-icon"
      src={`/classes/${label}.webp`}
      width={size}
      height={size}
      alt=""
      title={CLASS_LABEL[label]}
      draggable={false}
      decoding="async"
    />
  )
}

export function classColor(label: MoveClass): string {
  return COLORS[label]
}
