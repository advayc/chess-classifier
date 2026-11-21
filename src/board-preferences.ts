import themes from './board-themes.json'

export const BOARD_PREFERENCES_KEY = 'chess-board-preferences'

export type BoardTheme = { id: string; name: string; light: string; dark: string }
export type PieceSet = { id: string; name: string }

/** Chess.com boards and piece sets, imported by scripts/import-board-themes.ts. */
export const BOARDS: BoardTheme[] = themes.boards
export const PIECE_SETS: PieceSet[] = themes.pieces

export type BoardPreferences = {
  theme: string
  pieces: string
  coordinates: boolean
  highlights: boolean
  legalMoves: boolean
  sounds: boolean
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  theme: '9rdwe',
  pieces: 'ejgfv',
  coordinates: true,
  highlights: true,
  legalMoves: true,
  sounds: true,
}

// Earlier versions stored colour-pair names; map them to the closest Chess.com board.
const LEGACY_THEMES: Record<string, string> = {
  Green: '9rdwe', Brown: 'brown', Blue: '4fs27', 'Blue Marble': 'marble', Wood: 'dark_wood',
  Walnut: 'walnut', Maple: 'tan', Olive: 'parchment', Gray: 'light', Slate: 'stone',
  Purple: 'purple', Ocean: 'icy_sea', Sand: 'sand', Coral: 'red',
}

export function boardTheme(id: string): BoardTheme {
  return BOARDS.find(board => board.id === id) ?? BOARDS[0]
}

export function boardImage(id: string, thumbnail = false): string {
  return `/themes/boards/${id}${thumbnail ? '-thumb' : ''}.webp`
}

/** Image for a FEN piece letter (uppercase is White) in the chosen set. */
export function pieceSource(piece: string, set: string): string {
  const side = piece === piece.toUpperCase() ? 'w' : 'b'
  return `/themes/pieces/${set}/${side}${piece.toLowerCase()}.webp`
}

export function loadBoardPreferences(): BoardPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_PREFERENCES_KEY) || '{}') as Partial<BoardPreferences>
    const theme = saved.theme && LEGACY_THEMES[saved.theme] || saved.theme
    return {
      theme: BOARDS.some(board => board.id === theme) ? theme! : DEFAULT_BOARD_PREFERENCES.theme,
      pieces: PIECE_SETS.some(set => set.id === saved.pieces) ? saved.pieces! : DEFAULT_BOARD_PREFERENCES.pieces,
      coordinates: typeof saved.coordinates === 'boolean' ? saved.coordinates : DEFAULT_BOARD_PREFERENCES.coordinates,
      highlights: typeof saved.highlights === 'boolean' ? saved.highlights : DEFAULT_BOARD_PREFERENCES.highlights,
      legalMoves: typeof saved.legalMoves === 'boolean' ? saved.legalMoves : DEFAULT_BOARD_PREFERENCES.legalMoves,
      sounds: typeof saved.sounds === 'boolean' ? saved.sounds : DEFAULT_BOARD_PREFERENCES.sounds,
    }
  } catch {
    return { ...DEFAULT_BOARD_PREFERENCES }
  }
}

export function saveBoardPreferences(preferences: BoardPreferences): void {
  try {
    localStorage.setItem(BOARD_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch { /* ignore quota / private mode */ }
}

/** CSS custom properties that paint a board frame with the chosen board image. */
export function boardStyle(id: string): Record<string, string> {
  const board = boardTheme(id)
  return {
    '--light-square': board.light,
    '--dark-square': board.dark,
    '--board-image': `url('${boardImage(board.id)}')`,
  }
}

export function applyBoardTheme(frame: HTMLElement, preferences: BoardPreferences): void {
  for (const [key, value] of Object.entries(boardStyle(preferences.theme))) frame.style.setProperty(key, value)
  frame.classList.add('image-board')
  frame.classList.toggle('hide-coordinates', !preferences.coordinates)
}
