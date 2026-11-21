export const BOARD_PREFERENCES_KEY = 'chess-board-preferences'

export const THEMES = [
  ['Green', '#ebecd0', '#739552'],
  ['Brown', '#f0d9b5', '#b58863'],
  ['Blue', '#dee3e6', '#8ca2ad'],
  ['Blue Marble', '#cbd8e3', '#5682a3'],
  ['Wood', '#f0dbb8', '#604025'],
  ['Walnut', '#e9cda5', '#76513c'],
  ['Maple', '#f2d7ad', '#c18c57'],
  ['Olive', '#e8e2c3', '#888b55'],
  ['Gray', '#e5e5e5', '#929292'],
  ['Slate', '#d7d9d4', '#708078'],
  ['Purple', '#e8dded', '#9577a5'],
  ['Ocean', '#d5e8e5', '#5b9493'],
  ['Sand', '#f2e4c8', '#c3a377'],
  ['Coral', '#f6ded4', '#c78070'],
] as const

export type ThemeName = (typeof THEMES)[number][0]
export const WOOD_THEMES = new Set<string>(['Wood', 'Walnut', 'Maple'])

export type BoardPreferences = {
  theme: string
  coordinates: boolean
  highlights: boolean
  legalMoves: boolean
  sounds: boolean
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  theme: 'Green',
  coordinates: true,
  highlights: true,
  legalMoves: true,
  sounds: true,
}

export function themeColors(name: string): readonly [string, string, string] {
  return THEMES.find(theme => theme[0] === name) ?? THEMES[0]
}

export function loadBoardPreferences(): BoardPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_PREFERENCES_KEY) || '{}') as Partial<BoardPreferences> & { version?: number }
    // Version 2 briefly forced Wood as the default; restore Green for that cohort.
    const theme = saved.theme === 'Wood' && saved.version === 2
      ? DEFAULT_BOARD_PREFERENCES.theme
      : saved.theme
    return {
      theme: THEMES.some(entry => entry[0] === theme) ? theme! : DEFAULT_BOARD_PREFERENCES.theme,
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

export function applyBoardTheme(frame: HTMLElement, preferences: BoardPreferences): void {
  const [, light, dark] = themeColors(preferences.theme)
  frame.style.setProperty('--light-square', light)
  frame.style.setProperty('--dark-square', dark)
  frame.classList.toggle('wood-board', WOOD_THEMES.has(preferences.theme))
  frame.classList.toggle('hide-coordinates', !preferences.coordinates)
}
