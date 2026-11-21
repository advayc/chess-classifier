import '@fontsource-variable/instrument-sans/wght.css'
import './style.css'
import { DEFAULT_POSITION } from 'chess.js'
import { createCropEditor } from './crop.js'
import { Engine } from './engine.js'
import { gameResults, positionKey, recordMove, uciMove } from './game.js'
import { createHistoryView } from './history-view.js'
import { icon } from './icons.js'
import { outcomeBar } from './outcomes.js'
import { connectSourceTabs } from './source-tabs.js'
import {
  CASTLING, FILES, canCastle, fromFen, fromFenInput, fromPlacement,
  indexOfSquare, lineNotation, pieceName, replayLine, squareAt, validatePosition,
} from './position.js'

const $ = id => document.getElementById(id)
const $$ = selector => [...document.querySelectorAll(selector)]
const runtime = new URL('./runtime/', document.baseURI).href
const engine = new Engine(runtime)
const cropEditor = createCropEditor({
  wrap: $('crop-image-wrap'), image: $('crop-image'), outline: $('crop-rect'),
  horizontal: $('crop-x'), vertical: $('crop-y'), size: $('crop-size'),
})
const state = {
  position: fromFen(DEFAULT_POSITION), origin: 'start', orientation: 'white',
  uncertain: new Set(), editing: false, palette: 'P', cursor: 0, cropping: false,
  file: null, screenshotUrl: null, scanId: 0, scanning: false, scanFailed: false,
  analysis: null, selected: 0, ply: 0,
  current: null, selection: '', targets: [], game: null, games: [],
  opening: null, gameStats: false, pgnLoading: false,
}

for (const item of $$('[data-icon]')) item.innerHTML = icon(item.dataset.icon)
const selectSource = connectSourceTabs($$('.source-tabs [role=tab]'))
const renderHistory = createHistoryView({
  container: $('game-history'), moves: $('history-moves'), heading: $('history-label'),
  previous: $('history-previous'), next: $('history-next'), navigate: navigateGame,
})

const theme = $('theme')
theme.value = document.documentElement.dataset.theme || 'dark'
theme.addEventListener('change', () => {
  document.documentElement.dataset.theme = theme.value
  try { localStorage.setItem('quiet-square-theme', theme.value) } catch {}
})

function pieceImage(piece) {
  const image = document.createElement('img')
  const side = piece === piece.toUpperCase() ? 'w' : 'b'
  image.src = `./pieces/${side}${piece.toUpperCase()}.svg`
  image.alt = ''
  image.draggable = false
  return image
}

function showMessage(element, message = '') {
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
  $('results').hidden = !state.gameStats
  updateAction()
}

function setPosition(position, origin, { game = null, cursor = 0, editing = false } = {}) {
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
  if (state.origin === 'start' || state.origin === 'game' || state.origin === 'play') state.origin = 'manual'
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
  for (const input of $$('[name=turn]')) input.checked = input.value === position.turn
  for (const input of $$('.castling input')) {
    input.checked = position.castling.includes(input.value)
    input.disabled = !canCastle(position.squares, input.value)
  }
  $('ep').value = position.ep === '-' ? '' : position.ep
  $('halfmove').value = position.halfmove
  $('fullmove').value = position.fullmove
  $('import-note').hidden = state.origin !== 'screenshot'
  state.current = validatePosition(position)
  $('copy-fen').disabled = !state.current.fen
  renderGameResults()
  updateAction()
}

function updateAction() {
  const running = state.analysis?.running
  $('analyze-label').textContent = running ? 'Stop search' : 'Analyze position'
  const busy = state.scanning || state.cropping || state.pgnLoading
  $('analyze').disabled = busy || state.editing || state.scanFailed
  for (const id of ['load-fen', 'setup-start', 'setup-empty', 'load-pgn', 'choose-pgn', 'open-game']) $(id).disabled = busy
  $('crop-button').disabled = busy
  $('replace-button').disabled = state.cropping || state.pgnLoading
  $('dropzone').disabled = state.pgnLoading
  $('edit-board').disabled = busy || state.scanFailed
  $('remove-button').disabled = state.cropping
}

function canPlay() {
  return state.current?.chess && !state.editing && !state.scanning && !state.scanFailed &&
    !state.cropping && !state.pgnLoading && !state.ply
}

const board = $('chessboard')
const DRAG_THRESHOLD = 6
let pieceDrag = null
let suppressSquareClick = false

function reduceMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

function applySquareEdit(indices) {
  state.position.castling = [...state.position.castling].filter(right => CASTLING[right] &&
    canCastle(state.position.squares, right)).join('') || '-'
  if (state.position.ep !== '-') {
    const target = indexOfSquare(state.position.ep)
    if (indices.some(index => [target, target + 8, target - 8].includes(index))) state.position.ep = '-'
  }
  for (const index of indices) state.uncertain.delete(index)
  afterPositionEdit()
}

function freeMovePiece(fromIndex, toIndex) {
  if (fromIndex === toIndex) {
    renderBoard()
    return
  }
  const piece = state.position.squares[fromIndex]
  state.position.squares[fromIndex] = ''
  state.position.squares[toIndex] = piece
  applySquareEdit([fromIndex, toIndex])
}

function displayIndexAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY)
  const tile = el?.closest?.('.square')
  if (!tile || !board.contains(tile)) return -1
  return tiles.indexOf(tile)
}

function moveGhost(ghost, clientX, clientY, size) {
  ghost.style.width = `${size}px`
  ghost.style.height = `${size}px`
  ghost.style.transform = `translate(${clientX - size / 2}px, ${clientY - size / 2}px)`
}

function endPieceDrag({ clientX, clientY, cancel = false } = {}) {
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
  drag.ghost.classList.add('returning')
  drag.ghost.style.transition = `transform ${duration}ms ease-out`
  moveGhost(drag.ghost, originRect.left + size / 2, originRect.top + size / 2, size)
  const settle = () => {
    finish()
    clearSelection()
    renderBoard()
  }
  if (!duration) settle()
  else drag.ghost.addEventListener('transitionend', settle, { once: true })
}

function onPiecePointerMove(event) {
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
      state.targets = state.current.chess.moves({ square: drag.fromSquare, verbose: true })
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
  moveGhost(drag.ghost, event.clientX, event.clientY, drag.originTile.getBoundingClientRect().width)
  const over = displayIndexAt(event.clientX, event.clientY)
  for (const [i, square] of tiles.entries()) {
    square.classList.toggle('drag-over', i === over && over !== drag.displayIndex)
  }
}

function onPiecePointerUp(event) {
  if (pieceDrag?.pointerId === event.pointerId) endPieceDrag(event)
}

function onPiecePointerCancel(event) {
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
      const chess = state.current.chess
      const onBoard = chess.get(squareAt(index))
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

document.querySelector('.skip-link').addEventListener('click', event => {
  if (state.cropping) return
  event.preventDefault()
  if (state.editing || canPlay()) tiles[state.cursor].focus()
  else board.focus()
})

const palette = [...'KQRBNPkqrbnp', ''].map(piece => {
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
  $('piece-tray').append(button)
  return { button, piece }
})

function renderPalette() {
  for (const { button, piece } of palette) button.setAttribute('aria-pressed', String(state.palette === piece))
}

function boardIndex(index) {
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
  const lastMove = activePly || state.game?.moves[state.game.ply - 1]
  const playing = Boolean(canPlay())
  const checkedKing = !activePly && state.current?.chess?.isCheck() ?
    squares.indexOf(state.position.turn === 'w' ? 'K' : 'k') : -1
  board.classList.toggle('editing', state.editing)
  board.classList.toggle('playable', playing)
  $('editor').hidden = !state.editing
  $('edit-board').setAttribute('aria-pressed', String(state.editing))
  $('edit-label').textContent = state.editing ? 'Done editing' : 'Edit board'
  $('orientation-label').textContent = state.orientation === 'white' ? 'White at bottom' : 'Black at bottom'
  $('rotate-import').hidden = state.origin !== 'screenshot' || state.editing || Boolean(line.length)

  const firstRank = state.orientation === 'white' ? '87654321' : '12345678'
  const orderedFiles = state.orientation === 'white' ? FILES : [...FILES].reverse().join('')
  $('rank-labels').innerHTML = [...firstRank].map(rank => `<span>${rank}</span>`).join('')
  $('file-labels').innerHTML = [...orderedFiles].map(file => `<span>${file}</span>`).join('')
  for (const [displayIndex, tile] of tiles.entries()) {
    const index = boardIndex(displayIndex)
    const square = squareAt(index)
    const piece = squares[index]
    if (tile.dataset.piece !== piece) {
      tile.replaceChildren(...(piece ? [pieceImage(piece)] : []))
      tile.dataset.piece = piece
    }
    const uncertain = !state.ply && state.uncertain.has(index)
    const legalTarget = playing && state.targets.some(move => move.to === square)
    const checked = index === checkedKing
    tile.classList.toggle('uncertain', uncertain)
    tile.classList.toggle('last-move', Boolean(lastMove && [lastMove.from, lastMove.to].includes(square)))
    tile.classList.toggle('selected-square', playing && square === state.selection)
    tile.classList.toggle('legal-target', legalTarget)
    tile.classList.toggle('check-square', checked)
    const detail = [uncertain && 'needs review', legalTarget && 'legal destination', checked && 'in check'].filter(Boolean)
    tile.setAttribute('aria-label', [square, pieceName(piece), ...detail].join(', '))
    tile.tabIndex = (state.editing || playing) && displayIndex === state.cursor ? 0 : -1
    tile.setAttribute('aria-disabled', String(!state.editing && !playing))
  }
  $('line-controls').hidden = !line.length
  $('game-results').inert = Boolean(state.ply)
  $('previous').disabled = state.ply === 0
  $('next').disabled = state.ply === line.length
  $('ply-label').textContent = `${state.ply} / ${line.length}`
  $('use-preview').hidden = !activePly || state.analysis.running
  renderArrow(nextPly)
  renderPalette()
  if (pieceDrag?.active) {
    board.classList.add('piece-dragging')
    pieceDrag.originTile.classList.add('drag-origin')
  }
}

function selectSquare(square) {
  const matching = state.targets.filter(move => move.to === square)
  if (matching.length > 1) {
    choosePromotion(matching)
    return
  }
  if (matching.length === 1) {
    playMove(matching[0])
    return
  }

  const chess = state.current.chess
  const piece = chess.get(square)
  if (square === state.selection || piece?.color !== chess.turn()) {
    clearSelection()
  } else {
    state.selection = square
    state.targets = chess.moves({ square, verbose: true })
  }
  renderBoard()
}

function choosePromotion(moves) {
  const dialog = $('promotion')
  $('promotion-pieces').replaceChildren(...moves.map(move => {
    const piece = move.color === 'w' ? move.promotion.toUpperCase() : move.promotion
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

function navigateGame(ply) {
  const game = state.game
  if (!game || ply < 0 || ply > game.moves.length || state.scanning || state.cropping || state.pgnLoading) return
  game.ply = ply
  const fen = ply ? game.moves[ply - 1].fen : game.startFen
  setPosition(fromFen(fen), game.title ? 'game' : 'play', { game, cursor: state.cursor })
}

function playMove(move) {
  if (!canPlay()) return
  const game = state.game || { startFen: state.current.fen, moves: [], ply: 0 }
  if (game.moves[game.ply]?.uci === uciMove(move)) {
    state.game = game
    navigateGame(game.ply + 1)
  } else {
    const chess = state.current.chess
    const recorded = recordMove(chess, chess.move(move))
    state.game = { startFen: game.startFen, moves: [...game.moves.slice(0, game.ply), recorded], ply: game.ply }
    state.uncertain.clear()
    navigateGame(game.ply + 1)
  }
  const movedPiece = move.color === 'w' ? move.piece.toUpperCase() : move.piece
  const chess = state.current.chess
  const check = chess.isCheckmate() ? ', checkmate' : chess.isCheck() ? ', check' : ''
  $('board-announcement').textContent = `${pieceName(movedPiece)} from ${move.from} to ${move.to}${check}.`
}

function renderArrow(move) {
  const svg = $('move-arrow')
  if (!move) {
    svg.replaceChildren()
    return
  }
  const from = boardIndex(indexOfSquare(move.from))
  const to = boardIndex(indexOfSquare(move.to))
  const x1 = (from % 8) * 100 + 50
  const y1 = Math.floor(from / 8) * 100 + 50
  const x2 = (to % 8) * 100 + 50
  const y2 = Math.floor(to / 8) * 100 + 50
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
  const length = Math.hypot(x2 - x1, y2 - y1)
  svg.innerHTML = `<path transform="translate(${x1} ${y1}) rotate(${angle})" d="M 0 -8 H ${length - 22} V -19 L ${length + 8} 0 L ${length - 22} 19 V 8 H 0 Q -8 8 -8 0 Q -8 -8 0 -8 Z"/>`
}

$('edit-board').addEventListener('click', () => {
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
  if (state.editing) palette.find(({ piece }) => piece === state.palette).button.focus()
})
$('flip-board').addEventListener('click', () => {
  state.orientation = state.orientation === 'white' ? 'black' : 'white'
  state.cursor = 63 - state.cursor
  renderBoard()
})
$('rotate-import').addEventListener('click', () => {
  state.position.squares.reverse()
  state.position.castling = '-'
  state.position.ep = '-'
  state.uncertain = new Set([...state.uncertain].map(index => 63 - index))
  state.orientation = state.orientation === 'white' ? 'black' : 'white'
  afterPositionEdit()
})

for (const input of $$('[name=turn]')) {
  input.addEventListener('change', () => {
    state.position.turn = input.value
    if (state.position.ep !== '-' && state.position.ep[1] !== (input.value === 'w' ? '6' : '3')) state.position.ep = '-'
    afterPositionEdit()
  })
}
for (const input of $$('.castling input')) {
  input.addEventListener('change', () => {
    state.position.castling = $$('.castling input:checked').map(box => box.value).join('') || '-'
    afterPositionEdit()
  })
}
for (const field of ['ep', 'halfmove', 'fullmove']) {
  $(field).addEventListener('change', () => {
    state.position[field] = $(field).value.trim().toLowerCase() || (field === 'ep' ? '-' : '')
    afterPositionEdit()
  })
}
$('load-fen').addEventListener('click', loadFen)
$('fen-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$('load-fen').disabled) loadFen()
})
function loadFen() {
  const { position, error } = fromFenInput($('fen-input').value)
  $('fen-message').classList.toggle('error', Boolean(error))
  if (error) {
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
$('copy-fen').addEventListener('click', async () => {
  const { fen } = state.current
  if (!fen) return
  $('fen-message').classList.remove('error')
  try {
    await navigator.clipboard.writeText(fen)
    showMessage($('fen-message'), 'FEN copied.')
  } catch {
    $('fen-input').value = fen
    $('fen-input').select()
    showMessage($('fen-message'), 'FEN selected. Copy it with your keyboard.')
  }
})

function resetBoard(fen, editing = false) {
  markSource(null)
  state.scanFailed = false
  state.orientation = 'white'
  state.uncertain.clear()
  setPosition(fromFen(fen), editing ? 'manual' : 'start', { editing })
  if (editing) palette.find(({ piece }) => piece === state.palette).button.focus()
}

$('setup-start').addEventListener('click', () => resetBoard(DEFAULT_POSITION))
$('setup-empty').addEventListener('click', () => resetBoard('8/8/8/8/8/8/8/8 w - - 0 1', true))

$('load-pgn').addEventListener('click', () => loadPgn($('pgn-input').value))
$('choose-pgn').addEventListener('click', () => $('pgn-file').click())
$('pgn-file').addEventListener('change', event => {
  const file = event.target.files[0]
  if (file) loadPgn(file)
  event.target.value = ''
})
$('game-select').addEventListener('change', () => openGame(Number($('game-select').value)))
$('open-game').addEventListener('click', () => openGame(Number($('game-select').value)))

function loadPgn(source) {
  if (state.pgnLoading || state.scanning || state.cropping) return
  const message = $('pgn-message')
  message.classList.remove('error')
  if (typeof source === 'string' && !source.trim()) {
    message.classList.add('error')
    showMessage(message, 'Paste a game or choose a PGN file first.')
    return
  }
  if ((typeof source === 'string' ? source.length : source.size) > 5 * 1024 * 1024) {
    message.classList.add('error')
    showMessage(message, 'Choose a PGN smaller than 5 MB.')
    return
  }
  state.pgnLoading = true
  clearSelection()
  updateAction()
  renderBoard()
  showMessage(message, 'Loading games…')
  let worker, timer
  const finish = ({ games, skipped, error }) => {
    clearTimeout(timer)
    worker?.terminate()
    state.pgnLoading = false
    message.classList.toggle('error', Boolean(error))
    if (error) {
      showMessage(message, error)
      updateAction()
      renderBoard()
      return
    }
    state.games = games
    $('game-select').replaceChildren(...games.map((game, index) =>
      new Option(`${index + 1}. ${game.title}`, String(index))))
    $('game-picker').hidden = false
    openGame(0)
    const count = games.length === 1 ? '1 game loaded.' : `${games.length} games loaded.`
    showMessage(message, skipped ? `${count} Skipped ${skipped} incomplete, illegal, or unsupported games.` : count)
  }
  try {
    worker = new Worker(new URL('./pgn.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = event => finish(event.data)
    worker.onerror = () => finish({ error: 'Could not open the PGN reader. Try again.' })
    timer = setTimeout(() => finish({ error: 'PGN import took too long. Try a smaller file.' }), 30_000)
    worker.postMessage(source)
  } catch {
    finish({ error: 'Could not open the PGN reader. Try again.' })
  }
}

function openGame(index) {
  if (!state.games[index]) return
  markSource(null)
  state.scanFailed = false
  state.orientation = 'white'
  state.uncertain.clear()
  state.game = { ...state.games[index], ply: 0 }
  navigateGame(0)
}

function markSource(file) {
  if (state.screenshotUrl) URL.revokeObjectURL(state.screenshotUrl)
  state.file = file
  state.screenshotUrl = file ? URL.createObjectURL(file) : null
  $('dropzone').hidden = Boolean(file)
  $('source-preview').hidden = !file
  if (file) {
    $('source-thumbnail').src = state.screenshotUrl
    $('source-name').textContent = file.name || 'Pasted screenshot'
    $('source-name').title = file.name || 'Pasted screenshot'
  } else {
    $('source-thumbnail').removeAttribute('src')
    showMessage($('scan-error'))
    showMessage($('scan-message'))
  }
}

let vision
let scanTimer

function finishScan(error, result) {
  clearTimeout(scanTimer)
  $('scan-progress').hidden = true
  state.scanning = false
  state.scanFailed = Boolean(error)
  showMessage($('scan-error'), error)
  if (error) {
    updateAction()
    renderBoard()
    return
  }
  state.orientation = result.orientation
  state.uncertain = new Set(result.uncertain)
  setPosition({
    squares: fromPlacement(result.placement), turn: '', castling: '-', ep: '-', halfmove: '0', fullmove: '1',
  }, 'screenshot')
  $('fen-input').value = ''
  showMessage($('fen-message'))
  showMessage($('scan-message'), result.reliable ?
    'Board found. Confirm who moves next.' : 'Some squares may need a closer look. Check the board before analyzing.')
}

function retireVision(message) {
  vision?.terminate()
  vision = null
  if (state.scanning) finishScan(message)
}

function scan(crop) {
  if (state.scanning) {
    vision?.terminate()
    vision = null
  }
  clearTimeout(scanTimer)
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
  $('scan-meter').value = 1
  updateAction()
  renderBoard()
  if (!vision) {
    try {
      vision = new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module' })
      vision.onmessage = ({ data }) => {
        if (data.id !== state.scanId) return
        if (data.label) {
          $('scan-label').textContent = data.label
          $('scan-step').textContent = `${data.value} / 3`
          $('scan-meter').value = data.value
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

function acceptScreenshot(file) {
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

$('dropzone').addEventListener('click', () => $('file-input').click())
$('replace-button').addEventListener('click', () => $('file-input').click())
$('remove-button').addEventListener('click', () => {
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
  $('dropzone').focus()
})
$('file-input').addEventListener('change', event => {
  acceptScreenshot(event.target.files[0])
  event.target.value = ''
})
const upload = document.querySelector('.upload-panel')
for (const eventName of ['dragenter', 'dragover']) {
  upload.addEventListener(eventName, event => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    upload.classList.add('dragging')
  })
}
upload.addEventListener('dragleave', event => {
  if (!upload.contains(event.relatedTarget)) upload.classList.remove('dragging')
})
window.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault()
})
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return
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
  const item = [...event.clipboardData.items].find(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (!item) return
  event.preventDefault()
  acceptScreenshot(item.getAsFile())
})

$('crop-button').addEventListener('click', () => {
  clearAnalysis()
  state.cropping = true
  state.editing = false
  renderBoard()
  cropEditor.open(state.screenshotUrl)
  updateAction()
  $('cancel-crop').focus()
})
$('cancel-crop').addEventListener('click', () => {
  state.cropping = false
  updateAction()
  renderBoard()
  $('crop-button').focus()
})
$('scan-crop').addEventListener('click', () => {
  if (cropEditor.selection) scan(cropEditor.selection)
})

const numbers = new Intl.NumberFormat()

function renderGameResults() {
  const { chess } = state.current || {}
  const key = chess && positionKey(chess.fen())
  const imported = key && state.games.length ? gameResults(state.games, key) : []
  const rows = imported.length ? imported : key && state.opening?.positions[key] || []
  const table = $('game-results')
  state.gameStats = !state.editing && rows.length > 0
  table.hidden = !state.gameStats
  $('results').hidden = !state.gameStats && !state.analysis
  if (!state.gameStats) return

  const legal = new Map(chess.moves({ verbose: true }).map(move => [uciMove(move), move]))
  const total = ([, white, draw, black]) => white + draw + black
  $('game-results-source').textContent = imported.length ?
    'Finished games in your imported PGN' : `Lichess sample · ${numbers.format(state.opening.games)} rated games · Oct 2025`
  $('game-results-body').replaceChildren(...rows.filter(([uci]) => legal.has(uci))
    .sort((a, b) => total(b) - total(a)).slice(0, 5).map(row => {
      const [uci, ...counts] = row
      const move = legal.get(uci)
      const tr = document.createElement('tr')
      const cell = tr.insertCell()
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-stat-move'
      button.textContent = move.san
      button.setAttribute('aria-label', `Play ${move.san}`)
      button.addEventListener('click', () => {
        playMove(move)
        tiles[state.cursor].focus({ preventScroll: true })
      })
      cell.append(button)
      tr.insertCell().textContent = numbers.format(total(row))
      tr.insertCell().append(outcomeBar(counts))
      return tr
    }))
}

function resultScore(info, turn) {
  if (info.score === undefined) return '—'
  const score = (turn === 'w' ? 1 : -1) * info.score
  if (info.type === 'mate') return `${score < 0 ? '−' : '+'}M${Math.abs(score)}`
  if (!score) return '0.00'
  return `${score < 0 ? '−' : '+'}${(Math.abs(score) / 100).toFixed(2)}`
}

function displayResults() {
  const analysis = state.analysis
  $('results').hidden = false
  $('engine-results').hidden = false
  $('next-move-prompt').hidden = true
  $('results').classList.toggle('searching', analysis.running)
  $('engine-status').dataset.state = analysis.running ? 'running' : analysis.error ? 'error' : 'complete'
  if ($('engine-status-label').textContent !== analysis.status) $('engine-status-label').textContent = analysis.status
  $('engine-depth').textContent = analysis.depth ? `Depth ${analysis.depth}` : ''
  $('search-track').hidden = !analysis.running
  $('engine-loading').hidden = !analysis.running || analysis.stage !== 'loading'
  $('deeper').hidden = analysis.running || !analysis.lines.length || analysis.lines[0].info.type === 'mate'
  $('engine-outcomes-label').hidden = !analysis.lines.some(({ info }) => info.wdl)
  showMessage($('engine-error'), analysis.error)
  const focusedMove = document.activeElement?.dataset.move
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

function setLines(best, alternatives = []) {
  const analysis = state.analysis
  const previous = analysis.lines[state.selected]?.info
  analysis.lines = [best, ...alternatives].filter(Boolean).flatMap(info => {
    const line = replayLine(analysis.fen, info.pv)
    return line.length ? [{ info, line }] : []
  })
  const selected = analysis.lines.findIndex(({ info }) => info.pv[0] === previous?.pv[0])
  state.selected = Math.max(0, selected)
  const next = analysis.lines[state.selected]?.info
  if (!next || !previous || next.pv.slice(0, state.ply).join() !== previous.pv.slice(0, state.ply).join()) state.ply = 0
}

function analyze(deep = false) {
  const { fen, chess, error } = state.current
  showMessage($('position-error'), error)
  if (error) return
  clearSelection()
  const moves = chess.moves({ verbose: true })
  const game = state.game
  const played = game?.moves.slice(0, game.ply)
  const history = played?.length ? { startFen: game.startFen, moves: played.map(move => move.uci) } : null
  const key = positionKey(chess.fen())
  const repeated = played?.filter(move => move.before === key).length >= 4
  const terminal = chess.isCheckmate() ? 'Checkmate' : chess.isStalemate() ? 'Stalemate' :
    chess.isInsufficientMaterial() ? 'Draw by insufficient material' :
      repeated ? 'Draw by fivefold repetition' :
      Number(state.position.halfmove) >= 150 ? 'Draw by the 75-move rule' : ''
  const previous = deep && state.analysis?.fen === fen ? state.analysis : null
  const analysis = {
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

$('analyze').addEventListener('click', () => {
  if (state.analysis?.running) engine.stop()
  else analyze()
})
$('deeper').addEventListener('click', () => {
  analyze(true)
  $('analyze').focus()
})
$('previous').addEventListener('click', () => {
  if (!state.ply) return
  state.ply--
  renderBoard()
})
$('next').addEventListener('click', () => {
  const line = state.analysis?.lines[state.selected]?.line
  if (!line || state.ply >= line.length) return
  state.ply++
  renderBoard()
})
$('use-preview').addEventListener('click', () => {
  const line = state.analysis?.lines[state.selected]?.line
  if (!line || !state.ply || state.analysis.running) return
  const base = state.game
  const moves = [...(base?.moves.slice(0, base.ply) || []),
    ...line.slice(0, state.ply).map(move => ({ ...move, uci: uciMove(move), before: positionKey(move.before) }))]
  state.game = { startFen: base?.startFen || state.analysis.fen, moves, ply: moves.length }
  markSource(null)
  state.uncertain.clear()
  navigateGame(moves.length)
  analyze()
  $('analyze').focus()
})

renderSetup()
renderBoard()

import('./opening-sample.json').then(({ default: opening }) => {
  state.opening = opening
  renderGameResults()
}).catch(() => {})
