export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

interface CropElements {
  wrap: HTMLElement
  image: HTMLImageElement
  outline: HTMLElement
  horizontal: HTMLInputElement
  vertical: HTMLInputElement
  size: HTMLInputElement
}

export function createCropEditor({ wrap, image, outline, horizontal, vertical, size }: CropElements) {
  let crop: CropRect | null = null
  let drag: { start: { x: number; y: number }; rect: DOMRect; id: number } | null = null
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

  function set(x: number, y: number, side: number): void {
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height) return
    const w = side / width
    const h = side / height
    crop = { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h }
    Object.assign(outline.style, {
      left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
      width: `${w * 100}%`, height: `${h * 100}%`,
    })
    horizontal.value = String(1000 * crop.x / (1 - w || 1))
    vertical.value = String(1000 * crop.y / (1 - h || 1))
    horizontal.disabled = w === 1
    vertical.disabled = h === 1
    size.value = String(1000 * side / Math.min(width, height))
  }

  function center(): void {
    const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.9
    set((1 - side / image.naturalWidth) / 2, (1 - side / image.naturalHeight) / 2, side)
  }

  function point(event: PointerEvent, rect: DOMRect) {
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    }
  }

  wrap.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !crop) return
    const rect = image.getBoundingClientRect()
    drag = { start: point(event, rect), rect, id: event.pointerId }
    wrap.setPointerCapture(event.pointerId)
  })
  wrap.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return
    const { start, rect } = drag
    const end = point(event, rect)
    const scale = image.naturalWidth / rect.width
    const left = end.x < start.x
    const up = end.y < start.y
    const side = Math.min(
      Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)),
      left ? start.x : rect.width - start.x,
      up ? start.y : rect.height - start.y,
    )
    if (side * scale >= 80) {
      set((start.x - (left ? side : 0)) / rect.width, (start.y - (up ? side : 0)) / rect.height, side * scale)
    }
  })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    wrap.addEventListener(event, () => { drag = null })
  }

  horizontal.addEventListener('input', () => {
    if (crop) set((1 - crop.w) * Number(horizontal.value) / 1000, crop.y, crop.w * image.naturalWidth)
  })
  vertical.addEventListener('input', () => {
    if (crop) set(crop.x, (1 - crop.h) * Number(vertical.value) / 1000, crop.w * image.naturalWidth)
  })
  size.addEventListener('input', () => {
    if (!crop) return
    const side = Math.min(image.naturalWidth, image.naturalHeight) * Number(size.value) / 1000
    set(crop.x + (crop.w - side / image.naturalWidth) / 2,
      crop.y + (crop.h - side / image.naturalHeight) / 2, side)
  })
  image.addEventListener('load', center)
  return {
    open(url: string): void {
      crop = null
      image.src = url
      if (image.complete) center()
    },
    get selection(): CropRect | null { return crop },
  }
}
