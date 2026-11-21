type Cue = 'move' | 'capture' | 'notify'

const sources: Record<Cue, string> = {
  move: 'https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-self.mp3',
  capture: 'https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/capture.mp3',
  notify: 'https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/notify.mp3',
}
const players = new Map<Cue, HTMLAudioElement>()

export async function prepareChessAudio(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    await Promise.all(Object.entries(sources).map(([cue, src]) => {
      const player = players.get(cue as Cue) ?? new Audio(src)
      players.set(cue as Cue, player)
      player.load()
      return Promise.resolve()
    }))
    return true
  } catch { return false }
}

export function playChessSound(san = '') {
  if (typeof window === 'undefined') return
  const cue: Cue = san === 'notify' ? 'notify' : san.includes('x') ? 'capture' : 'move'
  const player = players.get(cue) ?? new Audio(sources[cue])
  players.set(cue, player)
  player.currentTime = 0
  void player.play().catch(() => {})
}
