import { fromPlacement, pieceName, squareAt } from './position'

const SVG = 'http://www.w3.org/2000/svg'
const initialReadout = 'Select a box to inspect its label and confidence.'

export interface DetectionTile {
  confidence: number
  uncertain: boolean
}
export interface Detection {
  source: { width: number; height: number }
  bounds: { x: number; y: number; width: number; height: number }
  placement: string
  tiles: DetectionTile[]
}

interface DetectionElements {
  details: HTMLDetailsElement
  reveal: HTMLButtonElement
  svg: SVGSVGElement
  photo: SVGImageElement
  outline: SVGRectElement
  squares: SVGGElement
  count: HTMLElement
  zoom: HTMLButtonElement
  readout: HTMLElement
}

interface Box {
  group: SVGGElement
  title: SVGTitleElement
  index: number
  piece: string
  confidence: number
  uncertain: boolean
}

function attributes<T extends Element>(element: T, values: Record<string, string | number>): T {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value))
  return element
}

function shape<K extends keyof SVGElementTagNameMap>(tag: K, values: Record<string, string | number>): SVGElementTagNameMap[K] {
  return attributes(document.createElementNS(SVG, tag), values)
}

function boardView(bounds: Detection['bounds'], source: Detection['source']) {
  const padding = Math.max(bounds.width, bounds.height) * 0.06
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  const right = Math.min(source.width, bounds.x + bounds.width + padding)
  const bottom = Math.min(source.height, bounds.y + bounds.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}

export function createDetectionView({ details, reveal, svg, photo, outline, squares, count, zoom, readout }: DetectionElements) {
  let image: Detection | null = null
  let orientation = 'white'
  let boxes: Box[] = []
  let selected = -1
  let zoomed = false

  function updateViewport(): void {
    if (!image) return
    const view = zoomed ? boardView(image.bounds, image.source) : { x: 0, y: 0, ...image.source }
    attributes(svg, { viewBox: `${view.x} ${view.y} ${view.width} ${view.height}`, width: view.width, height: view.height })
    zoom.textContent = zoomed ? 'Full screenshot' : 'Zoom to board'
  }

  function describe(box: Box): string {
    const square = squareAt(orientation === 'black' ? 63 - box.index : box.index)
    const confidence = Math.round(box.confidence * 100)
    return `${square} · ${pieceName(box.piece)} · ${confidence}% model confidence${box.uncertain ? ' · needs review' : ''}`
  }

  function select(index: number): void {
    selected = index
    for (const [i, box] of boxes.entries()) box.group.classList.toggle('detection-selected', i === index)
    readout.textContent = boxes[index] ? describe(boxes[index]) : initialReadout
  }

  zoom.addEventListener('click', () => {
    if (!image) return
    zoomed = !zoomed
    updateViewport()
  })
  reveal.addEventListener('click', () => {
    details.open = true
    details.querySelector('summary')?.focus({ preventScroll: true })
    details.scrollIntoView({ block: 'start' })
  })
  squares.addEventListener('click', event => {
    const group = (event.target as Element).closest<SVGGElement>('[data-box]')
    if (!group) return
    svg.focus({ preventScroll: true })
    select(Number(group.dataset.box))
  })
  svg.addEventListener('keydown', event => {
    if (!boxes.length || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const next = selected < 0 ? (step > 0 ? 0 : boxes.length - 1) : (selected + step + boxes.length) % boxes.length
    select(next)
  })

  return {
    show(url: string, detection: Detection, boardOrientation: string): void {
      image = detection
      orientation = boardOrientation
      zoomed = false
      const { source, bounds, placement, tiles } = image
      attributes(photo, { href: url, width: source.width, height: source.height })
      attributes(outline, bounds)
      const pieces = fromPlacement(placement)
      const tileWidth = bounds.width / 8
      const tileHeight = bounds.height / 8
      const unit = Math.min(tileWidth, tileHeight)
      const strokeInset = unit * 0.04
      const tagHeight = unit * 0.24
      boxes = []
      for (const [index, piece] of pieces.entries()) {
        const { confidence, uncertain } = tiles[index]
        if (!piece && !uncertain) continue
        const x = bounds.x + index % 8 * tileWidth + strokeInset
        const y = bounds.y + Math.floor(index / 8) * tileHeight + strokeInset
        const label = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') + piece.toUpperCase() : '—'
        const group = shape('g', { 'data-box': boxes.length, class: uncertain ? 'detection-box uncertain-box' : 'detection-box' })
        const title = shape('title', {})
        const box: Box = { group, title, index, piece, confidence, uncertain }
        title.textContent = describe(box)
        const border = shape('rect', {
          class: 'detection-square', x, y, width: tileWidth - 2 * strokeInset, height: tileHeight - 2 * strokeInset,
        })
        const tag = shape('rect', { class: 'detection-tag', x, y, width: tagHeight * 1.62, height: tagHeight })
        const text = shape('text', {
          x: x + tagHeight * 0.18, y: y + tagHeight * 0.74,
          'font-size': tagHeight * 0.78, class: 'detection-label',
        })
        text.textContent = label
        group.append(title, border, tag, text)
        boxes.push(box)
      }
      squares.replaceChildren(...boxes.map(box => box.group))
      const piecesRead = pieces.filter(Boolean).length
      const uncertain = boxes.filter(box => box.uncertain).length
      count.textContent = `${piecesRead} ${piecesRead === 1 ? 'piece' : 'pieces'}${uncertain ? ` · ${uncertain} to check` : ''}`
      updateViewport()
      select(-1)
      details.hidden = false
      details.open = true
      reveal.hidden = false
    },
    rotate(): void {
      if (!image) return
      orientation = orientation === 'black' ? 'white' : 'black'
      for (const box of boxes) box.title.textContent = describe(box)
      select(selected)
    },
    clear(): void {
      image = null
      boxes = []
      details.hidden = true
      reveal.hidden = true
      photo.removeAttribute('href')
      squares.replaceChildren()
    },
  }
}
