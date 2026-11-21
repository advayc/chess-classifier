import { DEFAULT_POSITION, type Chess, type Square } from 'chess.js'
import {
  BOARD_PREFERENCES_KEY,
  BOARDS,
  PIECE_SETS,
  applyBoardTheme,
  boardImage,
  loadBoardPreferences,
  pieceSource,
  saveBoardPreferences,
  type BoardPreferences,
} from './board-preferences'
import { createCropEditor } from './crop'
import { playChessSound, prepareChessAudio } from './chess-sound'
import { boardArrowPath } from './arrow'
import { createDetectionView, type Detection } from './detection-view'
import { Engine } from './engine'
import { gameResults, positionKey, recordMove, uciMove } from './game'
import { createHistoryView } from './history-view'
import { icon } from './icons'
import { outcomeBar } from './outcomes'
import { checkPgnSource, parsePgn } from './pgn-client'
import { connectSourceTabs } from './source-tabs'
import {
  CASTLING, FILES, canCastle, fromFen, fromFenInput, fromPlacement,
  indexOfSquare, lineNotation, pieceName, replayLine, squareAt, validatePosition,
  type LineMove,
} from './position'
import type { CropRect } from './crop'
import type {
  EngineInfo, GameRecord, Move, OpeningRow, OpeningSample, OutcomeCounts, Position, RecordedMove, ValidatedPosition,
} from './types'

type Origin = 'start' | 'screenshot' | 'fen' | 'manual' | 'game' | 'play'
type Side = 'white' | 'black'

interface AnalysisLine {
  info: EngineInfo
  line: LineMove[]
}
interface Analysis {
  fen: string
  turn: 'w' | 'b'
  status: string
  stage: 'loading' | 'primary' | 'alternatives'
  running: boolean
  lines: AnalysisLine[]
  depth: number
  error: string
}
interface AppState {
  position: Position
  origin: Origin
  orientation: Side
  uncertain: Set<number>
  editing: boolean
  palette: string
  cursor: number
  cropping: boolean
  file: File | null
  screenshotUrl: string | null
  scanId: number
  scanning: boolean
  scanFailed: boolean
  analysis: Analysis | null
  selected: number
  ply: number
  current: ValidatedPosition | null
  selection: string
  targets: Move[]
  game: GameRecord | null
  games: GameRecord[]
  opening: OpeningSample | null
  gameStats: boolean
  pgnLoading: boolean
}

function $<T extends HTMLElement | SVGElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing element #${id}`)
  return element as unknown as T
}
const $$ = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)]
const runtime = new URL('/runtime/', location.origin).href
const engine = new Engine(runtime)
const cropEditor = createCropEditor({
  wrap: $('crop-image-wrap'), image: $<HTMLImageElement>('crop-image'), outline: $('crop-rect'),
  horizontal: $<HTMLInputElement>('crop-x'), vertical: $<HTMLInputElement>('crop-y'), size: $<HTMLInputElement>('crop-size'),
})
const detectionView = createDetectionView({
  details: $<HTMLDetailsElement>('detection'), reveal: $<HTMLButtonElement>('show-detection'), svg: $<SVGSVGElement>('detection-image'),
  photo: $<SVGImageElement>('detection-photo'), outline: $<SVGRectElement>('detection-outline'), squares: $<SVGGElement>('detection-squares'),
  count: $('detection-count'), zoom: $<HTMLButtonElement>('detection-zoom'), readout: $('detection-readout'),
})
const state: AppState = {
  position: fromFen(DEFAULT_POSITION), origin: 'start', orientation: 'white',
  uncertain: new Set(), editing: false, palette: 'P', cursor: 0, cropping: false,
  file: null, screenshotUrl: null, scanId: 0, scanning: false, scanFailed: false,
  analysis: null, selected: 0, ply: 0,
  current: null, selection: '', targets: [], game: null, games: [],
  opening: null, gameStats: false, pgnLoading: false,
}

for (const item of $$('[data-icon]')) item.innerHTML = icon(item.dataset.icon ?? '')
const selectSource = connectSourceTabs($$('.source-tabs [role=tab]'))
const renderHistory = createHistoryView({
  container: $('game-history'), moves: $('history-moves'), heading: $('history-label'),
  previous: $<HTMLButtonElement>('history-previous'), next: $<HTMLButtonElement>('history-next'), navigate: navigateGame,
})

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function renderThemeToggle() {
  const dark = currentTheme() === 'dark'
  const next = dark ? 'light' : 'dark'
  const button = $<HTMLButtonElement>('theme-toggle')
  button.innerHTML = icon(dark ? 'sun' : 'moon')
  button.title = `Switch to ${next} mode`
  button.setAttribute('aria-label', `Switch to ${next} mode`)
}

function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('chess-engine-theme', theme) } catch {}
  renderThemeToggle()
}

$<HTMLButtonElement>('theme-toggle').addEventListener('click', () => {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
})
renderThemeToggle()

let boardPreferences: BoardPreferences = loadBoardPreferences()
const boardFrame = $('board-frame')
const themeGrid = $('theme-grid')
const pieceGrid = $('piece-grid')
const prefCoordinates = $<HTMLInputElement>('pref-coordinates')
const prefHighlights = $<HTMLInputElement>('pref-highlights')
const prefLegalMoves = $<HTMLInputElement>('pref-legal-moves')
const prefSounds = $<HTMLInputElement>('pref-sounds')

function themeChoice(name: string, selected: boolean, board: string, pieces: string, choose: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'theme-choice'
  button.setAttribute('aria-pressed', String(selected))
  const preview = document.createElement('span')
  preview.className = 'theme-preview'
  preview.style.backgroundImage = `url('${boardImage(board, true)}')`
  preview.setAttribute('aria-hidden', 'true')
  for (const piece of ['N', 'k']) {
    const image = pieceImage(piece, pieces)
    image.loading = 'lazy'
    preview.append(image)
  }
  const label = document.createElement('span')
  label.textContent = name
  button.append(preview, label)
  button.addEventListener('click', choose)
  return button
}

function renderBoardSettings(): void {
  const { theme, pieces } = boardPreferences
  themeGrid.replaceChildren(...BOARDS.map(board =>
    themeChoice(board.name, theme === board.id, board.id, pieces, () => setBoardPreference('theme', board.id))))
  pieceGrid.replaceChildren(...PIECE_SETS.map(set =>
    themeChoice(set.name, pieces === set.id, theme, set.id, () => setBoardPreference('pieces', set.id))))
  prefCoordinates.checked = boardPreferences.coordinates
  prefHighlights.checked = boardPreferences.highlights
  prefLegalMoves.checked = boardPreferences.legalMoves
  prefSounds.checked = boardPreferences.sounds
}

function setBoardPreference<K extends keyof BoardPreferences>(key: K, value: BoardPreferences[K]): void {
  boardPreferences = { ...boardPreferences, [key]: value }
  saveBoardPreferences(boardPreferences)
  applyBoardTheme(boardFrame, boardPreferences)
  renderBoardSettings()
  renderBoard()
}

for (const [input, key] of [
  [prefCoordinates, 'coordinates'],
  [prefHighlights, 'highlights'],
  [prefLegalMoves, 'legalMoves'],
  [prefSounds, 'sounds'],
] as const) {
  input.addEventListener('change', () => setBoardPreference(key, input.checked))
}

window.addEventListener('pointerup', event => {
  if (!event.isTrusted || !boardPreferences.sounds) return
  void prepareChessAudio()
}, { once: false })
window.addEventListener('keydown', event => {
  if (!event.isTrusted || !boardPreferences.sounds) return
  void prepareChessAudio()
})

applyBoardTheme(boardFrame, boardPreferences)
renderBoardSettings()

window.addEventListener('storage', event => {
  if (event.key !== BOARD_PREFERENCES_KEY) return
  boardPreferences = loadBoardPreferences()
  applyBoardTheme(boardFrame, boardPreferences)
  renderBoardSettings()
  renderBoard()
})

function pieceImage(piece: string, set = boardPreferences.pieces): HTMLImageElement {
  const image = document.createElement('img')
  image.src = pieceSource(piece, set)
  image.alt = ''
  image.draggable = false
  return image
}

function showMessage(element: HTMLElement, message = ''): void {
  if (element.textContent !== message) element.textContent = message
  element.hidden = !message
}

function clearAnalysis() {
  engine.cancel()
  state.analysis = null
  state.ply = 0
  state.selected = 0
  $('engine-results').hidden = true
  $('next-move-prompt').hidden = false
  $('results').hidden = !state.analysis
  updateAction()
}

function setPosition(position: Position, origin: Origin, { game = null, cursor = 0, editing = false }: { game?: GameRecord | null; cursor?: number; editing?: boolean } = {}): void {
  clearAnalysis()
  state.position = position
  state.origin = origin
  state.editing = editing
  state.cursor = cursor
  state.game = game
  clearSelection()
  showMessage($('position-error'))
  renderSetup()
  renderBoard()
  renderHistory(game, editing)
}

function afterPositionEdit() {
  clearAnalysis()
  state.game = null
  clearSelection()
  if (state.origin !== 'screenshot') state.origin = 'manual'
  showMessage($('position-error'))
  showMessage($('fen-message'))
  renderSetup()
  renderBoard()
  renderHistory(state.game, state.editing)
}

function clearSelection() {
  state.selection = ''
  state.targets = []
}

function renderSetup() {
  const { position } = state
  for (const input of $$<HTMLInputElement>('[name=turn]')) input.checked = input.value === position.turn
  for (const input of $$<HTMLInputElement>('.castling input')) {
    input.checked = position.castling.includes(input.value)
    input.disabled = !canCastle(position.squares, input.value)
  }
  $<HTMLInputElement>('ep').value = position.ep === '-' ? '' : position.ep
  $<HTMLInputElement>('halfmove').value = position.halfmove
  $<HTMLInputElement>('fullmove').value = position.fullmove
  $('import-note').hidden = state.origin !== 'screenshot'
  state.current = validatePosition(position)
  $<HTMLButtonElement>('copy-fen').disabled = !state.current?.fen
  renderGameResults()
  updateAction()
}

function updateAction() {
  const running = state.analysis?.running
  $('analyze-label').textContent = running ? 'Stop search' : 'Analyze position'
  const busy = state.scanning || state.cropping || state.pgnLoading
  $<HTMLButtonElement>('analyze').disabled = busy || state.editing || state.scanFailed
  for (const id of ['load-fen', 'setup-start', 'setup-empty', 'reset-position', 'load-pgn', 'choose-pgn', 'open-game']) $<HTMLButtonElement>(id).disabled = busy
  $<HTMLButtonElement>('crop-button').disabled = busy
  $<HTMLButtonElement>('show-detection').disabled = state.cropping
  $<HTMLButtonElement>('replace-button').disabled = state.cropping || state.pgnLoading
  $<HTMLButtonElement>('dropzone').disabled = state.pgnLoading
  $<HTMLButtonElement>('edit-board').disabled = busy || state.scanFailed
  $<HTMLButtonElement>('remove-button').disabled = state.cropping
}

/** The current position's rules engine. Only call this when the position is valid. */
function currentChess(): Chess {
  return state.current?.chess as Chess
}

function canPlay(): boolean {
  return Boolean(state.current?.chess) && !state.editing && !state.scanning && !state.scanFailed &&
    !state.cropping && !state.pgnLoading && !state.ply
}

const board = $('chessboard')
const DRAG_THRESHOLD = 6
interface PieceDrag {
  pointerId: number
  displayIndex: number
  fromIndex: number
  fromSquare: string
  piece: string
  editing: boolean
  originTile: HTMLElement
  startX: number
  startY: number
  active: boolean
  ghost: HTMLImageElement | null
}
let pieceDrag: PieceDrag | null = null
let suppressSquareClick = false

function reduceMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

function applySquareEdit(indices: number[]): void {
  state.position.castling = [...state.position.castling].filter(right => CASTLING[right] &&
    canCastle(state.position.squares, right)).join('') || '-'
  if (state.position.ep !== '-') {
    const target = indexOfSquare(state.position.ep)
    if (indices.some(index => [target, target + 8, target - 8].includes(index))) state.position.ep = '-'
  }
  for (const index of indices) state.uncertain.delete(index)
  afterPositionEdit()
}

function freeMovePiece(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    renderBoard()
    return
  }
  const piece = state.position.squares[fromIndex]
  state.position.squares[fromIndex] = ''
  state.position.squares[toIndex] = piece
  applySquareEdit([fromIndex, toIndex])
}

function displayIndexAt(clientX: number, clientY: number): number {
  const el = document.elementFromPoint(clientX, clientY)
  const tile = el?.closest?.('.square') as HTMLButtonElement | null
  if (!tile || !board.contains(tile)) return -1
  return tiles.indexOf(tile)
}

function moveGhost(ghost: HTMLElement, clientX: number, clientY: number, size: number): void {
  ghost.style.width = `${size}px`
  ghost.style.height = `${size}px`
  ghost.style.transform = `translate(${clientX - size / 2}px, ${clientY - size / 2}px)`
}

function endPieceDrag({ clientX = 0, clientY = 0, cancel = false }: { clientX?: number; clientY?: number; cancel?: boolean } = {}): void {
  const drag = pieceDrag
  if (!drag) return
  pieceDrag = null

  const finish = () => {
    drag.ghost?.remove()
    board.classList.remove('piece-dragging')
    drag.originTile.classList.remove('drag-origin')
    for (const tile of tiles) tile.classList.remove('drag-over')
  }

  if (!drag.active) {
    finish()
    return
  }

  suppressSquareClick = true
  const dropDisplay = cancel ? -1 : displayIndexAt(clientX, clientY)
  const dropIndex = dropDisplay >= 0 ? boardIndex(dropDisplay) : -1
  const dropSquare = dropIndex >= 0 ? squareAt(dropIndex) : ''

  if (drag.editing) {
    finish()
    if (dropIndex >= 0) {
      state.cursor = dropDisplay
      freeMovePiece(drag.fromIndex, dropIndex)
    } else {
      renderBoard()
    }
    return
  }

  const matching = dropSquare ? state.targets.filter(move => move.to === dropSquare) : []
  if (matching.length > 1) {
    finish()
    state.cursor = dropDisplay
    choosePromotion(matching)
    return
  }
  if (matching.length === 1) {
    finish()
    state.cursor = dropDisplay
    playMove(matching[0])
    return
  }

  const originRect = drag.originTile.getBoundingClientRect()
  const size = originRect.width
  const duration = reduceMotion() ? 0 : 160
  const ghost = drag.ghost
  if (!ghost) {
    finish()
    return
  }
  ghost.classList.add('returning')
  ghost.style.transition = `transform ${duration}ms ease-out`
  moveGhost(ghost, originRect.left + size / 2, originRect.top + size / 2, size)
  const settle = () => {
    finish()
    clearSelection()
    renderBoard()
  }
  if (!duration) settle()
  else ghost.addEventListener('transitionend', settle, { once: true })
}

function onPiecePointerMove(event: PointerEvent): void {
  const drag = pieceDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.active = true
    state.cursor = drag.displayIndex
    if (drag.editing) clearSelection()
    else {
      state.selection = drag.fromSquare
      state.targets = currentChess().moves({ square: drag.fromSquare as Square, verbose: true })
    }
    renderBoard()
    const rect = drag.originTile.getBoundingClientRect()
    const ghost = pieceImage(drag.piece)
    ghost.className = 'piece-ghost'
    document.body.append(ghost)
    drag.ghost = ghost
    board.classList.add('piece-dragging')
    drag.originTile.classList.add('drag-origin')
    moveGhost(ghost, event.clientX, event.clientY, rect.width)
  }
  event.preventDefault()
  if (drag.ghost) moveGhost(drag.ghost, event.clientX, event.clientY, drag.originTile.getBoundingClientRect().width)
  const over = displayIndexAt(event.clientX, event.clientY)
  for (const [i, square] of tiles.entries()) {
    square.classList.toggle('drag-over', i === over && over !== drag.displayIndex)
  }
}

function onPiecePointerUp(event: PointerEvent) {
  if (pieceDrag?.pointerId === event.pointerId) endPieceDrag(event)
}

function onPiecePointerCancel(event: PointerEvent) {
  if (pieceDrag?.pointerId === event.pointerId) endPieceDrag({ cancel: true })
}

const tiles = Array.from({ length: 64 }, (_, displayIndex) => {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = `square ${(Math.floor(displayIndex / 8) + displayIndex % 8) % 2 ? 'dark' : 'light'}`
  tile.tabIndex = -1
  tile.addEventListener('click', () => {
    if (suppressSquareClick) {
      suppressSquareClick = false
      return
    }
    if (!state.editing && !canPlay()) return
    state.cursor = displayIndex
    const index = boardIndex(displayIndex)
    if (!state.editing) {
      selectSquare(squareAt(index))
      return
    }
    state.position.squares[index] = state.palette
    applySquareEdit([index])
  })
  tile.addEventListener('pointerdown', event => {
    suppressSquareClick = false
    if (event.button !== 0 || pieceDrag) return
    if (state.ply || state.scanning || state.scanFailed || state.cropping || state.pgnLoading) return
    const editing = state.editing
    const playing = !editing && canPlay()
    if (!editing && !playing) return
    const index = boardIndex(displayIndex)
    const piece = state.position.squares[index]
    if (!piece) return
    if (playing) {
      const chess = currentChess()
      const onBoard = chess.get(squareAt(index) as Square)
      if (!onBoard || onBoard.color !== chess.turn()) return
    }
    pieceDrag = {
      pointerId: event.pointerId,
      displayIndex,
      fromIndex: index,
      fromSquare: squareAt(index),
      piece,
      editing,
      originTile: tile,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      ghost: null,
    }
  })
  tile.addEventListener('keydown', event => {
    if (!state.editing && !canPlay()) return
    const row = Math.floor(displayIndex / 8)
    const col = displayIndex % 8
    const newIndex = {
      ArrowLeft: row * 8 + Math.max(0, col - 1),
      ArrowRight: row * 8 + Math.min(7, col + 1),
      ArrowUp: Math.max(0, row - 1) * 8 + col,
      ArrowDown: Math.min(7, row + 1) * 8 + col,
    }[event.key]
    if (newIndex === undefined) return
    event.preventDefault()
    state.cursor = newIndex
    for (const [index, square] of tiles.entries()) square.tabIndex = index === newIndex ? 0 : -1
    tiles[newIndex].focus()
  })
  board.append(tile)
  return tile
})

window.addEventListener('pointermove', onPiecePointerMove, { passive: false })
window.addEventListener('pointerup', onPiecePointerUp)
window.addEventListener('pointercancel', onPiecePointerCancel)

document.querySelector('.skip-link')?.addEventListener('click', event => {
  if (state.cropping) return
  event.preventDefault()
  if (state.editing || canPlay()) tiles[state.cursor].focus()
  else board.focus()
})

const palette = [...'KQRBNP', ...'kqrbnp', ''].map(piece => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'piece-choice'
  button.setAttribute('aria-label', piece ? pieceName(piece) : 'Erase piece')
  button.title = piece ? pieceName(piece) : 'Erase piece'
  if (piece) button.append(pieceImage(piece))
  else button.innerHTML = icon('erase')
  button.addEventListener('click', () => {
    state.palette = piece
    renderPalette()
  })
  return { button, piece }
})

function arrangePalette() {
  const whiteAtBottom = state.orientation === 'white'
  const buttons = new Map(palette.map(item => [item.piece, item.button]))
  const white = [...'KQRBNP'].map(piece => buttons.get(piece)!)
  const black = [...'kqrbnp'].map(piece => buttons.get(piece)!)
  const erase = buttons.get('')!
  const top = $('tray-top')
  const bottom = $('tray-bottom')
  if (whiteAtBottom) {
    top.setAttribute('aria-label', 'Black pieces')
    bottom.setAttribute('aria-label', 'White pieces')
    top.replaceChildren(...black)
    bottom.replaceChildren(...white)
  } else {
    top.setAttribute('aria-label', 'White pieces')
    bottom.setAttribute('aria-label', 'Black pieces')
    top.replaceChildren(...white)
    bottom.replaceChildren(...black)
  }
  const eraseSlot = document.getElementById('erase-slot')
  if (eraseSlot) eraseSlot.replaceChildren(erase)
  const show = state.editing && !state.cropping
  top.hidden = !show
  bottom.hidden = !show
}

function renderPalette() {
  for (const { button, piece } of palette) button.setAttribute('aria-pressed', String(state.palette === piece))
  arrangePalette()
}

function boardIndex(index: number): number {
  return state.orientation === 'white' ? index : 63 - index
}

function renderBoard() {
  $('board-display').hidden = state.cropping
  $('crop-editor').hidden = !state.cropping
  $('board-actions').hidden = state.cropping
  $('board-heading').textContent = state.cropping ? 'Crop screenshot' :
    { start: 'Starting position', screenshot: 'Review position', fen: 'FEN position', manual: 'Set up position',
      game: 'Game position', play: 'Analysis board' }[state.origin]
  const boardHint = state.cropping ? 'Fit the crop to all four edges of the board.' :
    state.origin === 'screenshot' ? 'Check the pieces against your screenshot.' :
      state.origin === 'game' ? 'Select a move from the game history.' : ''
  showMessage($('board-subtitle'), boardHint)
  if (state.cropping) return

  const line = state.analysis?.lines[state.selected]?.line || []
  const activePly = line[state.ply - 1]
  const nextPly = line[state.ply]
  const squares = activePly ? fromFen(activePly.fen).squares : state.position.squares
  const lastMove = activePly || state.game?.moves[(state.game.ply ?? 0) - 1]
  const playing = Boolean(canPlay())
  const checkedKing = !activePly && state.current?.chess?.isCheck() ?
    squares.indexOf(state.position.turn === 'w' ? 'K' : 'k') : -1
  board.classList.toggle('editing', state.editing)
  board.classList.toggle('playable', playing)
  $('editor').hidden = !state.editing
  arrangePalette()
  $<HTMLButtonElement>('edit-board').setAttribute('aria-pressed', String(state.editing))
  $('edit-label').textContent = state.editing ? 'Done editing' : 'Edit board'
  $('orientation-label').textContent = state.orientation === 'white' ? 'White at bottom' : 'Black at bottom'
  $<HTMLButtonElement>('rotate-import').hidden = state.origin !== 'screenshot' || state.editing || Boolean(line.length)

  applyBoardTheme(boardFrame, boardPreferences)
  const fileEdge = state.orientation === 'white' ? 'a' : 'h'
  const rankEdge = state.orientation === 'white' ? '1' : '8'
  const coordKey = boardPreferences.coordinates ? `${state.orientation}` : 'off'
  for (const [displayIndex, tile] of tiles.entries()) {
    const index = boardIndex(displayIndex)
    const square = squareAt(index)
    const piece = squares[index]
    if (tile.dataset.piece !== piece || tile.dataset.coords !== coordKey) {
      const children: Node[] = []
      if (boardPreferences.coordinates && square[0] === fileEdge) {
        const rank = document.createElement('span')
        rank.className = 'board-coordinate rank-coordinate'
        rank.textContent = square[1]
        children.push(rank)
      }
      if (boardPreferences.coordinates && square[1] === rankEdge) {
        const file = document.createElement('span')
        file.className = 'board-coordinate file-coordinate'
        file.textContent = square[0]
        children.push(file)
      }
      if (piece) children.push(pieceImage(piece))
      tile.replaceChildren(...children)
      tile.dataset.piece = piece
      tile.dataset.coords = coordKey
    }
    const uncertain = !state.ply && state.uncertain.has(index)
    const legalTarget = boardPreferences.legalMoves && playing && state.targets.some(move => move.to === square)
    const checked = index === checkedKing
    const highlightMove = boardPreferences.highlights && lastMove && [lastMove.from, lastMove.to].includes(square)
    tile.classList.toggle('uncertain', uncertain)
    tile.classList.toggle('last-move', Boolean(highlightMove))
    tile.classList.toggle('selected-square', playing && square === state.selection)
    tile.classList.toggle('legal-target', legalTarget)
    tile.classList.toggle('check-square', checked)
    const detail = [uncertain && 'needs review', legalTarget && 'legal destination', checked && 'in check'].filter(Boolean)
    tile.dataset.square = square
    tile.setAttribute('aria-label', [square, pieceName(piece), ...detail].join(', '))
    tile.tabIndex = (state.editing || playing) && displayIndex === state.cursor ? 0 : -1
    tile.setAttribute('aria-disabled', String(!state.editing && !playing))
  }
  $('line-controls').hidden = !line.length
  $<HTMLDetailsElement>('game-results').querySelectorAll('button').forEach(button => { button.disabled = Boolean(state.ply) })
  $<HTMLButtonElement>('previous').disabled = state.ply === 0
  $<HTMLButtonElement>('next').disabled = state.ply === line.length
  $('ply-label').textContent = `${state.ply} / ${line.length}`
  $<HTMLButtonElement>('use-preview').hidden = !activePly || Boolean(state.analysis?.running)
  renderArrow(nextPly)
  renderPalette()
  if (pieceDrag?.active) {
    board.classList.add('piece-dragging')
    pieceDrag.originTile.classList.add('drag-origin')
  }
}

function selectSquare(square: string): void {
  const matching = state.targets.filter(move => move.to === square)
  if (matching.length > 1) {
    choosePromotion(matching)
    return
  }
  if (matching.length === 1) {
    playMove(matching[0])
    return
  }

  const chess = currentChess()
  const piece = chess.get(square as Square)
  if (square === state.selection || piece?.color !== chess.turn()) {
    clearSelection()
  } else {
    state.selection = square
    state.targets = chess.moves({ square: square as Square, verbose: true })
  }
  renderBoard()
}

function choosePromotion(moves: Move[]): void {
  const dialog = $<HTMLDialogElement>('promotion')
  $('promotion-pieces').replaceChildren(...moves.map(move => {
    const promotion = move.promotion ?? 'q'
    const piece = move.color === 'w' ? promotion.toUpperCase() : promotion
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'piece-choice'
    button.setAttribute('aria-label', `Promote to ${pieceName(piece).toLowerCase()}`)
    button.append(pieceImage(piece))
    button.addEventListener('click', () => {
      dialog.close()
      playMove(move)
      tiles[state.cursor].focus({ preventScroll: true })
    })
    return button
  }))
  dialog.showModal()
}

function navigateGame(ply: number): void {
  const game = state.game
  if (!game || ply < 0 || ply > game.moves.length || state.scanning || state.cropping || state.pgnLoading) return
  game.ply = ply
  const fen = ply ? game.moves[ply - 1].fen : game.startFen
  setPosition(fromFen(fen), game.title ? 'game' : 'play', { game, cursor: state.cursor })
}

function playMove(move: Move): void {
  if (!canPlay()) return
  if (boardPreferences.sounds) playChessSound(move.san)
  const game: GameRecord = state.game || { startFen: state.current?.fen ?? DEFAULT_POSITION, moves: [], ply: 0 }
  const at = game.ply ?? 0
  if (game.moves[at]?.uci === uciMove(move)) {
    state.game = game
    navigateGame(at + 1)
  } else {
    const chess = currentChess()
    const recorded = recordMove(chess, chess.move(move))
    state.game = { startFen: game.startFen, moves: [...game.moves.slice(0, at), recorded], ply: at }
    state.uncertain.clear()
    navigateGame(at + 1)
  }
  const movedPiece = move.color === 'w' ? move.piece.toUpperCase() : move.piece
  const chess = currentChess()
  const check = chess.isCheckmate() ? ', checkmate' : chess.isCheck() ? ', check' : ''
  $('board-announcement').textContent = `${pieceName(movedPiece)} from ${move.from} to ${move.to}${check}.`
}

function renderArrow(move: { from: string; to: string } | undefined | null): void {
  const svg = $<SVGSVGElement>('move-arrow')
  if (!move) {
    svg.replaceChildren()
    return
  }
  const center = (square: string) => {
    const index = boardIndex(indexOfSquare(square))
    return { x: (index % 8) * 100 + 50, y: Math.floor(index / 8) * 100 + 50 }
  }
  const d = boardArrowPath(center(move.from), center(move.to))
  svg.innerHTML = d ? `<path d="${d}"/>` : ''
}

$<HTMLButtonElement>('edit-board').addEventListener('click', () => {
  state.editing = !state.editing
  if (state.editing) {
    clearAnalysis()
    clearSelection()
    const firstUncertain = state.uncertain.values().next().value
    state.cursor = boardIndex(firstUncertain ?? 0)
  }
  renderGameResults()
  renderHistory(state.game, state.editing)
  updateAction()
  renderBoard()
  if (state.editing) palette.find(({ piece }) => piece === state.palette)?.button.focus()
})
$<HTMLButtonElement>('flip-board').addEventListener('click', () => {
  state.orientation = state.orientation === 'white' ? 'black' : 'white'
  state.cursor = 63 - state.cursor
  renderBoard()
})
$<HTMLButtonElement>('rotate-import').addEventListener('click', () => {
  state.position.squares.reverse()
  state.position.castling = '-'
  state.position.ep = '-'
  state.uncertain = new Set([...state.uncertain].map(index => 63 - index))
  state.orientation = state.orientation === 'white' ? 'black' : 'white'
  detectionView.rotate()
  afterPositionEdit()
})

for (const input of $$<HTMLInputElement>('[name=turn]')) {
  input.addEventListener('change', () => {
    state.position.turn = input.value
    if (state.position.ep !== '-' && state.position.ep[1] !== (input.value === 'w' ? '6' : '3')) state.position.ep = '-'
    afterPositionEdit()
  })
}
for (const input of $$<HTMLInputElement>('.castling input')) {
  input.addEventListener('change', () => {
    state.position.castling = $$<HTMLInputElement>('.castling input:checked').map(box => box.value).join('') || '-'
    afterPositionEdit()
  })
}
for (const field of ['ep', 'halfmove', 'fullmove'] as const) {
  $(field).addEventListener('change', () => {
    state.position[field] = $<HTMLInputElement>(field).value.trim().toLowerCase() || (field === 'ep' ? '-' : '')
    afterPositionEdit()
  })
}
$<HTMLButtonElement>('load-fen').addEventListener('click', loadFen)
$<HTMLInputElement>('fen-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$<HTMLButtonElement>('load-fen').disabled) loadFen()
})
function loadFen() {
  const { position, error } = fromFenInput($<HTMLInputElement>('fen-input').value)
  $('fen-message').classList.toggle('error', Boolean(error))
  if (!position) {
    showMessage($('fen-message'), error)
    return
  }
  state.scanFailed = false
  markSource(null)
  state.orientation = 'white'
  state.uncertain.clear()
  setPosition(position, 'fen')
  showMessage($('fen-message'), 'Position loaded.')
}
$<HTMLButtonElement>('copy-fen').addEventListener('click', async () => {
  const fen = state.current?.fen
  if (!fen) return
  $('fen-message').classList.remove('error')
  try {
    await navigator.clipboard.writeText(fen)
    showMessage($('fen-message'), 'FEN copied.')
  } catch {
    $<HTMLInputElement>('fen-input').value = fen
    $<HTMLInputElement>('fen-input').select()
    showMessage($('fen-message'), 'FEN selected. Copy it with your keyboard.')
  }
})

function resetBoard(fen: string, editing = false) {
  markSource(null)
  state.scanFailed = false
  state.orientation = 'white'
  state.uncertain.clear()
  setPosition(fromFen(fen), editing ? 'manual' : 'start', { editing })
  if (editing) palette.find(({ piece }) => piece === state.palette)?.button.focus()
}

$<HTMLButtonElement>('setup-start').addEventListener('click', () => resetBoard(DEFAULT_POSITION))
$<HTMLButtonElement>('setup-empty').addEventListener('click', () => resetBoard('8/8/8/8/8/8/8/8 w - - 0 1', true))
$<HTMLButtonElement>('reset-position').addEventListener('click', () => resetBoard(DEFAULT_POSITION))

$<HTMLButtonElement>('load-pgn').addEventListener('click', () => loadPgn($<HTMLTextAreaElement>('pgn-input').value))
$<HTMLButtonElement>('choose-pgn').addEventListener('click', () => $<HTMLInputElement>('pgn-file').click())
$<HTMLInputElement>('pgn-file').addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (file) loadPgn(file)
  input.value = ''
})
$<HTMLSelectElement>('game-select').addEventListener('change', () => openGame(Number($<HTMLSelectElement>('game-select').value)))
$<HTMLButtonElement>('open-game').addEventListener('click', () => openGame(Number($<HTMLSelectElement>('game-select').value)))
$<HTMLButtonElement>('import-another').addEventListener('click', () => {
  $('pgn-entry').hidden = false
  $<HTMLTextAreaElement>('pgn-input').value = ''
  $<HTMLTextAreaElement>('pgn-input').focus()
})

async function loadPgn(source: string | File) {
  if (state.pgnLoading || state.scanning || state.cropping) return
  const message = $('pgn-message')
  const problem = checkPgnSource(source)
  message.classList.toggle('error', Boolean(problem))
  if (problem) {
    showMessage(message, problem)
    return
  }
  state.pgnLoading = true
  clearSelection()
  updateAction()
  renderBoard()
  showMessage(message, 'Loading games…')
  try {
    const { games, skipped } = await parsePgn(source, (done, total) => {
      showMessage(message, `Reading game ${done} / ${total}…`)
    })
    state.pgnLoading = false
    state.games = games
    $<HTMLSelectElement>('game-select').replaceChildren(...games.map((game, index) =>
      new Option(`${index + 1}. ${game.title}`, String(index))))
    $('game-picker').hidden = false
    $('pgn-entry').hidden = true
    openGame(0)
    const count = games.length === 1 ? '1 game loaded.' : `${games.length} games loaded.`
    showMessage(message, skipped ? `${count} Skipped ${skipped} incomplete, illegal, or unsupported games.` : count)
    if (!$('source-pgn').hidden) $<HTMLSelectElement>('game-select').focus()
  } catch (error) {
    state.pgnLoading = false
    message.classList.add('error')
    showMessage(message, error instanceof Error ? error.message : 'Could not open the PGN.')
    updateAction()
    renderBoard()
  }
}

function openGame(index: number) {
  if (!state.games[index]) return
  markSource(null)
  state.scanFailed = false
  state.orientation = 'white'
  state.uncertain.clear()
  state.game = { ...state.games[index], ply: 0 }
  navigateGame(0)
}

function markSource(file: File | null) {
  detectionView.clear()
  if (state.screenshotUrl) URL.revokeObjectURL(state.screenshotUrl)
  state.file = file
  state.screenshotUrl = file ? URL.createObjectURL(file) : null
  $<HTMLButtonElement>('dropzone').hidden = Boolean(file)
  $('source-preview').hidden = !file
  if (file && state.screenshotUrl) {
    $<HTMLImageElement>('source-thumbnail').src = state.screenshotUrl
    $('source-name').textContent = file.name || 'Pasted screenshot'
    $('source-name').title = file.name || 'Pasted screenshot'
  } else {
    $<HTMLImageElement>('source-thumbnail').removeAttribute('src')
    showMessage($('scan-error'))
    showMessage($('scan-message'))
  }
}

let vision: Worker | null = null
let scanTimer: ReturnType<typeof setTimeout> | undefined

function finishScan(error?: string, result?: { orientation: Side; uncertain: number[]; placement: string; detection: Detection; reliable: boolean }) {
  clearTimeout(scanTimer)
  $('scan-progress').hidden = true
  state.scanning = false
  state.scanFailed = Boolean(error)
  showMessage($('scan-error'), error)
  if (!result || !state.screenshotUrl) {
    updateAction()
    renderBoard()
    return
  }
  state.orientation = result.orientation
  state.uncertain = new Set(result.uncertain)
  setPosition({
    squares: fromPlacement(result.placement), turn: 'w', castling: '-', ep: '-', halfmove: '0', fullmove: '1',
  }, 'screenshot')
  detectionView.show(state.screenshotUrl, result.detection, result.orientation)
  $<HTMLInputElement>('fen-input').value = ''
  showMessage($('fen-message'))
  showMessage($('scan-message'), result.reliable ?
    'Board found. Confirm who moves next.' : 'Some squares may need a closer look. Check the board before analyzing.')
}

function retireVision(message: string) {
  vision?.terminate()
  vision = null
  if (state.scanning) finishScan(message)
}

function scan(crop?: CropRect) {
  if (state.scanning) {
    vision?.terminate()
    vision = null
  }
  clearTimeout(scanTimer)
  detectionView.clear()
  clearAnalysis()
  clearSelection()
  showMessage($('scan-error'))
  showMessage($('scan-message'))
  showMessage($('position-error'))
  state.scanning = true
  state.scanFailed = false
  state.editing = false
  state.cropping = false
  $('scan-progress').hidden = false
  $('scan-label').textContent = 'Opening screenshot'
  $('scan-step').textContent = '1 / 3'
  $<HTMLProgressElement>('scan-meter').value = 1
  updateAction()
  renderBoard()
  if (!vision) {
    try {
      vision = new Worker(new URL('position-vision.js', runtime), { type: 'module' })
      vision.onmessage = ({ data }) => {
        if (data.id !== state.scanId) return
        if (data.label) {
          $('scan-label').textContent = data.label
          $('scan-step').textContent = `${data.value} / 3`
          $<HTMLProgressElement>('scan-meter').value = data.value
        } else {
          finishScan(data.error, data.result)
        }
      }
      const error = () => retireVision('The scanner could not start. Try again in a recent browser or load a FEN.')
      vision.onerror = error
      vision.onmessageerror = error
    } catch {
      retireVision('The scanner could not start. Try again in a recent browser or load a FEN.')
      return
    }
  }
  vision.postMessage({ id: ++state.scanId, file: state.file, runtime, crop })
  scanTimer = setTimeout(() => retireVision('Scanning took too long. Try cropping the screenshot or load a FEN.'), 45_000)
}

function acceptScreenshot(file?: File | null) {
  if (!file || state.pgnLoading) return
  selectSource('tab-screenshot')
  if (!/^image\/(png|jpeg|webp|bmp|gif|x-ms-bmp)$/.test(file.type) &&
      !(file.type === '' && /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name))) {
    showMessage($('scan-error'), 'Choose a PNG, JPEG, WebP, BMP, or GIF screenshot.')
    return
  }
  if (file.size > 35 * 1024 * 1024) {
    showMessage($('scan-error'), 'This image is larger than 35 MB. Crop it or export a smaller screenshot.')
    return
  }
  markSource(file)
  scan()
}

$<HTMLButtonElement>('dropzone').addEventListener('click', () => $<HTMLInputElement>('file-input').click())
$<HTMLButtonElement>('replace-button').addEventListener('click', () => $<HTMLInputElement>('file-input').click())
$<HTMLButtonElement>('remove-button').addEventListener('click', () => {
  retireVision('Scan canceled.')
  markSource(null)
  state.scanFailed = false
  if (state.origin === 'screenshot') {
    state.orientation = 'white'
    state.uncertain.clear()
    setPosition(fromFen(DEFAULT_POSITION), 'start')
  } else {
    updateAction()
  }
  $<HTMLButtonElement>('dropzone').focus()
})
$<HTMLInputElement>('file-input').addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement
  acceptScreenshot(input.files?.[0])
  input.value = ''
})
const upload = $$('.upload-panel')[0]
for (const eventName of ['dragenter', 'dragover'] as const) {
  upload.addEventListener(eventName, event => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    upload.classList.add('dragging')
  })
}
upload.addEventListener('dragleave', event => {
  if (!upload.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) upload.classList.remove('dragging')
})
window.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
})
window.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  upload.classList.remove('dragging')
  const [file] = event.dataTransfer.files
  if (/\.pgn$/i.test(file.name)) {
    selectSource('tab-pgn')
    loadPgn(file)
  } else {
    acceptScreenshot(file)
  }
})
window.addEventListener('paste', event => {
  const item = [...(event.clipboardData?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (!item) return
  event.preventDefault()
  acceptScreenshot(item.getAsFile())
})

$<HTMLButtonElement>('crop-button').addEventListener('click', () => {
  clearAnalysis()
  state.cropping = true
  state.editing = false
  renderBoard()
  if (state.screenshotUrl) cropEditor.open(state.screenshotUrl)
  updateAction()
  $<HTMLButtonElement>('cancel-crop').focus()
})
$<HTMLButtonElement>('cancel-crop').addEventListener('click', () => {
  state.cropping = false
  updateAction()
  renderBoard()
  $<HTMLButtonElement>('crop-button').focus()
})
$<HTMLButtonElement>('scan-crop').addEventListener('click', () => {
  if (cropEditor.selection) scan(cropEditor.selection)
})

const numbers = new Intl.NumberFormat()

function renderGameResults() {
  const { chess } = state.current || {}
  const key = chess && positionKey(chess.fen())
  const imported = key && state.games.length ? gameResults(state.games, key) : []
  const rows = imported.length ? imported : key && state.opening?.positions[key] || []
  const table = $<HTMLDetailsElement>('game-results')
  state.gameStats = !state.editing && rows.length > 0
  table.hidden = !state.gameStats
  if (!state.gameStats || !chess) return

  const legal = new Map(chess.moves({ verbose: true }).map(move => [uciMove(move), move]))
  const total = ([, white, draw, black]: OpeningRow) => white + draw + black
  $('game-results-source').textContent = imported.length ?
    'Finished games in your imported PGN' : `Lichess sample · ${numbers.format(state.opening?.games ?? 0)} rated games · Oct 2025`
  $('game-results-body').replaceChildren(...rows.filter(([uci]) => legal.has(uci))
    .sort((a, b) => total(b) - total(a)).slice(0, 5).map(row => {
      const [uci, ...counts] = row
      const move = legal.get(uci)!
      const tr = document.createElement('tr')
      const cell = tr.insertCell()
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-stat-move'
      button.textContent = move.san
      button.setAttribute('aria-label', `Play ${move.san}`)
      button.addEventListener('click', () => {
        state.cursor = boardIndex(indexOfSquare(move.to))
        playMove(move)
        tiles[state.cursor].focus({ preventScroll: true })
      })
      cell.append(button)
      tr.insertCell().textContent = numbers.format(total(row))
      tr.insertCell().append(outcomeBar(counts))
      return tr
    }))
}

function resultScore(info: EngineInfo, turn: 'w' | 'b') {
  if (info.score === undefined) return '—'
  const score = (turn === 'w' ? 1 : -1) * info.score
  if (info.type === 'mate') return `${score < 0 ? '−' : '+'}M${Math.abs(score)}`
  if (!score) return '0.00'
  return `${score < 0 ? '−' : '+'}${(Math.abs(score) / 100).toFixed(2)}`
}

function displayResults() {
  const analysis = state.analysis
  if (!analysis) return
  $('results').hidden = false
  $('engine-results').hidden = false
  $('next-move-prompt').hidden = true
  $('results').classList.toggle('searching', analysis.running)
  $('engine-status').dataset.state = analysis.running ? 'running' : analysis.error ? 'error' : 'complete'
  if ($('engine-status-label').textContent !== analysis.status) $('engine-status-label').textContent = analysis.status
  $('engine-depth').textContent = analysis.depth ? `Depth ${analysis.depth}` : ''
  $('search-track').hidden = !analysis.running
  $('engine-loading').hidden = !analysis.running || analysis.stage !== 'loading'
  $<HTMLButtonElement>('deeper').hidden = analysis.running || !analysis.lines.length || analysis.lines[0].info.type === 'mate'
  $('engine-outcomes-label').hidden = !analysis.lines.some(({ info }) => info.wdl)
  showMessage($('engine-error'), analysis.error)
  const focusedMove = (document.activeElement as HTMLElement | null)?.dataset.move
  $('move-list').replaceChildren(...analysis.lines.map(({ info, line }, index) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'move-row'
    row.dataset.move = info.pv[0]
    row.setAttribute('aria-pressed', String(state.selected === index))
    const title = document.createElement('span')
    title.className = 'move-heading'
    const rank = document.createElement('span')
    rank.className = 'move-rank'
    rank.textContent = index === 0 ?
      (analysis.stage === 'primary' && (analysis.running || analysis.error) ? 'Leading move' : 'Best move') :
      `Alternative ${index}`
    const san = document.createElement('strong')
    san.textContent = line[0].san
    const score = document.createElement('span')
    score.className = 'move-score'
    score.textContent = resultScore(info, analysis.turn)
    score.title = 'Evaluation from White’s perspective'
    const signed = info.score === undefined ? 0 : (analysis.turn === 'w' ? 1 : -1) * info.score
    score.dataset.side = signed > 15 ? 'white' : signed < -15 ? 'black' : 'even'
    const sequence = document.createElement('span')
    sequence.className = 'move-sequence'
    sequence.textContent = lineNotation(line.slice(0, 8))
    sequence.title = lineNotation(line)
    title.append(rank, san, score)
    row.append(title, sequence)
    if (info.wdl) {
      const counts = analysis.turn === 'w' ? info.wdl : [...info.wdl].reverse()
      row.append(outcomeBar(counts))
    }
    row.addEventListener('click', () => {
      state.selected = index
      state.ply = 0
      for (const [i, button] of $$('.move-row').entries()) button.setAttribute('aria-pressed', String(i === index))
      renderBoard()
    })
    return row
  }))
  if (focusedMove) $$('.move-row').find(button => button.dataset.move === focusedMove)?.focus({ preventScroll: true })
  updateAction()
  renderBoard()
}

function setLines(best: EngineInfo, alternatives: EngineInfo[] = []) {
  const analysis = state.analysis
  if (!analysis) return
  const previous = analysis.lines[state.selected]?.info
  analysis.lines = [best, ...alternatives].flatMap(info => {
    const line = replayLine(analysis.fen, info.pv)
    return line.length ? [{ info, line }] : []
  })
  const selected = analysis.lines.findIndex(({ info }) => info.pv[0] === previous?.pv[0])
  state.selected = Math.max(0, selected)
  const next = analysis.lines[state.selected]?.info
  if (!next || !previous || next.pv.slice(0, state.ply).join() !== previous.pv.slice(0, state.ply).join()) state.ply = 0
}

function analyze(deep = false) {
  const { fen, chess, error } = state.current ?? {}
  showMessage($('position-error'), error)
  if (!fen || !chess) return
  clearSelection()
  const moves = chess.moves({ verbose: true })
  const game = state.game
  const played = game?.moves.slice(0, game.ply)
  const history = game && played?.length ? { startFen: game.startFen, moves: played.map(move => move.uci) } : undefined
  const key = positionKey(chess.fen())
  const repeated = (played?.filter(move => move.before === key).length ?? 0) >= 4
  const terminal = chess.isCheckmate() ? 'Checkmate' : chess.isStalemate() ? 'Stalemate' :
    chess.isInsufficientMaterial() ? 'Draw by insufficient material' :
      repeated ? 'Draw by fivefold repetition' :
      Number(state.position.halfmove) >= 150 ? 'Draw by the 75-move rule' : ''
  const previous = deep && state.analysis?.fen === fen ? state.analysis : null
  const analysis: Analysis = {
    fen, turn: chess.turn(), status: terminal || 'Loading Stockfish', stage: 'loading',
    running: !terminal, lines: previous?.lines || [], depth: previous?.depth || 0, error: '',
  }
  state.analysis = analysis
  state.selected = 0
  state.ply = 0
  displayResults()
  if (terminal) return
  engine.start({
    fen,
    history,
    legalMoves: moves.map(uciMove),
    deep,
    update({ stage, best, alternatives }) {
      analysis.stage = stage
      analysis.status = stage === 'alternatives' ? 'Checking alternatives' : 'Searching for the best move'
      if (best && (!previous || best.depth >= analysis.depth)) {
        analysis.depth = best.depth || analysis.depth
        setLines(best, alternatives)
      }
      displayResults()
    },
    complete({ best, alternatives, stopped }) {
      analysis.running = false
      analysis.status = stopped ? 'Search stopped' : 'Search complete'
      if (best && (!previous || best.depth >= analysis.depth)) {
        analysis.depth = best.depth || analysis.depth
        setLines(best, alternatives)
      }
      if (!stopped && !analysis.lines.length) analysis.error = 'Stockfish returned no legal move. Check the position and try again.'
      displayResults()
    },
    fail(message) {
      analysis.running = false
      analysis.status = 'Search interrupted'
      analysis.error = message
      displayResults()
    },
  })
}

$<HTMLButtonElement>('analyze').addEventListener('click', () => {
  if (state.analysis?.running) engine.stop()
  else {
    analyze()
    if (state.analysis) $('engine-status').scrollIntoView({ block: 'nearest' })
  }
})
$<HTMLButtonElement>('deeper').addEventListener('click', () => {
  analyze(true)
  $<HTMLButtonElement>('analyze').focus()
})
$<HTMLButtonElement>('previous').addEventListener('click', () => {
  if (!state.ply) return
  state.ply--
  renderBoard()
})
$<HTMLButtonElement>('next').addEventListener('click', () => {
  const line = state.analysis?.lines[state.selected]?.line
  if (!line || state.ply >= line.length) return
  state.ply++
  renderBoard()
})
$<HTMLButtonElement>('use-preview').addEventListener('click', () => {
  const line = state.analysis?.lines[state.selected]?.line
  const analysis = state.analysis
  if (!line || !state.ply || !analysis || analysis.running) return
  const base = state.game
  const moves = [...(base?.moves.slice(0, base.ply) || []),
    ...line.slice(0, state.ply).map(move => ({ ...move, before: positionKey(move.before) }))]
  state.game = { startFen: base?.startFen || analysis.fen, moves, ply: moves.length }
  markSource(null)
  state.uncertain.clear()
  navigateGame(moves.length)
  analyze()
  $<HTMLButtonElement>('analyze').focus()
})

renderSetup()
renderBoard()

import('./opening-sample.json').then(({ default: opening }) => {
  state.opening = opening as unknown as OpeningSample
  renderGameResults()
}).catch(() => {})
