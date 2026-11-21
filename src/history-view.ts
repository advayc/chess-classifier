import type { GameRecord } from './types'

interface HistoryElements {
  container: HTMLElement
  moves: HTMLElement
  heading: HTMLElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
  navigate: (ply: number) => void
}

export function createHistoryView({ container, moves, heading, previous, next, navigate }: HistoryElements) {
  let current = 0

  function moveButton(label: string, ply: number): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'history-move'
    button.textContent = label
    button.dataset.ply = String(ply)
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
    moves.querySelector<HTMLElement>(`[data-ply="${current}"]`)?.focus()
  })

  return function render(game: GameRecord | null, hidden: boolean): void {
    container.hidden = !game?.moves.length || hidden
    if (container.hidden || !game) return
    current = game.ply ?? 0
    heading.textContent = game.title || 'Played moves'
    previous.disabled = !current
    next.disabled = current >= game.moves.length
    const focusedPly = (document.activeElement as HTMLElement | null)?.dataset?.ply

    const start = document.createElement('div')
    start.className = 'history-start'
    start.append(moveButton('Start', 0))
    const nodes: HTMLElement[] = [start]
    let row: HTMLElement | undefined
    for (const [index, move] of game.moves.entries()) {
      if (move.color === 'w' || index === 0 || !row) {
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
    if (focusedPly !== undefined) moves.querySelector<HTMLElement>(`[data-ply="${focusedPly}"]`)?.focus({ preventScroll: true })
    const selected = moves.querySelector<HTMLElement>('[aria-pressed=true]')
    if (selected && selected.offsetTop + selected.offsetHeight > moves.scrollTop + moves.clientHeight) {
      moves.scrollTop = selected.offsetTop + selected.offsetHeight - moves.clientHeight
    } else if (selected && selected.offsetTop < moves.scrollTop) {
      moves.scrollTop = selected.offsetTop
    }
  }
}
