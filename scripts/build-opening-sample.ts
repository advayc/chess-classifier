// Read the first finished games from a Lichess standard rated PGN export on stdin.
import { createInterface } from 'node:readline'
import { Chess } from 'chess.js'
import { positionKey, RESULT_INDEX, uciMove } from '../src/game'

const SAMPLE_SIZE = 25_000
const PLIES = 8
const MIN_GAMES = 5
const positions = new Map<string, Map<string, [number, number, number]>>()
let games = 0
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  if (!line.startsWith('1. ')) continue
  const result = line.match(/\s(1-0|1\/2-1\/2|0-1)$/)?.[1]
  if (!result) continue
  const moves = line.replace(/\{[^}]*\}/g, '').replace(/\d+\.+/g, ' ').trim().split(/\s+/)
  moves.pop()
  if (moves.length < 2) continue
  const chess = new Chess()
  const played = moves.slice(0, PLIES).map(san => {
    const key = positionKey(chess.fen())
    return [key, uciMove(chess.move(san))]
  })
  for (const [key, uci] of played) {
    if (!positions.has(key)) positions.set(key, new Map())
    const rows = positions.get(key)!
    if (!rows.has(uci)) rows.set(uci, [0, 0, 0])
    rows.get(uci)![RESULT_INDEX[result]]++
  }
  if (++games === SAMPLE_SIZE) break
}
if (games !== SAMPLE_SIZE) throw new Error(`Expected ${SAMPLE_SIZE} games but read ${games}.`)
const total = (row: [string, number, number, number]) => row[1] + row[2] + row[3]
const rows = [...positions].flatMap(([key, moves]) => {
  const common = [...moves].map(([uci, counts]) => [uci, ...counts] as [string, number, number, number]).filter(row => total(row) >= MIN_GAMES)
  return common.length ? [`    ${JSON.stringify(key)}: ${JSON.stringify(common.sort((a, b) => total(b) - total(a)))}`] : []
})
process.stdout.write(`{\n  "games": ${games},\n  "positions": {\n${rows.join(',\n')}\n  }\n}\n`)
