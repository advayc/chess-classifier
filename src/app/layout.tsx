import type { Metadata } from 'next'
import '@fontsource-variable/instrument-sans/wght.css'
import './globals.css'
import { AppShell } from '../components/AppShell'

export const metadata: Metadata = {
  title: 'Chess Engine · Game review',
  description: 'Review chess games with Stockfish: import Chess.com or Lichess games, see accuracy, classifications, and explore variations.',
  icons: { icon: '/mark.svg' },
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
        <meta name="color-scheme" content="dark light" />
      </head>
      <body><AppShell />{children}</body>
    </html>
  )
}
