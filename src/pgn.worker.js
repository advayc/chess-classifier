import { parseGames } from '@mliebelt/pgn-parser'
import { Chess, DEFAULT_POSITION } from 'chess.js'
import { fromFenInput } from './position.js'
import { recordMove } from './game.js'

self.onmessage = async ({ data: source }) => {
  try {
    const text = typeof source === 'string' ? source : await source.text()
    const parsed = parseGames(text.trim())
    if (parsed.length > 1000) throw new Error('Import up to 1,000 games at a time.')
    const games = []
    let skipped = 0
    for (const { tags, moves } of parsed) {
      if (!moves.length || (tags?.Variant && !/^(standard|chess|normal)$/i.test(tags.Variant))) {
        skipped++
        continue
      }
      try {
        const startFen = tags?.FEN?.trim().replace(/\s+/g, ' ') || DEFAULT_POSITION
        const { error } = fromFenInput(startFen)
        if (error) throw new Error(error)
        const chess = new Chess(startFen)
        const line = moves.map(({ notation }) => recordMove(chess, chess.move(notation.notation)))
        const white = tags?.White && tags.White !== '?' ? tags.White : 'White'
        const black = tags?.Black && tags.Black !== '?' ? tags.Black : 'Black'
        games.push({ startFen, title: `${white} vs ${black}`, result: tags?.Result || '*', moves: line })
      } catch {
        skipped++
      }
    }
    if (!games.length) throw new Error('No complete move list for a standard chess game was found.')
    self.postMessage({ games, skipped })
  } catch (error) {
    const message = error.name === 'SyntaxError' ? 'Check the PGN notation and try again.' : error.message
    self.postMessage({ error: message || 'Could not load this PGN.' })
  }
}
