import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/instrument-sans/wght.css'
import './globals.css'
import { AppShell } from '../components/AppShell'

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
  colorScheme: 'dark light',
}

const title = 'Quiet Square · Infinite chess game review'
const description =
  'Review chess games without a daily limit and find the best move in any position. Near-instant (<1s) move classification, then Stockfish surfaces the next best lines. Import from Chess.com or Lichess, or drop in a screenshot, FEN, or PGN — all in the browser.'

export const metadata: Metadata = {
  metadataBase: new URL('https://chess.advay.ca'),
  title: {
    default: title,
    template: '%s · Quiet Square',
  },
  description,
  applicationName: 'Quiet Square',
  keywords: [
    'chess',
    'chess game review',
    'Stockfish',
    'chess analysis',
    'best move',
    'move classification',
    'chess engine',
    'FEN',
    'PGN',
    'chess screenshot',
    'position analysis',
    'Chess.com',
    'Lichess',
  ],
  authors: [{ name: 'Advay Chandorkar' }],
  creator: 'Advay Chandorkar',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Quiet Square',
    url: 'https://chess.advay.ca',
    title,
    description,
    locale: 'en_US',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Quiet Square — infinite chess game review and best-move analysis',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
  icons: {
    icon: [
      { url: '/mark.svg', type: 'image/svg+xml' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('quiet-square-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body><AppShell />{children}</body>
    </html>
  )
}
