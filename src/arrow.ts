/** Board arrows drawn like Chess.com's: wide shaft, broad head, L-shaped knight moves. */

type Point = { x: number; y: number }

// Sizes in board units where one square is 100.
const SHAFT = 11
const HEAD_WIDTH = 30
const HEAD_LENGTH = 45
const START_OFFSET = 22
const TIP_INSET = 6

/** SVG path for an arrow between two square centers, in a 0–800 board coordinate system. */
export function boardArrowPath(start: Point, end: Point): string | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (!dx && !dy) return null
  const knight = new Set([Math.abs(dx), Math.abs(dy)])
  // Knight moves bend after the long leg, as on Chess.com.
  const corner = knight.has(100) && knight.has(200)
    ? Math.abs(dx) > Math.abs(dy) ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
    : null
  return corner ? bentArrow(start, corner, end) : straightArrow(start, end)
}

function unit(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

const normal = (u: Point): Point => ({ x: -u.y, y: u.x })
const add = (p: Point, u: Point, amount: number): Point => ({ x: p.x + u.x * amount, y: p.y + u.y * amount })
const path = (points: Point[]) => `M${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} Z`

function head(end: Point, u: Point): { left: Point[]; right: Point[] } {
  const n = normal(u)
  const tip = add(end, u, -TIP_INSET)
  const neck = add(tip, u, -HEAD_LENGTH)
  return {
    left: [add(neck, n, SHAFT), add(neck, n, HEAD_WIDTH), tip],
    right: [add(neck, n, -HEAD_WIDTH), add(neck, n, -SHAFT)],
  }
}

function straightArrow(start: Point, end: Point): string {
  const u = unit(start, end)
  const n = normal(u)
  const base = add(start, u, START_OFFSET)
  const { left, right } = head(end, u)
  return path([add(base, n, SHAFT), ...left, ...right, add(base, n, -SHAFT)])
}

function bentArrow(start: Point, corner: Point, end: Point): string {
  const u1 = unit(start, corner)
  const u2 = unit(corner, end)
  const n1 = normal(u1)
  const n2 = normal(u2)
  const base = add(start, u1, START_OFFSET)
  const outer = add(add(corner, n1, SHAFT), n2, SHAFT)
  const inner = add(add(corner, n1, -SHAFT), n2, -SHAFT)
  const { left, right } = head(end, u2)
  return path([add(base, n1, SHAFT), outer, ...left, ...right, inner, add(base, n1, -SHAFT)])
}
