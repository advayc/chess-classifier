export function createHistoryView({ container, moves, heading, previous, next, navigate }) {
  let current

  function moveButton(label, ply) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'history-move'
    button.textContent = label
    button.dataset.ply = ply
    button.setAttribute('aria-pressed', String(current === ply))
    button.addEventListener('click', () => navigate(ply))
    return button
  }

  previous.addEventListener('click', () => navigate(current - 1))
  next.addEventListener('click', () => navigate(current + 1))
  moves.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const ply = current + (event.key === 'ArrowLeft' ? -1 : 1)
    navigate(ply)
    moves.querySelector(`[data-ply="${current}"]`)?.focus()
  })

  return function render(game, editing) {
    container.hidden = !game?.moves.length || editing
    if (container.hidden) return
    current = game.ply
    heading.textContent = game.title || 'Played moves'
    previous.disabled = !current
    next.disabled = current >= game.moves.length
    const focusedPly = document.activeElement?.dataset.ply

    const start = document.createElement('div')
    start.className = 'history-start'
    start.append(moveButton('Start', 0))
    const nodes = [start]
    let row
    for (const [index, move] of game.moves.entries()) {
      if (move.color === 'w' || index === 0) {
        row = document.createElement('div')
        row.className = 'history-row'
        const number = document.createElement('span')
        number.textContent = `${move.moveNumber}.`
        row.append(number)
        nodes.push(row)
      }
      const entry = moveButton(move.san, index + 1)
      entry.classList.toggle('black-move', move.color === 'b')
      row.append(entry)
    }
    if (game.result && game.result !== '*') {
      const result = document.createElement('span')
      result.className = 'history-result'
      result.textContent = game.result
      nodes.push(result)
    }
    moves.replaceChildren(...nodes)
    if (focusedPly !== undefined) moves.querySelector(`[data-ply="${focusedPly}"]`)?.focus({ preventScroll: true })
    const selected = moves.querySelector('[aria-pressed=true]')
    if (selected && selected.offsetTop + selected.offsetHeight > moves.scrollTop + moves.clientHeight) {
      moves.scrollTop = selected.offsetTop + selected.offsetHeight - moves.clientHeight
    } else if (selected && selected.offsetTop < moves.scrollTop) {
      moves.scrollTop = selected.offsetTop
    }
  }
}
