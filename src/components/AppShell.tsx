'use client'

import { usePathname, useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState } from 'react'
import { icon } from '../icons'
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

export function AppShell() {
  const router = useRouter()
  const pathname = usePathname()
  const routeMode: Mode = pathname === '/position' ? 'position' : 'review'
  const [override, setOverride] = useState<Mode | null>(null)
  const intent = useRef<Mode | null>(null)
  const mode = override ?? routeMode
  const { theme, toggle } = useTheme()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const reviewTab = useRef<HTMLButtonElement>(null)
  const positionTab = useRef<HTMLButtonElement>(null)
  const [frameSrc, setFrameSrc] = useState<string | null>(routeMode === 'position' ? POSITION_SRC : null)
  const [frameHeight, setFrameHeight] = useState<number | null>(null)

  function warmPosition() {
    setFrameSrc(current => current ?? POSITION_SRC)
  }

  useEffect(() => {
    router.prefetch('/position')
    router.prefetch('/')
  }, [router])

  useEffect(() => {
    if (frameSrc) return
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setFrameSrc(POSITION_SRC), { timeout: 700 })
      return () => win.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(() => setFrameSrc(POSITION_SRC), 350)
    return () => window.clearTimeout(id)
  }, [frameSrc])

  useEffect(() => {
    if (intent.current === routeMode) {
      intent.current = null
      setOverride(null)
    }
  }, [routeMode])

  useEffect(() => {
    document.title = TITLES[mode]
  }, [mode])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin) return
      if (event.source !== frameRef.current?.contentWindow) return
      if (event.data?.source !== 'position-frame') return
      const height = Number(event.data.height)
      if (height > 200) setFrameHeight(height)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function paintFrame() {
    const frame = frameRef.current
    const root = frame?.contentDocument?.documentElement
    if (root) root.dataset.theme = theme
    frame?.contentWindow?.postMessage({ source: 'chess-shell', theme, measure: true }, location.origin)
  }

  useEffect(() => {
    const frame = frameRef.current
    const root = frame?.contentDocument?.documentElement
    if (root) root.dataset.theme = theme
    frame?.contentWindow?.postMessage({ source: 'chess-shell', theme, measure: true }, location.origin)
  }, [theme, mode, frameSrc])

  function go(next: Mode, focus: boolean) {
    if (next === 'position') warmPosition()
    if (next === mode) return
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
            <span className="mode-thumb" aria-hidden="true" />
            <button
              ref={reviewTab}
              id="mode-review"
              type="button"
              role="tab"
              aria-selected={mode === 'review'}
              aria-controls="mode-panel-review"
              tabIndex={mode === 'review' ? 0 : -1}
              onPointerDown={() => warmPosition()}
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
              onPointerDown={() => warmPosition()}
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
          {frameSrc ? (
            <iframe
              ref={frameRef}
              className="position-frame"
              title="Position analysis"
              src={frameSrc}
              style={frameHeight ? { height: frameHeight } : undefined}
              onLoad={paintFrame}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
