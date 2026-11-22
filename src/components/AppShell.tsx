'use client'

import { usePathname, useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState } from 'react'
import { icon } from '../icons'
import { clipboardImage, SCREENSHOT_EVENT } from '../screenshot'
import { ReviewApp } from './ReviewApp'

type Theme = 'light' | 'dark'
type Mode = 'review' | 'position'

const POSITION_SRC = '/legacy.html?embed=1'
const TITLES: Record<Mode, string> = {
  review: 'Chess Engine · Game review',
  position: 'Chess Engine · Position analysis',
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => {
    try {
      const stored = localStorage.getItem('quiet-square-theme')
      if (stored === 'light' || stored === 'dark') setTheme(stored)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('quiet-square-theme', theme) } catch { /* ignore */ }
  }, [theme])
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}

function sendScreenshot(frame: HTMLIFrameElement, image: File): boolean {
  const target = frame.contentWindow
  if (!target || frame.contentDocument?.documentElement.dataset.positionReady !== 'true') return false
  target.dispatchEvent(new CustomEvent(SCREENSHOT_EVENT, { detail: image }))
  return true
}

function PositionFrame({ theme, active }: { theme: Theme; active: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingScreenshot = useRef<File | null>(null)
  const [page, setPage] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const connect = () => {
      setPage(frame.contentDocument?.querySelector<HTMLElement>('main') ?? null)
      const image = pendingScreenshot.current
      if (image && sendScreenshot(frame, image)) pendingScreenshot.current = null
    }
    frame.addEventListener('load', connect)
    connect()
    return () => frame.removeEventListener('load', connect)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!active || !frame) return
    const paste = (event: ClipboardEvent) => {
      const image = clipboardImage(event.clipboardData)
      if (!image) return
      event.preventDefault()
      pendingScreenshot.current = sendScreenshot(frame, image) ? null : image
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [active])

  useEffect(() => {
    if (page) page.ownerDocument.documentElement.dataset.theme = theme
  }, [page, theme])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !page) return

    const resize = () => {
      const height = Math.ceil(page.getBoundingClientRect().height)
      if (height > 0) frame.style.height = `${height}px`
    }

    const observer = new ResizeObserver(resize)
    observer.observe(page, { box: 'border-box' })
    resize()
    return () => observer.disconnect()
  }, [page])

  return <iframe ref={frameRef} className="position-frame" title="Position analysis" src={POSITION_SRC} />
}

export function AppShell() {
  const router = useRouter()
  const pathname = usePathname()
  const routeMode: Mode = pathname === '/position' ? 'position' : 'review'
  const [override, setOverride] = useState<Mode | null>(null)
  const intent = useRef<Mode | null>(null)
  const mode = override ?? routeMode
  const { theme, toggle } = useTheme()
  const reviewTab = useRef<HTMLButtonElement>(null)
  const positionTab = useRef<HTMLButtonElement>(null)
  const [positionOpened, setPositionOpened] = useState(routeMode === 'position')

  useEffect(() => {
    router.prefetch('/position')
    router.prefetch('/')
  }, [router])

  useEffect(() => {
    if (intent.current === routeMode) {
      intent.current = null
      setOverride(null)
    }
  }, [routeMode])

  useEffect(() => {
    document.title = TITLES[mode]
  }, [mode])

  function go(next: Mode, focus: boolean) {
    if (next === mode) return
    if (next === 'position') setPositionOpened(true)
    intent.current = next
    setOverride(next)
    document.title = TITLES[next]
    const href = next === 'position' ? '/position' : '/'
    if (pathname !== href) startTransition(() => router.push(href, { scroll: false }))
    if (focus) (next === 'review' ? reviewTab : positionTab).current?.focus()
  }

  function onSwitchKey(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    go(mode === 'review' ? 'position' : 'review', true)
  }

  return (
    <div className="page app-shell">
      <header className="page-heading">
        <div className="brand-row">
          <h1 className="page-title">Chess Engine</h1>
          <div
            className="mode-switch"
            role="tablist"
            aria-label="App mode"
            data-mode={mode}
            onKeyDown={onSwitchKey}
          >
            <button
              ref={reviewTab}
              id="mode-review"
              type="button"
              role="tab"
              aria-selected={mode === 'review'}
              aria-controls="mode-panel-review"
              tabIndex={mode === 'review' ? 0 : -1}
              onClick={() => go('review', false)}
            >
              Review
            </button>
            <button
              ref={positionTab}
              id="mode-position"
              type="button"
              role="tab"
              aria-selected={mode === 'position'}
              aria-controls="mode-panel-position"
              tabIndex={mode === 'position' ? 0 : -1}
              onClick={() => go('position', false)}
            >
              Position
            </button>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          onClick={toggle}
          dangerouslySetInnerHTML={{ __html: icon(theme === 'dark' ? 'sun' : 'moon') }}
        />
      </header>

      <div className="mode-stage">
        <div id="mode-panel-review" role="tabpanel" aria-labelledby="mode-review" hidden={mode !== 'review'}>
          <ReviewApp />
        </div>
        <div id="mode-panel-position" role="tabpanel" aria-labelledby="mode-position" hidden={mode !== 'position'}>
          {positionOpened || mode === 'position' ? <PositionFrame theme={theme} active={mode === 'position'} /> : null}
        </div>
      </div>
    </div>
  )
}
